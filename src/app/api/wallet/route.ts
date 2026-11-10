import { NextRequest, NextResponse } from "next/server";
import { tursoQuery } from "@/lib/turso";

/**
 * Platform wallet ledger — every diamond event with real-money meaning
 * reaches Turso so the platform owner has a central, tamper-evident view:
 *
 *   POST /api/wallet { deviceId, records: WalletRecord[] }
 *     - kind "order"      → diamond purchase claims (bKash TrxID queue)
 *     - kind "withdrawal" → cash-out claims the owner must settle
 *     - kind "balance"    → latest balance snapshot for the device
 *     - kind "settlement" → per-match economy summary (stakes, credits and
 *                           the house's 1 💎 rake — the platform's profit)
 *     Idempotent: INSERT OR IGNORE keyed by the client record id — the
 *     browser retry queue can replay safely after any outage.
 *
 *   GET /api/wallet?key=$SOVEREIGN_ADMIN_KEY   → { orders, withdrawals }
 *     Owner's fulfilment view. When SOVEREIGN_ADMIN_KEY is unset the
 *     endpoint stays open (demo mode) — set it before going live.
 */

interface IncomingRecord {
  kind?: string;
  id?: string;
  t?: number;
  payload?: Record<string, unknown>;
}

const KINDS = new Set(["order", "withdrawal", "balance", "settlement"]);

const ENSURE_SQL = [
  `CREATE TABLE IF NOT EXISTS wallet_orders (
     id TEXT PRIMARY KEY, device_id TEXT, player TEXT, package_id TEXT,
     diamonds INTEGER, bonus INTEGER, taka INTEGER, method TEXT,
     sender TEXT, trx TEXT, status TEXT, t INTEGER)`,
  `CREATE TABLE IF NOT EXISTS wallet_withdrawals (
     id TEXT PRIMARY KEY, device_id TEXT, player TEXT, diamonds INTEGER,
     taka INTEGER, method TEXT, account TEXT, status TEXT, t INTEGER)`,
  `CREATE TABLE IF NOT EXISTS wallet_balances (
     device_id TEXT PRIMARY KEY, player TEXT, balance INTEGER, t INTEGER)`,
  `CREATE TABLE IF NOT EXISTS wallet_settlements (
     id TEXT PRIMARY KEY, device_id TEXT, scope TEXT, match_id TEXT,
     winner TEXT, outcome TEXT, stake INTEGER, credit INTEGER,
     fee INTEGER, taka_fee INTEGER, t INTEGER)`,
];

const s = (v: unknown, max = 120) =>
  v === undefined || v === null ? "" : String(v).slice(0, max);
