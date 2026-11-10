"use client";

/**
 * DuelView — the Live Duel arena: two real players, one board, real stakes.
 *
 *  - create a duel → share the 5-letter code → the rival joins from any device;
 *  - the server referees: validated moves, 5+0 Fischer clocks, reconnection grace;
 *  - the winner pockets 2 💎, the loser still earns 1 💎 (1 💎 = ৳50);
 *  - the Diamond Vault below converts every duel into withdrawable value.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Chess, type Color, type PieceSymbol, type Square } from "chess.js";
import {
  BadgeCheck,
  Banknote,
  Check,
  Copy,
  Crown,
  Gem,
  Loader2,
  LogOut,
  RefreshCw,
  Swords,
  Timer,
  Trophy,
  Wifi,
  WifiOff,
} from "lucide-react";
import { ChessBoard } from "@/components/chess/board";
import { useDuel, legalOnClient, type DuelSide, type DuelStateView } from "@/hooks/use-duel";
import { StatusStrip } from "@/components/chess/chrome";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  addDiamonds,
  balanceTaka,
  canWithdraw,
  DIAMOND_TAKA,
  DUEL_PLAY_DIAMONDS,
  DUEL_WIN_DIAMONDS,
  getBalance,
  getLedger,
  getWithdrawals,
  DIAMOND_EVENT,
  MIN_WITHDRAW_DIAMONDS,
  requestWithdrawal,
  type DiamondEntry,
  type WithdrawalRequest,
} from "@/lib/diamonds";
import { deviceId } from "@/lib/game-store";
import { playSound } from "@/lib/sounds";
import { pulse } from "@/lib/haptics";
import { cn } from "@/lib/utils";

/* ================================================================== */
/* board helpers                                                      */
/* ================================================================== */

interface PieceView {
  id: string;
  square: Square;
  type: PieceSymbol;
  color: Color;
  captured?: boolean;
  spawn?: boolean;
  spawnDelay?: number;
}

function fenToPieces(fen: string): PieceView[] {
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
      out.push({ id: `p${n}-${color}${type}-${square}`, square, type, color });
      n++;
      file++;
    }
  }
  return out;
}

function fmtClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const formatTaka = (n: number) => `৳${n.toLocaleString("en-IN")}`;

/* ================================================================== */
/* clock chip                                                         */
/* ================================================================== */

function ClockChip({ ms, active }: { ms: number; active: boolean }) {
  return (
    <span
      className={cn(
        "rounded-lg border px-3 py-1 font-mono text-lg font-bold tabular-nums transition-all",
        active
          ? ms < 30_000
            ? "border-red-400/60 bg-red-500/15 text-red-200 clock-urgent"
            : "border-gold/50 bg-gold/10 text-gold-soft"
          : "border-white/10 bg-white/5 text-foreground/45"
      )}
    >
      {fmtClock(ms)}
    </span>
  );
}

/* ================================================================== */
/* player strip (duel flavour)                                        */
/* ================================================================== */

