"use client";

/**
 * DataVault — the cost-effective data cockpit.
 *
 * Shows the platform's storage economics in real time (local bytes, cloud
 * archive size, pending retry queue) and exports everything the user owns
 * into a real Excel workbook, a JSON backup or a plain PGN archive — all
 * generated ON THE DEVICE (zero server cost), with lazy-loaded SheetJS.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  CloudUpload,
  Copy,
  Database,
  FileJson,
  FileSpreadsheet,
  HardDrive,
  Loader2,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  fetchCloudGameCount,
  fetchCloudGames,
  flushQueue,
  getCloudStatus,
  onCloudChange,
  type CloudGame,
  type CloudStatus,
} from "@/lib/cloud";
import {
  loadProfile,
  loadRecentGames,
  type StoredGame,
} from "@/lib/game-store";
import {
  copyPgnArchive,
  downloadJsonBackup,
  estimateLocalBytes,
  exportGamesToExcel,
  formatBytes,
  type ExportGame,
} from "@/lib/exporter";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

/** Merge the local archive with the cloud archive (dedupe by id). */
function mergeArchives(
  local: StoredGame[],
  cloud: CloudGame[] | null
): ExportGame[] {
  const map = new Map<string, ExportGame>();
  for (const c of cloud ?? []) map.set(c.id, c);
  for (const l of local) map.set(l.id, l); // local wins (has richer fields)
  return [...map.values()].sort((a, b) => b.date - a.date);
}

function StatChip({
  icon: Icon,
  label,
  value,
  tone = "gold",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone?: "gold" | "green" | "amber";
}) {
  const toneRing =
    tone === "green"
      ? "border-emerald-400/30 bg-emerald-400/8"
      : tone === "amber"
        ? "border-amber-400/30 bg-amber-400/8"
        : "border-gold/25 bg-gold/6";
  const toneText =
    tone === "green"
      ? "text-emerald-300"
      : tone === "amber"
        ? "text-amber-300"
        : "text-gold-soft";
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-xl border px-3 py-2.5",
        toneRing
      )}
    >
      <Icon className={cn("h-4 w-4 shrink-0", toneText)} />
      <div className="min-w-0">
        <p className="truncate font-mono text-[13px] font-bold text-foreground/90">
          {value}
        </p>
        <p className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-foreground/40">
          {label}
        </p>
      </div>
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  hint,
  onClick,
  busy,
  variant = "gold",
}: {
  icon: LucideIcon;
  label: string;
  hint: string;
  onClick: () => void;
  busy?: boolean;
  variant?: "gold" | "ghost";
}) {
  return (
    <Button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={cn(
        "h-auto min-h-[56px] w-full flex-col items-start gap-0.5 rounded-xl px-3.5 py-2.5",
        variant === "gold"
          ? "border border-[#8a6a24]/50 bg-gradient-to-b from-[#ecca6f] to-[#c69c3f] text-[#241a05] hover:from-[#f3d887] hover:to-[#d4a94e]"
          : "border border-white/10 bg-white/[0.04] text-foreground/80 hover:bg-white/[0.08]"
      )}
    >
      <span className="flex w-full items-center gap-2">
        {busy ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
        ) : (
          <Icon className="h-4 w-4 shrink-0" />
        )}
        <span className="text-[13px] font-bold tracking-wide">{label}</span>
      </span>
      <span
        className={cn(
          "w-full pl-6 text-left text-[10.5px] leading-tight",
          variant === "gold" ? "text-[#241a05]/70" : "text-foreground/40"
        )}
      >
        {hint}
      </span>
    </Button>
  );
}

/* ------------------------------------------------------------------ */
/* the vault                                                           */
/* ------------------------------------------------------------------ */

