"use client";

/**
 * LearnView — the academy: tactics puzzles, the Queen-mate endgame drill
 * and interactive opening lessons, all wired into the student profile.
 */

import { useCallback, useEffect, useState } from "react";
import { useAnimationControls, motion } from "framer-motion";
import confetti from "canvas-confetti";
import { Chess, type Move, type Square } from "chess.js";
import {
  BookOpen,
  Brain,
  CheckCircle2,
  Crown,
  Eye,
  Flame,
  GraduationCap,
  Lightbulb,
  Pause,
  Play,
  RotateCcw,
  SkipForward,
  Swords,
  Target,
  Trophy,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ChessBoard } from "@/components/chess/board";
import { OpeningsLesson } from "@/components/chess/openings-lesson";
import { usePuzzles } from "@/hooks/use-puzzles";
import { useDrill } from "@/hooks/use-drill";
import { OPENINGS, PUZZLES, type Opening } from "@/lib/puzzles";
import { levelFromXp, loadProfile, updateProfile, type LearningProfile } from "@/lib/game-store";
import { cn } from "@/lib/utils";

const CONFETTI_COLORS = ["#e9c96b", "#c9a24b", "#38e0af", "#fdf6dc"];

type LearnTab = "puzzles" | "drill" | "openings";

const TIER_STYLE: Record<string, string> = {
  easy: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  medium: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  hard: "border-rose-400/40 bg-rose-400/10 text-rose-300",
};

export function LearnView() {
  const [tab, setTab] = useState<LearnTab>("puzzles");
  const [profile, setProfile] = useState<LearningProfile | null>(null);
  const [openOpening, setOpenOpening] = useState<Opening | null>(null);

  // the panels own their game hooks; the header follows the shared profile
  useEffect(() => {
    const t = window.setTimeout(() => setProfile(loadProfile()), 0);
    const iv = window.setInterval(() => setProfile(loadProfile()), 1500);
    return () => {
      window.clearInterval(iv);
      window.clearTimeout(t);
    };
  }, []);

  const lvl = levelFromXp(profile?.xp ?? 0);

  const handleOpeningComplete = (id: string) => {
    setProfile(
      updateProfile((prev) => ({
        ...prev,
        xp: prev.xp + 10,
        openingsDone: prev.openingsDone.includes(id) ? prev.openingsDone : [...prev.openingsDone, id],
      }))
    );
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      {/* ---------- student profile ---------- */}
      <div className="glass-panel rounded-2xl p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-3">
            <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-gold/40 bg-gradient-to-b from-gold/25 to-transparent">
              <GraduationCap className="h-7 w-7 text-gold-soft" strokeWidth={1.6} />
              <span className="absolute -bottom-1.5 -right-1.5 rounded-full border border-[#8a6a24] bg-gradient-to-b from-[#ecca6f] to-[#c69c3f] px-1.5 py-px font-mono text-[10px] font-black text-[#241a05]">
                {lvl.level}
              </span>
            </div>
            <div>
              <p className="font-display text-lg font-black tracking-wide text-gold-gradient">
                {lvl.title}
              </p>
              <p className="text-[11px] text-foreground/45">
                {lvl.into}/{lvl.span} XP to level {lvl.level + 1}
              </p>
            </div>
          </div>

          <div className="min-w-[160px] flex-1">
            <Progress value={(lvl.into / lvl.span) * 100} className="h-2" />
          </div>

          <div className="flex items-center gap-4 text-center">
            <MiniStat
              icon={<Flame className="h-4 w-4 text-orange-300" />}
              value={profile?.puzzleStreak ?? 0}
              label="Streak"
            />
            <MiniStat
              icon={<Brain className="h-4 w-4 text-emerald-300" />}
              value={`${profile?.solvedPuzzles.length ?? 0}/${PUZZLES.length}`}
              label="Puzzles"
            />
            <MiniStat
              icon={<Crown className="h-4 w-4 text-gold-soft" />}
              value={profile?.drillWins ?? 0}
              label="Drills"
            />
            <MiniStat
              icon={<BookOpen className="h-4 w-4 text-gold-soft/80" />}
              value={`${profile?.openingsDone.length ?? 0}/${OPENINGS.length}`}
              label="Openings"
            />
          </div>
        </div>
      </div>

      {/* ---------- tab switcher ---------- */}
      <div className="flex justify-center">
        <div className="glass-panel inline-flex rounded-full p-1">
          {(
            [
              { id: "puzzles", label: "Puzzles", icon: <Brain className="h-4 w-4" /> },
              { id: "drill", label: "Endgame Drill", icon: <Swords className="h-4 w-4" /> },
              { id: "openings", label: "Openings", icon: <BookOpen className="h-4 w-4" /> },
            ] as { id: LearnTab; label: string; icon: React.ReactNode }[]
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTab(t.id);
                setOpenOpening(null);
              }}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold transition-all",
                tab === t.id
                  ? "border border-[#8a6a24]/50 bg-gradient-to-b from-[#ecca6f] to-[#c69c3f] text-[#241a05]"
                  : "text-foreground/60 hover:text-foreground"
              )}
              aria-pressed={tab === t.id}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ---------- content ---------- */}
      {tab === "puzzles" && <PuzzlesPanel key="puzzles" />}
      {tab === "drill" && <DrillPanel key="drill" />}
      {tab === "openings" && (
        <OpeningsPanel
          key="openings"
          openOpening={openOpening}
          setOpenOpening={setOpenOpening}
          onComplete={handleOpeningComplete}
          done={profile?.openingsDone ?? []}
        />
      )}
    </div>
  );
}

