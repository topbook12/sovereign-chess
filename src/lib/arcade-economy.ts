/**
 * Sovereign Chess — Arcade economy (real stakes, same-device matches).
 *
 * Two local players share one device for Ludo / Carrom / Snake duels, so
 * each person owns a REAL wallet of their own, held on-device:
 *
 *   signup        +3 💎  one-time grant per player — first matches are free
 *   entry stake   −3 💎  both players lock it when the match starts
 *   win           +4 💎  winner's prize (net +1 💎 = +৳50)
 *   loss          +1 💎  consolation credit (net −2 💎 = −৳100)
 *   draw          +3 💎  full refund for both (net 0, no fee)
 *   platform fee   1 💎  the house's share of every decided match (৳50)
 *
 *   pot check: 3 + 3 = 6 = 4 (winner) + 1 (consolation) + 1 (platform) ✓
 *
 * Every mutation is timestamped in the player's ledger (the authoritative
 * on-device copy) and settlement summaries are pushed to the platform
 * ledger (Turso) through the same retry queue the duel wallet uses —
 * offline-safe, idempotent, never lost.
 */

import { DIAMOND_TAKA, queueWalletRecord } from "@/lib/diamonds";

export const ARCADE_ENTRY = 3;
export const ARCADE_PRIZE = 4;
export const ARCADE_CONSOLATION = 1;
export const ARCADE_HOUSE_FEE = 1;
export const ARCADE_SIGNUP = 3;

export type ArcadeLedgerReason =
  | "signup"
  | "stake"
  | "prize"
  | "consolation"
  | "refund"
  | "purchase";

export interface ArcadeLedgerEntry {
  id: string;
  t: number; // epoch ms
  delta: number;
  reason: ArcadeLedgerReason;
  note?: string;
}

export interface ArcadeAccount {
  id: "a" | "b";
  name: string;
  emoji: string;
  balance: number;
  ledger: ArcadeLedgerEntry[];
  matches: number;
  wins: number;
}

export interface ArcadeHouse {
  fee: number; // diamonds collected by the platform
  matches: number; // decided stake matches
}

export interface ArcadeSettlement {
  winner: 0 | 1 | null;
  deltas: [number, number];
  balances: [number, number];
  fee: number;
  feeTaka: number;
}

const PLAYERS_KEY = "sovereign-arcade-players-v1";
const HOUSE_KEY = "sovereign-arcade-house-v1";
const CHARGES_KEY = "sovereign-arcade-charges-v1";

