/**
 * Sovereign Chess — PWA state store.
 *
 * Tracks the install flow (beforeinstallprompt / appinstalled), the
 * standalone display mode, online/offline status and the visibility of
 * the custom install popup. Zustand keeps it dependency-light and shared
 * across the header, dialogs and toasts.
 */
import { create } from "zustand";

export interface BeforeInstallPromptEvent extends Event {
  /** Shows the native install prompt. Must be user-gesture initiated. */
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface PwaState {
  /** Native install prompt captured from beforeinstallprompt, if any. */
  deferred: BeforeInstallPromptEvent | null;
  /** App is running installed (standalone) or has just been installed. */
  installed: boolean;
  offline: boolean;
  /** True when the service worker is active — the app can work offline. */
  ready: boolean;
  /** The custom install popup visibility. */
  promptOpen: boolean;
  setDeferred: (e: BeforeInstallPromptEvent | null) => void;
  setInstalled: (v: boolean) => void;
  setOffline: (v: boolean) => void;
  setReady: (v: boolean) => void;
  setPromptOpen: (v: boolean) => void;
}

export const usePwaStore = create<PwaState>()((set) => ({
  deferred: null,
  installed: false,
  offline: false,
  ready: false,
  promptOpen: false,
  setDeferred: (e) => set({ deferred: e }),
  setInstalled: (v) => set({ installed: v, deferred: null }),
  setOffline: (v) => set({ offline: v }),
  setReady: (v) => set({ ready: v }),
  setPromptOpen: (v) => set({ promptOpen: v }),
}));

/** Ask the browser to show the native install prompt (where supported). */
export async function promptInstall(): Promise<
  "accepted" | "dismissed" | "unavailable"
> {
  const { deferred, setDeferred } = usePwaStore.getState();
  if (!deferred) return "unavailable";
  try {
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome === "accepted") {
      // appinstalled will also fire; set immediately for snappy UI
      usePwaStore.getState().setInstalled(true);
    }
    setDeferred(null);
    return outcome;
  } catch {
    return "unavailable";
  }
}

/** iPhone / iPad / iPod (including iPadOS 13+ desktop-class UA). */
export function detectIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const iOSUA = /iphone|ipad|ipod/i.test(ua);
  const iPadOS = /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
  return iOSUA || iPadOS;
}

/** Running as an installed app rather than a browser tab. */
export function detectStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: minimal-ui)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone ===
      true
  );
}
