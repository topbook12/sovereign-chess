/**
 * Game-report engine (client side).
 *
 * The server (/api/analysis) returns an evaluation for each position of the
 * game; this module turns those numbers into a chess.com-style report:
 * move classifications, accuracy scores and an eval series for the graph.
 */

import type { Move } from "chess.js";
import { winPercent } from "./chess-utils";

export const MATE_CP = 1500;

export type MoveClass =
  | "brilliant"
  | "best"
  | "excellent"
  | "good"
  | "inaccuracy"
  | "mistake"
  | "blunder";

export interface EvalPoint {
  /** white-POV centipawns (mate = ±MATE_CP) */
  cp: number;
  mateIn?: number;
  bestSan?: string;
  bestFrom?: string;
  bestTo?: string;
}

export interface ClassifiedMove {
  ply: number; // 0-based
  san: string;
  uci: string;
  color: "w" | "b";
  classification: MoveClass;
  lossCp: number;
  /** white-POV eval after this move */
  cpAfter: number;
  bestSan?: string;
  playedBest: boolean;
  accuracy: number;
}

export interface SideReport {
  accuracy: number;
  counts: Record<MoveClass, number>;
}

export interface GameReport {
  moves: ClassifiedMove[];
  white: SideReport;
  black: SideReport;
  /** white-POV eval after every ply, index = ply (length = plies) */
  series: number[];
}

export const CLASS_META: Record<
  MoveClass,
  { label: string; icon: string; color: string; bg: string; ring: string }
> = {
  brilliant: { label: "Brilliant", icon: "!!", color: "#4fe3c1", bg: "rgba(79,227,193,0.14)", ring: "rgba(79,227,193,0.65)" },
  best: { label: "Best", icon: "★", color: "#e9c96b", bg: "rgba(233,201,107,0.14)", ring: "rgba(233,201,107,0.6)" },
  excellent: { label: "Excellent", icon: "!", color: "#7fd67f", bg: "rgba(127,214,127,0.13)", ring: "rgba(127,214,127,0.55)" },
  good: { label: "Good", icon: "✓", color: "#a8b8a0", bg: "rgba(168,184,160,0.12)", ring: "rgba(168,184,160,0.45)" },
  inaccuracy: { label: "Inaccuracy", icon: "?!", color: "#e8b34b", bg: "rgba(232,179,75,0.14)", ring: "rgba(232,179,75,0.55)" },
  mistake: { label: "Mistake", icon: "?", color: "#f08c4a", bg: "rgba(240,140,74,0.15)", ring: "rgba(240,140,74,0.55)" },
  blunder: { label: "Blunder", icon: "??", color: "#f4626e", bg: "rgba(244,98,110,0.16)", ring: "rgba(244,98,110,0.6)" },
};

