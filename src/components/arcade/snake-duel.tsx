"use client";

/**
 * Sovereign Chess — Snake Duel (arcade stake game).
 *
 * A score duel: both players run the SAME board — same seed, same food,
 * same 60 seconds — and the higher score takes the pot.
 *
 * FAIRNESS INVARIANT
 * ──────────────────
 * The match seed is generated ONCE per match (useRef) and handed to
 * `seededRandom(seed)` at the start of every run. The RNG stream is
 * consumed by food spawns ONLY — exactly one draw per food index, never
 * re-rolled based on snake state — so the Nth food always spawns at the
 * identical cell for both players, in identical order, no matter how
 * each of them steers. Golden foods land on the same indices too.
 *
 * Engine: the whole game loop lives in refs (rAF + accumulator). The
 * rAF callback pushes only score/time into React state (time throttled
 * to ~4/s); phase transitions are deferred through setTimeout so the
 * death flash can play. cancelAnimationFrame + clearTimeout on unmount.
 */

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  Apple,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Gamepad2,
  Hand,
  Play,
  RotateCcw,
  Sparkles,
  Swords,
  Timer,
  Trophy,
} from "lucide-react";
import type { ArcadeGameProps } from "@/lib/arcade-types";
import { GameFrame, PassDevice, seededRandom } from "@/components/arcade/kit";
import { pulse } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/* ---------------------------------------------------------------- */
/* types & constants                                                */
/* ---------------------------------------------------------------- */

interface Cell {
  x: number;
  y: number;
}

interface Particle {
  x: number;
  y: number;
  text: string;
  born: number;
  golden: boolean;
}

type DeathReason = "wall" | "self" | "time";

interface RunState {
  runner: 0 | 1;
  snake: Cell[]; // head first
  dir: Cell;
  queue: Cell[]; // pending turns, max 2, no 180°
  food: Cell;
  golden: boolean;
  foodIndex: number;
  score: number;
  eaten: number;
  stepMs: number;
  deadline: number;
  alive: boolean;
  deathAt: number;
  deathReason: DeathReason | null;
  particles: Particle[];
}

type Phase = "intro" | "run" | "interstitial" | "handoff" | "verdict" | "practice-over";

const GRID = 15;
const RUN_MS = 60_000;
const BASE_STEP_MS = 150;
const STEP_ACCEL = 4;
const MIN_STEP_MS = 90;
const SCORE_NORMAL = 10;
const SCORE_GOLDEN = 25;
const GOLDEN_EVERY = 5;
const SWIPE_PX = 24;
const INPUT_QUEUE_MAX = 2;
const TIME_TICK_MS = 250; // HUD time refresh ≈ 4/s
const DEATH_FLASH_MS = 700;
const PARTICLE_MS = 750;
const TAU = Math.PI * 2;

const DIRS: Record<"up" | "down" | "left" | "right", Cell> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const KEY_DIRS: Record<string, Cell> = {
  ArrowUp: DIRS.up,
  ArrowDown: DIRS.down,
  ArrowLeft: DIRS.left,
  ArrowRight: DIRS.right,
  w: DIRS.up,
  s: DIRS.down,
  a: DIRS.left,
  d: DIRS.right,
};

/** P0 gilds the board, P1 hunts in emerald. */
const RUNNER_THEME: Record<0 | 1, { head: string; tail: string; glow: string }> = {
  0: { head: "#ecca6f", tail: "#c69c3f", glow: "rgba(236,202,111,0.55)" },
  1: { head: "#34d399", tail: "#10b981", glow: "rgba(52,211,153,0.50)" },
};

/* ---------------------------------------------------------------- */
/* canvas helpers (module-level — no React state involved)          */
/* ---------------------------------------------------------------- */

function genSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}

/**
 * Food #N for a run. ONE rng() draw per food index — see the fairness
 * invariant in the header. A food may land under the snake body; it
 * simply waits there until the snake vacates the cell (identical for
 * both players, so fairness holds).
 */
