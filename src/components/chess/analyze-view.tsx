"use client";

/**
 * AnalyzeView — the analysis room.
 * Free analysis board + stored games, engine eval bar, best-move arrow,
 * full game report (classifications, accuracy, eval graph) and PGN tools.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeftRight,
  Bot,
  Copy,
  Crown,
  Download,
  Eraser,
  Flag,
  Lightbulb,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { EvalBar } from "@/components/chess/panels";
import { ChessBoard } from "@/components/chess/board";
import { useAnalysis } from "@/hooks/use-analysis";
import { CLASS_META, verdictFor, type ClassifiedMove, type MoveClass } from "@/lib/analysis-client";
import { cpToPercent, formatEval } from "@/lib/chess-utils";
import type { StoredGame } from "@/lib/game-store";
import { cn } from "@/lib/utils";

export function AnalyzeView({
  pendingGame,
  onConsumePendingGame,
}: {
  pendingGame?: StoredGame | null;
  onConsumePendingGame?: () => void;
}) {
  const an = useAnalysis();
  const [importOpen, setImportOpen] = useState(false);
  const [pgnText, setPgnText] = useState("");
  const [playing, setPlaying] = useState(false);

  // load a game "sent" from the play room
  useEffect(() => {
    if (pendingGame) {
      an.loadStoredGame(pendingGame);
      onConsumePendingGame?.();
    }
  }, [pendingGame]);

  // autoplay stepping
  const goToRef = useRef(an.goTo);
  useEffect(() => {
    goToRef.current = an.goTo;
  }, [an.goTo]);
  useEffect(() => {
    if (!playing) return;
    const t = window.setTimeout(() => {
      if (an.viewIndex >= an.history.length - 1) {
        setPlaying(false);
        return;
      }
      goToRef.current(an.viewIndex + 1);
    }, 750);
    return () => window.clearTimeout(t);
  }, [playing, an.viewIndex, an.history.length]);

  const hasMoves = an.history.length > 0;
  const report = an.report;

  const seekGraph = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      const series = report?.series ?? [];
      if (series.length === 0) return;
      const ply = Math.max(-1, Math.min(series.length - 1, Math.round(ratio * series.length) - 1));
      an.goTo(ply);
    },
    [report, an]
  );

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)] xl:grid-cols-[minmax(0,1fr)_minmax(0,380px)] lg:items-start">
      {/* ------------------------- board column ------------------------- */}
      <div className="flex flex-col items-center gap-3">
        <SourceBar an={an} onImport={() => setImportOpen(true)} />

        <div className="w-full max-w-[600px] space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="glass-panel flex min-h-9 flex-1 items-center gap-2 rounded-full px-4 py-1.5 text-[13px] text-foreground/75">
              <Bot className="h-4 w-4 shrink-0 text-emerald-300/90" />
              {an.liveEval ? (
                <span>
                  <b className="font-mono text-gold-soft">
                    {formatEval(an.liveEval.cp, an.liveEval.mateIn)}
                  </b>
                  <span className="ml-2 text-foreground/55">{evalNarrative(an.liveEval.cp)}</span>
                  {an.liveEval.bestSan && (
                    <span className="ml-2 text-foreground/40">
                      · best <b className="font-mono text-emerald-300/90">{an.liveEval.bestSan}</b>
                    </span>
                  )}
                </span>
              ) : (
                <span className="text-foreground/45">
                  {hasMoves ? "Consulting the oracle…" : "Move pieces freely — both colors."}
                </span>
              )}
            </span>
            <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
              <Lightbulb className="h-3.5 w-3.5 text-gold-soft/80" />
              <span className="text-[11px] font-medium text-foreground/60">Best move</span>
              <Switch
                checked={an.showBest}
                onCheckedChange={an.setShowBest}
                aria-label="Toggle best move arrow"
              />
            </div>
          </div>

          <div className="board-frame relative rounded-2xl p-2 sm:p-2.5">
            <span className="pointer-events-none absolute -left-0.5 -top-0.5 h-3 w-3 rounded-tl-2xl border-l-2 border-t-2 border-[#fbeec1]/70" />
            <span className="pointer-events-none absolute -right-0.5 -top-0.5 h-3 w-3 rounded-tr-2xl border-r-2 border-t-2 border-[#fbeec1]/70" />
            <span className="pointer-events-none absolute -bottom-0.5 -left-0.5 h-3 w-3 rounded-bl-2xl border-b-2 border-l-2 border-[#fbeec1]/70" />
            <span className="pointer-events-none absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-br-2xl border-b-2 border-r-2 border-[#fbeec1]/70" />
            <div className="relative overflow-hidden rounded-md shadow-[inset_0_0_24px_rgba(0,0,0,0.55)]">
              <ChessBoard
                pieces={an.pieces}
                orientation={an.orientation}
                turnColor={an.displayTurn}
                selected={an.selected}
                legalTargets={an.legalForSelected}
                lastMove={an.lastMove}
                checkedSquare={an.checkedSquare}
                hint={an.engineBest}
                interactive={!an.pendingPromotion}
                showLegal
                showCoords
                bothSides
                pendingPromotion={an.pendingPromotion}
                promotionColor={an.displayTurn}
                onSelect={an.selectSquare}
                onMoveAttempt={(f, t) => an.attemptMove(f, t)}
                onPromote={an.promote}
                onCancelPromotion={an.cancelPromotion}
                onFirstGesture={() => {}}
              />
            </div>
          </div>

          <EvalBar evalCp={an.liveEval?.cp ?? null} mateIn={an.liveEval?.mateIn} />

          {/* nav strip */}
          <div className="flex items-center justify-center gap-1.5">
            <NavBtn
              label="First move"
              disabled={an.viewIndex === -1}
              onClick={() => {
                setPlaying(false);
                an.goTo(-1);
              }}
            >
              <SkipBack className="h-4 w-4" strokeWidth={2.4} />
            </NavBtn>
            <NavBtn
              label={playing ? "Pause replay" : "Replay game"}
              disabled={!hasMoves}
              onClick={() => setPlaying((p) => !p)}
              accent
            >
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </NavBtn>
            <NavBtn
              label="Previous move"
              disabled={an.viewIndex === -1}
              onClick={() => {
                setPlaying(false);
                an.goTo(an.viewIndex - 1);
              }}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4 rotate-180" fill="currentColor" aria-hidden>
                <path d="M9 6 L17 12 L9 18 Z" />
                <rect x="6" y="6" width="2.2" height="12" rx="1" />
              </svg>
            </NavBtn>
            <NavBtn
              label="Next move"
              disabled={an.viewIndex >= an.history.length - 1}
              onClick={() => {
                setPlaying(false);
                an.goTo(an.viewIndex + 1);
              }}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
                <path d="M9 6 L17 12 L9 18 Z" />
                <rect x="6" y="6" width="2.2" height="12" rx="1" />
              </svg>
            </NavBtn>
            <NavBtn
              label="Last move"
              disabled={an.viewIndex >= an.history.length - 1}
              onClick={() => {
                setPlaying(false);
                an.goTo(an.history.length - 1);
              }}
            >
              <SkipForward className="h-4 w-4" strokeWidth={2.4} />
            </NavBtn>
            <span className="ml-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono text-[11px] text-foreground/60">
              {an.viewIndex === -1 ? "Start" : `Move ${Math.ceil((an.viewIndex + 1) / 2)}${an.viewIndex % 2 === 0 ? "" : "…"}`}
              {" · "}
              {an.viewIndex + 1}/{an.history.length}
            </span>
          </div>

          {/* eval graph */}
          {report && report.series.length > 0 && (
            <EvalGraph
              series={report.series}
              currentPly={an.viewIndex}
              onSeek={seekGraph}
            />
          )}
        </div>
      </div>

      {/* ------------------------- report column ------------------------- */}
      <div className="space-y-4">
        {/* run / progress */}
        <div className="glass-panel rounded-2xl p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="font-display flex items-center gap-2 text-sm font-bold uppercase tracking-[0.18em] text-gold-soft">
              <Sparkles className="h-4 w-4" /> Game Report
            </h3>
            {hasMoves && an.status !== "running" && (
              <Button
                size="sm"
                onClick={an.runAnalysis}
                className="h-8 border border-[#8a6a24]/50 bg-gradient-to-b from-[#ecca6f] to-[#c69c3f] px-3 text-[12px] font-bold text-[#241a05] hover:from-[#f3d887] hover:to-[#d4a94e]"
              >
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                {report ? "Re-analyze" : "Analyze game"}
              </Button>
            )}
            {an.status === "running" && (
              <Button
                size="sm"
                variant="outline"
                onClick={an.cancelAnalysis}
                className="h-8 border-white/10 bg-white/5 px-3 text-[12px] hover:bg-white/10"
              >
                <X className="mr-1 h-3.5 w-3.5" /> Stop
              </Button>
            )}
          </div>

          {an.status === "running" && (
            <div className="space-y-2">
              <Progress
                value={an.progress.total ? (an.progress.done / an.progress.total) * 100 : 4}
                className="h-2"
              />
              <p className="text-center text-[12px] text-foreground/55">
                Evaluating position <b className="font-mono text-gold-soft">{Math.min(an.progress.done + 1, an.progress.total)}</b> of{" "}
                <b className="font-mono">{an.progress.total}</b>…
              </p>
            </div>
          )}

          {an.status === "error" && (
            <p className="text-[12px] text-red-300/90">
              The oracle stumbled. Give it another moment, then try again.
            </p>
          )}

          {!hasMoves && (
            <div className="space-y-2 py-1 text-[13px] leading-relaxed text-foreground/55">
              <p className="flex items-start gap-2">
                <Crown className="mt-0.5 h-4 w-4 shrink-0 text-gold-soft/80" />
                <span>
                  Finish a game in the Play room and tap <b className="text-gold-soft">Analyze</b> on
                  the victory screen — or import a PGN below.
                </span>
              </p>
              <p className="flex items-start gap-2">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300/80" />
                <span>
                  This board is always live: explore lines with both colors while the oracle
                  evaluates every position.
                </span>
              </p>
            </div>
          )}

          {report && <ReportSummary report={report} meta={an.meta} />}
        </div>

        {/* move list */}
        {report && <MovesReport report={report} currentPly={an.viewIndex} onSeek={(ply) => { setPlaying(false); an.goTo(ply); }} />}

        {/* recent games */}
        <RecentGames an={an} />
      </div>

      {/* import dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="glass-dialog rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-gold-soft">Import PGN</DialogTitle>
            <DialogDescription>
              Paste any game in PGN format — the report works on it instantly.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={pgnText}
            onChange={(e) => setPgnText(e.target.value)}
            placeholder={'[Event "Casual game"]\n\n1. e4 e5 2. Nf3 Nc6 …'}
            className="scroll-slim min-h-[160px] border-white/10 bg-black/30 font-mono text-[12px]"
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setImportOpen(false)}
              className="border-white/10 bg-white/5 hover:bg-white/10"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (an.importPgn(pgnText)) {
                  setPgnText("");
                  setImportOpen(false);
                }
              }}
              className="border border-[#8a6a24]/50 bg-gradient-to-b from-[#ecca6f] to-[#c69c3f] font-bold text-[#241a05] hover:from-[#f3d887] hover:to-[#d4a94e]"
            >
              <Upload className="mr-1.5 h-4 w-4" /> Load game
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ================= source bar ================= */

function SourceBar({
  an,
  onImport,
}: {
  an: ReturnType<typeof useAnalysis>;
  onImport: () => void;
}) {
  return (
    <div className="flex w-full max-w-[600px] flex-wrap items-center justify-center gap-1.5">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold text-foreground/70">
        <Crown className="h-3.5 w-3.5 text-gold-soft/80" />
        <span className="max-w-[220px] truncate">{an.meta.label}</span>
        {an.meta.result && an.meta.result !== "*" && (
          <b className="font-mono text-gold-soft">{an.meta.result}</b>
        )}
      </span>
      <Button
        size="sm"
        variant="outline"
        onClick={() => an.setOrientation(an.orientation === "white" ? "black" : "white")}
        className="h-8 border-white/10 bg-white/5 px-2.5 text-[12px] hover:bg-white/10"
        aria-label="Flip board"
      >
        <ArrowLeftRight className="h-3.5 w-3.5" />
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={an.clearBoard}
        className="h-8 border-white/10 bg-white/5 px-2.5 text-[12px] hover:bg-white/10"
        aria-label="Reset to free board"
      >
        <Eraser className="mr-1 h-3.5 w-3.5" /> Clear
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={an.exportPgn}
        className="h-8 border-white/10 bg-white/5 px-2.5 text-[12px] hover:bg-white/10"
      >
        <Copy className="mr-1 h-3.5 w-3.5" /> PGN
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={onImport}
        className="h-8 border-white/10 bg-white/5 px-2.5 text-[12px] hover:bg-white/10"
      >
        <Download className="mr-1 h-3.5 w-3.5" /> Import
      </Button>
    </div>
  );
}

function NavBtn({
  children,
  label,
  onClick,
  disabled,
  accent,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  accent?: boolean;
}) {
  return (
    <Button
      variant="outline"
      size="icon"
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      className={cn(
        "h-9 w-9 border-white/10 bg-white/5 text-foreground/80 hover:border-gold/40 hover:bg-white/10",
        accent && "border-emerald-400/30 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20"
      )}
    >
      {children}
    </Button>
  );
}

/* ================= eval narrative ================= */

function evalNarrative(cp: number): string {
  const a = Math.abs(cp);
  if (a < 30) return "Balanced position";
  if (a < 120) return cp > 0 ? "White is slightly better" : "Black is slightly better";
  if (a < 350) return cp > 0 ? "White has the edge" : "Black has the edge";
  if (a < 900) return cp > 0 ? "White is winning" : "Black is winning";
  return cp > 0 ? "White is crushing" : "Black is crushing";
}

/* ================= eval graph ================= */

function EvalGraph({
  series,
  currentPly,
  onSeek,
}: {
  series: number[];
  currentPly: number;
  onSeek: (e: React.MouseEvent<SVGSVGElement>) => void;
}) {
  const n = series.length;
  const pts = series.map((cp, i) => {
    const x = ((i + 1) / n) * 100;
    const y = 40 - (cpToPercent(cp) / 100) * 40;
    return [x, y] as const;
  });
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = `${line} L100,40 L0,40 Z`;
  const cur = currentPly >= 0 && currentPly < n ? pts[currentPly] : null;
  const curX = cur ? cur[0] : null;

  return (
    <div className="glass-panel rounded-xl px-3 py-2">
      <div className="mb-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground/40">
        <span>Advantage</span>
        <span className="flex items-center gap-1">
          <span className="text-gold-soft">White</span> ◆ <span className="text-emerald-300">Black</span>
        </span>
      </div>
      <svg
        viewBox="0 0 100 40"
        preserveAspectRatio="none"
        className="h-16 w-full cursor-pointer rounded-md bg-black/25"
        onClick={onSeek}
        role="slider"
        aria-label="Evaluation graph — click to jump to a move"
        aria-valuemin={0}
        aria-valuemax={n}
        aria-valuenow={currentPly + 1}
      >
        <defs>
          <linearGradient id="eval-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#e9c96b" stopOpacity="0.75" />
            <stop offset="49%" stopColor="#e9c96b" stopOpacity="0.35" />
            <stop offset="50%" stopColor="#2fbf9145" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#2fbf91" stopOpacity="0.8" />
          </linearGradient>
        </defs>
        <rect x="0" y="19.85" width="100" height="0.3" fill="rgba(255,255,255,0.18)" />
        <path d={area} fill="url(#eval-area)" />
        <path d={line} fill="none" stroke="rgba(255,244,214,0.9)" strokeWidth="0.7" />
        {curX !== null && (
          <>
            <line x1={curX} y1="0" x2={curX} y2="40" stroke="rgba(233,201,107,0.65)" strokeWidth="0.5" strokeDasharray="2 2" />
            {cur && <circle cx={cur[0]} cy={cur[1]} r="1.6" fill="#fbeec1" stroke="#8a6a24" strokeWidth="0.4" />}
          </>
        )}
      </svg>
    </div>
  );
}

/* ================= report summary ================= */

function ReportSummary({
  report,
  meta,
}: {
  report: NonNullable<ReturnType<typeof useAnalysis>["report"]>;
  meta: ReturnType<typeof useAnalysis>["meta"];
}) {
  return (
    <div className="space-y-3.5">
      <div className="flex items-center justify-around gap-3">
        <AccuracyDonut label="White" value={report.white.accuracy} ring="#e9c96b" />
        <div className="text-center">
          <p className="font-mono text-lg font-bold text-gold-soft">
            {meta.result === "1-0" ? "1–0" : meta.result === "0-1" ? "0–1" : meta.result === "1/2-1/2" ? "½–½" : "—"}
          </p>
          <p className="text-[10px] uppercase tracking-[0.2em] text-foreground/40">Result</p>
        </div>
        <AccuracyDonut label="Black" value={report.black.accuracy} ring="#2fbf91" />
      </div>

      <div className="grid grid-cols-2 gap-2 text-[12px]">
        <ClassCounts side="White" counts={report.white} />
        <ClassCounts side="Black" counts={report.black} />
      </div>

      <p className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-[12px] leading-relaxed text-foreground/65">
        {verdictFor(report.white, "White")} {verdictFor(report.black, "Black")}
      </p>
    </div>
  );
}

function AccuracyDonut({ label, value, ring }: { label: string; value: number; ring: string }) {
  const r = 26;
  const circ = 2 * Math.PI * r;
  const dash = (value / 100) * circ;
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative h-[68px] w-[68px]">
        <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90">
          <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="5" />
          <circle
            cx="32"
            cy="32"
            r={r}
            fill="none"
            stroke={ring}
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circ}`}
            style={{ filter: `drop-shadow(0 0 5px ${ring}66)` }}
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center font-mono text-[15px] font-bold text-foreground">
          {value}
        </span>
      </div>
      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground/55">
        {label}
      </span>
    </div>
  );
}

function ClassCounts({ side, counts }: { side: string; counts: { counts: Record<MoveClass, number> } }) {
  const order: MoveClass[] = ["brilliant", "best", "excellent", "inaccuracy", "mistake", "blunder"];
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] p-2">
      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-foreground/40">{side}</p>
      <div className="flex flex-wrap gap-1.5">
        {order.map((k) => (
          <span
            key={k}
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[11px] font-bold"
            style={{ background: CLASS_META[k].bg, color: CLASS_META[k].color, border: `1px solid ${CLASS_META[k].ring}55` }}
          >
            {CLASS_META[k].icon} {counts.counts[k]}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ================= move list ================= */

function MovesReport({
  report,
  currentPly,
  onSeek,
}: {
  report: NonNullable<ReturnType<typeof useAnalysis>["report"]>;
  currentPly: number;
  onSeek: (ply: number) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = listRef.current?.querySelector("[data-current='true']");
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [currentPly]);

  const rows: { no: number; w?: ClassifiedMove; b?: ClassifiedMove }[] = [];
  for (let i = 0; i < report.moves.length; i += 2) {
    rows.push({ no: i / 2 + 1, w: report.moves[i], b: report.moves[i + 1] });
  }

  return (
    <div className="glass-panel rounded-2xl p-4">
      <h3 className="font-display mb-2.5 flex items-center gap-2 text-sm font-bold uppercase tracking-[0.18em] text-gold-soft">
        <Flag className="h-4 w-4" /> Move by move
      </h3>
      <div ref={listRef} className="scroll-slim max-h-[380px] space-y-1 overflow-y-auto pr-1">
        {rows.map((row) => (
          <div key={row.no} className="grid grid-cols-[2.2rem_1fr_1fr] items-stretch gap-1.5">
            <span className="flex items-center justify-end pr-1 font-mono text-[11px] text-foreground/35">
              {row.no}.
            </span>
            <MoveCell move={row.w} currentPly={currentPly} onSeek={onSeek} />
            <MoveCell move={row.b} currentPly={currentPly} onSeek={onSeek} />
          </div>
        ))}
      </div>
    </div>
  );
}

function MoveCell({
  move,
  currentPly,
  onSeek,
}: {
  move?: ClassifiedMove;
  currentPly: number;
  onSeek: (ply: number) => void;
}) {
  if (!move) return <span />;
  const meta = CLASS_META[move.classification];
  const isCurrent = currentPly === move.ply;
  return (
    <button
      type="button"
      data-current={isCurrent}
      onClick={() => onSeek(move.ply)}
      className={cn(
        "flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors",
        isCurrent
          ? "bg-gold/15 ring-1 ring-gold/40"
          : "hover:bg-white/[0.06]"
      )}
    >
      <span className={cn("font-medium", move.color === "w" ? "text-foreground/90" : "text-foreground/75")}>
        {move.san}
      </span>
      <span
        className="ml-auto inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 font-mono text-[9.5px] font-black"
        style={{ background: meta.bg, color: meta.color, border: `1px solid ${meta.ring}66` }}
        title={meta.label}
      >
        {meta.icon}
      </span>
    </button>
  );
}

/* ================= recent games ================= */

function RecentGames({ an }: { an: ReturnType<typeof useAnalysis> }) {
  if (an.recentGames.length === 0) {
    return (
      <div className="glass-panel rounded-2xl p-4 text-[12px] text-foreground/45">
        No stored games yet — every finished game lands here automatically.
      </div>
    );
  }
  return (
    <div className="glass-panel rounded-2xl p-4">
      <h3 className="font-display mb-2.5 flex items-center gap-2 text-sm font-bold uppercase tracking-[0.18em] text-gold-soft">
        <RotateCcw className="h-4 w-4" /> Recent games
      </h3>
      <div className="scroll-slim max-h-[260px] space-y-1.5 overflow-y-auto pr-1">
        {an.recentGames.map((g) => (
          <div
            key={g.id}
            className={cn(
              "group flex items-center gap-2 rounded-xl border px-3 py-2 transition-colors",
              an.meta.label === g.label && an.meta.date === g.date
                ? "border-gold/35 bg-gold/10"
                : "border-white/8 bg-white/[0.03] hover:border-gold/25"
            )}
          >
            <button
              type="button"
              onClick={() => an.loadStoredGame(g)}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
            >
              <b
                className={cn(
                  "shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[11px]",
                  g.result === "1-0"
                    ? "bg-gold/15 text-gold-soft"
                    : g.result === "0-1"
                      ? "bg-emerald-400/15 text-emerald-300"
                      : "bg-white/10 text-foreground/70"
                )}
              >
                {g.result === "*" ? "—" : g.result === "1/2-1/2" ? "½" : g.result === "1-0" ? "1" : "0"}
              </b>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-foreground/85">{g.label}</span>
                <span className="block text-[10.5px] text-foreground/40">
                  {g.plies} plies · {new Date(g.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  {g.reason ? ` · ${g.reason}` : ""}
                </span>
              </span>
            </button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => an.removeGame(g.id)}
              className="h-7 w-7 shrink-0 text-foreground/30 opacity-0 transition-opacity hover:text-red-300 group-hover:opacity-100"
              aria-label={`Delete ${g.label}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
