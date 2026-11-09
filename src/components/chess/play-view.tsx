"use client";

/**
 * PlayView — the arena: play vs the Grandmaster or a friend, full rules,
 * clocks, hints and a post-game gateway into the analysis room.
 */

import { useEffect, useState } from "react";
import confetti from "canvas-confetti";
import {
  Lightbulb,
  ListOrdered,
  Maximize2,
  Minimize2,
  Repeat,
  Timer,
  Undo2,
  X,
} from "lucide-react";
import type { Difficulty } from "@/hooks/use-chess-game";
import { ChessBoard } from "@/components/chess/board";
import { EvalBar, PlayerStrip } from "@/components/chess/panels";
import {
  ControlsCard,
  EngineCard,
  ModeBadge,
  MovesCard,
  PrefsCard,
} from "@/components/chess/sidebars";
import { DrawOfferDialog } from "@/components/chess/dialogs";
import { StatusStrip } from "@/components/chess/chrome";
import { pulse } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import type { ChessGame } from "@/hooks/use-chess-game";

const CONFETTI_COLORS = ["#e9c96b", "#c9a24b", "#38e0af", "#fdf6dc", "#1c5a48"];

const LEVEL_LABELS: Record<Difficulty, string> = {
  easy: "Apprentice",
  medium: "Knight",
  hard: "Grandmaster",
  master: "Sovereign",
};

/* thumb-sized icon control for the Focus arena — module scope so React
   never remounts it (and lint keeps trusting the arena). */
function FocusCtl({
  label,
  onClick,
  children,
  gold = false,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  gold?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        pulse("tick");
        onClick();
      }}
      className={cn(
        "flex h-12 w-12 items-center justify-center rounded-2xl border transition-all active:scale-90",
        gold
          ? "border-[#8a6a24]/60 bg-gradient-to-b from-[#ecca6f] to-[#c69c3f] text-[#241a05] shadow-[0_0_22px_-6px_rgba(212,175,55,0.8)]"
          : "glass-panel text-foreground/80 hover:border-gold/40 hover:text-gold-soft"
      )}
    >
      {children}
    </button>
  );
}

