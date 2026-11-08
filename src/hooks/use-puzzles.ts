"use client";

/**
 * usePuzzles — the tactics trainer controller.
 * Verifies each solver move against the curated solution lines, auto-plays
 * opponent replies, and keeps score (streak, XP) in the learning profile.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess, type Move, type Square } from "chess.js";
import { playSound } from "@/lib/sounds";
import { fenToPieces } from "@/lib/chess-utils";
import { PUZZLES, type Puzzle } from "@/lib/puzzles";
import { loadProfile, updateProfile, type LearningProfile } from "@/lib/game-store";

export type PuzzleStatus = "solving" | "solved" | "failed" | "revealed";

function norm(san: string): string {
  return san.replace(/[+#!?]/g, "");
}

function anyLegalMove(g: Chess): Move | null {
  const moves = g.moves({ verbose: true });
  if (moves.length === 0) return null;
  const captures = moves.filter((m) => m.captured);
  if (captures.length > 0) {
    const val = (p: string) => ({ q: 9, r: 5, b: 3, n: 3, p: 1, k: 0 })[p] ?? 0;
    captures.sort((a, b) => val(b.captured ?? "p") - val(a.captured ?? "p"));
    return captures[0];
  }
  return moves[Math.floor(Math.random() * moves.length)];
}

function sanToMove(g: Chess, san: string): Move | null {
  const target = norm(san);
  return (
    g
      .moves({ verbose: true })
      .find((m) => norm(m.san) === target || norm(`${m.san}`) === target) ?? null
  );
}

export function usePuzzles() {
  // deterministic on the server; shuffled after mount to avoid hydration mismatch
  const [idx, setIdx] = useState(0);
  const puzzle = PUZZLES[idx];

  const chessRef = useRef<Chess>(new Chess(puzzle.fen));
  const replyTimer = useRef<number | null>(null);
  const solvedRef = useRef(false);

  const [fen, setFen] = useState(puzzle.fen);
  const [step, setStep] = useState(0);
  const [activeLine, setActiveLine] = useState(0);
  const [status, setStatus] = useState<PuzzleStatus>("solving");
  const [wrongTick, setWrongTick] = useState(0);
  const [hintFrom, setHintFrom] = useState<Square | null>(null);
  const [profile, setProfile] = useState<LearningProfile>(DEFAULT_PROFILE_PLACEHOLDER);

  // hydrate profile after mount
  useEffect(() => {
    setProfile(loadProfile());
  }, []);

  const loadPuzzle = useCallback((p: Puzzle) => {
    if (replyTimer.current) window.clearTimeout(replyTimer.current);
    chessRef.current = new Chess(p.fen);
    solvedRef.current = false;
    setFen(p.fen);
    setStep(0);
    setActiveLine(0);
    setStatus("solving");
    setHintFrom(null);
    setWrongTick(0);
  }, []);

  const nextPuzzle = useCallback(() => {
    const next = (idx + 1) % PUZZLES.length;
    setIdx(next);
    loadPuzzle(PUZZLES[next]);
  }, [idx, loadPuzzle]);

  const retryPuzzle = useCallback(() => {
    loadPuzzle(puzzle);
  }, [puzzle, loadPuzzle]);

  // shuffle the opening puzzle once after mount (avoids hydration mismatch)
  const shuffledRef = useRef(false);
  useEffect(() => {
    if (shuffledRef.current) return;
    shuffledRef.current = true;
    const t = window.setTimeout(() => {
      const next = Math.floor(Math.random() * PUZZLES.length);
      if (next !== idx) {
        setIdx(next);
        loadPuzzle(PUZZLES[next]);
      }
    }, 0);
    return () => window.clearTimeout(t);
  }, [idx, loadPuzzle]);

  const clearHint = useCallback(() => setHintFrom(null), []);

  /* ------------------------- success handling ------------------------- */

  const markSolved = useCallback(
    (p: Puzzle) => {
      if (solvedRef.current) return;
      solvedRef.current = true;
      setStatus("solved");
      playSound("win");
      setProfile(
        updateProfile((prev) => ({
          ...prev,
          xp: prev.xp + 5,
          puzzleStreak: prev.puzzleStreak + 1,
          bestStreak: Math.max(prev.bestStreak, prev.puzzleStreak + 1),
          solvedPuzzles: prev.solvedPuzzles.includes(p.id)
            ? prev.solvedPuzzles
            : [...prev.solvedPuzzles, p.id],
        }))
      );
    },
    []
  );

  const markFailed = useCallback(() => {
    setStatus("failed");
    setProfile(
      updateProfile((prev) => ({
        ...prev,
        puzzleStreak: 0,
        puzzleAttempts: prev.puzzleAttempts + 1,
      }))
    );
  }, []);

  /* ------------------------- auto reply ------------------------- */

  const puzzleRefCurrent = useRef<Puzzle | null>(null);
  puzzleRefCurrent.current = puzzle;

  const autoReply = useCallback(
    (lineIdx: number, stepIdx: number) => {
      replyTimer.current = window.setTimeout(() => {
        const g = chessRef.current;
        if (g.isGameOver()) return;
        const puzzleRef = puzzleRefCurrent.current;
        const accepted = puzzleRef?.lines[lineIdx]?.replies[stepIdx] ?? [];
        let replyMove: Move | null = null;
        for (const san of accepted) {
          const m = sanToMove(g, san);
          if (m) {
            replyMove = m;
            break;
          }
        }
        if (!replyMove) replyMove = anyLegalMove(g);
        if (!replyMove) return;
        try {
          const played = g.move({
            from: replyMove.from,
            to: replyMove.to,
            promotion: replyMove.promotion ?? "q",
          });
          playSound(played.captured ? "capture" : "move");
          if (g.isCheck()) window.setTimeout(() => playSound("check"), 90);
          setFen(g.fen());
        } catch {
          /* shouldn't happen */
        }
      }, 520);
    },
    []
  );

  /* ------------------------- solver move ------------------------- */

  const attemptMove = useCallback(
    (from: Square, to: Square): boolean => {
      if (status !== "solving") return false;
      const g = chessRef.current;
      const candidates = g.moves({ square: from, verbose: true }).filter((m) => m.to === to);
      if (candidates.length === 0) {
        playSound("illegal");
        return false;
      }
      const played = norm(candidates[0].san);

      // accept the move if it matches a line at the current step
      // (step 0 accepts any line's first move — alt keys; later steps follow the active line)
      let matchedLine = -1;
      puzzle.lines.forEach((line, li) => {
        const expected = line.userMoves[step];
        if (!expected) return;
        if (step > 0 && li !== activeLine) return;
        if (norm(expected) === played) matchedLine = li;
      });

      const isFinal = matchedLine >= 0 && step === puzzle.lines[matchedLine].userMoves.length - 1;
      const altMate =
        matchedLine === -1 &&
        (() => {
          // alternative winning move: immediate mate on the final step
          try {
            const probe = new Chess(g.fen());
            probe.move({ from, to, promotion: "q" });
            return probe.isCheckmate() && step === puzzle.lines[0].userMoves.length - 1;
          } catch {
            return false;
          }
        })();

      if (matchedLine === -1 && !altMate) {
        playSound("illegal");
        setWrongTick((t) => t + 1);
        markFailed();
        return false;
      }

      // apply the move
      let move: Move;
      try {
        move = g.move({ from, to, promotion: candidates[0].promotion ?? "q" });
      } catch {
        playSound("illegal");
        return false;
      }
      playSound(move.captured ? "capture" : "move");
      setFen(g.fen());
      setHintFrom(null);

      const lineIdx = matchedLine === -1 ? activeLine : matchedLine;
      if (lineIdx !== activeLine) setActiveLine(lineIdx);

      if (isFinal || altMate) {
        window.setTimeout(() => markSolved(puzzle), 420);
      } else {
        setStep(step + 1);
        autoReply(lineIdx, step);
      }
      return true;
    },
    [status, puzzle, step, activeLine, autoReply, markSolved, markFailed]
  );

  /* ------------------------- hint / solution ------------------------- */

  const showHint = useCallback(() => {
    if (status !== "solving") return;
    const expected = puzzle.lines[activeLine].userMoves[step];
    if (!expected) return;
    const m = sanToMove(chessRef.current, expected);
    if (m) {
      setHintFrom(m.from as Square);
      playSound("select");
    }
  }, [status, puzzle, activeLine, step]);

  const revealSolution = useCallback(() => {
    if (status === "solved") return;
    if (replyTimer.current) window.clearTimeout(replyTimer.current);
    setStatus("revealed");
    setProfile(updateProfile((prev) => ({ ...prev, puzzleStreak: 0 })));
    setHintFrom(null);

    // replay the full solution from the puzzle start
    const g = new Chess(puzzle.fen);
    chessRef.current = g;
    setFen(g.fen());

    const line = puzzle.lines[activeLine];
    const seq: { from: string; to: string; promotion?: string }[] = [];
    line.userMoves.forEach((san, i) => {
      const m = sanToMove(g, san);
      if (m) seq.push({ from: m.from, to: m.to, promotion: m.promotion ?? "q" });
      const replies = line.replies[i] ?? [];
      for (const r of replies) {
        const rm = sanToMove(g, r);
        if (rm) {
          seq.push({ from: rm.from, to: rm.to, promotion: rm.promotion ?? "q" });
          break;
        }
      }
    });

    let i = 0;
    const stepFn = () => {
      if (i >= seq.length) return;
      const mv = seq[i++];
      try {
        const played = g.move(mv);
        playSound(played.captured ? "capture" : "move");
        setFen(g.fen());
      } catch {
        return;
      }
      replyTimer.current = window.setTimeout(stepFn, 700);
    };
    replyTimer.current = window.setTimeout(stepFn, 350);
  }, [status, puzzle, activeLine]);

  useEffect(() => {
    return () => {
      if (replyTimer.current) window.clearTimeout(replyTimer.current);
    };
  }, []);

  /* ------------------------- derived ------------------------- */

  const pieces = useMemo(() => fenToPieces(fen), [fen]);
  const turn = fen.split(" ")[1] === "b" ? "b" : "w";
  const solvedCount = profile.solvedPuzzles.length;

  return {
    puzzle,
    idx,
    total: PUZZLES.length,
    fen,
    pieces,
    turn,
    status,
    wrongTick,
    hintFrom,
    step,
    profile,
    solvedCount,
    attemptMove,
    showHint,
    revealSolution,
    nextPuzzle,
    retryPuzzle,
    clearHint,
  };
}

function DEFAULT_PROFILE_PLACEHOLDER() {
  // server-safe placeholder; hydrated on mount
  return {
    xp: 0,
    puzzleStreak: 0,
    bestStreak: 0,
    solvedPuzzles: [],
    puzzleAttempts: 0,
    drillWins: 0,
    drillBest: null,
    openingsDone: [],
  };
}
