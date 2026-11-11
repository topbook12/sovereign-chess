"use client";

/**
 * Sovereign Arcade — SNAKE.
 *
 * A full canvas game engine with real-game graphics:
 *  - buttery 60fps rendering with sub-cell interpolation (no jerky steps)
 *  - a snake that looks alive: gradient scaled body, belly highlight,
 *    animated eyes that track the travel direction and a flicking tongue
 *    that reaches out when food is near
 *  - SIX pro skins (Emerald, Royal Gold, Crimson, Amethyst, Venom, Onyx)
 *    — each repaints the whole world: body, head, eyes, tongue, scales,
 *    glow, death burst AND the playground itself (board tint, checker,
 *    halo, vignette, frame) — changed live from the Dressing Room
 *  - four playground sizes (Cozy / Classic / Grand / Epic), grid density
 *    from 13 to 28 cells along the short edge, applied live, persisted
 *  - pulsing apples + timed golden apples (50 pts, lose them if slow)
 *  - particle bursts, floating score text, screen shake, death explosion
 *  - swipe / D-pad / keyboard controls, auto-pause on tab blur
 *  - best score + games played persisted locally, synth SFX + haptics
 *
 * Everything is drawn procedurally — zero image assets, fully offline.
 */

import { AnimatePresence, motion } from "framer-motion";
import {
  Apple,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  House,
  Palette,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Trophy,
  Worm,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { pulse } from "@/lib/haptics";
import { playSound, primeAudio } from "@/lib/sounds";
import { cn } from "@/lib/utils";

/* ----------------------------- types & constants ---------------------------- */

type Cell = { x: number; y: number };
type Vec = Cell;
type Status = "idle" | "playing" | "paused" | "dying" | "over";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  grav: number;
  rot: number;
  vr: number;
  square: boolean;
}

interface Floater {
  x: number;
  y: number;
  text: string;
  life: number;
  max: number;
  color: string;
  size: number;
}

interface Food {
  x: number;
  y: number;
  golden: boolean;
  born: number;
  ttl: number;
}

const UP: Vec = { x: 0, y: -1 };
const DOWN: Vec = { x: 0, y: 1 };
const LEFT: Vec = { x: -1, y: 0 };
const RIGHT: Vec = { x: 1, y: 0 };

const BASE_STEP = 150; // ms per move at level 1
const MIN_STEP = 72; // fastest the game ever gets
const STEP_DECAY = 2.4; // ms shaved per apple
const GOLDEN_CHANCE = 0.18; // probability an apple is golden
const GOLDEN_TTL = 7000; // ms before a golden apple expires

const BEST_KEY = "sovereign.snake.best";
const GAMES_KEY = "sovereign.snake.games";
const SKIN_KEY = "sovereign.snake.skin";
const SIZE_KEY = "sovereign.snake.size";

/* ------------------------------- snake skins ------------------------------- */

interface Skin {
  id: string;
  name: string;
  /** head → mid → tail body gradient */
  body: [string, string, string];
  /** head radial gradient */
  head: [string, string, string];
  outline: string;
  belly: string;
  scale: string;
  glow: string;
  eye: string;
  pupil: string;
  tongue: string;
  burst: string[];
  /** playground ambience — each skin repaints the whole world */
  board: string;
  checker: string;
  halo: string;
  vignette: string;
  frame: string;
  shadow: string;
}

const SKINS: Skin[] = [
  {
    id: "emerald",
    name: "Emerald",
    body: ["#4ade80", "#22c55e", "#15803d"],
    head: ["#86efac", "#34d399", "#059669"],
    outline: "rgba(3,26,17,0.92)",
    belly: "rgba(209,250,229,0.2)",
    scale: "rgba(5,46,32,0.38)",
    glow: "rgba(52,211,153,0.45)",
    eye: "#f8fafc",
    pupil: "#0f172a",
    tongue: "#fb7185",
    burst: ["#34d399", "#10b981", "#065f46", "#a7f3d0"],
    board: "#06100b",
    checker: "rgba(255,255,255,0.026)",
    halo: "rgba(52,211,153,0.075)",
    vignette: "rgba(0,0,0,0.5)",
    frame: "rgba(52,211,153,0.35)",
    shadow: "rgba(16,185,129,0.5)",
  },
  {
    id: "gold",
    name: "Royal Gold",
    body: ["#fde68a", "#f59e0b", "#92400e"],
    head: ["#fef3c7", "#fbbf24", "#b45309"],
    outline: "rgba(41,26,3,0.92)",
    belly: "rgba(255,251,235,0.25)",
    scale: "rgba(120,53,15,0.4)",
    glow: "rgba(251,191,36,0.5)",
    eye: "#fffbeb",
    pupil: "#291a03",
    tongue: "#f87171",
    burst: ["#fde047", "#fbbf24", "#b45309", "#fff7d6"],
    board: "#0d0a03",
    checker: "rgba(255,236,180,0.03)",
    halo: "rgba(251,191,36,0.08)",
    vignette: "rgba(18,10,0,0.55)",
    frame: "rgba(212,175,55,0.55)",
    shadow: "rgba(212,175,55,0.6)",
  },
  {
    id: "ruby",
    name: "Crimson",
    body: ["#fca5a5", "#ef4444", "#7f1d1d"],
    head: ["#fecaca", "#f87171", "#991b1b"],
    outline: "rgba(30,3,3,0.92)",
    belly: "rgba(255,228,230,0.22)",
    scale: "rgba(127,29,29,0.42)",
    glow: "rgba(248,113,113,0.45)",
    eye: "#fff1f2",
    pupil: "#1f0505",
    tongue: "#fb923c",
    burst: ["#f87171", "#ef4444", "#7f1d1d", "#fecaca"],
    board: "#0d0404",
    checker: "rgba(255,220,220,0.028)",
    halo: "rgba(248,113,113,0.07)",
    vignette: "rgba(20,0,0,0.55)",
    frame: "rgba(248,113,113,0.4)",
    shadow: "rgba(239,68,68,0.5)",
  },
  {
    id: "amethyst",
    name: "Amethyst",
    body: ["#e9d5ff", "#c084fc", "#6b21a8"],
    head: ["#f3e8ff", "#d8b4fe", "#7e22ce"],
    outline: "rgba(20,3,26,0.92)",
    belly: "rgba(250,240,255,0.22)",
    scale: "rgba(88,28,135,0.4)",
    glow: "rgba(192,132,252,0.45)",
    eye: "#fdf4ff",
    pupil: "#1e0526",
    tongue: "#f472b6",
    burst: ["#d8b4fe", "#c084fc", "#7e22ce", "#f5d0fe"],
    board: "#0a040d",
    checker: "rgba(240,220,255,0.028)",
    halo: "rgba(192,132,252,0.075)",
    vignette: "rgba(16,0,24,0.55)",
    frame: "rgba(192,132,252,0.4)",
    shadow: "rgba(192,132,252,0.5)",
  },
  {
    id: "venom",
    name: "Venom",
    body: ["#d9f99d", "#a3e635", "#3f6212"],
    head: ["#ecfccb", "#bef264", "#4d7c0f"],
    outline: "rgba(12,20,2,0.92)",
    belly: "rgba(247,255,214,0.25)",
    scale: "rgba(63,98,18,0.42)",
    glow: "rgba(163,230,53,0.5)",
    eye: "#f7fee7",
    pupil: "#101a01",
    tongue: "#f43f5e",
    burst: ["#bef264", "#a3e635", "#4d7c0f", "#ecfccb"],
    board: "#070c02",
    checker: "rgba(230,255,190,0.03)",
    halo: "rgba(163,230,53,0.08)",
    vignette: "rgba(10,16,0,0.55)",
    frame: "rgba(163,230,53,0.4)",
    shadow: "rgba(132,204,22,0.5)",
  },
  {
    id: "onyx",
    name: "Onyx",
    body: ["#e2e8f0", "#94a3b8", "#1e293b"],
    head: ["#f8fafc", "#cbd5e1", "#475569"],
    outline: "rgba(2,6,12,0.92)",
    belly: "rgba(255,255,255,0.28)",
    scale: "rgba(15,23,42,0.45)",
    glow: "rgba(226,232,240,0.4)",
    eye: "#ffffff",
    pupil: "#020617",
    tongue: "#f43f5e",
    burst: ["#f8fafc", "#cbd5e1", "#64748b", "#e2e8f0"],
    board: "#05070a",
    checker: "rgba(255,255,255,0.03)",
    halo: "rgba(226,232,240,0.06)",
    vignette: "rgba(0,0,0,0.6)",
    frame: "rgba(226,232,240,0.32)",
    shadow: "rgba(148,163,184,0.45)",
  },
];

