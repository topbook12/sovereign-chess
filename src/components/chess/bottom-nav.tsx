"use client";

/**
 * BottomNav — premium mobile navigation (fixed, safe-area aware).
 * Desktop uses the header tabs instead.
 */

import { BookOpen, ChartLine, Swords, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";

export type AppTab = "play" | "analyze" | "learn" | "career";

const TABS: { id: AppTab; label: string; icon: React.ReactNode }[] = [
  { id: "play", label: "Play", icon: <Swords className="h-[18px] w-[18px]" /> },
  { id: "learn", label: "Learn", icon: <BookOpen className="h-[18px] w-[18px]" /> },
  { id: "analyze", label: "Analyze", icon: <ChartLine className="h-[18px] w-[18px]" /> },
  { id: "career", label: "Career", icon: <Trophy className="h-[18px] w-[18px]" /> },
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
      className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-black/60 backdrop-blur-xl lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto flex max-w-md items-stretch justify-around px-2 py-1.5">
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onTab(t.id)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex min-h-[52px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 transition-colors",
                active
                  ? "text-[#241a05]"
                  : "text-foreground/55 hover:text-foreground/90"
              )}
            >
              {active && (
                <span className="absolute inset-0 rounded-xl border border-[#8a6a24]/60 bg-gradient-to-b from-[#ecca6f] to-[#c69c3f] shadow-[0_0_22px_-6px_rgba(212,175,55,0.7)]" />
              )}
              <span className="relative">{t.icon}</span>
              <span className="relative text-[10.5px] font-bold uppercase tracking-[0.14em]">
                {t.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
