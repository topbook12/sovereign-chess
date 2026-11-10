/**
 * Sovereign Chess — the Diamond Vault (v3, raked real-money economy).
 *
 * Diamonds are the wager currency of Live Duels with REAL taka value.
 * Every decided duel runs through the house rake — the platform keeps a
 * guaranteed share of every pot, winners and losers play for the rest:
 *
 *   entry stake  −3 💎  every player locks 3 💎 when the duel goes live
 *   win          +4 💎  winner's prize (net +1 💎 = +৳50)
 *   loss         +1 💎  consolation credit (net −2 💎 = −৳100)
 *   draw         +3 💎  stake refunded to both (net 0, no fee)
 *   platform      1 💎  the house's share of every decided duel (৳50)
 *
 *   pot check: 3 + 3 = 6 = 4 (winner) + 1 (consolation) + 1 (platform) ✓
 *   starter      +6 💎  one-time welcome grant — two full duels, free
 *   purchase     +n 💎  shop order verified by the platform owner (bKash)
 *   withdraw     −n 💎  cash-out → the owner sends taka via bKash / Nagad
 *
 *   1 💎 = ৳50 — shown everywhere, withdrawable, buyable.
 *
 * The ledger lives ON-DEVICE (localStorage) as the player's authoritative
 * copy — every entry is timestamped and exportable. Orders, cash-out claims,
 * settlement summaries and a balance snapshot are ALSO pushed to the
 * platform ledger (Turso) via a persistent retry queue, so the owner always
 * sees every wallet event — including the house's rake — even offline.
 */

export const DIAMOND_TAKA = 50;
export const DUEL_ENTRY_STAKE = 3;
export const DUEL_WIN_PRIZE = 4; // winner's prize credit (net +1)
export const DUEL_LOSER_CONSOLATION = 1; // loser's consolation (net −2)
export const DUEL_HOUSE_FEE = 1; // platform share of every decided duel
export const MIN_WITHDRAW_DIAMONDS = 5;
export const STARTER_DIAMONDS = 6;

/**
 * The platform's bKash merchant/personal number for diamond purchases.
 * The owner fills this in when the payment channel goes live — the shop
 * UI shows a graceful "coming soon" notice until then.
 */
export const PAYMENT_NUMBER = "";

export interface StorePackage {
  id: string;
  diamonds: number;
  bonus: number;
  taka: number;
  tag?: "popular" | "best";
}

export const STORE_PACKAGES: StorePackage[] = [
  { id: "pk1", diamonds: 1, bonus: 0, taka: 50 },
  { id: "pk5", diamonds: 5, bonus: 0, taka: 250 },
  { id: "pk10", diamonds: 10, bonus: 1, taka: 500 },
  { id: "pk25", diamonds: 25, bonus: 3, taka: 1250, tag: "popular" },
  { id: "pk50", diamonds: 50, bonus: 8, taka: 2500, tag: "best" },
];

export type DiamondReason =
  | "starter"
  | "duel-stake"
  | "duel-pot"
  | "duel-draw"
  | "duel-win"
  | "duel-consolation"
  | "duel-play"
  | "purchase"
  | "withdraw"
  | "adjust";

export interface DiamondEntry {
  id: string;
  t: number; // epoch ms
  delta: number;
  reason: DiamondReason;
  detail?: string;
}

export interface WithdrawalRequest {
  id: string;
  t: number;
  diamonds: number;
  taka: number;
  deviceId: string;
  player: string;
  status: "pending" | "paid" | "rejected";
  method: "bkash" | "nagad" | "rocket";
  account: string;
}

export interface StoreOrder {
  id: string;
  t: number;
  packageId: string;
  diamonds: number;
  bonus: number;
  taka: number;
  method: "bkash" | "nagad" | "rocket";
  sender: string;
  trx: string;
  status: "pending" | "verified" | "rejected";
  deviceId: string;
  player: string;
}

const LEDGER_KEY = "sovereign-diamond-ledger-v1";
const WITHDRAW_KEY = "sovereign-diamond-withdrawals-v1";
const ORDERS_KEY = "sovereign-diamond-orders-v1";
const STARTER_KEY = "sovereign-diamond-starter-v1";
const CHARGES_KEY = "sovereign-duel-charges-v1";
const QUEUE_KEY = "sovereign-wallet-queue-v1";

