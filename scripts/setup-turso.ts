/**
 * Turso (libSQL) bootstrap — creates the two ultra-compact tables that hold
 * the whole platform's cloud state. Run once: `bun scripts/setup-turso.ts`
 *
 * Storage philosophy (cost-effective by design):
 *  - profiles: ONE row per device — the whole career profile as JSON (~2 KB)
 *  - games:    ONE row per finished duel — PGN text only (~0.3 KB/game)
 *  No event logs, no move-by-move server state, nothing else.
 */
import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const token = process.env.TURSO_AUTH_TOKEN;

if (!url || !token) {
  console.error("Missing TURSO_DATABASE_URL / TURSO_AUTH_TOKEN in env");
  process.exit(1);
}

const db = createClient({ url, authToken: token });

await db.executeMultiple(`
  CREATE TABLE IF NOT EXISTS profiles (
    device_id  TEXT PRIMARY KEY,
    data       TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS games (
    cid        TEXT PRIMARY KEY,
    device_id  TEXT NOT NULL,
    pgn        TEXT NOT NULL,
    result     TEXT NOT NULL,
    label      TEXT,
    plies      INTEGER NOT NULL DEFAULT 0,
    ts         INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_games_device ON games(device_id, ts);
`);

const res = await db.execute(
  "SELECT (SELECT COUNT(*) FROM profiles) AS profiles, (SELECT COUNT(*) FROM games) AS games"
);
const row = res.rows[0];
console.log(
  `Turso ready — profiles: ${row?.profiles ?? 0}, games: ${row?.games ?? 0}`
);