function DuelStrip({
  name,
  color,
  clockMs,
  active,
  connected,
  you,
}: {
  name: string;
  color: DuelSide;
  clockMs: number;
  active: boolean;
  connected: boolean;
  you: boolean;
}) {
  return (
    <div
      className={cn(
        "glass-panel flex items-center gap-3 rounded-xl px-3 py-2.5",
        active && "border-gold/40 shadow-[0_0_30px_-8px_rgba(212,175,55,0.45)]"
      )}
      aria-label={`${name} — ${color === "w" ? "white" : "black"}`}
    >
      <div
        className={cn(
          "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full ring-1",
          color === "w"
            ? "bg-gradient-to-br from-[#fdf9ec] to-[#cbbd97] ring-black/30"
            : "bg-gradient-to-br from-[#3a3f4b] to-[#0c0e13] ring-gold/40",
          active && "ring-2 ring-gold/70"
        )}
      >
        <Crown
          className={cn("h-4.5 w-4.5", color === "w" ? "text-[#8a6a24]" : "text-gold-soft")}
          strokeWidth={1.7}
        />
        {!connected && (
          <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[8px] text-white">
            !
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1 leading-tight">
        <p className="flex items-center gap-1.5 truncate text-[15px] font-bold">
          {name}
          {you && (
            <span className="rounded-full border border-gold/40 bg-gold/10 px-1.5 py-px text-[9px] font-black uppercase tracking-[0.14em] text-gold-soft">
              You
            </span>
          )}
        </p>
        <p className="flex items-center gap-1 text-[11px] font-semibold text-foreground/45">
          {connected ? (
            <>
              <Wifi className="h-3 w-3 text-emerald-400/80" /> Live
            </>
          ) : (
            <>
              <WifiOff className="h-3 w-3 text-red-300" /> Reconnecting…
            </>
          )}
          <span className="ml-1 uppercase tracking-[0.16em]">
            {color === "w" ? "White" : "Black"}
          </span>
        </p>
      </div>
      <ClockChip ms={clockMs} active={active} />
    </div>
  );
}

/* ================================================================== */
/* diamond vault                                                      */
/* ================================================================== */

const REASON_LABEL: Record<DiamondEntry["reason"], string> = {
  "duel-win": "Duel won",
  "duel-play": "Duel played",
  "duel-draw": "Duel drawn",
  withdraw: "Cash-out",
  adjust: "Adjustment",
};

function DiamondVault({ player }: { player: string }) {
  const [balance, setBalance] = useState(0);
  const [ledger, setLedger] = useState<DiamondEntry[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<WithdrawalRequest["method"]>("bkash");
  const [account, setAccount] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = () => {
    setBalance(getBalance());
    setLedger(getLedger().slice(0, 8));
    setWithdrawals(getWithdrawals().slice(0, 4));
  };

  useEffect(() => {
    const r = requestAnimationFrame(refresh);
    window.addEventListener(DIAMOND_EVENT, refresh);
    return () => {
      cancelAnimationFrame(r);
      window.removeEventListener(DIAMOND_EVENT, refresh);
    };
  }, []);

  const submit = () => {
    const res = requestWithdrawal({
      deviceId: deviceId(),
      player,
      method,
      account,
    });
    if ("error" in res) {
      setNotice(res.error);
      pulse("illegal");
    } else {
      setNotice(`Claim ${res.id} queued — ৳${res.taka.toLocaleString("en-IN")} via ${res.method.toUpperCase()}.`);
      pulse("achievement");
      setAccount("");
      setOpen(false);
    }
  };

  const pct = Math.min(100, (balance / MIN_WITHDRAW_DIAMONDS) * 100);

  return (
    <section
      className="glass-panel glass-panel-hover rounded-2xl p-5"
      aria-label="Diamond vault"
    >
      <header className="flex items-center justify-between gap-3">
        <h3 className="font-display flex items-center gap-2 text-lg font-black tracking-[0.08em]">
          <Gem className="h-5 w-5 text-cyan-300" />
          DIAMOND VAULT
        </h3>
        <span className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-cyan-200">
          1 💎 = ৳{DIAMOND_TAKA}
        </span>
      </header>

      {/* balance hero */}
      <div className="mt-4 flex items-end justify-between gap-4 rounded-xl border border-cyan-300/20 bg-gradient-to-b from-cyan-300/10 to-transparent p-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-foreground/45">
            Your balance
          </p>
          <p className="mt-1 flex items-baseline gap-2">
            <b className="font-mono text-4xl text-cyan-200">{balance}</b>
            <Gem className="h-5 w-5 text-cyan-300" />
          </p>
        </div>
        <p className="text-right leading-tight">
          <b className="font-mono text-2xl text-emerald-300">{formatTaka(balanceTaka(balance))}</b>
          <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-foreground/40">
            real value
          </span>
        </p>
      </div>

      {/* progress to cash-out */}
      <div className="mt-3">
        <div className="flex justify-between text-[10.5px] font-bold uppercase tracking-[0.14em] text-foreground/45">
          <span>Cash-out unlocked</span>
          <span>
            {Math.min(balance, MIN_WITHDRAW_DIAMONDS)}/{MIN_WITHDRAW_DIAMONDS} 💎 · {formatTaka(MIN_WITHDRAW_DIAMONDS * DIAMOND_TAKA)}
          </span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/8">
          <div
            className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-300 transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <Button
        onClick={() => {
          pulse("tick");
          setOpen(true);
        }}
        disabled={!canWithdraw(balance)}
        className="mt-4 h-11 w-full border border-cyan-300/40 bg-gradient-to-b from-cyan-300/25 to-cyan-400/10 text-[13px] font-bold text-cyan-100 hover:from-cyan-300/35 hover:to-cyan-400/20"
      >
        <Banknote className="mr-1.5 h-4 w-4" />
        Withdraw {balance >= MIN_WITHDRAW_DIAMONDS ? `৳${(balance * DIAMOND_TAKA).toLocaleString("en-IN")}` : `from ৳${MIN_WITHDRAW_DIAMONDS * DIAMOND_TAKA}`}
      </Button>

      {notice && (
        <p className="mt-3 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-[12px] font-semibold text-emerald-200">
          {notice}
        </p>
      )}

      {/* recent activity */}
      <div className="mt-4">
        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-foreground/40">
          Ledger
        </p>
        <ul className="scroll-slim mt-2 max-h-44 space-y-1.5 overflow-y-auto pr-1">
          {ledger.length === 0 && (
            <li className="rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2.5 text-[12px] text-foreground/45">
              No diamonds yet — win a Live Duel to open the vault.
            </li>
          )}
          {ledger.map((e) => (
            <li
              key={e.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2 text-[12.5px]"
            >
              <span className="min-w-0 flex-1 truncate text-foreground/70">
                {REASON_LABEL[e.reason]}
                {e.detail && <span className="text-foreground/35"> · {e.detail}</span>}
              </span>
              <b
                className={cn(
                  "font-mono",
                  e.delta > 0 ? "text-emerald-300" : "text-red-300"
                )}
              >
                {e.delta > 0 ? "+" : ""}
                {e.delta} 💎
              </b>
            </li>
          ))}
        </ul>
      </div>

      {/* pending withdrawals */}
      {withdrawals.length > 0 && (
        <div className="mt-4">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-foreground/40">
            Cash-out requests
          </p>
          <ul className="mt-2 space-y-1.5">
            {withdrawals.map((w) => (
              <li
                key={w.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-cyan-300/20 bg-cyan-300/[0.06] px-3 py-2 text-[12px]"
              >
                <span className="font-mono font-bold text-cyan-200">{w.id}</span>
                <span className="text-foreground/55">
                  {w.diamonds} 💎 · {formatTaka(w.taka)} · {w.method.toUpperCase()}
                </span>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[9.5px] font-black uppercase tracking-[0.14em]",
                    w.status === "pending"
                      ? "bg-amber-400/15 text-amber-300"
                      : w.status === "paid"
                        ? "bg-emerald-400/15 text-emerald-300"
                        : "bg-red-400/15 text-red-300"
                  )}
                >
                  {w.status}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[10.5px] leading-relaxed text-foreground/35">
            Requests are queued on your device and exportable from the Data Vault. The
            platform owner settles them via bKash / Nagad — usually within 24 hours.
          </p>
        </div>
      )}

      {/* withdraw dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="glass-dialog max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2 text-xl font-black">
              <Gem className="h-5 w-5 text-cyan-300" />
              Cash out diamonds
            </DialogTitle>
            <DialogDescription>
              {balance} 💎 · {formatTaka(balanceTaka(balance))} — paid via mobile wallet.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <p className="mb-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-foreground/45">
                Wallet
              </p>
              <div className="grid grid-cols-3 gap-1.5">
                {(["bkash", "nagad", "rocket"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      pulse("tick");
                      setMethod(m);
                    }}
                    className={cn(
                      "rounded-xl border px-2 py-2.5 text-[12px] font-black uppercase tracking-[0.1em] transition-all",
                      method === m
                        ? "border-pink-400/60 bg-pink-400/15 text-pink-200"
                        : "border-white/10 bg-white/5 text-foreground/50 hover:border-white/25"
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label
                htmlFor="duel-withdraw-account"
                className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.18em] text-foreground/45"
              >
                Account number
              </label>
              <input
                id="duel-withdraw-account"
                inputMode="numeric"
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                placeholder="01XXXXXXXXX"
                className="h-11 w-full rounded-xl border border-white/12 bg-black/40 px-3.5 font-mono text-[15px] text-foreground outline-none placeholder:text-foreground/25 focus:border-cyan-300/50"
              />
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-[12px] leading-relaxed text-foreground/55">
              The <b className="text-cyan-200">full balance</b> ({balance} 💎 ·{" "}
              {formatTaka(balanceTaka(balance))}) will be requested. The amount leaves
              your vault now and returns only if the claim is rejected.
            </div>
            <Button
              onClick={submit}
              className="h-12 w-full border border-cyan-300/40 bg-gradient-to-b from-cyan-300/30 to-cyan-400/15 text-[14px] font-black text-cyan-100 hover:from-cyan-300/40"
            >
              <BadgeCheck className="mr-1.5 h-4.5 w-4.5" />
              Request {formatTaka(balanceTaka(balance))}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/* ================================================================== */
/* main view                                                          */
/* ================================================================== */

export function DuelView() {
  const device = useMemo(() => deviceId(), []);
  const playerName = useMemo(
    () => `Player-${device.replace(/-/g, "").slice(0, 4).toUpperCase()}`,
    [device]
  );
  const [code, setCode] = useState("");
  const [pendingPromotion, setPendingPromotion] = useState<{ from: Square; to: Square } | null>(null);
  const [selected, setSelected] = useState<Square | null>(null);
  const [copied, setCopied] = useState(false);
  const lastMoveRef = useRef<string | null>(null);

  const duel = useDuel({
    playerName,
    onDiamonds: (entry) => {
      if (entry.delta > 0) {
        // celebration handled by the result banner; keep a toast-ish sound
        playSound("achievement");
      }
    },
  });

  const { phase, state, error, myColor } = duel;

  /* local board model mirrored from the authoritative fen */
  const fen = state?.fen ?? null;
  const chess = useMemo(() => {
    try {
      return fen ? new Chess(fen) : null;
    } catch {
      return null;
    }
  }, [fen]);

  const pieces = useMemo(() => (fen ? fenToPieces(fen) : []), [fen]);
  const orientation: "white" | "black" = myColor === "b" ? "black" : "white";

  const legalForSelected = useMemo(() => {
    if (!chess || !selected || state?.status !== "live" || state.turn !== myColor)
      return [];
    try {
      return chess.moves({ square: selected, verbose: true });
    } catch {
      return [];
    }
  }, [chess, selected, state?.status, state?.turn, myColor]);

  /* opponent's move landed — audio+haptic confirmation */
  useEffect(() => {
    if (!state?.lastMove) return;
    const key = `${state.code}-${state.ply}`;
    if (lastMoveRef.current === key) return;
    lastMoveRef.current = key;
    const mover = state.lastMove;
    if (mover && state.turn !== myColor) {
      // the server state already flipped the turn — the last move was ours
    } else if (mover) {
      playSound("move");
      pulse("move");
    }
  }, [state?.lastMove, state?.ply, state?.code, state?.turn, myColor]);

  const attemptMove = (from: Square, to: Square): boolean => {
    if (!state || state.status !== "live" || state.turn !== myColor) {
      pulse("illegal");
      return false;
    }
    const promoRank = myColor === "w" ? "8" : "1";
    const isPromotion =
      !!chess?.get(from) &&
      chess.get(from).type === "p" &&
      to[1] === promoRank;
    if (isPromotion && !pendingPromotion) {
      setPendingPromotion({ from, to });
      return true;
    }
    if (!legalOnClient(state.fen, from, to)) {
      pulse("illegal");
      return false;
    }
    setSelected(null);
    return duel.move(from, to, isPromotion ? "q" : undefined);
  };

  const onSelect = (sq: Square | null) => {
    if (state?.status !== "live" || state.turn !== myColor) return;
    pulse("select");
    setSelected(sq);
  };

  const copyCode = async () => {
    if (!state) return;
    try {
      await navigator.clipboard.writeText(state.code);
      setCopied(true);
      pulse("tick");
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — the code is huge on screen anyway */
    }
  };

  /* ---------------- idle / connecting / waiting ---------------- */
  if (phase === "idle" || phase === "connecting" || phase === "waiting") {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
        {/* hero */}
        <section className="glass-panel glass-panel-hover relative overflow-hidden rounded-2xl p-6 text-center">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[radial-gradient(ellipse_60%_100%_at_50%_0%,rgba(56,224,175,0.12),transparent_70%)]" />
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-3.5 py-1.5 text-[10.5px] font-black uppercase tracking-[0.22em] text-emerald-300">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            Live · 1 vs 1
          </span>
          <h2 className="font-display mt-3 text-3xl font-black tracking-wide sm:text-4xl">
            <span className="text-gold-gradient">Live Duel</span>
          </h2>
          <p className="mx-auto mt-2 max-w-md text-[13.5px] leading-relaxed text-foreground/60">
            Two real players. One board. Five minutes each. Every duel pays{" "}
            <b className="text-cyan-200">{DUEL_WIN_DIAMONDS} 💎</b> to the winner and{" "}
            <b className="text-cyan-200">{DUEL_PLAY_DIAMONDS} 💎</b> to the fighter who
            tried — each diamond is worth <b className="text-emerald-300">৳{DIAMOND_TAKA}</b>.
          </p>

          {phase === "waiting" && state ? (
            /* ---------------- waiting room ---------------- */
            <div className="mt-6">
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-foreground/45">
                Share this duel code
              </p>
              <button
                type="button"
                onClick={copyCode}
                className="group mx-auto mt-3 flex items-center gap-3 rounded-2xl border border-gold/40 bg-gradient-to-b from-gold/15 to-transparent px-8 py-4 transition-all hover:border-gold/70 active:scale-95"
                aria-label={`Duel code ${state.code.split("").join(" ")} — tap to copy`}
              >
                <span className="font-mono text-4xl font-black tracking-[0.3em] text-gold-gradient sm:text-5xl">
                  {state.code}
                </span>
                {copied ? (
                  <Check className="h-5 w-5 text-emerald-300" />
                ) : (
                  <Copy className="h-5 w-5 text-gold-soft/70 group-hover:text-gold-soft" />
                )}
              </button>
              <p className="mt-3 flex items-center justify-center gap-2 text-[12.5px] text-foreground/50">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-gold-soft" />
                Waiting for a rival to join — they open Sovereign → Duel → Join.
              </p>
              <Button
                variant="outline"
                onClick={duel.leave}
                className="mt-5 h-11 border-white/12 bg-white/5 px-6 text-foreground/70 hover:border-red-400/40 hover:text-red-300"
              >
                <LogOut className="mr-1.5 h-4 w-4" />
                Cancel duel
              </Button>
            </div>
          ) : phase === "connecting" ? (
            <div className="mt-8 flex items-center justify-center gap-2 text-gold-soft">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-[13px] font-semibold">Opening the arena…</span>
            </div>
          ) : (
            /* ---------------- create / join ---------------- */
            <div className="mx-auto mt-6 grid w-full max-w-sm gap-3">
              <Button
                onClick={() => {
                  pulse("achievement");
                  duel.createDuel();
                }}
                className="h-13 border border-[#8a6a24]/50 bg-gradient-to-b from-[#ecca6f] to-[#c69c3f] py-6 text-[15px] font-black text-[#241a05] shadow-[0_0_30px_-8px_rgba(212,175,55,0.7)] hover:from-[#f3d887] hover:to-[#d4a94e]"
              >
                <Swords className="mr-2 h-5 w-5" />
                Create a Duel
              </Button>
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-foreground/30">
                <span className="h-px flex-1 bg-white/10" /> or enter a code{" "}
                <span className="h-px flex-1 bg-white/10" />
              </div>
              <div className="flex gap-2">
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 5))}
                  placeholder="CODE"
                  aria-label="Duel code"
                  className="h-13 min-w-0 flex-1 rounded-xl border border-white/12 bg-black/40 px-4 text-center font-mono text-2xl font-black uppercase tracking-[0.3em] text-gold-soft outline-none placeholder:text-[14px] placeholder:tracking-[0.2em] placeholder:text-foreground/25 focus:border-gold/50"
                />
                <Button
                  onClick={() => {
                    pulse("tick");
                    duel.joinDuel(code);
                  }}
                  disabled={code.length < 4}
                  className="h-13 border border-emerald-400/40 bg-gradient-to-b from-emerald-400/25 to-emerald-500/10 px-5 text-[14px] font-black text-emerald-100 hover:from-emerald-400/35"
                >
                  Join
                </Button>
              </div>
            </div>
          )}

          {error && (
            <p className="mx-auto mt-4 max-w-sm rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-[12.5px] font-semibold text-red-300">
              {error}
            </p>
          )}
        </section>

        {/* how it pays */}
        <section className="glass-panel rounded-2xl p-5">
          <h3 className="font-display flex items-center gap-2 text-lg font-black tracking-[0.08em]">
            <Trophy className="h-5 w-5 text-gold-soft" />
            HOW IT PAYS
          </h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {[
              { label: "Winner", diamonds: DUEL_WIN_DIAMONDS, taka: DUEL_WIN_DIAMONDS * DIAMOND_TAKA, cls: "text-gold-soft border-gold/40" },
              { label: "Fighter", diamonds: DUEL_PLAY_DIAMONDS, taka: DUEL_PLAY_DIAMONDS * DIAMOND_TAKA, cls: "text-emerald-300 border-emerald-400/40" },
              { label: "Draw — each", diamonds: DUEL_PLAY_DIAMONDS, taka: DUEL_PLAY_DIAMONDS * DIAMOND_TAKA, cls: "text-cyan-200 border-cyan-300/40" },
            ].map((r) => (
              <div key={r.label} className={cn("rounded-xl border bg-white/[0.03] p-3 text-center", r.cls)}>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-foreground/45">
                  {r.label}
                </p>
                <p className="mt-1 font-mono text-2xl font-black">
                  +{r.diamonds} <Gem className="inline h-4 w-4" />
                </p>
                <p className="text-[11px] font-bold text-emerald-300">{formatTaka(r.taka)}</p>
              </div>
            ))}
          </div>
        </section>

        <DiamondVault player={playerName} />
      </div>
    );
  }

  if (!state) return null;

  const me = state.myColor ? state.seats[state.myColor] : null;
  const opp = state.myColor ? state.seats[state.myColor === "w" ? "b" : "w"] : null;

  /* ---------------- live / ended arena ---------------- */
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      {/* arena */}
      <div className="flex flex-col items-center gap-3">
        {opp && (
          <DuelStrip
            name={opp.name}
            color={myColor === "w" ? "b" : "w"}
            clockMs={state.clocks[myColor === "w" ? "b" : "w"]}
            active={state.status === "live" && state.turn !== myColor}
            connected={opp.connected}
            you={false}
          />
        )}

        <div className="board-frame relative w-full max-w-[560px] rounded-2xl p-2">
          <span className="pointer-events-none absolute -left-0.5 -top-0.5 h-3 w-3 rounded-tl-2xl border-l-2 border-t-2 border-[#fbeec1]/70" />
          <span className="pointer-events-none absolute -right-0.5 -top-0.5 h-3 w-3 rounded-tr-2xl border-r-2 border-t-2 border-[#fbeec1]/70" />
          <span className="pointer-events-none absolute -bottom-0.5 -left-0.5 h-3 w-3 rounded-bl-2xl border-b-2 border-l-2 border-[#fbeec1]/70" />
          <span className="pointer-events-none absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-br-2xl border-b-2 border-r-2 border-[#fbeec1]/70" />
          <div className="relative overflow-hidden rounded-md shadow-[inset_0_0_24px_rgba(0,0,0,0.55)]">
            <ChessBoard
              pieces={pieces}
              orientation={orientation}
              turnColor={state.turn}
              selected={selected}
              legalTargets={legalForSelected}
              lastMove={state.lastMove as { from: Square; to: Square } | null}
              checkedSquare={state.checkedSquare as Square | null}
              hint={null}
              interactive={state.status === "live" && state.turn === myColor}
              showLegal
              showCoords
              pendingPromotion={
                pendingPromotion as { from: Square; to: Square } | null
              }
              promotionColor={state.turn}
              onSelect={onSelect}
              onMoveAttempt={attemptMove}
              onPromote={(p) => {
                if (pendingPromotion) {
                  duel.move(pendingPromotion.from, pendingPromotion.to, p);
                  setPendingPromotion(null);
                  setSelected(null);
                }
              }}
              onCancelPromotion={() => setPendingPromotion(null)}
              onFirstGesture={() => {}}
            />
          </div>
        </div>

        {me && (
          <DuelStrip
            name="You"
            color={myColor ?? "w"}
            clockMs={state.clocks[myColor ?? "w"]}
            active={state.status === "live" && state.turn === myColor}
            connected={me.connected}
            you
          />
        )}

        {/* status line */}
        <StatusStrip
          game={
            {
              status: state.status === "live" ? "active" : "ended",
              result: state.result
                ? {
                    winner: state.result.winner,
                    reason: state.result.reason === "Checkmate" ? "checkmate" : "fifty",
                  }
                : null,
              inCheck: state.inCheck,
              turn: state.turn,
              mode: "human",
              humanColor: myColor ?? "w",
              thinking: false,
              viewing: false,
              viewIndex: null,
              history: state.moves,
            } as never
          }
        />

        {error && (
          <p className="rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-[12.5px] font-semibold text-red-300">
            {error}
          </p>
        )}

        {/* controls */}
        {state.status === "live" ? (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => {
                pulse("tick");
                duel.resign();
              }}
              className="h-11 border-red-400/30 bg-red-500/10 px-5 text-[13px] font-bold text-red-300 hover:border-red-400/60 hover:bg-red-500/20"
            >
              Resign
            </Button>
            <span className="rounded-full border border-white/10 bg-white/5 px-3.5 py-2 font-mono text-[12px] font-bold tracking-[0.2em] text-foreground/50">
              #{state.code}
            </span>
          </div>
        ) : (
          /* ---------------- result panel ---------------- */
          state.result && (
            <section
              className={cn(
                "glass-panel w-full max-w-[560px] rounded-2xl p-5 text-center",
                state.result.winner === myColor && "border-gold/50"
              )}
            >
              <p className="text-3xl">
                {state.result.winner === null ? "🤝" : state.result.winner === myColor ? "👑" : "⚔️"}
              </p>
              <h3 className="font-display mt-1 text-2xl font-black">
                {state.result.winner === null
                  ? "A draw — honour intact"
                  : state.result.winner === myColor
                    ? "Victory in the duel!"
                    : `${opp?.name ?? "The rival"} takes it`}
              </h3>
              <p className="mt-1 text-[12.5px] text-foreground/50">
                {state.result.reason} · {state.ply} half-moves
              </p>
              <p className="mt-3 inline-flex items-center gap-2 rounded-full border border-cyan-300/30 bg-cyan-300/10 px-4 py-2 text-[13px] font-black text-cyan-200">
                <Gem className="h-4 w-4" />
                +{state.result.rewards[myColor ?? "w"]} 💎 earned ·{" "}
                {formatTaka(state.result.rewards[myColor ?? "w"] * DIAMOND_TAKA)} value
              </p>
              <div className="mt-4 flex items-center justify-center gap-2">
                <Button
                  onClick={() => {
                    pulse("tick");
                    duel.rematch();
                  }}
                  className="h-11 border border-[#8a6a24]/50 bg-gradient-to-b from-[#ecca6f] to-[#c69c3f] px-5 text-[13px] font-black text-[#241a05] hover:from-[#f3d887]"
                >
                  <RefreshCw className="mr-1.5 h-4 w-4" />
                  Rematch
                  {state.rematch.length === 1 && state.rematch[0] !== myColor && " ✓"}
                </Button>
                <Button
                  variant="outline"
                  onClick={duel.leave}
                  className="h-11 border-white/12 bg-white/5 px-5 text-foreground/70 hover:border-white/25"
                >
                  <LogOut className="mr-1.5 h-4 w-4" />
                  Leave
                </Button>
              </div>
              {state.rematch.length === 1 && state.rematch[0] === myColor && (
                <p className="mt-2 flex items-center justify-center gap-1.5 text-[11.5px] text-emerald-300">
                  <Timer className="h-3.5 w-3.5" /> Rematch offered — waiting for the rival…
                </p>
              )}
            </section>
          )
        )}
      </div>

      <DiamondVault player={playerName} />
    </div>
  );
}
