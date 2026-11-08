import { NextRequest, NextResponse } from "next/server";
import { evaluateFen, type EngineLevel } from "@/lib/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_LEVELS: EngineLevel[] = ["easy", "medium", "hard", "master"];
const MAX_FENS = 24;

/* simple per-IP rate limit: 120 requests / 60s */
const WINDOW_MS = 60_000;
const MAX_REQS = 120;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= MAX_REQS) {
    hits.set(ip, arr);
    return true;
  }
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 500) {
    for (const [k, v] of hits) {
      if (v.every((t) => now - t >= WINDOW_MS)) hits.delete(k);
    }
  }
  return false;
}

/**
 * Batch position evaluation for the game report.
 * POST { fens: string[], level?: EngineLevel } → { results: EvalPoint[] }
 */
export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "local";

  if (rateLimited(ip)) {
    return NextResponse.json({ error: "Too many analysis requests" }, { status: 429 });
  }

  try {
    const body = await req.json().catch(() => null);
    if (
      !body ||
      !Array.isArray(body.fens) ||
      body.fens.length === 0 ||
      body.fens.length > MAX_FENS
    ) {
      return NextResponse.json(
        { error: `Provide 1–${MAX_FENS} FEN strings` },
        { status: 400 }
      );
    }

    const level: EngineLevel = VALID_LEVELS.includes(body.level) ? body.level : "medium";
    const results: {
      cp: number;
      mateIn?: number;
      bestSan?: string;
      bestFrom?: string;
      bestTo?: string;
    }[] = [];

    for (const fen of body.fens as string[]) {
      if (typeof fen !== "string" || fen.length > 100) {
        results.push({ cp: 0 });
        continue;
      }
      try {
        const ev = evaluateFen(fen, level);
        results.push({
          cp: Math.round(ev.evalCp),
          mateIn: ev.mateIn,
          bestSan: ev.san,
          bestFrom: ev.from,
          bestTo: ev.to,
        });
      } catch {
        results.push({ cp: 0 });
      }
    }

    return NextResponse.json({ results });
  } catch (err) {
    console.error("[analysis] unexpected error:", err);
    return NextResponse.json({ error: "Analysis failure" }, { status: 500 });
  }
}
