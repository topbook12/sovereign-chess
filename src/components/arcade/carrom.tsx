"use client";

/**
 * Sovereign Chess — CARROM (arcade stake game, canvas physics).
 *
 * Contract:
 *  - Pure game: knows nothing about wallets. Reports the verdict through
 *    onFinish EXACTLY once (guarded); onExit is handled by GameFrame.
 *  - Two players pass-and-play on one device. players[0] (Gold) breaks and
 *    shoots from the BOTTOM baseline; players[1] (Emerald) shoots from the TOP.
 *
 * Feel:
 *  - Pool-style pull-back aiming: press anywhere, drag away, release to shoot
 *    — dotted guide ray (opposite the drag), power meter, raycast contact ring.
 *  - Fixed-substep physics (1/240 s — no tunnelling at max speed): impulse
 *    collisions (e = 0.93), wall bounce (e = 0.75), exponential + Coulomb
 *    friction tuned so a medium shot rolls ~1.5 board lengths.
 *  - Queen hold/cover rule, striker fouls, extra turns on own pots, 9-coin win.
 *
 * Everything mutable lives in refs (never state); React state only mirrors
 * chrome (scores, turn, banners). The rAF loop is cancelled on unmount.
 */

import { useEffect, useRef, useState } from "react";
import { Crown, MoveHorizontal, RotateCcw, Target } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import type { ArcadeGameProps, ArcadeResult } from "@/lib/arcade-types";
import { GameFrame, seededRandom } from "@/components/arcade/kit";
import { pulse } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/* ------------------------------------------------------------------ */
/* constants — world unit = one playfield width, time = seconds        */
/* ------------------------------------------------------------------ */

const TAU = Math.PI * 2;

const COIN_R = 0.032;
const STRIKER_R = 0.042;
const POCKET_R = 0.055;
const POCKETS: readonly [number, number][] = [
  [0.05, 0.05],
  [0.95, 0.05],
  [0.05, 0.95],
  [0.95, 0.95],
];

const BASE_Y: [number, number] = [0.87, 0.13]; // players[0] bottom · players[1] top
const STRIP_MIN = 0.22;
const STRIP_MAX = 0.78;

const RING1 = COIN_R * 2; // inner ring of 6 hugs the queen
const RING2 = COIN_R * 4; // outer ring of 12

const SUB_DT = 1 / 240; // fixed physics substep
const FRICTION = 0.985; // velocity kept per substep
const COULOMB = 16.3; // u/s² constant decel — medium shot ≈ 1.5 board lengths
const STOP_V = 0.02; // below this a disc is at rest
const WALL_E = 0.75; // wall bounce restitution
const DISC_E = 0.93; // coin↔coin restitution
const SLOP = 0.0003;
const CORR_PCT = 0.9;
const MAX_CORR = 0.012; // positional correction cap per substep (no explosive pushes)

const MAX_SPEED = 22; // u/s cap
const MIN_DRAG = 0.025; // shorter pulls cancel (no accidental taps)
const POWER_FULL = 0.3; // drag length for 100% power
const FORCE_STOP_MS = 6000; // safety whistle — everything halts
const FRAME_W = 0.078; // wooden frame, fraction of the square

const COLORS: Record<Kind, { hi: string; mid: string; lo: string; rim: string }> = {
  striker: { hi: "#fffdf6", mid: "#efe6cd", lo: "#b3a787", rim: "#8d8264" },
  gold: { hi: "#f9e7ae", mid: "#ecca6f", lo: "#a97c22", rim: "#7c5a16" },
  emerald: { hi: "#8af0c8", mid: "#34d399", lo: "#0e7a55", rim: "#0a5a40" },
  queen: { hi: "#ff9d9d", mid: "#ef4444", lo: "#8f1d1d", rim: "#6d1414" },
};

const COLOR_RGB: Record<Kind, string> = {
  striker: "240,230,205",
  gold: "236,202,111",
  emerald: "52,211,153",
  queen: "239,68,68",
};

/* ------------------------------------------------------------------ */
/* types                                                               */
/* ------------------------------------------------------------------ */

type Kind = "striker" | "gold" | "emerald" | "queen";
type CoinColor = "gold" | "emerald";
type Phase = "aim" | "shooting" | "over";
type BannerTone = "gold" | "emerald" | "queen" | "danger";

interface Disc {
  kind: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  alive: boolean;
}

interface SinkFx {
  x: number;
  y: number;
  t: number; // 0 → 1 lifetime
  kind: Kind;
}

interface GameState {
  discs: Disc[]; // [0] is always the striker
  turn: 0 | 1;
  phase: Phase;
  scores: [number, number];
  potted: { gold: number; emerald: number }; // coins off the board, by colour
  queenHeldBy: 0 | 1 | null;
  pottedThisStrike: Kind[];
  shotStart: number;
  fx: SinkFx[];
}

interface InputState {
  mode: "none" | "place" | "aim";
  id: number;
  grabX: number; // placement: world x where the drag began
  startX: number; // placement: striker x when the drag began
  sx: number; // aim: drag origin
  sy: number;
  cx: number; // aim: current pointer
  cy: number;
  overlap: boolean; // placement: striker overlaps a coin
}

interface Banner {
  id: number;
  text: string;
  tone: BannerTone;
}

interface View {
  css: number;
  dpr: number;
  frame: number;
  field: number;
}

interface SettleHooks {
  getNames: () => [string, string];
  onFinish: (r: ArcadeResult) => void;
  setScores: (s: [number, number]) => void;
  setTurn: (t: 0 | 1) => void;
  setPhase: (p: Phase) => void;
  setQueenHeld: (q: 0 | 1 | null) => void;
  setBanner: (b: Banner | null) => void;
}

const IDLE_INPUT: InputState = {
  mode: "none",
  id: -1,
  grabX: 0,
  startX: 0,
  sx: 0,
  sy: 0,
  cx: 0,
  cy: 0,
  overlap: false,
};

let bannerSeq = 1;
const nextBannerId = () => ++bannerSeq;

/* ------------------------------------------------------------------ */
/* tiny math helpers                                                   */
/* ------------------------------------------------------------------ */

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/* ------------------------------------------------------------------ */
/* state builders                                                      */
/* ------------------------------------------------------------------ */

