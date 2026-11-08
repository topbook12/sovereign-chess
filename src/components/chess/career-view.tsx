"use client";

/**
 * CareerView — the Career room: a gamified profile dashboard that turns the
 * whole platform into one living progression. Rating forge, battle record,
 * mastery tracks, the achievement cabinet and the arena archive, all wired
 * to the live sovereign profile.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  Award,
  BookOpen,
  Bot,
  Brain,
  CalendarCheck,
  CalendarHeart,
  ChartLine,
  Crown,
  Flame,
  Footprints,
  Gem,
  GraduationCap,
  Landmark,
  Lock,
  Medal,
  Mountain,
  Puzzle,
  Shield,
  Sparkles,
  Star,
  Swords,
  Target,
  TrendingUp,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useCareer } from "@/hooks/use-career";
import { ACHIEVEMENTS, dateKey } from "@/lib/career";
import {
  PROFILE_EVENT,
  levelFromXp,
  loadRecentGames,
  type StoredGame,
} from "@/lib/game-store";
import { OPENINGS, PUZZLES } from "@/lib/puzzles";
import { cn } from "@/lib/utils";

/* ---------------- shared bits ---------------- */

/** Entrance wrapper — the float-in feel used across the rooms. */
function FloatIn({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.2, 0.85, 0.3, 1.1] }}
    >
      {children}
    </motion.div>
  );
}

function SectionHeading({
  icon,
  title,
  meta,
}: {
  icon: ReactNode;
  title: string;
  meta?: ReactNode;
}) {
  return (
    <div className="mb-3.5 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-gold/30 bg-gradient-to-b from-gold/20 to-transparent">
          {icon}
        </span>
        <h2 className="font-display text-base font-bold tracking-wide text-gold-gradient">
          {title}
        </h2>
      </div>
      {meta}
    </div>
  );
}

function MiniStat({
  icon,
  value,
  label,
}: {
  icon: ReactNode;
  value: number | string;
  label: string;
}) {
  return (
    <div className="flex flex-col items-center">
      <span className="flex items-center gap-1 font-mono text-base font-bold text-foreground/90">
        {icon}
        {value}
      </span>
      <span className="text-[9.5px] font-semibold uppercase tracking-[0.18em] text-foreground/40">
        {label}
      </span>
    </div>
  );
}

/* ---------------- rating sparkline ---------------- */