const n = (v: unknown, max = 1_000_000) =>
  Math.max(-max, Math.min(max, Math.floor(Number(v ?? 0)) || 0));

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      deviceId?: string;
      records?: IncomingRecord[];
    };
    if (!body?.deviceId || !Array.isArray(body.records) || body.records.length === 0) {
      return NextResponse.json({ error: "invalid payload" }, { status: 400 });
    }
    const deviceId = s(body.deviceId, 80);

    const stmts: { sql: string; args: unknown[] }[] = ENSURE_SQL.map((sql) => ({
      sql,
      args: [],
    }));

    for (const rec of body.records.slice(0, 60)) {
      if (!rec || !KINDS.has(rec.kind ?? "")) continue;
      const t = Math.max(0, Math.floor(rec.t ?? Date.now()));
      if (rec.kind === "order" && rec.id) {
        const p = rec.payload ?? {};
        stmts.push({
          sql: `INSERT OR IGNORE INTO wallet_orders
                (id, device_id, player, package_id, diamonds, bonus, taka, method, sender, trx, status, t)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            s(rec.id, 40), deviceId, s(p.player, 40), s(p.packageId, 20),
            n(p.diamonds), n(p.bonus), n(p.taka), s(p.method, 12),
            s(p.sender, 24), s(p.trx, 40), s(p.status, 12), t,
          ],
        });
      } else if (rec.kind === "withdrawal" && rec.id) {
        const p = rec.payload ?? {};
        stmts.push({
          sql: `INSERT OR IGNORE INTO wallet_withdrawals
                (id, device_id, player, diamonds, taka, method, account, status, t)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            s(rec.id, 40), deviceId, s(p.player, 40), n(p.diamonds),
            n(p.taka), s(p.method, 12), s(p.account, 24), s(p.status, 12), t,
          ],
        });
      } else if (rec.kind === "settlement" && rec.id) {
        const p = (rec.payload ?? {}) as {
          scope?: string;
          matchId?: string;
          winner?: number | null;
          outcome?: string;
          stake?: number;
          credit?: number;
          fee?: number;
        };
        stmts.push({
          sql: `INSERT OR IGNORE INTO wallet_settlements
                (id, device_id, scope, match_id, winner, outcome, stake,
                 credit, fee, taka_fee, t)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            s(rec.id, 60), deviceId, s(p.scope, 12), s(p.matchId, 40),
            p.winner === null || p.winner === undefined
              ? null
              : n(p.winner, 9),
            s(p.outcome, 12), n(p.stake), n(p.credit), n(p.fee),
            n(p.fee, 10000) * 50, t,
          ],
        });
      } else if (rec.kind === "balance") {
        const p = (rec.payload ?? {}) as { player?: string; balance?: number };
        stmts.push({
          sql: `INSERT INTO wallet_balances (device_id, player, balance, t)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(device_id) DO UPDATE SET
                  player = excluded.player,
                  balance = excluded.balance,
                  t = excluded.t`,
          args: [deviceId, s(p.player, 40), n(p.balance), t],
        });
      }
    }

    const saved = await tursoQuery(async (c) => {
      const res = await c.batch(
        stmts.map((st) => ({ sql: st.sql, args: st.args as never[] })),
        "write"
      );
      return res.reduce((sum, r) => sum + (r.rows_written ?? 0), 0);
    });

    if (saved === null) {
      // cloud unreachable — the browser keeps its retry queue
      return NextResponse.json({ ok: false, cloud: false }, { status: 503 });
    }
    return NextResponse.json({ ok: true, saved });
  } catch (err) {
    console.error("wallet POST failed", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key") ?? "";
  const expected = process.env.SOVEREIGN_ADMIN_KEY;
  if (expected && key !== expected) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const rows = await tursoQuery(async (c) => {
    const [orders, withdrawals, settlements] = await c.batch(
      [
        {
          sql: "SELECT id, device_id, player, package_id, diamonds, bonus, taka, method, sender, trx, status, t FROM wallet_orders ORDER BY t DESC LIMIT 200",
          args: [],
        },
        {
          sql: "SELECT id, device_id, player, diamonds, taka, method, account, status, t FROM wallet_withdrawals ORDER BY t DESC LIMIT 200",
          args: [],
        },
        {
          sql: "SELECT id, device_id, scope, match_id, winner, outcome, stake, credit, fee, taka_fee, t FROM wallet_settlements ORDER BY t DESC LIMIT 400",
          args: [],
        },
      ],
      "read"
    );
    const feeRows = (settlements?.rows ?? []) as Record<string, unknown>[];
    const houseFee = feeRows.reduce((sum, r) => sum + Number(r.fee ?? 0), 0);
    return {
      orders: orders?.rows ?? [],
      withdrawals: withdrawals?.rows ?? [],
      settlements: settlements?.rows ?? [],
      houseFeeDiamonds: houseFee,
      houseFeeTaka: houseFee * 50,
    };
  });

  if (!rows)
    return NextResponse.json({
      ok: false,
      orders: [],
      withdrawals: [],
      settlements: [],
      houseFeeDiamonds: 0,
      houseFeeTaka: 0,
    });
  return NextResponse.json({ ok: true, ...rows });
}
