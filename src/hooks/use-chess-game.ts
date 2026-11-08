"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Chess,
  type Move,
  type Square,
  type Color,
  type PieceSymbol,
} from "chess.js";
import { playSound, primeAudio, setSoundEnabled } from "@/lib/sounds";
import { toast } from "sonner";

export type GameMode = "ai" | "human";
export type Difficulty = "easy" | "medium" | "hard" | "master";
export type Side = "white" | "black";

export interface TimeControl {
  id: string;
  label: string;
  initialMs: number;
  incrementMs: number;
}

export const TIME_CONTROLS: TimeControl[] = [
  { id: "bullet", label: "1 + 0 Bullet", initialMs: 60_000, incrementMs: 0 },
  { id: "blitz3", label: "3 + 2 Blitz", initialMs: 180_000, incrementMs: 2_000 },
  { id: "blitz5", label: "5 + 0 Blitz", initialMs: 300_000, incrementMs: 0 },
  { id: "rapid", label: "10 + 0 Rapid", initialMs: 600_000, incrementMs: 0 },
  { id: "unlimited", label: "Unlimited", initialMs: 0, incrementMs: 0 },
];

export type PromotionPiece = "q" | "r" | "b" | "n";

export interface PieceView {
  id: string;
  square: Square;
  type: PieceSymbol;
  color: Color;
  captured?: boolean;
  spawn?: boolean;
  spawnDelay?: number;
}

export interface GameResult {
  winner: Side | null;
  reason:
    | "checkmate"
    | "resignation"
    | "timeout"
    | "stalemate"
    | "insufficient"
    | "threefold"
    | "fifty"
    | "agreement";
}

export interface EngineInfo {
  evalCp: number;
  mateIn?: number;
  depth: number;
  nodes: number;
  timeMs: number;
  level: Difficulty;
}

interface Stats {
  wins: number;
  losses: number;
  draws: number;
}

const STATS_KEY = "sovereign-chess-stats-v1";
const SETTINGS_KEY = "sovereign-chess-settings-v1";

const PIECE_VALUE: Record<PieceSymbol, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
};

function loadJSON<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as object) } as T : fallback;
  } catch {
    return fallback;
  }
}

function sideOf(c: Color): Side {
  return c === "w" ? "white" : "black";
}
function charOf(s: Side): Color {
  return s === "white" ? "w" : "b";
}

function fenToPieces(fen: string, opts?: { spawn?: boolean }): PieceView[] {
  const placement = fen.split(" ")[0];
  const rows = placement.split("/");
  const out: PieceView[] = [];
  let n = 0;
  for (let r = 0; r < 8; r++) {
    let file = 0;
    for (const ch of rows[r]) {
      if (/\d/.test(ch)) {
        file += Number(ch);
        continue;
      }
      const color: Color = ch === ch.toUpperCase() ? "w" : "b";
      const type = ch.toLowerCase() as PieceSymbol;
      const rank = 8 - r;
      const square = `${String.fromCharCode(97 + file)}${rank}` as Square;
      out.push({
        id: `p${n}-${color}${type}-${square}`,
        square,
        type,
        color,
        spawn: opts?.spawn,
        spawnDelay: opts?.spawn ? n * 14 : 0,
      });
      n++;
      file++;
    }
  }
  return out;
}

function classifyDraw(game: Chess): GameResult["reason"] {
  if (game.isStalemate()) return "stalemate";
  if (game.isThreefoldRepetition()) return "threefold";
  if (game.isInsufficientMaterial()) return "insufficient";
  return "fifty";
}

