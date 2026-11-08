"use client";

import { useEffect, useRef } from "react";
import type { PieceSymbol } from "chess.js";
import { Crown, Sparkles } from "lucide-react";
import { PieceGlyph } from "./piece-svg";
import { playSound } from "@/lib/sounds";
import { cn } from "@/lib/utils";

/* ---------------- Clock ---------------- */

export function formatClock(ms: number): string {
  if (ms <= 0) return "0:00";
  const totalSec = ms / 1000;
  if (totalSec < 20) {
    const s = Math.floor(totalSec);
    const t = Math.floor((ms - s * 1000) / 100);
    return `${s}.${t}`;
  }
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function Clock({
  ms,
  active,
  unlimited,
}: {
  ms: number;
  active: boolean;
  unlimited: boolean;
}) {
  const lastTickRef = useRef(-1);
  const seconds = Math.ceil(ms / 1000);

  useEffect(() => {
    if (!active || unlimited || ms <= 0 || ms > 10_000) return;
    if (lastTickRef.current !== seconds) {
      lastTickRef.current = seconds;
      playSound("tick");
    }
  }, [active, unlimited, ms, seconds]);

  if (unlimited) {
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-lg px-3 py-1.5 font-mono text-lg font-semibold tabular-nums",
          "bg-white/5 text-gold-soft/80"
        )}
        title="Unlimited time"
      >
        ∞
      </span>
    );
  }

  const low = ms <= 10_000 && ms > 0;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-lg px-3 py-1.5 font-mono text-xl font-bold tabular-nums transition-colors",
        active
          ? low
            ? "clock-urgent bg-red-500/15 text-red-300"
            : "bg-gold/15 text-gold-soft shadow-[0_0_18px_rgba(212,175,55,0.25)]"
          : "bg-white/5 text-foreground/55"
      )}
      role="timer"
      aria-label={`${active ? "Running" : "Idle"} clock: ${formatClock(ms)}`}
    >
      {formatClock(ms)}
    </span>
  );
}

/* ---------------- Player strip ---------------- */

export interface PlayerStripProps {
  name: string;
  badge?: string;
  color: "white" | "black";
  /** pieces this player has captured (rendered in their color) */
  captured: PieceSymbol[];
  materialDiff: number;
  clockMs: number;
  unlimited: boolean;
  active: boolean;
  thinking?: boolean;
}

export function PlayerStrip({
  name,
  badge,
  color,
  captured,
  materialDiff,
  clockMs,
  unlimited,
  active,
  thinking,
}: PlayerStripProps) {
  return (
    <div
      className={cn(
        "glass-panel flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all sm:gap-4 sm:px-4",
        active && "border-gold/35 shadow-[0_0_30px_-8px_rgba(212,175,55,0.4)]"
      )}
      aria-label={`${name} — ${color}`}
    >
      {/* avatar */}
      <div
        className={cn(
          "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full ring-1 sm:h-11 sm:w-11",
          color === "white"
            ? "bg-gradient-to-br from-[#fdf9ec] to-[#cbbd97] ring-black/30"
            : "bg-gradient-to-br from-[#3a3f4b] to-[#0c0e13] ring-gold/40",
          active && "ring-2 ring-gold/70"
        )}
      >
        <Crown
          className={cn(
            "h-5 w-5",
            color === "white" ? "text-[#8a6a24]" : "text-gold-soft"
          )}
          strokeWidth={1.8}
        />
        {active && (
          <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold opacity-60" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-gold" />
          </span>
        )}
      </div>

      {/* name + captured */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold tracking-wide text-foreground/95 sm:text-base">
            {name}
          </span>
          {badge && (
            <span className="hidden rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300 sm:inline-block">
              {badge}
            </span>
          )}
          {thinking && (
            <span className="inline-flex items-center gap-1 rounded-full border border-gold/30 bg-gold/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gold-soft">
              <Sparkles className="h-3 w-3" />
              Thinking
              <span className="thinking-dot">.</span>
              <span className="thinking-dot" style={{ animationDelay: "0.15s" }}>.</span>
              <span className="thinking-dot" style={{ animationDelay: "0.3s" }}>.</span>
            </span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          <div className="flex flex-wrap items-center -space-x-1">
            {captured.map((p, i) => (
              <PieceGlyph
                key={`${p}-${i}`}
                type={p}
                color={color === "white" ? "b" : "w"}
                size={17}
              />
            ))}
            {captured.length === 0 && (
              <span className="text-[11px] italic text-foreground/35">no captures yet</span>
            )}
          </div>
          {materialDiff > 0 && (
            <span className="rounded bg-emerald-400/15 px-1.5 py-0.5 text-[11px] font-bold text-emerald-300">
              +{materialDiff}
            </span>
          )}
        </div>
      </div>

      {/* clock */}
      <Clock ms={clockMs} active={active} unlimited={unlimited} />
    </div>
  );
}

/* ---------------- Evaluation bar ---------------- */

export function EvalBar({ evalCp, mateIn }: { evalCp: number | null; mateIn?: number }) {
  // 0 → perfectly equal; +cp → white better
  const cp = evalCp ?? 0;
  let whiteShare = 50;
  if (mateIn !== undefined) {
    whiteShare = cp > 0 ? 100 : 0;
  } else if (evalCp !== null) {
    const clamped = Math.max(-1200, Math.min(1200, cp));
    whiteShare = 100 * (2 / (1 + Math.exp(-clamped / 380)) - 0.5) + 50;
    whiteShare = Math.max(3, Math.min(97, whiteShare));
  }

  const label =
    mateIn !== undefined
      ? `M${mateIn}${cp < 0 ? "→" : ""}`
      : evalCp === null
        ? "0.0"
        : `${cp >= 0 ? "+" : "−"}${(Math.abs(cp) / 100).toFixed(1)}`;

  return (
    <div className="flex items-center gap-3" aria-label={`Engine evaluation ${label}`}>
      <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-[#101318] shadow-[inset_0_1px_3px_rgba(0,0,0,0.8)] ring-1 ring-white/10">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[#f2e7c4] via-[#e5d3a1] to-[#cbb98a] transition-[width] duration-700 ease-out"
          style={{ width: `${whiteShare}%` }}
        />
        <div className="absolute inset-y-0 left-1/2 w-px bg-white/25" />
      </div>
      <span
        className={cn(
          "min-w-[3.2rem] rounded-md px-2 py-1 text-center font-mono text-xs font-bold tabular-nums",
          evalCp === null
            ? "bg-white/5 text-foreground/50"
            : cp > 0
              ? "bg-gold/15 text-gold-soft"
              : cp < 0
                ? "bg-emerald-400/15 text-emerald-300"
                : "bg-white/10 text-foreground/70"
        )}
      >
        {label}
      </span>
    </div>
  );
}
