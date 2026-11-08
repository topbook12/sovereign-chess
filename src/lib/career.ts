/**
 * Sovereign Chess — the Career engine.
 * Every reward on the platform flows through this module: ELO rating moves,
 * crowns, XP, daily training streaks and achievement unlocks. It keeps the
 * whole experience feeling like one living progression system.
 */

import { toast } from "sonner";
import confetti from "canvas-confetti";
import { loadProfile, updateProfile, levelFromXp, type CareerProfile } from "@/lib/game-store";
import { playSound } from "@/lib/sounds";

export type Difficulty = "easy" | "medium" | "hard" | "master";
export type Outcome = "win" | "draw" | "loss";

/** The persona strength of each arena opponent. */
export const BOT_RATINGS: Record<Difficulty, number> = {
  easy: 900,
  medium: 1400,
  hard: 1800,
  master: 2200,
};

export const BOT_NAMES: Record<Difficulty, string> = {
  easy: "The Apprentice",
  medium: "The Knight",
  hard: "The Grandmaster",
  master: "The Sovereign",
};

/** Crowns charged for one whisper of the oracle (in-game hint). */
export const HINT_COST = 10;

/* ================================================================== */
/* dates                                                              */
/* ================================================================== */

export function dateKey(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/* ================================================================== */
/* achievements                                                       */
/* ================================================================== */

export type AchievementTier = "bronze" | "silver" | "gold";

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  tier: AchievementTier;
  icon: string; // lucide icon key, mapped in the career view
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: "first-game", name: "First Steps", desc: "Finish your first arena game", tier: "bronze", icon: "Footprints" },
  { id: "first-win", name: "First Conquest", desc: "Win a game in the arena", tier: "bronze", icon: "Swords" },
  { id: "win-streak-3", name: "Trinity", desc: "Win 3 games in a row", tier: "silver", icon: "Zap" },
  { id: "games-10", name: "Court Veteran", desc: "Play 10 arena games", tier: "silver", icon: "Shield" },
  { id: "games-50", name: "War-Hardened", desc: "Play 50 arena games", tier: "gold", icon: "Medal" },
  { id: "rating-1300", name: "Rising Star", desc: "Reach a 1300 rating", tier: "silver", icon: "TrendingUp" },
  { id: "rating-1600", name: "Crown Champion", desc: "Reach a 1600 rating", tier: "gold", icon: "Crown" },
  { id: "rating-1900", name: "Grandmaster's Nightmare", desc: "Reach a 1900 rating", tier: "gold", icon: "Mountain" },
  { id: "puzzle-5", name: "Tactics Initiate", desc: "Solve 5 puzzles", tier: "bronze", icon: "Brain" },
  { id: "puzzle-10", name: "Mind Sharpened", desc: "Solve 10 puzzles", tier: "silver", icon: "Puzzle" },
  { id: "puzzle-all", name: "Puzzle Sovereign", desc: "Solve every puzzle in the academy", tier: "gold", icon: "Gem" },
  { id: "puzzle-streak-5", name: "In the Zone", desc: "Hit a 5 puzzle win streak", tier: "silver", icon: "Target" },
  { id: "drill-win", name: "Endgame Adept", desc: "Mate with King & Queen in the drill", tier: "bronze", icon: "GraduationCap" },
  { id: "drill-fast", name: "Blitz Coronation", desc: "Win the drill in 8 moves or fewer", tier: "gold", icon: "Sparkles" },
  { id: "opening-1", name: "Opener", desc: "Master your first opening", tier: "bronze", icon: "BookOpen" },
  { id: "opening-all", name: "Royal Librarian", desc: "Master every opening lesson", tier: "gold", icon: "Landmark" },
  { id: "daily-first", name: "Daily Devotion", desc: "Complete a Daily Challenge", tier: "bronze", icon: "CalendarCheck" },
  { id: "daily-3", name: "Devoted", desc: "Train 3 days in a row", tier: "silver", icon: "Flame" },
  { id: "daily-7", name: "Week of the Crown", desc: "Train 7 days in a row", tier: "gold", icon: "CalendarHeart" },
  { id: "level-5", name: "Adept Mind", desc: "Reach level 5", tier: "silver", icon: "Star" },
  { id: "level-10", name: "Living Legend", desc: "Reach level 10", tier: "gold", icon: "Award" },
];

