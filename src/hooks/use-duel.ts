"use client";

/**
 * useDuel — the Live Duel state machine.
 *
 * Connects to the duel referee service (socket.io via the gateway),
 * mirrors the authoritative room state, and runs the real-money stakes:
 *
 *  - when a duel goes LIVE each device locks its 1 💎 entry stake
 *    (persisted + idempotent — reconnects can never double-charge);
 *  - the winner pockets the 2 💎 pot, a draw refunds the stake,
 *    a loss consumes it — exactly the Diamond Vault economy;
 *  - players without the stake never enter — the Diamond Shop is the way in.
 *
 * Phases: idle → waiting (share code) → live (board) → ended → rematch.
 * A dropped connection re-joins the same seat automatically.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { Chess } from "chess.js";
import { deviceId } from "@/lib/game-store";
import {
  addDiamonds,
  DUEL_ENTRY_STAKE,
  DUEL_WIN_POT,
  getBalance,
  markPayoutDone,
  payEntryStake,
  payoutDone,
  type DiamondEntry,
} from "@/lib/diamonds";
import { pulse } from "@/lib/haptics";
import { playSound } from "@/lib/sounds";

export type DuelPhase = "idle" | "connecting" | "waiting" | "live" | "ended";
export type DuelSide = "w" | "b";

export interface DuelResultView {
  winner: DuelSide | null;
  reason: string;
  rewards: { w: number; b: number };
}

export interface DuelStateView {
  code: string;
  /** game generation inside the room — rematches bump it (stake per game) */
  gen: number;
  status: "waiting" | "live" | "ended";
  myColor: DuelSide | null;
  turn: "w" | "b";
  fen: string;
  lastMove: { from: string; to: string } | null;
  inCheck: boolean;
  checkedSquare: string | null;
  ply: number;
  moves: string[];
  clocks: { w: number; b: number };
  seats: {
    w: { name: string; connected: boolean } | null;
    b: { name: string; connected: boolean } | null;
  };
  result: DuelResultView | null;
  rematch: DuelSide[];
  timeControl: number;
}

interface Options {
  playerName: string;
  onDiamonds?: (entry: DiamondEntry) => void;
}

