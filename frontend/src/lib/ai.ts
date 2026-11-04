import { useMemo, useSyncExternalStore } from "react";
import type { Action, Briefing } from "./api";
import type { Lang } from "./assist";
import { draftBriefing } from "./briefing";
import { ModelError, type OwnProvider, readOwn, type Route, validBaseUrl } from "./model";

/**
 * Which AI writes the texts. By default the store's own model through this app's server
 * (`/api/ai/status`, `/api/ai/chat`); its key never reaches the browser. A manager may save their
 * own provider (base URL, model, key) on this device; it overrides the server here only.
 */
const OWN = "avrora.aiOwn";
const BRIEFING = "avrora.aiBriefing";
/** Language the model writes the briefing and re-plan note in. */
const LANG = "avrora.lang";
/** Older builds kept a key for a university server here. */
const LEGACY = "avrora.webuiKey";
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

const read = (k: string) => (typeof window === "undefined" ? null : window.localStorage.getItem(k));
const write = (k: string, v: string | null) => {
  if (v === null) window.localStorage.removeItem(k);
  else window.localStorage.setItem(k, v);
  notify();
};

/** Store server status: "" while unknown or off, otherwise the model name. */
let serverModel = "";
let statusAsked = false;
export function refreshStatus(): Promise<void> {
  statusAsked = true;
  return fetch("/api/ai/status")
    .then((r) => (r.ok ? (r.json() as Promise<{ configured?: boolean; model?: string | null }>) : null))
    .then((s) => {
      serverModel = s?.configured ? s.model || "AI" : "";
    })
    .catch(() => {
      serverModel = "";
    })
    .finally(notify);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  window.addEventListener("storage", l);
  if (!statusAsked) {
    if (read(LEGACY) !== null) window.localStorage.removeItem(LEGACY);
    void refreshStatus();
  }
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", l);
  };
};

/** "own" when this device has its own provider, "server" when the store AI is set up, "" for rules only. */
export function aiRoute(): Route {
  if (readOwn()) return "own";
  return serverModel ? "server" : "";
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** The saved briefing carries the day it was written; one from another day, or a broken value, is ignored. */
function parseBriefing(raw: string | null): Briefing | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { date?: unknown; briefing?: Briefing } | null;
    return v && v.date === today() && v.briefing && Array.isArray(v.briefing.priorities) ? v.briefing : null;
  } catch {
    return null;
  }
}

export function useAi() {
  const ownRaw = useSyncExternalStore(subscribe, () => read(OWN), () => null);
  const server = useSyncExternalStore(subscribe, () => serverModel, () => "");
  const raw = useSyncExternalStore(subscribe, () => read(BRIEFING), () => null);
  const briefing = useMemo(() => parseBriefing(raw), [raw]);
  const lang = useSyncExternalStore(subscribe, savedLang, () => "en" as Lang);
  const own = useMemo(() => (ownRaw ? readOwn() : null), [ownRaw]);
  /** hasKey: some AI is available on this device (store server or own key). */
  return { hasKey: Boolean(own || server), serverModel: server, own, briefing, lang };
}

export const savedLang = (): Lang => (read(LANG) === "uk" ? "uk" : "en");
export const setLang = (l: Lang) => write(LANG, l);

export async function writeBriefing(actions: Action[], notices: Action[], lang: Lang = savedLang()): Promise<void> {
  const b = await draftBriefing(aiRoute(), actions, notices, lang);
  write(BRIEFING, JSON.stringify({ date: today(), briefing: b }));
}

/** Saves this device's own provider and returns a function that puts the previous one back (use it if the first call fails). */
export function saveOwn(p: OwnProvider): () => void {
  if (!validBaseUrl(p.baseUrl)) throw new ModelError("The base URL must start with https:// (http:// only for localhost).");
  const previous = read(OWN);
  write(OWN, JSON.stringify({ baseUrl: p.baseUrl.trim(), model: p.model.trim(), key: p.key.trim() }));
  return () => write(OWN, previous);
}

/** Removes this device's own provider and the briefing it wrote; the store AI is used again if set up. */
export function forgetOwn() {
  write(OWN, null);
  write(BRIEFING, null);
}
