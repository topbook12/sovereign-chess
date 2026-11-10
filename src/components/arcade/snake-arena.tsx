"use client";

/**
 * Sovereign Chess — Snake Arena (slither-style stake duel).
 *
 * Two players, one device, ONE seed. Each runner gets a 90-second run in
 * the identical seeded deep — same food queue, same patrol bots, same
 * crimson wall — and the higher score takes the pot. Dying early is the
 * risk you took. Free practice runs the same ceremony with playground
 * bots (they eat, boost, die and respawn) and zero stakes.
 *
 * Controls — mobile: drag anywhere to steer, second finger or the BOOST
 * thumb-button to sprint; desktop: mouse steers, hold left-click or
 * Space to boost. Boost burns mass for speed.
 */

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Crown, Timer, Trophy, Zap } from "lucide-react";
import type { ArcadeGameProps } from "@/lib/arcade-types";
import { GameFrame, PassDevice } from "@/components/arcade/kit";
import { ArenaEngine, type ArenaHud } from "@/lib/arena-engine";
import { pulse } from "@/lib/haptics";
import { cn } from "@/lib/utils";

const RUN_SECONDS = 90;
const BEST_KEY = "sovereign.arena.best";

type Phase = "countdown" | "running" | "over" | "handoff" | "final";

const EMPTY_HUD: ArenaHud = { score: 0, timeLeft: RUN_SECONDS, alive: true, leaders: [] };