export function useDuel({ playerName, onDiamonds }: Options) {
  const socketRef = useRef<Socket | null>(null);
  const [phase, setPhase] = useState<DuelPhase>("idle");
  const [state, setState] = useState<DuelStateView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const settledRef = useRef<string | null>(null); // code+gen payout in memory
  const prevStatusRef = useRef<string | null>(null);

  const nameRef = useRef(playerName);
  const onDiamondsRef = useRef(onDiamonds);
  useEffect(() => {
    nameRef.current = playerName;
    onDiamondsRef.current = onDiamonds;
  });

  /**
   * Lock the entry stake the moment a duel goes live — every generation
   * (rematch) is a fresh duel with a fresh stake. Persisted on-device, so
   * page refreshes and reconnects never double-charge.
   */
  const chargeStake = useCallback((s: DuelStateView) => {
    if (prevStatusRef.current === "live") return;
    prevStatusRef.current = "live";
    if (!s.myColor) return;
    const res = payEntryStake(s.code, s.gen);
    if ("error" in res) {
      setError(res.error);
      pulse("illegal");
      // cannot cover the stake — leave the arena immediately
      socketRef.current?.emit("duel:leave", {
        code: s.code,
        deviceId: deviceId(),
      });
      setState(null);
      setPhase("idle");
      return;
    }
    onDiamondsRef.current?.(res.entry);
  }, []);

  /**
   * Pay the duel result once — keyed by code+generation and persisted, so
   * even a crash right after checkmate cannot pay twice.
   *   win  → +DUEL_WIN_POT (the 2 💎 pot)
   *   draw → +DUEL_ENTRY_STAKE (stake refund)
   *   loss → nothing (the stake is already consumed)
   */
  const settleRewards = useCallback((s: DuelStateView) => {
    if (!s.result || !s.myColor) return;
    const key = `${s.code}:g${s.gen}`;
    if (settledRef.current === key || payoutDone(s.code, s.gen)) return;
    settledRef.current = key;
    const won = s.result.winner === s.myColor;
    const draw = s.result.winner === null;
    const credit = won ? DUEL_WIN_POT : draw ? DUEL_ENTRY_STAKE : 0;
    if (credit > 0) {
      const entry = addDiamonds(
        credit,
        draw ? "duel-draw" : "duel-pot",
        `Duel ${s.code} — ${s.result.reason}`
      );
      onDiamondsRef.current?.(entry);
    }
    markPayoutDone(s.code, s.gen, credit);
    if (won) {
      pulse("win");
      playSound("win");
    } else if (draw) {
      pulse("draw");
    } else {
      pulse("lose");
      playSound("lose");
    }
  }, []);

  /** one lazily-created socket, shared by every action */
  const ensureSocket = useCallback((): Socket => {
    if (socketRef.current) return socketRef.current;
    const socket = io("/?XTransformPort=3003", {
      transports: ["websocket", "polling"],
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: 6,
      reconnectionDelay: 1200,
      timeout: 8000,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      setError(null);
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", () => {
      setError("Could not reach the duel arena — check your connection.");
    });

    socket.on("duel:state", (s: DuelStateView) => {
      setState(s);
      setError(null);
      if (s.status === "waiting") setPhase("waiting");
      if (s.status === "live") {
        setPhase("live");
        chargeStake(s);
        pulse("move");
      } else {
        prevStatusRef.current = s.status;
      }
      if (s.status === "ended") setPhase("ended");
      if (s.status === "ended") settleRewards(s);
    });

    socket.on("duel:ended", ({ state: s }: { state: DuelStateView }) => {
      setState(s);
      setPhase("ended");
      settleRewards(s);
    });

    socket.on("duel:host-left", () => {
      setError("The host closed the duel.");
      setPhase("idle");
      setState(null);
    });

    socket.on("duel:error", ({ message }: { message: string }) => {
      setError(message);
      pulse("illegal");
    });

    return socket;
  }, [chargeStake, settleRewards]);

  /* -------- actions -------- */

  const createDuel = useCallback(() => {
    if (getBalance() < DUEL_ENTRY_STAKE) {
      setError(
        `You need ${DUEL_ENTRY_STAKE} 💎 to enter a duel — top up in the Diamond Shop below.`
      );
      pulse("illegal");
      return;
    }
    setError(null);
    setPhase("connecting");
    ensureSocket().emit("duel:create", {
      deviceId: deviceId(),
      name: nameRef.current || "Challenger",
    });
  }, [ensureSocket]);

  const joinDuel = useCallback(
    (code: string) => {
      if (!code.trim()) return;
      if (getBalance() < DUEL_ENTRY_STAKE) {
        setError(
          `You need ${DUEL_ENTRY_STAKE} 💎 to enter a duel — top up in the Diamond Shop below.`
        );
        pulse("illegal");
        return;
      }
      setError(null);
      setPhase("connecting");
      ensureSocket().emit("duel:join", {
        code: code.trim().toUpperCase(),
        deviceId: deviceId(),
        name: nameRef.current || "Challenger",
      });
    },
    [ensureSocket]
  );

  const move = useCallback(
    (from: string, to: string, promotion?: string) => {
      const s = state;
      if (!s) return false;
      ensureSocket().emit("duel:move", {
        code: s.code,
        deviceId: deviceId(),
        from,
        to,
        promotion,
      });
      return true;
    },
    [ensureSocket, state]
  );

  const resign = useCallback(() => {
    if (!state) return;
    ensureSocket().emit("duel:resign", { code: state.code, deviceId: deviceId() });
  }, [ensureSocket, state]);

  const rematch = useCallback(() => {
    if (!state) return;
    if (getBalance() < DUEL_ENTRY_STAKE) {
      setError(
        `A rematch costs ${DUEL_ENTRY_STAKE} 💎 — top up in the Diamond Shop below.`
      );
      pulse("illegal");
      return;
    }
    ensureSocket().emit("duel:rematch", { code: state.code, deviceId: deviceId() });
  }, [ensureSocket, state]);

  const leave = useCallback(() => {
    if (state) {
      ensureSocket().emit("duel:leave", { code: state.code, deviceId: deviceId() });
    }
    setState(null);
    setPhase("idle");
    setError(null);
  }, [ensureSocket, state]);

  const clearError = useCallback(() => setError(null), []);

  /* -------- offline sound: it is my turn -------- */
  const isMyTurn = useMemo(
    () => !!state && state.status === "live" && state.myColor === state.turn,
    [state]
  );

  useEffect(() => {
    if (isMyTurn) pulse("tick");
  }, [isMyTurn]);

  /* -------- cleanup -------- */
  useEffect(() => {
    return () => {
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, []);

  return {
    phase,
    state,
    error,
    connected,
    isMyTurn,
    myColor: state?.myColor ?? null,
    createDuel,
    joinDuel,
    move,
    resign,
    rematch,
    leave,
    clearError,
  };
}

/** Local legality pre-check so illegal taps never leave the device. */
export function legalOnClient(fen: string, from: string, to: string): boolean {
  try {
    const g = new Chess(fen);
    return !!g.move({ from, to, promotion: "q" });
  } catch {
    return false;
  }
}
