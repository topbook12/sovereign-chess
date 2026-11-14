"use client";

/**
 * Sovereign Chess — PWA provider.
 *
 * Registers the hand-rolled service worker (after first paint so it never
 * competes with page load), captures the native install prompt, watches
 * connectivity and detects standalone mode. In production builds it also
 * flips the worker into full asset-caching mode via the ?prod=1 flag.
 */

import { useEffect } from "react";
import { toast } from "sonner";
import {
  usePwaStore,
  type BeforeInstallPromptEvent,
} from "@/lib/pwa-store";

export function PwaProvider() {
  useEffect(() => {
    /* ---------------- standalone / installed detection ---------------- */
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      window.matchMedia("(display-mode: minimal-ui)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone ===
        true;
    if (standalone) usePwaStore.getState().setInstalled(true);

    /* ---------------- online / offline ---------------- */
    usePwaStore.getState().setOffline(!navigator.onLine);
    const goOffline = () => {
      usePwaStore.getState().setOffline(true);
      toast.warning(
        "Connection lost — offline mode. Your games and progress are safe on this device."
      );
    };
    const goOnline = () => {
      usePwaStore.getState().setOffline(false);
      toast.success("Back online — cloud sync resumed.");
    };
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);

    /* ---------------- install flow ---------------- */
    const onPrompt = (raw: Event) => {
      raw.preventDefault();
      usePwaStore
        .getState()
        .setDeferred(raw as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      usePwaStore.getState().setInstalled(true);
      toast.success(
        "Sovereign installed — the arena now lives on your device, even offline."
      );
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    /* ---------------- service worker registration ---------------- */
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    let readyTimer: ReturnType<typeof setTimeout> | undefined;
    if ("serviceWorker" in navigator) {
      // register shortly after load — never compete with first paint
      cleanupTimer = setTimeout(() => {
        navigator.serviceWorker
          .register("/sw.js", { scope: "/" })
          .then((reg) => {
            usePwaStore.getState().setReady(true);
            // pick up a waiting worker promptly in future sessions
            reg.addEventListener("updatefound", () => {
              const next = reg.installing;
              next?.addEventListener("statechange", () => {
                if (
                  next.state === "installed" &&
                  navigator.serviceWorker.controller
                ) {
                  next.postMessage("SKIP_WAITING");
                }
              });
            });
            // one-time celebration: the arena now survives airplane mode
            readyTimer = setTimeout(() => {
              try {
                if (window.localStorage.getItem("sovereign.offline-ready"))
                  return;
                window.localStorage.setItem("sovereign.offline-ready", "1");
              } catch {
                return; // private mode — skip the toast silently
              }
              toast.success(
                "Offline ready — Sovereign now plays without a connection.",
                {
                  description:
                    "Install it from the crown button to launch from your home screen.",
                }
              );
            }, 5000);
          })
          .catch(() => {
            /* offline support is a bonus — never a blocker */
          });
      }, 1800);
    }

    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      if (cleanupTimer) clearTimeout(cleanupTimer);
      if (readyTimer) clearTimeout(readyTimer);
    };
  }, []);

  return null;
}