function MiniStat({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: number | string;
  label: string;
}) {
  return (
    <div className="flex flex-col items-center">
      <span className="flex items-center gap-1 font-mono text-base font-bold text-foreground/90">
        {icon}
        {value}
      </span>
      <span className="text-[9.5px] font-semibold uppercase tracking-[0.18em] text-foreground/40">
        {label}
      </span>
    </div>
  );
}

/**
 * Local board selection for learn-mode boards (tap-to-move + drag reveal).
 * Mirrors the play-room selection semantics against a read-only FEN.
 */
function useBoardSelection(
  fen: string,
  onMove: (from: Square, to: Square) => boolean
) {
  const [selected, setSelected] = useState<Square | null>(null);
  const [legal, setLegal] = useState<Move[]>([]);

  const select = useCallback(
    (sq: Square | null) => {
      if (!sq || selected === sq) {
        setSelected(null);
        setLegal([]);
        return;
      }
      const g = new Chess(fen);
      const piece = g.get(sq);
      if (piece && piece.color === g.turn()) {
        setSelected(sq);
        setLegal(g.moves({ square: sq, verbose: true }));
        return;
      }
      if (selected && legal.some((m) => m.to === sq)) {
        if (onMove(selected, sq)) {
          setSelected(null);
          setLegal([]);
        }
        return;
      }
      setSelected(null);
      setLegal([]);
    },
    [selected, legal, fen, onMove]
  );

  return { selected, legal, select };
}

/* ============================ puzzles ============================ */