function freshState(): GameState {
  const discs: Disc[] = [
    { kind: "striker", x: 0.5, y: BASE_Y[0], vx: 0, vy: 0, r: STRIKER_R, alive: true },
    { kind: "queen", x: 0.5, y: 0.5, vx: 0, vy: 0, r: COIN_R, alive: true },
  ];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    discs.push({
      kind: i % 2 === 0 ? "gold" : "emerald",
      x: 0.5 + Math.cos(a) * RING1,
      y: 0.5 + Math.sin(a) * RING1,
      vx: 0, vy: 0, r: COIN_R, alive: true,
    });
  }
  for (let i = 0; i < 12; i++) {
    const a = (Math.PI / 6) * i;
    discs.push({
      kind: i % 2 === 0 ? "gold" : "emerald",
      x: 0.5 + Math.cos(a) * RING2,
      y: 0.5 + Math.sin(a) * RING2,
      vx: 0, vy: 0, r: COIN_R, alive: true,
    });
  }
  return {
    discs,
    turn: 0,
    phase: "aim",
    scores: [0, 0],
    potted: { gold: 0, emerald: 0 },
    queenHeldBy: null,
    pottedThisStrike: [],
    shotStart: 0,
    fx: [],
  };
}

/** Nearest x on the baseline where the striker touches no coin. */
function freeStrikerX(s: GameState, x: number): number {
  const y = BASE_Y[s.turn];
  const span = STRIP_MAX - STRIP_MIN + 0.01;
  for (let off = 0; off <= span; off += 0.004) {
    for (const sign of [1, -1] as const) {
      const cx = clamp(x + off * sign, STRIP_MIN, STRIP_MAX);
      if (!overlapsCoins(s, cx, y, STRIKER_R + 0.002)) return cx;
    }
  }
  return x; // fully jammed baseline (near-impossible) — physics will separate
}

function overlapsCoins(s: GameState, x: number, y: number, r: number): boolean {
  for (let i = 1; i < s.discs.length; i++) {
    const d = s.discs[i];
    if (!d.alive) continue;
    const dx = d.x - x;
    const dy = d.y - y;
    const rr = r + d.r;
    if (dx * dx + dy * dy < rr * rr) return true;
  }
  return false;
}

/** Spiral search for a free resting spot near the centre (queen / returned coins). */
function placeFree(s: GameState, r: number): { x: number; y: number } {
  for (let rad = 0; rad <= 0.3; rad += 0.018) {
    const steps = rad === 0 ? 1 : 14;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * TAU + rad * 6.5;
      const px = clamp(0.5 + Math.cos(a) * rad, r + 0.02, 0.98 - r);
      const py = clamp(0.5 + Math.sin(a) * rad, r + 0.02, 0.98 - r);
      let free = true;
      for (const d of s.discs) {
        if (!d.alive) continue;
        const dx = d.x - px;
        const dy = d.y - py;
        const rr = r + d.r + 0.001;
        if (dx * dx + dy * dy < rr * rr) { free = false; break; }
      }
      if (free) return { x: px, y: py };
    }
  }
  return { x: 0.5, y: 0.5 };
}

function respawnDisc(s: GameState, kind: Kind): void {
  const d = s.discs.find((p) => p.kind === kind && !p.alive);
  if (!d) return;
  const spot = placeFree(s, d.r);
  d.x = spot.x;
  d.y = spot.y;
  d.vx = 0;
  d.vy = 0;
  d.alive = true;
  s.fx.push({ x: spot.x, y: spot.y, t: 0, kind });
}

const returnQueen = (s: GameState) => respawnDisc(s, "queen");
const returnCoin = (s: GameState, color: CoinColor) => respawnDisc(s, color);

/* ------------------------------------------------------------------ */
/* physics                                                             */
/* ------------------------------------------------------------------ */

function physicsStep(s: GameState, dt: number): void {
  const discs = s.discs;

  // integrate + friction (exponential glide, then a firm Coulomb halt)
  for (const d of discs) {
    if (!d.alive || (d.vx === 0 && d.vy === 0)) continue;
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    const sp = Math.hypot(d.vx, d.vy);
    const ns = sp * FRICTION - COULOMB * dt;
    if (ns <= STOP_V) {
      d.vx = 0;
      d.vy = 0;
    } else {
      const k = ns / sp;
      d.vx *= k;
      d.vy *= k;
    }
  }

  // pocket capture — centre inside the hole
  for (const d of discs) {
    if (!d.alive) continue;
    for (const [px, py] of POCKETS) {
      const dx = d.x - px;
      const dy = d.y - py;
      if (dx * dx + dy * dy < POCKET_R * POCKET_R) {
        d.alive = false;
        d.vx = 0;
        d.vy = 0;
        s.pottedThisStrike.push(d.kind);
        s.fx.push({ x: px, y: py, t: 0, kind: d.kind });
        break;
      }
    }
  }

  // cushion bounce
  for (const d of discs) {
    if (!d.alive) continue;
    if (d.x < d.r) { d.x = d.r; if (d.vx < 0) d.vx = -d.vx * WALL_E; }
    else if (d.x > 1 - d.r) { d.x = 1 - d.r; if (d.vx > 0) d.vx = -d.vx * WALL_E; }
    if (d.y < d.r) { d.y = d.r; if (d.vy < 0) d.vy = -d.vy * WALL_E; }
    else if (d.y > 1 - d.r) { d.y = 1 - d.r; if (d.vy > 0) d.vy = -d.vy * WALL_E; }
  }

  // equal-mass impulse collisions + positional correction (2 relax passes)
  for (let iter = 0; iter < 2; iter++) {
    for (let i = 0; i < discs.length; i++) {
      const a = discs[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < discs.length; j++) {
        const b = discs[j];
        if (!b.alive) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const rr = a.r + b.r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr || d2 < 1e-12) continue;
        const dist = Math.sqrt(d2);
        const nx = dx / dist;
        const ny = dy / dist;
        const corr = Math.min(Math.max(rr - dist - SLOP, 0) * CORR_PCT, MAX_CORR) * 0.5;
        if (corr > 0) {
          a.x -= nx * corr; a.y -= ny * corr;
          b.x += nx * corr; b.y += ny * corr;
        }
        const rvn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rvn < 0) {
          const jimp = (-(1 + DISC_E) * rvn) / 2;
          a.vx -= jimp * nx; a.vy -= jimp * ny;
          b.vx += jimp * nx; b.vy += jimp * ny;
        }
      }
    }
  }
}

