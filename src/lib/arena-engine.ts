/**
 * Sovereign Chess — Snake Arena engine (slither-style worm arena).
 *
 * The look comes straight from the arena artwork: glossy white segmented
 * worms with big cartoon eyes gliding over a navy deep scattered with
 * emoji feast (tacos, sushi, chocolate, gems…). Framework-agnostic: the
 * engine owns a canvas, a fixed-step simulation and every pixel it
 * renders. The React shell (snake-arena.tsx) only feeds steering/boost
 * input and reads HUD snapshots.
 *
 * FAIRNESS (stake duels) — mode "duel":
 *   · every food spawn is a pure function of (seed, index) — spawn #n is
 *     identical forever, no matter when it is consumed;
 *   · bots are time-driven automatons: their heading is a closed-form
 *     function of simulation time, they never eat, never die, never boost
 *     — so the obstacle field is identical for both runners;
 *   · boosting drops no food. Both runs see the exact same world; the
 *     only free variable is the player's own steering — which IS the skill.
 *
 * mode "solo" is the practice playground: bots eat, boost, dodge, die and
 * respawn; crashes burst into a feast. Same seed still builds the arena.
 *
 * Perf notes: worm bodies render as three batched path fills (band / rim
 * / inner), food and bodies are view-culled, dpr capped at 2.
 */

/* ---------------- public surface ---------------- */

export type ArenaMode = "solo" | "duel";

export interface ArenaLeaderRow {
  name: string;
  score: number;
  me: boolean;
  eye: string;
}

export interface ArenaHud {
  score: number;
  timeLeft: number;
  alive: boolean;
  leaders: ArenaLeaderRow[];
}

export interface ArenaDeathInfo {
  score: number;
  cause: string;
}

export interface ArenaCallbacks {
  onEat?: (value: number) => void;
  /** a bot crashed into the player's body and burst (solo mode) */
  onKill?: (botName: string) => void;
  onDeath?: (info: ArenaDeathInfo) => void;
  onTimeUp?: (score: number) => void;
}

export interface ArenaOptions {
  seed: number;
  mode: ArenaMode;
  durationSec: number;
  playerName: string;
  callbacks?: ArenaCallbacks;
}

/* ---------------- tuning ---------------- */

const TAU = Math.PI * 2;
const WORLD_R = 1800;
const STEP = 1 / 60;
const START_MASS = 10;
const BASE_SPEED = 118;
const BOOST_SPEED = 235;
const BOOST_MIN_MASS = 14;
const BOOST_DRAIN = 2.7;
const SPACING = 4.4;
const FOOD_TARGET = 240;
const SPAWN_LIMIT = 6000;
const PLAYER_TURN = 3.6;
const BOT_TURN = 2.7;
const SPAWN_PROTECT = 4; // seconds of invulnerability after every spawn

/* ---------------- palette / content ---------------- */

const BG = "#222b5e";
const BLOTCH = "#1a2350";
const DANGER = "#e2495f";

const COMMON_FOOD = ["🌮", "🍎", "🍫", "🍌", "🍣", "🌭", "🥓", "🥐", "🍩", "🧁", "🍬", "🍪", "🍭", "🍇"];
const MID_FOOD = ["🍈", "🍏", "🍊"];
const DROP_FOOD = ["🍎", "🍫", "🍩"];

const BOT_NAMES = ["Noodle", "Slinky", "Wiggles", "Mamba", "Boa", "Twisty", "Coco"];
const BOT_EYES = ["#34b47a", "#e0a53a", "#e06c9f", "#8f6fe0", "#e05f5f", "#3ec3cf", "#d98e3f"];

const EMOJI_FONT = '"Segoe UI Emoji","Noto Color Emoji","Apple Color Emoji",sans-serif';

/* ---------------- helpers ---------------- */

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** pure per-(seed, index) RNG — food spawn #n lands identically forever */
function hashRng(seed: number, n: number): () => number {
  return mulberry32((seed ^ Math.imul(n + 0x9e37, 0x85ebca6b)) >>> 0);
}

