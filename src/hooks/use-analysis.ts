"use client";

/**
 * useAnalysis — the controller behind the Analysis room.
 *
 * A free analysis board (both sides movable) that can also load stored games,
 * step through them ply by ply, run a background engine evaluation pass and
 * turn the numbers into a full game report (classifications + accuracy).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess, type Color, type Move, type Square } from "chess.js";
import { toast } from "sonner";
import { playSound } from "@/lib/sounds";
import { fenToPieces } from "@/lib/chess-utils";
import {
  buildReport,
  fetchEvals,
  type EvalPoint,
  type GameReport,
} from "@/lib/analysis-client";
import {
  deleteRecentGame,
  loadRecentGames,
  saveRecentGame,
  type StoredGame,
} from "@/lib/game-store";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export interface AnalysisMeta {
  label: string;
  result: StoredGame["result"] | null;
  reason?: string;
  date?: number;
  edited?: boolean;
}

export type AnalysisStatus = "idle" | "running" | "done" | "error";

export function useAnalysis(initialGameId?: string | null) {
  const chessRef = useRef<Chess>(new Chess());
  const abortRef = useRef<AbortController | null>(null);
  const evalCacheRef = useRef<Map<string, EvalPoint>>(new Map());
  const loadedInitialRef = useRef(false);

  const [history, setHistory] = useState<Move[]>([]);
  const [viewIndex, setViewIndex] = useState(-1);
  const [orientation, setOrientation] = useState<"white" | "black">("white");
  const [selected, setSelected] = useState<Square | null>(null);
  const [legalForSelected, setLegalForSelected] = useState<Move[]>([]);
  const [pendingPromotion, setPendingPromotion] = useState<{
    from: Square;
    to: Square;
  } | null>(null);

  const [meta, setMeta] = useState<AnalysisMeta>({ label: "Free board", result: null });
  const [evals, setEvals] = useState<(EvalPoint | undefined)[]>([]);
  const [report, setReport] = useState<GameReport | null>(null);
  const [status, setStatus] = useState<AnalysisStatus>("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [liveEval, setLiveEval] = useState<EvalPoint | null>(null);
  const [showBest, setShowBest] = useState(true);

  const [recentGames, setRecentGames] = useState<StoredGame[]>([]);

  /* ------------------------------------------------ load helpers */

  const applyLoaded = useCallback((game: Chess, newMeta: AnalysisMeta) => {
    abortRef.current?.abort();
    chessRef.current = game;
    const h = game.history({ verbose: true }) as Move[];
    setHistory(h);
    setViewIndex(h.length - 1);
    setSelected(null);
    setLegalForSelected([]);
    setPendingPromotion(null);
    setEvals(new Array(h.length + 1).fill(undefined));
    setReport(null);
    setStatus("idle");
    setProgress({ done: 0, total: 0 });
    setLiveEval(null);
    setMeta(newMeta);
  }, []);

  const loadStoredGame = useCallback(
    (g: StoredGame) => {
      const c = new Chess();
      try {
        c.loadPgn(g.pgn, { strict: false });
      } catch {
        toast.error("This game's notation could not be read.");
        return;
      }
      if (c.history().length === 0) {
        toast.error("This game has no moves to analyze.");
        return;
      }
      evalCacheRef.current.clear();
      applyLoaded(c, {
        label: g.label,
        result: g.result,
        reason: g.reason,
        date: g.date,
      });
      setRecentGames((prev) => (prev.some((x) => x.id === g.id) ? prev : [g, ...prev].slice(0, 30)));
    },
    [applyLoaded]
  );

  const loadStoredGameRef = useRef(loadStoredGame);
  useEffect(() => {
    loadStoredGameRef.current = loadStoredGame;
  }, [loadStoredGame]);

  // initial mount: load recent list + optionally the game that was "sent" here
  useEffect(() => {
    if (loadedInitialRef.current) return;
    loadedInitialRef.current = true;
    const games = loadRecentGames();
    setRecentGames(games);
    if (initialGameId) {
      const g = games.find((x) => x.id === initialGameId);
      if (g) loadStoredGameRef.current(g);
    }
  }, [initialGameId]);

  /* ------------------------------------------------ derived (display) */

  const atLive = viewIndex === history.length - 1;
  const viewMove = viewIndex >= 0 && viewIndex < history.length ? history[viewIndex] : null;
  const viewFen = viewMove ? viewMove.after : (history[0]?.before ?? START_FEN);

  const pieces = useMemo(() => fenToPieces(viewFen), [viewFen]);
  const displayTurn: Color = (viewFen.split(" ")[1] === "b" ? "b" : "w") as Color;
  const lastMove = viewMove ? { from: viewMove.from as Square, to: viewMove.to as Square } : null;

  const checkedSquare = useMemo<Square | null>(() => {
    try {
      const g = new Chess(viewFen);
      if (!g.isCheck()) return null;
      for (const row of g.board()) {
        for (const sq of row) {
          if (sq && sq.type === "k" && sq.color === g.turn()) return sq.square;
        }
      }
    } catch {
      /* ignore */
    }
    return null;
  }, [viewFen]);

  const coveredEval = evals[viewIndex + 1];
  const engineBest =
    showBest && liveEval?.bestFrom && liveEval.bestTo
      ? { from: liveEval.bestFrom as Square, to: liveEval.bestTo as Square }
      : null;

  /* ------------------------------------------------ live eval */

  useEffect(() => {
    if (coveredEval) {
      setLiveEval(coveredEval);
      return;
    }
    let cancelled = false;
    setLiveEval(null);
    const t = window.setTimeout(async () => {
      const cached = evalCacheRef.current.get(viewFen);
      if (cached) {
        if (!cancelled) setLiveEval(cached);
        return;
      }
      try {
        const res = await fetch("/api/engine/eval", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fen: viewFen, level: "medium" }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          evalCp: number;
          mateIn?: number;
          from?: string;
          to?: string;
          san?: string;
        };
        const point: EvalPoint = {
          cp: data.evalCp,
          mateIn: data.mateIn,
          bestFrom: data.from,
          bestTo: data.to,
          bestSan: data.san,
        };
        evalCacheRef.current.set(viewFen, point);
        if (!cancelled) setLiveEval(point);
      } catch {
        /* silent — live eval is best-effort */
      }
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [viewFen, coveredEval]);

  /* ------------------------------------------------ free-play moves */

  const truncateToView = useCallback(
    (g: Chess) => {
      while (g.history().length - 1 > viewIndex && g.history().length > 0) g.undo();
    },
    [viewIndex]
  );

  const attemptMove = useCallback(
    (from: Square, to: Square, promotion?: "q" | "r" | "b" | "n"): boolean => {
      const g = chessRef.current;
      if (viewIndex !== g.history().length - 1) {
        truncateToView(g);
        const h = g.history({ verbose: true }) as Move[];
        setHistory(h);
        setEvals((prev) => prev.slice(0, h.length + 1));
      }

      const candidates = g
        .moves({ square: from, verbose: true })
        .filter((m) => m.to === to);
      if (candidates.length === 0) {
        playSound("illegal");
        return false;
      }
      if (candidates[0].promotion && !promotion) {
        setPendingPromotion({ from, to });
        return true;
      }

      let move: Move;
      try {
        move = g.move({ from, to, promotion: promotion ?? "q" });
      } catch {
        playSound("illegal");
        return false;
      }

      playSound(
        move.flags.includes("k") || move.flags.includes("q")
          ? "castle"
          : move.captured
            ? "capture"
            : move.promotion
              ? "promote"
              : "move"
      );
      if (g.isCheck()) {
        window.setTimeout(() => playSound("check"), 90);
      }

      setSelected(null);
      setLegalForSelected([]);
      setPendingPromotion(null);
      setEvals((prev) => prev.slice(0, g.history().length + 1));
      setReport(null);
      setStatus("idle");
      setProgress({ done: 0, total: 0 });
      setHistory(g.history({ verbose: true }) as Move[]);
      setViewIndex(g.history().length - 1);
      setMeta((m) => ({ ...m, edited: true }));
      return true;
    },
    [viewIndex, truncateToView]
  );

  const selectSquare = useCallback(
    (square: Square | null) => {
      if (square === null || selected === square) {
        setSelected(null);
        setLegalForSelected([]);
        return;
      }
      const g = new Chess(viewFen);
      const piece = g.get(square);
      if (piece) {
        setSelected(square);
        setLegalForSelected(g.moves({ square, verbose: true }));
        playSound("select");
        return;
      }
      if (selected && legalForSelected.some((m) => m.to === square)) {
        attemptMove(selected, square);
        return;
      }
      setSelected(null);
      setLegalForSelected([]);
    },
    [selected, legalForSelected, viewFen, attemptMove]
  );

  const promote = useCallback(
    (piece: "q" | "r" | "b" | "n") => {
      if (!pendingPromotion) return;
      attemptMove(pendingPromotion.from, pendingPromotion.to, piece);
    },
    [pendingPromotion, attemptMove]
  );

  const cancelPromotion = useCallback(() => {
    setPendingPromotion(null);
    setSelected(null);
    setLegalForSelected([]);
  }, []);

  /* ------------------------------------------------ navigation */

  const goTo = useCallback(
    (i: number) => {
      const clamped = Math.max(-1, Math.min(history.length - 1, i));
      setViewIndex(clamped);
      setSelected(null);
      setLegalForSelected([]);
    },
    [history.length]
  );

  /* ------------------------------------------------ report */

  const runAnalysis = useCallback(async () => {
    const moves = history;
    if (moves.length === 0) {
      toast("Nothing to analyze yet", {
        description: "Play or load some moves first.",
      });
      return;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    const fens = [moves[0].before, ...moves.map((m) => m.after)];
    setStatus("running");
    setProgress({ done: 0, total: fens.length });
    setEvals(new Array(fens.length).fill(undefined));

    try {
      const cached = fens.map((f) => evalCacheRef.current.get(f));
      let done = cached.filter(Boolean).length;
      const points: (EvalPoint | undefined)[] = [...cached];
      setProgress({ done, total: fens.length });

      const missing: { fen: string; idx: number }[] = [];
      fens.forEach((f, idx) => {
        if (!cached[idx]) missing.push({ fen: f, idx });
      });

      const CHUNK = 8;
      for (let i = 0; i < missing.length; i += CHUNK) {
        const slice = missing.slice(i, i + CHUNK);
        const res = await fetch("/api/analysis", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fens: slice.map((s) => s.fen) }),
          signal: ac.signal,
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { results: EvalPoint[] };
        data.results.forEach((r, j) => {
          const idx = slice[j].idx;
          points[idx] = r;
          evalCacheRef.current.set(slice[j].fen, r);
        });
        done += slice.length;
        setProgress({ done: Math.min(done, fens.length), total: fens.length });
        setEvals([...points]);
      }

      const filled = points.map((p) => p ?? { cp: 0 });
      const terminalMate = chessRef.current.isCheckmate();
      let result = meta.result ?? "*";
      if (terminalMate) {
        result = chessRef.current.turn() === "w" ? "0-1" : "1-0";
      }
      const rep = buildReport(moves, filled, { result, mate: terminalMate });
      setReport(rep);
      setStatus("done");
    } catch {
      if (!ac.signal.aborted) {
        setStatus("error");
        toast.error("Analysis hit a snag — please try again.");
      }
    }
  }, [history, meta.result]);

  const cancelAnalysis = useCallback(() => {
    abortRef.current?.abort();
    setStatus("idle");
  }, []);

  /* ------------------------------------------------ pgn / storage */

  const importPgn = useCallback(
    (text: string): boolean => {
      const c = new Chess();
      try {
        c.loadPgn(text.trim(), { strict: false });
      } catch {
        toast.error("Could not read that PGN.");
        return false;
      }
      if (c.history().length === 0) {
        toast.error("No moves found in that PGN.");
        return false;
      }
      let white = "White";
      let black = "Black";
      let result: StoredGame["result"] = "*";
      try {
        const h = c.getHeaders();
        white = h.White || white;
        black = h.Black || black;
        if (["1-0", "0-1", "1/2-1/2"].includes(h.Result)) {
          result = h.Result as StoredGame["result"];
        }
      } catch {
        /* headers optional */
      }
      const label = `${white} vs ${black}`;
      const stored = saveRecentGame({
        pgn: c.pgn(),
        plies: c.history().length,
        result,
        label,
      });
      evalCacheRef.current.clear();
      applyLoaded(c, { label, result, date: stored.date });
      setRecentGames((prev) => [stored, ...prev].slice(0, 30));
      toast("Game imported", { description: label });
      return true;
    },
    [applyLoaded]
  );

  const exportPgn = useCallback(() => {
    const pgn = chessRef.current.pgn();
    if (!pgn) {
      toast.error("Nothing to export yet.");
      return;
    }
    navigator.clipboard
      .writeText(pgn)
      .then(() => toast("PGN copied to clipboard"))
      .catch(() => toast.error("Clipboard unavailable"));
  }, []);

  const clearBoard = useCallback(() => {
    evalCacheRef.current.clear();
    applyLoaded(new Chess(), { label: "Free board", result: null });
  }, [applyLoaded]);

  const removeGame = useCallback((id: string) => {
    setRecentGames(deleteRecentGame(id));
  }, []);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  return {
    // display state
    fen: viewFen,
    pieces,
    history,
    viewIndex,
    atLive,
    lastMove,
    checkedSquare,
    displayTurn,
    orientation,
    selected,
    legalForSelected,
    pendingPromotion,
    meta,
    // engine / report
    evals,
    liveEval,
    showBest,
    setShowBest,
    engineBest,
    report,
    status,
    progress,
    // storage
    recentGames,
    // actions
    selectSquare,
    attemptMove,
    promote,
    cancelPromotion,
    goTo,
    runAnalysis,
    cancelAnalysis,
    loadStoredGame,
    importPgn,
    exportPgn,
    clearBoard,
    removeGame,
    setOrientation,
  };
}

export type Analysis = ReturnType<typeof useAnalysis>;