const allAtRest = (s: GameState) =>
  s.discs.every((d) => !d.alive || (d.vx === 0 && d.vy === 0));

/** Raycast from the striker along a direction: distance to first disc or wall. */
function castRay(s: GameState, ox: number, oy: number, dx: number, dy: number): number {
  let best = 2;
  if (dx > 1e-9) best = Math.min(best, (1 - STRIKER_R - ox) / dx);
  else if (dx < -1e-9) best = Math.min(best, (STRIKER_R - ox) / dx);
  if (dy > 1e-9) best = Math.min(best, (1 - STRIKER_R - oy) / dy);
  else if (dy < -1e-9) best = Math.min(best, (STRIKER_R - oy) / dy);
  for (let i = 1; i < s.discs.length; i++) {
    const d = s.discs[i];
    if (!d.alive) continue;
    const ex = d.x - ox;
    const ey = d.y - oy;
    const proj = ex * dx + ey * dy;
    if (proj <= 0) continue;
    const perp2 = ex * ex + ey * ey - proj * proj;
    const rr = STRIKER_R + d.r;
    if (perp2 >= rr * rr) continue;
    const t = proj - Math.sqrt(rr * rr - perp2);
    if (t > 0 && t < best) best = t;
  }
  return Math.max(best, 0);
}

/* ------------------------------------------------------------------ */
/* rules — called once every disc has come to rest                     */
/* ------------------------------------------------------------------ */

function prepareTurn(s: GameState): void {
  const st = s.discs[0];
  st.alive = true;
  st.vx = 0;
  st.vy = 0;
  st.y = BASE_Y[s.turn];
  st.x = freeStrikerX(s, clamp(st.x, STRIP_MIN, STRIP_MAX));
  s.pottedThisStrike = [];
  s.phase = "aim";
}

function settleStrike(s: GameState, hooks: SettleHooks): void {
  const shooter = s.turn;
  const other = (shooter === 0 ? 1 : 0) as 0 | 1;
  const own: CoinColor = shooter === 0 ? "gold" : "emerald";
  const opp: CoinColor = shooter === 0 ? "emerald" : "gold";
  const pots = s.pottedThisStrike;
  const foul = pots.includes("striker");
  const ownN = pots.filter((k) => k === own).length;
  const oppN = pots.filter((k) => k === opp).length;
  const queenN = pots.filter((k) => k === "queen").length;
  const names = hooks.getNames();

  // coins potted always count first — a foul then hands one of shooter's back
  if (ownN > 0) { s.potted[own] += ownN; s.scores[shooter] += ownN; }
  if (oppN > 0) { s.potted[opp] += oppN; s.scores[other] += oppN; }

  let text: string;
  let tone: BannerTone;
  let extra = false;

  if (foul) {
    if (queenN > 0) returnQueen(s); // the queen can never be held on a foul
    if (s.queenHeldBy === shooter) { // the cover strike was fouled → she goes back
      s.queenHeldBy = null;
      returnQueen(s);
    }
    const gaveBack = s.potted[own] > 0;
    if (gaveBack) {
      s.potted[own] -= 1;
      s.scores[shooter] = Math.max(0, s.scores[shooter] - 1);
      returnCoin(s, own);
    }
    text = gaveBack ? "Foul — striker pocketed · coin returned" : "Foul — striker pocketed";
    tone = "danger";
    pulse("illegal");
  } else {
    const covering = s.queenHeldBy === shooter;
    if (covering) {
      s.queenHeldBy = null;
      if (ownN > 0) {
        s.scores[shooter] += 3;
        text = `Queen covered — +3 ${names[shooter]}`;
        tone = "queen";
        pulse("achievement");
      } else {
        returnQueen(s);
        text = "Queen returned — not covered";
        tone = "danger";
      }
    } else if (queenN > 0) {
      if (ownN > 0) {
        s.scores[shooter] += 3;
        text = `Queen covered — +3 ${names[shooter]}`;
        tone = "queen";
        pulse("achievement");
      } else {
        s.queenHeldBy = shooter;
        text = "Queen held — cover her!";
        tone = "queen";
      }
    } else if (ownN > 0) {
      text = `+${ownN} ${names[shooter]} — shoot again`;
      tone = shooter === 0 ? "gold" : "emerald";
    } else if (oppN > 0) {
      text = `${names[other]} +${oppN} — turn passes`;
      tone = other === 0 ? "gold" : "emerald";
    } else {
      text = `${names[other]} to shoot`;
      tone = other === 0 ? "gold" : "emerald";
    }
    // own pot keeps the turn; a held queen buys the cover strike
    extra = ownN > 0 || queenN > 0;
  }

  const ownWin = s.potted[own] >= 9;
  const oppWin = s.potted[opp] >= 9;
  const winner: 0 | 1 | null = ownWin ? shooter : oppWin ? other : null;

  hooks.setScores([s.scores[0], s.scores[1]]);
  hooks.setQueenHeld(s.queenHeldBy);

  if (winner !== null) {
    s.phase = "over";
    hooks.setPhase("over");
    hooks.setBanner({
      id: nextBannerId(),
      text: `${names[winner]} takes the board!`,
      tone: winner === 0 ? "gold" : "emerald",
    });
    hooks.onFinish({ winner, scores: [s.scores[0], s.scores[1]] });
    return;
  }

  if (!extra) s.turn = other;
  prepareTurn(s);
  hooks.setTurn(s.turn);
  hooks.setPhase("aim");
  hooks.setBanner({ id: nextBannerId(), text, tone });
}

/* ------------------------------------------------------------------ */
/* artwork — the static board is rendered once per size into a cache   */
/* ------------------------------------------------------------------ */

function rrPath(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rad = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rad, y);
  g.lineTo(x + w - rad, y);
  g.arcTo(x + w, y, x + w, y + rad, rad);
  g.lineTo(x + w, y + h - rad);
  g.arcTo(x + w, y + h, x + w - rad, y + h, rad);
  g.lineTo(x + rad, y + h);
  g.arcTo(x, y + h, x, y + h - rad, rad);
  g.lineTo(x, y + rad);
  g.arcTo(x, y, x + rad, y, rad);
  g.closePath();
}

