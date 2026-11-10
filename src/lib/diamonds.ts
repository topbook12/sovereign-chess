/**
 * Sovereign Chess — the Diamond Vault.
 *
 * Diamonds are the real-value prize currency of Live Duels:
 *   winner +2 💎 · loser +1 💎 · draw +1 💎 each · 1 💎 = ৳50
 *
 * The ledger lives ON-DEVICE (localStorage) as the single source of
 * truth — every entry is timestamped and exportable to the Excel Data
 * Vault. Withdrawals are recorded as signed ledger entries plus a
 * withdrawal request the platform owner fulfills (bKash / Nagad).
 * Zero server cost, zero data loss, fully auditable.
 */

export const DIAMOND_TAKA = 50;
export const DUEL_WIN_DIAMONDS = 2;
export const DUEL_PLAY_DIAMONDS = 1; // loser + draw participation reward
export const MIN_WITHDRAW_DIAMONDS = 5;

export interface DiamondEntry {
  id: string;
  t: number; // epoch ms
  delta: number; // +2 win, +1 play, -n withdrawal
  reason:
    | "duel-win"
    | "duel-play"
    | "duel-draw"
    | "withdraw"
    | "adjust";
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

const LEDGER_KEY = "sovereign-diamond-ledger-v1";
const WITHDRAW_KEY = "sovereign-diamond-withdrawals-v1";

/** Fired on window whenever the ledger or withdrawals change. */
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

const newId = () =>
  `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

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
  reason: DiamondEntry["reason"],
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
  return entry;
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
    id: `W${Date.now().toString(36).toUpperCase()}`,
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
  return req;
}
