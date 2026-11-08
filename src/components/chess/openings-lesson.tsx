"use client";

/**
 * OpeningsLesson — learn an opening by playing its scripted moves yourself.
 *
 * `opening.moves` alternates sides: index 0 is White's 1st move, index 1 is
 * Black's reply, and so on. In PLAY mode the learner plays `opening.side` and
 * must find each scripted move; the opponent's scripted replies are applied
 * automatically after a short pause. In WATCH mode the whole line is
 * demonstrated automatically, one move every ~950 ms.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useAnimationControls } from "framer-motion";
import confetti from "canvas-confetti";
import { Chess, type Color, type Move, type Square } from "chess.js";
import {
  Check,
  Eye,
  GraduationCap,
  Lightbulb,
  Play,
  Quote,
  RotateCcw,
  Square as SquareIcon,
  StepBack,
  StepForward,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChessBoard } from "./board";
import { fenToPieces, type PieceView } from "@/lib/chess-utils";
import { playSound } from "@/lib/sounds";
import type { Opening } from "@/lib/puzzles";
import { cn } from "@/lib/utils";

type PromotionPiece = "q" | "r" | "b" | "n";

const OPPONENT_DELAY_MS = 450;
const WATCH_INTERVAL_MS = 950;
const MESSAGE_TTL_MS = 2800;
const CONFETTI_COLORS = ["#e9c96b", "#c9a24b", "#38e0af", "#fdf6dc"];
const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const goldButton =
  "border border-[#8a6a24]/50 bg-gradient-to-b from-[#ecca6f] to-[#c69c3f] font-semibold text-[#241a05] shadow-[0_6px_20px_-6px_rgba(212,175,55,0.55)] hover:from-[#f3d887] hover:to-[#d4a94e]";
const ghostButton =
  "border-white/10 bg-white/5 text-foreground/80 hover:border-gold/40 hover:bg-white/10 hover:text-gold-soft";

export interface OpeningsLessonProps {
  opening: Opening;
  onClose: () => void;
  /** fire ONCE when the user completes the line themselves (play mode) */
  onComplete: (id: string) => void;
}