function buildStatic(css: number, dpr: number): HTMLCanvasElement {
  const off = document.createElement("canvas");
  off.width = Math.max(1, Math.round(css * dpr));
  off.height = off.width;
  const g = off.getContext("2d");
  if (!g) return off;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);

  const frame = css * FRAME_W;
  const field = css - frame * 2;
  const P = (w: number) => frame + w * field;

  /* — walnut frame — */
  rrPath(g, 0.5, 0.5, css - 1, css - 1, css * 0.055);
  const wood = g.createLinearGradient(0, 0, css, css);
  wood.addColorStop(0, "#2a1d12");
  wood.addColorStop(0.55, "#3d2a1a");
  wood.addColorStop(1, "#20140b");
  g.fillStyle = wood;
  g.fill();

  /* — grain, drawn (no images) — */
  const rnd = seededRandom(20240817);
  g.save();
  rrPath(g, 0.5, 0.5, css - 1, css - 1, css * 0.055);
  g.clip();
  for (let i = 0; i < 110; i++) {
    const y0 = rnd() * css;
    const dark = rnd() > 0.5;
    g.strokeStyle = dark
      ? `rgba(12,7,3,${(0.05 + rnd() * 0.1).toFixed(3)})`
      : `rgba(214,170,96,${(0.02 + rnd() * 0.05).toFixed(3)})`;
    g.lineWidth = 0.5 + rnd() * 1.6;
    g.beginPath();
    g.moveTo(-10, y0);
    g.bezierCurveTo(
      css * 0.3, y0 + (rnd() - 0.5) * css * 0.02,
      css * 0.7, y0 + (rnd() - 0.5) * css * 0.02,
      css + 10, y0 + (rnd() - 0.5) * css * 0.03
    );
    g.stroke();
  }
  g.restore();

  /* — gold outer hairline — */
  rrPath(g, css * 0.008, css * 0.008, css * 0.984, css * 0.984, css * 0.05);
  g.strokeStyle = "rgba(212,175,55,0.35)";
  g.lineWidth = 1;
  g.stroke();

  /* — recess groove around the playfield — */
  rrPath(g, frame - css * 0.004, frame - css * 0.004, field + css * 0.008, field + css * 0.008, css * 0.012);
  g.strokeStyle = "rgba(0,0,0,0.55)";
  g.lineWidth = Math.max(1.5, css * 0.006);
  g.stroke();

  /* — playing surface — */
  g.save();
  rrPath(g, frame, frame, field, field, css * 0.008);
  g.clip();
  const surf = g.createRadialGradient(css / 2, css / 2, css * 0.05, css / 2, css / 2, css * 0.72);
  surf.addColorStop(0, "#3d2a1a");
  surf.addColorStop(0.6, "#2c1e10");
  surf.addColorStop(1, "#1d1207");
  g.fillStyle = surf;
  g.fillRect(frame, frame, field, field);
  const sheen = g.createLinearGradient(frame, frame, frame + field, frame + field);
  sheen.addColorStop(0, "rgba(255,230,170,0.05)");
  sheen.addColorStop(0.4, "rgba(255,230,170,0.015)");
  sheen.addColorStop(1, "rgba(0,0,0,0.14)");
  g.fillStyle = sheen;
  g.fillRect(frame, frame, field, field);

  /* — gold pinstripes — */
  g.strokeStyle = "rgba(212,175,55,0.5)";
  g.lineWidth = Math.max(1, css * 0.0022);
  g.strokeRect(frame + css * 0.006, frame + css * 0.006, field - css * 0.012, field - css * 0.012);
  g.strokeStyle = "rgba(212,175,55,0.16)";
  g.strokeRect(frame + css * 0.013, frame + css * 0.013, field - css * 0.026, field - css * 0.026);

  g.lineCap = "round";

  /* — centre rosette — */
  g.strokeStyle = "rgba(212,175,55,0.26)";
  g.lineWidth = Math.max(1, css * 0.002);
  g.beginPath();
  g.arc(P(0.5), P(0.5), 0.115 * field, 0, TAU);
  g.stroke();
  g.strokeStyle = "rgba(212,175,55,0.15)";
  g.beginPath();
  g.arc(P(0.5), P(0.5), 0.062 * field, 0, TAU);
  g.stroke();
  g.strokeStyle = "rgba(212,175,55,0.13)";
  for (let i = 0; i < 8; i++) {
    const a = (TAU / 8) * i;
    g.beginPath();
    g.moveTo(P(0.5 + Math.cos(a) * 0.075), P(0.5 + Math.sin(a) * 0.075));
    g.lineTo(P(0.5 + Math.cos(a) * 0.098), P(0.5 + Math.sin(a) * 0.098));
    g.stroke();
  }
  g.fillStyle = "rgba(212,175,55,0.32)";
  g.beginPath();
  g.arc(P(0.5), P(0.5), Math.max(1.5, 0.007 * field), 0, TAU);
  g.fill();

  /* — corner arrows pointing at the centre — */
  g.strokeStyle = "rgba(212,175,55,0.2)";
  g.lineWidth = Math.max(1, css * 0.003);
  const inv = 1 / Math.SQRT2;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const dx = sx * inv;
      const dy = sy * inv;
      g.beginPath();
      g.arc(P(0.5 + dx * 0.335), P(0.5 + dy * 0.335), 0.022 * field, 0, TAU);
      g.stroke();
      g.beginPath();
      g.moveTo(P(0.5 + dx * 0.3), P(0.5 + dy * 0.3));
      g.lineTo(P(0.5 + dx * 0.15), P(0.5 + dy * 0.15));
      g.stroke();
      const tx = 0.5 + dx * 0.15;
      const ty = 0.5 + dy * 0.15;
      const qx = -dy;
      const qy = dx;
      g.beginPath();
      g.moveTo(P(tx + dx * 0.03 + qx * 0.02), P(ty + dy * 0.03 + qy * 0.02));
      g.lineTo(P(tx), P(ty));
      g.lineTo(P(tx + dx * 0.03 - qx * 0.02), P(ty + dy * 0.03 - qy * 0.02));
      g.stroke();
    }
  }

  /* — baselines — */
  g.strokeStyle = "rgba(212,175,55,0.32)";
  g.lineWidth = Math.max(1, css * 0.0025);
  for (const yy of [BASE_Y[0], BASE_Y[1]]) {
    g.beginPath();
    g.moveTo(P(STRIP_MIN), P(yy - 0.016));
    g.lineTo(P(STRIP_MAX), P(yy - 0.016));
    g.moveTo(P(STRIP_MIN), P(yy + 0.016));
    g.lineTo(P(STRIP_MAX), P(yy + 0.016));
    g.stroke();
    for (const xx of [STRIP_MIN, STRIP_MAX]) {
      g.beginPath();
      g.arc(P(xx), P(yy), 0.033 * field, 0, TAU);
      g.stroke();
      g.fillStyle = "rgba(212,175,55,0.28)";
      g.beginPath();
      g.arc(P(xx), P(yy), Math.max(1.2, 0.006 * field), 0, TAU);
      g.fill();
    }
  }

  /* — pockets: dark holes with a gold rim — */
  for (const [px, py] of POCKETS) {
    const X = P(px);
    const Y = P(py);
    const R = POCKET_R * field;
    const hole = g.createRadialGradient(X - R * 0.25, Y - R * 0.25, R * 0.1, X, Y, R);
    hole.addColorStop(0, "#241408");
    hole.addColorStop(0.55, "#0e0703");
    hole.addColorStop(1, "#030201");
    g.fillStyle = hole;
    g.beginPath();
    g.arc(X, Y, R, 0, TAU);
    g.fill();
    g.strokeStyle = "rgba(212,175,55,0.55)";
    g.lineWidth = Math.max(1.2, css * 0.004);
    g.stroke();
    g.strokeStyle = "rgba(0,0,0,0.6)";
    g.lineWidth = Math.max(1, css * 0.003);
    g.beginPath();
    g.arc(X, Y, R * 0.8, 0, TAU);
    g.stroke();
  }

  /* — vignette — */
  const vig = g.createRadialGradient(css / 2, css / 2, css * 0.3, css / 2, css / 2, css * 0.7);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.3)");
  g.fillStyle = vig;
  g.fillRect(frame, frame, field, field);
  g.restore();

  /* — branding on the top rail — */
  g.fillStyle = "rgba(233,201,107,0.4)";
  g.font = `700 ${Math.max(7, css * 0.0165).toFixed(1)}px ui-sans-serif, system-ui, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("S O V E R E I G N   C A R R O M", css / 2, frame * 0.5);

  return off;
}

/* ------------------------------------------------------------------ */
/* per-frame render helpers                                            */
/* ------------------------------------------------------------------ */

function drawDisc(
  ctx: CanvasRenderingContext2D,
  kind: Kind,
  x: number,
  y: number,
  R: number,
  ringColor: string | null
) {
  const c = COLORS[kind];

  // soft drop shadow
  const sh = ctx.createRadialGradient(x + R * 0.12, y + R * 0.28, R * 0.2, x + R * 0.12, y + R * 0.28, R * 1.3);
  sh.addColorStop(0, "rgba(0,0,0,0.4)");
  sh.addColorStop(0.65, "rgba(0,0,0,0.18)");
  sh.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = sh;
  ctx.beginPath();
  ctx.arc(x + R * 0.12, y + R * 0.28, R * 1.3, 0, TAU);
  ctx.fill();

  // body
  const body = ctx.createRadialGradient(x - R * 0.42, y - R * 0.48, R * 0.12, x, y, R * 1.02);
  body.addColorStop(0, c.hi);
  body.addColorStop(0.55, c.mid);
  body.addColorStop(1, c.lo);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(x, y, R, 0, TAU);
  ctx.fill();

  // rim + inner ring
  ctx.strokeStyle = c.rim;
  ctx.lineWidth = Math.max(1, R * 0.1);
  ctx.beginPath();
  ctx.arc(x, y, R * 0.94, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.28)";
  ctx.lineWidth = Math.max(1, R * 0.055);
  ctx.beginPath();
  ctx.arc(x, y, R * 0.62, 0, TAU);
  ctx.stroke();

  // gloss
  const gl = ctx.createRadialGradient(x - R * 0.35, y - R * 0.42, 0, x - R * 0.35, y - R * 0.42, R * 0.75);
  gl.addColorStop(0, "rgba(255,255,255,0.42)");
  gl.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gl;
  ctx.beginPath();
  ctx.arc(x, y, R, 0, TAU);
  ctx.fill();

  if (kind === "striker" && ringColor) {
    ctx.strokeStyle = ringColor;
    ctx.lineWidth = Math.max(1.5, R * 0.14);
    ctx.beginPath();
    ctx.arc(x, y, R * 0.78, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = ringColor;
    ctx.beginPath();
    ctx.arc(x, y, R * 0.12, 0, TAU);
    ctx.fill();
  }
  if (kind === "queen") {
    ctx.fillStyle = "rgba(255,224,130,0.9)";
    ctx.beginPath();
    ctx.arc(x, y, R * 0.14, 0, TAU);
    ctx.fill();
  }
}

function drawFx(ctx: CanvasRenderingContext2D, view: View, s: GameState) {
  const P = (w: number) => view.frame + w * view.field;
  for (const f of s.fx) {
    const a = 1 - f.t;
    ctx.strokeStyle = `rgba(${COLOR_RGB[f.kind]},${(0.7 * a).toFixed(3)})`;
    ctx.lineWidth = Math.max(1, view.css * 0.004 * a + 0.5);
    ctx.beginPath();
    ctx.arc(P(f.x), P(f.y), POCKET_R * view.field * (0.55 + 1.5 * f.t), 0, TAU);
    ctx.stroke();
  }
}

function drawPowerMeter(ctx: CanvasRenderingContext2D, view: View, p: number) {
  const bw = view.css * 0.34;
  const bh = Math.max(8, view.css * 0.024);
  const bx = (view.css - bw) / 2;
  const by = view.css - view.frame * 0.5 - bh / 2;
  rrPath(ctx, bx, by, bw, bh, bh / 2);
  ctx.fillStyle = "rgba(255,255,255,0.1)";
  ctx.fill();
  ctx.strokeStyle = "rgba(212,175,55,0.35)";
  ctx.lineWidth = 1;
  ctx.stroke();
  if (p > 0.01) {
    ctx.save();
    rrPath(ctx, bx, by, Math.max(bw * p, bh), bh, bh / 2);
    ctx.clip();
    const grad = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    grad.addColorStop(0, "#ecca6f");
    grad.addColorStop(0.72, "#ecca6f");
    grad.addColorStop(1, "#ef4444");
    ctx.fillStyle = grad;
    ctx.fillRect(bx, by, bw, bh);
    ctx.restore();
  }
}

function drawAim(ctx: CanvasRenderingContext2D, view: View, s: GameState, inp: InputState) {
  const st = s.discs[0];
  if (!st.alive) return;
  const X = view.frame + st.x * view.field;
  const Y = view.frame + st.y * view.field;
  const R = st.r * view.field;
  const dx = inp.sx - inp.cx;
  const dy = inp.sy - inp.cy;
  const len = Math.hypot(dx, dy);
  const p = Math.min(len / POWER_FULL, 1);

  if (len > 0.004) {
    const ux = dx / len;
    const uy = dy / len;
    const aimLen = 0.3 + p * 0.85;
    const rayLen = Math.min(aimLen, castRay(s, st.x, st.y, ux, uy));

    // pull-back tail behind the striker
    const tail = Math.min(len, 0.16) * view.field;
    ctx.setLineDash([view.css * 0.012, view.css * 0.01]);
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = Math.max(1, view.css * 0.0022);
    ctx.beginPath();
    ctx.moveTo(X - ux * R * 1.2, Y - uy * R * 1.2);
    ctx.lineTo(X - ux * (R * 1.2 + tail), Y - uy * (R * 1.2 + tail));
    ctx.stroke();
    ctx.setLineDash([]);

    // dotted guide ray — shoot direction, opposite the drag
    for (let t = STRIKER_R + 0.03; t <= rayLen; t += 0.045) {
      const a = 0.75 * (1 - t / (rayLen + 0.25));
      ctx.fillStyle = `rgba(255,236,180,${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(X + ux * t * view.field, Y + uy * t * view.field, Math.max(1.5, view.css * 0.0055), 0, TAU);
      ctx.fill();
    }

    // terminal marker: contact ring on a disc/wall, otherwise an arrowhead
    const tx = X + ux * rayLen * view.field;
    const ty = Y + uy * rayLen * view.field;
    if (rayLen < aimLen - 1e-9) {
      ctx.strokeStyle = "rgba(255,255,255,0.45)";
      ctx.lineWidth = Math.max(1, view.css * 0.002);
      ctx.beginPath();
      ctx.arc(tx, ty, view.css * 0.012, 0, TAU);
      ctx.stroke();
    } else {
      const ang = Math.atan2(uy, ux);
      const ah = view.css * 0.016;
      ctx.strokeStyle = "rgba(255,236,180,0.85)";
      ctx.lineWidth = Math.max(1.5, view.css * 0.003);
      ctx.beginPath();
      ctx.moveTo(tx - Math.cos(ang - 0.5) * ah, ty - Math.sin(ang - 0.5) * ah);
      ctx.lineTo(tx, ty);
      ctx.lineTo(tx - Math.cos(ang + 0.5) * ah, ty - Math.sin(ang + 0.5) * ah);
      ctx.stroke();
    }

    // owner-coloured halo on the striker
    ctx.strokeStyle = s.turn === 0 ? "#ecca6f" : "#34d399";
    ctx.lineWidth = Math.max(1.5, R * 0.14);
    ctx.beginPath();
    ctx.arc(X, Y, R * 1.18, 0, TAU);
    ctx.stroke();
  }

  drawPowerMeter(ctx, view, p);
}