export function useChessGame() {
  const gameRef = useRef<Chess>(new Chess());
  const idRef = useRef(0);
  const engineReqRef = useRef(0);
  const clockSideRef = useRef<Color>("w");
  const endedRef = useRef(false); // makes endGame idempotent across delayed timers
  const engineFailRef = useRef(0); // consecutive engine failures (for retry toast)

  // ---------- persisted preferences (hydrated after mount to avoid SSR mismatch) ----------
  const [mode, setMode] = useState<GameMode>("ai");
  const [difficulty, setDifficulty] = useState<Difficulty>("hard");
  const [soundOn, setSoundOn] = useState(true);
  const [showLegal, setShowLegal] = useState(true);
  const [showCoords, setShowCoords] = useState(true);
  const [autoQueen, setAutoQueen] = useState(false);
  const [preferredSide, setPreferredSide] = useState<Side>("white");

  // ---------- core game state ----------
  const [fen, setFen] = useState(gameRef.current.fen());
  const [pieces, setPieces] = useState<PieceView[]>(() =>
    fenToPieces(gameRef.current.fen(), { spawn: true })
  );
  const [history, setHistory] = useState<Move[]>([]);
  const [turn, setTurn] = useState<Color>("w");
  const [lastMove, setLastMove] = useState<{ from: Square; to: Square } | null>(
    null
  );
  const [inCheck, setInCheck] = useState(false);
  const [checkedSquare, setCheckedSquare] = useState<Square | null>(null);

  const [selected, setSelected] = useState<Square | null>(null);
  const [legalForSelected, setLegalForSelected] = useState<Move[]>([]);
  const [pendingPromotion, setPendingPromotion] = useState<{
    from: Square;
    to: Square;
  } | null>(null);

  const [status, setStatus] = useState<"active" | "ended">("active");
  const [result, setResult] = useState<GameResult | null>(null);
  const [drawOfferPending, setDrawOfferPending] = useState<Color | null>(null);

  const [orientation, setOrientation] = useState<Side>("white");
  const [humanColor, setHumanColor] = useState<Side>("white");

  const [activeTimeControl, setActiveTimeControl] = useState<TimeControl>(
    TIME_CONTROLS.find((t) => t.id === "blitz5") ?? TIME_CONTROLS[3]
  );
  const [clocks, setClocks] = useState<{ w: number; b: number }>(() => {
    const tc = TIME_CONTROLS.find((t) => t.id === "blitz5") ?? TIME_CONTROLS[3];
    return { w: tc.initialMs, b: tc.initialMs };
  });

  const [thinking, setThinking] = useState(false);
  const [engineInfo, setEngineInfo] = useState<EngineInfo | null>(null);
  const [hint, setHint] = useState<{ from: Square; to: Square } | null>(null);
  const [hintsUsed, setHintsUsed] = useState(0);

  const [viewIndex, setViewIndex] = useState<number | null>(null);
  const [engineRetryTick, setEngineRetryTick] = useState(0);

  const [stats, setStats] = useState<Stats>({ wins: 0, losses: 0, draws: 0 });

  // ---------- derived ----------
  const engineColor: Color = humanColor === "white" ? "b" : "w";
  const isHumanTurn = mode === "human" || turn === charOf(humanColor);
  const started = history.length >= 1;
  const interactive =
    status === "active" &&
    viewIndex === null &&
    !pendingPromotion &&
    isHumanTurn;
  const viewing = viewIndex !== null;

  const viewFen = useMemo(
    () =>
      viewing && history[viewIndex as number]
        ? history[viewIndex as number].after
        : fen,
    [viewing, viewIndex, history, fen]
  );

  const displayPieces = useMemo(
    () => (viewing ? fenToPieces(viewFen) : pieces),
    [viewing, viewFen, pieces]
  );

  const capturedBy = useMemo(() => {
    const byWhite: PieceSymbol[] = [];
    const byBlack: PieceSymbol[] = [];
    for (const m of history) {
      if (m.captured) {
        (m.color === "w" ? byWhite : byBlack).push(m.captured);
      }
    }
    const val = (p: PieceSymbol) => PIECE_VALUE[p];
    const desc = (a: PieceSymbol, b: PieceSymbol) => val(b) - val(a);
    byWhite.sort(desc);
    byBlack.sort(desc);
    const materialWhite = byWhite.reduce((s, p) => s + val(p), 0);
    const materialBlack = byBlack.reduce((s, p) => s + val(p), 0);
    return {
      byWhite,
      byBlack,
      diff: materialWhite - materialBlack, // + means white ahead
    };
  }, [history]);

  // ---------- persistence ----------
  useEffect(() => {
    setSoundEnabled(soundOn);
  }, [soundOn]);

  useEffect(() => {
    const s = loadJSON(SETTINGS_KEY, {
      mode: "ai" as GameMode,
      difficulty: "hard" as Difficulty,
      timeControlId: "blitz5",
      side: "white" as Side,
      sound: true,
      showLegal: true,
      showCoords: true,
      autoQueen: false,
    });
    setMode(s.mode);
    setDifficulty(s.difficulty);
    setSoundOn(s.sound);
    setShowLegal(s.showLegal);
    setShowCoords(s.showCoords);
    setAutoQueen(s.autoQueen);
    setPreferredSide(s.side);
    setOrientation(s.side);
    setHumanColor(s.side);
    const tc = TIME_CONTROLS.find((t) => t.id === s.timeControlId);
    if (tc) {
      setActiveTimeControl(tc);
      setClocks({ w: tc.initialMs, b: tc.initialMs });
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({
          mode,
          difficulty,
          timeControlId: activeTimeControl.id,
          side: preferredSide,
          sound: soundOn,
          showLegal,
          showCoords,
          autoQueen,
        })
      );
    } catch {
      /* ignore */
    }
  }, [
    mode,
    difficulty,
    activeTimeControl.id,
    preferredSide,
    soundOn,
    showLegal,
    showCoords,
    autoQueen,
  ]);

  useEffect(() => {
    setStats(loadJSON<Stats>(STATS_KEY, { wins: 0, losses: 0, draws: 0 }));
  }, []);

  const bumpStats = useCallback((r: GameResult) => {
    setStats((prev) => {
      const next = { ...prev };
      if (!r.winner) next.draws++;
      else if (r.winner === humanColor) next.wins++;
      else next.losses++;
      try {
        window.localStorage.setItem(STATS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, [humanColor]);

  // ---------- helpers ----------
  const refreshBoardState = useCallback((rebuildPieces = true) => {
    const g = gameRef.current;
    setFen(g.fen());
    setTurn(g.turn());
    const tail = g.history({ verbose: true });
    setHistory(tail);
    const lm = tail[tail.length - 1];
    setLastMove(lm ? { from: lm.from, to: lm.to } : null);
    const check = g.isCheck();
    setInCheck(check);
    if (check) {
      const board = g.board();
      let kingSq: Square | null = null;
      for (const row of board) {
        for (const sq of row) {
          if (sq && sq.type === "k" && sq.color === g.turn()) {
            kingSq = sq.square;
          }
        }
      }
      setCheckedSquare(kingSq);
    } else {
      setCheckedSquare(null);
    }
    if (rebuildPieces) {
      setPieces(fenToPieces(g.fen()));
    }
  }, []);

  const endGame = useCallback(
    (r: GameResult, opts?: { silent?: boolean; countStats?: boolean }) => {
      if (endedRef.current) return; // a finished game can never end twice
      if (gameRef.current.isGameOver() === false && r.reason === "checkmate") return;
      endedRef.current = true;
      engineReqRef.current++; // invalidate any in-flight engine request
      setThinking(false);
      setStatus("ended");
      setResult(r);
      setSelected(null);
      setLegalForSelected([]);
      setPendingPromotion(null);
      setHint(null);
      if (!opts?.silent) {
        if (!r.winner) playSound("draw");
        else if (mode === "human") playSound("win");
        else if (r.winner === humanColor) playSound("win");
        else playSound("lose");
      }
      if (opts?.countStats !== false && mode === "ai") bumpStats(r);
    },
    [mode, humanColor, bumpStats]
  );

  const applyMoveRef = useRef<(mv: {
    from: Square;
    to: Square;
    promotion?: PromotionPiece;
  }) => boolean>(() => false);

  // ---------- engine ----------
  const requestEngineMove = useCallback(
    async (reqId: number) => {
      const g = gameRef.current;
      setThinking(true);
      const t0 = Date.now();
      try {
        const res = await fetch("/api/engine", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fen: g.fen(), level: difficulty }),
        });
        if (!res.ok) throw new Error(`Engine error ${res.status}`);
        const data = (await res.json()) as {
          from: Square;
          to: Square;
          promotion?: string;
          san: string;
          evalCp: number;
          mateIn?: number;
          depth: number;
          nodes: number;
          timeMs: number;
        };
        if (
          reqId !== engineReqRef.current ||
          status !== "active" ||
          gameRef.current.fen() !== g.fen()
        ) {
          return; // stale
        }
        engineFailRef.current = 0;
        // reveal the move with a brief arrow, then play it
        setHint({ from: data.from, to: data.to });
        const wait = Math.max(180, 600 - (Date.now() - t0));
        await new Promise((r) => setTimeout(r, wait));
        if (reqId !== engineReqRef.current || status !== "active") return;
        setHint(null);
        applyMoveRef.current({
          from: data.from,
          to: data.to,
          promotion: (data.promotion as PromotionPiece) ?? "q",
        });
        setEngineInfo({
          evalCp: data.evalCp,
          mateIn: data.mateIn,
          depth: data.depth,
          nodes: data.nodes,
          timeMs: data.timeMs,
          level: difficulty,
        });
      } catch {
        if (reqId === engineReqRef.current) {
          setThinking(false);
          lastEngineTurnKey.current = "";
          if (engineFailRef.current === 0) {
            toast.error("Engine hiccup — retrying…");
          }
          engineFailRef.current++;
          // automatic retry with a small backoff keeps the game alive
          window.setTimeout(() => setEngineRetryTick((t) => t + 1), 1500);
        }
      } finally {
        if (reqId === engineReqRef.current) setThinking(false);
      }
    },
    [difficulty, status]
  );

  // ---------- moving ----------
  const applyMove = useCallback(
    (mv: { from: Square; to: Square; promotion?: PromotionPiece }): boolean => {
      const g = gameRef.current;
      let move: Move;
      try {
        move = g.move({ from: mv.from, to: mv.to, promotion: mv.promotion ?? "q" });
      } catch {
        playSound("illegal");
        return false;
      }

      idRef.current++;
      // reconcile animated pieces
      setPieces((prev) => {
        const next: PieceView[] = [];
        const epSquare = move.flags.includes("e")
          ? (`${move.to[0]}${move.from[1]}` as Square)
          : null;
        for (const p of prev) {
          if (p.captured) continue; // already fading
          if (epSquare && p.square === epSquare && p.color !== move.color) {
            next.push({ ...p, id: `${p.id}-x${idRef.current}`, captured: true });
            continue;
          }
          if (p.square === move.to && p.color !== move.color) {
            next.push({ ...p, id: `${p.id}-x${idRef.current}`, captured: true });
            continue;
          }
          if (p.square === move.from && p.color === move.color && p.type === move.piece) {
            next.push({
              ...p,
              square: move.to,
              type: move.promotion ?? p.type,
            });
            continue;
          }
          // castling rook
          if (
            move.piece === "k" &&
            p.type === "r" &&
            p.color === move.color &&
            (move.flags.includes("k") &&
              p.square === (move.color === "w" ? "h1" : "h8"))
          ) {
            next.push({
              ...p,
              square: (move.color === "w" ? "f1" : "f8") as Square,
            });
            continue;
          }
          if (
            move.piece === "k" &&
            p.type === "r" &&
            p.color === move.color &&
            (move.flags.includes("q") &&
              p.square === (move.color === "w" ? "a1" : "a8"))
          ) {
            next.push({
              ...p,
              square: (move.color === "w" ? "d1" : "d8") as Square,
            });
            continue;
          }
          next.push(p);
        }
        return next;
      });

      // cleanup captured fade-out pieces
      window.setTimeout(() => {
        setPieces((prev) => prev.filter((p) => !p.captured));
      }, 320);

      refreshBoardState(false);

      // sounds
      if (move.flags.includes("k") || move.flags.includes("q")) playSound("castle");
      else if (move.captured) playSound("capture");
      else if (move.promotion) playSound("promote");
      else playSound("move");

      const gg = gameRef.current;
      if (gg.isCheckmate()) {
        window.setTimeout(
          () =>
            endGame({
              winner: sideOf(gg.turn() === "w" ? "b" : "w"),
              reason: "checkmate",
            }),
          420
        );
      } else if (gg.isDraw()) {
        window.setTimeout(() => endGame({ winner: null, reason: classifyDraw(gg) }), 420);
      } else if (gg.isCheck()) {
        window.setTimeout(() => playSound("check"), 90);
      }

      setSelected(null);
      setLegalForSelected([]);
      setPendingPromotion(null);
      return true;
    },
    [endGame, refreshBoardState]
  );

  useEffect(() => {
    applyMoveRef.current = applyMove;
  }, [applyMove]);

  const attemptMove = useCallback(
    (from: Square, to: Square): boolean => {
      if (!interactive) return false;
      const g = gameRef.current;
      const candidates = g
        .moves({ square: from, verbose: true })
        .filter((m) => m.to === to);
      if (candidates.length === 0) {
        playSound("illegal");
        return false;
      }
      if (candidates[0].promotion) {
        if (autoQueen) {
          return applyMove({ from, to, promotion: "q" });
        }
        setPendingPromotion({ from, to });
        return true;
      }
      return applyMove({ from, to });
    },
    [interactive, autoQueen, applyMove]
  );

  const selectSquare = useCallback(
    (square: Square | null) => {
      if (!interactive) {
        setSelected(null);
        setLegalForSelected([]);
        return;
      }
      if (square === null) {
        setSelected(null);
        setLegalForSelected([]);
        return;
      }
      if (selected === square) {
        setSelected(null);
        setLegalForSelected([]);
        return;
      }
      const g = gameRef.current;
      const piece = g.get(square);
      if (piece && piece.color === g.turn()) {
        setSelected(square);
        setLegalForSelected(g.moves({ square, verbose: true }));
        playSound("select");
        return;
      }
      // clicking a target square
      if (selected && legalForSelected.some((m) => m.to === square)) {
        attemptMove(selected, square);
        return;
      }
      setSelected(null);
      setLegalForSelected([]);
    },
    [interactive, selected, legalForSelected, attemptMove]
  );

  const promote = useCallback(
    (piece: PromotionPiece) => {
      if (!pendingPromotion) return;
      applyMove({ from: pendingPromotion.from, to: pendingPromotion.to, promotion: piece });
    },
    [pendingPromotion, applyMove]
  );

  const cancelPromotion = useCallback(() => {
    setPendingPromotion(null);
    setSelected(null);
    setLegalForSelected([]);
  }, []);

  // ---------- engine auto-play effect ----------
  const engineTurnKey = `${fen}|${mode}|${status}|${viewIndex}|${difficulty}|${pendingPromotion ? 1 : 0}|${engineRetryTick}`;
  const lastEngineTurnKey = useRef("");
  useEffect(() => {
    if (mode !== "ai" || status !== "active" || viewing || pendingPromotion) {
      return;
    }
    if (gameRef.current.turn() !== engineColor) return;
    if (lastEngineTurnKey.current === engineTurnKey) return;
    const reqId = ++engineReqRef.current;
    // Latch only when the request actually fires — if the user scrubs history
    // during the scheduling window the cleanup below cancels the timer, the
    // latch stays unset, and returning to Live reschedules cleanly.
    const t = window.setTimeout(() => {
      lastEngineTurnKey.current = engineTurnKey;
      void requestEngineMove(reqId);
    }, 240);
    return () => window.clearTimeout(t);
  }, [engineTurnKey]);

  // ---------- clock ----------
  useEffect(() => {
    clockSideRef.current = turn;
  }, [turn]);

  useEffect(() => {
    if (status !== "active" || activeTimeControl.initialMs === 0) return;
    if (history.length === 0) return; // clock starts after the first move
    let last = Date.now();
    const iv = window.setInterval(() => {
      const now = Date.now();
      const dt = now - last;
      last = now;
      setClocks((prev) => {
        const side = clockSideRef.current;
        return { ...prev, [side]: Math.max(0, prev[side] - dt) };
      });
    }, 100);
    return () => window.clearInterval(iv);
  }, [status, activeTimeControl.initialMs, turn, fen]);

  useEffect(() => {
    if (status !== "active" || activeTimeControl.initialMs === 0) return;
    if (clocks.w <= 0) endGame({ winner: "black", reason: "timeout" });
    else if (clocks.b <= 0) endGame({ winner: "white", reason: "timeout" });
  }, [clocks, status, activeTimeControl.initialMs, endGame]);

  // ---------- actions ----------
  const newGame = useCallback(
    (opts?: {
      mode?: GameMode;
      difficulty?: Difficulty;
      side?: Side | "random";
      timeControlId?: string;
    }) => {
      engineReqRef.current++;
      const nextMode = opts?.mode ?? mode;
      const nextSide: Side =
        opts?.side === "random"
          ? Math.random() < 0.5
            ? "white"
            : "black"
          : (opts?.side ?? preferredSide);
      const tc =
        TIME_CONTROLS.find((t) => t.id === opts?.timeControlId) ??
        activeTimeControl;

      gameRef.current = new Chess();
      idRef.current++;
      endedRef.current = false;
      lastEngineTurnKey.current = "";
      setMode(nextMode);
      if (opts?.difficulty) setDifficulty(opts.difficulty);
      if (opts?.side) setPreferredSide(nextSide === "white" ? "white" : "black");
      setActiveTimeControl(tc);
      setHumanColor(nextSide);
      setOrientation(nextSide);
      setFen(gameRef.current.fen());
      setPieces(fenToPieces(gameRef.current.fen(), { spawn: true }));
      setHistory([]);
      setTurn("w");
      setLastMove(null);
      setInCheck(false);
      setCheckedSquare(null);
      setSelected(null);
      setLegalForSelected([]);
      setPendingPromotion(null);
      setStatus("active");
      setResult(null);
      setDrawOfferPending(null);
      setClocks({ w: tc.initialMs, b: tc.initialMs });
      setThinking(false);
      setEngineInfo(null);
      setHint(null);
      setHintsUsed(0);
      setViewIndex(null);
    },
    [mode, preferredSide, activeTimeControl]
  );

  const undo = useCallback(() => {
    engineReqRef.current++;
    setThinking(false);
    const g = gameRef.current;
    if (g.history().length === 0) return;
    if (mode === "ai" && g.turn() === charOf(humanColor) && g.history().length >= 2) {
      g.undo(); // engine reply
      g.undo(); // human move
    } else {
      g.undo();
    }
    setSelected(null);
    setLegalForSelected([]);
    setPendingPromotion(null);
    setHint(null);
    setViewIndex(null);
    endedRef.current = false;
    if (status === "ended") {
      setStatus("active");
      setResult(null);
    }
    lastEngineTurnKey.current = "";
    refreshBoardState();
    playSound("move");
  }, [mode, humanColor, status, refreshBoardState]);

  const resign = useCallback(() => {
    if (status !== "active") return;
    const loser: Side = mode === "ai" ? humanColor : sideOf(turn);
    endGame({ winner: loser === "white" ? "black" : "white", reason: "resignation" });
    toast(`${loser === "white" ? "White" : "Black"} resigned.`, {
      description: "The crown changes hands.",
    });
  }, [status, mode, humanColor, turn, endGame]);

  const offerDraw = useCallback(() => {
    if (status !== "active") return;
    if (mode === "human") {
      setDrawOfferPending(turn);
      return;
    }
    // AI decides: accepts only if clearly worse and past the opening
    const evalCp = engineInfo?.evalCp ?? 0;
    const aiIsWhite = engineColor === "w";
    const aiEval = aiIsWhite ? evalCp : -evalCp;
    if (aiEval < -180 && history.length >= 24) {
      endGame({ winner: null, reason: "agreement" });
      toast("Draw agreed", { description: "The Grandmaster accepts your offer." });
    } else {
      toast("Draw declined", {
        description: "The Grandmaster smells blood and plays on.",
      });
    }
  }, [status, mode, turn, engineInfo, engineColor, history.length, endGame]);

  const resolveDrawOffer = useCallback(
    (accept: boolean) => {
      setDrawOfferPending(null);
      if (accept) endGame({ winner: null, reason: "agreement" });
    },
    [endGame]
  );

  const requestHint = useCallback(async () => {
    if (status !== "active" || thinking || !isHumanTurn) return;
    if (hintsUsed >= 3) {
      toast("No hints left", {
        description: "Three whispers per game — the rest is destiny.",
      });
      return;
    }
    setHintsUsed((h) => h + 1);
    setThinking(true);
    try {
      const res = await fetch("/api/engine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fen: gameRef.current.fen(), level: "hard" }),
      });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { from: Square; to: Square };
      setHint({ from: data.from, to: data.to });
      setSelected(null);
      setLegalForSelected([]);
      window.setTimeout(() => setHint((h) => (h?.from === data.from && h?.to === data.to ? null : h)), 2600);
    } catch {
      toast.error("Hint unavailable right now.");
    } finally {
      setThinking(false);
    }
  }, [status, thinking, isHumanTurn, hintsUsed]);

  const flipBoard = useCallback(() => {
    setOrientation((o) => (o === "white" ? "black" : "white"));
  }, []);

  const goToHistory = useCallback((index: number | null) => {
    setViewIndex(index);
    setSelected(null);
    setLegalForSelected([]);
  }, []);

  const primeAudioOnGesture = useCallback(() => {
    primeAudio();
  }, []);

  return {
    // state
    fen,
    pieces: displayPieces,
    livePieces: pieces,
    history,
    turn,
    lastMove,
    inCheck,
    checkedSquare,
    selected,
    legalForSelected,
    pendingPromotion,
    status,
    result,
    orientation,
    humanColor,
    engineColor: sideOf(engineColor),
    mode,
    difficulty,
    soundOn,
    showLegal,
    showCoords,
    autoQueen,
    preferredSide,
    clocks,
    activeTimeControl,
    thinking,
    engineInfo,
    hint,
    hintsUsed,
    viewIndex,
    viewing,
    interactive,
    started,
    stats,
    drawOfferPending,
    capturedBy,
    // actions
    selectSquare,
    attemptMove,
    promote,
    cancelPromotion,
    newGame,
    undo,
    resign,
    offerDraw,
    resolveDrawOffer,
    requestHint,
    flipBoard,
    goToHistory,
    setSoundOn,
    setShowLegal,
    setShowCoords,
    setAutoQueen,
    setMode,
    setDifficulty,
    setPreferredSide,
    primeAudioOnGesture,
  };
}

export type ChessGame = ReturnType<typeof useChessGame>;