function PuzzlesPanel() {
  const pz = usePuzzles();
  const shake = useAnimationControls();
  const sel = useBoardSelection(pz.fen, pz.attemptMove);

  useEffect(() => {
    if (pz.wrongTick > 0) {
      void shake.start({ x: [0, -9, 9, -6, 6, 0] });
    }
  }, [pz.wrongTick, shake]);

  useEffect(() => {
    if (pz.status === "solved") {
      window.setTimeout(() => {
        confetti({
          particleCount: 90,
          spread: 90,
          startVelocity: 34,
          origin: { y: 0.35 },
          colors: CONFETTI_COLORS,
          scalar: 0.9,
        });
      }, 250);
    }
  }, [pz.status]);

  const p = pz.puzzle;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)] lg:items-start">
      <motion.div animate={shake} className="mx-auto w-full max-w-[440px]">
        <div className="board-frame relative rounded-2xl p-2 sm:p-2.5">
          <span className="pointer-events-none absolute -left-0.5 -top-0.5 h-3 w-3 rounded-tl-2xl border-l-2 border-t-2 border-[#fbeec1]/70" />
          <span className="pointer-events-none absolute -right-0.5 -top-0.5 h-3 w-3 rounded-tr-2xl border-r-2 border-t-2 border-[#fbeec1]/70" />
          <span className="pointer-events-none absolute -bottom-0.5 -left-0.5 h-3 w-3 rounded-bl-2xl border-b-2 border-l-2 border-[#fbeec1]/70" />
          <span className="pointer-events-none absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-br-2xl border-b-2 border-r-2 border-[#fbeec1]/70" />
          <div className="relative overflow-hidden rounded-md shadow-[inset_0_0_24px_rgba(0,0,0,0.55)]">
            <ChessBoard
              pieces={pz.pieces}
              orientation={pz.turn === "w" ? "white" : "black"}
              turnColor={pz.turn === "b" ? "b" : "w"}
              selected={sel.selected}
              legalTargets={sel.legal}
              lastMove={null}
              checkedSquare={null}
              hint={pz.hintFrom ? { from: pz.hintFrom, to: pz.hintFrom } : null}
              interactive={pz.status === "solving"}
              showLegal
              showCoords
              pendingPromotion={null}
              promotionColor={pz.turn === "b" ? "b" : "w"}
              onSelect={sel.select}
              onMoveAttempt={(from, to) => pz.attemptMove(from, to)}
              onPromote={() => {}}
              onCancelPromotion={() => {}}
              onFirstGesture={() => {}}
            />
          </div>
        </div>
      </motion.div>

      <div className="space-y-4">
        <div className="glass-panel rounded-2xl p-4 sm:p-5">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-[10.5px] font-black uppercase tracking-[0.14em]",
                TIER_STYLE[p.tier]
              )}
            >
              {p.tier}
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-foreground/55">
              {p.theme}
            </span>
            <span className="ml-auto font-mono text-[11px] text-foreground/35">
              {pz.idx + 1} / {pz.total}
            </span>
          </div>

          <h3 className="font-display text-xl font-bold text-foreground/95">{p.title}</h3>
          <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-gold-soft">
            <Target className="h-3.5 w-3.5" /> {p.goal}
          </p>

          {/* status zone */}
          <div className="mt-3">
            {pz.status === "solving" && (
              <p className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-[13px] leading-relaxed text-foreground/60">
                {puzzleStepText(pz)}
              </p>
            )}
            {pz.status === "solved" && (
              <div className="float-in rounded-xl border border-emerald-400/35 bg-emerald-400/10 px-3 py-2.5">
                <p className="flex items-center gap-1.5 text-[13px] font-bold text-emerald-300">
                  <Trophy className="h-4 w-4" /> Solved — +5 XP
                </p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-foreground/65">{p.insight}</p>
              </div>
            )}
            {pz.status === "failed" && (
              <div className="float-in rounded-xl border border-rose-400/35 bg-rose-400/10 px-3 py-2.5">
                <p className="flex items-center gap-1.5 text-[13px] font-bold text-rose-300">
                  <X className="h-4 w-4" /> Not that move — the streak resets.
                </p>
                <p className="mt-1 text-[12.5px] text-foreground/60">
                  Study the position once more, take the hint, or watch the idea unfold.
                </p>
              </div>
            )}
            {pz.status === "revealed" && (
              <div className="float-in rounded-xl border border-gold/35 bg-gold/10 px-3 py-2.5">
                <p className="flex items-center gap-1.5 text-[13px] font-bold text-gold-soft">
                  <Eye className="h-4 w-4" /> Watching the solution
                </p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-foreground/65">{p.insight}</p>
              </div>
            )}
          </div>

          {/* actions */}
          <div className="mt-4 flex flex-wrap gap-2">
            {pz.status === "solved" ? (
              <Button
                onClick={pz.nextPuzzle}
                className="h-10 flex-1 border border-[#8a6a24]/50 bg-gradient-to-b from-[#ecca6f] to-[#c69c3f] font-bold text-[#241a05] hover:from-[#f3d887] hover:to-[#d4a94e]"
              >
                <SkipForward className="mr-1.5 h-4 w-4" /> Next puzzle
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={pz.showHint}
                  disabled={pz.status !== "solving"}
                  className="h-10 flex-1 border-white/10 bg-white/5 text-[13px] hover:bg-white/10"
                >
                  <Lightbulb className="mr-1.5 h-4 w-4 text-gold-soft" /> Hint
                </Button>
                <Button
                  variant="outline"
                  onClick={pz.revealSolution}
                  className="h-10 flex-1 border-white/10 bg-white/5 text-[13px] hover:bg-white/10"
                >
                  <Eye className="mr-1.5 h-4 w-4" /> Solution
                </Button>
                <Button
                  variant="outline"
                  onClick={pz.nextPuzzle}
                  className="h-10 flex-1 border-white/10 bg-white/5 text-[13px] hover:bg-white/10"
                >
                  <SkipForward className="mr-1.5 h-4 w-4" /> Skip
                </Button>
              </>
            )}
          </div>
          {(pz.status === "failed" || pz.status === "revealed") && (
            <Button
              variant="outline"
              onClick={pz.retryPuzzle}
              className="mt-2 h-10 w-full border-white/10 bg-white/5 text-[13px] hover:bg-white/10"
            >
              <RotateCcw className="mr-1.5 h-4 w-4" /> Try again from the start
            </Button>
          )}
        </div>

        <div className="glass-panel rounded-2xl p-4">
          <p className="mb-2 flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.16em] text-foreground/45">
            <Lightbulb className="h-3.5 w-3.5 text-gold-soft/70" /> Nudge
          </p>
          <p className="text-[13px] leading-relaxed text-foreground/60">{p.hint}</p>
        </div>
      </div>
    </div>
  );
}