export const ACHIEVEMENT_BY_ID: Record<string, Achievement> = Object.fromEntries(
  ACHIEVEMENTS.map((a) => [a.id, a])
);

const GOLD_STYLE = { color: "#e9c96b", icon: "👑" } as const;

function evaluateAchievements(p: CareerProfile, totalPuzzles: number, totalOpenings: number): string[] {
  const lvl = levelFromXp(p.xp).level;
  const rules: Record<string, boolean> = {
    "first-game": p.gamesPlayed >= 1,
    "first-win": p.wins >= 1,
    "win-streak-3": p.bestWinStreak >= 3,
    "games-10": p.gamesPlayed >= 10,
    "games-50": p.gamesPlayed >= 50,
    "rating-1300": p.rating >= 1300,
    "rating-1600": p.rating >= 1600,
    "rating-1900": p.rating >= 1900,
    "puzzle-5": p.solvedPuzzles.length >= 5,
    "puzzle-10": p.solvedPuzzles.length >= 10,
    "puzzle-all": totalPuzzles > 0 && p.solvedPuzzles.length >= totalPuzzles,
    "puzzle-streak-5": p.bestStreak >= 5,
    "drill-win": p.drillWins >= 1,
    "drill-fast": p.drillBest !== null && p.drillBest <= 8,
    "opening-1": p.openingsDone.length >= 1,
    "opening-all": totalOpenings > 0 && p.openingsDone.length >= totalOpenings,
    "daily-first": p.dailyDoneDate !== null,
    "daily-3": p.bestDailyStreak >= 3,
    "daily-7": p.bestDailyStreak >= 7,
    "level-5": lvl >= 5,
    "level-10": lvl >= 10,
  };
  return Object.entries(rules)
    .filter(([id, ok]) => ok && !p.achievements.includes(id))
    .map(([id]) => id);
}

/* ================================================================== */
/* streaks                                                            */
/* ================================================================== */

const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100];

function markActivity(p: CareerProfile): CareerProfile {
  const today = dateKey();
  if (p.lastActiveDate === today) return p;
  const yesterday = dateKey(-1);
  const streak = p.lastActiveDate === yesterday ? p.dailyStreak + 1 : 1;
  const days = p.activityDays.includes(today)
    ? p.activityDays
    : [...p.activityDays, today].slice(-60);
  return {
    ...p,
    dailyStreak: streak,
    bestDailyStreak: Math.max(p.bestDailyStreak, streak),
    lastActiveDate: today,
    activityDays: days,
  };
}

/* ================================================================== */
/* rating (ELO vs the engine personas)                                */
/* ================================================================== */

function eloDelta(rating: number, bot: number, outcome: Outcome): number {
  const expected = 1 / (1 + Math.pow(10, (bot - rating) / 400));
  const score = outcome === "win" ? 1 : outcome === "draw" ? 0.5 : 0;
  const k = rating < 1300 ? 40 : rating < 1800 ? 28 : 18;
  return Math.max(-45, Math.min(45, Math.round(k * (score - expected))));
}

const WIN_XP_BONUS: Record<Difficulty, number> = { easy: 0, medium: 12, hard: 28, master: 55 };

/* ================================================================== */
/* commit pipeline                                                    */
/* ================================================================== */

const CONFETTI_COLORS = ["#e9c96b", "#c9a24b", "#38e0af", "#fdf6dc"];

interface CommitContext {
  /** puzzle & opening totals for achievement evaluation */
  totalPuzzles: number;
  totalOpenings: number;
  /** main toast shown immediately */
  main: { title: string; description?: string } | null;
  /** fire the golden win burst */
  celebrate?: boolean;
}

