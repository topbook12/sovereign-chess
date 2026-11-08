import { NextRequest, NextResponse } from "next/server";
import { Chess } from "chess.js";
import { findBestMove, type EngineLevel } from "@/lib/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_LEVELS: EngineLevel[] = ["easy", "medium", "hard", "master"];

/* ---- lightweight abuse guards: per-IP rate limit + concurrency cap ---- */

const RATE_WINDOW_MS = 10_000;
const RATE_MAX = 20;
const MAX_CONCURRENT = 2;

const hits = new Map<string, number[]>();
let inFlight = 0;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (arr.length >= RATE_MAX) {
    hits.set(ip, arr);
    return true;
  }
  arr.push(now);
  hits.set(ip, arr);
  // opportunistic cleanup
  if (hits.size > 500) {
    for (const [k, v] of hits) {
      if (v.every((t) => now - t >= RATE_WINDOW_MS)) hits.delete(k);
    }
  }
  return false;
}

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "local";

  if (rateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many engine requests — slow down." },
      { status: 429 }
    );
  }
  if (inFlight >= MAX_CONCURRENT) {
    return NextResponse.json(
      { error: "Engine is busy — try again shortly." },
      { status: 503 }
    );
  }

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body.fen !== "string" || body.fen.length > 100) {
      return NextResponse.json({ error: "Missing FEN" }, { status: 400 });
    }

    let game: Chess;
    try {
      game = new Chess(body.fen);
    } catch {
      return NextResponse.json({ error: "Invalid FEN" }, { status: 400 });
    }

    if (game.isGameOver()) {
      return NextResponse.json({ error: "Game is over" }, { status: 400 });
    }

    const level: EngineLevel = VALID_LEVELS.includes(body.level)
      ? body.level
      : "medium";

    inFlight++;
    let result;
    try {
      result = findBestMove(body.fen, level);
    } finally {
      inFlight--;
    }

    if (!result) {
      return NextResponse.json({ error: "No legal moves" }, { status: 400 });
    }

    return NextResponse.json({ ...result });
  } catch (err) {
    console.error("[engine] unexpected error:", err);
    return NextResponse.json({ error: "Engine failure" }, { status: 500 });
  }
}
