import { useMemo, useSyncExternalStore } from "react";
import type { Action, Briefing } from "./api";
import type { Lang } from "./assist";
import { draftBriefing } from "./briefing";
import type { Route } from "./model";

/**
 * Which AI writes the texts: the store's own model through this app's server
 * (`/api/ai/status`, `/api/ai/chat`). Its key stays on the server; the browser never holds one.
 */
const BRIEFING = "avrora.aiBriefing";
/** Language the model writes the briefing and re-plan note in. */
const LANG = "avrora.lang";
/** Older builds kept a key in the browser under these names; they are cleared on load. */
const LEGACY = ["avrora.webuiKey", "avrora.aiOwn"];
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
/** False until the first `/api/ai/status` answer (or failure); until then AI is "loading", not "off". */
let statusKnown = false;
let statusAsked: Promise<void> | null = null;
export function refreshStatus(): Promise<void> {
  statusAsked = fetch("/api/ai/status")
    .then((r) => (r.ok ? (r.json() as Promise<{ configured?: boolean; model?: string | null }>) : null))
    .then((s) => {
      serverModel = s?.configured ? s.model || "AI" : "";
    })
    .catch(() => {
      serverModel = "";
    })
    .finally(() => {
      statusKnown = true;
      notify();
    });
  return statusAsked;
}

/** Resolves once the store AI status is known, so a click never runs on "unknown". */
export function aiStatus(): Promise<void> {
  if (statusKnown) return Promise.resolve();
  return statusAsked ?? refreshStatus();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  window.addEventListener("storage", l);
  if (!statusAsked) {
    for (const k of LEGACY) if (read(k) !== null) window.localStorage.removeItem(k);
    void refreshStatus();
  }
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", l);
  };
};

/** "server" when the store AI is set up, "" for rules only. */
export function aiRoute(): Route {
  return serverModel ? "server" : "";
}

export function useAi() {
  const server = useSyncExternalStore(subscribe, () => serverModel, () => "");
  const raw = useSyncExternalStore(subscribe, () => read(BRIEFING), () => null);
  const briefing = useMemo(() => (raw ? (JSON.parse(raw) as Briefing) : null), [raw]);
  const lang = useSyncExternalStore(subscribe, savedLang, () => "en" as Lang);
  const ready = useSyncExternalStore(subscribe, () => statusKnown, () => false);
  /**
   * hasKey: the store AI is set up on the server.
   * ready: false while the store AI status is still loading; treat that as "wait", never as "no AI".
   */
  return { hasKey: Boolean(server), ready, briefing, lang };
}

export const savedLang = (): Lang => (read(LANG) === "uk" ? "uk" : "en");
export const setLang = (l: Lang) => write(LANG, l);

export async function writeBriefing(actions: Action[], notices: Action[], lang: Lang = savedLang()): Promise<void> {
  const b = await draftBriefing(aiRoute(), actions, notices, lang);
  write(BRIEFING, JSON.stringify(b));
}
