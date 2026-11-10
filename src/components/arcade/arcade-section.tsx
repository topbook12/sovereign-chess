"use client";

/**
 * ArcadeSection — the Stake Arena's arcade floor: Ludo, Carrom and the
 * Snake Duel, two players on one device, real diamond stakes.
 *
 * Economy (per decided match):
 *   both players lock 3 💎 · winner +4 💎 (net +1) · loser +1 💎
 *   consolation (net −2) · draw refunds · the platform keeps 1 💎 (৳50).
 *
 * Each player owns a real on-device wallet (arcade-economy.ts). Free
 * practice runs cost nothing. Exiting mid-match refunds both stakes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BadgeCheck,
  Crown,
  Dices,
  Frown,
  Gem,
  HandCoins,
  Landmark,
  Pencil,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Trophy,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { LudoGame } from "@/components/arcade/ludo";
import { CarromGame } from "@/components/arcade/carrom";
import { SnakeDuelGame } from "@/components/arcade/snake-duel";
import {
  ARCADE_CONSOLATION,
  ARCADE_ENTRY,
  ARCADE_EVENT,
  ARCADE_HOUSE_FEE,
  ARCADE_PRIZE,
  ARCADE_SIGNUP,
  chargeArcadeStake,
  getArcadeAccounts,
  getArcadeHouse,
  refundArcadeMatch,
  renameArcadeAccount,
  requestArcadeRecharge,
  settleArcadeMatch,
  type ArcadeAccount,
  type ArcadeSettlement,
} from "@/lib/arcade-economy";
import { DIAMOND_TAKA, formatTaka } from "@/lib/diamonds";
import type { ArcadeKey, ArcadePlayer, ArcadeResult } from "@/lib/arcade-types";
import { pulse } from "@/lib/haptics";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------- */
/* lobby metadata                                                    */
/* ---------------------------------------------------------------- */

const GAMES: {
  key: ArcadeKey;
  title: string;
  tagline: string;
  emoji: string;
  ring: string;
}[] = [
  {
    key: "ludo",
    title: "Ludo Royale",
    tagline: "Four tokens home. Dice, captures, glory.",
    emoji: "🎲",
    ring: "hover:border-gold/60",
  },
  {
    key: "carrom",
    title: "Carrom Kings",
    tagline: "Flick the striker, pocket the pot.",
    emoji: "🎯",
    ring: "hover:border-emerald-400/60",
  },
  {
    key: "snake",
    title: "Snake Duel",
    tagline: "Same seed, same food — pure skill.",
    emoji: "🐍",
    ring: "hover:border-gold/60",
  },
];

const RECHARGE_PACKS = [
  { diamonds: 3, taka: 150 },
  { diamonds: 10, taka: 500 },
  { diamonds: 25, taka: 1250 },
];

function takaOf(n: number): string {
  return formatTaka(n * DIAMOND_TAKA);
}

/* ---------------------------------------------------------------- */
/* settlement ceremony                                               */
/* ---------------------------------------------------------------- */