/* ----------------------------- playground sizes ---------------------------- */

interface SizePreset {
  id: string;
  name: string;
  /** target grid count along the shorter edge */
  cells: number;
  note: string;
}

const SIZES: SizePreset[] = [
  { id: "cozy", name: "Cozy", cells: 13, note: "Big cells · chill" },
  { id: "classic", name: "Classic", cells: 17, note: "The real deal" },
  { id: "grand", name: "Grand", cells: 22, note: "Long snakes" },
  { id: "epic", name: "Epic", cells: 28, note: "Pro · tiny cells" },
];

/* ----------------------- skin preview (dressing room) ---------------------- */

function SkinPreview({ skin, size = 44 }: { skin: Skin; size?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(size * dpr);
    c.height = Math.round(size * dpr);
    const g = c.getContext("2d");
    if (!g) return;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, size, size);
    g.fillStyle = skin.board;
    g.fillRect(0, 0, size, size);
    g.fillStyle = skin.checker;
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        if ((x + y) % 2 === 0)
          g.fillRect((x * size) / 4, (y * size) / 4, size / 4, size / 4);
      }
    }
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < 6; i++) {
      const t = i / 5;
      pts.push({
        x: size * (0.84 - t * 0.6),
        y: size * (0.45 + Math.sin(t * Math.PI * 1.7) * 0.19),
      });
    }
    g.lineCap = "round";
    g.lineJoin = "round";
    const trace = () => {
      g.beginPath();
      g.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) / 2;
        const my = (pts[i].y + pts[i + 1].y) / 2;
        g.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
      }
      g.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    };
    g.strokeStyle = skin.outline;
    g.lineWidth = size * 0.2;
    trace();
    g.stroke();
    const grd = g.createLinearGradient(
      pts[0].x,
      pts[0].y,
      pts[pts.length - 1].x,
      pts[pts.length - 1].y
    );
    grd.addColorStop(0, skin.body[0]);
    grd.addColorStop(0.55, skin.body[1]);
    grd.addColorStop(1, skin.body[2]);
    g.save();
    g.shadowColor = skin.glow;
    g.shadowBlur = size * 0.16;
    g.strokeStyle = grd;
    g.lineWidth = size * 0.15;
    trace();
    g.stroke();
    g.restore();
    g.strokeStyle = skin.belly;
    g.lineWidth = size * 0.055;
    trace();
    g.stroke();
    const h = pts[0];
    const ang = Math.atan2(h.y - pts[1].y, h.x - pts[1].x);
    g.save();
    g.translate(h.x, h.y);
    g.rotate(ang);
    const hg = g.createRadialGradient(
      -size * 0.02,
      -size * 0.02,
      size * 0.01,
      0,
      0,
      size * 0.13
    );
    hg.addColorStop(0, skin.head[0]);
    hg.addColorStop(0.6, skin.head[1]);
    hg.addColorStop(1, skin.head[2]);
    g.fillStyle = hg;
    g.beginPath();
    g.ellipse(0, 0, size * 0.125, size * 0.1, 0, 0, Math.PI * 2);
    g.fill();
    for (const sy of [-1, 1]) {
      g.fillStyle = skin.eye;
      g.beginPath();
      g.ellipse(size * 0.02, sy * size * 0.048, size * 0.026, size * 0.032, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = skin.pupil;
      g.beginPath();
      g.arc(size * 0.034, sy * size * 0.048, size * 0.014, 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = skin.tongue;
    g.lineWidth = Math.max(1, size * 0.02);
    g.beginPath();
    g.moveTo(size * 0.12, 0);
    g.lineTo(size * 0.19, 0);
    g.stroke();
    g.restore();
  }, [skin, size]);
  return (
    <canvas
      ref={ref}
      style={{ width: size, height: size }}
      aria-hidden="true"
      className="rounded-lg"
    />
  );
}

/* ------------------------------- particle fx -------------------------------- */

function spawnBurst(
  arr: Particle[],
  x: number,
  y: number,
  o: {
    count: number;
    colors: string[];
    speed: number;
    life: number;
    size: number;
    grav?: number;
    square?: boolean;
  }
) {
  for (let i = 0; i < o.count; i++) {
    if (arr.length > 240) arr.shift();
    const a = Math.random() * Math.PI * 2;
    const sp = o.speed * (0.35 + Math.random() * 0.85);
    const life = o.life * (0.6 + Math.random() * 0.6);
    arr.push({
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - o.speed * 0.25,
      life,
      max: life,
      size: o.size * (0.6 + Math.random() * 0.8),
      color: o.colors[(Math.random() * o.colors.length) | 0],
      grav: o.grav ?? 0.045,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      square: o.square ?? Math.random() < 0.4,
    });
  }
}

/* -------------------------------- component --------------------------------- */

