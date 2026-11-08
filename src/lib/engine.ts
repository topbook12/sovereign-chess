/**
 * Sovereign Chess Engine — public API.
 *
 * The heavy lifting happens in `chess-engine-core.ts` (a fast 0x88 mailbox
 * engine with alpha–beta search, MVV-LVA ordering and quiescence). This module
 * wraps it with chess.js validation so the server never returns an illegal
 * move, even in the unlikely event of a core edge case.
 */

import { Chess } from "chess.js";
import { searchBestMove } from "./chess-engine-core";

export type EngineLevel = "easy" | "medium" | "hard" | "master";

export interface EngineResult {
  from: string;
  to: string;
  promotion?: string;
  san: string;
  /** centipawns from White's point of view */
  evalCp: number;
  mateIn?: number;
  depth: number;
  nodes: number;
  timeMs: number;
}

const MATE = 900_000;

/* --------- tiny opening book for natural, varied play --------- */

const BOOK: Record<string, [string, number][]> = {
  // 1st move
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR": [
    ["e2e4", 4], ["d2d4", 3], ["g1f3", 2], ["c2c4", 1],
  ],
  // 1.e4 replies
  "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR": [
    ["e7e5", 5], ["c7c5", 3], ["e7e6", 1], ["c7c6", 1],
  ],
  // 1.e4 e5
  "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR": [["g1f3", 1]],
  // 1.e4 c5
  "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR": [
    ["g1f3", 6], ["b1c3", 2], ["c2c3", 2],
  ],
  // 1.d4 replies
  "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR": [
    ["d7d5", 5], ["g8f6", 4], ["e7e6", 1],
  ],
  // 1.d4 d5
  "rnbqkbnr/ppp1pppp/8/3p4/3P4/8/PPP1PPPP/RNBQKBNR": [
    ["c2c4", 5], ["g1f3", 3], ["b1c3", 2],
  ],
  // 1.d4 Nf6
  "rnbqkb1r/pppppppp/5n2/8/3P4/8/PPP1PPPP/RNBQKBNR": [
    ["c2c4", 6], ["g1f3", 4],
  ],
  // 1.Nf3 replies
  "rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R": [
    ["d7d5", 4], ["g8f6", 3], ["c7c5", 3],
  ],
  // 1.c4 replies
  "rnbqkbnr/pppppppp/8/8/2P5/8/PP1PPPPP/RNBQKBNR": [
    ["e7e5", 5], ["g8f6", 3], ["c7c5", 2],
  ],
};

function bookMove(fen: string): string | null {
  const placement = fen.split(" ")[0];
  const entries = BOOK[placement];
  if (!entries) return null;
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let roll = Math.random() * total;
  for (const [mv, w] of entries) {
    roll -= w;
    if (roll <= 0) return mv;
  }
  return entries[0][0];
}

/**
 * Static evaluation of a position: best move + white-POV eval, without the
 * opening book (used by the analysis tools, where a clean number matters).
 * Handles terminal positions (mate / draw) gracefully.
 */
export function evaluateFen(
  fen: string,
  level: EngineLevel = "medium"
): {
  evalCp: number;
  mateIn?: number;
  from?: string;
  to?: string;
  promotion?: string;
  san?: string;
} {
  const game = new Chess(fen);

  if (game.isGameOver()) {
    if (game.isCheckmate()) {
      const whiteMated = game.turn() === "w";
      return { evalCp: whiteMated ? -MATE : MATE, mateIn: 0 };
    }
    return { evalCp: 0 }; // stalemate / insufficient material / draw rules
  }

  const core = searchBestMove(fen, level);
  if (!core || !Number.isFinite(core.scoreCp)) return { evalCp: 0 };

  const whiteToMove = game.turn() === "w";
  const raw = Math.max(-MATE, Math.min(MATE, core.scoreCp));
  const evalCp = whiteToMove ? raw : -raw;
  const mateIn =
    Math.abs(core.scoreCp) > MATE - 1000
      ? Math.max(1, Math.ceil((MATE - Math.abs(core.scoreCp)) / 2))
      : undefined;

  // cross-check legality through chess.js
  const legal = game.moves({ verbose: true }).find(
    (m) => m.from === core.from && m.to === core.to && (!core.promotion || m.promotion === core.promotion)
  );
  if (!legal) return { evalCp };

  return {
    evalCp,
    mateIn,
    from: legal.from,
    to: legal.to,
    promotion: legal.promotion,
    san: legal.san,
  };
}

export function findBestMove(fen: string, level: EngineLevel = "medium"): EngineResult | null {
  const game = new Chess(fen);
  const legal = game.moves({ verbose: true });
  if (legal.length === 0) return null;

  // opening book (only while both sides are near the start & developed ≤ 2 plies each way)
  let core: ReturnType<typeof searchBestMove> = null;
  const bookUci = game.moveNumber() <= 2 ? bookMove(fen) : null;
  let chosen = bookUci
    ? legal.find(
        (m) => `${m.from}${m.to}${m.promotion ?? ""}` === bookUci
      )
    : undefined;

  if (!chosen) {
    core = searchBestMove(fen, level);
    chosen = core
      ? legal.find(
          (m) =>
            m.from === core!.from &&
            m.to === core!.to &&
            (!core!.promotion || m.promotion === core!.promotion)
        )
      : undefined;
  }

  // absolute safety net: fall back to a random legal move
  if (!chosen) {
    chosen = legal[Math.floor(Math.random() * legal.length)];
  }

  // convert mover-POV score → White-POV (guard against non-finite edge cases)
  const whiteToMove = game.turn() === "w";
  const rawScore = core && Number.isFinite(core.scoreCp) ? core.scoreCp : 0;
  const scorePov = Math.max(-MATE, Math.min(MATE, rawScore));
  const evalCp = whiteToMove ? scorePov : -scorePov;
  const mateIn =
    Math.abs(scorePov) > MATE - 1000
      ? Math.max(1, Math.ceil((MATE - Math.abs(scorePov)) / 2))
      : undefined;

  return {
    from: chosen.from,
    to: chosen.to,
    promotion: chosen.promotion,
    san: chosen.san,
    evalCp,
    mateIn,
    depth: core?.depth ?? 1,
    nodes: core?.nodes ?? 0,
    timeMs: core?.timeMs ?? 0,
  };
}