export function PlayView({
  game,
  onRequestNewGame,
  focus = false,
  onToggleFocus,
}: {
  game: ChessGame;
  onRequestNewGame: () => void;
  /** immersive arena — the board owns the screen, everything else fades away */
  focus?: boolean;
  onToggleFocus?: () => void;
}) {
  const [movesOpen, setMovesOpen] = useState(false);
  // celebrate wins (async — keeps the effect body free of cascading renders)
  useEffect(() => {
    if (game.status !== "ended" || !game.result) return;
    const winner = game.result.winner;
    const celebrate =
      winner !== null && (game.mode === "human" || winner === game.humanColor);
    if (!celebrate) return;
    const t = window.setTimeout(() => {
      confetti({
        particleCount: 170,
        spread: 110,
        startVelocity: 42,
        origin: { y: 0.22 },
        colors: CONFETTI_COLORS,
        scalar: 1.05,
        ticks: 240,
      });
      confetti({
        particleCount: 90,
        angle: 62,
        spread: 68,
        origin: { x: -0.02, y: 0.5 },
        colors: CONFETTI_COLORS,
      });
      confetti({
        particleCount: 90,
        angle: 118,
        spread: 68,
        origin: { x: 1.02, y: 0.5 },
        colors: CONFETTI_COLORS,
      });
    }, 380);
    return () => window.clearTimeout(t);
  }, [game.status, game.result, game.mode, game.humanColor]);

  const unlimited = game.activeTimeControl.initialMs === 0;
  const topColor = game.orientation === "white" ? "black" : "white";
  const bottomColor = topColor === "white" ? "black" : "white";

  const stripFor = (color: "white" | "black") => {
    const isEngineSide = game.mode === "ai" && color !== game.humanColor;
    const name =
      game.mode === "ai"
        ? isEngineSide
          ? "The Grandmaster"
          : "You"
        : color === "white"
          ? "White"
          : "Black";
    const badge = game.mode === "ai" ? (isEngineSide ? LEVEL_LABELS[game.difficulty] : "Challenger") : undefined;
    const captured = color === "white" ? game.capturedBy.byWhite : game.capturedBy.byBlack;
    const materialDiff = color === "white" ? game.capturedBy.diff : -game.capturedBy.diff;
    const clockMs = color === "white" ? game.clocks.w : game.clocks.b;
    const active = game.status === "active" && game.turn === (color === "white" ? "w" : "b");
    return {
      name,
      badge,
      color,
      captured,
      materialDiff,
      clockMs,
      unlimited,
      active,
      thinking: isEngineSide && game.thinking,
    };
  };

  /* -------- the framed arena board, shared by both layouts -------- */
  const board = (framePad: string) => (
    <div className={cn("board-frame relative rounded-2xl", framePad)}>
      {/* corner ornaments */}
      <span className="pointer-events-none absolute -left-0.5 -top-0.5 h-3 w-3 rounded-tl-2xl border-l-2 border-t-2 border-[#fbeec1]/70" />
      <span className="pointer-events-none absolute -right-0.5 -top-0.5 h-3 w-3 rounded-tr-2xl border-r-2 border-t-2 border-[#fbeec1]/70" />
      <span className="pointer-events-none absolute -bottom-0.5 -left-0.5 h-3 w-3 rounded-bl-2xl border-b-2 border-l-2 border-[#fbeec1]/70" />
      <span className="pointer-events-none absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-br-2xl border-b-2 border-r-2 border-[#fbeec1]/70" />

      <div className="relative overflow-hidden rounded-md shadow-[inset_0_0_24px_rgba(0,0,0,0.55)]">
        <ChessBoard
          pieces={game.pieces}
          orientation={game.orientation}
          turnColor={game.turn}
          selected={game.selected}
          legalTargets={game.legalForSelected}
          lastMove={game.lastMove}
          checkedSquare={game.checkedSquare}
          hint={game.hint}
          interactive={game.interactive}
          showLegal={game.showLegal}
          showCoords={game.showCoords}
          pendingPromotion={game.pendingPromotion}
          promotionColor={game.turn}
          onSelect={game.selectSquare}
          onMoveAttempt={game.attemptMove}
          onPromote={game.promote}
          onCancelPromotion={game.cancelPromotion}
          onFirstGesture={game.primeAudioOnGesture}
        />
      </div>
    </div>
  );

  /* ================= FOCUS ARENA — the board owns the screen ================= */
  if (focus) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-2"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex w-[min(96vw,calc(100dvh-14rem))] flex-col gap-2">
          <PlayerStrip {...stripFor(topColor)} />
          {board("p-1.5")}
          <PlayerStrip {...stripFor(bottomColor)} />
        </div>

        {/* thumb bar — every control ≥48px, one reach from the board */}
        <div className="flex items-center gap-2.5">
          <FocusCtl
            label="Exit Focus Mode"
            gold
            onClick={() => onToggleFocus?.()}
          >
            <Minimize2 className="h-5 w-5" />
          </FocusCtl>
          <FocusCtl label="Undo move" onClick={game.undo}>
            <Undo2 className="h-5 w-5" />
          </FocusCtl>
          <FocusCtl label="Ask for a hint" onClick={() => void game.requestHint()}>
            <Lightbulb className="h-5 w-5" />
          </FocusCtl>
          <FocusCtl label="Move history" onClick={() => setMovesOpen(true)}>
            <ListOrdered className="h-5 w-5" />
          </FocusCtl>
          <FocusCtl label="Flip board" onClick={game.flipBoard}>
            <Repeat className="h-5 w-5" />
          </FocusCtl>
        </div>

        {/* move history overlay — glass island above the arena */}
        {movesOpen && (
          <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]"
            role="dialog"
            aria-label="Move history"
            onClick={() => setMovesOpen(false)}
          >
            <div
              className="glass-dialog w-[min(92vw,26rem)] rounded-2xl p-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="font-display text-sm font-bold tracking-[0.14em] text-gold-soft">
                  MOVE HISTORY
                </span>
                <FocusCtl
                  label="Close history"
                  onClick={() => setMovesOpen(false)}
                >
                  <X className="h-5 w-5" />
                </FocusCtl>
              </div>
              <div className="scroll-slim max-h-[56dvh] overflow-y-auto pr-1">
                <MovesCard game={game} />
              </div>
            </div>
          </div>
        )}

        <DrawOfferDialog game={game} />
      </div>
    );
  }

  /* ================= FULL LAYOUT — arena + wings ================= */
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,290px)_minmax(0,1fr)_minmax(0,290px)] lg:items-start">
      {/* ------- left: controls + oracle ------- */}
      <div className="order-2 space-y-4 lg:order-1">
        <ControlsCard game={game} onNewGame={onRequestNewGame} />
        <EngineCard game={game} />
      </div>

      {/* ------- center: the arena ------- */}
      <div className="order-1 flex flex-col items-center gap-3 lg:order-2">
        <div className="flex items-center gap-2">
          <ModeBadge mode={game.mode} />
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold text-foreground/60">
            <Timer className="h-3.5 w-3.5 text-gold-soft/80" />
            {game.activeTimeControl.label}
          </span>
          {onToggleFocus && (
            <button
              type="button"
              onClick={() => {
                pulse("achievement");
                onToggleFocus();
              }}
              aria-label="Enter Focus Mode — the board takes the whole screen"
              title="Focus Mode (Esc to exit)"
              className="flex items-center gap-1.5 rounded-full border border-gold/30 bg-gradient-to-b from-gold/15 to-transparent px-3 py-1 text-[11px] font-semibold text-gold-soft transition-colors hover:border-gold/60"
            >
              <Maximize2 className="h-3.5 w-3.5" />
              Focus
            </button>
          )}
        </div>

        <div className="w-full max-w-[600px] space-y-2.5">
          <PlayerStrip {...stripFor(topColor)} />

          <StatusStrip game={game} />

          {board("p-2 sm:p-2.5")}

          <EvalBar
            evalCp={game.engineInfo?.evalCp ?? null}
            mateIn={game.engineInfo?.mateIn}
          />

          <PlayerStrip {...stripFor(bottomColor)} />
        </div>
      </div>

      {/* ------- right: moves + ambience ------- */}
      <div className="order-3 space-y-4 lg:order-3">
        <MovesCard game={game} />
        <PrefsCard game={game} />
      </div>

      <DrawOfferDialog game={game} />

      {/* subtle gold top glow */}
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none fixed inset-x-0 top-0 z-[5] h-40",
          "bg-[radial-gradient(ellipse_60%_100%_at_50%_0%,rgba(212,175,55,0.08),transparent_70%)]"
        )}
      />
    </div>
  );
}