function nextFood(rng: () => number, index: number): { cell: Cell; golden: boolean } {
  const k = Math.floor(rng() * GRID * GRID);
  return { cell: { x: k % GRID, y: Math.floor(k / GRID) }, golden: index % GOLDEN_EVERY === GOLDEN_EVERY - 1 };
}

/** Rounded-rect path (avoids relying on ctx.roundRect availability). */
function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function parseHex(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Four-point sparkle star. */
function star4(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, rot: number, color: string) {
  ctx.beginPath();
  for (let k = 0; k < 8; k++) {
    const ang = rot + (k * Math.PI) / 4;
    const rad = k % 2 === 0 ? radius : radius * 0.36;
    const px = cx + Math.cos(ang) * rad;
    const py = cy + Math.sin(ang) * rad;
    if (k === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawFood(ctx: CanvasRenderingContext2D, r: RunState, now: number, cell: number) {
  const f = r.food;
  const golden = r.golden;
  const cx = f.x * cell + cell / 2;
  const cy = f.y * cell + cell / 2;
  const pulse = 0.5 + 0.5 * Math.sin(now / 260 + f.x * 2.1 + f.y * 1.3);
  const base = cell * (golden ? 0.4 : 0.285) * (1 + 0.08 * pulse);

  if (golden) {
    ctx.save();
    ctx.shadowColor = "rgba(255,214,74,0.9)";
    ctx.shadowBlur = cell * 0.9;
    ctx.strokeStyle = `rgba(255,214,74,${(0.28 + 0.22 * pulse).toFixed(3)})`;
    ctx.lineWidth = Math.max(1.2, cell * 0.05);
    ctx.beginPath();
    ctx.arc(cx, cy, base * 1.55, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  // glossy gold apple
  const g = ctx.createRadialGradient(cx - base * 0.35, cy - base * 0.42, base * 0.12, cx, cy, base);
  g.addColorStop(0, golden ? "#fff3bd" : "#ffedb0");
  g.addColorStop(0.55, golden ? "#f3d264" : "#ecc95f");
  g.addColorStop(1, golden ? "#c9901d" : "#bd8d2a");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, base, 0, TAU);
  ctx.fill();

  // specular gloss
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.beginPath();
  ctx.ellipse(cx - base * 0.34, cy - base * 0.42, base * 0.26, base * 0.15, -0.7, 0, TAU);
  ctx.fill();

  // stem + leaf
  ctx.strokeStyle = "#8a6a24";
  ctx.lineWidth = Math.max(1.4, cell * 0.055);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx, cy - base * 0.85);
  ctx.quadraticCurveTo(cx + base * 0.1, cy - base * 1.25, cx + base * 0.34, cy - base * 1.32);
  ctx.stroke();
  ctx.fillStyle = "rgba(52,211,153,0.95)";
  ctx.beginPath();
  ctx.ellipse(cx + base * 0.62, cy - base * 1.18, base * 0.26, base * 0.12, -0.5, 0, TAU);
  ctx.fill();

  if (golden) star4(ctx, cx + base * 1.05, cy - base * 1.05, cell * 0.16 * (0.75 + 0.45 * pulse), now / 520, "#fff6cf");
}

function drawSnake(ctx: CanvasRenderingContext2D, r: RunState, cell: number) {
  const theme = RUNNER_THEME[r.runner];
  const A = parseHex(theme.head);
  const B = parseHex(theme.tail);
  const n = r.snake.length;

  // tail → head so the head sits on top with its glow
  for (let i = n - 1; i >= 0; i--) {
    const s = r.snake[i];
    const t = n <= 1 ? 0 : i / (n - 1);
    const pad = cell * (i === 0 ? 0.05 : 0.1 + 0.08 * t);
    const x = s.x * cell + pad;
    const y = s.y * cell + pad;
    const w = cell - pad * 2;
    const cr = Math.round(A[0] + (B[0] - A[0]) * t);
    const cg = Math.round(A[1] + (B[1] - A[1]) * t);
    const cb = Math.round(A[2] + (B[2] - A[2]) * t);
    ctx.save();
    ctx.shadowColor = theme.glow;
    ctx.shadowBlur = i === 0 ? cell * 0.65 : cell * 0.28;
    ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
    rr(ctx, x, y, w, w, w * 0.34);
    ctx.fill();
    ctx.restore();
  }

  // eyes facing movement direction
  const h = r.snake[0];
  const d = r.dir;
  const cx = h.x * cell + cell / 2 + d.x * cell * 0.18;
  const cy = h.y * cell + cell / 2 + d.y * cell * 0.18;
  const px = -d.y;
  const py = d.x;
  const spread = cell * 0.16;
  const er = cell * 0.085;
  ctx.fillStyle = "rgba(12,10,4,0.85)";
  for (const sign of [1, -1]) {
    ctx.beginPath();
    ctx.arc(cx + px * spread * sign, cy + py * spread * sign, er, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  for (const sign of [1, -1]) {
    ctx.beginPath();
    ctx.arc(cx + px * spread * sign - er * 0.3, cy + py * spread * sign - er * 0.3, er * 0.32, 0, TAU);
    ctx.fill();
  }
}

function drawParticles(ctx: CanvasRenderingContext2D, r: RunState, now: number, cell: number) {
  for (let i = r.particles.length - 1; i >= 0; i--) {
    const p = r.particles[i];
    const age = (now - p.born) / PARTICLE_MS;
    if (age >= 1) {
      r.particles.splice(i, 1);
      continue;
    }
    ctx.save();
    ctx.globalAlpha = 1 - age;
    ctx.font = `800 ${Math.round(cell * (p.golden ? 0.62 : 0.5))}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = p.golden ? "rgba(255,214,74,0.9)" : "rgba(236,202,111,0.7)";
    ctx.shadowBlur = cell * 0.4;
    ctx.fillStyle = p.golden ? "#ffdf7e" : "#f0d585";
    ctx.fillText(p.text, p.x * cell + cell / 2, p.y * cell + cell / 2 - age * cell * 1.1);
    ctx.restore();
  }
}

/* ---------------------------------------------------------------- */
/* small UI pieces                                                  */
/* ---------------------------------------------------------------- */

function RuleRow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 text-[12px] leading-snug text-foreground/70">
      <span className="mt-0.5 shrink-0 text-gold-soft" aria-hidden="true">
        {icon}
      </span>
      <span>{children}</span>
    </div>
  );
}

function DPad({ onDir }: { onDir: (d: Cell) => void }) {
  const btn =
    "grid h-12 w-full select-none place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-gold-soft transition-colors active:border-gold/60 active:bg-gold/20";
  const press = (d: Cell) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    onDir(d);
  };
  return (
    <div className="mt-3 grid w-[min(92vw,14rem)] shrink-0 grid-cols-3 gap-1.5" style={{ touchAction: "none" }}>
      <span />
      <button type="button" aria-label="Move up" className={btn} onPointerDown={press(DIRS.up)}>
        <ChevronUp className="h-6 w-6" />
      </button>
      <span />
      <button type="button" aria-label="Move left" className={btn} onPointerDown={press(DIRS.left)}>
        <ChevronLeft className="h-6 w-6" />
      </button>
      <button type="button" aria-label="Move down" className={btn} onPointerDown={press(DIRS.down)}>
        <ChevronDown className="h-6 w-6" />
      </button>
      <button type="button" aria-label="Move right" className={btn} onPointerDown={press(DIRS.right)}>
        <ChevronRight className="h-6 w-6" />
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* the game                                                         */
/* ---------------------------------------------------------------- */

export function SnakeDuelGame({ players, practice, onFinish, onExit }: ArcadeGameProps) {
  const [phase, setPhase] = useState<Phase>("intro");
  const [runner, setRunner] = useState<0 | 1>(0);
  const [liveScore, setLiveScore] = useState(0);
  const [finalScores, setFinalScores] = useState<[number | null, number | null]>([null, null]);
  const [timeLeft, setTimeLeft] = useState(RUN_MS);
  const [seedLabel, setSeedLabel] = useState("—");

  /* --- engine refs (never trigger renders) ---------------------- */
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const sizeRef = useRef(0);
  const seedRef = useRef<number | null>(null); // created ONCE per match
  const rngRef = useRef<(() => number) | null>(null);
  const runRef = useRef<RunState | null>(null);
  const phaseRef = useRef<Phase>("intro");
  const rafRef = useRef(0);
  const endTimerRef = useRef<number | null>(null);
  const timeUiRef = useRef(0);
  const finishedRef = useRef(false); // onFinish EXACTLY once
  const dragRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const onFinishRef = useRef(onFinish);
  const finalScoresRef = useRef<[number | null, number | null]>([null, null]);

  useEffect(() => {
    onFinishRef.current = onFinish;
  });

  const goto = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  const putFinal = useCallback((fs: [number | null, number | null]) => {
    finalScoresRef.current = fs;
    setFinalScores(fs);
  }, []);

  /* --- match seed: created once, shown in the HUD badge ---------- */
  useEffect(() => {
    if (seedRef.current === null) seedRef.current = genSeed();
    setSeedLabel(seedRef.current.toString(36).toUpperCase());
  }, []);

  /* --- input queue (max 2, no 180°, no duplicates) --------------- */
  const pushDir = useCallback((d: Cell) => {
    const r = runRef.current;
    if (!r || !r.alive || phaseRef.current !== "run") return;
    const last = r.queue.length > 0 ? r.queue[r.queue.length - 1] : r.dir;
    if (d.x === last.x && d.y === last.y) return; // same heading
    if (d.x === -last.x && d.y === -last.y) return; // 180° reversal
    if (r.queue.length >= INPUT_QUEUE_MAX) return;
    r.queue.push(d);
    pulse("move");
  }, []);

  /* --- run lifecycle --------------------------------------------- */
  const startRun = useCallback(
    (index: 0 | 1) => {
      if (endTimerRef.current !== null) {
        window.clearTimeout(endTimerRef.current);
        endTimerRef.current = null;
      }
      if (seedRef.current === null) seedRef.current = genSeed();
      const rng = seededRandom(seedRef.current); // SAME seed for every run
      rngRef.current = rng;
      const first = nextFood(rng, 0);
      runRef.current = {
        runner: index,
        snake: [
          { x: 7, y: 7 },
          { x: 6, y: 7 },
          { x: 5, y: 7 },
        ],
        dir: { x: 1, y: 0 },
        queue: [],
        food: first.cell,
        golden: first.golden,
        foodIndex: 0,
        score: 0,
        eaten: 0,
        stepMs: BASE_STEP_MS,
        deadline: performance.now() + RUN_MS,
        alive: true,
        deathAt: 0,
        deathReason: null,
        particles: [],
      };
      timeUiRef.current = 0;
      if (index === 0) putFinal([null, null]);
      setRunner(index);
      setLiveScore(0);
      setTimeLeft(RUN_MS);
      goto("run");
    },
    [goto, putFinal]
  );

  const startMatch = useCallback(() => {
    pulse("select");
    startRun(0);
  }, [startRun]);

  const finishRun = useCallback(() => {
    if (endTimerRef.current !== null) {
      window.clearTimeout(endTimerRef.current);
      endTimerRef.current = null;
    }
    const r = runRef.current;
    if (!r) return;
    if (practice) {
      putFinal([r.score, 0]);
      goto("practice-over");
      if (!finishedRef.current) {
        finishedRef.current = true;
        onFinishRef.current({ winner: null, scores: [r.score, 0], note: "Practice complete" });
      }
      return;
    }
    if (r.runner === 0) {
      putFinal([r.score, finalScoresRef.current[1]]);
      goto("interstitial");
      return;
    }
    const s0 = finalScoresRef.current[0] ?? 0;
    const winner: 0 | 1 | null = r.score > s0 ? 1 : r.score < s0 ? 0 : null;
    putFinal([s0, r.score]);
    goto("verdict");
    pulse(winner === null ? "draw" : "win");
    if (!finishedRef.current) {
      finishedRef.current = true;
      onFinishRef.current({ winner, scores: [s0, r.score], note: "Best run wins" });
    }
  }, [goto, practice, putFinal]);

  const scheduleEnd = useCallback(
    (delay: number) => {
      if (endTimerRef.current !== null) return;
      endTimerRef.current = window.setTimeout(() => {
        endTimerRef.current = null;
        finishRun();
      }, delay);
    },
    [finishRun]
  );

  /* --- DPR-crisp canvas sizing ----------------------------------- */
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    ctxRef.current = canvas.getContext("2d");
    const apply = (cssSize: number) => {
      if (cssSize <= 0) return;
      sizeRef.current = cssSize;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      canvas.width = Math.round(cssSize * dpr);
      canvas.height = Math.round(cssSize * dpr);
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctxRef.current = ctx;
      }
    };
    apply(wrap.clientWidth);
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) apply(entry.contentRect.width);
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  /* --- the game loop (refs only; score/time are the only state) --- */
  useEffect(() => {
    const die = (now: number, reason: "wall" | "self") => {
      const r = runRef.current;
      if (!r || !r.alive) return;
      r.alive = false;
      r.deathReason = reason;
      r.deathAt = now;
      pulse("illegal");
      scheduleEnd(DEATH_FLASH_MS + 120);
    };

    const step = (now: number) => {
      const r = runRef.current;
      const rng = rngRef.current;
      if (!r || !r.alive || !rng) return;
      const nextTurn = r.queue.shift();
      if (nextTurn) r.dir = nextTurn;
      const head = r.snake[0];
      const nx = head.x + r.dir.x;
      const ny = head.y + r.dir.y;
      if (nx < 0 || nx >= GRID || ny < 0 || ny >= GRID) {
        die(now, "wall");
        return;
      }
      const eating = nx === r.food.x && ny === r.food.y;
      const bodyLen = eating ? r.snake.length : r.snake.length - 1; // tail vacates unless growing
      for (let i = 0; i < bodyLen; i++) {
        const s = r.snake[i];
        if (s.x === nx && s.y === ny) {
          die(now, "self");
          return;
        }
      }
      r.snake.unshift({ x: nx, y: ny });
      if (eating) {
        r.eaten += 1;
        const pts = r.golden ? SCORE_GOLDEN : SCORE_NORMAL;
        r.score += pts;
        r.stepMs = Math.max(MIN_STEP_MS, BASE_STEP_MS - STEP_ACCEL * r.eaten);
        r.particles.push({ x: r.food.x, y: r.food.y, text: `+${pts}`, born: now, golden: r.golden });
        pulse("capture");
        setLiveScore(r.score); // score — the allowed state write from the loop
        const nextIndex = r.foodIndex + 1;
        const nf = nextFood(rng, nextIndex); // exactly one rng() draw per food
        r.foodIndex = nextIndex;
        r.food = nf.cell;
        r.golden = nf.golden;
      } else {
        r.snake.pop();
      }
    };

    const draw = (now: number) => {
      const ctx = ctxRef.current;
      const size = sizeRef.current;
      if (!ctx || size <= 0) return;
      const cell = size / GRID;

      ctx.clearRect(0, 0, size, size);
      const bg = ctx.createRadialGradient(size / 2, size * 0.42, size * 0.08, size / 2, size / 2, size * 0.78);
      bg.addColorStop(0, "#12141b");
      bg.addColorStop(1, "#090a0e");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, size, size);

      // ultra-subtle grid
      ctx.strokeStyle = "rgba(255,255,255,0.04)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 1; i < GRID; i++) {
        const p = Math.round(i * cell) + 0.5;
        ctx.moveTo(p, 0);
        ctx.lineTo(p, size);
        ctx.moveTo(0, p);
        ctx.lineTo(size, p);
      }
      ctx.stroke();

      const r = runRef.current;
      if (r) {
        drawFood(ctx, r, now, cell);
        drawSnake(ctx, r, cell);
        drawParticles(ctx, r, now, cell);
        if (!r.alive && r.deathReason !== "time") {
          const t = (now - r.deathAt) / DEATH_FLASH_MS;
          if (t < 1) {
            ctx.fillStyle = `rgba(239,68,68,${(0.3 * (1 - t)).toFixed(3)})`;
            ctx.fillRect(0, 0, size, size);
          }
        }
      }

      // gilded frame
      ctx.strokeStyle = "rgba(212,175,55,0.18)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(0.75, 0.75, size - 1.5, size - 1.5);
    };

    let last = performance.now();
    let acc = 0;

    const frame = (now: number) => {
      rafRef.current = requestAnimationFrame(frame);
      const dt = Math.min(now - last, 250);
      last = now;
      const r = runRef.current;
      if (r && r.alive && phaseRef.current === "run") {
        const left = r.deadline - now;
        if (left <= 0) {
          r.alive = false;
          r.deathReason = "time";
          r.deathAt = now;
          setTimeLeft(0);
          scheduleEnd(450);
        } else {
          if (now - timeUiRef.current >= TIME_TICK_MS) {
            timeUiRef.current = now;
            setTimeLeft(left); // time — throttled to ~4/s
          }
          acc += dt;
          while (acc >= r.stepMs) {
            acc -= r.stepMs;
            step(now);
            if (!r.alive) {
              acc = 0;
              break;
            }
          }
        }
      } else {
        acc = 0;
      }
      draw(now);
    };

    rafRef.current = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(rafRef.current);
      if (endTimerRef.current !== null) window.clearTimeout(endTimerRef.current);
    };
  }, [scheduleEnd]);

  /* --- keyboard: arrows / WASD (+ Enter to start) ----------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const dir = KEY_DIRS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
      if (dir) {
        e.preventDefault();
        pushDir(dir);
        return;
      }
      if ((e.key === "Enter" || e.key === " ") && phaseRef.current === "intro") {
        e.preventDefault();
        startMatch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pushDir, startMatch]);

  /* --- swipe on the board (dominant axis wins, chained turns) ----- */
  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const st = dragRef.current;
    if (!st || st.id !== e.pointerId) return;
    const dx = e.clientX - st.x;
    const dy = e.clientY - st.y;
    if (Math.abs(dx) < SWIPE_PX && Math.abs(dy) < SWIPE_PX) return;
    if (Math.abs(dx) >= Math.abs(dy)) pushDir({ x: dx > 0 ? 1 : -1, y: 0 });
    else pushDir({ x: 0, y: dy > 0 ? 1 : -1 });
    dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY }; // chain the next turn
  };
  const endDrag = () => {
    dragRef.current = null;
  };

  /* --- HUD wiring -------------------------------------------------- */
  const scoreFor = (i: 0 | 1): ReactNode => {
    if (practice && i === 1) return "—";
    const f = finalScores[i];
    if (f !== null) return f;
    if (phase === "run" && runner === i) return liveScore;
    return "—";
  };

  const turnLabel: [string, string] = practice
    ? phase === "run"
      ? ["Playing now", "—"]
      : phase === "practice-over"
        ? ["Final", "—"]
        : ["Solo run", "—"]
    : phase === "intro"
      ? ["Runs first", "Runs second"]
      : phase === "run"
        ? runner === 0
          ? ["Playing now", "Up next"]
          : ["Sealed", "Playing now"]
        : phase === "interstitial" || phase === "handoff"
          ? ["Run sealed", "Get ready"]
          : ["Final", "Final"];

  const pct = Math.max(0, Math.min(100, (timeLeft / RUN_MS) * 100));
  const totalSecs = Math.max(0, Math.ceil(timeLeft / 1000));
  const clock = `${Math.floor(totalSecs / 60)}:${String(totalSecs % 60).padStart(2, "0")}`;
  const danger = phase === "run" && timeLeft <= 10_000;

  const s0 = finalScores[0] ?? 0;
  const s1 = finalScores[1] ?? 0;
  const winner: 0 | 1 | null = s0 > s1 ? 0 : s1 > s0 ? 1 : null;

  const goldBtn =
    "border border-[#8a6a24]/50 bg-gradient-to-b from-[#ecca6f] to-[#c69c3f] text-[15px] font-black text-[#241a05] shadow-[0_0_30px_-8px_rgba(212,175,55,0.7)] hover:from-[#f3d887]";

  return (
    <GameFrame
      title="Snake Duel"
      players={players}
      scores={[scoreFor(0), scoreFor(1)]}
      turn={phase === "run" ? runner : null}
      turnLabel={turnLabel}
      onExit={onExit}
      footer={
        <div className="flex w-[min(92vw,calc(100dvh-17rem))] flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <Timer className="h-3.5 w-3.5 shrink-0 text-gold-soft/80" aria-hidden="true" />
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-300 ease-linear",
                  danger ? "bg-gradient-to-r from-red-500 to-red-300" : "bg-gradient-to-r from-[#c69c3f] to-[#ecca6f]"
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span
              className={cn(
                "w-10 shrink-0 text-right font-mono text-[11px] font-black tabular-nums",
                danger ? "text-red-300" : "text-gold-soft"
              )}
            >
              {clock}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 text-[9.5px] font-bold uppercase tracking-[0.14em] text-foreground/40">
            <span
              className="shrink-0 rounded-md border border-gold/25 bg-gold/10 px-1.5 py-0.5 font-mono tracking-normal text-gold-soft"
              title="Same seed · same food · pure skill"
            >
              Seed {seedLabel}
            </span>
            <span className="truncate">Swipe · D-pad · Arrows / WASD</span>
          </div>
        </div>
      }
    >
      {/* board */}
      <div
        ref={wrapRef}
        className="relative aspect-square w-[min(92vw,calc(100dvh-17rem))] shrink-0 select-none"
        style={{ touchAction: "none" }}
      >
        <canvas
          ref={canvasRef}
          className="block h-full w-full rounded-2xl border border-white/10 bg-black/40 shadow-[0_0_60px_-24px_rgba(212,175,55,0.5)]"
          style={{ touchAction: "none" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />
      </div>

      {phase === "run" && <DPad onDir={pushDir} />}

      {/* intro — rules card */}
      {phase === "intro" && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 px-5 backdrop-blur-md">
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)]">
            <p className="text-center text-[10px] font-black uppercase tracking-[0.3em] text-foreground/40">
              Sovereign Arcade
            </p>
            <h4 className="font-display mt-1 text-center text-3xl font-black text-gold-gradient">Snake Duel</h4>

            <div className="mt-4 space-y-2.5">
              <RuleRow icon={<Gamepad2 className="h-4 w-4" />}>
                Swipe the board, tap the D-pad, or use Arrow keys / WASD.
              </RuleRow>
              <RuleRow icon={<Apple className="h-4 w-4" />}>
                +10 per apple — every 5th is <b className="text-gold-soft">golden</b> and worth +25.
              </RuleRow>
              <RuleRow icon={<Timer className="h-4 w-4" />}>
                60 seconds or a crash ends your run. Every apple makes you faster.
              </RuleRow>
              <RuleRow icon={<Swords className="h-4 w-4" />}>
                Both players face the identical board — higher score takes it.
              </RuleRow>
            </div>

            <div className="mt-4 flex items-center justify-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/30 bg-gold/10 px-3 py-1 text-[9.5px] font-black uppercase tracking-[0.14em] text-gold-soft">
                <Sparkles className="h-3 w-3" aria-hidden="true" />
                Same seed · same food · pure skill
              </span>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 font-mono text-[10px] font-bold text-foreground/50">
                #{seedLabel}
              </span>
            </div>

            <Button onClick={startMatch} className={cn("mt-4 h-14 w-full", goldBtn)}>
              <Play className="mr-1.5 h-5 w-5" />
              {practice ? "Start practice run" : `${players[0].name} runs first`}
            </Button>
            {!practice && (
              <p className="mt-2.5 text-center text-[10.5px] text-foreground/45">
                Then {players[1].name} plays the identical board.
              </p>
            )}
          </div>
        </div>
      )}

      {/* interstitial — run 1 sealed, big score */}
      {phase === "interstitial" && (
        <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-4 bg-black/90 px-6 text-center backdrop-blur-md">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground/40">Run 1 sealed</p>
          <p className="font-display text-7xl font-black leading-none tabular-nums text-gold-gradient">
            {finalScores[0] ?? 0}
          </p>
          <p className="text-[13px] text-foreground/60">
            <b className="text-foreground/90">{players[0].name}</b> set the mark — {players[1].name} must beat it
          </p>
          <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-gold-soft">
            <Sparkles className="h-3 w-3" aria-hidden="true" />
            Same seed · same food · pure skill
          </p>
          <Button
            onClick={() => {
              pulse("tick");
              goto("handoff");
            }}
            className={cn("mt-2 h-14 min-w-64", goldBtn)}
          >
            <Hand className="mr-1.5 h-5 w-5" />
            Pass the device
          </Button>
        </div>
      )}

      {/* hand-off ceremony (countdown lives inside PassDevice) */}
      {phase === "handoff" && (
        <PassDevice
          from={players[0]}
          to={players[1]}
          note={`Beat ${finalScores[0] ?? 0} points — the food sequence is identical.`}
          onReady={() => startRun(1)}
        />
      )}

      {/* verdict */}
      {phase === "verdict" && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 px-6 backdrop-blur-md">
          <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-white/[0.03] p-6 text-center shadow-[0_40px_100px_-20px_rgba(0,0,0,0.95)]">
            <Trophy className="mx-auto h-10 w-10 text-gold-soft" aria-hidden="true" />
            <p className="mt-2 text-[10px] font-black uppercase tracking-[0.3em] text-foreground/40">Final verdict</p>
            <h4 className="font-display mt-1 text-3xl font-black text-gold-gradient">
              {winner === null ? "Dead heat" : `${players[winner].name} takes it`}
            </h4>
            <div className="mt-5 flex gap-2">
              <div
                className={cn(
                  "flex-1 rounded-2xl border p-3",
                  winner === 0
                    ? "border-gold/60 bg-gold/10 shadow-[0_0_26px_-8px_rgba(212,175,55,0.8)]"
                    : "border-white/10 bg-white/[0.03]"
                )}
              >
                <span className="text-xl" aria-hidden="true">
                  {players[0].emoji}
                </span>
                <p className="mt-1 font-mono text-2xl font-black tabular-nums text-gold-soft">{s0}</p>
                <p className="truncate px-1 text-[9px] font-black uppercase tracking-[0.16em] text-foreground/40">
                  {players[0].name}
                </p>
              </div>
              <div
                className={cn(
                  "flex-1 rounded-2xl border p-3",
                  winner === 1
                    ? "border-emerald-400/60 bg-emerald-400/10 shadow-[0_0_26px_-8px_rgba(52,211,153,0.8)]"
                    : "border-white/10 bg-white/[0.03]"
                )}
              >
                <span className="text-xl" aria-hidden="true">
                  {players[1].emoji}
                </span>
                <p className="mt-1 font-mono text-2xl font-black tabular-nums text-emerald-300">{s1}</p>
                <p className="truncate px-1 text-[9px] font-black uppercase tracking-[0.16em] text-foreground/40">
                  {players[1].name}
                </p>
              </div>
            </div>
            <p className="mt-4 text-[10px] font-black uppercase tracking-[0.2em] text-foreground/40">Best run wins</p>
          </div>
        </div>
      )}

      {/* practice over — solo ceremony */}
      {phase === "practice-over" && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 px-6 backdrop-blur-md">
          <div className="w-full max-w-xs rounded-3xl border border-white/10 bg-white/[0.03] p-6 text-center">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground/40">Practice over</p>
            <p className="font-display mt-1 text-6xl font-black tabular-nums text-gold-gradient">
              {finalScores[0] ?? 0}
            </p>
            <p className="mt-2 text-[12px] leading-snug text-foreground/55">
              Same seed, same food — run it again and beat your mark.
            </p>
            <Button onClick={startMatch} className={cn("mt-5 h-13 w-full text-[14px]", goldBtn)}>
              <RotateCcw className="mr-1.5 h-4.5 w-4.5" />
              Run it again
            </Button>
          </div>
        </div>
      )}
    </GameFrame>
  );
}

export default SnakeDuelGame;
