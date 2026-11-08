"use client";

/**
 * PlayView — the arena: play vs the Grandmaster or a friend, full rules,
 * clocks, hints and a post-game gateway into the analysis room.
 */

import { useEffect, useState } from "react";
import confetti from "canvas-confetti";
import { Timer } from "lucide-react";
import { Chess } from "chess.js";
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
import {
  DrawOfferDialog,
  GameOverDialog,
} from "@/components/chess/dialogs";
import { StatusStrip } from "@/components/chess/chrome";
import { saveRecentGame, type StoredGame } from "@/lib/game-store";
import { cn } from "@/lib/utils";
import type { ChessGame } from "@/hooks/use-chess-game";

const LEVEL_LABELS: Record<Difficulty, string> = {
  easy: "Apprentice",
  medium: "Knight",
  hard: "Grandmaster",
  master: "Sovereign",
};

const CONFETTI_COLORS = ["#e9c96b", "#c9a24b", "#38e0af", "#fdf6dc", "#1c5a48"];

export function PlayView({
  game,
  onAnalyzeGame,
  onRequestNewGame,
}: {
  game: ChessGame;
  onAnalyzeGame: (g: StoredGame) => void;
  onRequestNewGame: () => void;
}) {
  // game-over modal is derived from game state; `dismissedKey` remembers which
  // finished game the user closed so the modal never re-appears mid-review
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const resultKey = game.result
    ? `${game.result.reason}-${game.result.winner ?? "none"}-${game.history.length}`
    : null;
  const gameOverOpen =
    game.status === "ended" && game.result !== null && resultKey !== dismissedKey;

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

  /** serialize the finished game into the learning store */
  const analyzeCurrentGame = () => {
    if (!game.result || game.history.length === 0) return;
    try {
      const c = new Chess();
      for (const m of game.history) {
        c.move({ from: m.from, to: m.to, promotion: m.promotion });
      }
      const resultStr =
        game.result.winner === "white" ? "1-0" : game.result.winner === "black" ? "0-1" : "1/2-1/2";
      c.header(
        "Event",
        "Sovereign Chess",
        "White",
        game.mode === "ai" && game.humanColor !== "white" ? "The Grandmaster" : "White",
        "Black",
        game.mode === "ai" && game.humanColor !== "black" ? "The Grandmaster" : "Black",
        "Result",
        resultStr
      );
      const label =
        game.mode === "ai"
          ? `You vs The Grandmaster (${LEVEL_LABELS[game.difficulty]})`
          : "White vs Black — two players";
      const stored = saveRecentGame({
        pgn: c.pgn(),
        plies: game.history.length,
        result: resultStr,
        label,
        reason: game.result.reason,
      });
      onAnalyzeGame(stored);
    } catch {
      /* serialization hiccup — non-fatal */
    }
  };

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
        </div>

        <div className="w-full max-w-[600px] space-y-2.5">
          <PlayerStrip {...stripFor(topColor)} />

          <StatusStrip game={game} />

          <div className="board-frame relative rounded-2xl p-2 sm:p-2.5">
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

      <GameOverDialog
        open={gameOverOpen}
        onOpenChange={(v) => {
          if (!v) setDismissedKey(resultKey);
        }}
        game={game}
        onAnalyze={analyzeCurrentGame}
      />
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
