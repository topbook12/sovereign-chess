import { NextRequest, NextResponse } from "next/server";
import { evaluateFen, type EngineLevel } from "@/lib/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_LEVELS: EngineLevel[] = ["easy", "medium", "hard", "master"];

/**
 * Quick, clean evaluation of a single position (no opening book).
 * Unlike /api/engine, this works on game-over positions too.
 * POST { fen, level? } → { evalCp, mateIn?, from?, to?, san? }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body.fen !== "string" || body.fen.length > 100) {
      return NextResponse.json({ error: "Missing FEN" }, { status: 400 });
    }

    const level: EngineLevel = VALID_LEVELS.includes(body.level) ? body.level : "hard";

    try {
      const result = evaluateFen(body.fen, level);
      return NextResponse.json(result);
    } catch {
      return NextResponse.json({ error: "Invalid FEN" }, { status: 400 });
    }
  } catch (err) {
    console.error("[engine/eval] unexpected error:", err);
    return NextResponse.json({ error: "Engine failure" }, { status: 500 });
  }
}
