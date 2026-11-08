import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * Cloud mirror for career profiles.
 * GET  /api/profile?deviceId=...  -> { data: string | null }
 * POST /api/profile { deviceId, data } -> upsert (last write wins)
 */

export async function GET(req: NextRequest) {
  try {
    const deviceId = req.nextUrl.searchParams.get("deviceId");
    if (!deviceId) {
      return NextResponse.json({ error: "deviceId required" }, { status: 400 });
    }
    const row = await db.careerProfile.findUnique({
      where: { deviceId },
      select: { data: true },
    });
    return NextResponse.json({ data: row?.data ?? null });
  } catch (err) {
    console.error("profile GET failed", err);
    return NextResponse.json({ data: null });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { deviceId?: string; data?: string };
    if (!body?.deviceId || typeof body.data !== "string" || body.data.length > 120_000) {
      return NextResponse.json({ error: "invalid payload" }, { status: 400 });
    }
    await db.careerProfile.upsert({
      where: { deviceId: body.deviceId },
      create: { deviceId: body.deviceId, data: body.data },
      update: { data: body.data },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("profile POST failed", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