const newId = (p = "a") =>
  `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — session only */
  }
}

/** Fired on window whenever any arcade wallet changes. */
export const ARCADE_EVENT = "sovereign-arcade";

function announce() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ARCADE_EVENT));
}

function pushLedger(
  account: ArcadeAccount,
  delta: number,
  reason: ArcadeLedgerReason,
  note?: string
): ArcadeLedgerEntry {
  const entry: ArcadeLedgerEntry = {
    id: newId(),
    t: Date.now(),
    delta,
    reason,
    note,
  };
  account.ledger.unshift(entry);
  if (account.ledger.length > 300) account.ledger.length = 300;
  account.balance += delta;
  return entry;
}

/* ---------------- accounts ---------------- */

export function getArcadeAccounts(): [ArcadeAccount, ArcadeAccount] {
  const stored = read<ArcadeAccount[] | null>(PLAYERS_KEY, null);
  if (stored && stored.length === 2) {
    return [stored[0], stored[1]];
  }
  const fresh: [ArcadeAccount, ArcadeAccount] = [
    {
      id: "a",
      name: "Player 1",
      emoji: "👑",
      balance: 0,
      ledger: [],
      matches: 0,
      wins: 0,
    },
    {
      id: "b",
      name: "Player 2",
      emoji: "🦅",
      balance: 0,
      ledger: [],
      matches: 0,
      wins: 0,
    },
  ];
  for (const acc of fresh) {
    pushLedger(
      acc,
      ARCADE_SIGNUP,
      "signup",
      "Welcome bonus — your first stake matches are on the house"
    );
  }
  write(PLAYERS_KEY, fresh);
  return fresh;
}

function saveAccounts(accs: [ArcadeAccount, ArcadeAccount]) {
  write(PLAYERS_KEY, accs);
  announce();
}

export function renameArcadeAccount(id: "a" | "b", name: string) {
  const accs = getArcadeAccounts();
  const acc = accs.find((x) => x.id === id);
  if (!acc) return;
  acc.name = name.trim().slice(0, 18) || acc.name;
  saveAccounts(accs);
}

/* ---------------- house (platform share) ---------------- */

export function getArcadeHouse(): ArcadeHouse {
  return read<ArcadeHouse>(HOUSE_KEY, { fee: 0, matches: 0 });
}

/* ---------------- stakes (persisted, idempotent) ---------------- */

interface ChargeRecord {
  t: number;
  kind: "stake" | "settle" | "refund";
}

function readCharges(): Record<string, ChargeRecord> {
  return read<Record<string, ChargeRecord>>(CHARGES_KEY, {});
}

function markCharge(key: string, kind: ChargeRecord["kind"]) {
  const map = readCharges();
  map[key] = { t: Date.now(), kind };
  write(CHARGES_KEY, map);
}

export function arcStakeCharged(matchId: string): boolean {
  return !!readCharges()[`${matchId}:stake`];
}

export function arcSettled(matchId: string): boolean {
  const k = readCharges()[`${matchId}:settle`];
  return !!k || !!readCharges()[`${matchId}:refund`];
}

/**
 * Lock both entry stakes. Idempotent per match — a re-render or a crash
 * can never double-charge. Returns an error string if either player
 * cannot cover the 3 💎 stake.
 */
export function chargeArcadeStake(
  matchId: string,
  players: [ArcadeAccount, ArcadeAccount]
): { ok: true } | { ok: false; error: string } {
  const key = `${matchId}:stake`;
  if (readCharges()[key]) return { ok: true };
  for (const acc of players) {
    if (acc.balance < ARCADE_ENTRY) {
      return {
        ok: false,
        error: `${acc.name} needs ${ARCADE_ENTRY} 💎 to stake this match — top up first.`,
      };
    }
  }
  for (const acc of players) {
    pushLedger(acc, -ARCADE_ENTRY, "stake", `Entry stake — match ${matchId.slice(-6)}`);
  }
  markCharge(key, "stake");
  saveAccounts(players);
  return { ok: true };
}

/**
 * Pay the verdict once (crash-safe): winner's prize, loser's consolation
 * or draw refunds — and the platform's 1 💎 fee on every decided match.
 * A settlement summary is queued for the platform ledger.
 */
export function settleArcadeMatch(
  matchId: string,
  players: [ArcadeAccount, ArcadeAccount],
  winner: 0 | 1 | null
): ArcadeSettlement | { error: string } {
  const key = `${matchId}:settle`;
  if (readCharges()[`${matchId}:refund`]) {
    return { error: "Match was already refunded." };
  }
  if (readCharges()[key]) return { error: "Match was already settled." };
  markCharge(key, "settle");

  const deltas: [number, number] = [0, 0];
  if (winner === null) {
    for (const acc of players) {
      pushLedger(acc, ARCADE_ENTRY, "refund", `Draw — stake refunded (${matchId.slice(-6)})`);
    }
    deltas[0] = ARCADE_ENTRY;
    deltas[1] = ARCADE_ENTRY;
  } else {
    const win = players[winner];
    const lose = players[winner === 0 ? 1 : 0];
    pushLedger(win, ARCADE_PRIZE, "prize", `Victory prize — match ${matchId.slice(-6)}`);
    pushLedger(
      lose,
      ARCADE_CONSOLATION,
      "consolation",
      `Consolation credit — match ${matchId.slice(-6)}`
    );
    win.wins += 1;
    deltas[winner] = ARCADE_PRIZE;
    deltas[winner === 0 ? 1 : 0] = ARCADE_CONSOLATION;
  }
  for (const acc of players) acc.matches += 1;

  // platform fee on decided matches only
  const house = getArcadeHouse();
  const fee = winner === null ? 0 : ARCADE_HOUSE_FEE;
  house.fee += fee;
  house.matches += 1;
  write(HOUSE_KEY, house);

  saveAccounts(players);

  // platform ledger — idempotent summary (retry queue, offline-safe)
  queueWalletRecord({
    kind: "settlement",
    id: `arc:${matchId}`,
    payload: {
      scope: "arcade",
      matchId,
      winner,
      fee,
      feeTaka: fee * DIAMOND_TAKA,
      p1: players[0].name,
      p2: players[1].name,
      t: Date.now(),
    },
  });

  return {
    winner,
    deltas,
    balances: [players[0].balance, players[1].balance],
    fee,
    feeTaka: fee * DIAMOND_TAKA,
  };
}

/** Abort before a verdict — both stakes go home untouched hearts. */
export function refundArcadeMatch(
  matchId: string,
  players: [ArcadeAccount, ArcadeAccount]
): void {
  if (readCharges()[`${matchId}:settle`]) return;
  if (readCharges()[`${matchId}:refund`]) return;
  markCharge(`${matchId}:refund`, "refund");
  for (const acc of players) {
    pushLedger(acc, ARCADE_ENTRY, "refund", `Match abandoned — stake refunded (${matchId.slice(-6)})`);
  }
  saveAccounts(players);
}

/* ---------------- recharge (bKash — placeholder flow) ---------------- */

export interface ArcadeOrder {
  id: string;
  t: number;
  playerId: "a" | "b";
  player: string;
  diamonds: number;
  taka: number;
  method: "bkash" | "nagad" | "rocket";
  sender: string;
  status: "pending";
}

const ORDERS_KEY = "sovereign-arcade-orders-v1";

export function getArcadeOrders(): ArcadeOrder[] {
  return read<ArcadeOrder[]>(ORDERS_KEY, []);
}

export function requestArcadeRecharge(input: {
  playerId: "a" | "b";
  player: string;
  diamonds: number;
  taka: number;
  method: ArcadeOrder["method"];
  sender: string;
}): ArcadeOrder | { error: string } {
  if (!input.sender.trim() || input.sender.trim().length < 6) {
    return { error: "Enter the number you will pay from (11 digits)." };
  }
  const order: ArcadeOrder = {
    id: newId("AO").toUpperCase(),
    t: Date.now(),
    playerId: input.playerId,
    player: input.player,
    diamonds: input.diamonds,
    taka: input.taka,
    method: input.method,
    sender: input.sender.trim(),
    status: "pending",
  };
  const all = getArcadeOrders();
  all.unshift(order);
  write(ORDERS_KEY, all.slice(0, 60));
  queueWalletRecord({ kind: "order", id: order.id, payload: order });
  announce();
  return order;
}
