/**
 * Data exporter — turns the platform's data into human-manageable files.
 *
 * The user's directive: "the data will live inside an Excel file so it
 * occupies very little space". SheetJS is loaded lazily (dynamic import)
 * so the chess board stays light, and everything is generated on the
 * DEVICE — zero server cost for exports.
 */

import type { StoredGame, CareerProfile } from "./game-store";
import type { CloudGame } from "./cloud";
import { levelFromXp } from "./game-store";
import { getLedger, getWithdrawals, balanceTaka } from "./diamonds";

export type ExportGame = StoredGame | (CloudGame & { label?: string | null });

function asStored(g: ExportGame): StoredGame {
  return {
    id: g.id,
    pgn: g.pgn,
    plies: g.plies,
    result: g.result as StoredGame["result"],
    label: g.label ?? "Unknown duel",
    reason: (g as StoredGame).reason,
    date: g.date,
  };
}

const RESULT_LABEL: Record<string, string> = {
  "1-0": "Win (White)",
  "0-1": "Win (Black)",
  "1/2-1/2": "Draw",
  "*": "Unfinished",
};

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString();
}

/* ------------------------------------------------------------------ */
/* Excel                                                               */
/* ------------------------------------------------------------------ */

/** Export the games archive to a real .xlsx workbook (Games + Profile). */
export async function exportGamesToExcel(
  games: ExportGame[],
  profile: CareerProfile,
  filename?: string
): Promise<number> {
  const XLSX = await import("xlsx");

  const gameRows = games.map((raw) => {
    const g = asStored(raw);
    return {
      Date: fmtDate(g.date),
      Duel: g.label,
      Result: RESULT_LABEL[g.result] ?? g.result,
      End: g.reason ?? "",
      Moves: Math.ceil(g.plies / 2),
      Plies: g.plies,
      "PGN (compact)": g.pgn,
    };
  });

  const lvl = levelFromXp(profile.xp);
  const profileRows: { Field: string; Value: string | number }[] = [
    { Field: "Exported", Value: fmtDate(Date.now()) },
    { Field: "Level", Value: `${lvl.level} — ${lvl.title}` },
    { Field: "XP", Value: profile.xp },
    { Field: "ELO Rating", Value: profile.rating },
    { Field: "Crowns", Value: profile.crowns },
    { Field: "Games Played", Value: profile.gamesPlayed },
    { Field: "Wins", Value: profile.wins },
    { Field: "Losses", Value: profile.losses },
    { Field: "Draws", Value: profile.draws },
    { Field: "Current Win Streak", Value: profile.currentWinStreak },
    { Field: "Best Win Streak", Value: profile.bestWinStreak },
    { Field: "Puzzle Streak", Value: profile.puzzleStreak },
    { Field: "Best Puzzle Streak", Value: profile.bestStreak },
    { Field: "Puzzles Solved", Value: profile.solvedPuzzles.length },
    { Field: "Openings Mastered", Value: profile.openingsDone.length },
    { Field: "Daily Streak", Value: profile.dailyStreak },
    { Field: "Best Daily Streak", Value: profile.bestDailyStreak },
    { Field: "Achievements", Value: profile.achievements.join(", ") },
    { Field: "Diamond Balance", Value: `${getLedger().reduce((s, e) => s + e.delta, 0)} 💎 (৳${balanceTaka()})` },
  ];

  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.json_to_sheet(gameRows);
  ws1["!cols"] = [
    { wch: 19 },
    { wch: 26 },
    { wch: 12 },
    { wch: 16 },
    { wch: 7 },
    { wch: 7 },
    { wch: 80 },
  ];
  XLSX.utils.book_append_sheet(wb, ws1, "Games");
  const ws2 = XLSX.utils.json_to_sheet(profileRows);
  ws2["!cols"] = [{ wch: 22 }, { wch: 46 }];
  XLSX.utils.book_append_sheet(wb, ws2, "Profile");

  /* Diamond Vault — every gem is real value (1 💎 = ৳50) */
  const ledger = getLedger();
  let running = 0;
  const diamondRows = ledger
    .slice()
    .reverse()
    .map((e) => {
      running += e.delta;
      return {
        Date: fmtDate(e.t),
        Event: e.reason,
        Detail: e.detail ?? "",
        Diamonds: e.delta,
        Balance: running,
        "Value (৳)": running * 50,
      };
    });
  const ws3 = XLSX.utils.json_to_sheet(diamondRows);
  ws3["!cols"] = [{ wch: 19 }, { wch: 12 }, { wch: 34 }, { wch: 10 }, { wch: 10 }, { wch: 11 }];
  XLSX.utils.book_append_sheet(wb, ws3, "Diamonds");

  const withdrawalRows = getWithdrawals().map((w) => ({
    "Claim ID": w.id,
    Date: fmtDate(w.t),
    Diamonds: w.diamonds,
    "Amount (৳)": w.taka,
    Method: w.method.toUpperCase(),
    Account: w.account,
    Status: w.status,
  }));
  const ws4 = XLSX.utils.json_to_sheet(withdrawalRows);
  ws4["!cols"] = [{ wch: 12 }, { wch: 19 }, { wch: 10 }, { wch: 12 }, { wch: 9 }, { wch: 16 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, ws4, "Withdrawals");

  const name =
    filename ?? `sovereign-chess-${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, name);
  return gameRows.length;
}

/* ------------------------------------------------------------------ */
/* JSON + PGN archives                                                 */
/* ------------------------------------------------------------------ */

/** Full offline backup: profile + games + cloud queue, one small file. */
export function downloadJsonBackup(
  profile: CareerProfile,
  games: ExportGame[]
): void {
  const payload = {
    app: "sovereign-chess",
    version: 2,
    exportedAt: new Date().toISOString(),
    profile,
    games: games.map(asStored),
  };
  const blob = new Blob([JSON.stringify(payload)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sovereign-chess-backup-${new Date()
    .toISOString()
    .slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Plain PGN archive (opens in any chess software). */
export function buildPgnArchive(games: ExportGame[]): string {
  return games
    .map(asStored)
    .map((g) => {
      const header = [
        `[Event "${g.label}"]`,
        `[Date "${new Date(g.date).toISOString().slice(0, 10).replace(/-/g, ".")}"]`,
        `[Result "${g.result}"]`,
      ].join("\n");
      return `${header}\n\n${g.pgn || "*"}`;
    })
    .join("\n\n");
}

export async function copyPgnArchive(games: ExportGame[]): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(buildPgnArchive(games));
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* storage stats                                                       */
/* ------------------------------------------------------------------ */

/** Approximate bytes this app occupies in localStorage. */
export function estimateLocalBytes(): number {
  if (typeof window === "undefined") return 0;
  let total = 0;
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith("sovereign")) continue;
      total += key.length + (window.localStorage.getItem(key)?.length ?? 0);
    }
  } catch {
    /* storage unavailable */
  }
  return total * 2; // UTF-16
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
