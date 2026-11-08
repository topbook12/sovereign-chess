"use client";

import { useEffect, useRef } from "react";
import {
  ChevronsRight,
  Flag,
  Handshake,
  Lightbulb,
  RefreshCw,
  Sparkles,
  Undo2,
  Volume2,
  VolumeX,
  Crosshair,
  Gauge,
  Crown,
  Bot,
  Users,
} from "lucide-react";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { ChessGame, Difficulty } from "@/hooks/use-chess-game";
import { cn } from "@/lib/utils";

/* ---------------- shared bits ---------------- */

function CardShell({
  title,
  icon,
  children,
  className,
  action,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  return (
    <section className={cn("glass-panel glass-panel-hover rounded-2xl", className)}>
      <header className="flex items-center justify-between gap-2 border-b border-white/8 px-4 py-3">
        <h2 className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-[0.14em] text-gold-soft/90">
          {icon}
          {title}
        </h2>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

const goldButton =
  "border border-[#8a6a24]/50 bg-gradient-to-b from-[#ecca6f] to-[#c69c3f] font-semibold text-[#241a05] shadow-[0_6px_20px_-6px_rgba(212,175,55,0.55)] hover:from-[#f3d887] hover:to-[#d4a94e]";
const ghostButton =
  "border border-white/10 bg-white/5 text-foreground/85 hover:border-gold/40 hover:bg-white/10 hover:text-gold-soft";

/* ---------------- Controls ---------------- */

export function ControlsCard({
  game,
  onNewGame,
}: {
  game: ChessGame;
  onNewGame: () => void;
}) {
  const { status, history, viewIndex, viewing, mode, humanColor, turn, thinking } = game;
  const canUndo =
    status === "active" &&
    history.length > 0 &&
    !viewing &&
    !thinking &&
    (mode === "human" || turn === (humanColor === "white" ? "w" : "b"));
  const canAct = status === "active";

  return (
    <CardShell title="Battle Controls" icon={<Crown className="h-4 w-4" />}>
      <TooltipProvider delayDuration={250}>
        <div className="grid grid-cols-2 gap-2.5">
          <Button
            onClick={onNewGame}
            className={cn(goldButton, "col-span-2 h-11 text-[15px] tracking-wide")}
          >
            <Sparkles className="mr-1.5 h-4 w-4" />
            New Game
          </Button>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                onClick={game.undo}
                disabled={!canUndo}
                className={cn(ghostButton, "h-11")}
                aria-label="Undo move"
              >
                <Undo2 className="h-4 w-4" />
                <span className="text-xs">Undo</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Take back your last move</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                onClick={() => void game.requestHint()}
                disabled={!canAct || thinking || mode !== "ai"}
                className={cn(ghostButton, "relative h-11")}
                aria-label="Request hint"
              >
                <Lightbulb className="h-4 w-4 text-gold-soft" />
                <span className="text-xs">Hint</span>
                <span className="absolute -right-1.5 -top-1.5 flex items-center gap-0.5 rounded-full bg-gold/20 px-1.5 text-[10px] font-bold text-gold-soft ring-1 ring-gold/50">
                  <Crown className="h-2.5 w-2.5" />10 · {Math.max(0, 3 - game.hintsUsed)}
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Ask the oracle for the best move — costs 10 crowns</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                onClick={game.flipBoard}
                className={cn(ghostButton, "h-11")}
                aria-label="Flip board"
              >
                <RefreshCw className="h-4 w-4" />
                <span className="text-xs">Flip</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Rotate the battlefield</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                onClick={game.offerDraw}
                disabled={!canAct}
                className={cn(ghostButton, "h-11")}
                aria-label="Offer draw"
              >
                <Handshake className="h-4 w-4" />
                <span className="text-xs">Draw</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {mode === "ai" ? "Propose a truce to the Grandmaster" : "Propose a draw"}
            </TooltipContent>
          </Tooltip>

          <AlertDialog>
            <Tooltip>
              <TooltipTrigger asChild>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    disabled={!canAct}
                    className={cn(
                      ghostButton,
                      "col-span-2 h-11 hover:border-red-400/50 hover:bg-red-500/10 hover:text-red-300"
                    )}
                    aria-label="Resign"
                  >
                    <Flag className="h-4 w-4" />
                    <span className="text-xs">Resign</span>
                  </Button>
                </AlertDialogTrigger>
              </TooltipTrigger>
              <TooltipContent>Lay down your crown</TooltipContent>
            </Tooltip>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="font-display text-xl">
                  Resign this game?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Your king will lay down the crown. The position will be lost to history
                  (and your record).
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Fight on</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-red-500/90 text-white hover:bg-red-500"
                  onClick={game.resign}
                >
                  Resign
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </TooltipProvider>
    </CardShell>
  );
}

/* ---------------- Move list ---------------- */

export function MovesCard({ game }: { game: ChessGame }) {
  const { history, viewIndex, viewing, goToHistory } = game;
  const scrollRef = useRef<HTMLDivElement>(null);
  const liveIndex = history.length - 1;
  const current = viewIndex ?? liveIndex;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const active = el.querySelector<HTMLElement>("[data-current='true']");
    if (active) {
      active.scrollIntoView({ block: "nearest", behavior: "smooth" });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }, [history.length, viewIndex]);

  const rows: { no: number; w?: { san: string; idx: number }; b?: { san: string; idx: number } }[] =
    [];
  for (let i = 0; i < history.length; i += 2) {
    rows.push({
      no: i / 2 + 1,
      w: history[i] ? { san: history[i].san, idx: i } : undefined,
      b: history[i + 1] ? { san: history[i + 1].san, idx: i + 1 } : undefined,
    });
  }

  const moveButton = (m: { san: string; idx: number }, side: "w" | "b") => (
    <button
      key={`${side}-${m.idx}`}
      data-current={current === m.idx}
      onClick={() => goToHistory(current === m.idx ? null : m.idx)}
      className={cn(
        "rounded-md px-2 py-1 text-left font-mono text-[13px] tabular-nums transition-colors",
        current === m.idx
          ? "bg-gold/20 text-gold-soft ring-1 ring-gold/40"
          : "text-foreground/75 hover:bg-white/8 hover:text-foreground"
      )}
      aria-label={`Move ${m.san}, jump to position`}
    >
      {m.san}
    </button>
  );

  return (
    <CardShell
      title="Moves"
      icon={<ChevronsRight className="h-4 w-4" />}
      action={
        viewing ? (
          <button
            onClick={() => goToHistory(null)}
            className="rounded-full bg-emerald-400/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-300 ring-1 ring-emerald-400/40 transition hover:bg-emerald-400/25"
          >
            ◀ Back to live
          </button>
        ) : (
          <span className="rounded-full bg-gold/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-gold-soft ring-1 ring-gold/30">
            Live
          </span>
        )
      }
    >
      {history.length === 0 ? (
        <p className="py-6 text-center text-sm italic text-foreground/40">
          The board is set.
          <br />
          White opens the battle.
        </p>
      ) : (
        <>
          <div
            ref={scrollRef}
            className="scroll-slim max-h-64 overflow-y-auto pr-1 lg:max-h-[280px]"
          >
            <div className="grid grid-cols-[2.2rem_1fr_1fr] items-center gap-x-1 gap-y-0.5">
              {rows.map((r) => (
                <div key={r.no} className="col-span-3 grid grid-cols-subgrid">
                  <span className="py-1 text-right font-mono text-[12px] text-foreground/35">
                    {r.no}.
                  </span>
                  {r.w ? moveButton(r.w, "w") : <span />}
                  {r.b ? moveButton(r.b, "b") : <span />}
                </div>
              ))}
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2 border-t border-white/8 pt-3">
            <Button
              size="sm"
              variant="outline"
              className={cn(ghostButton, "h-8 flex-1 text-xs")}
              onClick={() => goToHistory(Math.max(0, current - 1))}
              disabled={current <= 0}
            >
              ◀ Prev
            </Button>
            <Button
              size="sm"
              variant="outline"
              className={cn(ghostButton, "h-8 flex-1 text-xs")}
              onClick={() =>
                goToHistory(current >= liveIndex ? null : Math.min(liveIndex, current + 1))
              }
              disabled={viewIndex === null}
            >
              Next ▶
            </Button>
            <Button
              size="sm"
              className={cn(goldButton, "h-8 flex-1 text-xs")}
              onClick={() => goToHistory(null)}
              disabled={viewIndex === null}
            >
              Live
            </Button>
          </div>
        </>
      )}
    </CardShell>
  );
}

/* ---------------- Engine card ---------------- */

const LEVEL_LABELS: Record<Difficulty, string> = {
  easy: "Apprentice",
  medium: "Knight",
  hard: "Grandmaster",
  master: "Sovereign",
};

export function EngineCard({ game }: { game: ChessGame }) {
  const info = game.engineInfo;
  return (
    <CardShell title="The Oracle" icon={<Gauge className="h-4 w-4" />}>
      <div className="space-y-3.5">
        <div className="flex items-center justify-between gap-3">
          <label className="text-xs font-medium uppercase tracking-wider text-foreground/50">
            Strength
          </label>
          <Select
            value={game.difficulty}
            onValueChange={(v) => game.setDifficulty(v as Difficulty)}
          >
            <SelectTrigger className="w-[172px] border-white/10 bg-white/5 text-[13px] data-[size=default]:h-9">
              <Bot className="mr-1 h-4 w-4 shrink-0 text-emerald-300" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(LEVEL_LABELS) as Difficulty[]).map((lvl) => (
                <SelectItem key={lvl} value={lvl}>
                  <span className="flex items-center gap-2">
                    {LEVEL_LABELS[lvl]}
                    <span className="text-[10px] text-foreground/40">
                      {"·".repeat(["easy", "medium", "hard", "master"].indexOf(lvl) + 1)}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {game.thinking ? (
          <div className="flex items-center gap-2.5 rounded-xl border border-gold/20 bg-gold/5 px-3 py-3">
            <RefreshCw className="h-4 w-4 animate-spin text-gold-soft" />
            <span className="text-sm text-gold-soft/90">
              Reading the position
              <span className="thinking-dot">.</span>
              <span className="thinking-dot" style={{ animationDelay: "0.15s" }}>.</span>
              <span className="thinking-dot" style={{ animationDelay: "0.3s" }}>.</span>
            </span>
          </div>
        ) : info && info.nodes === 0 ? (
          <div className="flex items-center justify-center gap-2 rounded-xl border border-gold/20 bg-gold/5 px-3 py-3">
            <Sparkles className="h-4 w-4 text-gold-soft" />
            <span className="text-sm font-medium text-gold-soft/90">
              Opening book — theory says so
            </span>
          </div>
        ) : info ? (
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="Depth" value={String(info.depth)} />
            <Stat label="Nodes" value={formatNodes(info.nodes)} />
            <Stat label="Think" value={`${(info.timeMs / 1000).toFixed(1)}s`} />
          </div>
        ) : (
          <p className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-3 text-center text-xs italic text-foreground/45">
            The oracle watches in silence — make a move.
          </p>
        )}

        <div className="flex items-center gap-2 rounded-xl border border-emerald-400/15 bg-emerald-400/5 px-3 py-2.5">
          <Crosshair className="h-4 w-4 shrink-0 text-emerald-300" />
          <p className="text-[11px] leading-snug text-foreground/60">
            Every move is searched with alpha–beta pruning, piece-square heuristics and a
            quiescence attack scan.
          </p>
        </div>
      </div>
    </CardShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.04] px-2 py-2">
      <div className="font-mono text-sm font-bold text-gold-soft">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-foreground/40">{label}</div>
    </div>
  );
}

function formatNodes(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/* ---------------- Preferences ---------------- */

export function PrefsCard({ game }: { game: ChessGame }) {
  return (
    <CardShell title="Ambience" icon={<Sparkles className="h-4 w-4" />}>
      <div className="space-y-3">
        <PrefRow
          icon={game.soundOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          label="Sound"
          hint="Hand-crafted wooden clicks"
          checked={game.soundOn}
          onChange={game.setSoundOn}
        />
        <PrefRow
          icon={<Crosshair className="h-4 w-4" />}
          label="Move hints"
          hint="Dots & rings on legal squares"
          checked={game.showLegal}
          onChange={game.setShowLegal}
        />
        <PrefRow
          icon={<Crown className="h-4 w-4" />}
          label="Coordinates"
          hint="a–h / 1–8 markers"
          checked={game.showCoords}
          onChange={game.setShowCoords}
        />
        <PrefRow
          icon={<Crown className="h-4 w-4" />}
          label="Auto-queen"
          hint="Promote without asking"
          checked={game.autoQueen}
          onChange={game.setAutoQueen}
        />
      </div>
    </CardShell>
  );
}

function PrefRow({
  icon,
  label,
  hint,
  checked,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5 transition-colors hover:border-gold/25">
      <span className="flex items-center gap-2.5">
        <span className="text-gold-soft/80">{icon}</span>
        <span>
          <span className="block text-[13px] font-medium text-foreground/90">{label}</span>
          <span className="block text-[11px] text-foreground/40">{hint}</span>
        </span>
      </span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </label>
  );
}

/* ---------------- Mode chip ---------------- */

export function ModeBadge({ mode }: { mode: "ai" | "human" }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-foreground/70">
      {mode === "ai" ? (
        <>
          <Bot className="h-3.5 w-3.5 text-emerald-300" /> vs Engine
        </>
      ) : (
        <>
          <Users className="h-3.5 w-3.5 text-gold-soft" /> Two Players
        </>
      )}
    </span>
  );
}
