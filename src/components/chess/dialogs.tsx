"use client";

import { useState } from "react";
import {
  Bot,
  Crown,
  Handshake,
  RotateCcw,
  ScrollText,
  Sparkles,
  Swords,
  Timer,
  Trophy,
  Users,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  TIME_CONTROLS,
  type ChessGame,
  type Difficulty,
  type GameMode,
  type Side,
} from "@/hooks/use-chess-game";
import { cn } from "@/lib/utils";
import { PieceSvg } from "./piece-svg";

/* ================= New Game ================= */

const DIFFS: { id: Difficulty; label: string; desc: string }[] = [
  { id: "easy", label: "Apprentice", desc: "Learns from mistakes — yours." },
  { id: "medium", label: "Knight", desc: "Solid tactics, human-like." },
  { id: "hard", label: "Grandmaster", desc: "Punishes every slip." },
  { id: "master", label: "Sovereign", desc: "Merciless. Good luck." },
];

export function NewGameDialog({
  open,
  onOpenChange,
  game,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  game: ChessGame;
}) {
  // component is remounted (keyed) each time it opens, so local state always
  // starts from the live game settings — no sync effects needed
  const [mode, setMode] = useState<GameMode>(game.mode);
  const [difficulty, setDifficulty] = useState<Difficulty>(game.difficulty);
  const [side, setSide] = useState<Side | "random">(game.preferredSide);
  const [tcId, setTcId] = useState(game.activeTimeControl.id);

  const start = () => {
    game.newGame({ mode, difficulty, side, timeControlId: tcId });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-dialog max-h-[92dvh] max-w-md overflow-y-auto rounded-2xl sm:rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2 text-2xl text-gold-gradient">
            <Crown className="h-6 w-6 text-gold-soft" />
            Set the Board
          </DialogTitle>
          <DialogDescription className="text-foreground/55">
            Choose your battlefield — the engine awaits.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-1">
          {/* mode */}
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-foreground/45">
              Opponent
            </p>
            <div className="grid grid-cols-2 gap-2.5">
              <ModeOption
                active={mode === "ai"}
                onClick={() => setMode("ai")}
                icon={<Bot className="h-5 w-5" />}
                title="Play the AI"
                sub="The Grandmaster"
              />
              <ModeOption
                active={mode === "human"}
                onClick={() => setMode("human")}
                icon={<Users className="h-5 w-5" />}
                title="Two Players"
                sub="Share the throne"
              />
            </div>
          </div>

          {/* side (AI only) */}
          {mode === "ai" && (
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-foreground/45">
                Your Army
              </p>
              <div className="grid grid-cols-3 gap-2.5">
                {(["white", "random", "black"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setSide(s)}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 transition-all",
                      side === s
                        ? "border-gold/60 bg-gold/12 shadow-[0_0_24px_-6px_rgba(212,175,55,0.5)]"
                        : "border-white/10 bg-white/[0.03] hover:border-gold/30"
                    )}
                    aria-pressed={side === s}
                  >
                    <span className="h-8 w-8">
                      {s === "random" ? (
                        <Sparkles className="h-8 w-8 p-1 text-gold-soft" />
                      ) : (
                        <PieceSvg
                          type="k"
                          color={s === "white" ? "w" : "b"}
                          style={{ width: "100%", height: "100%" }}
                        />
                      )}
                    </span>
                    <span className="text-xs font-semibold capitalize text-foreground/85">
                      {s}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* difficulty (AI only) */}
          {mode === "ai" && (
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-foreground/45">
                Engine Strength
              </p>
              <div className="grid grid-cols-2 gap-2.5">
                {DIFFS.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => setDifficulty(d.id)}
                    className={cn(
                      "rounded-xl border px-3 py-2.5 text-left transition-all",
                      difficulty === d.id
                        ? "border-emerald-400/60 bg-emerald-400/10 shadow-[0_0_24px_-8px_rgba(56,224,175,0.5)]"
                        : "border-white/10 bg-white/[0.03] hover:border-emerald-400/30"
                    )}
                    aria-pressed={difficulty === d.id}
                  >
                    <span className="block text-[13px] font-bold text-foreground/90">
                      {d.label}
                    </span>
                    <span className="block text-[10.5px] leading-tight text-foreground/45">
                      {d.desc}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* time control */}
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-foreground/45">
              <Timer className="h-3.5 w-3.5" /> Time Control
            </p>
            <Select value={tcId} onValueChange={setTcId}>
              <SelectTrigger className="h-11 w-full border-white/10 bg-white/5 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIME_CONTROLS.map((tc) => (
                  <SelectItem key={tc.id} value={tc.id}>
                    {tc.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            onClick={start}
            className="h-12 w-full border border-[#8a6a24]/50 bg-gradient-to-b from-[#ecca6f] to-[#c69c3f] text-base font-bold tracking-wide text-[#241a05] shadow-[0_8px_26px_-6px_rgba(212,175,55,0.6)] hover:from-[#f3d887] hover:to-[#d4a94e]"
          >
            <Swords className="mr-2 h-5 w-5" />
            Begin the Duel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ModeOption({
  active,
  onClick,
  icon,
  title,
  sub,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  sub: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex flex-col items-center gap-1 rounded-xl border px-3 py-3.5 transition-all",
        active
          ? "border-gold/60 bg-gold/12 shadow-[0_0_24px_-6px_rgba(212,175,55,0.5)]"
          : "border-white/10 bg-white/[0.03] hover:border-gold/30"
      )}
    >
      <span className="text-gold-soft">{icon}</span>
      <span className="text-[13px] font-bold text-foreground/90">{title}</span>
      <span className="text-[10.5px] text-foreground/45">{sub}</span>
    </button>
  );
}

/* ================= Game Over ================= */

export function GameOverDialog({
  open,
  onOpenChange,
  game,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  game: ChessGame;
}) {
  const { result, mode, humanColor } = game;
  if (!result) return null;

  const winnerSide = result.winner;
  const humanWon = mode === "ai" && winnerSide === humanColor;
  const aiWon = mode === "ai" && winnerSide && winnerSide !== humanColor;

  const title = !winnerSide
    ? "A Drawn Battle"
    : mode === "human"
      ? `${winnerSide === "white" ? "White" : "Black"} Triumphant`
      : humanWon
        ? "Victory!"
        : "Defeat";

  const reasonText: Record<string, string> = {
    checkmate: "by checkmate",
    resignation: "by resignation",
    timeout: "on time",
    stalemate: "— stalemate, no legal moves",
    insufficient: "— insufficient material",
    threefold: "— threefold repetition",
    fifty: "— fifty-move rule",
    agreement: "by mutual agreement",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-dialog max-w-sm rounded-2xl text-center sm:rounded-2xl">
        <DialogHeader className="items-center">
          <div className="crown-pop mx-auto mb-1 flex h-20 w-20 items-center justify-center rounded-full border border-gold/40 bg-gradient-to-b from-gold/25 to-transparent shadow-[0_0_50px_-10px_rgba(212,175,55,0.7)]">
            {!winnerSide ? (
              <Handshake className="h-9 w-9 text-gold-soft" />
            ) : aiWon ? (
              <X className="h-9 w-9 text-red-300" />
            ) : (
              <Trophy className="h-9 w-9 text-gold-soft" />
            )}
          </div>
          <DialogTitle
            className={cn(
              "font-display text-3xl",
              humanWon ? "text-gold-gradient" : "text-foreground"
            )}
          >
            {title}
          </DialogTitle>
          <DialogDescription className="text-foreground/55">
            {winnerSide ? `${winnerSide === "white" ? "White" : "Black"} wins ${reasonText[result.reason]}` : `The game ends ${reasonText[result.reason]}`}
          </DialogDescription>
        </DialogHeader>

        {mode === "ai" && (
          <div className="mx-auto flex items-center gap-4 rounded-xl border border-white/10 bg-white/[0.04] px-5 py-2.5 text-sm">
            <span className="text-emerald-300">
              W <b className="font-mono">{game.stats.wins}</b>
            </span>
            <span className="text-foreground/30">|</span>
            <span className="text-gold-soft">
              D <b className="font-mono">{game.stats.draws}</b>
            </span>
            <span className="text-foreground/30">|</span>
            <span className="text-red-300">
              L <b className="font-mono">{game.stats.losses}</b>
            </span>
          </div>
        )}

        <div className="flex flex-col gap-2 pt-1">
          <Button
            onClick={() => {
              game.newGame();
              onOpenChange(false);
            }}
            className="h-11 border border-[#8a6a24]/50 bg-gradient-to-b from-[#ecca6f] to-[#c69c3f] font-bold text-[#241a05] hover:from-[#f3d887] hover:to-[#d4a94e]"
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Rematch
          </Button>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="h-11 border-white/10 bg-white/5 text-foreground/85 hover:bg-white/10"
          >
            <ScrollText className="mr-2 h-4 w-4" />
            Review the Final Position
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ================= Draw offer (2 players) ================= */

export function DrawOfferDialog({ game }: { game: ChessGame }) {
  const from = game.drawOfferPending;
  return (
    <Dialog
      open={from !== null}
      onOpenChange={(v) => {
        if (!v) game.resolveDrawOffer(false);
      }}
    >
      <DialogContent className="glass-dialog max-w-xs rounded-2xl text-center sm:rounded-2xl">
        <DialogHeader className="items-center">
          <div className="mx-auto mb-1 flex h-16 w-16 items-center justify-center rounded-full border border-gold/40 bg-gold/10">
            <Handshake className="h-8 w-8 text-gold-soft" />
          </div>
          <DialogTitle className="font-display text-2xl">
            {from === "w" ? "White" : "Black"} offers a draw
          </DialogTitle>
          <DialogDescription>
            {from === "w" ? "Black" : "White"}, will you accept the truce?
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="h-10 flex-1 border-white/10 bg-white/5"
            onClick={() => game.resolveDrawOffer(false)}
          >
            Decline
          </Button>
          <Button
            className="h-10 flex-1 border border-[#8a6a24]/50 bg-gradient-to-b from-[#ecca6f] to-[#c69c3f] font-bold text-[#241a05]"
            onClick={() => game.resolveDrawOffer(true)}
          >
            Accept
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ================= Rules ================= */

export function RulesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-dialog max-h-[88dvh] max-w-md overflow-y-auto rounded-2xl sm:rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2 text-2xl text-gold-gradient">
            <ScrollText className="h-5 w-5 text-gold-soft" />
            The Royal Rules
          </DialogTitle>
          <DialogDescription>
            Everything the arena supports — a complete, regulation game.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm text-foreground/75">
          {[
            ["Full regulation rules", "Castling, en passant, promotion, stalemate, threefold repetition, the fifty-move rule and insufficient material are all enforced."],
            ["Move the pieces", "Drag a piece, or tap it and tap its destination. Legal squares glow; captures show a crimson ring."],
            ["The Oracle", "Four strength levels with real alpha–beta search. Ask for a hint (3 per game) to reveal the engine's choice."],
            ["Clocks", "Fischer increment timing — pick bullet, blitz or rapid. Your flag falls, you fall."],
            ["Time travel", "Click any move in the score sheet to replay the battle; jump back to Live anytime."],
            ["Etiquette", "Resign with dignity, offer draws at the right moment — the Grandmaster only accepts when losing."],
          ].map(([t, d]) => (
            <div key={t} className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3">
              <p className="font-semibold text-gold-soft">{t}</p>
              <p className="mt-0.5 text-[13px] leading-relaxed text-foreground/60">{d}</p>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
