"use client";

import { useSyncExternalStore } from "react";

function subscribe(onStoreChange: () => void) {
  document.addEventListener("visibilitychange", onStoreChange);
  return () => document.removeEventListener("visibilitychange", onStoreChange);
}

function getSnapshot() {
  return document.visibilityState !== "hidden";
}

export function useDocumentVisibility() {
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}
