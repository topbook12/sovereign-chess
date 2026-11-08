"use client";

import { Bot, Crown, Info, ScrollText, ShieldCheck, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ChessGame } from "@/hooks/use-chess-game";
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

export function Header({
  game,
  onNewGame,
  onRules,
}: {
  game: ChessGame;
  onNewGame: () => void;
  onRules: () => void;
}) {
  return (
    <header className="relative z-10 border-b border-white/6 bg-black/25 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-3 px-3 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="logo-glow flex h-10 w-10 items-center justify-center rounded-xl border border-gold/40 bg-gradient-to-b from-gold/25 to-transparent">
            <Crown className="h-5.5 w-5.5 text-gold-soft" strokeWidth={1.7} />
          </div>
          <div className="leading-none">
            <h1 className="font-display text-xl font-black tracking-[0.18em] text-gold-gradient sm:text-2xl">
              SOVEREIGN
            </h1>
            <p className="mt-1 text-[9.5px] font-semibold uppercase tracking-[0.42em] text-foreground/40">
              Royale Chess
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {game.mode === "ai" && (
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
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => game.setSoundOn(!game.soundOn)}
                  className="h-9 w-9 border-white/10 bg-white/5 text-foreground/80 hover:border-gold/40 hover:bg-white/10"
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
                  className="h-9 w-9 border-white/10 bg-white/5 text-foreground/80 hover:border-gold/40 hover:bg-white/10"
                  aria-label="Rules"
                >
                  <ScrollText className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Rules & features</TooltipContent>
            </Tooltip>

            <Button
              onClick={onNewGame}
              className="h-9 border border-[#8a6a24]/50 bg-gradient-to-b from-[#ecca6f] to-[#c69c3f] px-3.5 text-[13px] font-semibold text-[#241a05] hover:from-[#f3d887] hover:to-[#d4a94e]"
            >
              <Info className="mr-1 h-3.5 w-3.5 sm:hidden" />
              <span className="hidden sm:inline">New Game</span>
              <span className="sm:hidden">New</span>
            </Button>
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
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/80" />
            Alpha–Beta Oracle
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-gold/80" />
            Fischer Clocks
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-red-400/70" />
            Regulation Rules
          </span>
        </span>
      </div>
    </footer>
  );
}