function commit(
  mutate: (p: CareerProfile) => CareerProfile,
  ctx: CommitContext
): void {
  const before = loadProfile();
  const unlockedBefore = new Set(before.achievements);
  const levelBefore = levelFromXp(before.xp).level;

  const next = updateProfile((prev) => {
    let p = mutate(prev);
    p = markActivity(p);
    const newIds = evaluateAchievements(p, ctx.totalPuzzles, ctx.totalOpenings);
    if (newIds.length > 0) {
      p = {
        ...p,
        achievements: [...p.achievements, ...newIds],
        crowns: p.crowns + newIds.length * 15,
      };
    }
    return p;
  });

  const levelAfter = levelFromXp(next.xp).level;

  if (ctx.main) {
    toast(ctx.main.title, {
      description: ctx.main.description,
      ...(next.xp > before.xp ? {} : {}),
    });
  }

  // achievement unlocks — staggered so each one gets its moment
  const newIds = next.achievements.filter((id) => !unlockedBefore.has(id));
  newIds.forEach((id, i) => {
    const a = ACHIEVEMENT_BY_ID[id];
    if (!a) return;
    window.setTimeout(() => {
      playSound("achievement");
      toast.success(`${a.tier === "gold" ? "👑 " : "🏅 "}Achievement — ${a.name}`, {
        description: `${a.desc} · +15 crowns`,
        duration: 5200,
      });
    }, 650 + i * 700);
  });

  // level up — the big moment
  if (levelAfter > levelBefore) {
    const lvl = levelFromXp(next.xp);
    window.setTimeout(() => {
      playSound("levelup");
      confetti({
        particleCount: 160,
        spread: 110,
        startVelocity: 42,
        origin: { y: 0.4 },
        colors: CONFETTI_COLORS,
        scalar: 1,
      });
      toast.success(`⬆️ Level ${lvl.level} — ${lvl.title}`, {
        description: "Your mind grows sharper. The court takes notice.",
        duration: 6500,
      });
    }, 250);
  } else if (ctx.celebrate) {
    window.setTimeout(() => {
      confetti({
        particleCount: 110,
        spread: 95,
        startVelocity: 36,
        origin: { y: 0.35 },
        colors: CONFETTI_COLORS,
        scalar: 0.9,
      });
    }, 200);
  }

  // daily streak milestones
  if (
    next.dailyStreak > before.dailyStreak &&
    STREAK_MILESTONES.includes(next.dailyStreak)
  ) {
    window.setTimeout(() => {
      toast.success(`🔥 ${next.dailyStreak}-day training streak`, {
        description: "Legends are built one day at a time. Keep the flame alive.",
        duration: 6000,
      });
    }, 900);
  }
}

// puzzle / opening totals are injected once by the platform bootstrap
// (kept as module state to avoid threading them through every call)
let TOTALS = { puzzles: 20, openings: 6 };
export function setPlatformTotals(puzzles: number, openings: number) {
  TOTALS = { puzzles, openings };
}

/* ================================================================== */
/* public reward API                                                  */
/* ================================================================== */

/** Called when an arena game vs the engine ends. */
export function awardGame(
  difficulty: Difficulty,
  outcome: Outcome,
  reason: string
): { ratingDelta: number; newRating: number; xp: number; crowns: number } {
  let delta = 0;
  let newRating = 0;
  let xp = 0;
  let crowns = 0;

  commit(
    (p) => {
      const bot = BOT_RATINGS[difficulty] ?? 1400;
      delta = eloDelta(p.rating, bot, outcome);
      newRating = Math.max(100, p.rating + delta);
      xp =
        outcome === "win"
          ? 40 + WIN_XP_BONUS[difficulty]
          : outcome === "draw"
            ? 24
            : 8;
      crowns = outcome === "win" ? 12 : outcome === "draw" ? 6 : 3;

      const winStreak =
        outcome === "win" ? p.currentWinStreak + 1 : 0;

      return {
        ...p,
        xp: p.xp + xp,
        crowns: p.crowns + crowns,
        rating: newRating,
        ratingHistory: [...p.ratingHistory, { t: Date.now(), r: newRating }].slice(-60),
        gamesPlayed: p.gamesPlayed + 1,
        wins: p.wins + (outcome === "win" ? 1 : 0),
        losses: p.losses + (outcome === "loss" ? 1 : 0),
        draws: p.draws + (outcome === "draw" ? 1 : 0),
        currentWinStreak: winStreak,
        bestWinStreak: Math.max(p.bestWinStreak, winStreak),
      };
    },
    {
      totalPuzzles: TOTALS.puzzles,
      totalOpenings: TOTALS.openings,
      main: null, // replaced by the richer rating toast below
      celebrate: outcome === "win",
    }
  );

  const arrow = delta >= 0 ? "+" : "−";
  const abs = Math.abs(delta);
  if (outcome === "win") {
    toast.success(`🏆 Victory — rating ${arrow}${abs}`, {
      description: `+${xp} XP · +${crowns} crowns · ${reason}. New rating: ${newRating}.`,
      duration: 6500,
    });
  } else if (outcome === "draw") {
    toast(`🤝 Draw — rating ${arrow}${abs}`, {
      description: `+${xp} XP · +${crowns} crowns · ${reason}. New rating: ${newRating}.`,
      duration: 6000,
    });
  } else {
    toast.error(`⚔️ Defeat — rating ${arrow}${abs}`, {
      description: `+${xp} XP for the lesson · ${reason}. New rating: ${newRating}. Every loss is tuition.`,
      duration: 6000,
    });
  }

  return { ratingDelta: delta, newRating, xp, crowns };
}

