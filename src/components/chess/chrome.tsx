"use client";

import {
  BookOpen,
  Bot,
  ChartLine,
  Crown,
  Flame,
  Gem,
  Info,
  ScrollText,
  ShieldCheck,
  Swords,
  TrendingUp,
  Trophy,
  Volume2,
  VolumeX,
  WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CloudDot } from "@/components/chess/data-vault";
import { InstallButton } from "@/components/pwa/install-button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ChessGame } from "@/hooks/use-chess-game";
import type { AppTab } from "@/components/chess/bottom-nav";
import { useCareer } from "@/hooks/use-career";
import { usePwaStore } from "@/lib/pwa-store";
import { dateKey } from "@/lib/career";
import { cn } from "@/lib/utils";

/* ---------------- Aurora background ---------------- */

export function AuroraBackground() {
  return (
    <div className="aurora-layer" aria-hidden="true">
      <div className="aurora-blob aurora-blob-1" />
      <div className="aurora-blob aurora-blob-2" />
      <div className="aurora-blob aurora-blob-3" />
      <div className="aurora-noise" />
      <div className="aurora-vignette" />
    </div>
  );
}

/* ---------------- Header ---------------- */

const NAV_ITEMS: { id: AppTab; label: string; icon: React.ReactNode }[] = [
  { id: "play", label: "Play", icon: <Swords className="h-3.5 w-3.5" /> },
  { id: "duel", label: "Duel", icon: <Gem className="h-3.5 w-3.5" /> },
  { id: "learn", label: "Learn", icon: <BookOpen className="h-3.5 w-3.5" /> },
  { id: "analyze", label: "Analyze", icon: <ChartLine className="h-3.5 w-3.5" /> },
  { id: "career", label: "Career", icon: <Trophy className="h-3.5 w-3.5" /> },
];

