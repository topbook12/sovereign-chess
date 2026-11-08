/**
 * Engine bridge — the heart of the platform's cost strategy.
 *
 * The chess oracle (alpha-beta search) is plain TypeScript, so it runs
 * FULLY on the player's device — every AI move, hint, live eval and game
 * report costs ZERO server compute. The /api/engine routes remain only as
 * an automatic safety net for exotic browsers, so functionality can never
 * break (the user's prime directive).
 */

import type { EngineLevel, EngineResult } from "./engine";

export interface BridgeEval {
  evalCp: number;
  mateIn?: number;
  from?: string;
  to?: string;
  promotion?: string;
  san?: string;
}

/** Yield to the browser so spinners/progress paint before heavy sync work. */
const paint = (ms = 24) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** True when running in a browser context. */
const isBrowser = () => typeof window !== "undefined";

/**
 * Best move — device-side first, server fallback.
 * Same contract as POST /api/engine.
 */
export async function bridgeBestMove(
  fen: string,
  level: EngineLevel
): Promise<EngineResult | null> {
  if (isBrowser()) {
    try {
      const { findBestMove } = await import("./engine");
      await paint(); // let the "thinking" indicator render
      const local = findBestMove(fen, level);
      if (local) return local;
    } catch {
      /* fall through to the server oracle */
    }
  }
  try {
    const res = await fetch("/api/engine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fen, level }),
    });
    if (res.ok) return (await res.json()) as EngineResult;
  } catch {
    /* offline — nothing more we can do */
  }
  return null;
}

/**
 * Single-position evaluation — device-side first, server fallback.
 * Same contract as POST /api/engine/eval.
 */
export async function bridgeEvaluate(
  fen: string,
  level: EngineLevel = "medium"
): Promise<BridgeEval> {
  if (isBrowser()) {
    try {
      const { evaluateFen } = await import("./engine");
      await paint(0);
      return evaluateFen(fen, level);
    } catch {
      /* fall through */
    }
  }
  try {
    const res = await fetch("/api/engine/eval", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fen, level }),
    });
    if (res.ok) return (await res.json()) as BridgeEval;
  } catch {
    /* offline */
  }
  return { evalCp: 0 };
}

/**
 * Batch evaluation for full-game reports — 100% device-side in chunks with
 * UI yields (keeps the progress bar alive and the page responsive), with an
 * automatic fallback to the batched server API.
 */
export async function bridgeEvaluateBatch(
  fens: string[],
  level: EngineLevel = "medium",
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal
): Promise<BridgeEval[]> {
  const total = fens.length;
  if (isBrowser()) {
    try {
      const { evaluateFen } = await import("./engine");
      const out: BridgeEval[] = [];
      for (let i = 0; i < total; i++) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        out.push(evaluateFen(fens[i], level));
        onProgress?.(i + 1, total);
        if (i % 4 === 3) await paint(0); // breathe every 4 positions
      }
      return out;
    } catch (err) {
      if (signal?.aborted) throw err;
      /* fall through to server */
    }
  }
  // server fallback, chunked like the original implementation
  const CHUNK = 8;
  const out: BridgeEval[] = new Array(total);
  for (let i = 0; i < total; i += CHUNK) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const slice = fens.slice(i, i + CHUNK);
    const res = await fetch("/api/analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fens: slice }),
      signal,
    });
    if (!res.ok) throw new Error(`Analysis failed (${res.status})`);
    const data = (await res.json()) as { results: BridgeEval[] };
    data.results.forEach((r, j) => {
      out[i + j] = r;
    });
    onProgress?.(Math.min(i + CHUNK, total), total);
  }
  return out;
}