/** Called for each tactics puzzle attempt. */
export function awardPuzzle(puzzleId: string, solved: boolean): void {
  if (!solved) {
    commit(
      (p) => ({
        ...p,
        puzzleStreak: 0,
        puzzleAttempts: p.puzzleAttempts + 1,
      }),
      { totalPuzzles: TOTALS.puzzles, totalOpenings: TOTALS.openings, main: null }
    );
    return;
  }

  commit(
    (p) => {
      const firstSolve = !p.solvedPuzzles.includes(puzzleId);
      const streak = p.puzzleStreak + 1;
      return {
        ...p,
        xp: p.xp + (firstSolve ? 5 : 2),
        crowns: p.crowns + (firstSolve ? 3 : 1),
        puzzleStreak: streak,
        bestStreak: Math.max(p.bestStreak, streak),
        solvedPuzzles: firstSolve
          ? [...p.solvedPuzzles, puzzleId]
          : p.solvedPuzzles,
      };
    },
    { totalPuzzles: TOTALS.puzzles, totalOpenings: TOTALS.openings, main: null }
  );
}

/** Called when the K+Q endgame drill is won. */
export function awardDrill(moveCount: number): void {
  commit(
    (p) => ({
      ...p,
      xp: p.xp + 8,
      crowns: p.crowns + 5,
      drillWins: p.drillWins + 1,
      drillBest:
        p.drillBest === null ? moveCount : Math.min(p.drillBest, moveCount),
    }),
    { totalPuzzles: TOTALS.puzzles, totalOpenings: TOTALS.openings, main: null, celebrate: true }
  );
}

/** Called when an opening lesson is completed. */
export function awardOpening(openingId: string): void {
  const first = !loadProfile().openingsDone.includes(openingId);
  if (!first) return;
  commit(
    (p) => ({
      ...p,
      xp: p.xp + 10,
      crowns: p.crowns + 4,
      openingsDone: p.openingsDone.includes(openingId)
        ? p.openingsDone
        : [...p.openingsDone, openingId],
    }),
    { totalPuzzles: TOTALS.puzzles, totalOpenings: TOTALS.openings, main: null }
  );
}

/** Called when today's Daily Challenge is conquered. */
export function awardDailyChallenge(puzzleId: string): boolean {
  const today = dateKey();
  const p = loadProfile();
  if (p.dailyDoneDate === today) return false; // already claimed
  commit(
    (prev) => {
      const firstSolve = !prev.solvedPuzzles.includes(puzzleId);
      const streak = prev.puzzleStreak + 1;
      return {
        ...prev,
        xp: prev.xp + 30,
        crowns: prev.crowns + 20,
        dailyDoneDate: today,
        solvedPuzzles: firstSolve
          ? [...prev.solvedPuzzles, puzzleId]
          : prev.solvedPuzzles,
        puzzleStreak: streak,
        bestStreak: Math.max(prev.bestStreak, streak),
      };
    },
    { totalPuzzles: TOTALS.puzzles, totalOpenings: TOTALS.openings, main: null, celebrate: true }
  );
  toast.success("🌞 Daily Challenge conquered", {
    description: "+30 XP · +20 crowns. Come back tomorrow to keep the flame alive.",
    duration: 6500,
  });
  return true;
}

/** Spend crowns (hints). Returns false with a nudge toast if too poor. */
export function spendCrowns(amount: number, whatFor: string): boolean {
  const p = loadProfile();
  if (p.crowns < amount) {
    toast.error("Not enough crowns", {
      description: `${whatFor} costs ${amount} crowns — you hold ${p.crowns}. Win games and solve puzzles to fill the vault.`,
      duration: 5000,
    });
    return false;
  }
  updateProfile((prev) => ({ ...prev, crowns: Math.max(0, prev.crowns - amount) }));
  return true;
}
