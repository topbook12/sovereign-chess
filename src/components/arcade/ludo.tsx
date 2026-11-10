"use client";

/**
 * Sovereign Chess — LUDO (arcade stake game, pass-and-play).
 *
 * Contract:
 *  - Pure game: knows nothing about wallets. Reports the verdict through
 *    onFinish EXACTLY once (guarded); onExit is handled by GameFrame.
 *  - players[0] (Gold) races from the bottom-left base, players[1] (Emerald)
 *    from the top-right. In practice mode players[1] is a bot; stake matches
 *    are two humans sharing the dice.
 *
 * Rules implemented:
 *  - Verified 52-cell shared track (see repo check script); 4 tokens each.
 *  - Roll a 6 to release a token; a 6 always grants another roll.
 *  - Exact count to land home (p56); overshooting is not a legal move.
 *  - Landing on an opponent token sends it back to base — unless the cell
 *    is one of the 8 safe squares (4 starts + 4 stars, 13 apart / +8).
 *  - No legal move → turn passes. All four tokens home → immediate win.
 *
 * Rendering is pure CSS on a 15×15 grid (no canvas, no framer-motion):
 * tokens are absolutely-positioned buttons whose left/top transitions
 * animate every move, capture and release.
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Bot, Crown, Dices, RotateCcw } from "lucide-react";
import type { ArcadeGameProps } from "@/lib/arcade-types";
import { GameFrame } from "@/components/arcade/kit";
import { pulse } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/* ------------------------------------------------------------------ */
/* board geometry — verified 52-cell track (col, row) on a 15×15 grid  */
/* ------------------------------------------------------------------ */

const TRACK: [number, number][] = [
  [6, 13], [6, 12], [6, 11], [6, 10], [6, 9],
  [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  [0, 7], [0, 6],
  [1, 6], [2, 6], [3, 6], [4, 6], [5, 6],
  [6, 5], [6, 4], [6, 3], [6, 2], [6, 1], [6, 0],
  [7, 0], [8, 0],
  [8, 1], [8, 2], [8, 3], [8, 4], [8, 5],
  [9, 6], [10, 6], [11, 6], [12, 6], [13, 6], [14, 6],
  [14, 7], [14, 8],
  [13, 8], [12, 8], [11, 8], [10, 8], [9, 8],
  [8, 9], [8, 10], [8, 11], [8, 12], [8, 13], [8, 14],
  [7, 14], [6, 14],
];

const HOME_COLS: [number, number][][] = [
  [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]], // gold — entered from (7,14)
  [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],     // emerald — entered from (7,0)
];

const START_IDX = [0, 26] as const; // (6,13) bottom-left · (8,1) top-right
const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]); // 4 starts + 4 stars (+8)
const BASE_SLOTS: [number, number][][] = [
  [[2, 11], [4, 11], [2, 13], [4, 13]], // gold base (bottom-left)
  [[11, 2], [13, 2], [11, 4], [13, 4]], // emerald base (top-right)
];
const HOME = 56; // pos: -1 base · 0–50 track · 51–55 home column · 56 home
const PIPS: Record<number, number[]> = {
  1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
};

/* ------------------------------------------------------------------ */
/* state                                                               */
/* ------------------------------------------------------------------ */

interface Token {
  id: number; // 0–3 gold · 4–7 emerald
  player: 0 | 1;
  pos: number;
}

type Phase = "roll" | "resolve" | "pick" | "over";

interface GameState {
  tokens: Token[];
  turn: 0 | 1;
  dice: number | null;
  phase: Phase;
  winner: 0 | 1 | null;
}

type Tone = "gold" | "emerald" | "danger";

interface Banner {
  id: number;
  text: string;
  tone: Tone;
}

let bannerSeq = 1;
const nextBannerId = () => ++bannerSeq;

const freshGame = (): GameState => ({
  tokens: [
    ...[0, 1, 2, 3].map((i) => ({ id: i, player: 0 as const, pos: -1 })),
    ...[4, 5, 6, 7].map((i) => ({ id: i, player: 1 as const, pos: -1 })),
  ],
  turn: 0,
  dice: null,
  phase: "roll",
  winner: null,
});