function drawPlace(ctx: CanvasRenderingContext2D, view: View, s: GameState, inp: InputState, now: number) {
  const st = s.discs[0];
  if (!st.alive) return;
  const baseY = BASE_Y[s.turn];
  const P = (w: number) => view.frame + w * view.field;
  const X = P(st.x);
  const Y = P(baseY);
  const R = st.r * view.field;

  // glowing baseline strip
  rrPath(ctx, P(STRIP_MIN - 0.03), P(baseY - 0.042), (STRIP_MAX - STRIP_MIN + 0.06) * view.field, 0.084 * view.field, view.css * 0.02);
  ctx.fillStyle = "rgba(233,201,107,0.1)";
  ctx.fill();
  ctx.strokeStyle = "rgba(233,201,107,0.35)";
  ctx.lineWidth = 1;
  ctx.stroke();

  // slide chevrons
  const gl = 0.55 + 0.45 * Math.sin(now / 200);
  ctx.strokeStyle = `rgba(255,244,214,${(0.3 + 0.35 * gl).toFixed(3)})`;
  ctx.lineWidth = Math.max(1.5, view.css * 0.003);
  for (const sgn of [-1, 1] as const) {
    const cx = X + sgn * R * 2.1;
    ctx.beginPath();
    ctx.moveTo(cx - sgn * view.css * 0.006, Y - view.css * 0.011);
    ctx.lineTo(cx + sgn * view.css * 0.004, Y);
    ctx.lineTo(cx - sgn * view.css * 0.006, Y + view.css * 0.011);
    ctx.stroke();
  }

  // striker halo — red while overlapping a coin (danger), owner colour otherwise
  ctx.strokeStyle = inp.overlap ? "#ef4444" : s.turn === 0 ? "#ecca6f" : "#34d399";
  ctx.lineWidth = Math.max(2, R * 0.16);
  ctx.beginPath();
  ctx.arc(X, Y, R * 1.2, 0, TAU);
  ctx.stroke();
}

