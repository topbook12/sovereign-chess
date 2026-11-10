/**
 * Sovereign Chess — haptic feedback engine.
 *
 * Pro mobile feel: every board event pulses in the player's palm.
 * Runs on-device (navigator.vibrate), degrades silently on iOS Safari,
 * and its setting is persisted independently from the sound toggle so
 * "muted" never means "lifeless".
 */

export type HapticName =
  | "select"
  | "move"
  | "capture"
  | "castle"
  | "check"
  | "promote"
  | "win"
  | "lose"
  | "draw"
  | "tick"
  | "achievement"
  | "levelup"
  | "illegal";

/** Vibration patterns in milliseconds ([on, pause, on, …]). */
const PATTERNS: Record<HapticName, number | number[]> = {
  select: 8,
  move: 12,
  capture: [10, 34, 20],
  castle: [12, 60, 12],
  check: [18, 60, 18, 60, 28],
  promote: [12, 42, 12, 42, 22],
  win: [22, 55, 22, 55, 22, 55, 46],
  lose: [42, 90, 64],
  draw: [22, 70, 22],
  tick: 6,
  achievement: [10, 42, 10, 42, 26],
  levelup: [14, 42, 14, 42, 14, 42, 34],
  illegal: [28, 40, 28],
};

const STORAGE_KEY = "sovereign.haptics";

let enabled = true;

/** Restore the persisted setting (browser only). */
export function initHaptics() {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    enabled = raw === null ? true : raw === "1";
  } catch {
    /* private mode — keep the default */
  }
}

export function hapticsEnabled(): boolean {
  return enabled;
}

export function setHapticsEnabled(v: boolean) {
  enabled = v;
  try {
    window.localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
  } catch {
    /* storage unavailable — session-only setting */
  }
  if (v) pulse("achievement"); // confirmation buzz when re-enabled
}

/** Fire a raw haptic pulse. Never throws, never blocks. */
export function pulse(name: HapticName) {
  if (!enabled || typeof navigator === "undefined") return;
  const vibrate = navigator.vibrate?.bind(navigator);
  if (!vibrate) return; // iOS Safari & desktop — silent no-op
  try {
    vibrate(PATTERNS[name]);
  } catch {
    /* never break the game for a buzz */
  }
}

/** Map a sound event to its matching haptic (used by the sound engine). */
export function hapticForSound(name: HapticName) {
  pulse(name);
}

// restore preference on module load in the browser
if (typeof window !== "undefined") initHaptics();
