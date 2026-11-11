"use client";

/**
 * Sovereign Chess — the shell.
 * Three persistent rooms: Play (arena), Analyze (oracle) and Learn (academy).
 * All views stay mounted so game/analysis/puzzle state survives tab switches.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useChessGame } from "@/hooks/use-chess-game";
import { PlayView } from "@/components/chess/play-view";
import { DuelView } from "@/components/chess/duel-view";
import { ArcadeView } from "@/components/arcade/arcade-view";
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
import { flushWalletQueue } from "@/lib/diamonds";
import { serializeGame } from "@/lib/chess-utils";
import { setPlatformTotals } from "@/lib/career";
import { pulse } from "@/lib/haptics";
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
  const [focusMode, setFocusMode] = useState(false);
  const archiveRef = useRef<Map<string, StoredGame>>(new Map());

  // cloud boot — drain any queued games + wallet records + refresh the
  // archive counter once, after the page has painted (fire-and-forget;
  // the app never depends on it)
  useEffect(() => {
    const t = window.setTimeout(() => {
      void flushQueue();
      void flushWalletQueue();
      void fetchCloudGameCount();
    }, 2600);
    return () => window.clearTimeout(t);
  }, []);

  // restore Focus Mode preference (only meaningful inside the play room)
  useEffect(() => {
    try {
      if (window.localStorage.getItem("sovereign.focus") === "1") {
        const r = requestAnimationFrame(() => setFocusMode(true));
        return () => cancelAnimationFrame(r);
      }
    } catch {
      /* private mode — default to the full layout */
    }
  }, []);

  const toggleFocusMode = useCallback(() => {
    pulse("achievement");
    setFocusMode((f) => {
      const next = !f;
      try {
        window.localStorage.setItem("sovereign.focus", next ? "1" : "0");
      } catch {
        /* session-only preference */
      }
      return next;
    });
  }, []);

  // Escape leaves Focus Mode on desktop — the arena always has a way out
  useEffect(() => {
    if (!focusMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") toggleFocusMode();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusMode, toggleFocusMode]);

  // PWA shortcut / notification deep links — "/?tab=analyze" opens the oracle
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (
      t === "play" ||
      t === "duel" ||
      t === "arcade" ||
      t === "learn" ||
      t === "analyze" ||
      t === "career"
    ) {
      const r = requestAnimationFrame(() => setTab(t));
      return () => cancelAnimationFrame(r);
    }
  }, []);

  // Focus Mode is an arena concept — any other room returns the full chrome
  const focusOn = focusMode && tab === "play";

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
    /* SOVEREIGN APP SHELL — a fixed-height column. The document never
       scrolls; each room owns an internal scroll surface, so tab switch
       never loses position and the browser can never yank the viewport. */
    <div className="flex h-dvh flex-col overflow-hidden">
      <AuroraBackground />
      {!focusOn && (
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
      )}

      <main
        className={cn(
          "relative z-10 mx-auto flex w-full max-w-7xl min-h-0 flex-1 flex-col",
          focusOn ? "px-0" : "px-3 pt-4 sm:px-6"
        )}
      >
        {/* ---------------- play room ---------------- */}
        <div className={cn("flex min-h-0 flex-1 flex-col", tab !== "play" && "hidden")}>
          <div
            className={cn(
              "tab-scroll min-h-0 flex-1",
              focusOn ? "px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2" : "pb-36 pt-1 lg:pb-6"
            )}
          >
            <PlayView
              game={game}
              focus={focusOn}
              onToggleFocus={toggleFocusMode}
              onRequestNewGame={() => setNewGameOpen(true)}
            />
          </div>
        </div>

        {/* ---------------- duel room ---------------- */}
        <div className={cn("flex min-h-0 flex-1 flex-col", tab !== "duel" && "hidden")}>
          <div className="tab-scroll min-h-0 flex-1 pb-36 pt-1 lg:pb-6">
            <DuelView />
          </div>
        </div>

        {/* ---------------- arcade room ---------------- */}
        <div className={cn("flex min-h-0 flex-1 flex-col", tab !== "arcade" && "hidden")}>
          <div className="min-h-0 flex-1 pt-1">
            <ArcadeView />
          </div>
        </div>

        {/* ---------------- analyze room ---------------- */}
        <div className={cn("flex min-h-0 flex-1 flex-col", tab !== "analyze" && "hidden")}>
          <div className="tab-scroll min-h-0 flex-1 pb-36 pt-1 lg:pb-6">
            <AnalyzeView
              pendingGame={pendingGame}
              onConsumePendingGame={() => setPendingGame(null)}
            />
          </div>
        </div>

        {/* ---------------- learn room ---------------- */}
        <div className={cn("flex min-h-0 flex-1 flex-col", tab !== "learn" && "hidden")}>
          <div className="tab-scroll min-h-0 flex-1 pb-36 pt-1 lg:pb-6">
            <LearnView />
          </div>
        </div>

        {/* ---------------- career room ---------------- */}
        <div className={cn("flex min-h-0 flex-1 flex-col", tab !== "career" && "hidden")}>
          <div className="tab-scroll min-h-0 flex-1 pb-36 pt-1 lg:pb-6">
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
        </div>
      </main>

      {!focusOn && <Footer />}

      {!focusOn && <BottomNav tab={tab} onTab={setTab} />}

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