function drawIdleHint(ctx: CanvasRenderingContext2D, view: View, s: GameState, now: number) {
  const st = s.discs[0];
  if (!st.alive) return;
  const baseY = BASE_Y[s.turn];
  const P = (w: number) => view.frame + w * view.field;
  const X = P(st.x);
  const Y = P(baseY);
  const R = st.r * view.field;
  const gl = 0.5 + 0.5 * Math.sin(now / 280);

  ctx.strokeStyle = `rgba(233,201,107,${(0.12 + 0.1 * gl).toFixed(3)})`;
  ctx.lineWidth = Math.max(2, view.css * 0.006);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(P(STRIP_MIN), P(baseY));
  ctx.lineTo(P(STRIP_MAX), P(baseY));
  ctx.stroke();

  ctx.strokeStyle = `rgba(233,201,107,${(0.25 + 0.3 * gl).toFixed(3)})`;
  ctx.lineWidth = Math.max(1.5, R * 0.12);
  ctx.beginPath();
  ctx.arc(X, Y, R * (1.28 + 0.1 * gl), 0, TAU);
  ctx.stroke();
}

function draw(
  ctx: CanvasRenderingContext2D,
  now: number,
  s: GameState,
  inp: InputState,
  view: View,
  stat: HTMLCanvasElement | null
) {
  if (view.css <= 0) return;
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.clearRect(0, 0, view.css, view.css);
  if (stat) ctx.drawImage(stat, 0, 0, view.css, view.css);

  drawFx(ctx, view, s);

  const P = (w: number) => view.frame + w * view.field;
  for (const d of s.discs) {
    if (!d.alive || d.kind === "striker") continue;
    drawDisc(ctx, d.kind, P(d.x), P(d.y), d.r * view.field, null);
  }
  const st = s.discs[0];
  if (st.alive) {
    drawDisc(ctx, "striker", P(st.x), P(st.y), st.r * view.field, s.turn === 0 ? "#ecca6f" : "#34d399");
  }

  if (s.phase === "aim") {
    if (inp.mode === "aim") drawAim(ctx, view, s, inp);
    else if (inp.mode === "place") drawPlace(ctx, view, s, inp, now);
    else drawIdleHint(ctx, view, s, now);
  }
}

