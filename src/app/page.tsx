"use client";

/**
 * Sovereign Chess — the shell.
 * Three persistent rooms: Play (arena), Analyze (oracle) and Learn (academy).
 * All views stay mounted so game/analysis/puzzle state survives tab switches.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useChessGame } from "@/hooks/use-chess-game";
import { PlayView } from "@/components/chess/play-view";
import { AnalyzeView } from "@/components/chess/analyze-view";
import { LearnView } from "@/components/chess/learn-view";
import { CareerView } from "@/components/chess/career-view";
import {
  DrawOfferDialog,
  GameOverDialog,
  NewGameDialog,
  RulesDialog,
} from "@/components/chess/dialogs";
import { AuroraBackground, Footer, Header } from "@/components/chess/chrome";
import { BottomNav, type AppTab } from "@/components/chess/bottom-nav";
import { type StoredGame, loadRecentGames } from "@/lib/game-store";
import { fetchCloudGameCount, flushQueue } from "@/lib/cloud";
import { serializeGame } from "@/lib/chess-utils";
import { setPlatformTotals } from "@/lib/career";
import { PUZZLES, OPENINGS } from "@/lib/puzzles";
import { cn } from "@/lib/utils";

// tell the career engine how many puzzles / openings the academy holds
setPlatformTotals(PUZZLES.length, OPENINGS.length);

export default function Home() {
  const game = useChessGame();
  const [tab, setTab] = useState<AppTab>("play");
  const [newGameOpen, setNewGameOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [pendingGame, setPendingGame] = useState<StoredGame | null>(null);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const archiveRef = useRef<Map<string, StoredGame>>(new Map());

  // cloud boot — drain any queued games + refresh the archive counter once,
  // after the page has painted (fire-and-forget; the app never depends on it)
  useEffect(() => {
    const t = window.setTimeout(() => {
      void flushQueue();
      void fetchCloudGameCount();
    }, 2600);
    return () => window.clearTimeout(t);
  }, []);

  const resultKey = game.result
    ? `${game.result.reason}-${game.result.winner ?? "none"}-${game.history.length}`
    : null;
  const gameOverOpen =
    game.status === "ended" && game.result !== null && resultKey !== dismissedKey;

  /** serialize once per finished game (deduped), persisting into Recent Duels */
  const archiveCurrentGame = useCallback((): StoredGame | null => {
    if (!resultKey || game.status !== "ended") return null;
    const cached = archiveRef.current.get(resultKey);
    if (cached) return cached;
    const stored = serializeGame(game);
    if (stored) archiveRef.current.set(resultKey, stored);
    return stored;
  }, [game, resultKey]);

  // auto-archive every finished duel into Recent Duels (external write, no state)
  useEffect(() => {
    if (game.status === "ended") archiveCurrentGame();
  }, [game.status, archiveCurrentGame]);

  /** jump into the oracle with the finished game loaded */
  const analyzeCurrentGame = useCallback(() => {
    const stored = archiveCurrentGame();
    if (!stored) return;
    setDismissedKey(resultKey); // close the game-over modal on this path
    setPendingGame(stored);
    setTab("analyze");
  }, [archiveCurrentGame, resultKey]);

  return (
    <div className="flex min-h-dvh flex-col">
      <AuroraBackground />
      <Header
        game={game}
        tab={tab}
        onTab={setTab}
        onNewGame={() => {
          setTab("play");
          setNewGameOpen(true);
        }}
        onRules={() => setRulesOpen(true)}
      />

      <main className="relative z-10 mx-auto w-full max-w-7xl flex-1 px-3 pb-28 pt-4 sm:px-6 lg:pb-10">
        {/* ---------------- play room ---------------- */}
        <div className={cn(tab !== "play" && "hidden")}>
          <PlayView
            game={game}
            onRequestNewGame={() => setNewGameOpen(true)}
          />
        </div>

        {/* ---------------- analyze room ---------------- */}
        <div className={cn(tab !== "analyze" && "hidden")}>
          <AnalyzeView
            pendingGame={pendingGame}
            onConsumePendingGame={() => setPendingGame(null)}
          />
        </div>

        {/* ---------------- learn room ---------------- */}
        <div className={cn(tab !== "learn" && "hidden")}>
          <LearnView />
        </div>

        {/* ---------------- career room ---------------- */}
        <div className={cn(tab !== "career" && "hidden")}>
          <CareerView
            onGoAnalyze={(gameId) => {
              // hand the chosen duel straight to the oracle
              const stored = gameId
                ? loadRecentGames().find((x) => x.id === gameId) ?? null
                : null;
              if (stored) setPendingGame(stored);
              setTab("analyze");
            }}
          />
        </div>
      </main>

      <Footer />

      <BottomNav tab={tab} onTab={setTab} />

      <NewGameDialog
        key={newGameOpen ? "ng-open" : "ng-closed"}
        open={newGameOpen}
        onOpenChange={setNewGameOpen}
        game={game}
      />
      <GameOverDialog
        open={gameOverOpen}
        onOpenChange={(v) => {
          if (!v) setDismissedKey(resultKey);
        }}
        game={game}
        onAnalyze={analyzeCurrentGame}
        onOpenCareer={() => setTab("career")}
      />
      <DrawOfferDialog game={game} />
      <RulesDialog open={rulesOpen} onOpenChange={setRulesOpen} />

      {/* subtle gold top glow */}
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none fixed inset-x-0 top-0 z-[5] h-40",
          "bg-[radial-gradient(ellipse_60%_100%_at_50%_0%,rgba(212,175,55,0.08),transparent_70%)]"
        )}
      />
    </div>
  );
}