export function Header({
  game,
  tab,
  onTab,
  onNewGame,
  onRules,
}: {
  game: ChessGame;
  tab: AppTab;
  onTab: (t: AppTab) => void;
  onNewGame: () => void;
  onRules: () => void;
}) {
  const career = useCareer();
  const offline = usePwaStore((s) => s.offline);
  const trainedToday = career.lastActiveDate === dateKey();

  return (
    <header
      className="relative z-10 border-b border-white/6 bg-black/25 backdrop-blur-md"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-3 px-3 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="logo-glow flex h-10 w-10 items-center justify-center rounded-xl border border-gold/40 bg-gradient-to-b from-gold/25 to-transparent">
            <Crown className="h-5.5 w-5.5 text-gold-soft" strokeWidth={1.7} />
          </div>
          <div className="leading-none">
            <h1 className="font-display text-xl font-black tracking-[0.18em] text-gold-gradient sm:text-2xl">
              SOVEREIGN
            </h1>
            <p className="mt-1 hidden text-[9.5px] font-semibold uppercase tracking-[0.42em] text-foreground/40 sm:block">
              Play · Analyze · Master
            </p>
          </div>
        </div>

        {/* desktop room tabs */}
        <nav
          aria-label="Rooms"
          className="hidden items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] p-1 md:flex"
        >
          {NAV_ITEMS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onTab(t.id)}
              aria-current={tab === t.id ? "page" : undefined}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[12.5px] font-bold uppercase tracking-[0.12em] transition-all",
                tab === t.id
                  ? "border border-[#8a6a24]/50 bg-gradient-to-b from-[#ecca6f] to-[#c69c3f] text-[#241a05] shadow-[0_0_18px_-6px_rgba(212,175,55,0.8)]"
                  : "text-foreground/55 hover:text-foreground"
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {/* -------- offline status -------- */}
          {offline && (
            <span
              className="flex items-center gap-1.5 rounded-full border border-red-400/40 bg-red-500/10 px-2.5 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-red-300"
              aria-label="You are offline — the app keeps working on-device"
            >
              <WifiOff className="h-3 w-3" />
              Offline
            </span>
          )}

          {/* -------- career chips -------- */}
          <div className="hidden items-center gap-1.5 sm:flex">
            <button
              type="button"
              onClick={() => onTab("career")}
              className="flex items-center gap-1.5 rounded-full border border-gold/30 bg-gradient-to-b from-gold/15 to-transparent px-3 py-1.5 text-xs transition-colors hover:border-gold/60"
              aria-label="Your rating — open career"
            >
              <TrendingUp className="h-3.5 w-3.5 text-gold-soft" />
              <b className="font-mono text-gold-soft">{career.rating}</b>
              <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-foreground/40">
                elo
              </span>
            </button>
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs"
                  aria-label="Your crowns"
                >
                  <Crown className="h-3.5 w-3.5 text-gold-soft" />
                  <b className="font-mono text-foreground/90">{career.crowns}</b>
                </div>
              </TooltipTrigger>
              <TooltipContent>Crowns — earned everywhere, spent on hints</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors",
                    trainedToday
                      ? "border-orange-400/40 bg-orange-400/10"
                      : "border-white/10 bg-white/5 opacity-80"
                  )}
                  aria-label="Your daily training streak"
                >
                  <Flame
                    className={cn(
                      "h-3.5 w-3.5",
                      trainedToday ? "text-orange-300" : "text-foreground/40"
                    )}
                  />
                  <b
                    className={cn(
                      "font-mono",
                      trainedToday ? "text-orange-200" : "text-foreground/60"
                    )}
                  >
                    {career.dailyStreak}
                  </b>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                {trainedToday
                  ? `Streak day ${career.dailyStreak} — trained today`
                  : "Train today to keep the flame alive"}
              </TooltipContent>
            </Tooltip>
          </div>

          {/* mobile flame only */}
          <div
            className="flex items-center gap-1 rounded-full border border-orange-400/30 bg-orange-400/10 px-2.5 py-1.5 text-xs sm:hidden"
            aria-label="Daily streak"
          >
            <Flame className={cn("h-3.5 w-3.5", trainedToday ? "text-orange-300" : "text-foreground/40")} />
            <b className={cn("font-mono", trainedToday ? "text-orange-200" : "text-foreground/60")}>
              {career.dailyStreak}
            </b>
          </div>

          {game.mode === "ai" && tab === "play" && (
            <div
              className="hidden items-center gap-2.5 rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5 text-xs sm:flex"
              aria-label="Your record against the engine"
            >
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-300/80" />
              <span className="text-emerald-300">
                <b className="font-mono">{game.stats.wins}</b> W
              </span>
              <span className="text-foreground/25">·</span>
              <span className="text-gold-soft">
                <b className="font-mono">{game.stats.draws}</b> D
              </span>
              <span className="text-foreground/25">·</span>
              <span className="text-red-300/90">
                <b className="font-mono">{game.stats.losses}</b> L
              </span>
            </div>
          )}

          <TooltipProvider delayDuration={250}>
            <InstallButton />

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => game.setSoundOn(!game.soundOn)}
                  className="h-11 w-11 border-white/10 bg-white/5 text-foreground/80 hover:border-gold/40 hover:bg-white/10 sm:h-9 sm:w-9"
                  aria-label={game.soundOn ? "Mute sounds" : "Unmute sounds"}
                >
                  {game.soundOn ? (
                    <Volume2 className="h-4 w-4" />
                  ) : (
                    <VolumeX className="h-4 w-4 text-red-300/80" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{game.soundOn ? "Mute" : "Unmute"}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={onRules}
                  className="h-11 w-11 border-white/10 bg-white/5 text-foreground/80 hover:border-gold/40 hover:bg-white/10 sm:h-9 sm:w-9"
                  aria-label="Rules"
                >
                  <ScrollText className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Rules &amp; features</TooltipContent>
            </Tooltip>

            {tab === "play" && (
              <Button
                onClick={onNewGame}
                aria-label="New game"
                className="hidden h-9 border border-[#8a6a24]/50 bg-gradient-to-b from-[#ecca6f] to-[#c69c3f] px-2.5 text-[13px] font-semibold text-[#241a05] hover:from-[#f3d887] hover:to-[#d4a94e] sm:inline-flex sm:px-3.5"
              >
                <Info className="h-4 w-4 sm:mr-1" />
                <span className="hidden sm:inline">New Game</span>
              </Button>
            )}
          </TooltipProvider>
        </div>
      </div>
    </header>
  );
}