function puzzleStepText(pz: ReturnType<typeof usePuzzles>): string {
  const line = pz.puzzle.lines[0];
  const total = line.userMoves.length;
  if (total === 1) return "One move wins. Find it and play it on the board.";
  return `Find the winning sequence — move ${Math.min(pz.step + 1, total)} of ${total}. Take your time.`;
}

/* ============================ drill ============================ */

function DrillPanel() {
  const dr = useDrill();
  const interactive = dr.status === "playing" && !dr.thinking && dr.turn === "w";
  const sel = useBoardSelection(dr.fen, (from, to) => dr.attemptMove(from, to));

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)] lg:items-start">
      <div className="mx-auto w-full max-w-[440px]">
        <div className="board-frame relative rounded-2xl p-2 sm:p-2.5">
          <span className="pointer-events-none absolute -left-0.5 -top-0.5 h-3 w-3 rounded-tl-2xl border-l-2 border-t-2 border-[#fbeec1]/70" />
          <span className="pointer-events-none absolute -right-0.5 -top-0.5 h-3 w-3 rounded-tr-2xl border-r-2 border-t-2 border-[#fbeec1]/70" />
          <span className="pointer-events-none absolute -bottom-0.5 -left-0.5 h-3 w-3 rounded-bl-2xl border-b-2 border-l-2 border-[#fbeec1]/70" />
          <span className="pointer-events-none absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-br-2xl border-b-2 border-r-2 border-[#fbeec1]/70" />
          <div className="relative overflow-hidden rounded-md shadow-[inset_0_0_24px_rgba(0,0,0,0.55)]">
            <ChessBoard
              pieces={dr.pieces}
              orientation="white"
              turnColor={dr.turn === "b" ? "b" : "w"}
              selected={sel.selected}
              legalTargets={sel.legal}
              lastMove={dr.lastMove}
              checkedSquare={null}
              hint={null}
              interactive={interactive}
              showLegal
              showCoords
              pendingPromotion={null}
              promotionColor={dr.turn === "b" ? "b" : "w"}
              onSelect={sel.select}
              onMoveAttempt={(from, to) => dr.attemptMove(from, to)}
              onPromote={() => {}}
              onCancelPromotion={() => {}}
              onFirstGesture={() => {}}
            />
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="glass-panel rounded-2xl p-4 sm:p-5">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-gold/40 bg-gold/10 px-2.5 py-0.5 text-[10.5px] font-black uppercase tracking-[0.14em] text-gold-soft">
              Technique
            </span>
            <span className="ml-auto font-mono text-[11px] text-foreground/40">
              Your moves: <b className="text-gold-soft">{dr.moveCount}</b>
            </span>
          </div>
          <h3 className="font-display text-xl font-bold text-foreground/95">
            Checkmate with King &amp; Queen
          </h3>
          <p className="mt-1 text-[13px] leading-relaxed text-foreground/60">
            You command <b className="text-foreground/85">White</b>. Corner the lone king using the
            golden rule: <i className="text-gold-soft">the king walks in front, the queen delivers from a
            distance.</i>{" "}
            Stalemate is a fail — give the enemy king room to breathe until the final blow.
          </p>

          <div className="mt-3">
            {dr.status === "playing" && (
              <p className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-[13px] text-foreground/60">
                {dr.thinking ? (
                  <>
                    <Pause className="h-3.5 w-3.5 text-emerald-300" />
                    The king slips away…
                  </>
                ) : (
                  <>
                    <Play className="h-3.5 w-3.5 text-emerald-300" />
                    Your move — march the king and queen together.
                  </>
                )}
              </p>
            )}
            {dr.status === "won" && (
              <div className="float-in rounded-xl border border-emerald-400/35 bg-emerald-400/10 px-3 py-2.5">
                <p className="flex items-center gap-1.5 text-[13px] font-bold text-emerald-300">
                  <CheckCircle2 className="h-4 w-4" /> Checkmate in {dr.moveCount} moves — +8 XP!
                </p>
                <p className="mt-1 text-[12.5px] text-foreground/60">
                  {dr.profile?.drillBest !== null && dr.profile?.drillBest !== undefined
                    ? `Your record: ${dr.profile.drillBest} moves.`
                    : ""}{" "}
                  The basic K+Q mate usually takes 10 or fewer.
                </p>
              </div>
            )}
            {dr.status === "drawn" && (
              <div className="float-in rounded-xl border border-rose-400/35 bg-rose-400/10 px-3 py-2.5">
                <p className="flex items-center gap-1.5 text-[13px] font-bold text-rose-300">
                  <X className="h-4 w-4" /> Stalemate — the king escaped with a draw.
                </p>
                <p className="mt-1 text-[12.5px] text-foreground/60">
                  Keep the enemy king constrained to ever-smaller boxes, one rank or file at a time.
                </p>
              </div>
            )}
          </div>

          <Button
            onClick={dr.restart}
            className="mt-4 h-10 w-full border border-[#8a6a24]/50 bg-gradient-to-b from-[#ecca6f] to-[#c69c3f] font-bold text-[#241a05] hover:from-[#f3d887] hover:to-[#d4a94e]"
          >
            <RotateCcw className="mr-1.5 h-4 w-4" />
            {dr.status === "playing" ? "New random position" : "Try again"}
          </Button>
        </div>

        <div className="glass-panel rounded-2xl p-4">
          <p className="mb-2 flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.16em] text-foreground/45">
            <Lightbulb className="h-3.5 w-3.5 text-gold-soft/70" /> The box method
          </p>
          <ul className="space-y-1.5 text-[13px] leading-relaxed text-foreground/60">
            <li>1. Shrink the box: use the queen to cut off a rank or a file.</li>
            <li>2. Bring the king closer — the king does half the mating work.</li>
            <li>3. When the enemy king sits on the edge, deliver with stalemate-avoiding checks.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