/* ------------------------------------------------------------------ */
/* component                                                           */
/* ------------------------------------------------------------------ */

export function CarromGame(props: ArcadeGameProps) {
  const [scores, setScores] = useState<[number, number]>([0, 0]);
  const [turn, setTurn] = useState<0 | 1>(0);
  const [phase, setPhase] = useState<Phase>("aim");
  const [queenHeld, setQueenHeld] = useState<0 | 1 | null>(null);
  const [winner, setWinner] = useState<0 | 1 | null>(null);
  const [banner, setBanner] = useState<Banner | null>({
    id: 0,
    text: "Gold breaks — good luck",
    tone: "gold",
  });

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<GameState>(freshState());
  const sizeRef = useRef<View>({ css: 0, dpr: 1, frame: 0, field: 0 });
  const staticRef = useRef<HTMLCanvasElement | null>(null);
  const inputRef = useRef<InputState>({ ...IDLE_INPUT });
  const finishedRef = useRef(false);
  const namesRef = useRef<[string, string]>([props.players[0].name, props.players[1].name]);
  const onFinishRef = useRef(props.onFinish);

  // latest-ref pattern — the rAF loop always sees fresh props
  useEffect(() => {
    onFinishRef.current = props.onFinish;
    namesRef.current = [props.players[0].name, props.players[1].name];
  });

  /* — sizing + static board cache (DPR-crisp) — */
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const apply = () => {
      const rect = wrap.getBoundingClientRect();
      const css = Math.max(rect.width, 1);
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      canvas.width = Math.round(css * dpr);
      canvas.height = Math.round(css * dpr);
      const frame = css * FRAME_W;
      sizeRef.current = { css, dpr, frame, field: css - frame * 2 };
      staticRef.current = buildStatic(css, dpr);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  /* — the game loop (only place physics/render run) — */
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const hooks: SettleHooks = {
      getNames: () => namesRef.current,
      setScores,
      setTurn,
      setPhase,
      setQueenHeld,
      setBanner,
      onFinish: (r) => {
        if (finishedRef.current) return; // fire exactly once per match
        finishedRef.current = true;
        setWinner(r.winner);
        onFinishRef.current(r);
      },
    };

    let raf = 0;
    let last = performance.now();
    let acc = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const s = stateRef.current;

      if (s.phase === "shooting") {
        acc = Math.min(acc + dt, 0.062);
        let steps = 0;
        while (acc >= SUB_DT && steps < 16) {
          physicsStep(s, SUB_DT);
          acc -= SUB_DT;
          steps++;
        }
        if (acc >= SUB_DT) acc = 0; // shed load after a long stall
        if (now - s.shotStart > FORCE_STOP_MS) {
          for (const d of s.discs) {
            d.vx = 0;
            d.vy = 0;
          }
        }
        if (allAtRest(s)) {
          acc = 0;
          settleStrike(s, hooks);
        }
      }

      for (const f of s.fx) f.t += dt / 0.45;
      if (s.fx.length > 0 && s.fx.some((f) => f.t >= 1)) {
        s.fx = s.fx.filter((f) => f.t < 1);
      }

      const size = sizeRef.current;
      draw(
        ctx,
        now,
        s,
        inputRef.current,
        { css: size.css, dpr: size.dpr, frame: size.css * FRAME_W, field: size.css - size.css * FRAME_W * 2 },
        staticRef.current
      );
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  /* — banners fade themselves out — */
  useEffect(() => {
    if (!banner) return;
    const t = window.setTimeout(() => setBanner(null), 2800);
    return () => window.clearTimeout(t);
  }, [banner]);

  /* — pointer input — */
  const toWorld = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0.5, y: 0.5 };
    const rect = canvas.getBoundingClientRect();
    const css = rect.width || 1;
    const frame = css * FRAME_W;
    const field = css - frame * 2;
    return {
      x: (clientX - rect.left - frame) / field,
      y: (clientY - rect.top - frame) / field,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = stateRef.current;
    if (s.phase !== "aim" || inputRef.current.mode !== "none") return;
    const w = toWorld(e.clientX, e.clientY);
    const st = s.discs[0];
    if (!st.alive) return;
    const baseY = BASE_Y[s.turn];
    const nearStriker = Math.hypot(w.x - st.x, w.y - st.y) < Math.max(st.r * 2.6, 0.09);
    const onStrip =
      Math.abs(w.y - baseY) < 0.065 && w.x > STRIP_MIN - 0.06 && w.x < STRIP_MAX + 0.06;
    if (nearStriker || onStrip) {
      // placement drag — slide the striker along its baseline
      inputRef.current = {
        ...IDLE_INPUT,
        mode: "place",
        id: e.pointerId,
        grabX: w.x,
        startX: st.x,
        overlap: false,
      };
    } else {
      // aim drag — pool-style pull back anywhere on the board
      inputRef.current = { ...IDLE_INPUT, mode: "aim", id: e.pointerId, sx: w.x, sy: w.y, cx: w.x, cy: w.y };
      pulse("tick");
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* older mobile browsers — drag still works inside the canvas */
    }
    e.preventDefault();
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const inp = inputRef.current;
    if (inp.mode === "none" || e.pointerId !== inp.id) return;
    const s = stateRef.current;
    const w = toWorld(e.clientX, e.clientY);
    if (inp.mode === "place") {
      const st = s.discs[0];
      st.x = clamp(inp.startX + (w.x - inp.grabX), STRIP_MIN, STRIP_MAX);
      inp.overlap = overlapsCoins(s, st.x, BASE_Y[s.turn], STRIKER_R + 0.002);
    } else {
      inp.cx = w.x;
      inp.cy = w.y;
    }
    e.preventDefault();
  };

  const endPointer = (e: React.PointerEvent<HTMLCanvasElement>, allowShot: boolean) => {
    const inp = inputRef.current;
    if (inp.mode === "none" || e.pointerId !== inp.id) return;
    const s = stateRef.current;
    const st = s.discs[0];
    if (inp.mode === "place") {
      if (st.alive) st.x = freeStrikerX(s, st.x); // nudge free on placement
      inputRef.current = IDLE_INPUT;
      pulse("move");
      return;
    }
    inputRef.current = IDLE_INPUT;
    if (!allowShot || s.phase !== "aim" || !st.alive) return;
    const dx = inp.sx - inp.cx; // shoot opposite the drag
    const dy = inp.sy - inp.cy;
    const len = Math.hypot(dx, dy);
    if (len < MIN_DRAG) return; // a tap never fires
    const speed = Math.min(len / POWER_FULL, 1) * MAX_SPEED;
    st.vx = (dx / len) * speed;
    st.vy = (dy / len) * speed;
    s.phase = "shooting";
    s.shotStart = performance.now();
    s.pottedThisStrike = [];
    setPhase("shooting");
    pulse("capture");
  };

  const rematch = () => {
    pulse("achievement");
    stateRef.current = freshState();
    inputRef.current = IDLE_INPUT;
    finishedRef.current = false;
    setScores([0, 0]);
    setTurn(0);
    setPhase("aim");
    setQueenHeld(null);
    setWinner(null);
    setBanner({ id: nextBannerId(), text: "Rematch — Gold breaks", tone: "gold" });
  };

  const footer = (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-2 text-[10px] font-bold uppercase tracking-[0.16em] text-foreground/40">
      <span className="flex items-center gap-1.5">
        <MoveHorizontal className="h-3.5 w-3.5 text-gold-soft/70" aria-hidden="true" />
        Slide the striker
      </span>
      <span className="flex items-center gap-1.5">
        <Target className="h-3.5 w-3.5 text-gold-soft/70" aria-hidden="true" />
        Pull back to aim
      </span>
      <span className="flex items-center gap-1.5">
        <Crown className="h-3.5 w-3.5 text-gold-soft/70" aria-hidden="true" />
        Cover the queen
      </span>
    </div>
  );

  return (
    <GameFrame
      title={props.practice ? "Carrom · Practice" : "Carrom"}
      players={props.players}
      scores={[scores[0], scores[1]]}
      turn={phase === "over" ? null : turn}
      turnLabel={["Bottom baseline", "Top baseline"]}
      onExit={props.onExit}
      footer={footer}
    >
      <div
        ref={wrapRef}
        className="relative aspect-square w-[min(92vw,calc(100dvh-18rem))] select-none rounded-[22px] bg-gradient-to-b from-[#f3d887] via-[#c69c3f] to-[#8a6a24] p-[5px] shadow-[0_28px_80px_-28px_rgba(0,0,0,0.95),0_0_70px_-20px_rgba(212,175,55,0.5)]"
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Carrom board"
          className="h-full w-full touch-none rounded-[17px]"
          style={{ touchAction: "none" }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={(e) => endPointer(e, true)}
          onPointerCancel={(e) => endPointer(e, false)}
          onContextMenu={(e) => e.preventDefault()}
        />
        {/* inner bevel over the wood */}
        <div className="pointer-events-none absolute inset-[5px] rounded-[17px] shadow-[inset_0_2px_20px_rgba(0,0,0,0.55),inset_0_0_0_1px_rgba(0,0,0,0.5)]" />

        {/* turn / event banner */}
        <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center">
          <AnimatePresence>
            {banner && (
              <motion.div
                key={banner.id}
                initial={{ opacity: 0, y: -12, scale: 0.92 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                transition={{ type: "spring", stiffness: 420, damping: 32 }}
                className={cn(
                  "max-w-[94%] truncate whitespace-nowrap rounded-full border px-4 py-1.5 text-[11px] font-black uppercase tracking-[0.16em] shadow-lg backdrop-blur-md",
                  banner.tone === "gold" && "border-gold/50 bg-[#1a1206]/85 text-gold-soft",
                  banner.tone === "emerald" && "border-emerald-400/50 bg-[#06120c]/85 text-emerald-300",
                  banner.tone === "queen" && "border-[#ef4444]/50 bg-[#170808]/85 text-red-200",
                  banner.tone === "danger" && "border-red-400/50 bg-[#170808]/85 text-red-300"
                )}
              >
                {banner.text}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* persistent queen-held reminder */}
        {queenHeld !== null && phase !== "over" && (
          <div className="pointer-events-none absolute inset-x-0 top-14 z-10 flex justify-center">
            <span className="flex items-center gap-1.5 rounded-full border border-[#ef4444]/40 bg-black/70 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-red-200 backdrop-blur-sm">
              <Crown className="h-3.5 w-3.5 text-[#ef4444]" aria-hidden="true" />
              Queen held — cover her!
            </span>
          </div>
        )}

        {/* verdict */}
        {phase === "over" && winner !== null && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            className="absolute inset-x-4 bottom-4 z-30 flex flex-col items-center gap-2.5 rounded-2xl border border-gold/30 bg-black/80 p-4 backdrop-blur-md"
          >
            <p className="font-display text-lg font-black tracking-wide">
              <span className="text-gold-gradient">{props.players[winner].name} takes the board</span>
            </p>
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-foreground/50">
              {scores[0]} — {scores[1]}
            </p>
            <Button
              onClick={rematch}
              className="h-11 min-w-44 border border-[#8a6a24]/50 bg-gradient-to-b from-[#ecca6f] to-[#c69c3f] text-[13px] font-black text-[#241a05] shadow-[0_0_24px_-8px_rgba(212,175,55,0.7)] hover:from-[#f3d887]"
            >
              <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
              Rematch
            </Button>
          </motion.div>
        )}
      </div>
    </GameFrame>
  );
}

export default CarromGame;
