/**
 * Sovereign Chess — engine worker.
 *
 * Runs the device-side oracle (alpha-beta search) off the main thread so
 * the board, clocks and animations never stutter while the AI thinks —
 * the single biggest "pro" feel upgrade on phones.
 *
 * Protocol:
 *   → { id, kind: "best" | "eval", fen, level }
 *   ← { id, ok, result? } | { id, ok: false, error }
 */

import { findBestMove, evaluateFen, type EngineLevel } from "./engine";

export type WorkerRequest = {
  id: number;
  kind: "best" | "eval";
  fen: string;
  level: EngineLevel;
};

export type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { id, kind, fen, level } = e.data;
  try {
    if (kind === "best") {
      const result = findBestMove(fen, level);
      (self as unknown as Worker).postMessage({ id, ok: true, result });
    } else {
      const result = evaluateFen(fen, level);
      (self as unknown as Worker).postMessage({ id, ok: true, result });
    }
  } catch (err) {
    (self as unknown as Worker).postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
