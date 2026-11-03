import { useMemo, useSyncExternalStore } from "react";
import type { Action, Briefing } from "./api";
import type { Lang } from "./assist";
import { draftBriefing } from "./briefing";

/** The Open WebUI key and the briefing it produced live in this browser only. */
const KEY = "avrora.webuiKey";
const BRIEFING = "avrora.aiBriefing";
/** Language the model writes the briefing and re-plan note in. */
const LANG = "avrora.lang";
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
  const lang = useSyncExternalStore(subscribe, savedLang, () => "en" as Lang);
  return { hasKey: Boolean(key), briefing, lang };
}

export const savedLang = (): Lang => (read(LANG) === "uk" ? "uk" : "en");
export const setLang = (l: Lang) => write(LANG, l);

export async function writeBriefing(actions: Action[], notices: Action[], key?: string, lang: Lang = savedLang()): Promise<void> {
  const k = (key ?? read(KEY) ?? "").trim();
  const b = await draftBriefing(k, actions, notices, lang);
  write(KEY, k);
  write(BRIEFING, JSON.stringify(b));
}

export function forgetKey() {
  write(KEY, null);
  write(BRIEFING, null);
}

/** The saved Open WebUI key, or an empty string. */
export const savedKey = () => (read(KEY) ?? "").trim();