export function SnakeView() {
  /* ---- reactive HUD state ---- */
  const [status, setStatus] = useState<Status>("idle");
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [level, setLevel] = useState(1);
  const [apples, setApples] = useState(0);
  const [games, setGames] = useState(0);
  const [len, setLen] = useState(0);
  const [newBest, setNewBest] = useState(false);
  const [won, setWon] = useState(false);
  const [showPad, setShowPad] = useState(false);
  const [skinId, setSkinId] = useState(SKINS[0].id);
  const [sizeId, setSizeId] = useState(SIZES[1].id);
  const [dims, setDims] = useState({ cols: 17, rows: 17 });
  const [showStyle, setShowStyle] = useState(false);
  const skin = SKINS.find((k) => k.id === skinId) ?? SKINS[0];

  /* ---- engine refs (mutated at 60fps, never re-render) ---- */
  const statusRef = useRef<Status>("idle");
  const areaRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bgRef = useRef<HTMLCanvasElement | null>(null);
  const gridRef = useRef({ cols: 17, rows: 17 });
  const prevDimsRef = useRef({ cols: 0, rows: 0 });
  const cellRef = useRef(24);
  const dprRef = useRef(1);
  const snakeRef = useRef<Cell[]>([]);
  const prevRef = useRef<Cell[]>([]);
  const dirRef = useRef<Vec>(RIGHT);
  const queueRef = useRef<Vec[]>([]);
  const growRef = useRef(0);
  const foodRef = useRef<Food | null>(null);
  const applesRef = useRef(0);
  const stepRef = useRef(BASE_STEP);
  const accRef = useRef(0);
  const levelRef = useRef(1);
  const scoreRef = useRef(0);
  const bestRef = useRef(0);
  const gamesRef = useRef(0);
  const bestFlagRef = useRef(false);
  const partsRef = useRef<Particle[]>([]);
  const floatsRef = useRef<Floater[]>([]);
  const shakeRef = useRef(0);
  const flashRef = useRef(0);
  const deathAtRef = useRef(0);
  const deathQueueRef = useRef<Cell[]>([]);
  const deathTickRef = useRef(0);
  const headAngRef = useRef(0);
  const wonRef = useRef(false);
  const lastTsRef = useRef(0);

  const applyStatus = useCallback((s: Status) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  /* ---- dressing-room refs (skin + playground size) ---- */
  const skinRef = useRef<Skin>(SKINS[0]);
  const sizeRef = useRef<SizePreset>(SIZES[1]);
  const showStyleRef = useRef(false);

  /* ---- food ---- */
  const spawnFood = useCallback(
    (golden?: boolean) => {
      const { cols, rows } = gridRef.current;
      const s = snakeRef.current;
      const free: Cell[] = [];
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          if (!s.some((p) => p.x === x && p.y === y)) free.push({ x, y });
        }
      }
      if (!free.length) {
        // the snake filled the entire board — legendary
        wonRef.current = true;
        const cell = cellRef.current;
        const h = s[0];
        if (h) {
          spawnBurst(partsRef.current, (h.x + 0.5) * cell, (h.y + 0.5) * cell, {
            count: 60,
            colors: ["#fde047", "#fbbf24", "#fff7d6", skinRef.current.body[0]],
            speed: 4.5,
            life: 1100,
            size: 3,
          });
        }
        finishGame(true);
        return;
      }
      const c = free[(Math.random() * free.length) | 0];
      foodRef.current = {
        x: c.x,
        y: c.y,
        golden: golden ?? Math.random() < GOLDEN_CHANCE,
        born: performance.now(),
        ttl: GOLDEN_TTL,
      };
    },
    []
  );

  /* ---- game over / win ---- */
  const finishGame = useCallback(
    (win: boolean) => {
      const sc = scoreRef.current;
      const nb = sc > bestRef.current && sc > 0;
      if (nb) {
        bestRef.current = sc;
        try {
          window.localStorage.setItem(BEST_KEY, String(sc));
        } catch {
          /* session-only */
        }
      }
      const g = gamesRef.current + 1;
      gamesRef.current = g;
      try {
        window.localStorage.setItem(GAMES_KEY, String(g));
      } catch {
        /* session-only */
      }
      bestFlagRef.current = false;
      accRef.current = stepRef.current; // freeze interpolation at rest
      setBest(bestRef.current);
      setGames(g);
      setNewBest(nb);
      setWon(win);
      setLen(snakeRef.current.length);
      applyStatus("over");
      playSound(win || nb ? "win" : "lose");
    },
    [applyStatus]
  );

  /* ---- reset to a fresh board ---- */
  const resetGame = useCallback(() => {
    const { cols, rows } = gridRef.current;
    const cx = Math.floor(cols / 2);
    const cy = Math.floor(rows / 2);
    const bodyLen = Math.min(4, Math.max(3, Math.floor(cols / 4)));
    const body: Cell[] = [];
    for (let i = 0; i < bodyLen; i++) body.push({ x: cx - i, y: cy });
    snakeRef.current = body;
    prevRef.current = body.map((p) => ({ ...p }));
    dirRef.current = RIGHT;
    queueRef.current = [];
    growRef.current = 0;
    applesRef.current = 0;
    scoreRef.current = 0;
    stepRef.current = BASE_STEP;
    levelRef.current = 1;
    accRef.current = 0;
    partsRef.current = [];
    floatsRef.current = [];
    shakeRef.current = 0;
    flashRef.current = 0;
    bestFlagRef.current = false;
    wonRef.current = false;
    headAngRef.current = 0;
    setScore(0);
    setApples(0);
    setLevel(1);
    setNewBest(false);
    setWon(false);
    spawnFood();
  }, [spawnFood]);

  /* ---- responsive board fitting ---- */
  const fit = useCallback(() => {
    const area = areaRef.current;
    const cvs = canvasRef.current;
    if (!area || !cvs) return;
    const w = area.clientWidth - 18;
    const h = area.clientHeight - 18;
    if (w < 60 || h < 60) return;
    const st = statusRef.current;
    if (st === "idle" || st === "over") {
      const cells = Math.max(10, Math.min(32, sizeRef.current.cells));
      const target = Math.max(13, Math.floor(Math.min(w, h) / cells));
      const cols = Math.max(10, Math.min(64, Math.floor(w / target)));
      const rows = Math.max(10, Math.min(40, Math.floor(h / target)));
      if (cols !== prevDimsRef.current.cols || rows !== prevDimsRef.current.rows) {
        prevDimsRef.current = { cols, rows };
        gridRef.current = { cols, rows };
        setDims({ cols, rows });
        if (st === "idle" && snakeRef.current.length) {
          resetGame();
        } else if (st === "over") {
          // board is behind the stats overlay — empty it cleanly
          snakeRef.current = [];
          prevRef.current = [];
          foodRef.current = null;
          partsRef.current = [];
          floatsRef.current = [];
        }
      }
    }
    const { cols, rows } = gridRef.current;
    const cell = Math.min(w / cols, h / rows);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cellRef.current = cell;
    dprRef.current = dpr;
    cvs.width = Math.round(cols * cell * dpr);
    cvs.height = Math.round(rows * cell * dpr);
    cvs.style.width = `${cols * cell}px`;
    cvs.style.height = `${rows * cell}px`;

    // pre-render the backdrop (checker + vignette) once per size
    const bg = document.createElement("canvas");
    bg.width = cvs.width;
    bg.height = cvs.height;
    const g = bg.getContext("2d");
    if (g) {
      g.scale(dpr, dpr);
      const W = cols * cell;
      const H = rows * cell;
      g.fillStyle = skinRef.current.board;
      g.fillRect(0, 0, W, H);
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          if ((x + y) % 2 === 0) {
            g.fillStyle = skinRef.current.checker;
            g.fillRect(x * cell, y * cell, cell + 0.5, cell + 0.5);
          }
        }
      }
      const halo = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.min(W, H) * 0.6);
      halo.addColorStop(0, skinRef.current.halo);
      halo.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = halo;
      g.fillRect(0, 0, W, H);
      const vg = g.createRadialGradient(
        W / 2,
        H / 2,
        Math.min(W, H) * 0.28,
        W / 2,
        H / 2,
        Math.max(W, H) * 0.72
      );
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(1, skinRef.current.vignette);
      g.fillStyle = vg;
      g.fillRect(0, 0, W, H);
    }
    bgRef.current = bg;
  }, [resetGame]);

  /* ---- eating ---- */
  const eat = useCallback(
    (f: Food) => {
      const cell = cellRef.current;
      const cx = (f.x + 0.5) * cell;
      const cy = (f.y + 0.5) * cell;
      const gain = f.golden ? 50 : 10;
      scoreRef.current += gain;
      growRef.current += f.golden ? 2 : 1;
      applesRef.current += 1;
      stepRef.current = Math.max(MIN_STEP, BASE_STEP - applesRef.current * STEP_DECAY);
      const nl = Math.min(12, 1 + Math.floor(applesRef.current / 5));
      const leveled = nl > levelRef.current;
      levelRef.current = nl;

      spawnBurst(
        partsRef.current,
        cx,
        cy,
        f.golden
          ? { count: 26, colors: ["#fde047", "#fbbf24", "#fff7d6"], speed: 3.4, life: 700, size: 2.6 }
          : {
              count: 16,
              colors: ["#f87171", "#fca5a5", "#fecaca", skinRef.current.body[0]],
              speed: 2.6,
              life: 550,
              size: 2.2,
            }
      );
      floatsRef.current.push({
        x: cx,
        y: cy,
        text: `+${gain}`,
        life: 900,
        max: 900,
        color: f.golden ? "#fde047" : "#d9f99d",
        size: cell * (f.golden ? 0.72 : 0.58),
      });
      if (
        !bestFlagRef.current &&
        bestRef.current > 0 &&
        scoreRef.current > bestRef.current
      ) {
        bestFlagRef.current = true;
        floatsRef.current.push({
          x: cx,
          y: cy - cell,
          text: "NEW BEST!",
          life: 1200,
          max: 1200,
          color: "#fde047",
          size: cell * 0.5,
        });
        playSound("achievement");
      } else if (leveled) {
        floatsRef.current.push({
          x: cx,
          y: cy - cell,
          text: "SPEED UP",
          life: 1100,
          max: 1100,
          color: "#fbbf24",
          size: cell * 0.44,
        });
        playSound("levelup");
      } else {
        playSound(f.golden ? "achievement" : "capture");
      }
      shakeRef.current = Math.max(shakeRef.current, f.golden ? 7 : 3);
      setScore(scoreRef.current);
      setApples(applesRef.current);
      setLevel(nl);
      spawnFood();
    },
    [spawnFood]
  );

  /* ---- death ---- */
  const die = useCallback(() => {
    applyStatus("dying");
    deathAtRef.current = performance.now();
    deathTickRef.current = 0;
    deathQueueRef.current = snakeRef.current.map((p) => ({ ...p }));
    shakeRef.current = 11;
    flashRef.current = 1;
  }, [applyStatus]);

  /* ---- one logic step ---- */
  const step = useCallback(() => {
    const s = snakeRef.current;
    // consume the input queue (skip reversals / duplicates)
    while (queueRef.current.length) {
      const d = queueRef.current.shift()!;
      const cur = dirRef.current;
      if (d.x === -cur.x && d.y === -cur.y) continue;
      if (d.x !== cur.x || d.y !== cur.y) dirRef.current = d;
      break;
    }
    prevRef.current = s.map((p) => ({ ...p }));
    const { cols, rows } = gridRef.current;
    const nx = s[0].x + dirRef.current.x;
    const ny = s[0].y + dirRef.current.y;
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
      die();
      return;
    }
    const willGrow = growRef.current > 0;
    const check = willGrow ? s : s.slice(0, s.length - 1);
    for (const p of check) {
      if (p.x === nx && p.y === ny) {
        die();
        return;
      }
    }
    s.unshift({ x: nx, y: ny });
    if (willGrow) growRef.current--;
    else s.pop();
    const f = foodRef.current;
    if (f && f.x === nx && f.y === ny) eat(f);
  }, [die, eat]);

  /* ---- death animation (staggered body pops) ---- */
  const updateDeath = useCallback(
    (ts: number) => {
      const cell = cellRef.current;
      deathTickRef.current += 1;
      if (deathTickRef.current % 2 === 0) {
        const c = deathQueueRef.current.shift();
        if (c) {
          spawnBurst(partsRef.current, (c.x + 0.5) * cell, (c.y + 0.5) * cell, {
            count: 7,
            colors: skinRef.current.burst,
            speed: 2.4,
            life: 620,
            size: 2.4,
            grav: 0.02,
          });
        }
      }
      if (!deathQueueRef.current.length && ts - deathAtRef.current > 950) {
        finishGame(wonRef.current);
      }
    },
    [finishGame]
  );

  /* ---- fx integration ---- */
  const updateFx = useCallback((dt: number) => {
    const k = dt / 16.7;
    const parts = partsRef.current;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.x += p.vx * k;
      p.y += p.vy * k;
      p.vy += p.grav * k;
      p.rot += p.vr * k;
      p.life -= dt;
      if (p.life <= 0) parts.splice(i, 1);
    }
    const fl = floatsRef.current;
    for (let i = fl.length - 1; i >= 0; i--) {
      const f = fl[i];
      f.y -= 0.035 * cellRef.current * k;
      f.life -= dt;
      if (f.life <= 0) fl.splice(i, 1);
    }
    if (shakeRef.current > 0.05) shakeRef.current *= Math.pow(0.86, k);
    else shakeRef.current = 0;
    if (flashRef.current > 0.01) flashRef.current *= Math.pow(0.93, k);
    else flashRef.current = 0;
  }, []);

  /* ------------------------------- draw passes ------------------------------- */

  const drawFood = useCallback((ctx: CanvasRenderingContext2D, ts: number) => {
    const f = foodRef.current;
    if (!f) return;
    const cell = cellRef.current;
    const cx = (f.x + 0.5) * cell;
    const cy = (f.y + 0.5) * cell;
    const pul = 1 + Math.sin(ts / 260) * 0.06;
    const r = cell * 0.33 * pul;
    ctx.save();
    ctx.shadowColor = f.golden ? "rgba(251,191,36,0.85)" : "rgba(239,68,68,0.7)";
    ctx.shadowBlur = cell * (f.golden ? 1.1 : 0.8);
    const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.15, cx, cy, r);
    if (f.golden) {
      g.addColorStop(0, "#fef3c7");
      g.addColorStop(0.5, "#fbbf24");
      g.addColorStop(1, "#b45309");
    } else {
      g.addColorStop(0, "#fda4af");
      g.addColorStop(0.5, "#ef4444");
      g.addColorStop(1, "#991b1b");
    }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy + r * 0.06, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    // shine
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.35, cy - r * 0.35, r * 0.22, r * 0.13, -0.7, 0, Math.PI * 2);
    ctx.fill();
    // stem
    ctx.strokeStyle = "#7c4a21";
    ctx.lineWidth = Math.max(1.4, cell * 0.06);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.85);
    ctx.lineTo(cx + r * 0.12, cy - r * 1.25);
    ctx.stroke();
    // leaf
    ctx.fillStyle = "#4ade80";
    ctx.save();
    ctx.translate(cx + r * 0.32, cy - r * 1.18);
    ctx.rotate(-0.5);
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.32, r * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    if (f.golden) {
      // expiry ring
      const rem = Math.max(0, 1 - (ts - f.born) / f.ttl);
      ctx.strokeStyle =
        rem > 0.3
          ? "rgba(253,224,71,0.95)"
          : Math.floor(ts / 120) % 2
            ? "rgba(248,113,113,0.95)"
            : "rgba(253,224,71,0.55)";
      ctx.lineWidth = Math.max(2, cell * 0.085);
      ctx.beginPath();
      ctx.arc(cx, cy, cell * 0.52, -Math.PI / 2, -Math.PI / 2 + rem * Math.PI * 2);
      ctx.stroke();
      // rotating sparkle
      ctx.save();
      ctx.translate(cx + cell * 0.36, cy - cell * 0.38);
      ctx.rotate(ts / 700);
      ctx.fillStyle = "rgba(255,247,214,0.95)";
      const s = cell * 0.1;
      ctx.beginPath();
      ctx.moveTo(0, -s * 2);
      ctx.lineTo(s * 0.5, -s * 0.5);
      ctx.lineTo(s * 2, 0);
      ctx.lineTo(s * 0.5, s * 0.5);
      ctx.lineTo(0, s * 2);
      ctx.lineTo(-s * 0.5, s * 0.5);
      ctx.lineTo(-s * 2, 0);
      ctx.lineTo(-s * 0.5, -s * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }, []);

  const drawSnake = useCallback((ctx: CanvasRenderingContext2D, ts: number) => {
    const s = snakeRef.current;
    if (!s.length) return;
    const cell = cellRef.current;
    const old = prevRef.current;
    const t = Math.min(1, accRef.current / stepRef.current);
    const pts = s.map((p, i) => {
      const o = old[Math.min(i, old.length - 1)] ?? p;
      return {
        x: (o.x + (p.x - o.x) * t + 0.5) * cell,
        y: (o.y + (p.y - o.y) * t + 0.5) * cell,
      };
    });

    // smooth the head angle toward the travel direction
    let targetAng = Math.atan2(dirRef.current.y, dirRef.current.x);
    if (pts.length > 1) {
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      if (dx * dx + dy * dy > 1) targetAng = Math.atan2(dy, dx);
    }
    let diff = targetAng - headAngRef.current;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    headAngRef.current += diff * 0.35;
    const ang = headAngRef.current;

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const tracePath = () => {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      if (pts.length === 2) {
        ctx.lineTo(pts[1].x, pts[1].y);
      } else {
        for (let i = 1; i < pts.length - 1; i++) {
          const mx = (pts[i].x + pts[i + 1].x) / 2;
          const my = (pts[i].y + pts[i + 1].y) / 2;
          ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
        }
        ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
      }
    };

    // dark under-body outline
    ctx.strokeStyle = skinRef.current.outline;
    ctx.lineWidth = cell * 0.84;
    tracePath();
    ctx.stroke();

    // glowing gradient body
    const tail = pts[pts.length - 1];
    const grd = ctx.createLinearGradient(pts[0].x, pts[0].y, tail.x, tail.y);
    grd.addColorStop(0, skinRef.current.body[0]);
    grd.addColorStop(0.55, skinRef.current.body[1]);
    grd.addColorStop(1, skinRef.current.body[2]);
    ctx.save();
    ctx.shadowColor = skinRef.current.glow;
    ctx.shadowBlur = cell * 0.55;
    ctx.strokeStyle = grd;
    ctx.lineWidth = cell * 0.68;
    tracePath();
    ctx.stroke();
    ctx.restore();

    // belly highlight
    ctx.strokeStyle = skinRef.current.belly;
    ctx.lineWidth = cell * 0.26;
    tracePath();
    ctx.stroke();

    // scale diamonds along the spine
    ctx.fillStyle = skinRef.current.scale;
    for (let i = 2; i < pts.length - 1; i += 2) {
      const p = pts[i];
      const q = pts[i - 1];
      const a = Math.atan2(p.y - q.y, p.x - q.x) + Math.PI / 2;
      const r = cell * 0.15;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(r, 0);
      ctx.lineTo(0, r);
      ctx.lineTo(-r, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    /* ---- head ---- */
    const h = pts[0];
    ctx.save();
    ctx.translate(h.x, h.y);
    ctx.rotate(ang);
    ctx.shadowColor = skinRef.current.glow;
    ctx.shadowBlur = cell * 0.6;
    const hg = ctx.createRadialGradient(-cell * 0.08, -cell * 0.1, cell * 0.05, 0, 0, cell * 0.52);
    hg.addColorStop(0, skinRef.current.head[0]);
    hg.addColorStop(0.6, skinRef.current.head[1]);
    hg.addColorStop(1, skinRef.current.head[2]);
    ctx.fillStyle = hg;
    ctx.beginPath();
    ctx.ellipse(0, 0, cell * 0.5, cell * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    // snout ridge
    ctx.fillStyle = "rgba(6,78,59,0.35)";
    ctx.beginPath();
    ctx.ellipse(cell * 0.22, 0, cell * 0.16, cell * 0.24, 0, 0, Math.PI * 2);
    ctx.fill();
    // eyes
    for (const sy of [-1, 1]) {
      ctx.fillStyle = skinRef.current.eye;
      ctx.beginPath();
      ctx.ellipse(cell * 0.1, sy * cell * 0.2, cell * 0.12, cell * 0.14, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = skinRef.current.pupil;
      ctx.beginPath();
      ctx.arc(cell * 0.14, sy * cell * 0.2, cell * 0.058, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.beginPath();
      ctx.arc(cell * 0.11, sy * cell * 0.16, cell * 0.02, 0, Math.PI * 2);
      ctx.fill();
    }
    // flicking tongue — reaches for nearby food
    const f = foodRef.current;
    let ext = 0;
    const cyc = (ts % 1700) / 1700;
    if (cyc < 0.16) ext = Math.sin((cyc / 0.16) * Math.PI);
    if (f) {
      const fx = (f.x + 0.5) * cell - h.x;
      const fy = (f.y + 0.5) * cell - h.y;
      const fd = Math.hypot(fx, fy) / cell;
      const ahead = fd > 0.01 ? (fx * Math.cos(ang) + fy * Math.sin(ang)) / (fd * cell) : 0;
      if (fd < 4.5 && ahead * cell > 0.5) ext = Math.max(ext, 0.85);
    }
    const st = statusRef.current;
    if (ext > 0.02 && st !== "over" && st !== "dying") {
      const tLen = cell * 0.6 * ext;
      ctx.strokeStyle = skinRef.current.tongue;
      ctx.lineWidth = Math.max(1.6, cell * 0.07);
      ctx.beginPath();
      ctx.moveTo(cell * 0.45, 0);
      ctx.lineTo(cell * 0.45 + tLen, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cell * 0.45 + tLen, 0);
      ctx.lineTo(cell * 0.45 + tLen + cell * 0.14, -cell * 0.1);
      ctx.moveTo(cell * 0.45 + tLen, 0);
      ctx.lineTo(cell * 0.45 + tLen + cell * 0.14, cell * 0.1);
      ctx.stroke();
    }
    ctx.restore();
  }, []);

  const drawParticles = useCallback((ctx: CanvasRenderingContext2D) => {
    const parts = partsRef.current;
    if (!parts.length) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const p of parts) {
      const a = Math.max(0, p.life / p.max);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      if (p.square) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillRect(-p.size, -p.size, p.size * 2, p.size * 2);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.4 + 0.6 * a), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }, []);

  const drawFloaters = useCallback((ctx: CanvasRenderingContext2D) => {
    const fl = floatsRef.current;
    if (!fl.length) return;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const f of fl) {
      const a = Math.max(0, f.life / f.max);
      ctx.globalAlpha = a < 0.85 ? a / 0.85 : 1;
      ctx.font = `900 ${f.size}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
      ctx.lineWidth = Math.max(2, f.size * 0.14);
      ctx.strokeStyle = "rgba(0,0,0,0.65)";
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.restore();
  }, []);

  const render = useCallback(
    (ts: number, ctx: CanvasRenderingContext2D, cvs: HTMLCanvasElement) => {
      const { cols, rows } = gridRef.current;
      const cell = cellRef.current;
      const dpr = dprRef.current;
      const W = cols * cell;
      const H = rows * cell;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      // screen shake at the element level (no inner gaps)
      const sh = shakeRef.current;
      cvs.style.transform =
        sh > 0.05
          ? `translate(${((Math.random() - 0.5) * sh).toFixed(2)}px, ${((Math.random() - 0.5) * sh).toFixed(2)}px)`
          : "";
      const bg = bgRef.current;
      if (bg) ctx.drawImage(bg, 0, 0, W, H);
      drawFood(ctx, ts);
      drawSnake(ctx, ts);
      drawParticles(ctx);
      drawFloaters(ctx);
      if (flashRef.current > 0.01) {
        ctx.fillStyle = `rgba(239,68,68,${(flashRef.current * 0.28).toFixed(3)})`;
        ctx.fillRect(0, 0, W, H);
      }
    },
    [drawFood, drawSnake, drawParticles, drawFloaters]
  );

  /* ------------------------------ the game loop ------------------------------ */

  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(64, ts - (lastTsRef.current || ts));
      lastTsRef.current = ts;
      const area = areaRef.current;
      if (!area || area.clientWidth < 60 || area.clientHeight < 60) return;
      const st = statusRef.current;
      if (st === "playing") {
        accRef.current += dt;
        let guard = 0;
        while (
          accRef.current >= stepRef.current &&
          statusRef.current === "playing" &&
          guard++ < 8
        ) {
          accRef.current -= stepRef.current;
          step();
        }
        // golden apples rot away
        const f = foodRef.current;
        if (f && f.golden && performance.now() - f.born > f.ttl) {
          const cell = cellRef.current;
          spawnBurst(partsRef.current, (f.x + 0.5) * cell, (f.y + 0.5) * cell, {
            count: 10,
            colors: ["#92400e", "#78350f", "#a16207"],
            speed: 1.6,
            life: 400,
            size: 1.8,
          });
          spawnFood(false);
        }
      } else if (st === "dying") {
        updateDeath(ts);
      }
      updateFx(dt);
      render(ts, ctx, cvs);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [step, updateDeath, updateFx, render, spawnFood]);

  /* --------------------------- controls & lifecycle -------------------------- */

  const queueDir = useCallback((d: Vec) => {
    const st = statusRef.current;
    if (st !== "playing" && st !== "idle") return;
    const q = queueRef.current;
    const last = q.length ? q[q.length - 1] : dirRef.current;
    if (d.x === last.x && d.y === last.y) return;
    if (d.x === -last.x && d.y === -last.y) return;
    if (q.length < 3) q.push(d);
  }, []);

  const start = useCallback(() => {
    primeAudio();
    prevDimsRef.current = { cols: 0, rows: 0 }; // re-apply the chosen playground every fresh run
    fit();
    resetGame();
    applyStatus("playing");
    playSound("achievement");
  }, [applyStatus, fit, resetGame]);

  const togglePause = useCallback(() => {
    const st = statusRef.current;
    if (st === "playing") {
      applyStatus("paused");
      playSound("select");
    } else if (st === "paused") {
      applyStatus("playing");
      playSound("select");
    }
  }, [applyStatus]);

  const goMenu = useCallback(() => {
    prevDimsRef.current = { cols: 0, rows: 0 };
    fit();
    resetGame();
    applyStatus("idle");
    playSound("select");
  }, [applyStatus, fit, resetGame]);

  /* ---- dressing room: skins & playground size ---- */

  const openStyle = useCallback(() => {
    if (statusRef.current === "playing") applyStatus("paused");
    showStyleRef.current = true;
    setShowStyle(true);
    pulse("tick");
    playSound("select");
  }, [applyStatus]);

  const closeStyle = useCallback(() => {
    showStyleRef.current = false;
    setShowStyle(false);
    playSound("select");
  }, []);

  const pickSkin = useCallback(
    (id: string) => {
      const s = SKINS.find((k) => k.id === id);
      if (!s || skinRef.current.id === s.id) return;
      skinRef.current = s;
      setSkinId(s.id);
      try {
        window.localStorage.setItem(SKIN_KEY, s.id);
      } catch {
        /* session-only */
      }
      pulse("tick");
      playSound("select");
      fit(); // re-tints the whole playground instantly — even mid-run
    },
    [fit]
  );

  const pickSize = useCallback(
    (id: string) => {
      const z = SIZES.find((k) => k.id === id);
      if (!z || sizeRef.current.id === z.id) return;
      sizeRef.current = z;
      setSizeId(z.id);
      try {
        window.localStorage.setItem(SIZE_KEY, z.id);
      } catch {
        /* session-only */
      }
      pulse("tick");
      playSound("select");
      prevDimsRef.current = { cols: 0, rows: 0 }; // force the grid to re-apply
      fit(); // idle → regrids + reseeds now; mid-run → lands on the next run
    },
    [fit]
  );

  // boot: load records, size the board, seed the idle preview
  useEffect(() => {
    try {
      const sid = window.localStorage.getItem(SKIN_KEY);
      if (sid) {
        const s = SKINS.find((k) => k.id === sid);
        if (s) {
          skinRef.current = s;
          setSkinId(s.id);
        }
      }
      const zid = window.localStorage.getItem(SIZE_KEY);
      if (zid) {
        const z = SIZES.find((k) => k.id === zid);
        if (z) {
          sizeRef.current = z;
          setSizeId(z.id);
        }
      }
      const b = parseInt(window.localStorage.getItem(BEST_KEY) || "0", 10);
      if (Number.isFinite(b) && b > 0) {
        bestRef.current = b;
        setBest(b);
      }
      const g = parseInt(window.localStorage.getItem(GAMES_KEY) || "0", 10);
      if (Number.isFinite(g) && g > 0) {
        gamesRef.current = g;
        setGames(g);
      }
    } catch {
      /* private mode */
    }
    setShowPad(
      (window.matchMedia?.("(pointer: coarse)")?.matches ?? false) ||
        (navigator.maxTouchPoints ?? 0) > 0 ||
        window.innerWidth < 768
    );
    fit();
    resetGame();
    const ro = new ResizeObserver(() => fit());
    if (areaRef.current) ro.observe(areaRef.current);
    return () => ro.disconnect();
  }, [fit, resetGame]);

  // keyboard — arrows / WASD steer, space pauses, enter starts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const k = e.key.toLowerCase();
      if (k === "escape" && showStyleRef.current) {
        e.preventDefault();
        closeStyle();
        return;
      }
      const map: Record<string, Vec> = {
        arrowup: UP,
        w: UP,
        arrowdown: DOWN,
        s: DOWN,
        arrowleft: LEFT,
        a: LEFT,
        arrowright: RIGHT,
        d: RIGHT,
      };
      if (map[k]) {
        e.preventDefault();
        if (statusRef.current === "idle") start();
        queueDir(map[k]);
      } else if (k === " ") {
        e.preventDefault();
        togglePause();
      } else if (k === "enter") {
        const st = statusRef.current;
        if (st === "idle" || st === "over") {
          e.preventDefault();
          start();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [start, queueDir, togglePause, closeStyle]);

  // swipe / tap on the board (pointer events cover touch, pen and mouse)
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    let active = false;
    let ax = 0;
    let ay = 0;
    let t0 = 0;
    let moved = false;
    const isUi = (e: PointerEvent) =>
      (e.target as HTMLElement | null)?.closest("button") != null;
    const down = (e: PointerEvent) => {
      if (isUi(e)) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      active = true;
      moved = false;
      ax = e.clientX;
      ay = e.clientY;
      t0 = performance.now();
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* capture is best-effort */
      }
    };
    const move = (e: PointerEvent) => {
      if (!active || isUi(e)) return;
      const dx = e.clientX - ax;
      const dy = e.clientY - ay;
      if (Math.abs(dx) < 22 && Math.abs(dy) < 22) return;
      moved = true;
      const d =
        Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? RIGHT : LEFT) : dy > 0 ? DOWN : UP;
      if (statusRef.current === "idle") start();
      queueDir(d);
      ax = e.clientX;
      ay = e.clientY;
    };
    const up = (e: PointerEvent) => {
      if (!active) return;
      active = false;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (!moved && performance.now() - t0 < 260 && !isUi(e)) {
        const st = statusRef.current;
        if (st === "playing" || st === "paused") togglePause();
      }
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
  }, [start, queueDir, togglePause]);

  // auto-pause when the tab or window loses focus
  useEffect(() => {
    const onHide = () => {
      if (statusRef.current === "playing") applyStatus("paused");
    };
    const onVis = () => {
      if (document.hidden) onHide();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("blur", onHide);
    };
  }, [applyStatus]);

  /* ---------------------------------- HUD ----------------------------------- */

  const statCard = (
    icon: React.ReactNode,
    label: string,
    value: number,
    accent: string
  ) => (
    <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.045] px-2.5 py-1.5 backdrop-blur-sm">
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[9px] font-bold uppercase tracking-[0.18em] text-white/45">
          {label}
        </span>
        <span
          className={cn(
            "block truncate text-lg font-black leading-tight tabular-nums",
            accent
          )}
        >
          {value}
        </span>
      </span>
    </div>
  );

  const iconBtn = (
    onClick: () => void,
    label: string,
    icon: React.ReactNode,
    disabled = false
  ) => (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.045] text-foreground/80 backdrop-blur-sm transition active:scale-90 active:border-amber-400/50 active:text-amber-300 disabled:opacity-40 lg:h-9 lg:w-9",
        !disabled && "hover:border-white/20 hover:text-foreground"
      )}
    >
      {icon}
    </button>
  );

  const padBtn = (d: Vec, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      aria-label={label}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.preventDefault();
        queueDir(d);
      }}
      className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/15 bg-black/50 text-white/85 backdrop-blur-md transition active:scale-90 active:border-amber-400/60 active:bg-amber-500/25"
    >
      {icon}
    </button>
  );

  /* ---------------------------------- view ---------------------------------- */

  return (
    <div className="tab-scroll flex min-h-0 flex-1 flex-col">
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-2.5 px-1 pb-24 lg:pb-4 xl:max-w-4xl">
        {/* HUD */}
        <div className="flex items-stretch gap-2">
          {statCard(
            <Apple className="h-4 w-4 text-red-400" />,
            "Score",
            score,
            "text-red-50"
          )}
          {statCard(
            <Trophy className="h-4 w-4 text-amber-300" />,
            "Best",
            best,
            "text-amber-200"
          )}
          {statCard(
            <Zap className="h-4 w-4 text-emerald-400" />,
            "Level",
            level,
            "text-emerald-200"
          )}
          <div className="ml-auto flex items-center gap-1.5">
            {iconBtn(
              openStyle,
              "Snake skin & playground size",
              <Palette className="h-4.5 w-4.5" />
            )}
            {iconBtn(start, "Restart", <RotateCcw className="h-4.5 w-4.5" />, status === "idle")}
            {iconBtn(
              togglePause,
              status === "playing" ? "Pause" : "Resume",
              status === "playing" ? <Pause className="h-4.5 w-4.5" /> : <Play className="h-4.5 w-4.5" />,
              status !== "playing" && status !== "paused"
            )}
          </div>
        </div>

        {/* board */}
        <div
          ref={areaRef}
          className="relative flex min-h-[240px] flex-1 select-none items-center justify-center p-1.5"
          style={{ touchAction: "none" }}
        >
          <div className="relative">
            <div
              aria-hidden="true"
              className="absolute -inset-1 animate-pulse rounded-[22px] blur-lg [animation-duration:3.4s]"
              style={{ background: skin.shadow, opacity: 0.26 }}
            />
            <div
              className="relative rounded-2xl border bg-black/60 p-1.5 transition-all duration-500"
              style={{ borderColor: skin.frame, boxShadow: `0 0 55px -16px ${skin.shadow}` }}
            >
            <canvas
              ref={canvasRef}
              role="img"
              aria-label="Snake game board"
              className="block rounded-xl"
            />

            {/* thumb D-pad (touch devices & narrow screens, while playing) */}
            {showPad && status === "playing" && (
              <div className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2">
                <div className="grid grid-cols-3 gap-1.5">
                  <span />
                  {padBtn(UP, "Steer up", <ChevronUp className="h-5 w-5" />)}
                  <span />
                  {padBtn(LEFT, "Steer left", <ChevronLeft className="h-5 w-5" />)}
                  {padBtn(DOWN, "Steer down", <ChevronDown className="h-5 w-5" />)}
                  {padBtn(RIGHT, "Steer right", <ChevronRight className="h-5 w-5" />)}
                </div>
              </div>
            )}

            <AnimatePresence>
              {/* ---- idle / menu ---- */}
              {status === "idle" && (
                <motion.div
                  key="idle"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.22 }}
                  onClick={start}
                  className="absolute inset-0 z-30 flex cursor-pointer items-center justify-center overflow-hidden rounded-2xl bg-black/65 backdrop-blur-[3px]"
                >
                  <div className="px-6 text-center">
                    <motion.div
                      animate={{ rotate: [-7, 7, -7] }}
                      transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
                      className="inline-block"
                    >
                      <Worm className="mx-auto h-11 w-11 text-emerald-400 drop-shadow-[0_0_14px_rgba(52,211,153,0.8)]" />
                    </motion.div>
                    <p className="mt-1.5 text-[10px] font-bold uppercase tracking-[0.35em] text-amber-300/80">
                      Sovereign Arcade
                    </p>
                    <h2 className="bg-gradient-to-b from-[#fff3cd] via-[#ecca6f] to-[#b8860b] bg-clip-text text-5xl font-black tracking-wide text-transparent drop-shadow-[0_2px_18px_rgba(212,175,55,0.35)] sm:text-6xl">
                      SNAKE
                    </h2>
                    <div className="mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-3.5 py-1 text-xs font-bold text-amber-200">
                      <Trophy className="h-3.5 w-3.5" />
                      Best {best}
                    </div>
                    <div className="mt-4">
                      <span className="inline-flex h-12 items-center gap-2 rounded-xl bg-gradient-to-b from-[#f5d97a] via-[#e3b84f] to-[#b8860b] px-10 text-sm font-black uppercase tracking-[0.18em] text-[#241a05] shadow-[0_10px_30px_-8px_rgba(212,175,55,0.7)]">
                        <Play className="h-4 w-4" />
                        Play
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openStyle();
                      }}
                      className="mt-3 inline-flex h-10 items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.06] px-4 text-[10.5px] font-bold uppercase tracking-[0.16em] text-white/60 transition active:scale-95"
                    >
                      <Palette className="h-3.5 w-3.5" />
                      {skin.name} · {dims.cols}×{dims.rows}
                    </button>
                    <p className="mt-3.5 text-[11px] leading-relaxed text-white/45">
                      Swipe or use arrow keys / WASD to steer
                      <br />
                      Tap the board to pause
                    </p>
                  </div>
                </motion.div>
              )}

              {/* ---- paused ---- */}
              {status === "paused" && (
                <motion.div
                  key="paused"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className="absolute inset-0 z-30 flex items-center justify-center overflow-hidden rounded-2xl bg-black/65 backdrop-blur-[3px]"
                >
                  <div className="text-center">
                    <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-amber-300/80">
                      Sovereign Arcade
                    </p>
                    <h3 className="mt-1 text-3xl font-black tracking-[0.2em] text-amber-100">
                      PAUSED
                    </h3>
                    <div className="mt-4 flex items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={togglePause}
                        className="inline-flex h-11 items-center gap-2 rounded-xl bg-gradient-to-b from-[#f5d97a] via-[#e3b84f] to-[#b8860b] px-6 text-xs font-black uppercase tracking-[0.14em] text-[#241a05] shadow-[0_8px_24px_-8px_rgba(212,175,55,0.7)] transition active:scale-95"
                      >
                        <Play className="h-4 w-4" />
                        Resume
                      </button>
                      <button
                        type="button"
                        aria-label="Restart"
                        onClick={start}
                        className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-white/80 transition active:scale-90"
                      >
                        <RotateCcw className="h-4.5 w-4.5" />
                      </button>
                      <button
                        type="button"
                        aria-label="Back to menu"
                        onClick={goMenu}
                        className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-white/80 transition active:scale-90"
                      >
                        <House className="h-4.5 w-4.5" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* ---- game over / win ---- */}
              {status === "over" && (
                <motion.div
                  key="over"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="absolute inset-0 z-30 flex items-center justify-center overflow-hidden rounded-2xl bg-black/70 backdrop-blur-[3px]"
                >
                  <motion.div
                    initial={{ scale: 0.88, opacity: 0, y: 12 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                    transition={{ type: "spring", stiffness: 260, damping: 22 }}
                    className="w-64 rounded-2xl border border-white/10 bg-[#0a0f0c]/90 p-5 text-center shadow-2xl"
                  >
                    <h3
                      className={cn(
                        "bg-clip-text text-3xl font-black tracking-wide text-transparent",
                        won
                          ? "bg-gradient-to-b from-[#fff3cd] via-[#ecca6f] to-[#b8860b]"
                          : "bg-gradient-to-b from-[#fecaca] via-[#f87171] to-[#b91c1c]"
                      )}
                    >
                      {won ? "FLAWLESS!" : "GAME OVER"}
                    </h3>
                    {newBest && (
                      <motion.div
                        animate={{ scale: [1, 1.1, 1] }}
                        transition={{ repeat: Infinity, duration: 1.4 }}
                        className="mx-auto mt-2 inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-400/15 px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em] text-amber-300"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        New Best
                      </motion.div>
                    )}
                    <p className="mt-2 text-5xl font-black tabular-nums text-amber-200">
                      {score}
                    </p>
                    <div className="mt-3 grid grid-cols-3 gap-1.5 text-center">
                      {[
                        { l: "Best", v: best },
                        { l: "Length", v: len },
                        { l: "Level", v: level },
                      ].map((s) => (
                        <div
                          key={s.l}
                          className="rounded-lg border border-white/8 bg-white/[0.04] px-1 py-1.5"
                        >
                          <span className="block text-[8.5px] font-bold uppercase tracking-[0.16em] text-white/40">
                            {s.l}
                          </span>
                          <span className="block text-sm font-black tabular-nums text-white/85">
                            {s.v}
                          </span>
                        </div>
                      ))}
                    </div>
                    <p className="mt-2 text-[10px] font-medium text-white/35">
                      Run #{games} · {apples} apples eaten
                    </p>
                    <div className="mt-3.5 flex items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={start}
                        className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-[#f5d97a] via-[#e3b84f] to-[#b8860b] text-xs font-black uppercase tracking-[0.14em] text-[#241a05] shadow-[0_8px_24px_-8px_rgba(212,175,55,0.7)] transition active:scale-95"
                      >
                        <RotateCcw className="h-4 w-4" />
                        Again
                      </button>
                      <button
                        type="button"
                        aria-label="Back to menu"
                        onClick={goMenu}
                        className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-white/80 transition active:scale-90"
                      >
                        <House className="h-4.5 w-4.5" />
                      </button>
                    </div>
                  </motion.div>
                </motion.div>
              )}

              {/* ---- dressing room: skins & playground size ---- */}
              {showStyle && (
                <motion.div
                  key="style"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="absolute inset-0 z-40 flex flex-col rounded-2xl bg-black/85 p-3.5 backdrop-blur-md sm:p-4"
                >
                  <div className="flex shrink-0 items-center justify-between gap-2">
                    <div>
                      <p className="text-[9.5px] font-bold uppercase tracking-[0.3em] text-amber-300/80">
                        Dressing room
                      </p>
                      <h3 className="text-xl font-black text-amber-100">
                        Style your snake
                      </h3>
                    </div>
                    <button
                      type="button"
                      aria-label="Close styling"
                      onClick={closeStyle}
                      className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/12 bg-white/[0.05] text-white/80 transition active:scale-90"
                    >
                      <X className="h-4.5 w-4.5" />
                    </button>
                  </div>

                  <div className="tab-scroll min-h-0 flex-1 space-y-4 overflow-y-auto py-3">
                    <section>
                      <p className="mb-1.5 text-[10px] font-black uppercase tracking-[0.22em] text-white/45">
                        Snake skin
                      </p>
                      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
                        {SKINS.map((s) => {
                          const active = s.id === skinId;
                          return (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => pickSkin(s.id)}
                              aria-pressed={active}
                              className={cn(
                                "flex flex-col items-center gap-1 rounded-xl border p-1.5 transition active:scale-95",
                                active
                                  ? "border-amber-400/70 bg-amber-400/10"
                                  : "border-white/10 bg-white/[0.04] hover:border-white/25"
                              )}
                            >
                              <SkinPreview skin={s} size={44} />
                              <span
                                className={cn(
                                  "max-w-full truncate text-[9.5px] font-bold",
                                  active ? "text-amber-200" : "text-white/55"
                                )}
                              >
                                {s.name}
                              </span>
                              {active && <Check className="h-3 w-3 text-amber-300" />}
                            </button>
                          );
                        })}
                      </div>
                    </section>

                    <section>
                      <p className="mb-1.5 text-[10px] font-black uppercase tracking-[0.22em] text-white/45">
                        Playground size
                      </p>
                      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                        {SIZES.map((z) => {
                          const active = z.id === sizeId;
                          return (
                            <button
                              key={z.id}
                              type="button"
                              onClick={() => pickSize(z.id)}
                              aria-pressed={active}
                              className={cn(
                                "rounded-xl border px-2 py-2.5 text-center transition active:scale-95",
                                active
                                  ? "border-amber-400/70 bg-amber-400/10"
                                  : "border-white/10 bg-white/[0.04] hover:border-white/25"
                              )}
                            >
                              <span
                                className={cn(
                                  "block text-[12.5px] font-black",
                                  active ? "text-amber-200" : "text-white/70"
                                )}
                              >
                                {z.name}
                              </span>
                              <span className="mt-0.5 block text-[8.5px] font-bold uppercase tracking-[0.14em] text-white/40">
                                {z.note}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      {status !== "idle" && (
                        <p className="mt-2 text-[10px] font-semibold text-amber-200/70">
                          Size applies from the next run — skins change instantly.
                        </p>
                      )}
                    </section>
                  </div>

                  <button
                    type="button"
                    onClick={closeStyle}
                    className="mt-3 inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-[#f5d97a] via-[#e3b84f] to-[#b8860b] text-xs font-black uppercase tracking-[0.16em] text-[#241a05] shadow-[0_8px_24px_-8px_rgba(212,175,55,0.7)] transition active:scale-95"
                  >
                    <Check className="h-4 w-4" />
                    Done
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
            </div>
          </div>
        </div>

        {/* hints */}
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pb-1 text-[11px] text-white/40">
          <span className="hidden sm:inline">
            Arrow keys / WASD to steer · Space to pause
          </span>
          <span className="sm:hidden">Swipe the board to steer · tap to pause</span>
          <span className="inline-flex items-center gap-1 text-amber-200/60">
            <Sparkles className="h-3 w-3" />
            Golden apple = 50 pts, expires fast
          </span>
          <span
            className="inline-flex items-center gap-1 font-bold"
            style={{ color: skin.body[0] }}
          >
            <Palette className="h-3 w-3" />
            {skin.name} · {dims.cols}×{dims.rows}
          </span>
        </div>
      </div>
    </div>
  );
}
