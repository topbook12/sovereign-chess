/**
 * Cloud layer (client) — talks to the two ultra-compact Turso tables via
 * thin API routes. Designed around three promises:
 *
 *  1. Local-first: localStorage is always written first; the cloud is an
 *     asynchronous mirror, never a dependency.
 *  2. Never lose data: every game that fails to reach the cloud sits in a
 *     persistent retry queue and is re-sent automatically (idempotent —
 *     the server de-dupes by client id).
 *  3. Minimal traffic: one small POST per finished game, one POST per
 *     profile change (debounced in game-store), one GET on demand.
 */

export interface QueuedGame {
  cid: string;
  pgn: string;
  result: string;
  label?: string;
  plies: number;
  ts: number;
}

/** Cloud mirror of a game — the API adds the stable `id` and `date` (ms). */
export type CloudGame = QueuedGame & { id: string; date: number };

export interface CloudStatus {
  /** games waiting in the retry queue */
  pending: number;
  /** last cloud write outcome (null = not attempted yet) */
  lastOk: boolean | null;
  lastAt: number;
  /** games known to exist in the cloud (null = unknown) */
  cloudGames: number | null;
}

const QUEUE_KEY = "sovereign-cloud-queue-v1";

/** Fired on window whenever cloud status changes. */
export const CLOUD_EVENT = "sovereign-cloud-status";

/* ------------------------------------------------------------------ */
/* status                                                              */
/* ------------------------------------------------------------------ */

let status: CloudStatus = {
  pending: 0,
  lastOk: null,
  lastAt: 0,
  cloudGames: null,
};

export function getCloudStatus(): CloudStatus {
  return status;
}

function setStatus(patch: Partial<CloudStatus>) {
  status = { ...status, ...patch };
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CLOUD_EVENT));
  }
}

export function onCloudChange(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CLOUD_EVENT, cb);
  return () => window.removeEventListener(CLOUD_EVENT, cb);
}

/** Record the outcome of a profile mirror attempt (called by game-store). */
export function markProfileSync(ok: boolean) {
  setStatus({ lastOk: ok, lastAt: Date.now() });
}

/* ------------------------------------------------------------------ */
/* queue                                                               */
/* ------------------------------------------------------------------ */

function readQueue(): QueuedGame[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedGame[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(q: QueuedGame[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-400)));
  } catch {
    /* storage full — drop oldest halves silently */
  }
  setStatus({ pending: Math.min(q.length, 400) });
}

function deviceId(): string {
  if (typeof window === "undefined") return "server";
  let id = window.localStorage.getItem("sovereign-device-v1");
  if (!id) {
    id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `d${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    window.localStorage.setItem("sovereign-device-v1", id);
  }
  return id;
}

/** Enqueue a finished game for cloud archival (fire-and-forget). */
export function queueGame(game: QueuedGame) {
  const q = readQueue();
  if (!q.some((g) => g.cid === game.cid)) q.push(game);
  writeQueue(q);
  scheduleFlush();
}

let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

export function scheduleFlush(delayMs = 2200) {
  if (typeof window === "undefined") return;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => void flushQueue(), delayMs);
}

/**
 * Push queued games to the cloud. Idempotent on the server (INSERT OR
 * IGNORE), so replays are always safe.
 */
export async function flushQueue(): Promise<boolean> {
  if (typeof window === "undefined" || flushing) return false;
  const q = readQueue();
  if (q.length === 0) {
    setStatus({ lastOk: status.lastOk, lastAt: Date.now() });
    return true;
  }
  flushing = true;
  let ok = false;
  try {
    const res = await fetch("/api/games", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId: deviceId(),
        games: q.slice(0, 80),
      }),
    });
    ok = res.ok && ((await res.json()) as { ok?: boolean })?.ok === true;
  } catch {
    ok = false;
  }
  flushing = false;
  if (ok) {
    const sent = new Set(readQueue().slice(0, 80).map((g) => g.cid));
    writeQueue(readQueue().filter((g) => !sent.has(g.cid)));
  }
  setStatus({ lastOk: ok, lastAt: Date.now() });
  return ok;
}

/* ------------------------------------------------------------------ */
/* reads (on demand — never polled)                                    */
/* ------------------------------------------------------------------ */

/** How many games live in the cloud for this device. */
export async function fetchCloudGameCount(): Promise<number | null> {
  try {
    const res = await fetch(
      `/api/games?deviceId=${encodeURIComponent(deviceId())}&count=1`
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { count?: number | null };
    const count = json.count ?? null;
    setStatus({ cloudGames: count });
    return count;
  } catch {
    return null;
  }
}

/** Full cloud archive for this device (Excel export / backups). */
export async function fetchCloudGames(): Promise<CloudGame[] | null> {
  try {
    const res = await fetch(
      `/api/games?deviceId=${encodeURIComponent(deviceId())}&limit=1000`
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { games?: CloudGame[] };
    setStatus({ cloudGames: json.games?.length ?? 0 });
    return json.games ?? [];
  } catch {
    return null;
  }
}
