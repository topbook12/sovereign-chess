/**
 * Sovereign Chess — Arcade contract shared by every stake game
 * (Ludo, Carrom, Snake Duel).
 *
 * Games are pure: they know NOTHING about diamonds or wallets. They render
 * a two-player match (pass-and-play on one device) and report the outcome
 * through `onFinish` exactly once. The arcade economy (entry stakes,
 * prize, consolation, the platform's 1 💎 fee) lives in arcade-economy.ts.
 */

export type ArcadeKey = "ludo" | "carrom" | "snake";

export interface ArcadePlayer {
  name: string;
  emoji: string;
}

/** winner: 0 → players[0], 1 → players[1], null → draw */
export interface ArcadeResult {
  winner: 0 | 1 | null;
  scores: [number, number];
  note?: string;
}

export interface ArcadeGameProps {
  players: [ArcadePlayer, ArcadePlayer];
  /** free practice — no stakes, no settlement, pure learning */
  practice: boolean;
  /** called EXACTLY once when the match reaches a verdict */
  onFinish: (result: ArcadeResult) => void;
  /** called when the player quits mid-match (no verdict) */
  onExit: () => void;
}
