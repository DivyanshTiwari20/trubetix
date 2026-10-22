"use client";

import { useCallback, useSyncExternalStore } from "react";

const listeners = new Map<string, Set<() => void>>();

function emit(key: string): void {
  listeners.get(key)?.forEach((listener) => listener());
}

function subscribe(key: string, callback: () => void): () => void {
  const bucket = listeners.get(key) ?? new Set<() => void>();
  bucket.add(callback);
  listeners.set(key, bucket);

  const onStorage = (event: StorageEvent) => {
    if (event.key === key || event.key === null) callback();
  };
  window.addEventListener("storage", onStorage);

  return () => {
    bucket.delete(callback);
    window.removeEventListener("storage", onStorage);
  };
}

function readSnapshot(key: string, fallback: string): string {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Reads a string value from localStorage as external state so persisted UI
 * preferences hydrate without layout-shifting effects.
 */
export function useStoredString(key: string, fallback: string): [string, (value: string) => void] {
  const subscribeToKey = useCallback((callback: () => void) => subscribe(key, callback), [key]);
  const getSnapshot = useCallback(() => readSnapshot(key, fallback), [key, fallback]);
  const getServerSnapshot = useCallback(() => fallback, [fallback]);

  const value = useSyncExternalStore(subscribeToKey, getSnapshot, getServerSnapshot);

  const setValue = useCallback(
    (next: string) => {
      try {
        window.localStorage.setItem(key, next);
      } catch {
        // ignore write failures (quota / privacy mode)
      }
      emit(key);
    },
    [key],
  );

  return [value, setValue];
}

export function useStoredBoolean(
  key: string,
  fallback: boolean,
): [boolean, (value: boolean) => void] {
  const [raw, setRaw] = useStoredString(key, fallback ? "true" : "false");
  const setValue = useCallback((value: boolean) => setRaw(value ? "true" : "false"), [setRaw]);
  return [raw === "true", setValue];
}