/* ---------------- Status strip ---------------- */

export function StatusStrip({ game }: { game: ChessGame }) {
  const {
    status,
    result,
    inCheck,
    turn,
    mode,
    humanColor,
    thinking,
    viewing,
    viewIndex,
    history,
  } = game;

  let content: React.ReactNode;
  if (viewing) {
    content = (
      <span className="text-emerald-300">
        Replaying move {viewIndex !== null ? viewIndex + 1 : ""} of {history.length} —
        history is a teacher
      </span>
    );
  } else if (status === "ended" && result) {
    content = (
      <span className="font-semibold text-gold-soft">
        {result.winner
          ? `Checkmate — ${result.winner === "white" ? "White" : "Black"} prevails`
          : "The battle ends in a draw"}
      </span>
    );
  } else if (thinking) {
    content = (
      <span className="text-gold-soft">
        <Bot className="mr-1.5 inline h-4 w-4" />
        The Grandmaster is calculating
        <span className="thinking-dot">.</span>
        <span className="thinking-dot" style={{ animationDelay: "0.15s" }}>.</span>
        <span className="thinking-dot" style={{ animationDelay: "0.3s" }}>.</span>
      </span>
    );
  } else {
    const yourTurn = mode === "human" || turn === (humanColor === "white" ? "w" : "b");
    content = (
      <span className={cn(yourTurn ? "text-emerald-300" : "text-foreground/60")}>
        {mode === "human"
          ? `${turn === "w" ? "White" : "Black"} to move`
          : yourTurn
            ? "Your move"
            : "Engine to move"}
        <span className="ml-2 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current align-middle" />
      </span>
    );
  }

  return (
    <div className="flex items-center justify-center gap-2">
      <div className="glass-panel flex min-h-9 items-center justify-center gap-2 rounded-full px-4 py-1.5 text-[13px]">
        {content}
      </div>
      {inCheck && status === "active" && !viewing && (
        <span className="animate-pulse rounded-full border border-red-400/50 bg-red-500/15 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.18em] text-red-300">
          Check
        </span>
      )}
    </div>
  );
}

/* ---------------- Footer ---------------- */

export function Footer() {
  return (
    <footer className="relative z-10 mt-auto border-t border-white/6 bg-black/30 px-4 py-3.5 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-2 text-[11px] text-foreground/40">
        <span className="flex items-center gap-2">
          <Crown className="h-3.5 w-3.5 text-gold-soft/70" />
          <span className="font-semibold tracking-wide text-foreground/55">
            Sovereign Chess
          </span>
          <span className="hidden sm:inline">— crafted for connoisseurs of the royal game.</span>
        </span>
        <span className="flex items-center gap-3">
          <CloudDot />
          <span className="hidden sm:flex sm:items-center sm:gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/80" />
            Device-Side Oracle
          </span>
          <span className="hidden md:flex md:items-center md:gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-gold/80" />
            Fischer Clocks
          </span>
          <span className="hidden lg:flex lg:items-center lg:gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-red-400/70" />
            Regulation Rules
          </span>
        </span>
      </div>
      {/* clearance for the floating mobile nav + home-bar safe area */}
      <div
        aria-hidden="true"
        className="lg:hidden"
        style={{ height: "calc(4.4rem + env(safe-area-inset-bottom))" }}
      />
    </footer>
  );
}
