/**
 * Shared chess helpers used across play, analysis and learning views.
 */

import { Chess, type Color, type PieceSymbol, type Square } from "chess.js";
import { saveRecentGame, type StoredGame } from "@/lib/game-store";

export interface PieceView {
  id: string;
  square: Square;
  type: PieceSymbol;
  color: Color;
  captured?: boolean;
  spawn?: boolean;
  spawnDelay?: number;
}

export const PIECE_VALUE: Record<PieceSymbol, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
};

/** Convert a FEN placement into an array of renderable pieces. */
export function fenToPieces(fen: string, opts?: { spawn?: boolean }): PieceView[] {
  const placement = fen.split(" ")[0];
  const rows = placement.split("/");
  const out: PieceView[] = [];
  let n = 0;
  for (let r = 0; r < 8; r++) {
    let file = 0;
    for (const ch of rows[r]) {
      if (/\d/.test(ch)) {
        file += Number(ch);
        continue;
      }
      const color: Color = ch === ch.toUpperCase() ? "w" : "b";
      const type = ch.toLowerCase() as PieceSymbol;
      const rank = 8 - r;
      const square = `${String.fromCharCode(97 + file)}${rank}` as Square;
      out.push({
        id: `p${n}-${color}${type}-${square}`,
        square,
        type,
        color,
        spawn: opts?.spawn,
        spawnDelay: opts?.spawn ? n * 14 : 0,
      });
      n++;
      file++;
    }
  }
  return out;
}

/** Centipawns (white POV) → 0..100 win-probability-ish percentage. */
export function cpToPercent(cp: number): number {
  const clamped = Math.max(-1500, Math.min(1500, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.0042 * clamped)) - 1);
}

/** Lichess-style win percent used for accuracy math. */
export function winPercent(cp: number): number {
  const clamped = Math.max(-1200, Math.min(1200, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * clamped)) - 1);
}

export function formatEval(cp: number, mateIn?: number): string {
  if (mateIn !== undefined) {
    const sign = cp >= 0 ? "+" : "-";
    return mateIn === 0 ? (cp >= 0 ? "#" : "-#") : `${sign}M${Math.abs(mateIn)}`;
  }
  const pawns = cp / 100;
  if (Math.abs(pawns) < 0.05) return "0.0";
  return `${pawns > 0 ? "+" : ""}${pawns.toFixed(1)}`;
}

/* ---------------- game serialization ---------------- */

/** Minimal shape of a finished game, satisfied by the useChessGame hook. */
export interface SerializableGame {
  history: { from: string; to: string; promotion?: string }[];
  result: { winner: "white" | "black" | null; reason: string } | null;
  mode: "ai" | "human";
  humanColor: "white" | "black";
  difficulty: string;
}

const LEVEL_LABELS: Record<string, string> = {
  easy: "Apprentice",
  medium: "Knight",
  hard: "Grandmaster",
  master: "Sovereign",
};

/** Serialize a finished game into a PGN-backed StoredGame (returns null if nothing to record). */
export function serializeGame(game: SerializableGame): StoredGame | null {
  if (!game.result || game.history.length === 0) return null;
  try {
    const c = new Chess();
    for (const m of game.history) {
      c.move({
        from: m.from as never,
        to: m.to as never,
        promotion: m.promotion as never,
      });
    }
    const resultStr =
      game.result.winner === "white"
        ? "1-0"
        : game.result.winner === "black"
          ? "0-1"
          : "1/2-1/2";
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
        ? `You vs The Grandmaster (${LEVEL_LABELS[game.difficulty] ?? game.difficulty})`
        : "White vs Black — two players";
    return saveRecentGame({
      pgn: c.pgn(),
      plies: game.history.length,
      result: resultStr as StoredGame["result"],
      label,
      reason: game.result.reason,
    });
  } catch {
    /* serialization hiccup — non-fatal */
    return null;
  }
}