function SettlementCard({
  players,
  settlement,
  onRematch,
  onDone,
}: {
  players: [ArcadePlayer, ArcadePlayer];
  settlement: ArcadeSettlement;
  onRematch: () => void;
  onDone: () => void;
}) {
  const draw = settlement.winner === null;
  const winName = draw ? null : players[settlement.winner].name;
  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/85 p-4 backdrop-blur-md">
      <div className="glass-panel w-full max-w-sm rounded-2xl p-6 text-center">
        <p className="text-5xl">{draw ? "🤝" : "👑"}</p>
        <h3 className="font-display mt-2 text-2xl font-black">
          {draw ? (
            "A draw — stakes refunded"
          ) : (
            <span className="text-gold-gradient">{winName} wins!</span>
          )}
        </h3>
        {draw ? (
          <p className="mt-1 text-[12.5px] text-foreground/55">
            Both stakes are back — nobody paid for a stalemate.
          </p>
        ) : (
          <p className="mt-1 text-[12.5px] text-foreground/55">
            The pot is settled — the vaults never lie.
          </p>
        )}

        <div className="mt-4 grid gap-2 text-left">
          {(draw
            ? ([0, 1] as const).map((i) => ({
                i,
                label: players[i].name,
                delta: ARCADE_ENTRY,
                sub: "stake refunded",
                gold: false,
              }))
            : ([
                [settlement.winner, "Victory prize", "net +1 💎", true],
                [settlement.winner === 0 ? 1 : 0, "Consolation", "net −2 💎", false],
              ] as const).map(([i, label, sub, gold]) => ({
                i: i as number,
                label: `${players[i as number].name} — ${label as string}`,
                delta: (i === settlement.winner
                  ? ARCADE_PRIZE
                  : ARCADE_CONSOLATION) as number,
                sub: sub as string,
                gold: gold as boolean,
              }))
          ).map((row) => (
            <div
              key={row.i}
              className={cn(
                "flex items-center gap-3 rounded-xl border px-3.5 py-2.5",
                row.gold
                  ? "border-gold/50 bg-gold/10"
                  : "border-white/10 bg-white/[0.03]"
              )}
            >
              <span className="text-lg" aria-hidden="true">
                {players[row.i].emoji}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-black text-foreground/90">
                  {row.label}
                </span>
                <span className="block text-[10.5px] text-foreground/45">{row.sub}</span>
              </span>
              <span
                className={cn(
                  "shrink-0 font-mono text-[15px] font-black",
                  row.gold ? "text-gold-soft" : "text-foreground/80"
                )}
              >
                +{row.delta} 💎
              </span>
            </div>
          ))}

          {/* platform share — transparent, always */}
          {settlement.fee > 0 && (
            <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-3.5 py-2.5">
              <Landmark className="h-5 w-5 shrink-0 text-foreground/50" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-black text-foreground/70">
                  Platform share
                </span>
                <span className="block text-[10.5px] text-foreground/40">
                  the house keeps the arena running
                </span>
              </span>
              <span className="shrink-0 font-mono text-[13px] font-black text-foreground/60">
                −{settlement.fee} 💎 ({formatTaka(settlement.feeTaka)})
              </span>
            </div>
          )}
        </div>

        <p className="mt-3 text-[11.5px] font-bold text-emerald-300">
          Vaults now · {players[0].name} {settlement.balances[0]} 💎 ·{" "}
          {players[1].name} {settlement.balances[1]} 💎
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button
            onClick={onRematch}
            className="h-11 border border-[#8a6a24]/50 bg-gradient-to-b from-[#ecca6f] to-[#c69c3f] text-[13px] font-black text-[#241a05] hover:from-[#f3d887]"
          >
            <Dices className="mr-1.5 h-4 w-4" />
            Rematch
          </Button>
          <Button
            variant="outline"
            onClick={onDone}
            className="h-11 border-white/12 bg-white/5 text-[13px] font-bold text-foreground/75 hover:border-white/25"
          >
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* wallet manager — accounts, ledgers, recharge (bKash placeholder)  */
/* ---------------------------------------------------------------- */

function AccountCard({
  acc,
  onRename,
}: {
  acc: ArcadeAccount;
  onRename: (id: "a" | "b", name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(acc.name);
  const [recharging, setRecharging] = useState(false);
  const [pack, setPack] = useState(RECHARGE_PACKS[1]);
  const [method, setMethod] = useState<"bkash" | "nagad" | "rocket">("bkash");
  const [sender, setSender] = useState("");
  const [ordered, setOrdered] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const submitOrder = () => {
    const res = requestArcadeRecharge({
      playerId: acc.id,
      player: acc.name,
      diamonds: pack.diamonds,
      taka: pack.taka,
      method,
      sender,
    });
    if ("error" in res) {
      setErr(res.error);
      return;
    }
    setErr(null);
    setOrdered(res.id);
    pulse("achievement");
  };

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center gap-2.5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-gold/30 bg-gold/10 text-xl" aria-hidden="true">
          {acc.emoji}
        </span>
        {editing ? (
          <form
            className="flex min-w-0 flex-1 items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              onRename(acc.id, draft);
              setEditing(false);
            }}
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, 18))}
              aria-label="Player name"
              className="h-9 min-w-0 flex-1 rounded-lg border border-gold/40 bg-black/40 px-2.5 text-[13px] font-bold text-foreground outline-none focus:border-gold/70"
            />
            <Button type="submit" size="sm" className="h-9 px-3 text-[12px] font-black">
              Save
            </Button>
          </form>
        ) : (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-black text-foreground/90">
                {acc.name}
              </span>
              <span className="block text-[10.5px] font-bold uppercase tracking-[0.14em] text-foreground/45">
                {acc.matches} matches · {acc.wins} wins
              </span>
            </span>
            <button
              type="button"
              onClick={() => {
                pulse("tick");
                setDraft(acc.name);
                setEditing(true);
              }}
              aria-label={`Rename ${acc.name}`}
              className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-white/5 text-foreground/60 transition-colors hover:border-gold/40 hover:text-gold-soft"
            >
              <Pencil className="h-4 w-4" />
            </button>
          </>
        )}
      </div>

      <p className="mt-2.5 font-mono text-2xl font-black tabular-nums text-gold-soft">
        {acc.balance} 💎
        <span className="ml-2 text-[12px] font-bold text-emerald-300">
          ≈ {takaOf(Math.max(0, acc.balance))}
        </span>
      </p>

      {/* ledger */}
      {acc.ledger.length > 0 && (
        <ul className="mt-2.5 max-h-28 space-y-1 overflow-y-auto pr-1 text-[11px]">
          {acc.ledger.slice(0, 8).map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-2 border-b border-white/5 pb-1">
              <span className="min-w-0 flex-1 truncate text-foreground/50">
                {e.note ?? e.reason}
              </span>
              <span
                className={cn(
                  "shrink-0 font-mono font-bold",
                  e.delta >= 0 ? "text-emerald-300" : "text-red-300"
                )}
              >
                {e.delta >= 0 ? "+" : ""}
                {e.delta}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* recharge */}
      {recharging ? (
        <div className="mt-3 rounded-lg border border-cyan-300/25 bg-cyan-300/5 p-3">
          <p className="text-[11.5px] font-black text-cyan-200">
            Top up {acc.name} — bKash / Nagad / Rocket
          </p>
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            {RECHARGE_PACKS.map((p) => (
              <button
                key={p.diamonds}
                type="button"
                onClick={() => setPack(p)}
                className={cn(
                  "rounded-lg border px-1 py-2 text-center transition-all",
                  pack.diamonds === p.diamonds
                    ? "border-gold/60 bg-gold/15"
                    : "border-white/10 bg-black/30"
                )}
              >
                <span className="block font-mono text-[13px] font-black text-gold-soft">
                  {p.diamonds} 💎
                </span>
                <span className="block text-[10px] font-bold text-foreground/50">
                  {formatTaka(p.taka)}
                </span>
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-1.5">
            {(["bkash", "nagad", "rocket"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMethod(m)}
                className={cn(
                  "h-9 flex-1 rounded-lg border text-[11px] font-black uppercase tracking-wide transition-all",
                  method === m
                    ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-200"
                    : "border-white/10 bg-black/30 text-foreground/50"
                )}
              >
                {m}
              </button>
            ))}
          </div>
          <input
            value={sender}
            onChange={(e) => setSender(e.target.value.replace(/\D/g, "").slice(0, 11))}
            inputMode="numeric"
            placeholder="Your wallet number"
            aria-label="Paying wallet number"
            className="mt-2 h-10 w-full rounded-lg border border-white/12 bg-black/40 px-3 text-[13px] text-foreground outline-none placeholder:text-foreground/30 focus:border-gold/50"
          />
          {ordered ? (
            <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-2 text-[11px] font-bold text-emerald-200">
              <BadgeCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Order {ordered} saved — {pack.diamonds} 💎 for {acc.name}. The
              payment channel activates soon; the platform owner settles every
              saved order.
            </p>
          ) : (
            <>
              {err && <p className="mt-2 text-[11px] font-bold text-red-300">{err}</p>}
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                <Button
                  onClick={submitOrder}
                  className="h-10 border border-[#8a6a24]/50 bg-gradient-to-b from-[#ecca6f] to-[#c69c3f] text-[12px] font-black text-[#241a05]"
                >
                  <Smartphone className="mr-1.5 h-4 w-4" />
                  Save order
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setRecharging(false)}
                  className="h-10 border-white/12 bg-white/5 text-[12px] font-bold text-foreground/60"
                >
                  Close
                </Button>
              </div>
            </>
          )}
        </div>
      ) : (
        <Button
          variant="outline"
          onClick={() => {
            pulse("tick");
            setRecharging(true);
          }}
          className="mt-2.5 h-10 w-full border-cyan-300/30 bg-cyan-300/10 text-[12px] font-black text-cyan-200 hover:border-cyan-300/60"
        >
          <HandCoins className="mr-1.5 h-4 w-4" />
          Top up this vault
        </Button>
      )}
    </div>
  );
}

function WalletPanel() {
  const [accounts, setAccounts] = useState<[ArcadeAccount, ArcadeAccount] | null>(null);
  const house = useMemo(() => getArcadeHouse(), [accounts]);

  useEffect(() => {
    const refresh = () => setAccounts(getArcadeAccounts());
    refresh();
    window.addEventListener(ARCADE_EVENT, refresh);
    return () => window.removeEventListener(ARCADE_EVENT, refresh);
  }, []);

  if (!accounts) return null;

  return (
    <section className="glass-panel rounded-2xl p-4 sm:p-5">
      <h3 className="font-display flex items-center gap-2 text-lg font-black tracking-[0.08em]">
        <Wallet className="h-5 w-5 text-gold-soft" aria-hidden="true" />
        ARCADE VAULTS
      </h3>
      <p className="mt-1 text-[12px] leading-relaxed text-foreground/50">
        Two real wallets, one device. Every stake match moves diamonds between
        them — 1 💎 = <b className="text-emerald-300">{formatTaka(DIAMOND_TAKA)}</b>, withdrawable
        once cash-out opens.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <AccountCard acc={accounts[0]} onRename={renameArcadeAccount} />
        <AccountCard acc={accounts[1]} onRename={renameArcadeAccount} />
      </div>

      {/* platform share — the house edge, in the open */}
      <div className="mt-3 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
        <Landmark className="h-5 w-5 shrink-0 text-gold-soft/70" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-[11.5px] leading-snug text-foreground/50">
          <b className="text-foreground/75">Platform share so far</b> — the house
          keeps {ARCADE_HOUSE_FEE} 💎 of every decided stake match.
        </p>
        <p className="shrink-0 text-right font-mono text-[13px] font-black text-gold-soft">
          {house.fee} 💎
          <span className="block text-[10px] font-bold text-emerald-300">
            {formatTaka(house.fee * DIAMOND_TAKA)} · {house.matches} matches
          </span>
        </p>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- */
/* the section                                                       */
/* ---------------------------------------------------------------- */

interface ActiveMatch {
  key: ArcadeKey;
  matchId: string;
  players: [ArcadePlayer, ArcadePlayer];
  practice: boolean;
}

export function ArcadeSection() {
  const [accounts, setAccounts] = useState<[ArcadeAccount, ArcadeAccount] | null>(null);
  const [gate, setGate] = useState<ArcadeKey | null>(null);
  const [match, setMatch] = useState<ActiveMatch | null>(null);
  const [settlement, setSettlement] = useState<ArcadeSettlement | null>(null);
  const [practiceNote, setPracticeNote] = useState<string | null>(null);
  const [gateError, setGateError] = useState<string | null>(null);
  const accountsRef = useRef<[ArcadeAccount, ArcadeAccount] | null>(null);
  const matchRef = useRef<ActiveMatch | null>(null);

  useEffect(() => {
    const refresh = () => {
      const accs = getArcadeAccounts();
      accountsRef.current = accs;
      setAccounts(accs);
    };
    refresh();
    window.addEventListener(ARCADE_EVENT, refresh);
    return () => window.removeEventListener(ARCADE_EVENT, refresh);
  }, []);

  /** launch a match — stake mode charges both vaults first */
  const launch = useCallback(
    (key: ArcadeKey, practice: boolean) => {
      const accs = accountsRef.current ?? getArcadeAccounts();
      const players: [ArcadePlayer, ArcadePlayer] = [
        { name: accs[0].name, emoji: accs[0].emoji },
        { name: accs[1].name, emoji: accs[1].emoji },
      ];
      if (practice) {
        setGate(null);
        setPracticeNote(null);
        const m: ActiveMatch = {
          key,
          matchId: `prac_${Date.now().toString(36)}`,
          players,
          practice: true,
        };
        matchRef.current = m;
        setMatch(m);
        return;
      }
      const matchId = `arc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const res = chargeArcadeStake(matchId, accs);
      if (!res.ok) {
        setGateError(res.error);
        pulse("illegal");
        return;
      }
      setGate(null);
      setGateError(null);
      setSettlement(null);
      const m: ActiveMatch = { key, matchId, players, practice: false };
      matchRef.current = m;
      setMatch(m);
      pulse("achievement");
    },
    []
  );

  const handleFinish = useCallback((result: ArcadeResult) => {
    const m = matchRef.current;
    if (!m) return;
    if (m.practice) {
      matchRef.current = null;
      setMatch(null);
      setPracticeNote(result.note ?? "Practice complete");
      return;
    }
    const accs = accountsRef.current ?? getArcadeAccounts();
    const settled = settleArcadeMatch(m.matchId, accs, result.winner);
    if ("error" in settled) {
      // crash-safe guard tripped — just close
      matchRef.current = null;
      setMatch(null);
      return;
    }
    setSettlement({ ...settled }); // overlay stays until Done / Rematch
    pulse("win");
  }, []);

  const handleExit = useCallback(() => {
    const m = matchRef.current;
    if (m && !m.practice && !settlement) {
      // abandoning a staked match — both stakes go home
      const accs = accountsRef.current ?? getArcadeAccounts();
      refundArcadeMatch(m.matchId, accs);
    }
    matchRef.current = null;
    setMatch(null);
    setSettlement(null);
  }, [settlement]);

  const closeSettlement = useCallback(() => {
    setSettlement(null);
    matchRef.current = null;
    setMatch(null);
  }, []);

  if (!accounts) return null;

  const gameProps = (m: ActiveMatch) => ({
    players: m.players,
    practice: m.practice,
    onFinish: handleFinish,
    onExit: handleExit,
  });

  return (
    <section className="glass-panel relative overflow-hidden rounded-2xl p-4 sm:p-5">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-[radial-gradient(ellipse_60%_100%_at_50%_0%,rgba(212,175,55,0.12),transparent_70%)]" />
      <h3 className="font-display flex items-center gap-2 text-lg font-black tracking-[0.08em]">
        <Sparkles className="h-5 w-5 text-gold-soft" aria-hidden="true" />
        THE ARCADE — STAKE MATCHES
      </h3>
      <p className="mt-1 text-[12px] leading-relaxed text-foreground/50">
        Two players, one device, real vaults. Both lock{" "}
        <b className="text-cyan-200">{ARCADE_ENTRY} 💎</b> — the winner takes{" "}
        <b className="text-gold-soft">{ARCADE_PRIZE} 💎</b>, the loser keeps{" "}
        <b className="text-emerald-300">{ARCADE_CONSOLATION} 💎</b> consolation, and
        the platform&apos;s {ARCADE_HOUSE_FEE} 💎 fee keeps the lights on.
      </p>

      {/* game cards */}
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {GAMES.map((g) => (
          <div
            key={g.key}
            className={cn(
              "flex flex-col rounded-xl border border-white/10 bg-white/[0.03] p-4 transition-colors",
              g.ring
            )}
          >
            <p className="text-3xl" aria-hidden="true">
              {g.emoji}
            </p>
            <p className="mt-1.5 text-[15px] font-black text-foreground/90">{g.title}</p>
            <p className="mt-0.5 flex-1 text-[11.5px] leading-snug text-foreground/50">
              {g.tagline}
            </p>
            <Button
              onClick={() => {
                setGateError(null);
                setGate(g.key);
                pulse("tick");
              }}
              className="mt-3 h-11 border border-[#8a6a24]/50 bg-gradient-to-b from-[#ecca6f] to-[#c69c3f] text-[13px] font-black text-[#241a05] hover:from-[#f3d887]"
            >
              <Gem className="mr-1.5 h-4 w-4" />
              Stake {ARCADE_ENTRY} 💎
            </Button>
            <Button
              variant="outline"
              onClick={() => launch(g.key, true)}
              className="mt-2 h-10 border-white/12 bg-white/5 text-[12px] font-bold text-foreground/65 hover:border-white/25"
            >
              Free practice
            </Button>
          </div>
        ))}
      </div>

      <WalletPanel />

      {/* ---------------- stake gate ---------------- */}
      {gate && accounts && (
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/85 p-4 backdrop-blur-md">
          <div className="glass-panel w-full max-w-sm rounded-2xl p-6">
            <p className="text-center text-4xl" aria-hidden="true">
              {GAMES.find((g) => g.key === gate)?.emoji}
            </p>
            <h4 className="font-display mt-1 text-center text-xl font-black">
              <span className="text-gold-gradient">
                {GAMES.find((g) => g.key === gate)?.title}
              </span>
            </h4>
            <p className="mt-1 text-center text-[12px] text-foreground/55">
              Staked match · both vaults lock {ARCADE_ENTRY} 💎
            </p>

            <div className="mt-4 grid gap-2">
              {accounts.map((acc, i) => (
                <div
                  key={acc.id}
                  className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5"
                >
                  <span className="text-lg" aria-hidden="true">
                    {acc.emoji}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-black text-foreground/85">
                    {acc.name}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 font-mono text-[14px] font-black",
                      acc.balance >= ARCADE_ENTRY ? "text-gold-soft" : "text-red-300"
                    )}
                  >
                    {acc.balance} 💎
                  </span>
                  {i === 0 && <Crown className="h-4 w-4 shrink-0 text-gold-soft/60" aria-hidden="true" />}
                </div>
              ))}
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg border border-gold/40 bg-gold/10 p-2">
                <p className="text-[9.5px] font-black uppercase tracking-[0.14em] text-foreground/45">Win</p>
                <p className="font-mono text-[15px] font-black text-gold-soft">+{ARCADE_PRIZE} 💎</p>
                <p className="text-[9.5px] font-bold text-emerald-300">net +1 · {formatTaka(50)}</p>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2">
                <p className="text-[9.5px] font-black uppercase tracking-[0.14em] text-foreground/45">Loss</p>
                <p className="font-mono text-[15px] font-black text-foreground/75">+{ARCADE_CONSOLATION} 💎</p>
                <p className="text-[9.5px] font-bold text-red-300">net −2 · {formatTaka(-100)}</p>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/[0.02] p-2">
                <p className="text-[9.5px] font-black uppercase tracking-[0.14em] text-foreground/45">Platform</p>
                <p className="font-mono text-[15px] font-black text-foreground/60">−{ARCADE_HOUSE_FEE} 💎</p>
                <p className="text-[9.5px] font-bold text-foreground/40">house fee</p>
              </div>
            </div>

            {gateError && (
              <p className="mt-3 rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-[12px] font-bold text-red-300">
                {gateError} — top up below in Arcade Vaults.
              </p>
            )}

            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button
                onClick={() => launch(gate, false)}
                disabled={
                  accounts[0].balance < ARCADE_ENTRY || accounts[1].balance < ARCADE_ENTRY
                }
                className="h-12 border border-[#8a6a24]/50 bg-gradient-to-b from-[#ecca6f] to-[#c69c3f] text-[14px] font-black text-[#241a05] hover:from-[#f3d887] disabled:opacity-40"
              >
                <ShieldCheck className="mr-1.5 h-4.5 w-4.5" />
                Lock & start
              </Button>
              <Button
                variant="outline"
                onClick={() => setGate(null)}
                className="h-12 border-white/12 bg-white/5 text-[13px] font-bold text-foreground/70"
              >
                <Frown className="mr-1.5 h-4 w-4" />
                Not yet
              </Button>
            </div>
            <p className="mt-2 text-center text-[10.5px] text-foreground/40">
              New vaults start with {ARCADE_SIGNUP} 💎 welcome diamonds · leaving
              mid-match refunds both stakes
            </p>
          </div>
        </div>
      )}

      {/* ---------------- game overlay ---------------- */}
      {match && (
        <div className="fixed inset-0 z-[70] flex flex-col bg-background/[0.985] px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-5">
          <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col">
            {match.key === "ludo" && <LudoGame {...gameProps(match)} />}
            {match.key === "carrom" && <CarromGame {...gameProps(match)} />}
            {match.key === "snake" && <SnakeDuelGame {...gameProps(match)} />}
          </div>
        </div>
      )}

      {/* practice result toast-card */}
      {practiceNote && !match && (
        <div className="fixed inset-x-4 bottom-24 z-[72] mx-auto max-w-sm rounded-xl border border-gold/40 bg-black/85 px-4 py-3 text-center backdrop-blur-md">
          <p className="text-[13px] font-black text-gold-soft">
            <Trophy className="mr-1.5 inline h-4 w-4" />
            {practiceNote}
          </p>
          <button
            type="button"
            onClick={() => setPracticeNote(null)}
            className="mt-1 text-[11px] font-bold text-foreground/50 underline-offset-2 hover:underline"
          >
            dismiss
          </button>
        </div>
      )}

      {/* ---------------- settlement ---------------- */}
      {settlement && match && (
        <SettlementCard
          players={match.players}
          settlement={settlement}
          onRematch={() => {
            const key = match.key;
            setSettlement(null);
            setMatch(null);
            window.setTimeout(() => launch(key, false), 60);
          }}
          onDone={closeSettlement}
        />
      )}
    </section>
  );
}
