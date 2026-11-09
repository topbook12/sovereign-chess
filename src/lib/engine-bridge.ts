/**
 * Engine bridge — the heart of the platform's cost strategy.
 *
 * The chess oracle (alpha-beta search) is plain TypeScript, so it runs
 * FULLY on the player's device — every AI move, hint, live eval and game
 * report costs ZERO server compute. The /api/engine routes remain only as
 * an automatic safety net for exotic browsers, so functionality can never
 * break (the user's prime directive).
 *
 * Mobile-pro execution order:
 *   1. Web Worker (search never blocks the board, clocks or animations)
 *   2. Main thread (workers unsupported — still device-side, zero cost)
 *   3. Server API (exotic environment safety net)
 */

import type { EngineLevel, EngineResult } from "./engine";
import type { WorkerRequest, WorkerResponse } from "./engine-worker";

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

/* ------------------------------------------------------------------ */
/* Worker plumbing                                                     */
/* ------------------------------------------------------------------ */

let workerSingleton: Worker | null | undefined;
let workerBroken = false;
let jobSeq = 0;
const pendingJobs = new Map<
  number,
  { resolve: (r: WorkerResponse) => void; timer: ReturnType<typeof setTimeout> }
>();

function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (workerSingleton !== undefined) return workerSingleton;
  workerSingleton = null;
  if (isBrowser() && "Worker" in window) {
    try {
      workerSingleton = new Worker(
        new URL("./engine-worker.ts", import.meta.url),
        { type: "module" }
      );
      workerSingleton.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const job = pendingJobs.get(e.data.id);
        if (!job) return;
        clearTimeout(job.timer);
        pendingJobs.delete(e.data.id);
        job.resolve(e.data);
      };
      workerSingleton.onerror = () => {
        // module workers unsupported / script failed — drain and disable
        for (const [, job] of pendingJobs) {
          clearTimeout(job.timer);
          job.resolve({ id: -1, ok: false, error: "worker-error" });
        }
        pendingJobs.clear();
        workerBroken = true;
        try {
          workerSingleton?.terminate();
        } catch {
          /* noop */
        }
        workerSingleton = null;
      };
    } catch {
      workerSingleton = null;
    }
  }
  return workerSingleton;
}

/** Run one job on the worker with a hard timeout. Null ⇒ fall back. */
function workerRun<T>(
  kind: WorkerRequest["kind"],
  fen: string,
  level: EngineLevel,
  timeoutMs = 20_000
): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const worker = getWorker();
    if (!worker) {
      resolve(null);
      return;
    }
    const id = ++jobSeq;
    const timer = setTimeout(() => {
      pendingJobs.delete(id);
      resolve(null); // caller falls back — engine never hangs the UI
    }, timeoutMs);
    pendingJobs.set(id, { resolve: (r) => resolve(r.ok ? (r.result as T) : null), timer });
    worker.postMessage({ id, kind, fen, level } satisfies WorkerRequest);
  });
}

/* ------------------------------------------------------------------ */
/* Public bridge API                                                   */
/* ------------------------------------------------------------------ */

/**
 * Best move — worker → main thread → server. Same contract as POST /api/engine.
 */
export async function bridgeBestMove(
  fen: string,
  level: EngineLevel
): Promise<EngineResult | null> {
  if (isBrowser()) {
    // 1) off the main thread — zero jank
    const viaWorker = await workerRun<EngineResult>("best", fen, level);
    if (viaWorker) return viaWorker;

    // 2) main thread fallback (still on-device, still free)
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
 * Single-position evaluation — worker → main thread → server.
 * Same contract as POST /api/engine/eval.
 */
export async function bridgeEvaluate(
  fen: string,
  level: EngineLevel = "medium"
): Promise<BridgeEval> {
  if (isBrowser()) {
    const viaWorker = await workerRun<BridgeEval>("eval", fen, level, 10_000);
    if (viaWorker) return viaWorker;
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
 * Batch evaluation for full-game reports — 100% device-side. The worker
 * swallows the whole batch without ever touching the UI thread; when no
 * worker exists it chunks the main thread with UI yields, and finally an
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
    // 1) worker path — the UI stays silky through entire reports
    const worker = getWorker();
    if (worker) {
      const out: BridgeEval[] = [];
      try {
        for (let i = 0; i < total; i++) {
          if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
          const r = await workerRun<BridgeEval>("eval", fens[i], level, 15_000);
          if (!r) throw new Error("worker-fallback");
          out.push(r);
          onProgress?.(i + 1, total);
        }
        return out;
      } catch (err) {
        if (signal?.aborted) throw err;
        // partial results are useless mid-fallback; restart cleanly below
      }
    }

    // 2) main thread, chunked with yields (keeps the progress bar alive)
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