export function DataVault() {
  const [status, setStatus] = useState<CloudStatus>(getCloudStatus());
  const [cloud, setCloud] = useState<CloudGame[] | null>(null);
  const [localBytes, setLocalBytes] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [localTick, setLocalTick] = useState(0);

  const localGames = useMemo(() => loadRecentGames(), [localTick]);
  const archive = useMemo(
    () => mergeArchives(localGames, cloud),
    [localGames, cloud]
  );

  const refreshCount = useCallback(() => {
    void fetchCloudGameCount();
  }, []);

  useEffect(() => {
    setLocalBytes(estimateLocalBytes());
    const off = onCloudChange(() => {
      setStatus({ ...getCloudStatus() });
      setLocalBytes(estimateLocalBytes());
      setLocalTick((t) => t + 1);
    });
    refreshCount();
    const iv = window.setInterval(refreshCount, 45_000); // rare, tiny GET
    return () => {
      off();
      window.clearInterval(iv);
    };
  }, [refreshCount]);

  /** pull the full cloud archive once (on demand, ~1 small GET) */
  const ensureCloud = useCallback(async (): Promise<CloudGame[] | null> => {
    if (cloud) return cloud;
    const fetched = await fetchCloudGames();
    setCloud(fetched);
    return fetched;
  }, [cloud]);

  const syncNow = useCallback(async () => {
    setBusy("sync");
    try {
      const ok = await flushQueue();
      const count = await fetchCloudGameCount();
      if (ok || count !== null) {
        toast.success("Cloud in step", {
          description: count !== null
            ? `${count} duel${count === 1 ? "" : "s"} archived in Turso.`
            : "Retry queue drained.",
        });
      } else {
        toast.warning("Cloud unreachable", {
          description: "Everything stays safe on this device — we'll retry.",
        });
      }
    } finally {
      setBusy(null);
    }
  }, []);

  const exportExcel = useCallback(async () => {
    setBusy("excel");
    try {
      const merged = mergeArchives(loadRecentGames(), await ensureCloud());
      if (merged.length === 0) {
        toast("Nothing to export yet", {
          description: "Play a duel first — every move will be here.",
        });
        return;
      }
      const n = await exportGamesToExcel(merged, loadProfile());
      toast.success("Excel workbook ready", {
        description: `${n} duels + profile sheet downloaded.`,
      });
    } catch {
      toast.error("Export failed — please try again.");
    } finally {
      setBusy(null);
    }
  }, [ensureCloud]);

  const exportJson = useCallback(async () => {
    setBusy("json");
    try {
      const merged = mergeArchives(loadRecentGames(), await ensureCloud());
      downloadJsonBackup(loadProfile(), merged);
      toast.success("Full backup downloaded", {
        description: "One small file: profile + every duel.",
      });
    } finally {
      setBusy(null);
    }
  }, [ensureCloud]);

  const copyPgn = useCallback(async () => {
    setBusy("pgn");
    try {
      const merged = mergeArchives(loadRecentGames(), await ensureCloud());
      const ok = await copyPgnArchive(merged);
      if (ok) {
        toast.success("PGN archive copied", {
          description: `${merged.length} duels — paste into any chess app.`,
        });
      } else {
        toast.error("Clipboard unavailable in this browser.");
      }
    } finally {
      setBusy(null);
    }
  }, [ensureCloud]);

  const cloudOk = status.lastOk === true || (status.lastOk === null && status.cloudGames !== null);
  const cloudBad = status.lastOk === false;
  const pending = status.pending;

  return (
    <section aria-label="Data vault">
      <motion.div
        className="glass-panel rounded-2xl p-4 sm:p-5"
        initial={{ opacity: 0, y: 14 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5, ease: [0.2, 0.85, 0.3, 1.1] }}
      >
        <div className="mb-3.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-gold/30 bg-gradient-to-b from-gold/20 to-transparent">
              <Database className="h-4 w-4 text-gold-soft" />
            </span>
            <h2 className="font-display text-base font-bold tracking-wide text-gold-gradient">
              Data Vault
            </h2>
          </div>
          <span
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]",
              cloudBad
                ? "border-amber-400/30 bg-amber-400/10 text-amber-300"
                : "border-emerald-400/25 bg-emerald-400/8 text-emerald-300"
            )}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                cloudBad ? "bg-amber-400" : "bg-emerald-400",
                pending > 0 && "animate-pulse"
              )}
            />
            {cloudBad ? "Local Safe" : "Turso Cloud"}
          </span>
        </div>

        {/* live storage economics */}
        <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <StatChip
            icon={cloudOk ? CheckCircle2 : cloudBad ? AlertTriangle : Database}
            label="Cloud archive"
            value={
              status.cloudGames === null
                ? "…"
                : `${status.cloudGames} duels`
            }
            tone={cloudBad ? "amber" : "green"}
          />
          <StatChip
            icon={CloudUpload}
            label="Sync queue"
            value={pending === 0 ? "Clear" : `${pending} waiting`}
            tone={pending > 0 ? "amber" : "green"}
          />
          <StatChip
            icon={HardDrive}
            label="Device storage"
            value={formatBytes(localBytes)}
          />
          <StatChip
            icon={FileSpreadsheet}
            label="Per duel"
            value="~0.3 KB"
          />
        </div>

        {/* actions */}
        <div className="grid gap-2.5 sm:grid-cols-2">
          <ActionButton
            icon={FileSpreadsheet}
            label="Export to Excel"
            hint="Games + profile → one .xlsx workbook"
            onClick={exportExcel}
            busy={busy === "excel"}
          />
          <ActionButton
            icon={FileJson}
            label="Full backup (JSON)"
            hint="One-click restore-grade snapshot"
            onClick={exportJson}
            busy={busy === "json"}
            variant="ghost"
          />
          <ActionButton
            icon={Copy}
            label="Copy PGN archive"
            hint="Every duel → any chess software"
            onClick={copyPgn}
            busy={busy === "pgn"}
            variant="ghost"
          />
          <ActionButton
            icon={RefreshCw}
            label="Sync now"
            hint={
              pending > 0
                ? `${pending} game${pending === 1 ? "" : "s"} waiting to fly`
                : "Verify the cloud mirror"
            }
            onClick={syncNow}
            busy={busy === "sync"}
          />
        </div>

        <p className="mt-3.5 text-[11px] leading-relaxed text-foreground/35">
          Zero-cost architecture: the oracle thinks on <em className="not-italic text-foreground/55">your</em> device,
          the cloud only remembers — one tiny PGN row per duel on Turso&apos;s
          free tier, mirrored locally. Outages can slow nothing down and lose
          nothing.
        </p>
      </motion.div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* footer cloud dot                                                    */
/* ------------------------------------------------------------------ */

export function CloudDot() {
  const [status, setStatus] = useState<CloudStatus>(getCloudStatus());
  useEffect(() => onCloudChange(() => setStatus({ ...getCloudStatus() })), []);

  const bad = status.lastOk === false;
  const busy = status.pending > 0;
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          bad ? "bg-amber-400/90" : "bg-emerald-400/80",
          busy && "animate-pulse"
        )}
      />
      <span className="hidden sm:inline">
        {bad ? "Local Safe Mode" : "Turso Sync"}
      </span>
      <span className="sm:hidden">{bad ? "Safe" : "Sync"}</span>
    </span>
  );
}