export function OpeningsLesson({ opening, onClose, onComplete }: OpeningsLessonProps) {
  const gameRef = useRef<Chess>(new Chess()); // mutated only outside render
  const [fen, setFen] = useState(START_FEN);
  const [step, setStep] = useState(0); // index of the NEXT scripted move
  const [mode, setMode] = useState<"play" | "watch">("play");
  const [selected, setSelected] = useState<Square | null>(null);
  const [lastMove, setLastMove] = useState<{ from: Square; to: Square } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);

  const completedRef = useRef(false); // onComplete guard — fires exactly once
  const watchTimersRef = useRef<number[]>([]);
  const messageTimerRef = useRef<number | null>(null);
  const shakeControls = useAnimationControls();

  const orientation = opening.side === "White" ? "white" : "black";
  const userColor: Color = opening.side === "White" ? "w" : "b";
  const isDone = step >= opening.moves.length;
  const userToMove =
    mode === "play" && !isDone && (step % 2 === 0) === (userColor === "w");

  const shortName = useMemo(
    () => opening.name.replace(/\s+(Game|Defense|Defence|System)$/i, ""),
    [opening.name]
  );
  const pieces = useMemo<PieceView[]>(() => fenToPieces(fen), [fen]);
  // render-pure position view (the mutable game lives behind gameRef, touched
  // only in handlers/effects/timers — never during render)
  const game = useMemo(() => new Chess(fen), [fen]);
  const turnColor = useMemo<Color>(() => game.turn(), [game]);
  const legalTargets = useMemo<Move[]>(() => {
    if (!selected) return [];
    try {
      return game.moves({ square: selected, verbose: true });
    } catch {
      return [];
    }
  }, [game, selected]);
  const checkedSquare = useMemo<Square | null>(() => {
    if (!game.isCheck()) return null;
    const sideToMove = game.turn();
    const king = game
      .board()
      .flat()
      .find((p) => p !== null && p.type === "k" && p.color === sideToMove);
    return king ? king.square : null;
  }, [game]);

  /* ---------------- scripted-move application ---------------- */

  /** Apply scripted move `index` to the live game (auto-reply + watch mode). */
  const applyScriptedMove = useCallback(
    (index: number): boolean => {
      const scripted = opening.moves[index];
      if (!scripted) return false;
      const g = gameRef.current;
      let move: Move;
      try {
        move = g.move(scripted.san);
      } catch {
        return false; // position out of sync — never crash the lesson
      }
      playSound(move.captured ? "capture" : "move");
      setFen(g.fen());
      setLastMove({ from: move.from, to: move.to });
      setSelected(null);
      setStep(index + 1);
      return true;
    },
    [opening]
  );

  /** Rebuild the board from the start position up to `n` scripted moves. */
  const resetToStep = useCallback(
    (n: number, withSound = false) => {
      const g = new Chess();
      for (let i = 0; i < n && i < opening.moves.length; i++) {
        try {
          g.move(opening.moves[i].san);
        } catch {
          break;
        }
      }
      gameRef.current = g;
      setFen(g.fen());
      setStep(n);
      setSelected(null);
      setMessage(null);
      const history = g.history({ verbose: true });
      const last = history[history.length - 1];
      setLastMove(last ? { from: last.from, to: last.to } : null);
      if (withSound && last) playSound("move");
    },
    [opening]
  );

  /* ---------------- wrong-move rejection ---------------- */

  const rejectMove = useCallback(
    (expectedSan: string) => {
      playSound("illegal");
      void shakeControls.start({
        x: [0, -8, 8, -5, 5, 0],
        transition: { duration: 0.42, ease: "easeInOut" },
      });
      setMessage(`The ${shortName} goes ${expectedSan} here — try again`);
      if (messageTimerRef.current !== null) window.clearTimeout(messageTimerRef.current);
      messageTimerRef.current = window.setTimeout(() => setMessage(null), MESSAGE_TTL_MS);
    },
    [shakeControls, shortName]
  );

  const fireConfetti = useCallback(() => {
    confetti({
      particleCount: 130,
      spread: 78,
      startVelocity: 40,
      origin: { y: 0.32 },
      colors: CONFETTI_COLORS,
      scalar: 0.95,
      ticks: 220,
    });
    confetti({
      particleCount: 45,
      angle: 60,
      spread: 60,
      origin: { x: -0.02, y: 0.6 },
      colors: CONFETTI_COLORS,
    });
    confetti({
      particleCount: 45,
      angle: 120,
      spread: 60,
      origin: { x: 1.02, y: 0.6 },
      colors: CONFETTI_COLORS,
    });
  }, []);

  /* ---------------- board interaction (play mode) ---------------- */

  const handleSelect = useCallback((square: Square | null) => {
    setSelected(square);
    if (square) playSound("select");
  }, []);

  const handleMoveAttempt = useCallback(
    (from: Square, to: Square): boolean => {
      if (mode !== "play") return false;
      const scripted = opening.moves[step];
      if (!scripted) return false;

      let candidates: Move[] = [];
      try {
        candidates = gameRef.current
          .moves({ square: from, verbose: true })
          .filter((m) => m.to === to);
      } catch {
        return false;
      }
      if (candidates.length === 0) {
        rejectMove(scripted.san);
        return false;
      }

      // compare normalized SANs (strip check/mate suffixes, auto-queen promos)
      const normalize = (san: string) => san.replace(/[+#]$/, "").replace(/=.+$/, "=Q");
      if (normalize(candidates[0].san) !== normalize(scripted.san)) {
        rejectMove(scripted.san);
        return false;
      }

      // apply — auto-queen whenever a promotion somehow appears
      const chosen = candidates.find((m) => m.promotion === "q") ?? candidates[0];
      let applied: Move;
      try {
        applied = gameRef.current.move(chosen.san);
      } catch {
        return false;
      }

      playSound(applied.captured ? "capture" : "move");
      setFen(gameRef.current.fen());
      setLastMove({ from: applied.from, to: applied.to });
      setSelected(null);
      const nextStep = step + 1;
      setStep(nextStep);

      if (nextStep >= opening.moves.length) {
        setCompleted(true);
        if (!completedRef.current) {
          completedRef.current = true;
          onComplete(opening.id);
          fireConfetti();
        }
      }
      return true;
    },
    [mode, step, opening, onComplete, rejectMove, fireConfetti]
  );

  /* ---------------- auto-reply + watch-mode timers ---------------- */

  // play mode: whenever the next scripted move belongs to the opponent,
  // apply it automatically after a short pause
  useEffect(() => {
    if (mode !== "play") return;
    const scripted = opening.moves[step];
    if (!scripted) return;
    const moverIsWhite = step % 2 === 0;
    if (moverIsWhite === (userColor === "w")) return; // the learner must find it
    const timer = window.setTimeout(() => {
      applyScriptedMove(step);
    }, OPPONENT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [mode, step, userColor, opening, applyScriptedMove]);

  // watch mode: restart the line and auto-play one move every ~950 ms.
  // runs inside event handlers (never in an effect body) so all setState
  // calls happen in response to a user action.
  const startWatch = useCallback(() => {
    watchTimersRef.current.forEach((t) => window.clearTimeout(t));
    const g = new Chess();
    gameRef.current = g;
    setFen(g.fen());
    setSelected(null);
    setLastMove(null);
    setMessage(null);
    setStep(0);
    setMode("watch");
    const timers: number[] = [];
    opening.moves.forEach((_, i) => {
      timers.push(
        window.setTimeout(() => {
          applyScriptedMove(i);
        }, WATCH_INTERVAL_MS * (i + 1))
      );
    });
    watchTimersRef.current = timers;
  }, [opening, applyScriptedMove]);

  // unmount: clear every pending timeout
  useEffect(() => {
    return () => {
      watchTimersRef.current.forEach((t) => window.clearTimeout(t));
      if (messageTimerRef.current !== null) window.clearTimeout(messageTimerRef.current);
    };
  }, []);

  /* ---------------- step controls ---------------- */

  const handleBack = useCallback(() => {
    if (mode !== "play" || step === 0) return;
    resetToStep(step - 1);
  }, [mode, step, resetToStep]);

  const handleForward = useCallback(() => {
    if (mode !== "play" || step >= opening.moves.length) return;
    resetToStep(step + 1, true);
  }, [mode, step, opening.moves.length, resetToStep]);

  const handleReset = useCallback(() => {
    if (mode === "watch") {
      startWatch(); // restart the demonstration from move 0
      return;
    }
    setCompleted(false);
    resetToStep(0);
  }, [mode, resetToStep, startWatch]);

  const handleWatch = startWatch;

  const handleStopWatch = useCallback(() => {
    watchTimersRef.current.forEach((t) => window.clearTimeout(t));
    watchTimersRef.current = [];
    setMode("play");
    resetToStep(0); // play mode always resumes from move 0
  }, [resetToStep]);

  const handlePromote = useCallback(() => {
    // Openings never promote; auto-queen is applied directly in handleMoveAttempt.
  }, []);
  const handleCancelPromotion = useCallback(() => {}, []);
  const handleFirstGesture = useCallback(() => {}, []);

  /* ---------------- derived render data ---------------- */

  const finalMove = opening.moves[opening.moves.length - 1];
  const shownMove = isDone ? finalMove : opening.moves[step];
  const shownSide = isDone ? null : step % 2 === 0 ? "White" : "Black";
  const statusHint = mode === "watch"
    ? "Watch mode — the full line plays itself."
    : isDone
      ? "Line complete — every scripted move played."
      : userToMove
        ? `Your move — find ${opening.side === "White" ? "White" : "Black"}'s next move on the board.`
        : "One moment…";

  return (
    <section
      className="glass-panel rounded-2xl p-4 sm:p-6"
      aria-label={`Opening lesson: ${opening.name}`}
    >
      {/* header */}
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <GraduationCap className="h-5 w-5 shrink-0 text-gold-soft" aria-hidden="true" />
            <h2 className="font-display text-xl leading-tight text-gold-gradient sm:text-2xl">
              {opening.name}
            </h2>
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-widest text-foreground/60">
              {opening.eco}
            </span>
          </div>
          <p className="mt-1 text-xs text-foreground/55 sm:text-sm">
            {opening.tagline} — you play{" "}
            <span className="font-semibold text-gold-soft">{opening.side}</span>.
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className={cn(ghostButton, "h-10 w-10 shrink-0")}
          aria-label="Close lesson"
          onClick={onClose}
        >
          <X />
        </Button>
      </header>

      {/* completion banner */}
      {completed && (
        <motion.div
          initial={{ opacity: 0, y: -6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          role="status"
          className="mt-4 flex flex-wrap items-center gap-2.5 rounded-xl border border-gold/30 bg-gradient-to-r from-gold/15 via-[#38e0af]/10 to-transparent px-4 py-3"
        >
          <GraduationCap className="crown-pop h-5 w-5 shrink-0 text-gold-soft" aria-hidden="true" />
          <span className="flex items-center gap-1.5 text-sm font-semibold text-gold-soft">
            <Check className="h-4 w-4 text-[#38e0af]" aria-hidden="true" />
            Opening mastered
          </span>
          <span className="rounded-full border border-[#38e0af]/40 bg-[#38e0af]/10 px-2 py-0.5 text-[11px] font-bold text-[#38e0af]">
            +10 XP
          </span>
        </motion.div>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:gap-6">
        {/* board column */}
        <div className="mx-auto w-full max-w-[440px] min-w-0 lg:mx-0 lg:max-w-none">
          <motion.div
            animate={shakeControls}
            initial={false}
            className="board-frame relative rounded-2xl p-2 sm:p-2.5"
          >
            <ChessBoard
              pieces={pieces}
              orientation={orientation}
              turnColor={turnColor}
              selected={selected}
              legalTargets={legalTargets}
              lastMove={lastMove}
              checkedSquare={checkedSquare}
              hint={null}
              interactive={mode === "play" && !isDone}
              showLegal
              showCoords
              pendingPromotion={null}
              promotionColor={userColor}
              onSelect={handleSelect}
              onMoveAttempt={handleMoveAttempt}
              onPromote={handlePromote}
              onCancelPromotion={handleCancelPromotion}
              onFirstGesture={handleFirstGesture}
            />
          </motion.div>

          {/* inline feedback */}
          <div className="mt-3 flex min-h-[24px] items-center" aria-live="polite">
            {message ? (
              <p className="text-xs font-medium text-gold-soft">{message}</p>
            ) : (
              <p className="text-xs text-foreground/45">{statusHint}</p>
            )}
          </div>

          {/* progress dots */}
          <div
            className="mt-1 flex items-center gap-2"
            role="progressbar"
            aria-label="Line progress"
            aria-valuemin={0}
            aria-valuemax={opening.moves.length}
            aria-valuenow={Math.min(step, opening.moves.length)}
          >
            <div className="flex items-center gap-1.5" aria-hidden="true">
              {opening.moves.map((mv, i) => (
                <span
                  key={`${mv.san}-${i}`}
                  className={cn(
                    "rounded-full transition-all duration-300",
                    i < step
                      ? "h-2 w-2 bg-gold"
                      : i === step
                        ? "h-2.5 w-2.5 bg-gold/35 ring-2 ring-gold"
                        : "h-2 w-2 bg-white/15"
                  )}
                />
              ))}
            </div>
            <span className="ml-auto text-[11px] tabular-nums text-foreground/45">
              {Math.min(step, opening.moves.length)}/{opening.moves.length}
            </span>
          </div>

          {/* step controls */}
          <div className="mt-3 flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className={cn(ghostButton, "h-10 w-10")}
              aria-label="Step back one move"
              onClick={handleBack}
              disabled={mode === "watch" || step === 0}
            >
              <StepBack />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={cn(ghostButton, "h-10 w-10")}
              aria-label="Step forward one move"
              onClick={handleForward}
              disabled={mode === "watch" || isDone}
            >
              <StepForward />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={cn(ghostButton, "h-10 w-10")}
              aria-label="Reset the line"
              onClick={handleReset}
            >
              <RotateCcw />
            </Button>
            <div className="flex-1" />
            {mode === "play" ? (
              <Button variant="ghost" className={cn(ghostButton, "h-10 px-3")} onClick={handleWatch}>
                <Play />
                Watch the line
              </Button>
            ) : (
              <Button className={cn(goldButton, "h-10 px-4")} onClick={handleStopWatch}>
                <SquareIcon />
                Stop
              </Button>
            )}
          </div>
        </div>

        {/* notes column */}
        <aside className="flex min-w-0 flex-col gap-4">
          {/* current move */}
          <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-foreground/45">
                {isDone ? "Line complete" : `Move ${step + 1} of ${opening.moves.length}`}
              </span>
              {shownSide && (
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-widest text-foreground/55">
                  {shownSide} to play
                </span>
              )}
              {mode === "watch" && (
                <span className="ml-auto flex items-center gap-1.5 rounded-full border border-gold/25 bg-gold/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-gold-soft">
                  <Eye className="h-3 w-3" aria-hidden="true" />
                  Watching
                </span>
              )}
            </div>
            <p className="mt-2 font-display text-4xl leading-none text-gold-gradient sm:text-5xl">
              {shownMove?.san ?? "—"}
            </p>
            <p className="mt-3 text-sm leading-relaxed text-foreground/70">
              {shownMove?.note ?? "You played every move of this line. Reset to run it again."}
            </p>
            {isDone && (
              <Button className={cn(goldButton, "mt-4 h-10 px-4")} onClick={handleReset}>
                <RotateCcw />
                Start over
              </Button>
            )}
          </div>

          {/* key ideas */}
          <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4 sm:p-5">
            <h3 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-gold-soft/90">
              <Lightbulb className="h-4 w-4" aria-hidden="true" />
              Key ideas
            </h3>
            <ul className="mt-3 flex flex-wrap gap-2">
              {opening.ideas.map((idea) => (
                <li
                  key={idea}
                  className="rounded-full border border-gold/25 bg-gold/10 px-2.5 py-1 text-[11px] font-medium text-gold-soft"
                >
                  {idea}
                </li>
              ))}
            </ul>
          </div>

          {/* motto */}
          <blockquote className="flex items-start gap-3 rounded-xl border border-white/8 bg-white/[0.03] p-4 sm:p-5">
            <Quote className="mt-0.5 h-4 w-4 shrink-0 text-gold-soft/70" aria-hidden="true" />
            <p className="font-display text-sm italic leading-relaxed text-foreground/75">
              {opening.motto}
            </p>
          </blockquote>
        </aside>
      </div>
    </section>
  );
}
