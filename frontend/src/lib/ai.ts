import { useMemo, useSyncExternalStore } from "react";
import type { Action, Briefing } from "./api";
import { draftBriefing } from "./briefing";

/** The Open WebUI key and the briefing it produced live in this browser only. */
const KEY = "avrora.webuiKey";
const BRIEFING = "avrora.aiBriefing";
const listeners = new Set<() => void>();

const read = (k: string) => (typeof window === "undefined" ? null : window.localStorage.getItem(k));
const write = (k: string, v: string | null) => {
  if (v === null) window.localStorage.removeItem(k);
  else window.localStorage.setItem(k, v);
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  window.addEventListener("storage", l);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", l);
  };
};

export function useAi() {
  const key = useSyncExternalStore(subscribe, () => read(KEY), () => null);
  const raw = useSyncExternalStore(subscribe, () => read(BRIEFING), () => null);
  const briefing = useMemo(() => (raw ? (JSON.parse(raw) as Briefing) : null), [raw]);
  return { hasKey: Boolean(key), briefing };
}

export async function writeBriefing(actions: Action[], notices: Action[], key?: string): Promise<void> {
  const k = (key ?? read(KEY) ?? "").trim();
  const b = await draftBriefing(k, actions, notices);
  write(KEY, k);
  write(BRIEFING, JSON.stringify(b));
}

export function forgetKey() {
  write(KEY, null);
  write(BRIEFING, null);
}
