"use client";

import { AnimatePresence, LayoutGroup, motion, useDragControls } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import useSWR from "swr";
import { ActionRow } from "@/components/ActionRow";
import { AiSheet } from "@/components/AiSheet";
import { DetailPanel, ignoreShortcut } from "@/components/DetailPanel";
import { ProductsView } from "@/components/ProductsView";
import { NotificationsSheet } from "@/components/NotificationsSheet";
import { LiveConditions } from "@/components/LiveConditions";
import { NetworkMap } from "@/components/NetworkMap";
import { BackIcon, BellIcon, BoltIcon, ChevronIcon, ClockIcon, GridIcon, ListIcon, MapIcon, MoreIcon, SparkleIcon, SunIcon, TypeIcon } from "@/components/icons";
import { Ring } from "@/components/Ring";
import type { Action, ActionType, Briefing, Decision, DecisionKind, Overview, Signal, Signals } from "@/lib/api";
import { savedKey, useAi } from "@/lib/ai";
import { applyOrder, type Replan, replanByRules, replanWithModel } from "@/lib/replan";
import { api, fetcher } from "@/lib/api";
import { ModelError } from "@/lib/ollama";
import { longDate, money, TYPE_META } from "@/lib/format";

type View = "today" | "products" | "all" | "log" | "map" | "more";

const TITLES: Record<View, string> = {
  today: "Today",
  products: "Products",
  all: "All suggestions",
  log: "Decisions",
  map: "Map",
  more: "More",
};

/** Phone tab bar: the four daily sections plus More (All suggestions and settings). */
const TABS: { id: View; label: string; Icon: typeof SunIcon }[] = [
  { id: "today", label: "Today", Icon: SunIcon },
  { id: "products", label: "Products", Icon: GridIcon },
  { id: "map", label: "Map", Icon: MapIcon },
  { id: "log", label: "Decisions", Icon: ClockIcon },
  { id: "more", label: "More", Icon: MoreIcon },
];

const FILTERS: (ActionType | "ALL")[] = ["ALL", "ORDER", "DISCOUNT", "MOVE_TO_FRONT", "CHECK_DELIVERY"];

type Toast = { key: number; text: string; undoId?: string; error?: boolean };

const doneText = (kind: DecisionKind) => (kind === "reject" ? "Dismissed" : "Approved");

