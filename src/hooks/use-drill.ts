"use client";

/**
 * useDrill — the "Queen Checkmate" endgame drill.
 * Random K+Q vs K position; the engine defends, you convert the win.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess, type Move, type Square } from "chess.js";
import { playSound } from "@/lib/sounds";
import { fenToPieces } from "@/lib/chess-utils";
import { loadProfile, type LearningProfile } from "@/lib/game-store";
import { awardDrill } from "@/lib/career";

export type DrillStatus = "playing" | "won" | "drawn";

const FILES = "abcdefgh";

function randomInt(n: number): number {
  return Math.floor(Math.random() * n);
}

function buildDrillFen(): string {
  for (let attempt = 0; attempt < 500; attempt++) {
    const bkFile = randomInt(8);
    const bkRank = 1 + randomInt(8);
    const bk = `${FILES[bkFile]}${bkRank}`;

    let wk = "";
    for (let t = 0; t < 100; t++) {
      const f = FILES[randomInt(8)];
      const r = 1 + randomInt(8);
      const cand = `${f}${r}`;
      const dist = Math.max(Math.abs(f.charCodeAt(0) - bkFile - 97), Math.abs(r - bkRank));
      if (dist >= 2 && cand !== bk) {
        wk = cand;
        break;
      }
    }
    if (!wk) continue;

    let q = "";
    for (let t = 0; t < 100; t++) {
      const f = FILES[randomInt(8)];
      const r = 1 + randomInt(8);
      const cand = `${f}${r}`;
      if (cand === bk || cand === wk) continue;
      // queen must not already check the black king
      const attacks =
        f.charCodeAt(0) - 97 === bkFile ||
        r === bkRank ||
        Math.abs(f.charCodeAt(0) - 97 - bkFile) === Math.abs(r - bkRank);
      if (!attacks) {
        q = cand;
        break;
      }
    }
    if (!q) continue;

    // assemble placement: rank 8 → 1
    const placement: string[] = [];
    for (let r = 8; r >= 1; r--) {
      let row = "";
      for (let fi = 0; fi < 8; fi++) {
        const sq = `${FILES[fi]}${r}`;
        if (sq === wk) row += "K";
        else if (sq === q) row += "Q";
        else if (sq === bk) row += "k";
        else row += "1";
      }
      // compress
      placement.push(row.replace(/1+/g, (m) => String(m.length)));
    }

    const candidate = `${placement.join("/")}/w - - 0 1`;
    try {
      const g = new Chess(candidate);
      if (g.isGameOver()) continue; // stalemate in place — reject
      return candidate;
    } catch {
      continue;
    }
  }
  // extremely unlikely fallback: a known good teaching position
  return "8/8/8/4k3/8/8/4K3/7Q w - - 0 1";
}

export function useDrill() {
  const [fen, setFen] = useState<string>("");
  const [status, setStatus] = useState<DrillStatus>("playing");
  const [moveCount, setMoveCount] = useState(0);
  const [thinking, setThinking] = useState(false);
  const [lastMove, setLastMove] = useState<{ from: Square; to: Square } | null>(null);
  const [profile, setProfile] = useState<LearningProfile | null>(null);
  const chessRef = useRef<Chess>(new Chess());
  const reqIdRef = useRef(0);

  useEffect(() => {
    setProfile(loadProfile());
  }, []);

  const start = useCallback(() => {
    reqIdRef.current++;
    const f = buildDrillFen();
    chessRef.current = new Chess(f);
    setFen(f);
    setStatus("playing");
    setMoveCount(0);
    setLastMove(null);
    setThinking(false);
  }, []);

  useEffect(() => {
    start();
  }, [start]);

  const engineTurn = useCallback(
    async (reqId: number) => {
      const g = chessRef.current;
      if (g.isGameOver()) return;
      setThinking(true);
      try {
        const res = await fetch("/api/engine", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fen: g.fen(), level: "medium" }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { from: Square; to: Square; promotion?: string };
        if (reqId !== reqIdRef.current) return;
        const played = g.move({
          from: data.from,
          to: data.to,
          promotion: (data.promotion as "q") ?? "q",
        });
        playSound(played.captured ? "capture" : "move");
        setLastMove({ from: played.from as Square, to: played.to as Square });
        setFen(g.fen());
      } catch {
        // engine hiccup: play a random legal retreat so the drill continues
        const moves = g.moves({ verbose: true });
        if (moves.length > 0 && reqId === reqIdRef.current) {
          const m = moves[randomInt(moves.length)];
          try {
            const played = g.move({ from: m.from, to: m.to, promotion: "q" });
            playSound("move");
            setLastMove({ from: played.from as Square, to: played.to as Square });
            setFen(g.fen());
          } catch {
            /* ignore */
          }
        }
      } finally {
        if (reqId === reqIdRef.current) setThinking(false);
      }
    },
    []
  );

  const attemptMove = useCallback(
    (from: Square, to: Square, promotion?: "q" | "r" | "b" | "n"): boolean => {
      if (status !== "playing") return false;
      const g = chessRef.current;
      const candidates = g.moves({ square: from, verbose: true }).filter((m) => m.to === to);
      if (candidates.length === 0) {
        playSound("illegal");
        return false;
      }
      let played: Move;
      try {
        played = g.move({ from, to, promotion: promotion ?? candidates[0].promotion ?? "q" });
      } catch {
        playSound("illegal");
        return false;
      }
      playSound(played.captured ? "capture" : "move");
      if (g.isCheck()) window.setTimeout(() => playSound("check"), 90);
      setLastMove({ from: played.from as Square, to: played.to as Square });
      setFen(g.fen());
      setMoveCount((c) => c + 1);

      if (g.isCheckmate()) {
        const next = moveCount + 1;
        setStatus("won");
        playSound("win");
        awardDrill(next);
        setProfile(loadProfile());
        return true;
      }
      if (g.isDraw() || g.isStalemate()) {
        setStatus("drawn");
        playSound("draw");
        return true;
      }

      const reqId = ++reqIdRef.current;
      window.setTimeout(() => void engineTurn(reqId), 420);
      return true;
    },
    [status, moveCount, engineTurn]
  );

  const pieces = useMemo(() => (fen ? fenToPieces(fen) : []), [fen]);
  const turn = fen.split(" ")[1] === "b" ? "b" : "w";

  return {
    fen,
    pieces,
    turn,
    status,
    moveCount,
    thinking,
    lastMove,
    profile,
    attemptMove,
    restart: start,
  };
}
