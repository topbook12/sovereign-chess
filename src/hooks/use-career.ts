"use client";

/**
 * useCareer — live React binding to the sovereign profile.
 * Re-renders whenever any part of the platform grants a reward.
 * Implemented as an external-store subscription (no cascading renders).
 */

import { useEffect, useSyncExternalStore } from "react";
import {
  PROFILE_EVENT,
  emptyProfile,
  loadProfile,
  pullCloudProfile,
  type CareerProfile,
} from "@/lib/game-store";

// cached snapshot — refreshed only when a change event fires
let snapshot: CareerProfile | null = null;
// stable server snapshot (must be cached to avoid hydration loops)
const SERVER_SNAPSHOT: CareerProfile = emptyProfile();

function getSnapshot(): CareerProfile {
  if (snapshot === null) snapshot = loadProfile();
  return snapshot;
}

function getServerSnapshot(): CareerProfile {
  return SERVER_SNAPSHOT;
}

function subscribe(onStoreChange: () => void): () => void {
  const handler = () => {
    snapshot = loadProfile(); // refresh the cache before notifying React
    onStoreChange();
  };
  window.addEventListener(PROFILE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(PROFILE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

export function useCareer(): CareerProfile {
  // adopt a newer cloud copy once per mount (fire-and-forget)
  useEffect(() => {
    void pullCloudProfile();
  }, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