/* ============================ openings ============================ */

function OpeningsPanel({
  openOpening,
  setOpenOpening,
  onComplete,
  done,
}: {
  openOpening: Opening | null;
  setOpenOpening: (o: Opening | null) => void;
  onComplete: (id: string) => void;
  done: string[];
}) {
  if (openOpening) {
    return (
      <OpeningsLesson
        opening={openOpening}
        onClose={() => setOpenOpening(null)}
        onComplete={onComplete}
      />
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {OPENINGS.map((o) => {
        const completed = done.includes(o.id);
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => setOpenOpening(o)}
            className="glass-panel glass-panel-hover group rounded-2xl p-5 text-left"
          >
            <div className="mb-2 flex items-center gap-2">
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[10px] tracking-widest text-foreground/50">
                {o.eco}
              </span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.14em]",
                  o.side === "White"
                    ? "border border-gold/40 bg-gold/10 text-gold-soft"
                    : "border border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                )}
              >
                for {o.side}
              </span>
              {completed && (
                <span className="ml-auto flex items-center gap-1 text-[11px] font-bold text-emerald-300">
                  <CheckCircle2 className="h-3.5 w-3.5" /> mastered
                </span>
              )}
            </div>
            <h3 className="font-display text-lg font-bold text-foreground/95 transition-colors group-hover:text-gold-soft">
              {o.name}
            </h3>
            <p className="mt-0.5 text-[12.5px] text-foreground/50">{o.tagline}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {o.moves.slice(0, 4).map((m, i) => (
                <span
                  key={i}
                  className="rounded-md border border-white/8 bg-white/[0.04] px-2 py-0.5 font-mono text-[11px] text-foreground/70"
                >
                  {m.san}
                </span>
              ))}
              {o.moves.length > 4 && (
                <span className="px-1 py-0.5 text-[11px] text-foreground/35">
                  +{o.moves.length - 4} more
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