export function SnakeArenaGame({ players, practice, onFinish, onExit }: ArcadeGameProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<ArenaEngine | null>(null);
  const seedRef = useRef<number | null>(null);
  if (seedRef.current === null) {
    seedRef.current = ((Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0) || 1;
  }

  const [runIndex, setRunIndex] = useState<0 | 1>(0);
  const [phase, setPhase] = useState<Phase>("countdown");
  const [count, setCount] = useState<number | null>(3);
  const [scores, setScores] = useState<[number | null, number | null]>([null, null]);
  const [endInfo, setEndInfo] = useState<{ score: number; cause: string } | null>(null);
  const [hud, setHud] = useState<ArenaHud>(EMPTY_HUD);
  const [best, setBest] = useState(0);

  const runIndexRef = useRef<0 | 1>(0);
  const phaseRef = useRef<Phase>("countdown");
  const scoresRef = useRef<[number | null, number | null]>([null, null]);
  const firedRef = useRef(false);
  runIndexRef.current = runIndex;
  phaseRef.current = phase;

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(BEST_KEY);
      if (raw) setBest(Math.max(0, parseInt(raw, 10) || 0));
    } catch {
      /* private mode — session only */
    }
  }, []);

  /* ---------------- run end ---------------- */

  const runEndedRef = useRef<(score: number, cause: string, isTime: boolean) => void>(() => {});
  runEndedRef.current = (score, cause, isTime) => {
    if (phaseRef.current !== "running") return;
    const ri = runIndexRef.current;
    scoresRef.current[ri] = score;
    setScores([scoresRef.current[0], scoresRef.current[1]]);
    setEndInfo({ score, cause });
    setPhase("over");
    pulse(isTime ? "levelup" : "illegal");
    setBest((b) => {
      const nb = Math.max(b, score);
      try {
        window.localStorage.setItem(BEST_KEY, String(nb));
      } catch {
        /* session only */
      }
      return nb;
    });
    window.setTimeout(() => {
      if (ri === 0) {
        setPhase("handoff");
      } else {
        setPhase("final");
        window.setTimeout(() => {
          if (firedRef.current) return;
          firedRef.current = true;
          const [s0, s1] = scoresRef.current;
          const a = s0 ?? 0;
          const b = s1 ?? 0;
          const winner = a === b ? null : a > b ? 0 : 1;
          const note =
            winner === null
              ? "Dead heat — identical scores, both stakes come home."
              : `${players[winner].name} outslithered ${players[winner === 0 ? 1 : 0].name} — ${Math.max(a, b)} vs ${Math.min(a, b)}.`;
          onFinish({ winner, scores: [a, b], note });
        }, 1750);
      }
    }, 1250);
  };

  /* ---------------- engine lifecycle (one per run) ---------------- */

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const engine = new ArenaEngine(canvas, {
      seed: seedRef.current ?? 1,
      mode: practice ? "solo" : "duel",
      durationSec: RUN_SECONDS,
      playerName: players[runIndex].name,
      callbacks: {
        onEat: (v) => {
          if (v >= 3) pulse("tick");
        },
        onKill: () => pulse("capture"),
        onDeath: (info) => runEndedRef.current(info.score, info.cause, false),
        onTimeUp: (score) => runEndedRef.current(score, "Time!", true),
      },
    });
    engineRef.current = engine;
    engine.resize(
      wrap.clientWidth,
      wrap.clientHeight,
      dpr,
      window.innerWidth < 1024 ? 150 : 20
    );
    engine.setPaused(true);
    engine.start();
    setHud(engine.getHud());

    // 3 · 2 · 1 — then the deep wakes up
    let n = 3;
    setCount(3);
    const iv = window.setInterval(() => {
      n -= 1;
      if (n <= 0) {
        window.clearInterval(iv);
        setCount(null);
        engine.setPaused(false);
        setPhase("running");
        pulse("achievement");
      } else {
        setCount(n);
        pulse("tick");
      }
    }, 800);

    return () => {
      window.clearInterval(iv);
      engine.dispose();
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, [runIndex]);

  // keep the canvas fitted
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => {
      const e = engineRef.current;
      if (e)
        e.resize(
          wrap.clientWidth,
          wrap.clientHeight,
          Math.min(window.devicePixelRatio || 1, 2),
          window.innerWidth < 1024 ? 150 : 20
        );
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  // HUD polling while a run is live
  useEffect(() => {
    if (phase !== "running") return;
    const iv = window.setInterval(() => {
      const e = engineRef.current;
      if (e) setHud(e.getHud());
    }, 180);
    return () => window.clearInterval(iv);
  }, [phase]);

  // switching tabs never farms free seconds — the run freezes
  useEffect(() => {
    const onVis = () => {
      const e = engineRef.current;
      if (!e) return;
      if (document.hidden) e.setPaused(true);
      else if (phaseRef.current === "running") e.setPaused(false);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  /* ---------------- input ---------------- */

  const btnBoostRef = useRef(false);
  const mouseBoostRef = useRef(false);
  const keyBoostRef = useRef(false);
  const touchBoostRef = useRef(false);
  const pointersRef = useRef<Set<number>>(new Set());

  const applyBoost = useCallback(() => {
    const on =
      btnBoostRef.current || mouseBoostRef.current || keyBoostRef.current || touchBoostRef.current;
    engineRef.current?.setBoost(on);
  }, []);

  const steerFrom = useCallback((e: ReactPointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    engineRef.current?.setSteer(
      e.clientX - (r.left + r.width / 2),
      e.clientY - (r.top + r.height / 2)
    );
  }, []);

  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        keyBoostRef.current = true;
        applyBoost();
      }
    };
    const ku = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        keyBoostRef.current = false;
        applyBoost();
      }
    };
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    return () => {
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
    };
  }, [applyBoost]);

  /* ---------------- render ---------------- */

  const timeLeft = Math.ceil(hud.timeLeft);
  const timeDanger = hud.timeLeft <= 10;

  return (
    <>
      <GameFrame
        title="Snake Arena"
        players={players}
        scores={[
          scores[0] === null ? <span className="text-foreground/30">—</span> : scores[0],
          scores[1] === null ? <span className="text-foreground/30">—</span> : scores[1],
        ]}
        turn={phase === "handoff" ? 1 : runIndex}
        turnLabel={[
          phase === "handoff" ? "Run complete" : "On the stick",
          phase === "handoff" ? "Next run" : runIndex === 1 ? "On the stick" : "Waiting",
        ]}
        onExit={onExit}
      >
        <div
          ref={wrapRef}
          className="relative min-h-0 w-full flex-1 touch-none overflow-hidden rounded-2xl border border-white/10 bg-[#1c3554] shadow-[0_18px_60px_-18px_rgba(0,0,0,0.8)]"
        >
          <canvas
            ref={canvasRef}
            className="absolute inset-0 h-full w-full"
            onPointerDown={(e) => {
              pointersRef.current.add(e.pointerId);
              steerFrom(e);
              if (e.pointerType === "mouse") {
                mouseBoostRef.current = true;
                applyBoost();
              } else if (pointersRef.current.size >= 2) {
                touchBoostRef.current = true;
                applyBoost();
              }
            }}
            onPointerMove={(e) => {
              if (e.pointerType === "mouse" || pointersRef.current.has(e.pointerId)) steerFrom(e);
            }}
            onPointerUp={(e) => {
              pointersRef.current.delete(e.pointerId);
              if (e.pointerType === "mouse") {
                mouseBoostRef.current = false;
                applyBoost();
              } else if (pointersRef.current.size < 2 && touchBoostRef.current) {
                touchBoostRef.current = false;
                applyBoost();
              }
            }}
            onPointerCancel={(e) => {
              pointersRef.current.delete(e.pointerId);
              if (e.pointerType === "mouse") {
                mouseBoostRef.current = false;
              } else if (pointersRef.current.size < 2) {
                touchBoostRef.current = false;
              }
              applyBoost();
            }}
            aria-label="Snake Arena playfield — drag to steer, second finger to boost"
          />

          {/* score card */}
          <div className="pointer-events-none absolute left-3 top-3 rounded-xl border border-white/12 bg-black/55 px-3 py-2 backdrop-blur-sm">
            <p className="text-[9px] font-black uppercase tracking-[0.22em] text-foreground/45">
              Score
            </p>
            <p className="font-mono text-2xl font-black leading-none tabular-nums text-gold-soft">
              {hud.score}
            </p>
            <p className="mt-1 text-[9.5px] font-bold text-foreground/45">
              Best <span className="font-mono text-foreground/60">{Math.max(best, hud.score)}</span>
            </p>
          </div>

          {/* timer */}
          {(phase === "running" || phase === "over") && (
            <div
              className={cn(
                "pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-xl border px-3 py-1.5 backdrop-blur-sm",
                timeDanger
                  ? "border-red-400/50 bg-red-500/15 text-red-200"
                  : "border-white/12 bg-black/55 text-foreground/75"
              )}
            >
              <p className="flex items-center gap-1.5 font-mono text-lg font-black tabular-nums">
                <Timer className="h-4 w-4" />
                {timeLeft}s
              </p>
            </div>
          )}

          {/* leaderboard */}
          {hud.leaders.length > 0 && (
            <div className="pointer-events-none absolute right-3 top-3 w-32 rounded-xl border border-white/12 bg-black/55 p-2 backdrop-blur-sm sm:w-40">
              <p className="mb-1 flex items-center gap-1 text-[9px] font-black uppercase tracking-[0.2em] text-foreground/45">
                <Trophy className="h-3 w-3" /> Deep Five
              </p>
              <div className="grid gap-0.5">
                {hud.leaders.map((row, i) => (
                  <p
                    key={row.name + i}
                    className={cn(
                      "flex items-center gap-1.5 text-[10.5px] font-bold leading-tight",
                      row.me ? "text-gold-soft" : "text-foreground/60"
                    )}
                  >
                    <span className="w-3 shrink-0 text-right font-mono text-[9px] text-foreground/35">
                      {i + 1}
                    </span>
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: row.eye }}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate">{row.name}</span>
                    <span className="shrink-0 font-mono tabular-nums">{row.score}</span>
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* boost thumb-button — clears the mobile nav island */}
          <button
            type="button"
            aria-label="Boost — hold to sprint"
            onPointerDown={(e) => {
              e.preventDefault();
              btnBoostRef.current = true;
              applyBoost();
            }}
            onPointerUp={() => {
              btnBoostRef.current = false;
              applyBoost();
            }}
            onPointerCancel={() => {
              btnBoostRef.current = false;
              applyBoost();
            }}
            onPointerLeave={() => {
              btnBoostRef.current = false;
              applyBoost();
            }}
            onContextMenu={(e) => e.preventDefault()}
            className="absolute bottom-40 right-4 grid h-20 w-20 touch-none select-none place-items-center rounded-full border border-gold/50 bg-gradient-to-b from-gold/25 to-black/50 text-gold-soft shadow-[0_10px_30px_-8px_rgba(0,0,0,0.8)] backdrop-blur-sm transition-transform active:scale-90 lg:bottom-5 sm:h-24 sm:w-24"
          >
            <Zap className="h-7 w-7 sm:h-8 sm:w-8" aria-hidden="true" />
            <span className="mt-0.5 text-[9px] font-black uppercase tracking-[0.24em]">Boost</span>
          </button>

          {/* control hint — beside the minimap, clear of the nav island */}
          <p className="pointer-events-none absolute bottom-[10.5rem] left-[8.75rem] max-w-[150px] text-[9.5px] font-semibold leading-snug text-foreground/40 sm:text-[10.5px] lg:bottom-24 lg:max-w-[220px]">
            Drag to steer · second finger or button to boost · boost burns mass
          </p>

          {/* countdown */}
          {count !== null && (
            <div className="absolute inset-0 grid place-items-center bg-black/40">
              <div className="text-center">
                <p
                  key={count}
                  className="font-display animate-pulse text-8xl font-black leading-none text-gold-gradient"
                >
                  {count}
                </p>
                <p className="mt-3 text-[11px] font-black uppercase tracking-[0.3em] text-foreground/55">
                  {players[runIndex].name} — glide!
                </p>
              </div>
            </div>
          )}

          {/* run-over flash */}
          {phase === "over" && endInfo && (
            <div className="absolute inset-0 grid place-items-center bg-black/50 px-6">
              <div className="text-center">
                <p className="text-4xl" aria-hidden="true">
                  💀
                </p>
                <p className="font-display mt-2 text-4xl font-black text-gold-gradient">
                  {endInfo.score}
                </p>
                <p className="mt-1 text-[12px] font-bold text-foreground/65">{endInfo.cause}</p>
              </div>
            </div>
          )}

          {/* final comparison */}
          {phase === "final" && (
            <div className="absolute inset-0 grid place-items-center bg-black/55 px-6">
              <div className="glass-panel w-full max-w-xs rounded-2xl p-5 text-center">
                <Crown className="mx-auto h-7 w-7 text-gold-soft" aria-hidden="true" />
                <h4 className="font-display mt-1 text-xl font-black text-gold-gradient">
                  Final scores
                </h4>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {[0, 1].map((i) => (
                    <div
                      key={i}
                      className={cn(
                        "rounded-xl border px-2 py-2.5",
                        scores[0] !== null &&
                          scores[1] !== null &&
                          scores[i] === Math.max(scores[0], scores[1]) &&
                          scores[0] !== scores[1]
                          ? "border-gold/50 bg-gold/10"
                          : "border-white/10 bg-white/[0.03]"
                      )}
                    >
                      <p className="truncate text-[11px] font-black text-foreground/75">
                        {players[i].emoji} {players[i].name}
                      </p>
                      <p className="font-mono text-2xl font-black tabular-nums text-gold-soft">
                        {scores[i] ?? 0}
                      </p>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[11px] font-semibold text-foreground/55">
                  Settling the pot…
                </p>
              </div>
            </div>
          )}
        </div>
      </GameFrame>

      {/* hand-over ceremony between the two runs */}
      {phase === "handoff" && (
        <PassDevice
          from={players[0]}
          to={players[1]}
          note={`Same seed, same deep — a ${RUN_SECONDS}-second score run each. ${players[0].name} scored ${scores[0] ?? 0}.`}
          onReady={() => {
            pulse("tick");
            setEndInfo(null);
            setRunIndex(1);
            setPhase("countdown");
          }}
        />
      )}
    </>
  );
}

export default SnakeArenaGame;