function useMedia(query: string) {
  return useSyncExternalStore(
    (on) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", on);
      return () => m.removeEventListener("change", on);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export default function Home() {
  const [view, setViewState] = useState<View>("today");
  const mainRef = useRef<HTMLElement>(null);
  const setView = (v: View) => {
    // tapping the current tab again scrolls back to the top, as on iOS
    if (v === view) mainRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    else mainRef.current?.scrollTo({ top: 0 });
    setViewState(v);
  };
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("ALL");
  const wide = useMedia("(min-width: 1024px)");
  const reduceMotion = useMedia("(prefers-reduced-motion: reduce)");

  const { data: overview, error: overviewError, mutate: retryOverview, isValidating: retrying } = useSWR<Overview>("/api/overview", fetcher);
  const { data: baseBriefing } = useSWR<Briefing>("/api/briefing", fetcher);
  const ai = useAi();
  const briefing = ai.briefing ?? baseBriefing;
  const [aiOpen, setAiOpen] = useState(false);
  // the Products view reports its fixed panel so the content column and the tab bar make room for it
  const [productPanel, setProductPanel] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);

  // Notification taps open the app at /?action=<id>, or message an already open window.
  // The service worker is registered when notifications are turned on and stays registered.
  useEffect(() => {
    const openUrl = (href: string) => {
      const id = new URL(href, location.href).searchParams.get("action");
      if (!id) return;
      setViewState("today");
      setSelectedId(id);
    };
    openUrl(location.href);
    if (location.search) history.replaceState(null, "", location.pathname);
    const onMessage = (e: MessageEvent) => e.data?.type === "open-url" && openUrl(e.data.url);
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", onMessage);
  }, []);

  // iOS keeps the layout height when the keyboard opens; sheets lift by the covered height instead.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty("--kb", `${Math.round(covered)}px`);
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  // Phones: the large title folds into a compact bar once it scrolls under it.
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const onScroll = () => {
      const h1 = main.querySelector("h1");
      const top = main.getBoundingClientRect().top;
      setCompact(h1 ? h1.getBoundingClientRect().bottom - top < 48 : main.scrollTop > 40);
    };
    onScroll();
    main.addEventListener("scroll", onScroll, { passive: true });
    return () => main.removeEventListener("scroll", onScroll);
  }, [view]);

  const { data: actions } = useSWR<Action[]>("/api/actions", fetcher);
  // Outside conditions; if the route is missing or fails, the card simply stays hidden.
  const { data: signals } = useSWR<Signals>("/api/signals", fetcher, { refreshInterval: 60_000, shouldRetryOnError: false });
  const [replanState, setReplan] = useState<Replan | null>(null);
  const [replanBusy, setReplanBusy] = useState(false);
  const [replanError, setReplanError] = useState<string | null>(null);
  const { data: decisions, mutate: mutateDecisions } = useSWR<Decision[]>("/api/decisions", fetcher);

  const all = useMemo(() => {
    const byId = new Map<string, Action>();
    for (const a of [...(briefing?.priorities ?? []), ...(actions ?? [])]) if (!byId.has(a.id)) byId.set(a.id, a);
    return byId;
  }, [briefing, actions]);
  const selected = selectedId ? all.get(selectedId) : undefined;

  const [toast, setToast] = useState<Toast | null>(null);
  const showToast = useCallback((t: Omit<Toast, "key">) => setToast({ ...t, key: Date.now() }), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.error ? 6000 : 5000);
    return () => clearTimeout(t);
  }, [toast]);

  // Decisions show at once and are saved in the background; a failed save rolls back with a plain message.
  // Saves for one item run in order, so an undo never overtakes the approval it undoes.
  const pending = useRef(new Map<string, Promise<unknown>>());
  const queue = useCallback(<T,>(id: string, work: () => Promise<T>) => {
    const p = (pending.current.get(id) ?? Promise.resolve()).catch(() => undefined).then(work);
    pending.current.set(id, p);
    return p;
  }, []);
  // Decisions show at once (local overrides) and are saved in the background; a failed save drops
  // the override, so the row returns, and says so plainly. Concurrent saves never overwrite each other.
  const [overrides, setOverrides] = useState(new Map<string, { seq: number; d: Decision | null }>());
  const seq = useRef(0);
  const shown = useMemo(() => {
    const base = (decisions ?? []).filter((d) => !overrides.has(d.action_id));
    const local = [...overrides.values()].map((o) => o.d).filter((d): d is Decision => d !== null);
    return [...local.reverse(), ...base];
  }, [decisions, overrides]);
  const decided = useMemo(() => new Map(shown.map((d) => [d.action_id, d])), [shown]);

  const save = useCallback(
    (id: string, d: Decision | null, work: () => Promise<Decision | null>, failText: string) => {
      const mine = ++seq.current;
      setOverrides((m) => {
        const n = new Map(m);
        n.delete(id); // re-insert so the newest decision sorts first
        return n.set(id, { seq: mine, d });
      });
      const clear = () =>
        setOverrides((m) => {
          if (m.get(id)?.seq !== mine) return m;
          const n = new Map(m);
          n.delete(id);
          return n;
        });
      return queue(id, work)
        .then((saved) =>
          mutateDecisions((cur) => {
            const rest = (cur ?? []).filter((x) => x.action_id !== id);
            return saved ? [saved, ...rest] : rest;
          }, { revalidate: false }),
        )
        .then(clear, () => {
          clear();
          showToast({ text: failText, error: true });
        });
    },
    [mutateDecisions, queue, showToast],
  );
  const decide = useCallback(
    (id: string, kind: DecisionKind, opts?: { reason?: string; value?: number }) => {
      const optimistic: Decision = {
        action_id: id,
        decision: kind,
        reason: opts?.reason ?? null,
        value: opts?.value ?? null,
        decided_at: new Date().toISOString(),
      };
      return save(id, optimistic, () => api.decide(id, kind, opts), "That decision wasn't saved. Check the connection and try again.");
    },
    [save],
  );
  const undo = useCallback(
    (id: string) =>
      save(id, null, async () => {
        await api.undo(id);
        return null;
      }, "The undo wasn't saved. Check the connection and try again."),
    [save],
  );
  const runReplan = async (s: Signal) => {
    const base = briefing?.priorities ?? [];
    setReplanError(null);
    if (!ai.hasKey) return setReplan(replanByRules(s, base, ai.lang));
    setReplanBusy(true);
    try {
      setReplan(await replanWithModel(savedKey(), s, base, ai.lang));
    } catch (err) {
      setReplanError(err instanceof ModelError ? err.message : "The new order could not be worked out. Try again.");
    } finally {
      setReplanBusy(false);
    }
  };
  const toggle = (a: Action) => {
    if (decided.has(a.id)) return void undo(a.id);
    void decide(a.id, "approve");
    showToast({ text: `Approved ${a.product_name}`, undoId: a.id });
  };

  // a re-plan only holds while its signal is still current
  const replan = replanState && signals?.signals.some((s) => s.id === replanState.signalId) ? replanState : null;
  const basePriorities = briefing?.priorities ?? [];
  const priorities = replan ? applyOrder(basePriorities, replan.order) : basePriorities;
  const movedUp = (a: Action) => replan !== null && priorities.indexOf(a) < basePriorities.indexOf(a);
  const open = priorities.filter((a) => !decided.has(a.id));
  const handled = priorities.filter((a) => decided.has(a.id));
  const list = (actions ?? []).filter((a) => filter === "ALL" || a.type === filter);

  /** The rows on screen, in order: j/k walk them and a decision moves on through them. */
  const context: Action[] =
    view === "today"
      ? [...open, ...handled]
      : view === "all"
        ? list
        : view === "log"
          ? shown.map((d) => all.get(d.action_id)).filter((a): a is Action => Boolean(a))
          : [];

  const decideFromPanel = (a: Action, kind: DecisionKind, opts?: { reason?: string; value?: number }) => {
    void decide(a.id, kind, opts);
    showToast({ text: `${doneText(kind)} ${a.product_name}`, undoId: a.id });
    // next undecided row after this one (wrapping), or close when nothing is left
    const ids = context.map((x) => x.id);
    const at = ids.indexOf(a.id);
    const ordered = at < 0 ? [] : [...context.slice(at + 1), ...context.slice(0, at)];
    const next = ordered.find((x) => !decided.has(x.id) && x.id !== a.id);
    setSelectedId(next?.id ?? null);
  };

  const keys = useRef({ context, selectedId });
  useEffect(() => {
    keys.current = { context, selectedId };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== "j" && e.key !== "k") || ignoreShortcut(e)) return;
      const { context: rows, selectedId: cur } = keys.current;
      if (rows.length === 0) return;
      const i = rows.findIndex((r) => r.id === cur);
      const next = i < 0 ? 0 : Math.min(Math.max(i + (e.key === "j" ? 1 : -1), 0), rows.length - 1);
      e.preventDefault();
      setSelectedId(rows[next].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // swipe the detail sheet down to close it (phones; the inspector column on wide screens doesn't move)
  const sheetDrag = useDragControls();

  if (overviewError && view !== "map") {
    return (
      <main className="grid h-full place-items-center p-8 text-center">
        <div>
          <h1 className="text-[22px] font-semibold">Can&apos;t load the store data</h1>
          <p className="mt-2 text-label-2">Check your connection and try again.</p>
          <button
            onClick={() => retryOverview()}
            disabled={retrying}
            className="t-body mt-5 rounded-[12px] bg-tint-fill px-5 py-2 font-semibold text-white active:opacity-80 disabled:opacity-50"
          >
            {retrying ? "Trying…" : "Retry"}
          </button>
        </div>
      </main>
    );
  }

  const header = (title: string, subtitle?: string, trailing?: React.ReactNode) => (
    <header className="flex items-end justify-between gap-4 px-1">
      <div className="min-w-0">
        {subtitle && <p className="t-subhead text-label-2">{subtitle}</p>}
        <h1 className="t-large-title">{title}</h1>
      </div>
      {trailing}
    </header>
  );

  const tabActive = (id: View) => view === id || (id === "more" && view === "all");
  const settingsRow = (label: string, color: string, Icon: typeof SunIcon, onClick: () => void, detail?: string) => (
    <button onClick={onClick} className="cell flex min-h-[44px] w-full items-center gap-3 px-4 py-[7px] text-left [--inset:58px] active:bg-fill">
      <span className="icon-tile size-[30px]" style={{ background: color }}>
        <Icon size={17} />
      </span>
      <span className="t-body flex-1">{label}</span>
      {detail && <span className="t-body num text-label-2" aria-hidden>{detail}</span>}
      <ChevronIcon className="text-[#c4c4c7]" />
    </button>
  );

  return (
    <div className="flex h-full overflow-hidden">
      <main
        ref={mainRef}
        className={`relative min-w-0 flex-1 ${
          view === "map"
            ? "overflow-hidden pt-[env(safe-area-inset-top)] md:pt-0"
            : "pb-tabbar overflow-y-auto overscroll-contain"
        } ${productPanel && view === "products" ? "lg:mr-[400px]" : ""}`}
      >
        {/* Phones: compact navigation bar the large title folds into */}
        {view !== "map" && (
          <div className="pointer-events-none sticky top-0 z-10 h-0 md:hidden">
            <div
              className={`material absolute inset-x-0 top-0 border-b pt-[env(safe-area-inset-top)] transition-[background-color,border-color] duration-200 ${
                compact ? "border-separator bg-[var(--bar-on-bg)]" : "border-transparent bg-transparent"
              }`}
            >
              <div
                aria-hidden={!compact}
                className={`t-headline grid h-11 place-items-center px-16 transition-opacity duration-200 ${compact ? "opacity-100" : "opacity-0"}`}
              >
                <span className="truncate">{TITLES[view]}</span>
              </div>
            </div>
          </div>
        )}
        {view === "map" && <NetworkMap />}
        <div className={view === "map" ? "hidden" : "mx-auto max-w-[720px] px-4 pb-16 pt-[calc(env(safe-area-inset-top)+16px)] md:px-8 md:pt-10"}>
          {view === "today" && (
            <>
              {header(
                "Today",
                overview ? longDate(overview.today) : " ",
                priorities.length > 0 ? <Ring done={handled.length} total={priorities.length} /> : null,
              )}
              <p className="t-body mt-2 px-1 text-label-2" lang={briefing?.lang} data-testid="summary">{briefing?.summary ?? "Preparing today's priorities…"}</p>
              {briefing && (
                <p className="t-footnote mt-2 flex flex-wrap items-center gap-x-1.5 px-1 text-label-2">
                  <SparkleIcon size={13} className={briefing.source === "model" ? "text-tint" : ""} />
                  {briefing.source === "model" ? "Written by AI. Numbers checked against store data." : "Sorted by fixed rules, not AI."}
                  <button onClick={() => setAiOpen(true)} className="hit font-medium text-tint">
                    {briefing.source === "model" ? "AI settings" : "Write with AI"}
                  </button>
                </p>
              )}

              {signals && (
                <LiveConditions
                  data={signals}
                  replan={replan}
                  busy={replanBusy}
                  error={replanError}
                  hasKey={ai.hasKey}
                  lang={ai.lang}
                  onReplan={runReplan}
                  onRevert={() => setReplan(null)}
                />
              )}

              {briefing?.notices.map((n) => (
                <div key={n.id} className="group-list mt-6 flex items-start gap-3 px-4 py-3">
                  <span className="icon-tile size-[30px]" style={{ background: "var(--note)" }}>
                    <BoltIcon size={17} />
                  </span>
                  <div>
                    <div className="t-body">Store note</div>
                    <p className="t-subhead mt-0.5 text-label-2">{n.reason}</p>
                  </div>
                </div>
              ))}

              <LayoutGroup>
                <section className="mt-8">
                  <h2 className="group-header">{open.length || !briefing ? "To decide" : "All done"}</h2>
                  <motion.ul layout className="group-list">
                    <AnimatePresence initial={false}>
                      {open.map((a) => (
                        <ActionRow
                          key={a.id}
                          action={a}
                          selected={a.id === selectedId}
                          onOpen={() => setSelectedId(a.id)}
                          onToggle={() => toggle(a)}
                          movedUp={movedUp(a)}
                        />
                      ))}
                    </AnimatePresence>
                    {!briefing && <li className="h-[320px] animate-pulse bg-fill" />}
                    {briefing && open.length === 0 && (
                      <li className="t-subhead px-4 py-4 text-label-2">
                        Every priority has a decision. More ahead in All suggestions.
                      </li>
                    )}
                  </motion.ul>
                  <p className="group-footer">Tap the circle to approve. Open a row to see why, adjust or dismiss.</p>
                </section>

                {handled.length > 0 && (
                  <motion.section layout className="mt-8">
                    <h2 className="group-header">Handled</h2>
                    <motion.ul layout className="group-list">
                      <AnimatePresence initial={false}>
                        {handled.map((a) => (
                          <ActionRow
                            key={a.id}
                            action={a}
                            decision={decided.get(a.id)}
                            selected={a.id === selectedId}
                            onOpen={() => setSelectedId(a.id)}
                            onToggle={() => toggle(a)}
                          />
                        ))}
                      </AnimatePresence>
                    </motion.ul>
                  </motion.section>
                )}
              </LayoutGroup>

              {overview && (
                <section className="mt-8">
                  <h2 className="group-header">Store health</h2>
                  <dl className="group-list">
                    {[
                      ["Items running out", `${overview.stockout_risks}`],
                      ["Late deliveries", `${overview.late_deliveries}`],
                      ["Items hard to find", `${overview.visibility_issues}`],
                      ["Value in slow stock", money(overview.slow_stock_value_uah)],
                    ].map(([k, v]) => (
                      <div key={k} className="cell flex items-center justify-between gap-3 px-4 py-[11px]">
                        <dt className="t-body">{k}</dt>
                        <dd className="t-body num text-label-2">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )}
            </>
          )}

          {view === "products" && <ProductsView onOpenAction={(id) => setSelectedId(id)} onPanel={setProductPanel} />}

          {view === "more" && (
            <>
              {header("More")}
              <div className="group-list mt-6 flex items-center gap-3 px-4 py-3">
                {/* eslint-disable-next-line @next/next/no-img-element -- static export, SVG mark */}
                <img src="/avrora-mark.svg" alt="Avrora" width={44} height={44} className="size-11 shrink-0" />
                <div className="min-w-0">
                  <div className="t-headline truncate">{overview?.store_name.split(", ")[0] ?? "\u00a0"}</div>
                  <div className="t-subhead truncate text-label-2">
                    {overview ? `${overview.store_name.split(", ")[1] ?? ""} · ${overview.products} products` : "\u00a0"}
                  </div>
                </div>
              </div>
              <section className="mt-6">
                <div className="group-list">
                  {settingsRow("All suggestions", "var(--move)", ListIcon, () => setView("all"), actions ? `${actions.length}` : undefined)}
                </div>
                <p className="group-footer">Everything the store data points to, beyond today&apos;s five.</p>
              </section>
              <section className="mt-8">
                <h2 className="group-header">Settings</h2>
                <div className="group-list">
                  {settingsRow("AI briefing", "var(--delivery)", SparkleIcon, () => setAiOpen(true))}
                  {settingsRow("Notifications", "var(--order)", BellIcon, () => setNotifOpen(true))}
                </div>
                <p className="group-footer hidden [@media(hover:hover)_and_(pointer:fine)]:block" data-testid="shortcuts">
                  Keyboard: J and K move through the list, A approves, D dismisses, Esc closes.
                </p>
              </section>
              {overview && (
                <section className="mt-8">
                  <h2 className="group-header">Store</h2>
                  <dl className="group-list">
                    {[
                      ["Store", overview.store_name.split(", ")[0]],
                      ["City", overview.store_name.split(", ")[1] ?? ""],
                      ["Products", `${overview.products}`],
                    ].map(([k, v]) => (
                      <div key={k} className="cell flex items-center justify-between gap-3 px-4 py-[11px]">
                        <dt className="t-body">{k}</dt>
                        <dd className="t-body num text-right text-label-2">{v}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="group-footer">Store data is made up for this demo. Map: avrora.ua, © OpenStreetMap contributors.</p>
                </section>
              )}
            </>
          )}

          {view === "all" && (
            <>
              <button
                onClick={() => setView("more")}
                className="t-body -ml-1.5 mb-1 flex min-h-[44px] items-center gap-0.5 text-tint"
              >
                <BackIcon size={20} />
                More
              </button>
              {header("All suggestions")}
              <p className="t-body mt-2 px-1 text-label-2">Everything the store data points to, highest value first.</p>
              <div role="tablist" aria-label="Filter by type" className="mt-6 flex w-full rounded-[9px] bg-fill p-[2px] sm:w-auto sm:inline-flex">
                {FILTERS.map((f) => (
                  <button
                    key={f}
                    role="tab"
                    aria-selected={filter === f}
                    aria-label={f === "ALL" ? "All" : TYPE_META[f].label}
                    onClick={() => setFilter(f)}
                    className="t-footnote relative min-h-[32px] flex-1 whitespace-nowrap rounded-[7px] px-3 py-[6px] font-medium sm:flex-none"
                  >
                    {filter === f && (
                      <motion.span
                        layoutId="seg"
                        className="absolute inset-0 rounded-[7px] bg-white shadow-[0_3px_8px_rgba(0,0,0,0.12),0_3px_1px_rgba(0,0,0,0.04)]"
                        transition={{ type: "spring", stiffness: 500, damping: 40 }}
                      />
                    )}
                    <span className="relative sm:hidden">{f === "ALL" ? "All" : TYPE_META[f].short}</span>
                    <span className="relative hidden sm:inline">{f === "ALL" ? "All" : TYPE_META[f].label}</span>
                  </button>
                ))}
              </div>
              <h2 className="group-header mt-6">{list.length} suggestions</h2>
              <ul className="group-list">
                <AnimatePresence initial={false}>
                  {list.map((a) => (
                    <ActionRow
                      key={a.id}
                      action={a}
                      decision={decided.get(a.id)}
                      selected={a.id === selectedId}
                      onOpen={() => setSelectedId(a.id)}
                      onToggle={() => toggle(a)}
                    />
                  ))}
                </AnimatePresence>
              </ul>
            </>
          )}

          {view === "log" && (
            <>
              {header("Decisions")}
              <p className="t-body mt-2 px-1 text-label-2">Every approval and dismissal, newest first.</p>
              {decisions && shown.length === 0 ? (
                <div className="group-list t-subhead mt-8 px-4 py-4 text-label-2">
                  No decisions yet. Approve or dismiss a priority on Today.
                </div>
              ) : (
                <ul className="group-list mt-8">
                  <AnimatePresence initial={false}>
                    {shown.map((d) => {
                      const a = all.get(d.action_id);
                      return (
                        <motion.li
                          key={d.action_id}
                          layout
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0, transition: { duration: 0.12 } }}
                          className="cell flex items-center gap-3 px-4"
                          style={{ background: d.action_id === selectedId ? "var(--selected)" : undefined }}
                        >
                          <button onClick={() => setSelectedId(d.action_id)} className="min-w-0 flex-1 py-[11px] text-left">
                            <div className="t-body line-clamp-2">{a?.product_name ?? "Earlier suggestion"}</div>
                            {a && (
                              <div className="t-footnote mt-[3px] flex items-center gap-1 font-medium" style={{ color: TYPE_META[a.type].text }}>
                                <TypeIcon type={a.type} size={13} />
                                {TYPE_META[a.type].label}
                              </div>
                            )}
                            <div className="t-subhead mt-[2px] text-label-2">
                              {d.decision === "approve"
                                ? "Approved"
                                : d.decision === "change"
                                  ? `Approved with change: ${d.value}`
                                  : `Dismissed · ${d.reason}`}
                              {" at "}
                              {new Date(d.decided_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                            </div>
                          </button>
                          <button onClick={() => void undo(d.action_id)} className="t-body min-h-[44px] shrink-0 px-1 text-tint">
                            Undo
                          </button>
                        </motion.li>
                      );
                    })}
                  </AnimatePresence>
                </ul>
              )}
            </>
          )}
        </div>
      </main>

      {/* Tab bar: one floating pill on every screen size, centred in the content area beside an open panel */}
      <nav
        aria-label="Sections"
        className={`pointer-events-none fixed inset-x-0 bottom-[var(--dock-bottom)] z-10 flex justify-center px-3 ${
          (selected || (productPanel && view === "products")) ? "lg:right-[400px]" : ""
        }`}
      >
        <ul className="dock pointer-events-auto flex h-[var(--dock-h)] w-full max-w-[400px] p-1 md:w-auto md:max-w-none">
          {TABS.map(({ id, label, Icon }) => (
            <li key={id} className="flex flex-1 md:w-[78px] md:flex-none">
              <button
                onClick={() => setView(id)}
                aria-current={tabActive(id) ? "page" : undefined}
                className={`dock-item relative flex flex-1 flex-col items-center justify-center gap-[2px] rounded-full text-[11px] font-medium leading-[13px] tracking-[0.01em] transition-colors ${
                  tabActive(id) ? "text-tint" : "text-[#6e6e73] hover:text-label"
                }`}
              >
                {tabActive(id) && (
                  <motion.span
                    layoutId="dock-pill"
                    aria-hidden
                    className="absolute inset-0 rounded-full bg-[var(--selected)]"
                    transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 38 }}
                  />
                )}
                <Icon size={24} className="relative" />
                <span className="relative">{label}</span>
                {id === "today" && open.length > 0 && (
                  <span
                    aria-label={`${open.length} to decide`}
                    className="num absolute left-1/2 top-[4px] ml-[6px] grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[var(--badge)] px-[5px] text-[12px] font-semibold leading-none text-white"
                  >
                    {open.length}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* Undo snackbar: above the tab bar, or above the sheet's buttons while the sheet is open */}
      <div
        className={`pointer-events-none fixed inset-x-0 z-[35] flex justify-center px-3 ${
          selected
            ? "bottom-[calc(max(env(safe-area-inset-bottom),14px)+78px)] lg:bottom-[calc(var(--nav-clear)+12px)] lg:pr-[400px]"
            : `bottom-[calc(var(--nav-clear)+12px)] ${productPanel && view === "products" ? "lg:pr-[400px]" : ""}`
        }`}
      >
        <AnimatePresence>
          {toast && (
            <motion.div
              key={toast.key}
              role={toast.error ? "alert" : "status"}
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, transition: { duration: 0.15 } }}
              transition={{ type: "spring", stiffness: 500, damping: 40 }}
              data-testid="toast"
              className="material pointer-events-auto flex min-h-[48px] w-full max-w-[420px] items-center gap-3 rounded-[14px] bg-[rgba(28,28,30,0.9)] pl-4 pr-1.5 text-white shadow-[0_10px_30px_rgba(0,0,0,0.22)]"
            >
              <span className="t-subhead min-w-0 flex-1 py-2.5">{toast.text}</span>
              {toast.undoId && (
                <button
                  onClick={() => {
                    void undo(toast.undoId!);
                    setToast(null);
                  }}
                  className="t-subhead min-h-[44px] shrink-0 rounded-[10px] px-3 font-semibold text-[#6cb4ff] active:bg-white/10"
                >
                  Undo
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>{notifOpen && <NotificationsSheet onClose={() => setNotifOpen(false)} />}</AnimatePresence>

      <AnimatePresence>{aiOpen && (
          <AiSheet
            hasKey={ai.hasKey}
            actions={actions ?? []}
            notices={baseBriefing?.notices ?? []}
            onClose={() => setAiOpen(false)}
          />
        )}</AnimatePresence>

      {/* Inspector (desktop) / sheet (mobile) */}
      <AnimatePresence>
        {selected && (
          <motion.div
            key="scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelectedId(null)}
            className="fixed inset-0 z-20 bg-black/30 lg:hidden"
          />
        )}
        {selected && (
          <motion.div
            key="sheet"
            initial={wide ? { opacity: 0, x: 24 } : { y: "100%" }}
            animate={wide ? { opacity: 1, x: 0 } : { y: 0 }}
            exit={wide ? { opacity: 0, x: 24 } : { y: "100%" }}
            transition={{ type: "spring", stiffness: 420, damping: 40 }}
            drag={wide ? false : "y"}
            dragListener={false}
            dragControls={sheetDrag}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 1 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 120 || info.velocity.y > 600) setSelectedId(null);
            }}
            className="fixed inset-x-0 bottom-[var(--kb,0px)] top-[calc(env(safe-area-inset-top)+10px)] z-30 shadow-[0_-8px_30px_rgba(0,0,0,0.12)] lg:static lg:inset-auto lg:z-auto lg:w-[400px] lg:shrink-0 lg:border-l lg:border-separator lg:shadow-none"
          >
            <DetailPanel
              key={selected.id}
              action={selected}
              decision={decided.get(selected.id)}
              onClose={() => setSelectedId(null)}
              onDecide={(kind, opts) => decideFromPanel(selected, kind, opts)}
              onUndo={() => void undo(selected.id)}
              onAddKey={() => setAiOpen(true)}
              onGrab={wide ? undefined : (e) => sheetDrag.start(e)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
