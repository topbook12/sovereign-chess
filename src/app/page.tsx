"use client";

/**
 * Sovereign Chess — the shell.
 * Three persistent rooms: Play (arena), Analyze (oracle) and Learn (academy).
 * All views stay mounted so game/analysis/puzzle state survives tab switches.
 */

import { useState } from "react";
import { useChessGame } from "@/hooks/use-chess-game";
import { PlayView } from "@/components/chess/play-view";
import { AnalyzeView } from "@/components/chess/analyze-view";
import { LearnView } from "@/components/chess/learn-view";
import {
  DrawOfferDialog,
  GameOverDialog,
  NewGameDialog,
  RulesDialog,
} from "@/components/chess/dialogs";
import { AuroraBackground, Footer, Header } from "@/components/chess/chrome";
import { BottomNav, type AppTab } from "@/components/chess/bottom-nav";
import { saveRecentGame, type StoredGame } from "@/lib/game-store";
import { Chess } from "chess.js";
import { cn } from "@/lib/utils";

const LEVEL_LABELS: Record<string, string> = {
  easy: "Apprentice",
  medium: "Knight",
  hard: "Grandmaster",
  master: "Sovereign",
};

export default function Home() {
  const game = useChessGame();
  const [tab, setTab] = useState<AppTab>("play");
  const [newGameOpen, setNewGameOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [pendingGame, setPendingGame] = useState<StoredGame | null>(null);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  const resultKey = game.result
    ? `${game.result.reason}-${game.result.winner ?? "none"}-${game.history.length}`
    : null;
  const gameOverOpen =
    game.status === "ended" && game.result !== null && resultKey !== dismissedKey;

  /** serialize the finished game into the learning store, then jump to analysis */
  const analyzeCurrentGame = () => {
    if (!game.result || game.history.length === 0) return;
    setDismissedKey(resultKey); // close the game-over modal on this path
    try {
      const c = new Chess();
      for (const m of game.history) {
        c.move({ from: m.from, to: m.to, promotion: m.promotion });
      }
      const resultStr =
        game.result.winner === "white"
          ? "1-0"
          : game.result.winner === "black"
            ? "0-1"
            : "1/2-1/2";
      c.header(
        "Event",
        "Sovereign Chess",
        "White",
        game.mode === "ai" && game.humanColor !== "white" ? "The Grandmaster" : "White",
        "Black",
        game.mode === "ai" && game.humanColor !== "black" ? "The Grandmaster" : "Black",
        "Result",
        resultStr
      );
      const label =
        game.mode === "ai"
          ? `You vs The Grandmaster (${LEVEL_LABELS[game.difficulty]})`
          : "White vs Black — two players";
      const stored = saveRecentGame({
        pgn: c.pgn(),
        plies: game.history.length,
        result: resultStr,
        label,
        reason: game.result.reason,
      });
      setPendingGame(stored);
      setTab("analyze");
    } catch {
      /* serialization hiccup — non-fatal */
    }
  };

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
            onAnalyzeGame={analyzeCurrentGame}
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
