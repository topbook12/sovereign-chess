import { NextRequest, NextResponse } from "next/server";
import { tursoQuery } from "@/lib/turso";

/**
 * Ultra-compact game archive on Turso (one PGN row per duel ≈ 0.3 KB).
 *
 * POST /api/games  { deviceId, games: QueuedGame[] }  → idempotent batch
 *   insert (INSERT OR IGNORE keyed by the client-generated id), so replayed
 *   retry queues can never create duplicates.
 *
 * GET  /api/games?deviceId=...&count=1      → { count }
 * GET  /api/games?deviceId=...&limit=1000   → { games }
 *
 * If Turso is unreachable the POST answers ok:false and the browser keeps
 * the games in its persistent retry queue — nothing is ever lost.
 */

interface IncomingGame {
  cid?: string;
  pgn?: string;
  result?: string;
  label?: string;
  plies?: number;
  ts?: number;
}

const MAX_BATCH = 100;
const MAX_PGN = 12_000;
const RESULTS = new Set(["1-0", "0-1", "1/2-1/2", "*"]);

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      deviceId?: string;
      games?: IncomingGame[];
    };
    if (!body?.deviceId || !Array.isArray(body.games) || body.games.length === 0) {
      return NextResponse.json({ error: "invalid payload" }, { status: 400 });
    }
    const games = body.games
      .slice(0, MAX_BATCH)
      .filter(
        (g) =>
          g &&
          typeof g.cid === "string" &&
          g.cid.length <= 64 &&
          typeof g.pgn === "string" &&
          g.pgn.length <= MAX_PGN &&
          RESULTS.has(g.result ?? "")
      )
      .map((g) => ({
        cid: g.cid as string,
        deviceId: body.deviceId as string,
        pgn: g.pgn as string,
        result: g.result as string,
        label: (g.label ?? "").toString().slice(0, 120),
        plies: Math.max(0, Math.min(1000, Math.floor(g.plies ?? 0))),
        ts: Math.max(0, Math.floor(g.ts ?? Date.now())),
      }));

    if (games.length === 0) {
      return NextResponse.json({ ok: false, error: "no valid games" }, { status: 400 });
    }

    const saved = await tursoQuery(async (c) => {
      const stmts = games.map((g) => ({
        sql: `INSERT OR IGNORE INTO games (cid, device_id, pgn, result, label, plies, ts)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [g.cid, g.deviceId, g.pgn, g.result, g.label, g.plies, g.ts],
      }));
      const res = await c.batch(stmts, "write");
      return res.reduce((sum, r) => sum + (r.rowsAffected ?? 0), 0);
    });

    if (saved === null) {
      // cloud unreachable — client keeps its retry queue
      return NextResponse.json({ ok: false, cloud: false }, { status: 503 });
    }

    return NextResponse.json({ ok: true, saved });
  } catch (err) {
    console.error("games POST failed", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const deviceId = req.nextUrl.searchParams.get("deviceId");
  const wantCount = req.nextUrl.searchParams.get("count");
  const limit = Math.min(
    1000,
    Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 1000) || 1000)
  );
  if (!deviceId) {
    return NextResponse.json({ error: "deviceId required" }, { status: 400 });
  }

  if (wantCount) {
    const res = await tursoQuery((c) =>
      c.execute({
        sql: "SELECT COUNT(*) AS n FROM games WHERE device_id = ?",
        args: [deviceId],
      })
    );
    const count =
      res && res.rows.length > 0 ? Number(res.rows[0].n ?? 0) : null;
    return NextResponse.json({ count });
  }

  const res = await tursoQuery((c) =>
    c.execute({
      sql: `SELECT cid, pgn, result, label, plies, ts
            FROM games WHERE device_id = ?
            ORDER BY ts ASC LIMIT ${limit}`,
      args: [deviceId],
    })
  );
  if (!res) {
    return NextResponse.json({ games: [], ok: false });
  }
  return NextResponse.json({
    ok: true,
    games: res.rows.map((r) => ({
      cid: String(r.cid),
      pgn: String(r.pgn),
      result: String(r.result),
      label: r.label === null ? "" : String(r.label),
      plies: Number(r.plies ?? 0),
      date: Number(r.ts ?? 0),
      id: String(r.cid),
    })),
  });
}
