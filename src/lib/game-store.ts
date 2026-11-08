/**
 * Local persistence for the learning platform:
 * recent games (for analysis), and the student profile (XP, streaks, progress).
 */

export interface StoredGame {
  id: string;
  pgn: string;
  plies: number;
  result: "1-0" | "0-1" | "1/2-1/2" | "*";
  label: string;
  reason?: string;
  date: number;
}

export interface LearningProfile {
  xp: number;
  puzzleStreak: number;
  bestStreak: number;
  solvedPuzzles: string[];
  puzzleAttempts: number;
  drillWins: number;
  drillBest: number | null; // fewest moves to mate
  openingsDone: string[];
}

export const DEFAULT_PROFILE: LearningProfile = {
  xp: 0,
  puzzleStreak: 0,
  bestStreak: 0,
  solvedPuzzles: [],
  puzzleAttempts: 0,
  drillWins: 0,
  drillBest: null,
  openingsDone: [],
};

const GAMES_KEY = "sovereign-games-v1";
const PROFILE_KEY = "sovereign-profile-v1";

function readJSON<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full / disabled — non-fatal */
  }
}

/* ---------------- recent games ---------------- */

export function loadRecentGames(): StoredGame[] {
  return readJSON<StoredGame[]>(GAMES_KEY, []);
}

export function saveRecentGame(
  game: Omit<StoredGame, "id" | "date">
): StoredGame {
  const entry: StoredGame = {
    ...game,
    id: `g${Date.now()}-${Math.floor(Math.random() * 1e5)}`,
    date: Date.now(),
  };
  const all = [entry, ...loadRecentGames()].slice(0, 30);
  writeJSON(GAMES_KEY, all);
  return entry;
}

export function deleteRecentGame(id: string): StoredGame[] {
  const all = loadRecentGames().filter((g) => g.id !== id);
  writeJSON(GAMES_KEY, all);
  return all;
}

/* ---------------- learning profile ---------------- */

export function loadProfile(): LearningProfile {
  return { ...DEFAULT_PROFILE, ...readJSON<Partial<LearningProfile>>(PROFILE_KEY, {}) };
}

export function saveProfile(p: LearningProfile) {
  writeJSON(PROFILE_KEY, p);
}

/** Immutable-style update + persist. */
export function updateProfile(fn: (p: LearningProfile) => LearningProfile): LearningProfile {
  const next = fn(loadProfile());
  saveProfile(next);
  return next;
}

export function levelFromXp(xp: number): { level: number; title: string; into: number; span: number } {
  // gentle curve: each level costs 60 * level XP
  let level = 1;
  let remaining = xp;
  while (remaining >= 60 * level) {
    remaining -= 60 * level;
    level++;
  }
  const span = 60 * level;
  const titles = [
    "Novice",
    "Apprentice",
    "Chess Adept",
    "Tactician",
    "Strategist",
    "Knight-Errant",
    "Mastermind",
    "Grandmaster",
    "Sovereign",
  ];
  return {
    level,
    title: titles[Math.min(level - 1, titles.length - 1)],
    into: remaining,
    span,
  };
}
