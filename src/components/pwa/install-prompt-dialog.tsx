"use client";

/**
 * Sovereign Chess — the royal install popup.
 *
 * A proactive, premium invitation to take the arena home:
 *  - Android/desktop Chrome/Edge: one tap opens the native install sheet;
 *  - iOS Safari (no native API): illustrated Add-to-Home-Screen steps;
 *  - auto-opens once for eligible visitors, then rests for 3 days
 *    after a dismissal — never nagging, never in the way;
 *  - force a preview any time with "/?install=1".
 */

import { useEffect, useRef, useState } from "react";
import {
  Crown,
  Download,
  PlusSquare,
  Share,
  WifiOff,
  Zap,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  detectIOS,
  promptInstall,
  usePwaStore,
} from "@/lib/pwa-store";
import { toast } from "sonner";

const DISMISS_KEY = "sovereign.install-dismissed-at";
const COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000; // 3 days of peace after "not now"

export function InstallPromptDialog() {
  const installed = usePwaStore((s) => s.installed);
  const deferred = usePwaStore((s) => s.deferred);
  const open = usePwaStore((s) => s.promptOpen);
  const setOpen = usePwaStore((s) => s.setPromptOpen);
  const [ios, setIos] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const r = requestAnimationFrame(() => {
      setIos(detectIOS());

      // demo / preview override — "?install=1" always opens the popup
      if (new URLSearchParams(window.location.search).has("install")) {
        setOpen(true);
        return;
      }

      // auto-invite: once, 5s after landing, for eligible visitors only
      timerRef.current = window.setTimeout(() => {
        const state = usePwaStore.getState();
        if (state.installed || state.promptOpen) return;
        try {
          const last = Number(
            window.localStorage.getItem(DISMISS_KEY) || 0
          );
          if (Date.now() - last < COOLDOWN_MS) return;
        } catch {
          /* storage unavailable — still allow the invite */
        }
        if (state.deferred || detectIOS()) state.setPromptOpen(true);
      }, 5000);
    });

    return () => {
      cancelAnimationFrame(r);
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [setOpen]);

  const dismiss = () => {
    setOpen(false);
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* private mode — cooldown is session-only */
    }
  };

  const install = async () => {
    const outcome = await promptInstall();
    if (outcome === "accepted") {
      setOpen(false);
    } else if (outcome === "dismissed") {
      dismiss();
    }
    // "unavailable": keep the dialog open — nothing to fall back to
  };

  const nativeAvailable = Boolean(deferred) && !ios;

  return (
    <Dialog
      open={open && !installed}
      onOpenChange={(v) => {
        if (!v) dismiss();
      }}
    >
      <DialogContent className="glass-dialog max-w-[21rem] gap-4 rounded-2xl border-gold/30 p-6 sm:max-w-[23rem]">
        <div className="flex items-center gap-3.5">
          {/* app icon — local asset, next/image adds no value for a fixed 56px glyph */}
          <img
            src="/icons/icon-192.png"
            alt="Sovereign app icon"
            className="h-14 w-14 rounded-2xl border border-gold/45 shadow-[0_8px_28px_-8px_rgba(212,175,55,0.65)]"
          />
          <div>
            <DialogTitle className="font-display text-lg font-black tracking-wide text-gold-gradient">
              Take the Arena Home
            </DialogTitle>
            <DialogDescription className="mt-0.5 text-[12px] leading-snug text-foreground/60">
              Install Sovereign as a real app — free, 2&nbsp;MB, no store
              needed.
            </DialogDescription>
          </div>
        </div>

        <ul className="space-y-2 text-[12.5px] text-foreground/75">
          <li className="flex items-center gap-2.5">
            <WifiOff className="h-4 w-4 shrink-0 text-emerald-300" />
            Plays fully offline — train on flights and subways
          </li>
          <li className="flex items-center gap-2.5">
            <Zap className="h-4 w-4 shrink-0 text-gold-soft" />
            Instant launch from your home screen, full-screen
          </li>
          <li className="flex items-center gap-2.5">
            <Crown className="h-4 w-4 shrink-0 text-gold-soft" />
            Rating, streaks &amp; Excel vault stay on your device
          </li>
        </ul>

        {nativeAvailable ? (
          <div className="flex items-center gap-2">
            <Button
              onClick={() => void install()}
              className="h-10 flex-1 border border-[#8a6a24]/50 bg-gradient-to-b from-[#ecca6f] to-[#c69c3f] font-semibold text-[#241a05] hover:from-[#f3d887] hover:to-[#d4a94e]"
            >
              <Download className="mr-1.5 h-4 w-4" />
              Install App
            </Button>
            <Button
              variant="ghost"
              onClick={dismiss}
              className="h-10 text-foreground/50 hover:bg-white/5 hover:text-foreground/80"
            >
              Not now
            </Button>
          </div>
        ) : ios ? (
          <div className="space-y-2.5 rounded-xl border border-white/10 bg-white/[0.04] p-3.5">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-gold-soft">
              Add to Home Screen
            </p>
            <ol className="space-y-2 text-[12.5px] text-foreground/75">
              <li className="flex items-center gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-gold/40 bg-gold/10 font-mono text-[10px] font-bold text-gold-soft">
                  1
                </span>
                Tap <Share className="h-4 w-4 text-gold-soft" /> in the
                Safari toolbar
              </li>
              <li className="flex items-center gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-gold/40 bg-gold/10 font-mono text-[10px] font-bold text-gold-soft">
                  2
                </span>
                Choose <b className="text-foreground/90">&nbsp;Add to Home
                Screen&nbsp;</b> <PlusSquare className="h-4 w-4 text-gold-soft" />
              </li>
              <li className="flex items-center gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-gold/40 bg-gold/10 font-mono text-[10px] font-bold text-gold-soft">
                  3
                </span>
                Launch the crown like a native app
              </li>
            </ol>
            <Button
              onClick={dismiss}
              className="h-9 w-full border border-[#8a6a24]/50 bg-gradient-to-b from-[#ecca6f] to-[#c69c3f] font-semibold text-[#241a05] hover:from-[#f3d887] hover:to-[#d4a94e]"
            >
              Got it
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            onClick={dismiss}
            className="h-9 w-full text-foreground/50 hover:bg-white/5 hover:text-foreground/80"
          >
            Maybe later
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
