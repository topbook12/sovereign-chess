/**
 * Sovereign Chess — persistence for the career system:
 * the student profile v2 (XP, ELO rating, crowns, streaks, achievements),
 * plus the recent-games archive for the analysis room.
 * The local profile is the live source of truth; it is mirrored to the
 * database via /api/profile so progress survives cleared browsers.
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

export interface CareerProfile {
  /* ---- learning core (v1) ---- */
  xp: number;
  puzzleStreak: number;
  bestStreak: number;
  solvedPuzzles: string[];
  puzzleAttempts: number;
  drillWins: number;
  drillBest: number | null; // fewest moves to mate
  openingsDone: string[];
  /* ---- career (v2) ---- */
  rating: number; // ELO, starts at 1200
  ratingHistory: { t: number; r: number }[];
  crowns: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  currentWinStreak: number;
  bestWinStreak: number;
  dailyStreak: number; // consecutive training days
  bestDailyStreak: number;
  lastActiveDate: string | null; // YYYY-MM-DD
  activityDays: string[]; // recent active dates, newest last
  dailyDoneDate: string | null; // last completed daily challenge
  achievements: string[];
  updatedAt: number;
}

export type LearningProfile = CareerProfile;

export const emptyProfile = (): CareerProfile => ({
  xp: 0,
  puzzleStreak: 0,
  bestStreak: 0,
  solvedPuzzles: [],
  puzzleAttempts: 0,
  drillWins: 0,
  drillBest: null,
  openingsDone: [],
  rating: 1200,
  ratingHistory: [],
  crowns: 40,
  gamesPlayed: 0,
  wins: 0,
  losses: 0,
  draws: 0,
  currentWinStreak: 0,
  bestWinStreak: 0,
  dailyStreak: 0,
  bestDailyStreak: 0,
  lastActiveDate: null,
  activityDays: [],
  dailyDoneDate: null,
  achievements: [],
  updatedAt: 0,
});

const GAMES_KEY = "sovereign-games-v1";
const PROFILE_KEY = "sovereign-profile-v2";
const LEGACY_PROFILE_KEY = "sovereign-profile-v1";
const LEGACY_STATS_KEY = "sovereign-chess-stats-v1";
const DEVICE_KEY = "sovereign-device-v1";

/** Fired on window whenever the profile OR the games archive changes. */
export const PROFILE_EVENT = "sovereign-career";

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
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(PROFILE_EVENT));
  }
  return entry;
}

export function deleteRecentGame(id: string): StoredGame[] {
  const all = loadRecentGames().filter((g) => g.id !== id);
  writeJSON(GAMES_KEY, all);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(PROFILE_EVENT));
  }
  return all;
}

/* ---------------- learning profile ---------------- */

function migrateLegacy(): CareerProfile {
  const legacy = readJSON<Partial<CareerProfile>>(LEGACY_PROFILE_KEY, {});
  const legacyStats = readJSON<{ wins?: number; losses?: number; draws?: number }>(
    LEGACY_STATS_KEY,
    {}
  );
  const base = emptyProfile();
  const migrated: CareerProfile = {
    ...base,
    ...legacy,
    gamesPlayed:
      (legacyStats.wins ?? 0) + (legacyStats.losses ?? 0) + (legacyStats.draws ?? 0),
    wins: legacyStats.wins ?? 0,
    losses: legacyStats.losses ?? 0,
    draws: legacyStats.draws ?? 0,
  };
  return migrated;
}

export function loadProfile(): CareerProfile {
  const raw = readJSON<CareerProfile | null>(PROFILE_KEY, null);
  if (raw) return { ...emptyProfile(), ...raw };
  const migrated = migrateLegacy();
  if (typeof window !== "undefined") saveProfile(migrated);
  return migrated;
}

export function saveProfile(p: CareerProfile) {
  writeJSON(PROFILE_KEY, { ...p, updatedAt: Date.now() });
}

/** Immutable-style update + persist + live event + cloud mirror. */
export function updateProfile(
  fn: (p: CareerProfile) => CareerProfile
): CareerProfile {
  const next = fn(loadProfile());
  saveProfile(next);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(PROFILE_EVENT));
    scheduleCloudSync();
  }
  return next;
}

/* ---------------- device identity & cloud mirror ---------------- */

export function deviceId(): string {
  if (typeof window === "undefined") return "server";
  let id = window.localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `d${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    window.localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

let syncTimer: number | null = null;
let syncing = false;

function scheduleCloudSync() {
  if (typeof window === "undefined") return;
  if (syncTimer) window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => void pushCloudProfile(), 1600);
}

async function pushCloudProfile() {
  if (syncing) return;
  syncing = true;
  try {
    const data = JSON.stringify(loadProfile());
    await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: deviceId(), data }),
    });
  } catch {
    /* offline — the local profile remains the source of truth */
  } finally {
    syncing = false;
  }
}

/** Adopt the cloud copy if it is newer (e.g. cleared browser, new device). */
export async function pullCloudProfile() {
  if (typeof window === "undefined") return;
  try {
    const res = await fetch(
      `/api/profile?deviceId=${encodeURIComponent(deviceId())}`
    );
    if (!res.ok) return;
    const json = (await res.json()) as { data?: string | null };
    if (!json?.data) {
      void pushCloudProfile();
      return;
    }
    const cloud = JSON.parse(json.data) as CareerProfile;
    const local = loadProfile();
    if ((cloud.updatedAt ?? 0) > (local.updatedAt ?? 0)) {
      saveProfile({ ...emptyProfile(), ...cloud });
      window.dispatchEvent(new Event(PROFILE_EVENT));
    }
  } catch {
    /* offline */
  }
}

/* ---------------- levels ---------------- */

export function levelFromXp(xp: number): {
  level: number;
  title: string;
  into: number;
  span: number;
} {
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
