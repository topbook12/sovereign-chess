"use client";

/**
 * MiniBoard — a read-only chess board used by lessons and drills.
 * Wraps the full ChessBoard with sensible static defaults.
 */

import { useMemo } from "react";
import { Chess } from "chess.js";
import type { Square } from "chess.js";
import { ChessBoard } from "./board";
import { fenToPieces } from "@/lib/chess-utils";

export function MiniBoard({
  fen,
  lastMove,
  orientation = "white",
  showCoords = true,
  className,
}: {
  fen: string;
  lastMove?: { from: Square; to: Square } | null;
  orientation?: "white" | "black";
  showCoords?: boolean;
  className?: string;
}) {
  const pieces = useMemo(() => fenToPieces(fen), [fen]);
  const turn = fen.split(" ")[1] === "b" ? "b" : "w";

  const checkedSquare = useMemo<Square | null>(() => {
    try {
      const g = new Chess(fen);
      if (!g.isCheck()) return null;
      for (const row of g.board()) {
        for (const sq of row) {
          if (sq && sq.type === "k" && sq.color === g.turn()) return sq.square;
        }
      }
    } catch {
      /* ignore invalid fen */
    }
    return null;
  }, [fen]);

  return (
    <div className={className}>
      <ChessBoard
        pieces={pieces}
        orientation={orientation}
        turnColor={turn}
        selected={null}
        legalTargets={[]}
        lastMove={lastMove ?? null}
        checkedSquare={checkedSquare}
        hint={null}
        interactive={false}
        showLegal={false}
        showCoords={showCoords}
        pendingPromotion={null}
        promotionColor={turn}
        onSelect={() => {}}
        onMoveAttempt={() => false}
        onPromote={() => {}}
        onCancelPromotion={() => {}}
        onFirstGesture={() => {}}
      />
    </div>
  );
}