const tokenById = (s: GameState, id: number): Token => s.tokens.find((t) => t.id === id) as Token;
const homeCount = (tokens: Token[], player: 0 | 1) =>
  tokens.filter((t) => t.player === player && t.pos === HOME).length;

const canMove = (t: Token, dice: number): boolean =>
  t.pos === HOME ? false : t.pos === -1 ? dice === 6 : t.pos + dice <= HOME;

function legalMoves(s: GameState, player: 0 | 1, dice: number): number[] {
  return s.tokens.filter((t) => t.player === player && canMove(t, dice)).map((t) => t.id);
}

/** Move a token; send any opponent tokens landed on (non-safe) back to base. */
function applyMove(
  tokens: Token[],
  tokenId: number,
  dice: number
): { tokens: Token[]; captured: Token[]; homed: boolean } {
  const next = tokens.map((t) => ({ ...t }));
  const mover = next.find((t) => t.id === tokenId) as Token;
  mover.pos = mover.pos === -1 ? 0 : mover.pos + dice;
  const captured: Token[] = [];
  if (mover.pos <= 50) {
    const abs = (START_IDX[mover.player] + mover.pos) % 52;
    if (!SAFE.has(abs)) {
      for (const t of next) {
        if (
          t.player !== mover.player &&
          t.pos >= 0 &&
          t.pos <= 50 &&
          (START_IDX[t.player] + t.pos) % 52 === abs
        ) {
          t.pos = -1;
          captured.push(t);
        }
      }
    }
  }
  return { tokens: next, captured, homed: mover.pos === HOME };
}

/** Bot brain (practice): finish > capture > release > advance the leader. */
function botPick(s: GameState, moves: number[], dice: number): number {
  const score = (id: number): number => {
    const t = tokenById(s, id);
    const dest = t.pos === -1 ? 0 : t.pos + dice;
    let sc = t.pos * 0.5;
    if (t.pos === -1) sc = 40;
    if (dest === HOME) sc = 100;
    if (dest <= 50) {
      const abs = (START_IDX[t.player] + dest) % 52;
      if (!SAFE.has(abs) && s.tokens.some(
        (o) => o.player !== t.player && o.pos >= 0 && o.pos <= 50 && (START_IDX[o.player] + o.pos) % 52 === abs
      )) sc = 80;
    }
    return sc;
  };
  return moves.reduce((best, id) => (score(id) > score(best) ? id : best), moves[0]);
}

/** Cell-unit centre coordinates (0–15) for rendering a token. */
function tokenXY(t: Token): [number, number] {
  if (t.pos === -1) {
    const [c, r] = BASE_SLOTS[t.player][t.id % 4];
    return [c + 0.5, r + 0.5];
  }
  if (t.pos <= 50) {
    const [c, r] = TRACK[(START_IDX[t.player] + t.pos) % 52];
    return [c + 0.5, r + 0.5];
  }
  if (t.pos <= 55) {
    const [c, r] = HOME_COLS[t.player][t.pos - 51];
    return [c + 0.5, r + 0.5];
  }
  const fan = ([[-0.62, -0.62], [0.62, -0.62], [-0.62, 0.62], [0.62, 0.62]] as const)[t.id % 4];
  return [7.5 + fan[0], 7.5 + fan[1]];
}

const pc = (v: number) => `${(v / 15) * 100}%`;
const cellBox = (c: number, r: number): CSSProperties => ({
  left: pc(c), top: pc(r), width: pc(1), height: pc(1),
});

/* ------------------------------------------------------------------ */
/* small presentational pieces                                         */
/* ------------------------------------------------------------------ */

function DiceFace({ value, muted }: { value: number | null; muted?: boolean }) {
  const pips = value ? PIPS[value] : [];
  return (
    <span
      className={cn(
        "grid h-9 w-9 grid-cols-3 grid-rows-3 gap-[2px] rounded-lg border border-black/25 bg-[#fdf6e3] p-[5px] shadow-[inset_0_-2px_4px_rgba(0,0,0,0.15)]",
        muted && "opacity-60"
      )}
    >
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className={cn("rounded-full", pips.includes(i) ? "bg-[#241a05]" : "bg-transparent")} />
      ))}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* component                                                           */
/* ------------------------------------------------------------------ */

