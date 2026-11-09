/**
 * Turso (libSQL) — the platform's only cloud dependency. Free tier, two
 * tiny tables, zero maintenance. Server-side only.
 *
 * Cost-effectiveness guarantees:
 *  - 1 SQL round-trip per sync (batched), no polling, no websockets
 *  - every call is hard-capped at 6s and fully failure-tolerant: when the
 *    cloud is unreachable the API routes fall back to the local Prisma
 *    mirror, and the browser keeps its own copy + retry queue. Data can
 *    never be lost by a cloud outage.
 */
import { createClient, type Client, type InValue } from "@libsql/client";

const globalForTurso = globalThis as unknown as {
  __sovereignTurso?: Client | null;
};

/** Lazily create the singleton client; null when not configured. */
export function getTurso(): Client | null {
  if (globalForTurso.__sovereignTurso !== undefined) {
    return globalForTurso.__sovereignTurso;
  }
  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;
  if (!url || !token) {
    globalForTurso.__sovereignTurso = null;
    return null;
  }
  try {
    globalForTurso.__sovereignTurso = createClient({ url, authToken: token });
  } catch {
    globalForTurso.__sovereignTurso = null;
  }
  return globalForTurso.__sovereignTurso;
}

/** Race any Turso call against a hard timeout so requests never hang. */
export async function tursoQuery<T>(
  fn: (client: Client) => Promise<T>,
  timeoutMs = 6_000
): Promise<T | null> {
  const client = getTurso();
  if (!client) return null;
  return Promise.race([
    fn(client).catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
}

export type { InValue };
