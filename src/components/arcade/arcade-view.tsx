"use client";

/**
 * Sovereign Arcade — the game room.
 *
 * Snake is live today; Ludo and Carrom are on the workbench and will ride
 * the same rails (wallet, diamonds, rake, records) when they land.
 */

import { Dices, Gamepad2, Target, Worm } from "lucide-react";
import { useState } from "react";

import { SnakeView } from "@/components/arcade/snake-view";
import { pulse } from "@/lib/haptics";
import { playSound } from "@/lib/sounds";
import { cn } from "@/lib/utils";

type GameId = "snake" | "ludo" | "carrom";

const GAMES: {
  id: GameId;
  name: string;
  tag: string;
  icon: React.ReactNode;
  live: boolean;
}[] = [
  { id: "snake", name: "Snake", tag: "Live", icon: <Worm className="h-4 w-4" />, live: true },
  { id: "ludo", name: "Ludo", tag: "Soon", icon: <Dices className="h-4 w-4" />, live: false },
  { id: "carrom", name: "Carrom", tag: "Soon", icon: <Target className="h-4 w-4" />, live: false },
];

export function ArcadeView() {
  const [game, setGame] = useState<GameId>("snake");
  const current = GAMES.find((g) => g.id === game) ?? GAMES[0];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* game selector */}
      <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
        {GAMES.map((g) => {
          const active = g.id === game;
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => {
                if (!active) {
                  pulse("tick");
                  playSound("select");
                  setGame(g.id);
                }
              }}
              aria-pressed={active}
              className={cn(
                "flex h-11 shrink-0 items-center gap-2 rounded-xl border px-3.5 text-[12.5px] font-bold uppercase tracking-[0.1em] transition active:scale-95",
                active
                  ? "border-[#8a6a24]/60 bg-gradient-to-b from-[#ecca6f] to-[#c69c3f] text-[#241a05] shadow-[0_0_20px_-6px_rgba(212,175,55,0.8)]"
                  : "border-white/10 bg-white/[0.045] text-foreground/60 hover:border-white/20 hover:text-foreground/80"
              )}
            >
              {g.icon}
              {g.name}
              {!g.live && (
                <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[9px] font-bold tracking-normal text-white/60">
                  {g.tag}
                </span>
              )}
            </button>
          );
        })}
        <div className="ml-auto hidden items-center gap-1.5 pl-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/30 sm:flex">
          <Gamepad2 className="h-3.5 w-3.5" />
          Arcade
        </div>
      </div>

      {game === "snake" ? (
        <SnakeView />
      ) : (
        <div className="tab-scroll flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-full flex-1 items-center justify-center p-4 pb-24 lg:pb-6">
            <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.035] p-7 text-center backdrop-blur-sm">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-[#8a6a24]/50 bg-gradient-to-b from-[#ecca6f]/20 to-transparent shadow-[0_0_36px_-10px_rgba(212,175,55,0.6)]">
                {current.icon}
              </div>
              <h3 className="mt-4 text-2xl font-black tracking-wide text-amber-100">
                {current.name}
              </h3>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.3em] text-amber-300/70">
                In the workshop
              </p>
              <p className="mt-3 text-sm leading-relaxed text-white/50">
                The next arena is being carved. Same wallet, same diamonds, same
                rake — more games. Snake stays open while we build.
              </p>
              <button
                type="button"
                onClick={() => {
                  pulse("tick");
                  playSound("select");
                  setGame("snake");
                }}
                className="mt-5 inline-flex h-11 items-center gap-2 rounded-xl bg-gradient-to-b from-[#f5d97a] via-[#e3b84f] to-[#b8860b] px-6 text-xs font-black uppercase tracking-[0.14em] text-[#241a05] shadow-[0_8px_24px_-8px_rgba(212,175,55,0.7)] transition active:scale-95"
              >
                <Worm className="h-4 w-4" />
                Play Snake instead
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