function wrapAngle(a: number): number {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  else if (a < -Math.PI) a += TAU;
  return a;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** lighten (k > 0) or darken (k < 0) a #rrggbb colour — used for glossy irises */
function shade(hex: string, k: number): string {
  const v = parseInt(hex.slice(1), 16);
  let r = (v >> 16) & 255;
  let g = (v >> 8) & 255;
  let b = v & 255;
  if (k >= 0) {
    r += (255 - r) * k;
    g += (255 - g) * k;
    b += (255 - b) * k;
  } else {
    r *= 1 + k;
    g *= 1 + k;
    b *= 1 + k;
  }
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}

/* ---------------- internal types ---------------- */

interface Food {
  x: number;
  y: number;
  r: number;
  value: number;
  emoji: string;
  gem: boolean;
  /** bob phase — purely cosmetic */
  ph: number;
}

interface Worm {
  name: string;
  isPlayer: boolean;
  eye: string;
  rim: string;
  rimDark: string;
  inner: string;
  dead: boolean;
  respawnT: number;
  protectT: number;
  x: number;
  y: number;
  angle: number;
  mass: number;
  radius: number;
  boosting: boolean;
  dropT: number;
  /** flat [x0,y0, x1,y1, …] tail → head */
  path: number[];
  decideT: number;
  wanderA: number;
  boostT: number;
  th0: number;
  ph1: number;
  ph2: number;
  ph3: number;
  blinkSeed: number;
}

interface FloatText {
  x: number;
  y: number;
  t: number;
  text: string;
  color: string;
}

/* ---------------- engine ---------------- */

export class ArenaEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private opts: ArenaOptions;
  private mode: ArenaMode;

  /** free RNG — used ONLY inside solo-mode bots / visuals, never in duel */
  private rng: () => number = Math.random;

  private w = 0;
  private h = 0;
  private dpr = 1;
  private raf = 0;
  private running = false;
  private paused = true;
  private lastT = 0;
  private acc = 0;
  private simTime = 0;
  private ended = false;
  private deathT = -1;

  private worms: Worm[] = [];
  private player!: Worm;
  private food: Food[] = [];
  private spawned = 0;
  private texts: FloatText[] = [];
  private blotches: { x: number; y: number; r: number; a: number }[] = [];

  private camX = 0;
  private camY = 0;
  private scale = 1;
  private reserve = 20;
  private steerX = 0;
  private steerY = -1;
  private boostInput = false;

  constructor(canvas: HTMLCanvasElement, opts: ArenaOptions) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Snake Arena: canvas 2d unavailable");
    this.ctx = ctx;
    this.opts = opts;
    this.mode = opts.mode;
    this.reset(opts.seed);
  }

  /* ---------- lifecycle ---------- */

  start() {
    if (this.running) return;
    this.running = true;
    this.lastT = performance.now();
    const loop = (t: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (t - this.lastT) / 1000);
      this.lastT = t;
      if (!this.paused && !this.ended) {
        this.acc += dt;
        let steps = 0;
        while (this.acc >= STEP && steps < 6 && !this.ended) {
          this.step(STEP);
          this.acc -= STEP;
          steps += 1;
        }
        if (this.acc > STEP * 6) this.acc = 0;
      }
      this.updateCamera(dt);
      this.render(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  dispose() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  setPaused(p: boolean) {
    this.paused = p;
    this.lastT = performance.now();
    this.acc = 0;
  }

  resize(w: number, h: number, dpr: number, bottomReserve = 20) {
    this.w = Math.max(0, Math.round(w));
    this.h = Math.max(0, Math.round(h));
    this.dpr = clamp(dpr, 1, 2);
    this.reserve = clamp(bottomReserve, 0, this.h);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  }

  /** screen-space steering vector relative to the canvas centre (css px) */
  setSteer(x: number, y: number) {
    this.steerX = x;
    this.steerY = y;
  }

  setBoost(on: boolean) {
    this.boostInput = on;
  }

  getHud(): ArenaHud {
    const alive = this.worms.filter((w) => !w.dead);
    alive.sort((a, b) => b.mass - a.mass);
    return {
      score: this.scoreOf(this.player),
      timeLeft: Math.max(0, this.opts.durationSec - this.simTime),
      alive: !this.player.dead,
      leaders: alive.slice(0, 4).map((w) => ({
        name: w.name,
        score: this.scoreOf(w),
        me: w.isPlayer,
        eye: w.eye,
      })),
    };
  }

  /* ---------- world construction ---------- */

  reset(seed: number) {
    this.food = [];
    this.texts = [];
    this.spawned = 0;
    this.simTime = 0;
    this.ended = false;
    this.deathT = -1;
    this.acc = 0;
    this.boostInput = false;
    this.worms = [];

    // player — spawns mid-south, gliding north
    this.player = this.makeWorm({
      name: this.opts.playerName,
      isPlayer: true,
      eye: "#2e6ed8",
      x: 0,
      y: 90,
      angle: -Math.PI / 2,
      mass: START_MASS,
      rim: "#dfe6f2",
      rimDark: "#c6d0e0",
      inner: "#ffffff",
    });
    this.worms.push(this.player);

    // bots — placement is a pure function of the seed
    const botCount = this.mode === "solo" ? 7 : 6;
    for (let i = 0; i < botCount; i++) {
      let bx = 0;
      let by = 0;
      let ba = 0;
      for (let k = 0; k < 40; k++) {
        const r = hashRng(seed, 6000 + i * 100 + k);
        const a = r() * TAU;
        const rad = (0.3 + r() * 0.42) * WORLD_R;
        bx = Math.cos(a) * rad;
        by = Math.sin(a) * rad;
        ba = a + Math.PI + (r() - 0.5) * 1.4;
        if (Math.hypot(bx - this.player.x, by - this.player.y) > 560) break;
      }
      const mass = this.mode === "duel" ? 30 : 14 + Math.floor(hashRng(seed, 7000 + i)() * 30);
      const bot = this.makeWorm({
        name: BOT_NAMES[i % BOT_NAMES.length],
        isPlayer: false,
        eye: BOT_EYES[i % BOT_EYES.length],
        x: bx,
        y: by,
        angle: ba,
        mass,
        rim: "#dbe3ef",
        rimDark: "#c2cdde",
        inner: "#fafcff",
      });
      const bp = hashRng(seed, 8000 + i);
      bot.th0 = ba;
      bot.ph1 = bp() * TAU;
      bot.ph2 = bp() * TAU;
      bot.ph3 = bp() * TAU;
      bot.wanderA = ba;
      this.worms.push(bot);
    }

    // initial feast — deterministic spawn queue
    for (let i = 0; i < FOOD_TARGET; i++) this.food.push(this.spawnFoodAt(i));
    this.spawned = FOOD_TARGET;

    // navy-deep blotches — same sea for both runners
    this.blotches = [];
    for (let i = 0; i < 46; i++) {
      const r = hashRng(seed, 7777 + i);
      const a = r() * TAU;
      const rad = Math.sqrt(r()) * WORLD_R;
      this.blotches.push({
        x: Math.cos(a) * rad,
        y: Math.sin(a) * rad,
        r: 120 + r() * 220,
        a: 0.35 + r() * 0.3,
      });
    }

    this.camX = this.player.x;
    this.camY = this.player.y;
    this.scale = 1.22;
  }

  private makeWorm(p: {
    name: string;
    isPlayer: boolean;
    eye: string;
    x: number;
    y: number;
    angle: number;
    mass: number;
    rim: string;
    rimDark: string;
    inner: string;
  }): Worm {
    const w: Worm = {
      name: p.name,
      isPlayer: p.isPlayer,
      eye: p.eye,
      rim: p.rim,
      rimDark: p.rimDark,
      inner: p.inner,
      dead: false,
      respawnT: 0,
      protectT: p.isPlayer ? SPAWN_PROTECT : 0.6,
      x: p.x,
      y: p.y,
      angle: p.angle,
      mass: p.mass,
      radius: 0,
      boosting: false,
      dropT: 0,
      path: [],
      decideT: 0,
      wanderA: p.angle,
      boostT: 0,
      th0: p.angle,
      ph1: 0,
      ph2: 0,
      ph3: 0,
      blinkSeed: Math.random() * 4,
    };
    this.refreshShape(w);
    // pre-seed the trail behind the head
    const target = this.targetPoints(w);
    for (let i = target; i >= 1; i--) {
      w.path.push(w.x - Math.cos(w.angle) * SPACING * i, w.y - Math.sin(w.angle) * SPACING * i);
    }
    return w;
  }

  /** food spawn #n — identical for every runner, forever */
  private spawnFoodAt(n: number): Food {
    const r = hashRng(this.opts.seed, n);
    const a = r() * TAU;
    const rad = Math.sqrt(r()) * (WORLD_R - 120);
    const d = r();
    let value = 1;
    let size = 11;
    let gem = false;
    if (d > 0.965) {
      value = 8;
      size = 15;
      gem = true;
    } else if (d > 0.9) {
      value = 3;
      size = 13.5;
    } else if (d > 0.68) {
      value = 2;
      size = 12.5;
    }
    const set = gem ? ["💎"] : value >= 3 ? MID_FOOD : COMMON_FOOD;
    const emoji = set[Math.floor(r() * set.length)];
    return { x: Math.cos(a) * rad, y: Math.sin(a) * rad, r: size, value, emoji, gem, ph: r() };
  }

  /* ---------- simulation ---------- */

  private scoreOf(w: Worm): number {
    return Math.max(0, Math.floor(w.mass) - START_MASS);
  }

  private targetPoints(w: Worm): number {
    return clamp(Math.floor((120 + w.mass * 4.6) / SPACING), 24, 300);
  }

  private refreshShape(w: Worm) {
    w.radius = Math.min(32, 12 + Math.sqrt(w.mass) * 0.9);
  }

  private step(dt: number) {
    this.simTime += dt;

    for (const w of this.worms) {
      if (w.dead) {
        if (this.mode === "solo") {
          w.respawnT -= dt;
          if (w.respawnT <= 0) this.respawn(w);
        }
        continue;
      }
      if (w.protectT > 0) w.protectT -= dt;

      // ---- steering ----
      let desired = w.angle;
      if (w.isPlayer) {
        if (this.steerX * this.steerX + this.steerY * this.steerY > 26 * 26) {
          desired = Math.atan2(this.steerY, this.steerX);
        }
        w.boosting = this.boostInput;
      } else if (this.mode === "duel") {
        // closed-form patrol — identical for every runner at time t
        desired =
          w.th0 +
          0.75 * Math.sin(this.simTime * 0.33 + w.ph1) +
          0.45 * Math.sin(this.simTime * 0.117 + w.ph2) +
          0.3 * Math.sin(this.simTime * 0.71 + w.ph3);
        if (Math.hypot(w.x, w.y) > WORLD_R * 0.8) {
          desired = Math.atan2(-w.y, -w.x); // strong homing keeps patrols inside
        }
      } else {
        w.decideT -= dt;
        if (w.decideT <= 0) this.botDecide(w);
        desired = w.wanderA;
        w.boostT = Math.max(0, w.boostT - dt);
        w.boosting = w.boostT > 0;
      }

      const turnRate = (w.isPlayer ? PLAYER_TURN : BOT_TURN) / (1 + Math.max(0, w.radius - 13) * 0.045);
      const diff = wrapAngle(desired - w.angle);
      const turn = clamp(diff, -turnRate * dt, turnRate * dt);
      w.angle = wrapAngle(w.angle + turn);

      // ---- boost economics ----
      const canBoost = w.boosting && w.mass > BOOST_MIN_MASS + 1;
      const sp = canBoost ? BOOST_SPEED : BASE_SPEED;
      if (canBoost) {
        w.mass -= BOOST_DRAIN * dt;
        if (this.mode === "solo") {
          w.dropT -= dt;
          if (w.dropT <= 0) {
            w.dropT = 0.15;
            const tail = w.path;
            if (tail.length >= 2) {
              this.food.push({
                x: tail[0] + (this.rng() - 0.5) * 10,
                y: tail[1] + (this.rng() - 0.5) * 10,
                r: 9,
                value: 1,
                emoji: DROP_FOOD[Math.floor(this.rng() * DROP_FOOD.length)],
                gem: false,
                ph: this.rng(),
              });
            }
          }
        }
      }
      if (w.mass < START_MASS) w.mass = START_MASS;
      if (w.mass < BOOST_MIN_MASS) w.boosting = false;

      // ---- move + trail ----
      w.x += Math.cos(w.angle) * sp * dt;
      w.y += Math.sin(w.angle) * sp * dt;
      this.refreshShape(w);
      const n = w.path.length;
      const dxh = w.x - w.path[n - 2];
      const dyh = w.y - w.path[n - 1];
      if (dxh * dxh + dyh * dyh >= SPACING * SPACING) w.path.push(w.x, w.y);
      const target = this.targetPoints(w) * 2;
      while (w.path.length > target) {
        w.path.shift();
        w.path.shift();
      }
    }

    // ---- eating ----
    for (const eater of this.worms) {
      if (eater.dead) continue;
      if (!eater.isPlayer && this.mode === "duel") continue; // patrol bots never feast
      for (let i = this.food.length - 1; i >= 0; i--) {
        const f = this.food[i];
        const dx = eater.x - f.x;
        const dy = eater.y - f.y;
        const rr = eater.radius * 0.92 + f.r + 2;
        if (dx * dx + dy * dy < rr * rr) {
          eater.mass += f.value;
          this.food[i] = this.food[this.food.length - 1];
          this.food.pop();
          if (eater.isPlayer) {
            this.opts.callbacks?.onEat?.(f.value);
            if (f.value >= 3) {
              this.texts.push({
                x: f.x,
                y: f.y,
                t: 0,
                text: `+${f.value}`,
                color: f.gem ? "#ffd76a" : "#bfe3ff",
              });
            }
          }
          if (this.spawned < SPAWN_LIMIT && this.food.length < FOOD_CAP()) {
            this.food.push(this.spawnFoodAt(this.spawned++));
          }
        }
      }
    }

    // ---- collisions ----
    for (const a of this.worms) {
      if (a.dead) continue;
      if (!a.isPlayer && this.mode === "duel") continue; // patrol bots are immortal
      if (a.protectT > 0) continue; // spawn shield — the deep grants mercy
      // the crimson wall
      if (Math.hypot(a.x, a.y) > WORLD_R - a.radius) {
        this.die(a, null);
        continue;
      }
      for (const b of this.worms) {
        if (b === a || b.dead) continue;
        // quick reject: farther than the other worm's length
        const bhx = b.x - a.x;
        const bhy = b.y - a.y;
        const reach = b.path.length * SPACING * 0.5 + a.radius + b.radius + 30;
        if (bhx * bhx + bhy * bhy > reach * reach) continue;
        for (let i = 6; i < b.path.length; i += 4) {
          const dx = a.x - b.path[i];
          const dy = a.y - b.path[i + 1];
          const rr = a.radius * 0.66 + b.radius * 0.74;
          if (dx * dx + dy * dy < rr * rr) {
            this.die(a, b.name);
            break;
          }
        }
        if (a.dead) break;
      }
    }

    // ---- the clock ----
    if (this.opts.durationSec > 0 && this.simTime >= this.opts.durationSec && !this.ended) {
      this.ended = true;
      this.opts.callbacks?.onTimeUp?.(this.scoreOf(this.player));
    }
  }

  private botDecide(w: Worm) {
    w.decideT = 0.3 + this.rng() * 0.15;
    const d = Math.hypot(w.x, w.y);
    if (d > WORLD_R - 340) {
      w.wanderA = Math.atan2(-w.y, -w.x) + (this.rng() - 0.5) * 0.6;
      w.boostT = 0;
      return;
    }
    // opening grace — young bots give the player space to learn the deep
    if (this.simTime < 7) {
      const pd = Math.hypot(w.x - this.player.x, w.y - this.player.y);
      if (pd < 480) {
        w.wanderA = Math.atan2(w.y - this.player.y, w.x - this.player.x) + (this.rng() - 0.5) * 0.8;
        w.boostT = 0;
        return;
      }
    }
    // whisker — steer away from bodies ahead
    const ax = w.x + Math.cos(w.angle) * w.radius * 3.6;
    const ay = w.y + Math.sin(w.angle) * w.radius * 3.6;
    if (this.nearBody(ax, ay, w)) {
      w.wanderA = w.angle + (this.rng() < 0.5 ? 1.9 : -1.9);
      w.boostT = 0;
      return;
    }
    // seek the nearest feast
    let best: Food | null = null;
    let bd = 620 * 620;
    for (const f of this.food) {
      const dx = f.x - w.x;
      const dy = f.y - w.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bd) {
        bd = d2;
        best = f;
      }
    }
    if (best) {
      w.wanderA = Math.atan2(best.y - w.y, best.x - w.x);
      if (bd > 300 * 300 && w.mass > 24 && this.rng() < 0.25) w.boostT = 1.1;
    } else {
      w.wanderA = w.angle + (this.rng() - 0.5) * 1.8;
    }
  }

  private nearBody(x: number, y: number, self: Worm): boolean {
    for (const b of this.worms) {
      if (b === self || b.dead) continue;
      const reach = b.path.length * SPACING * 0.5 + self.radius * 2 + 30;
      if ((b.x - x) * (b.x - x) + (b.y - y) * (b.y - y) > reach * reach) continue;
      for (let i = 0; i < b.path.length; i += 12) {
        const dx = x - b.path[i];
        const dy = y - b.path[i + 1];
        const rr = self.radius * 1.7 + b.radius;
        if (dx * dx + dy * dy < rr * rr) return true;
      }
    }
    return false;
  }

  private respawn(w: Worm) {
    let bx = 0;
    let by = 0;
    for (let k = 0; k < 24; k++) {
      const a = Math.random() * TAU;
      const rad = (0.15 + Math.random() * 0.45) * WORLD_R;
      bx = Math.cos(a) * rad;
      by = Math.sin(a) * rad;
      let ok = Math.hypot(bx - this.player.x, by - this.player.y) > 320;
      if (ok) {
        for (const o of this.worms) {
          if (o === w || o.dead) continue;
          if (Math.hypot(bx - o.x, by - o.y) < 260) {
            ok = false;
            break;
          }
        }
      }
      if (ok) break;
    }
    w.dead = false;
    w.x = bx;
    w.y = by;
    w.angle = Math.atan2(-by, -bx);
    w.mass = 12 + Math.random() * 34;
    w.boostT = 0;
    w.wanderA = w.angle;
    w.protectT = SPAWN_PROTECT;
    this.refreshShape(w);
    w.path = [];
    const target = this.targetPoints(w);
    for (let i = target; i >= 1; i--) {
      w.path.push(w.x - Math.cos(w.angle) * SPACING * i, w.y - Math.sin(w.angle) * SPACING * i);
    }
  }

  private die(w: Worm, killer: string | null) {
    if (w.dead) return;
    w.dead = true;
    this.burst(w);
    if (w.isPlayer) {
      this.deathT = 0;
      this.ended = true;
      const cause = killer ? `Squeezed by ${killer}!` : "The crimson wall!";
      this.opts.callbacks?.onDeath?.({ score: this.scoreOf(w), cause });
    } else {
      w.respawnT = 2.8;
      if (killer === this.player.name) this.opts.callbacks?.onKill?.(w.name);
    }
  }

  /** a fallen worm bursts into a feast along its trail */
  private burst(w: Worm) {
    const pts = w.path;
    let count = 0;
    for (let i = 0; i < pts.length && count < 46; i += 6) {
      this.food.push({
        x: pts[i] + (this.rng() - 0.5) * 14,
        y: pts[i + 1] + (this.rng() - 0.5) * 14,
        r: 11.5,
        value: 2,
        emoji: COMMON_FOOD[Math.floor(this.rng() * COMMON_FOOD.length)],
        gem: false,
        ph: this.rng(),
      });
      count += 1;
    }
    if (w.mass > 60) {
      this.food.push({ x: w.x, y: w.y, r: 15, value: 8, emoji: "💎", gem: true, ph: this.rng() });
    }
  }

  /* ---------- camera ---------- */

  private updateCamera(dt: number) {
    const k = 1 - Math.exp(-dt * 5);
    const targetScale = clamp(1.24 - (this.player.radius - 13) * 0.02, 0.6, 1.24);
    this.scale += (targetScale - this.scale) * k;
    this.camX += (this.player.x - this.camX) * k;
    this.camY += (this.player.y - this.camY) * k;
  }

  /* ---------- rendering ---------- */

  private render(dtFrame: number) {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;
    if (w < 2 || h < 2) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, w, h);

    const s = this.scale;
    const vw = w / s;
    const vh = h / s;
    const vx0 = this.camX - vw / 2 - 40;
    const vx1 = this.camX + vw / 2 + 40;
    const vy0 = this.camY - vh / 2 - 40;
    const vy1 = this.camY + vh / 2 + 40;

    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(s, s);
    ctx.translate(-this.camX, -this.camY);

    // sea blotches
    ctx.fillStyle = BLOTCH;
    for (const b of this.blotches) {
      if (b.x + b.r < vx0 || b.x - b.r > vx1 || b.y + b.r < vy0 || b.y - b.r > vy1) continue;
      ctx.globalAlpha = b.a;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // arena tint + crimson boundary
    ctx.beginPath();
    ctx.arc(0, 0, WORLD_R, 0, TAU);
    ctx.fillStyle = "rgba(255,255,255,0.02)";
    ctx.fill();
    ctx.lineWidth = 16;
    ctx.strokeStyle = DANGER;
    ctx.globalAlpha = 0.85;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // danger haze outside the wall
    ctx.beginPath();
    ctx.rect(vx0 - 4000, vy0 - 4000, vx1 - vx0 + 8000, vy1 - vy0 + 8000);
    ctx.arc(0, 0, WORLD_R + 8, 0, TAU, true);
    ctx.fillStyle = "rgba(180,40,60,0.16)";
    ctx.fill();

    // feast — juicy emoji, soft ground shadow, gentle bob (like the artwork)
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const f of this.food) {
      if (f.x < vx0 || f.x > vx1 || f.y < vy0 || f.y > vy1) continue;
      const bobY = f.y + Math.sin(this.simTime * 2.1 + f.ph * TAU) * 2.4;
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = "#0a1230";
      ctx.beginPath();
      ctx.ellipse(f.x, f.y + f.r * 0.95, f.r * 0.85, f.r * 0.3, 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (f.gem) {
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = "#ffcf5e";
        ctx.beginPath();
        ctx.arc(f.x, bobY, f.r * 2.6, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.font = `${Math.round(f.r * 2.1)}px ${EMOJI_FONT}`;
      ctx.fillText(f.emoji, f.x, bobY);
    }

    // worms — bots below the player
    for (const worm of this.worms) {
      if (!worm.isPlayer) this.drawWorm(worm, vx0, vy0, vx1, vy1);
    }
    this.drawWorm(this.player, vx0, vy0, vx1, vy1);

    // floating score texts
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.t += dtFrame;
      if (t.t > 0.9) {
        this.texts.splice(i, 1);
        continue;
      }
      const a = 1 - t.t / 0.9;
      ctx.globalAlpha = a;
      ctx.font = `bold 15px ui-sans-serif, system-ui, sans-serif`;
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y - t.t * 30);
      ctx.globalAlpha = 1;
    }

    ctx.restore();

    // ---- minimap (sits above the mobile nav island) ----
    const size = Math.min(112, w * 0.26);
    const cx = 12 + size / 2;
    const cy = h - this.reserve - size / 2;
    const mr = size / 2;
    const k = (mr - 5) / WORLD_R;
    ctx.beginPath();
    ctx.arc(cx, cy, mr, 0, TAU);
    ctx.fillStyle = "rgba(8,16,28,0.55)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(226,73,95,0.55)";
    ctx.stroke();
    for (const worm of this.worms) {
      if (worm.dead) continue;
      const wx = cx + worm.x * k;
      const wy = cy + worm.y * k;
      ctx.beginPath();
      ctx.arc(wx, wy, worm.isPlayer ? 3.4 : 2.2, 0, TAU);
      ctx.fillStyle = worm.isPlayer ? "#ffd76a" : "rgba(232,241,248,0.8)";
      ctx.fill();
    }

    // ---- crimson proximity vignette ----
    const pd = WORLD_R - Math.hypot(this.player.x, this.player.y);
    if (!this.player.dead && pd < 460) {
      const a = (1 - pd / 460) * 0.38;
      const grad = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.72);
      grad.addColorStop(0, "rgba(226,73,95,0)");
      grad.addColorStop(1, `rgba(226,73,95,${a.toFixed(3)})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }

    // ---- death flash ----
    if (this.deathT >= 0) {
      this.deathT += dtFrame;
      const a = Math.max(0, 0.6 * (1 - this.deathT / 0.7));
      if (a > 0) {
        ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
        ctx.fillRect(0, 0, w, h);
      }
    }
  }

  private drawWorm(w: Worm, vx0: number, vy0: number, vx1: number, vy1: number) {
    if (w.dead) return;
    const ctx = this.ctx;
    const r = w.radius;
    const pts = w.path;
    const n = pts.length >> 1;
    if (n === 0) return;

    // spawn shield — the whole worm shimmers while protected
    if (w.protectT > 0) {
      ctx.globalAlpha = 0.62 + 0.3 * Math.sin(this.simTime * 14);
    }

    // rib bumps — every 3rd node swells a touch: the artwork's segment rings
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = pts[i * 2];
      const y = pts[i * 2 + 1];
      if (x < vx0 || x > vx1 || y < vy0 || y > vy1 || i % 3 !== 0) continue;
      ctx.moveTo(x + r * 1.1, y);
      ctx.arc(x, y, r * 1.1, 0, TAU);
    }
    ctx.fillStyle = w.rimDark;
    ctx.fill();

    // rim pass — every node (the soft grey-white edge of the body)
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = pts[i * 2];
      const y = pts[i * 2 + 1];
      if (x < vx0 || x > vx1 || y < vy0 || y > vy1) continue;
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, TAU);
    }
    ctx.fillStyle = w.rim;
    ctx.fill();

    // inner pass — the glossy white body core
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = pts[i * 2];
      const y = pts[i * 2 + 1];
      if (x < vx0 || x > vx1 || y < vy0 || y > vy1) continue;
      ctx.moveTo(x + r * 0.74, y);
      ctx.arc(x, y, r * 0.74, 0, TAU);
    }
    ctx.fillStyle = w.inner;
    ctx.fill();

    // rib creases — curved segment lines across the belly, bulging tail-ward
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(148,160,180,0.5)";
    ctx.lineWidth = Math.max(1.2, r * 0.17);
    ctx.beginPath();
    for (let i = 3; i < n - 1; i += 3) {
      const x = pts[i * 2];
      const y = pts[i * 2 + 1];
      if (x < vx0 || x > vx1 || y < vy0 || y > vy1) continue;
      const px = pts[(i - 3) * 2];
      const py = pts[(i - 3) * 2 + 1];
      const ta = Math.atan2(py - y, px - x);
      ctx.moveTo(x + Math.cos(ta - 1.15) * r * 0.68, y + Math.sin(ta - 1.15) * r * 0.68);
      ctx.arc(x, y, r * 0.68, ta - 1.15, ta + 1.15);
    }
    ctx.stroke();

    this.drawHead(w);
    ctx.globalAlpha = 1;
  }

  private drawHead(w: Worm) {
    const ctx = this.ctx;
    const r = w.radius;
    const ca = Math.cos(w.angle);
    const sa = Math.sin(w.angle);
    const px = -sa;
    const py = ca;

    // head base — white and just a touch bigger than the body
    ctx.beginPath();
    ctx.arc(w.x, w.y, r * 1.06, 0, TAU);
    ctx.fillStyle = w.rimDark;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(w.x, w.y, r * 0.92, 0, TAU);
    ctx.fillStyle = w.inner;
    ctx.fill();

    // the big cartoon eyes
    const steering = this.steerX * this.steerX + this.steerY * this.steerY > 900;
    const la = w.isPlayer && steering ? Math.atan2(this.steerY, this.steerX) : w.angle;
    // the artwork's huge, glossy, side-by-side eyes
    const eyeR = r * 0.62;
    const fwd = r * 0.3;
    const side = r * 0.54;
    const blink = (this.simTime + w.blinkSeed) % 3.7 < 0.12;
    for (const sgn of [-1, 1]) {
      const ex = w.x + ca * fwd + px * side * sgn;
      const ey = w.y + sa * fwd + py * side * sgn;
      ctx.beginPath();
      ctx.arc(ex, ey, eyeR, 0, TAU);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.lineWidth = Math.max(1, eyeR * 0.12);
      ctx.strokeStyle = "#b3c0d2";
      ctx.stroke();
      if (blink) {
        ctx.beginPath();
        ctx.arc(ex, ey, eyeR * 0.98, 0, TAU);
        ctx.fillStyle = w.inner;
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(ex - eyeR * 0.8, ey);
        ctx.lineTo(ex + eyeR * 0.8, ey);
        ctx.lineWidth = Math.max(1, eyeR * 0.14);
        ctx.strokeStyle = "#8fa2b4";
        ctx.stroke();
      } else {
        // iris — glassy gradient orb looking where the worm goes
        const ix = ex + Math.cos(la) * eyeR * 0.26;
        const iy = ey + Math.sin(la) * eyeR * 0.26;
        const ir = eyeR * 0.66;
        const irGrad = ctx.createRadialGradient(
          ix - ir * 0.3,
          iy - ir * 0.35,
          ir * 0.1,
          ix,
          iy,
          ir
        );
        irGrad.addColorStop(0, shade(w.eye, 0.55));
        irGrad.addColorStop(0.6, w.eye);
        irGrad.addColorStop(1, shade(w.eye, -0.5));
        ctx.beginPath();
        ctx.arc(ix, iy, ir, 0, TAU);
        ctx.fillStyle = irGrad;
        ctx.fill();
        // big dark pupil
        const gx = ex + Math.cos(la) * eyeR * 0.44;
        const gy = ey + Math.sin(la) * eyeR * 0.44;
        ctx.beginPath();
        ctx.arc(gx, gy, eyeR * 0.36, 0, TAU);
        ctx.fillStyle = "#0c1420";
        ctx.fill();
        // twin highlights — the artwork's sparkle
        ctx.beginPath();
        ctx.arc(ex - eyeR * 0.3, ey - eyeR * 0.36, eyeR * 0.19, 0, TAU);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(ex + eyeR * 0.22, ey + eyeR * 0.3, eyeR * 0.1, 0, TAU);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
      }
    }

    // the little smile — "⌣" between the eyes, on the tail side like the artwork
    const tailA = w.angle + Math.PI;
    ctx.beginPath();
    ctx.arc(w.x - ca * r * 0.16, w.y - sa * r * 0.16, r * 0.36, tailA - 0.7, tailA + 0.7);
    ctx.lineWidth = Math.max(1.5, r * 0.11);
    ctx.strokeStyle = "rgba(58,74,94,0.9)";
    ctx.lineCap = "round";
    ctx.stroke();

    // name tag
    const tagSize = Math.round(clamp(13 / this.scale, 11, 18));
    ctx.font = `bold ${tagSize}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = w.isPlayer ? "#ffd76a" : "rgba(235,243,250,0.72)";
    ctx.fillText(w.name, w.x, w.y - r - 8);
    ctx.textBaseline = "middle";
  }
}

/** food cap keeps memory flat while bursts and drops live (solo mode) */
function FOOD_CAP(): number {
  return 330;
}