export function LudoGame(props: ArcadeGameProps) {
  const { players, practice } = props;
  const [game, setGame] = useState<GameState>(freshGame);
  const [rolling, setRolling] = useState(false);
  const [face, setFace] = useState(1);
  const [banner, setBanner] = useState<Banner | null>({
    id: 0,
    text: "Roll a 6 to release your tokens",
    tone: "gold",
  });

  const gameRef = useRef<GameState>(game);
  const timersRef = useRef<number[]>([]);
  const rollIvRef = useRef<number | null>(null);
  const rollingRef = useRef(false);
  const finishedRef = useRef(false);

  /** Single mutation path — ref stays in sync for timers/bot, no stale reads. */
  const update = (next: GameState) => {
    gameRef.current = next;
    setGame(next);
  };
  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms);
    timersRef.current.push(id);
    return id;
  };
  const clearTimers = () => {
    for (const id of timersRef.current) window.clearTimeout(id);
    timersRef.current = [];
    if (rollIvRef.current !== null) window.clearInterval(rollIvRef.current);
    rollIvRef.current = null;
  };
  useEffect(() => () => clearTimers(), []);

  const say = (text: string, tone: Tone) => setBanner({ id: nextBannerId(), text, tone });

  const finishMatch = (winner: 0 | 1, tokens: Token[]) => {
    if (finishedRef.current) return; // exactly once per match
    finishedRef.current = true;
    props.onFinish({
      winner,
      scores: [homeCount(tokens, 0), homeCount(tokens, 1)],
    });
  };

  /* — dice — */

  const performRoll = () => {
    const s = gameRef.current;
    if (s.phase !== "roll" || s.winner !== null || rollingRef.current) return;
    if (practice && s.turn === 1) return; // bot has its own path
    rollingRef.current = true;
    setRolling(true);
    const iv = window.setInterval(() => setFace(1 + Math.floor(Math.random() * 6)), 75);
    rollIvRef.current = iv;
    later(() => {
      if (rollIvRef.current === iv) {
        window.clearInterval(iv);
        rollIvRef.current = null;
      }
      rollingRef.current = false;
      setRolling(false);
      const cur = gameRef.current;
      if (cur.phase !== "roll") return;
      const value = 1 + Math.floor(Math.random() * 6);
      pulse("select");
      const moves = legalMoves(cur, cur.turn, value);
      if (!moves.length) {
        update({ ...cur, dice: value, phase: "resolve" });
        say("No legal move — turn passes", "danger");
        later(() => endTurn(), 1050);
        return;
      }
      update({ ...cur, dice: value, phase: "pick" });
      // one option, or four interchangeable base tokens on a six → auto-move
      if (moves.length === 1 || moves.every((id) => tokenById(cur, id).pos === -1)) {
        later(() => commitMove(moves[0]), 640);
      }
    }, 640);
  };

  const endTurn = () => {
    const s = gameRef.current;
    if (s.phase === "over") return;
    const other = s.turn === 0 ? 1 : 0;
    update({ ...s, turn: other, dice: null, phase: "roll" });
    say(`${players[other].name} to roll`, other === 0 ? "gold" : "emerald");
  };

  /* — moving — */

  const commitMove = (tokenId: number) => {
    const s = gameRef.current;
    if (s.phase !== "pick" || s.dice === null || s.winner !== null) return;
    const mover = s.turn;
    const dice = s.dice;
    const { tokens, captured, homed } = applyMove(s.tokens, tokenId, dice);
    pulse("move");
    const winner: 0 | 1 | null = homeCount(tokens, mover) === 4 ? mover : null;

    if (winner !== null) {
      update({ ...s, tokens, dice: null, phase: "over", winner });
      pulse("win");
      say(`${players[mover].name} brings all four home!`, mover === 0 ? "gold" : "emerald");
      finishMatch(winner, tokens);
      return;
    }

    const next: GameState = { ...s, tokens };
    if (captured.length > 0) {
      pulse("capture");
      say(`Capture! ${players[captured[0].player].name}'s token is sent back`, "danger");
    } else if (homed) {
      pulse("promote");
      say("Token home — keep racing", mover === 0 ? "gold" : "emerald");
    }

    if (dice === 6) {
      next.phase = "roll"; // a six always buys another roll
      update(next);
      if (!captured.length && !homed) say("Six — roll again!", mover === 0 ? "gold" : "emerald");
    } else {
      const other = mover === 0 ? 1 : 0;
      update({ ...next, turn: other, dice: null, phase: "roll" });
      if (!captured.length && !homed) say(`${players[other].name} to roll`, other === 0 ? "gold" : "emerald");
    }
  };

  const onToken = (t: Token) => {
    if (practice && game.turn === 1) return;
    if (!movable.includes(t.id)) return;
    commitMove(t.id);
  };

  /* — practice bot (players[1]) — */

  useEffect(() => {
    if (!practice) return;
    const s = gameRef.current;
    if (s.turn !== 1 || s.phase === "over" || finishedRef.current) return;
    if (s.phase === "roll") {
      if (rollingRef.current) return;
      const t = later(() => performRoll(), 900);
      return () => window.clearTimeout(t);
    }
    if (s.phase === "pick") {
      const t = later(() => {
        const cur = gameRef.current;
        if (cur.phase !== "pick" || cur.dice === null) return;
        const moves = legalMoves(cur, 1, cur.dice);
        if (moves.length > 0) commitMove(botPick(cur, moves, cur.dice));
      }, 800);
      return () => window.clearTimeout(t);
    }
  });

  /* — banners fade — */
  useEffect(() => {
    if (!banner) return;
    const t = window.setTimeout(() => setBanner(null), 2400);
    return () => window.clearTimeout(t);
  }, [banner]);

  const rematch = () => {
    pulse("achievement");
    clearTimers();
    finishedRef.current = false;
    rollingRef.current = false;
    setRolling(false);
    update(freshGame());
    say("Rematch — Gold rolls first", "gold");
  };

  /* — derived — */
  const movable =
    game.phase === "pick" && game.dice !== null && !(practice && game.turn === 1)
      ? legalMoves(game, game.turn, game.dice)
      : [];
  const scores: [number, number] = [homeCount(game.tokens, 0), homeCount(game.tokens, 1)];
  const botTurn = practice && game.turn === 1;
  const canRoll = game.phase === "roll" && !rolling && !botTurn && game.winner === null;

  // stacking: tokens sharing a cell fan out slightly
  const stackIdx = new Map<number, { i: number; n: number }>();
  {
    const groups = new Map<string, number[]>();
    for (const t of game.tokens) {
      const [x, y] = tokenXY(t);
      const k = `${Math.round(x * 50)}|${Math.round(y * 50)}`;
      const arr = groups.get(k) ?? [];
      arr.push(t.id);
      groups.set(k, arr);
    }
    for (const ids of groups.values()) ids.forEach((id, i) => stackIdx.set(id, { i, n: ids.length }));
  }

  const statusSub = game.winner !== null
    ? "Match over"
    : rolling
      ? "Rolling…"
      : botTurn
        ? game.phase === "roll" ? "Bot is rolling…" : "Bot is choosing…"
        : game.phase === "roll"
          ? "Tap the dice"
          : game.phase === "pick"
            ? `Rolled ${game.dice} — tap a glowing token`
            : "No legal move — passing…";

  const toneCls = (tone: Tone) =>
    tone === "gold"
      ? "border-gold/50 bg-[#1a1206]/85 text-gold-soft"
      : tone === "emerald"
        ? "border-emerald-400/50 bg-[#06120c]/85 text-emerald-300"
        : "border-red-400/50 bg-[#170808]/85 text-red-300";

  return (
    <GameFrame
      title={practice ? "Ludo · Practice" : "Ludo"}
      players={players}
      scores={scores}
      turn={game.phase === "over" ? null : game.turn}
      turnLabel={["Gold · bottom-left base", "Emerald · top-right base"]}
      onExit={props.onExit}
    >
      <div className="relative aspect-square w-[min(92vw,calc(100dvh-18rem))] select-none rounded-[22px] bg-gradient-to-b from-[#f3d887] via-[#c69c3f] to-[#8a6a24] p-[5px] shadow-[0_28px_80px_-28px_rgba(0,0,0,0.95),0_0_70px_-20px_rgba(212,175,55,0.5)]">
        <div
          className="relative h-full w-full overflow-hidden rounded-[17px] bg-[#241708]"
          style={{ backgroundImage: "radial-gradient(circle at 50% 42%, #31220f 0%, #241708 62%, #170d05 100%)" }}
        >
          {/* phantom quadrants (unused in the duel) */}
          <div className="absolute rounded-xl border border-white/5 bg-white/[0.015]" style={{ left: pc(0.55), top: pc(0.55), width: pc(4.9), height: pc(4.9) }} />
          <div className="absolute rounded-xl border border-white/5 bg-white/[0.015]" style={{ left: pc(9.55), top: pc(9.55), width: pc(4.9), height: pc(4.9) }} />

          {/* bases */}
          <div
            className="absolute rounded-2xl border border-[#ecca6f]/35 bg-gradient-to-br from-[#ecca6f]/15 to-transparent shadow-[inset_0_1px_0_rgba(255,244,200,0.12)]"
            style={{ left: pc(0.55), top: pc(9.55), width: pc(4.9), height: pc(4.9) }}
          />
          <div
            className="absolute rounded-2xl border border-[#34d399]/35 bg-gradient-to-bl from-[#34d399]/15 to-transparent shadow-[inset_0_1px_0_rgba(220,255,240,0.1)]"
            style={{ left: pc(9.55), top: pc(0.55), width: pc(4.9), height: pc(4.9) }}
          />
          {BASE_SLOTS.flat().map(([c, r], i) => (
            <div key={`slot${i}`} className="absolute grid place-items-center" style={cellBox(c, r)}>
              <div className={cn("h-[72%] w-[72%] rounded-full border-2 border-dashed", i < 4 ? "border-[#ecca6f]/40" : "border-[#34d399]/40")} />
            </div>
          ))}

          {/* track */}
          {TRACK.map(([c, r], i) => {
            const start0 = i === START_IDX[0];
            const start1 = i === START_IDX[1];
            const safe = SAFE.has(i);
            return (
              <div key={`t${i}`} className="absolute p-[7%]" style={cellBox(c, r)}>
                <div
                  className={cn(
                    "grid h-full w-full place-items-center rounded-[22%] border",
                    start0
                      ? "border-[#ecca6f]/75 bg-[#ecca6f]/20"
                      : start1
                        ? "border-[#34d399]/75 bg-[#34d399]/20"
                        : safe
                          ? "border-gold/35 bg-gold/[0.08]"
                          : "border-white/10 bg-white/[0.045]"
                  )}
                >
                  {safe && !start0 && !start1 && <span className="h-1/3 w-1/3 rounded-full bg-gold/45" />}
                </div>
              </div>
            );
          })}

          {/* home columns */}
          {HOME_COLS.map((lane, p) =>
            lane.map(([c, r], i) => (
              <div key={`h${p}-${i}`} className="absolute p-[7%]" style={cellBox(c, r)}>
                <div
                  className={cn(
                    "h-full w-full rounded-[22%] border",
                    p === 0 ? "border-[#ecca6f]/40 bg-[#ecca6f]/10" : "border-[#34d399]/40 bg-[#34d399]/10"
                  )}
                />
              </div>
            ))
          )}

          {/* unused home lanes (the two dormant quadrants) */}
          {[1, 2, 3, 4, 5, 9, 10, 11, 12, 13].map((c) => (
            <div key={`u${c}`} className="absolute p-[7%]" style={cellBox(c, 7)}>
              <div className="h-full w-full rounded-[22%] border border-white/5 bg-white/[0.015]" />
            </div>
          ))}

          {/* centre — home */}
          <div
            className="absolute grid place-items-center rounded-lg bg-gradient-to-br from-[#f3d887] via-[#c69c3f] to-[#8a6a24] shadow-[0_0_30px_-6px_rgba(212,175,55,0.55)]"
            style={{ left: pc(6.15), top: pc(6.15), width: pc(2.7), height: pc(2.7) }}
          >
            <Crown className="h-[38%] w-[38%] text-[#241a05]" aria-hidden="true" />
          </div>

          {/* tokens */}
          {game.tokens.map((t) => {
            const [x, y] = tokenXY(t);
            const st = stackIdx.get(t.id);
            const dx = st && st.n > 1 ? (st.i - (st.n - 1) / 2) * 0.3 : 0;
            const canTap = movable.includes(t.id);
            const gold = t.player === 0;
            return (
              <button
                key={t.id}
                type="button"
                aria-label={`${gold ? "Gold" : "Emerald"} token ${t.id % 4}`}
                disabled={!canTap}
                onClick={() => onToken(t)}
                className={cn(
                  "absolute -translate-x-1/2 -translate-y-1/2 rounded-full transition-[left,top] duration-300 ease-out",
                  canTap ? "cursor-pointer" : "cursor-default"
                )}
                style={{ left: pc(x + dx), top: pc(y), width: pc(1.15), height: pc(1.15) }}
              >
                <span
                  className={cn(
                    "block h-[76%] w-[76%] rounded-full border shadow-[0_3px_7px_rgba(0,0,0,0.55)] transition-transform duration-200",
                    gold
                      ? "border-[#8a6a24] bg-[radial-gradient(circle_at_32%_28%,#f9e7ae,#ecca6f_55%,#a97c22)]"
                      : "border-[#0a5a40] bg-[radial-gradient(circle_at_32%_28%,#8af0c8,#34d399_55%,#0e7a55)]",
                    canTap && "scale-110 animate-pulse ring-2 ring-white/90"
                  )}
                />
              </button>
            );
          })}

          {/* event banner */}
          <div className="pointer-events-none absolute inset-x-0 top-2 z-20 flex justify-center">
            {banner && (
              <div
                key={banner.id}
                className={cn(
                  "max-w-[94%] truncate rounded-full border px-4 py-1.5 text-[11px] font-black uppercase tracking-[0.16em] shadow-lg backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-300",
                  toneCls(banner.tone)
                )}
              >
                {banner.text}
              </div>
            )}
          </div>

          {/* verdict */}
          {game.phase === "over" && game.winner !== null && (
            <div className="absolute inset-0 z-30 grid place-items-center rounded-[17px] bg-black/70 p-6 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-2.5 rounded-2xl border border-gold/30 bg-black/85 px-6 py-5 text-center">
                <Crown className="h-8 w-8 text-[#ecca6f]" aria-hidden="true" />
                <p className="font-display text-lg font-black tracking-wide">
                  <span className="text-gold-gradient">{players[game.winner].name} wins the race</span>
                </p>
                <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-foreground/50">
                  {scores[0]} — {scores[1]} tokens home
                </p>
                <Button
                  onClick={rematch}
                  className="h-11 min-w-44 border border-[#8a6a24]/50 bg-gradient-to-b from-[#ecca6f] to-[#c69c3f] text-[13px] font-black text-[#241a05] shadow-[0_0_24px_-8px_rgba(212,175,55,0.7)] hover:from-[#f3d887]"
                >
                  <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
                  Rematch
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* dice + status */}
      <div className="mt-3 flex min-h-14 items-center justify-center gap-4">
        <button
          type="button"
          onClick={performRoll}
          disabled={!canRoll}
          aria-label="Roll the dice"
          className={cn(
            "grid h-14 w-14 shrink-0 place-items-center rounded-2xl border transition-all active:scale-95",
            canRoll
              ? "border-gold/60 bg-gradient-to-b from-[#ecca6f] to-[#c69c3f] text-[#241a05] shadow-[0_0_26px_-6px_rgba(212,175,55,0.75)]"
              : "border-white/10 bg-white/[0.03] text-foreground/40"
          )}
        >
          {rolling ? (
            <span className="block h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : game.dice === null && canRoll ? (
            <Dices className="h-6 w-6" aria-hidden="true" />
          ) : (
            <DiceFace value={game.dice} muted={game.phase === "roll"} />
          )}
        </button>
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-foreground/40">
            {game.winner !== null ? "Verdict" : botTurn ? <span className="inline-flex items-center gap-1"><Bot className="h-3 w-3" aria-hidden="true" /> Practice bot</span> : `Squad ${game.turn === 0 ? "Gold" : "Emerald"}`}
          </p>
          <p className="truncate text-[13px] font-black text-foreground/85">{statusSub}</p>
        </div>
      </div>
    </GameFrame>
  );
}

export default LudoGame;