function emptyCounts(): Record<MoveClass, number> {
  return { brilliant: 0, best: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
}

/* ------------------------------------------------------------------ */
/* batched evaluation                                                  */
/* ------------------------------------------------------------------ */

export async function fetchEvals(
  fens: string[],
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal
): Promise<EvalPoint[]> {
  const CHUNK = 8;
  const out: EvalPoint[] = new Array(fens.length);
  let done = 0;
  for (let i = 0; i < fens.length; i += CHUNK) {
    const slice = fens.slice(i, i + CHUNK);
    const res = await fetch("/api/analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fens: slice }),
      signal,
    });
    if (!res.ok) throw new Error(`Analysis failed (${res.status})`);
    const data = (await res.json()) as { results: EvalPoint[] };
    data.results.forEach((r, j) => {
      out[i + j] = r;
    });
    done += slice.length;
    onProgress?.(Math.min(done, fens.length), fens.length);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* report building                                                     */
/* ------------------------------------------------------------------ */

/**
 * @param moves      verbose chess.js history of the whole game
 * @param evals      EvalPoint per position index 0..N (N+1 entries; index i is
 *                   the position BEFORE ply i). The final entry covers the
 *                   terminal position.
 * @param terminal   result of the game
 */
export function buildReport(
  moves: Move[],
  evals: (EvalPoint | undefined)[],
  terminal: { result: "1-0" | "0-1" | "1/2-1/2" | "*"; mate?: boolean }
): GameReport {
  const N = moves.length;
  const classified: ClassifiedMove[] = [];
  const series: number[] = [];
  const whiteCounts = emptyCounts();
  const blackCounts = emptyCounts();

  for (let ply = 0; ply < N; ply++) {
    const m = moves[ply];
    const moverIsWhite = m.color === "w";
    const clampCp = (v: number) => Math.max(-MATE_CP, Math.min(MATE_CP, v));
    const before = evals[ply];
    const after = evals[ply + 1];

    const beforePov = moverIsWhite
      ? clampCp(before?.cp ?? 0)
      : -clampCp(before?.cp ?? 0);
    let afterPov = moverIsWhite
      ? clampCp(after?.cp ?? 0)
      : -clampCp(after?.cp ?? 0);
    if (ply === N - 1 && terminal.mate) {
      // terminal checkmate — the side to move is mated
      const loserIsWhite = terminal.result === "0-1";
      const mateCp = loserIsWhite ? MATE_CP : -MATE_CP;
      afterPov = moverIsWhite ? mateCp : -mateCp;
    }

    const loss = Math.max(0, Math.min(2500, beforePov - afterPov));
    const bestSan = before?.bestSan;
    const playedBest =
      !!bestSan && bestSan.replace(/[+#]/g, "") === m.san.replace(/[+#]/g, "");

    // brilliant heuristic: a quiet move that offers >= 300cp of material yet
    // keeps the evaluation solid — the hallmark of a real sacrifice
    let brilliant = false;
    if (!m.captured && after) {
      const replyCaptures = !!after.bestFrom && !!after.bestTo;
      if (replyCaptures) {
        const board = chessBoardAfter(m.after);
        const victim = board.find((s) => s.square === after.bestTo);
        if (victim && victim.color !== m.color && victimValue(victim.type) >= 3 && loss <= 80) {
          brilliant = true;
        }
      }
    }

    const classification: MoveClass = brilliant
      ? "brilliant"
      : loss < 10 && playedBest
        ? "best"
        : loss < 25
          ? "excellent"
          : loss < 60
            ? "good"
            : loss < 120
              ? "inaccuracy"
              : loss < 250
                ? "mistake"
                : "blunder";

    const winBefore = winPercent(moverIsWhite ? (before?.cp ?? 0) : -(before?.cp ?? 0));
    const winAfter = winPercent(moverIsWhite ? (after?.cp ?? 0) : -(after?.cp ?? 0));
    const accuracy = Math.max(
      0,
      Math.min(100, 103.1668 * Math.exp(-0.04354 * Math.max(0, winBefore - winAfter)) - 3.1669)
    );

    const cpAfter = after?.cp ?? 0;
    series.push(cpAfter);
    (moverIsWhite ? whiteCounts : blackCounts)[classification] += 1;

    classified.push({
      ply,
      san: m.san,
      uci: `${m.from}${m.to}${m.promotion ?? ""}`,
      color: m.color,
      classification,
      lossCp: loss,
      cpAfter,
      bestSan,
      playedBest,
      accuracy,
    });
  }

  const acc = (counts: Record<MoveClass, number>) => {
    // weighted average by count using per-class representative scores
    const weight: Record<MoveClass, number> = {
      brilliant: 99,
      best: 98,
      excellent: 92,
      good: 82,
      inaccuracy: 62,
      mistake: 40,
      blunder: 15,
    };
    let total = 0;
    let n = 0;
    for (const k of Object.keys(counts) as MoveClass[]) {
      total += counts[k] * weight[k];
      n += counts[k];
    }
    return n === 0 ? 100 : Math.round(total / n);
  };

  return {
    moves: classified,
    white: { accuracy: acc(whiteCounts), counts: whiteCounts },
    black: { accuracy: acc(blackCounts), counts: blackCounts },
    series,
  };
}

/* --- helpers for the brilliancy heuristic --- */

function victimValue(t: string): number {
  switch (t) {
    case "q":
      return 9;
    case "r":
      return 5;
    case "b":
    case "n":
      return 3;
    default:
      return 1;
  }
}

function chessBoardAfter(fen: string): { square: string; type: string; color: "w" | "b" }[] {
  const rows = fen.split(" ")[0].split("/");
  const out: { square: string; type: string; color: "w" | "b" }[] = [];
  for (let r = 0; r < 8; r++) {
    let file = 0;
    for (const ch of rows[r]) {
      if (/\d/.test(ch)) {
        file += Number(ch);
        continue;
      }
      out.push({
        square: `${String.fromCharCode(97 + file)}${8 - r}`,
        type: ch.toLowerCase(),
        color: ch === ch.toUpperCase() ? "w" : "b",
      });
      file++;
    }
  }
  return out;
}

/** Short human sentence summarising a side's report. */
export function verdictFor(side: SideReport, label: string): string {
  const c = side.counts;
  const bad = c.mistake + c.blunder;
  const good = c.brilliant + c.best + c.excellent;
  const moments = (n: number) => `${n} costly moment${n === 1 ? "" : "s"}`;
  if (side.accuracy >= 90) return `${label} played a near-flawless game.`;
  if (side.accuracy >= 78) return `${label} was solid — ${good} strong moves, ${moments(bad)}.`;
  if (side.accuracy >= 60)
    return `${label} fought hard, but accuracy drifted (${moments(bad)}).`;
  return `${label} struggled — the report highlights ${moments(bad)}.`;
}