/** Fired on window whenever the wallet changes. */
export const DIAMOND_EVENT = "sovereign-diamonds";

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

function announce() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(DIAMOND_EVENT));
}

const newId = (p = "d") =>
  `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function formatTaka(n: number): string {
  return `৳${n.toLocaleString("en-IN")}`;
}

/* ---------------- ledger ---------------- */

export function getLedger(): DiamondEntry[] {
  return read<DiamondEntry[]>(LEDGER_KEY, []);
}

export function getBalance(): number {
  return getLedger().reduce((sum, e) => sum + e.delta, 0);
}

export function balanceTaka(balance = getBalance()): number {
  return balance * DIAMOND_TAKA;
}

export function addDiamonds(
  n: number,
  reason: DiamondReason,
  detail?: string
): DiamondEntry {
  const entry: DiamondEntry = {
    id: newId(),
    t: Date.now(),
    delta: n,
    reason,
    detail,
  };
  const ledger = getLedger();
  ledger.unshift(entry);
  write(LEDGER_KEY, ledger.slice(0, 500)); // keep the vault trim
  announce();
  queueWalletRecord({
    kind: "balance",
    payload: { balance: getBalance() },
  });
  return entry;
}

/* ---------------- starter welcome grant ---------------- */

export function ensureStarter(): DiamondEntry | null {
  if (typeof window === "undefined") return null;
  try {
    if (window.localStorage.getItem(STARTER_KEY) === "1") return null;
    const hasLedger = getLedger().length > 0;
    // veteran wallets (pre-economy) keep their balance without a grant
    if (hasLedger) {
      window.localStorage.setItem(STARTER_KEY, "1");
      return null;
    }
    window.localStorage.setItem(STARTER_KEY, "1");
    return addDiamonds(
      STARTER_DIAMONDS,
      "starter",
      "Welcome bonus — your first duels are on the house"
    );
  } catch {
    return null;
  }
}

/* ---------------- duel stakes (persisted, idempotent) ---------------- */

interface ChargeRecord {
  t: number;
  kind: "stake" | "payout";
  delta: number;
}

type ChargeMap = Record<string, ChargeRecord>;

function readCharges(): ChargeMap {
  return read<ChargeMap>(CHARGES_KEY, {});
}

function markCharge(key: string, kind: "stake" | "payout", delta: number) {
  const map = readCharges();
  map[key] = { t: Date.now(), kind, delta };
  write(CHARGES_KEY, map);
}

/**
 * Lock the 1 💎 entry stake for a duel going live. Idempotent per
 * code+generation — reconnects and re-renders can never double-charge.
 */
export function payEntryStake(
  code: string,
  gen: number
): { entry: DiamondEntry } | { error: string } {
  const key = `${code}:g${gen}:stake`;
  if (readCharges()[key]) return { entry: getLedger()[0] };
  const balance = getBalance();
  if (balance < DUEL_ENTRY_STAKE) {
    return { error: "Not enough diamonds — top up in the Diamond Shop." };
  }
  const entry = addDiamonds(
    -DUEL_ENTRY_STAKE,
    "duel-stake",
    `Entry stake — duel ${code}`
  );
  markCharge(key, "stake", -DUEL_ENTRY_STAKE);
  return { entry };
}

/** Whether this duel generation already paid out (crash-safe guard). */
export function payoutDone(code: string, gen: number): boolean {
  return !!readCharges()[`${code}:g${gen}:payout`];
}

export function markPayoutDone(code: string, gen: number, delta: number) {
  markCharge(`${code}:g${gen}:payout`, "payout", delta);
}

/* ---------------- withdrawals ---------------- */

export function getWithdrawals(): WithdrawalRequest[] {
  return read<WithdrawalRequest[]>(WITHDRAW_KEY, []);
}

export function canWithdraw(balance = getBalance()): boolean {
  return balance >= MIN_WITHDRAW_DIAMONDS;
}

export function requestWithdrawal(input: {
  deviceId: string;
  player: string;
  method: WithdrawalRequest["method"];
  account: string;
  diamonds?: number;
}): WithdrawalRequest | { error: string } {
  const balance = getBalance();
  const amount = input.diamonds ?? balance;
  if (amount < MIN_WITHDRAW_DIAMONDS) {
    return {
      error: `Minimum withdrawal is ${MIN_WITHDRAW_DIAMONDS} 💎 (৳${MIN_WITHDRAW_DIAMONDS * DIAMOND_TAKA}).`,
    };
  }
  if (amount > balance) {
    return { error: "You cannot withdraw more diamonds than you hold." };
  }
  if (!input.account.trim()) {
    return { error: "Enter your bKash / Nagad account number." };
  }
  const req: WithdrawalRequest = {
    id: newId("W").toUpperCase(),
    t: Date.now(),
    diamonds: amount,
    taka: amount * DIAMOND_TAKA,
    deviceId: input.deviceId,
    player: input.player,
    status: "pending",
    method: input.method,
    account: input.account.trim(),
  };
  addDiamonds(-amount, "withdraw", `Cash-out ${req.id} → ${req.method} ${req.account}`);
  const all = getWithdrawals();
  all.unshift(req);
  write(WITHDRAW_KEY, all.slice(0, 100));
  announce();
  queueWalletRecord({ kind: "withdrawal", id: req.id, payload: req });
  return req;
}

/* ---------------- diamond shop ---------------- */

export function getOrders(): StoreOrder[] {
  return read<StoreOrder[]>(ORDERS_KEY, []);
}

export function requestPurchase(input: {
  pkg: StorePackage;
  method: StoreOrder["method"];
  sender: string;
  trx: string;
  deviceId: string;
  player: string;
}): StoreOrder | { error: string } {
  if (!input.sender.trim() || input.sender.trim().length < 6) {
    return { error: "Enter the number you paid from (11 digits)." };
  }
  if (!input.trx.trim() || input.trx.trim().length < 5) {
    return { error: "Enter the bKash transaction ID (TrxID)." };
  }
  const order: StoreOrder = {
    id: newId("O").toUpperCase(),
    t: Date.now(),
    packageId: input.pkg.id,
    diamonds: input.pkg.diamonds,
    bonus: input.pkg.bonus,
    taka: input.pkg.taka,
    method: input.method,
    sender: input.sender.trim(),
    trx: input.trx.trim().toUpperCase(),
    status: "pending",
    deviceId: input.deviceId,
    player: input.player,
  };
  const all = getOrders();
  all.unshift(order);
  write(ORDERS_KEY, all.slice(0, 60));
  announce();
  queueWalletRecord({ kind: "order", id: order.id, payload: order });
  return order;
}

/* ---------------- platform ledger sync (retry queue) ---------------- */

export interface WalletRecord {
  kind: "order" | "withdrawal" | "balance";
  id?: string;
  payload?: unknown;
}

interface QueuedRecord extends WalletRecord {
  qid: string;
  t: number;
}

function readQueue(): QueuedRecord[] {
  return read<QueuedRecord[]>(QUEUE_KEY, []);
}

function writeQueue(q: QueuedRecord[]) {
  write(QUEUE_KEY, q.slice(-200));
}

let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

/** Push a wallet event to the platform ledger (debounced, idempotent). */
export function queueWalletRecord(rec: WalletRecord) {
  if (typeof window === "undefined") return;
  const q = readQueue();
  const qid = `${rec.kind}:${rec.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`}`;
  if (rec.kind !== "balance" && q.some((x) => x.qid === qid)) return;
  q.push({ ...rec, qid, t: Date.now() });
  writeQueue(q);
  scheduleWalletFlush();
}

export function scheduleWalletFlush(delayMs = 4000) {
  if (typeof window === "undefined") return;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => void flushWalletQueue(), delayMs);
}

/**
 * Drain the retry queue into /api/wallet. The server de-dupes by id, so
 * replays are always safe; failures keep the records queued (offline-safe).
 */
export async function flushWalletQueue(): Promise<boolean> {
  if (typeof window === "undefined" || flushing) return false;
  const q = readQueue();
  if (q.length === 0) return true;
  flushing = true;
  let ok = false;
  try {
    const deviceId =
      window.localStorage.getItem("sovereign-device-v1") ?? "unknown";
    const res = await fetch("/api/wallet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId, records: q.slice(0, 60) }),
    });
    ok = res.ok && ((await res.json()) as { ok?: boolean })?.ok === true;
  } catch {
    ok = false;
  }
  flushing = false;
  if (ok) {
    const sent = new Set(readQueue().slice(0, 60).map((x) => x.qid));
    writeQueue(readQueue().filter((x) => !sent.has(x.qid)));
  }
  return ok;
}
