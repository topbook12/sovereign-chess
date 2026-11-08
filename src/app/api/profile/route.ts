import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { tursoQuery } from "@/lib/turso";

/**
 * Cloud mirror for career profiles — dual-redundant by design.
 *
 * WRITE: both stores independently (Turso primary + local SQLite mirror).
 * READ : Turso first, local mirror as failover. As long as either store
 *        survives, the profile survives — data loss is practically
 *        impossible, and the whole thing fits in ONE row per player.
 *
 * GET  /api/profile?deviceId=...  -> { data: string | null, source }
 * POST /api/profile { deviceId, data } -> { ok, turso, local }
 */

const MAX_DATA = 120_000;

export async function GET(req: NextRequest) {
  const deviceId = req.nextUrl.searchParams.get("deviceId");
  if (!deviceId) {
    return NextResponse.json({ error: "deviceId required" }, { status: 400 });
  }

  // 1) Turso (the free cloud)
  const fromTurso = await tursoQuery((c) =>
    c.execute({
      sql: "SELECT data FROM profiles WHERE device_id = ?",
      args: [deviceId],
    })
  );
  if (fromTurso && fromTurso.rows.length > 0) {
    return NextResponse.json({
      data: String(fromTurso.rows[0].data ?? ""),
      source: "turso",
    });
  }

  // 2) local mirror
  try {
    const row = await db.careerProfile.findUnique({
      where: { deviceId },
      select: { data: true },
    });
    if (row?.data) {
      return NextResponse.json({ data: row.data, source: "local" });
    }
  } catch (err) {
    console.error("profile GET local failed", err);
  }

  return NextResponse.json({ data: null, source: "none" });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { deviceId?: string; data?: string };
    if (
      !body?.deviceId ||
      typeof body.data !== "string" ||
      body.data.length > MAX_DATA
    ) {
      return NextResponse.json({ error: "invalid payload" }, { status: 400 });
    }

    // independent writes — one failing store never blocks the other
    const tursoOk = await tursoQuery((c) =>
      c.execute({
        sql: `INSERT INTO profiles (device_id, data, updated_at)
              VALUES (?, ?, ?)
              ON CONFLICT(device_id)
              DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
        args: [body.deviceId, body.data, Date.now()],
      }).then((r) => !!r)
    );

    let localOk: boolean;
    try {
      await db.careerProfile.upsert({
        where: { deviceId: body.deviceId },
        create: { deviceId: body.deviceId, data: body.data },
        update: { data: body.data },
      });
      localOk = true;
    } catch (err) {
      console.error("profile POST local failed", err);
      localOk = false;
    }

    if (!tursoOk && !localOk) {
      return NextResponse.json(
        { ok: false, turso: false, local: false },
        { status: 503 }
      );
    }
    return NextResponse.json({ ok: true, turso: !!tursoOk, local: localOk });
  } catch (err) {
    console.error("profile POST failed", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