/** Inline SVG sparkline of the last 30 rating points (gold, normalized). */
function RatingSpark({ history }: { history: { t: number; r: number }[] }) {
  const pts = history.slice(-30);
  const path =
    pts.length < 2
      ? "M 1 12 L 59 12" // flat baseline until there is a story to tell
      : (() => {
          const rs = pts.map((p) => p.r);
          const min = Math.min(...rs);
          const max = Math.max(...rs);
          const span = max - min || 1;
          return pts
            .map((p, i) => {
              const x = 1 + (i / (pts.length - 1)) * 58;
              const y = 21 - ((p.r - min) / span) * 18;
              return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
            })
            .join(" ");
        })();

  return (
    <svg
      viewBox="0 0 60 24"
      className="mt-1 h-6 w-[60px]"
      role="img"
      aria-label="Recent rating trend"
    >
      <defs>
        <linearGradient id="career-spark-gold" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#8a6a24" />
          <stop offset="55%" stopColor="#e9c96b" />
          <stop offset="100%" stopColor="#fbeec1" />
        </linearGradient>
      </defs>
      <path
        d={path}
        fill="none"
        stroke="url(#career-spark-gold)"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ---------------- mastery bar ---------------- */

function MasteryBar({
  icon,
  label,
  value,
  max,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  max: number;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground/75">
          {icon}
          {label}
        </span>
        <span className="font-mono text-[11px] text-foreground/45">
          {value}/{max}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/[0.07]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#c69c3f] via-[#e9c96b] to-[#fbeec1] transition-[width] duration-700 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/* ---------------- achievements ---------------- */

const ACHIEVEMENT_ICONS: Record<string, LucideIcon> = {
  Footprints,
  Swords,
  Zap,
  Shield,
  Medal,
  TrendingUp,
  Crown,
  Mountain,
  Brain,
  Puzzle,
  Gem,
  Target,
  GraduationCap,
  Sparkles,
  BookOpen,
  Landmark,
  CalendarCheck,
  Flame,
  CalendarHeart,
  Star,
  Award,
};

const TIER_VISUALS: Record<
  string,
  { border: string; bg: string; text: string; glow: string }
> = {
  bronze: {
    border: "border-[#cd8f4f]/40",
    bg: "bg-[#cd8f4f]/[0.08]",
    text: "text-[#cd8f4f]",
    glow: "",
  },
  silver: {
    border: "border-[#c0c7d1]/35",
    bg: "bg-[#c0c7d1]/[0.06]",
    text: "text-[#c0c7d1]",
    glow: "",
  },
  gold: {
    border: "border-[#e9c96b]/50",
    bg: "bg-[#e9c96b]/[0.08]",
    text: "text-[#e9c96b]",
    glow: "shadow-[0_0_24px_-6px_rgba(233,201,107,0.55)]",
  },
};

function AchievementTile({
  achievement,
  unlocked,
}: {
  achievement: (typeof ACHIEVEMENTS)[number];
  unlocked: boolean;
}) {
  const a = achievement;
  const t = TIER_VISUALS[a.tier] ?? TIER_VISUALS.bronze;
  const Icon = unlocked ? ACHIEVEMENT_ICONS[a.icon] ?? Award : Lock;

  return (
    <div
      title={`${a.name} — ${a.desc}`}
      className={cn(
        "rounded-xl border p-3 transition-colors",
        unlocked
          ? cn(t.border, t.bg, t.glow)
          : "border-white/8 bg-white/[0.02] opacity-60 grayscale"
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border",
            unlocked ? cn(t.border, t.bg) : "border-white/8 bg-white/[0.03]"
          )}
        >
          <Icon
            className={cn("h-4 w-4", unlocked ? t.text : "text-foreground/45")}
            strokeWidth={1.8}
          />
        </span>
        <div className="min-w-0">
          <p
            className={cn(
              "text-[12.5px] font-bold leading-tight",
              unlocked
                ? a.tier === "gold"
                  ? t.text
                  : "text-foreground/90"
                : "text-foreground/55"
            )}
          >
            {a.name}
          </p>
          <p className="mt-0.5 text-[10.5px] leading-snug text-foreground/45">
            {a.desc}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ---------------- recent games ---------------- */

function ResultBadge({ result }: { result: StoredGame["result"] }) {
  if (result === "1-0") {
    return (
      <span className="shrink-0 rounded-md border border-[#fbeec1]/35 bg-[#fbeec1]/10 px-2 py-1 font-mono text-[11px] font-bold text-[#fdf6dc]">
        1-0
      </span>
    );
  }
  if (result === "0-1") {
    return (
      <span className="shrink-0 rounded-md border border-white/15 bg-black/40 px-2 py-1 font-mono text-[11px] font-bold text-foreground/75">
        0-1
      </span>
    );
  }
  if (result === "1/2-1/2") {
    return (
      <span className="shrink-0 rounded-md border border-gold/40 bg-gold/10 px-2 py-1 font-mono text-[11px] font-bold text-gold-soft">
        ½–½
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-md border border-white/10 bg-white/5 px-2 py-1 font-mono text-[11px] font-bold text-foreground/50">
      ·—·
    </span>
  );
}

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/* ================================================================ */
/* main view                                                        */
/* ================================================================ */

export function CareerView({ onGoAnalyze }: { onGoAnalyze?: () => void }) {
  const career = useCareer();
  const lvl = levelFromXp(career.xp);
  const trainedToday = career.lastActiveDate === dateKey();

  const [games, setGames] = useState<StoredGame[]>([]);
  useEffect(() => {
    // initial read is deferred (non-cascading); the profile event keeps the
    // archive live when a fresh duel is committed while this room is open
    const refresh = () => setGames(loadRecentGames());
    const t = window.setTimeout(refresh, 0);
    window.addEventListener(PROFILE_EVENT, refresh);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener(PROFILE_EVENT, refresh);
    };
  }, []);

  const last14 = useMemo(
    () => Array.from({ length: 14 }, (_, i) => dateKey(i - 13)),
    []
  );
  const activeDays = useMemo(
    () => new Set(career.activityDays),
    [career.activityDays]
  );

  /* battle record math */
  const total = career.wins + career.draws + career.losses;
  const winRate = total > 0 ? Math.round((career.wins / total) * 100) : 0;
  const wPct = total > 0 ? (career.wins / total) * 100 : 0;
  const dPct = total > 0 ? (career.draws / total) * 100 : 0;
  const lPct = total > 0 ? (career.losses / total) * 100 : 0;

  /* mastery math */
  const drill = Math.min(career.drillWins, 10);
  const arena = Math.min(career.gamesPlayed, 50);
  const unlockedCount = career.achievements.length;
  const unlockedSet = useMemo(
    () => new Set(career.achievements),
    [career.achievements]
  );

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      {/* ============================ hero ============================ */}
      <section aria-label="Sovereign profile">
        <FloatIn className="glass-panel rounded-2xl p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
            {/* left — crown avatar, level, xp */}
            <div className="flex min-w-[230px] flex-1 items-center gap-3">
              <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-gold/40 bg-gradient-to-b from-gold/25 to-transparent">
                <Crown className="h-7 w-7 text-gold-soft" strokeWidth={1.6} />
                <span className="absolute -bottom-1.5 -right-1.5 rounded-full border border-[#8a6a24] bg-gradient-to-b from-[#ecca6f] to-[#c69c3f] px-1.5 py-px font-mono text-[10px] font-black text-[#241a05]">
                  {lvl.level}
                </span>
              </div>
              <div className="min-w-[160px] flex-1">
                <p className="font-display text-lg font-black tracking-wide text-gold-gradient">
                  {lvl.title}
                </p>
                <p className="text-[11px] text-foreground/45">
                  {lvl.into}/{lvl.span} XP to level {lvl.level + 1}
                </p>
                <Progress
                  value={(lvl.into / lvl.span) * 100}
                  className="mt-2 h-2"
                />
              </div>
            </div>

            {/* right — rating + sparkline + chips */}
            <div className="flex items-center gap-4">
              <div>
                <div className="flex items-baseline gap-1.5">
                  <span className="font-mono text-3xl font-bold text-gold-gradient">
                    {career.rating}
                  </span>
                  <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-foreground/40">
                    elo
                  </span>
                </div>
                <RatingSpark history={career.ratingHistory} />
              </div>

              <div className="flex flex-col gap-1.5">
                <div
                  className="flex items-center gap-1.5 rounded-full border border-gold/30 bg-gradient-to-b from-gold/15 to-transparent px-3 py-1.5 text-xs"
                  aria-label={`${career.crowns} crowns`}
                >
                  <Crown className="h-3.5 w-3.5 text-gold-soft" />
                  <b className="font-mono text-foreground/90">{career.crowns}</b>
                </div>
                <div
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors",
                    trainedToday
                      ? "border-orange-400/40 bg-orange-400/10"
                      : "border-white/10 bg-white/5 opacity-80"
                  )}
                  aria-label={`${career.dailyStreak}-day training streak`}
                >
                  <Flame
                    className={cn(
                      "h-3.5 w-3.5",
                      trainedToday ? "text-orange-300" : "text-foreground/40"
                    )}
                  />
                  <b
                    className={cn(
                      "font-mono",
                      trainedToday ? "text-orange-200" : "text-foreground/60"
                    )}
                  >
                    {career.dailyStreak}
                  </b>
                </div>
              </div>
            </div>
          </div>

          {/* last-14-days activity dots */}
          <div
            className="mt-4 flex items-center gap-1.5 border-t border-white/6 pt-3.5"
            role="img"
            aria-label="Training activity over the last 14 days"
          >
            <span className="mr-1 text-[9.5px] font-semibold uppercase tracking-[0.18em] text-foreground/35">
              14d
            </span>
            {last14.map((key) => {
              const active = activeDays.has(key);
              return (
                <span
                  key={key}
                  title={key}
                  className={cn(
                    "h-2.5 w-2.5 rounded-full",
                    active
                      ? "bg-gold shadow-[0_0_8px_rgba(233,201,107,0.75)]"
                      : "border border-white/15"
                  )}
                />
              );
            })}
          </div>
        </FloatIn>
      </section>

      {/* ======================= battle record ======================= */}
      <section aria-label="Battle record">
        <FloatIn
          delay={0.06}
          className="glass-panel rounded-2xl p-4 sm:p-5"
        >
          <SectionHeading
            icon={<Swords className="h-4 w-4 text-gold-soft" />}
            title="Battle Record"
            meta={
              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/45">
                {career.gamesPlayed} games
              </span>
            }
          />
          <p className="-mt-1.5 mb-3.5 flex items-center gap-1.5 text-[11.5px] italic text-foreground/45">
            <Bot className="h-3.5 w-3.5 shrink-0 text-gold-soft/70" />
            Your ELO is forged in the arena — beat stronger personas to climb
            faster.
          </p>

          <div className="flex flex-wrap items-end gap-x-7 gap-y-3">
            <div>
              <span className="font-mono text-3xl font-bold text-emerald-300">
                {career.wins}
              </span>
              <p className="mt-0.5 text-[9.5px] font-semibold uppercase tracking-[0.18em] text-foreground/40">
                Wins
              </p>
            </div>
            <div>
              <span className="font-mono text-3xl font-bold text-gold-soft">
                {career.draws}
              </span>
              <p className="mt-0.5 text-[9.5px] font-semibold uppercase tracking-[0.18em] text-foreground/40">
                Draws
              </p>
            </div>
            <div>
              <span className="font-mono text-3xl font-bold text-red-300/90">
                {career.losses}
              </span>
              <p className="mt-0.5 text-[9.5px] font-semibold uppercase tracking-[0.18em] text-foreground/40">
                Losses
              </p>
            </div>
          </div>

          {/* segmented win-rate bar */}
          <div className="mt-4">
            <div
              className="flex h-2.5 overflow-hidden rounded-full bg-white/[0.07]"
              role="img"
              aria-label={`Win rate ${winRate} percent`}
            >
              {total > 0 && (
                <>
                  <div
                    className="bg-emerald-400/90"
                    style={{ width: `${wPct}%` }}
                  />
                  <div className="bg-gold/80" style={{ width: `${dPct}%` }} />
                  <div
                    className="bg-red-400/80"
                    style={{ width: `${lPct}%` }}
                  />
                </>
              )}
            </div>
            <div className="mt-1.5 flex items-center justify-between text-[10.5px] text-foreground/45">
              <span>
                <b className="font-mono text-gold-soft">{winRate}%</b> win rate
              </span>
              <span className="hidden sm:inline">
                W · D · L — emerald · gold · red
              </span>
              <span>{total} decided</span>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-around gap-4 border-t border-white/6 pt-3.5">
            <MiniStat
              icon={<Zap className="h-4 w-4 text-gold-soft" />}
              value={career.currentWinStreak}
              label="Win Streak"
            />
            <MiniStat
              icon={<TrendingUp className="h-4 w-4 text-emerald-300" />}
              value={career.bestWinStreak}
              label="Best Streak"
            />
            <MiniStat
              icon={<Swords className="h-4 w-4 text-gold-soft/80" />}
              value={career.gamesPlayed}
              label="Total Games"
            />
          </div>
        </FloatIn>
      </section>

      {/* ========================= mastery ========================= */}
      <section aria-label="Mastery progress">
        <FloatIn delay={0.12} className="glass-panel rounded-2xl p-4 sm:p-5">
          <SectionHeading
            icon={<Brain className="h-4 w-4 text-gold-soft" />}
            title="Mastery"
            meta={
              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/45">
                {Math.round(
                  ((career.solvedPuzzles.length +
                    drill +
                    career.openingsDone.length +
                    arena) /
                    (PUZZLES.length + 10 + OPENINGS.length + 50)) *
                    100
                )}
                % overall
              </span>
            }
          />
          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <MasteryBar
              icon={<Brain className="h-3.5 w-3.5 text-emerald-300" />}
              label="Tactics"
              value={career.solvedPuzzles.length}
              max={PUZZLES.length}
            />
            <MasteryBar
              icon={<Crown className="h-3.5 w-3.5 text-gold-soft" />}
              label="Endgame"
              value={drill}
              max={10}
            />
            <MasteryBar
              icon={<BookOpen className="h-3.5 w-3.5 text-gold-soft/80" />}
              label="Openings"
              value={career.openingsDone.length}
              max={OPENINGS.length}
            />
            <MasteryBar
              icon={<Swords className="h-3.5 w-3.5 text-emerald-300/80" />}
              label="Arena"
              value={arena}
              max={50}
            />
          </div>
        </FloatIn>
      </section>

      {/* ======================= achievements ======================= */}
      <section aria-label="Achievements">
        <FloatIn delay={0.18} className="glass-panel rounded-2xl p-4 sm:p-5">
          <SectionHeading
            icon={<Medal className="h-4 w-4 text-gold-soft" />}
            title={`Achievements — ${unlockedCount}/${ACHIEVEMENTS.length}`}
          />
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
            {ACHIEVEMENTS.map((a) => (
              <AchievementTile
                key={a.id}
                achievement={a}
                unlocked={unlockedSet.has(a.id)}
              />
            ))}
          </div>
        </FloatIn>
      </section>

      {/* ===================== recent arena games ===================== */}
      <section aria-label="Recent arena games">
        <FloatIn delay={0.24} className="glass-panel rounded-2xl p-4 sm:p-5">
          <SectionHeading
            icon={<ChartLine className="h-4 w-4 text-gold-soft" />}
            title="Recent Duels"
            meta={
              games.length > 0 ? (
                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/45">
                  {games.length} saved
                </span>
              ) : undefined
            }
          />

          {games.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-8 text-center">
              <Swords className="h-6 w-6 text-gold-soft/70" />
              <p className="text-[13px] text-foreground/55">
                No duels yet — the arena awaits.
              </p>
            </div>
          ) : (
            <ul
              className="scroll-slim max-h-72 space-y-2 overflow-y-auto pr-1"
              aria-label="Recent games"
            >
              {games.map((g, i) => (
                <li
                  key={g.id}
                  className="float-in flex items-center gap-3 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5"
                  style={{ animationDelay: `${Math.min(i, 8) * 0.05}s` }}
                >
                  <ResultBadge result={g.result} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-foreground/85">
                      {g.label}
                    </p>
                    <p className="truncate text-[11px] text-foreground/40">
                      {g.reason ? g.reason : `${g.plies} plies`}
                    </p>
                  </div>
                  <span className="shrink-0 font-mono text-[10.5px] text-foreground/40">
                    {timeAgo(g.date)}
                  </span>
                  <Button
                    type="button"
                    onClick={onGoAnalyze}
                    aria-label={`Analyze ${g.label}`}
                    className="h-11 shrink-0 border border-[#8a6a24]/50 bg-gradient-to-b from-[#ecca6f] to-[#c69c3f] px-3.5 text-xs font-semibold text-[#241a05] hover:from-[#f3d887] hover:to-[#d4a94e]"
                  >
                    Analyze
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </FloatIn>
      </section>
    </div>
  );
}
