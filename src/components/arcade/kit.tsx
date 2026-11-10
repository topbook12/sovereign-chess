"use client";

/**
 * Sovereign Chess — Arcade UI kit.
 * Shared chrome for every stake game so Ludo, Carrom and Snake Duel feel
 * like siblings of the arena: gold-on-obsidian glass, 44px+ touch targets,
 * thumb-reachable controls and a pass-the-device ceremony.
 */

import { useEffect, useState } from "react";
import { DoorOpen, Hand, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ArcadePlayer } from "@/lib/arcade-types";
import { pulse } from "@/lib/haptics";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------- */
/* player chip — name, emoji, live score, turn glow                 */
/* ---------------------------------------------------------------- */

export function PlayerChip({
  player,
  score,
  active,
  sub,
}: {
  player: ArcadePlayer;
  score?: React.ReactNode;
  active?: boolean;
  sub?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 items-center gap-2.5 rounded-xl border px-3 py-2 transition-all duration-300",
        active
          ? "border-gold/60 bg-gradient-to-b from-gold/20 to-transparent shadow-[0_0_20px_-6px_rgba(212,175,55,0.65)]"
          : "border-white/10 bg-white/[0.03]"
      )}
    >
      <span
        className={cn(
          "grid h-9 w-9 shrink-0 place-items-center rounded-lg border text-lg transition-all",
          active
            ? "border-gold/50 bg-gold/15"
            : "border-white/10 bg-black/40 opacity-70"
        )}
        aria-hidden="true"
      >
        {player.emoji}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-black tracking-wide text-foreground/90">
          {player.name}
        </span>
        <span className="block truncate text-[10px] font-bold uppercase tracking-[0.16em] text-foreground/45">
          {sub ?? (active ? "Your move" : "Waiting")}
        </span>
      </span>
      {score !== undefined && (
        <span className="shrink-0 font-mono text-xl font-black tabular-nums text-gold-soft">
          {score}
        </span>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* GameFrame — the arena shell every game renders inside            */
/* ---------------------------------------------------------------- */

export function GameFrame({
  title,
  players,
  scores,
  turn,
  turnLabel,
  onExit,
  children,
  footer,
}: {
  title: string;
  players: [ArcadePlayer, ArcadePlayer];
  scores?: [React.ReactNode, React.ReactNode];
  /** 0 | 1 → whose turn; null → nobody (between phases) */
  turn?: 0 | 1 | null;
  turnLabel?: [string, string];
  onExit: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* header */}
      <div className="flex items-center gap-2">
        <h3 className="font-display min-w-0 flex-1 truncate text-lg font-black tracking-wide">
          <span className="text-gold-gradient">{title}</span>
        </h3>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            pulse("tick");
            onExit();
          }}
          aria-label="Leave the match"
          className="h-10 shrink-0 border-red-400/30 bg-red-500/10 px-3 text-[12px] font-bold text-red-300 hover:border-red-400/60 hover:bg-red-500/20"
        >
          <DoorOpen className="mr-1.5 h-4 w-4" />
          Leave
        </Button>
      </div>

      {/* players */}
      <div className="flex gap-2">
        <PlayerChip
          player={players[0]}
          score={scores?.[0]}
          active={turn === 0}
          sub={turnLabel?.[0]}
        />
        <PlayerChip
          player={players[1]}
          score={scores?.[1]}
          active={turn === 1}
          sub={turnLabel?.[1]}
        />
      </div>

      {/* board / canvas — games manage their own touch behaviour */}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
        {children}
      </div>

      {footer && <div className="shrink-0">{footer}</div>}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* PassDevice — the hand-over ceremony between turns / runs         */
/* ---------------------------------------------------------------- */

export function PassDevice({
  from,
  to,
  note,
  onReady,
}: {
  from: ArcadePlayer;
  to: ArcadePlayer;
  note?: string;
  onReady: () => void;
}) {
  const [countdown, setCountdown] = useState(3);
  useEffect(() => {
    const iv = window.setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          window.clearInterval(iv);
          return 0;
        }
        return c - 1;
      });
    }, 850);
    return () => window.clearInterval(iv);
  }, []);

  return (
    <div className="fixed inset-0 z-[80] flex flex-col items-center justify-center gap-6 bg-black/85 px-6 backdrop-blur-md">
      <div className="flex items-center gap-4">
        <span className="grid h-16 w-16 place-items-center rounded-2xl border border-white/15 bg-white/5 text-3xl" aria-hidden="true">
          {from.emoji}
        </span>
        <Hand className="h-8 w-8 animate-pulse text-gold-soft" aria-hidden="true" />
        <span className="grid h-16 w-16 place-items-center rounded-2xl border border-gold/50 bg-gold/15 text-3xl" aria-hidden="true">
          {to.emoji}
        </span>
      </div>
      <div className="text-center">
        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground/40">
          Pass the device
        </p>
        <h4 className="font-display mt-1 text-2xl font-black text-gold-gradient">
          {to.name}, get ready
        </h4>
        {note && <p className="mt-2 max-w-xs text-[12.5px] text-foreground/55">{note}</p>}
      </div>
      <Button
        size="lg"
        disabled={countdown > 0}
        onClick={() => {
          pulse("achievement");
          onReady();
        }}
        className="h-14 min-w-56 border border-[#8a6a24]/50 bg-gradient-to-b from-[#ecca6f] to-[#c69c3f] text-[15px] font-black text-[#241a05] shadow-[0_0_30px_-8px_rgba(212,175,55,0.7)] hover:from-[#f3d887]"
      >
        {countdown > 0 ? (
          <>
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            {countdown}…
          </>
        ) : (
          "I'm ready — start"
        )}
      </Button>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Tiny helpers                                                     */
/* ---------------------------------------------------------------- */

/** Deterministic PRNG (mulberry32) — same seed, same luck for both players. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
