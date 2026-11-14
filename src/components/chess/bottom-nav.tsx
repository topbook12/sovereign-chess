"use client";

/**
 * BottomNav — pro-grade floating navigation for phones.
 * A levelling glass pill with a golden sliding crown-glow, haptic ticks,
 * safe-area clearance for notches and home bars, and 52px+ touch targets.
 * Desktop uses the header tabs instead.
 */

import { BookOpen, ChartLine, Gamepad2, Gem, Swords, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { pulse } from "@/lib/haptics";

export type AppTab = "play" | "duel" | "arcade" | "analyze" | "learn" | "career";

const TABS: { id: AppTab; label: string; icon: React.ReactNode }[] = [
  { id: "play", label: "Play", icon: <Swords className="h-5 w-5" /> },
  { id: "duel", label: "Duel", icon: <Gem className="h-5 w-5" /> },
  { id: "arcade", label: "Arcade", icon: <Gamepad2 className="h-5 w-5" /> },
  { id: "learn", label: "Learn", icon: <BookOpen className="h-5 w-5" /> },
  { id: "analyze", label: "Analyze", icon: <ChartLine className="h-5 w-5" /> },
  { id: "career", label: "Career", icon: <Trophy className="h-5 w-5" /> },
];

export function BottomNav({
  tab,
  onTab,
}: {
  tab: AppTab;
  onTab: (t: AppTab) => void;
}) {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 z-40 lg:hidden"
      style={{ bottom: "calc(0.65rem + env(safe-area-inset-bottom))" }}
    >
      {/* levelling shadow island under the pill */}
      <div className="pointer-events-none absolute inset-x-6 bottom-0 h-6 rounded-[999px] bg-black/70 blur-xl" />

      <div className="relative mx-auto max-w-md px-3">
        <div className="nav-pill rounded-2xl border border-white/12 bg-black/65 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.9)] backdrop-blur-2xl">
          <div className="flex items-stretch justify-around p-1.5">
            {TABS.map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    if (!active) pulse("tick");
                    onTab(t.id);
                  }}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex min-h-[54px] min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 transition-transform duration-200",
                    active ? "scale-[1.02]" : "active:scale-95"
                  )}
                >
                  {active && (
                    <>
                      <span className="absolute inset-0 rounded-xl border border-[#8a6a24]/60 bg-gradient-to-b from-[#ecca6f] to-[#c69c3f] shadow-[0_0_24px_-4px_rgba(212,175,55,0.75)]" />
                      <span className="absolute -top-px left-1/2 h-px w-2/3 -translate-x-1/2 bg-gradient-to-r from-transparent via-[#fff3cd] to-transparent" />
                    </>
                  )}
                  <span
                    className={cn(
                      "relative transition-colors",
                      active ? "text-[#241a05]" : "text-foreground/55"
                    )}
                  >
                    {t.icon}
                  </span>
                  <span
                    className={cn(
                      "relative whitespace-nowrap text-[9.5px] font-bold uppercase tracking-[0.03em] transition-colors",
                      active ? "text-[#241a05]" : "text-foreground/50"
                    )}
                  >
                    {t.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </nav>
  );
}
