"use client";

import { AnimatePresence, LayoutGroup, MotionConfig, motion, useDragControls } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import useSWR from "swr";
import { ActionRow, TypeGlyph } from "@/components/ActionRow";
import { ScreenHeader } from "@/components/ScreenHeader";
import { AiSheet } from "@/components/AiSheet";
import { DetailPanel, ignoreShortcut } from "@/components/DetailPanel";
import { ProductsView } from "@/components/ProductsView";
import { NotificationsSheet } from "@/components/NotificationsSheet";
import { LiveConditions } from "@/components/LiveConditions";
import { NetworkMap } from "@/components/NetworkMap";
import { TeamTodayCard, TeamView } from "@/components/TeamView";
import { BackIcon, BellIcon, BoltIcon, CheckIcon, ChevronIcon, ClockIcon, CloseIcon, GridIcon, ListIcon, MapIcon, MoreIcon, SparkleIcon, SunIcon, UsersIcon } from "@/components/icons";
import { TagProgress } from "@/components/Ring";
import type { Action, ActionType, Briefing, Decision, DecisionKind, Overview, Signal, Signals } from "@/lib/api";
import { aiRoute, useAi } from "@/lib/ai";
import { applyOrder, type Replan, replanByRules, replanWithModel } from "@/lib/replan";
import { api, fetcher } from "@/lib/api";
import { SCRIM_FADE, SETTLE_MS, SHEET_SPRING, TOAST_SPRING } from "@/lib/motion";
import { ModelError } from "@/lib/model";
import { longDate, money, TYPE_META } from "@/lib/format";

type View = "today" | "team" | "products" | "all" | "log" | "map" | "more";

const TITLES: Record<View, string> = {
  today: "Today",
  team: "Team",
  products: "Products",
  all: "All suggestions",
  log: "Decisions",
  map: "Map",
  more: "More",
};

/** Tab bar: the four daily sections plus More (All suggestions, Decisions and settings). */
const TABS: { id: View; label: string; Icon: typeof SunIcon }[] = [
  { id: "today", label: "Today", Icon: SunIcon },
  { id: "team", label: "Team", Icon: UsersIcon },
  { id: "products", label: "Products", Icon: GridIcon },
  { id: "map", label: "Map", Icon: MapIcon },
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
  // the tab cross-fade runs on a switch only, never on first load
  const [switched, setSwitched] = useState(false);
  const setView = (v: View) => {
    // tapping the current tab again scrolls back to the top, as on iOS
    if (v === view) mainRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    else {
      mainRef.current?.scrollTo({ top: 0 });
      setSwitched(true);
    }
    setViewState(v);
  };
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [teamDate, setTeamDate] = useState<string | undefined>();
  const [teamKey, setTeamKey] = useState(0);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("ALL");
  const wide = useMedia("(min-width: 1024px)");

  const { data: overview, error: overviewError, mutate: retryOverview, isValidating: retrying } = useSWR<Overview>("/api/overview", fetcher);
  const { data: baseBriefing } = useSWR<Briefing>("/api/briefing", fetcher);
  const ai = useAi();
  const { data: actions } = useSWR<Action[]>("/api/actions", fetcher);
  // a saved AI briefing only counts when all its priorities are still among today's actions
  const aiBriefing = useMemo(() => {
    if (!ai.briefing || !actions) return null;
    const ids = new Set(actions.map((a) => a.id));
    const priorities = ai.briefing.priorities.filter((a) => ids.has(a.id));
    return priorities.length ? { ...ai.briefing, priorities } : null;
  }, [ai.briefing, actions]);
  const briefing = aiBriefing ?? baseBriefing;
  const [aiOpen, setAiOpen] = useState(false);
  // the Products view reports its fixed panel so the content column and the tab bar make room for it
  const [productPanel, setProductPanel] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);

  // Notification taps open the app at /?action=<id>, or message an already open window.
  // The service worker is registered when notifications are turned on and stays registered.
  useEffect(() => {
    const openUrl = (href: string) => {
      const params = new URL(href, location.href).searchParams;
      // staffing pushes link to /?view=team&date=YYYY-MM-DD
      if (params.get("view") === "team") {
        const d = params.get("date");
        setTeamDate(d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined);
        setTeamKey((k) => k + 1);
        setViewState("team");
        return;
      }
      const id = params.get("action");
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
      const bar = 44 + (parseFloat(getComputedStyle(main).paddingTop) || 0);
      setCompact(h1 ? h1.getBoundingClientRect().bottom - top < bar + 4 : main.scrollTop > 40);
    };
    onScroll();
    main.addEventListener("scroll", onScroll, { passive: true });
    return () => main.removeEventListener("scroll", onScroll);
  }, [view]);

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
  const replanSeq = useRef(0);
  const runReplan = async (s: Signal) => {
    const base = briefing?.priorities ?? [];
    const id = ++replanSeq.current;
    setReplanError(null);
    if (!ai.hasKey) return setReplan(replanByRules(s, base, ai.lang));
    setReplanBusy(true);
    try {
      const r = await replanWithModel(aiRoute(), s, base, ai.lang);
      if (id === replanSeq.current) setReplan(r);
    } catch (err) {
      if (id === replanSeq.current) setReplanError(err instanceof ModelError ? err.message : "The new order could not be worked out. Try again.");
    } finally {
      if (id === replanSeq.current) setReplanBusy(false);
    }
  };
  // An approved row stays in place for a moment with its check filled, then moves to Handled.
  const [settling, setSettling] = useState<ReadonlySet<string>>(new Set());
  const toggle = (a: Action) => {
    if (decided.has(a.id) && !settling.has(a.id)) return void undo(a.id);
    if (settling.has(a.id)) return;
    void decide(a.id, "approve");
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setSettling((s) => new Set(s).add(a.id));
      setTimeout(() => setSettling((s) => {
        const n = new Set(s);
        n.delete(a.id);
        return n;
      }), SETTLE_MS);
    }
    showToast({ text: `Approved ${a.product_name}`, undoId: a.id });
  };

  // a re-plan only holds while its signal is still current
  const replan = replanState && signals?.signals.some((s) => s.id === replanState.signalId) ? replanState : null;
  const basePriorities = briefing?.priorities ?? [];
  const priorities = replan ? applyOrder(basePriorities, replan.order) : basePriorities;
  const movedUp = (a: Action) => replan !== null && priorities.indexOf(a) < basePriorities.indexOf(a);
  const open = priorities.filter((a) => !decided.has(a.id) || settling.has(a.id));
  const handled = priorities.filter((a) => decided.has(a.id) && !settling.has(a.id));
  const toDecide = open.filter((a) => !decided.has(a.id)).length;
  const logGroups = useMemo(() => {
    const day = (iso: string) => {
      const d = new Date(iso);
      const t = new Date();
      const y = new Date(t);
      y.setDate(t.getDate() - 1);
      if (d.toDateString() === t.toDateString()) return "Today";
      if (d.toDateString() === y.toDateString()) return "Yesterday";
      return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
    };
    const out = new Map<string, Decision[]>();
    for (const d of shown) out.set(day(d.decided_at), [...(out.get(day(d.decided_at)) ?? []), d]);
    return [...out];
  }, [shown]);
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
          <p className="mt-2 text-muted">Check your connection and try again.</p>
          <button
            onClick={() => retryOverview()}
            disabled={retrying}
            className="btn-ink mt-5 disabled:opacity-50"
          >
            {retrying ? "Trying…" : "Retry"}
          </button>
        </div>
      </main>
    );
  }


  const undoClick = (e: React.MouseEvent<HTMLButtonElement>) => void undo(e.currentTarget.dataset.id!);
  const tabActive = (id: View) => view === id || (id === "more" && (view === "all" || view === "log"));

  const health = overview
    ? ([
        ["Items running out", `${overview.stockout_risks}`, "ORDER", overview.stockout_risks > 0],
        ["Late deliveries", `${overview.late_deliveries}`, "CHECK_DELIVERY", false],
        ["Items hard to find", `${overview.visibility_issues}`, "MOVE_TO_FRONT", false],
        ["Value in slow stock", money(overview.slow_stock_value_uah), "DISCOUNT", false],
      ] as const)
    : [];

  return (
    <MotionConfig reducedMotion="user">
    <div className="flex h-full overflow-hidden">
      <main
        ref={mainRef}
        className={`relative min-w-0 flex-1 ${
          view === "map"
            ? "overflow-hidden pt-[env(safe-area-inset-top)] md:pt-0"
            : "pb-tabbar overflow-y-auto overscroll-contain"
        } ${productPanel && view === "products" ? "lg:mr-[400px]" : ""}`}
      >
        {/* Phones: compact bar, shown only once the large title has fully scrolled under it */}
        {view !== "map" && (
          <div className="pointer-events-none sticky top-0 z-10 h-0 md:hidden">
            <div
              className={`absolute inset-x-0 top-0 border-b pt-[env(safe-area-inset-top)] transition-[background-color,border-color] duration-150 ${
                compact ? "border-rule bg-floor" : "border-transparent bg-transparent"
              }`}
            >
              <div
                aria-hidden={!compact}
                className={`t-headline grid h-11 place-items-center px-16 transition-opacity duration-150 ${compact ? "opacity-100" : "opacity-0"}`}
              >
                <span className="truncate">{TITLES[view]}</span>
              </div>
            </div>
          </div>
        )}
        {view === "map" && <NetworkMap />}
        <div key={view} className={view === "map" ? "hidden" : `${switched ? "view-enter " : ""}mx-auto ${view === "today" ? "max-w-[1120px]" : view === "team" ? "max-w-[960px]" : "max-w-[720px]"} px-4 pb-16 pt-[calc(env(safe-area-inset-top)+16px)] md:px-6 md:pt-10`}>
          {view === "today" && (
            <>
              <ScreenHeader title="Today" date={overview ? longDate(overview.today) : " "} />

              {/* Phones: one column in reading order. Wide: tag and decisions left, the store right. */}
              <div className="@container mt-5">
                <div className="flex flex-col @[52rem]:grid @[52rem]:grid-cols-[minmax(0,1fr)_minmax(320px,380px)] @[52rem]:items-start @[52rem]:gap-x-8">
                  <div className="contents @[52rem]:block @[52rem]:min-w-0">
                    {/* Summary header: what matters now */}
                    <section aria-label="Today's summary" className="price-tag order-1 @[52rem]:order-none">
                      <p className="t-footnote font-medium text-muted">
                        {overview ? `${overview.store_name.split(", ")[0]} · today's priorities` : "Today's priorities"}
                      </p>
                      <div className="mt-2 flex flex-wrap items-baseline gap-x-2">
                        <span className="tag-figure">{briefing ? toDecide : " "}</span>
                        <span className="text-[17px] font-medium leading-[22px] text-muted">
                          {briefing ? (toDecide === 0 ? "left to decide" : "to decide") : "Loading…"}
                        </span>
                      </div>
                      <p className="t-subhead num mt-1 text-muted" lang={briefing?.lang} data-testid="summary">
                        {briefing?.summary ?? "Preparing today's priorities…"}
                      </p>
                      {priorities.length > 0 && (
                        <div className="mt-4">
                          <TagProgress done={priorities.length - toDecide} total={priorities.length} />
                        </div>
                      )}
                      {briefing && (
                        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-[var(--divider)] pt-3">
                          <p className="t-footnote min-w-0 text-muted">
                            {briefing.source === "model" ? "Written by AI. Numbers checked against store data." : "Fixed rules, not AI."}
                          </p>
                          <button onClick={() => setAiOpen(true)} className="btn-tag hit shrink-0">
                            <SparkleIcon size={14} />
                            {briefing.source === "model" ? "AI settings" : "Write with AI"}
                          </button>
                        </div>
                      )}
                    </section>

                    <div className="order-3 mt-6 @[52rem]:order-none">
                      <LayoutGroup>
                        <section>
                          <div className="section-head">
                            <h2>{open.length || !briefing ? "To decide" : "All done"}</h2>
                            {briefing && open.length > 0 && <span className="t-footnote text-muted">Highest value first</span>}
                          </div>
                          <motion.ul layout className="flat-list">
                            <AnimatePresence initial={false}>
                              {open.map((a) => (
                                <ActionRow
                                  key={a.id}
                                  action={a}
                                  decision={decided.get(a.id)}
                                  selected={a.id === selectedId}
                                  onOpen={() => setSelectedId(a.id)}
                                  onToggle={() => toggle(a)}
                                  movedUp={movedUp(a)}
                                />
                              ))}
                            </AnimatePresence>
                            {!briefing && <li className="h-[320px] animate-pulse bg-fill" />}
                            {briefing && open.length === 0 && (
                              <li className="flex items-center gap-3 px-4 py-4">
                                <span className="grid size-[24px] shrink-0 place-items-center rounded-full bg-green text-white">
                                  <CheckIcon size={15} />
                                </span>
                                <span className="t-subhead text-muted">Every priority has a decision. More ahead in All suggestions.</span>
                              </li>
                            )}
                          </motion.ul>
                          <p className="group-footer px-1 text-muted">Tap the circle to approve. Open a row to see why, adjust or dismiss.</p>
                        </section>

                        {handled.length > 0 && (
                          <motion.section layout className="mt-6">
                            <div className="section-head">
                              <h2>Handled</h2>
                              <span className="t-footnote num text-muted">{handled.length}</span>
                            </div>
                            <motion.ul layout className="flat-list">
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
                    </div>
                  </div>

                  <div className="contents @[52rem]:block @[52rem]:min-w-0">
                    {overview && (
                      <div className="order-2 mt-3 @[52rem]:order-none @[52rem]:mt-0 [&>section]:mt-0">
                        <TeamTodayCard today={overview.today} onOpen={() => setView("team")} />
                      </div>
                    )}

                    {signals && (
                      <div className="order-4 mt-6 @[52rem]:order-none">
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
                      </div>
                    )}

                    {briefing && briefing.notices.length > 0 && (
                      <ul className="flat-list order-5 mt-6 @[52rem]:order-none">
                        {briefing.notices.map((n) => (
                          <li key={n.id} className="cell flex items-start gap-3 px-4 py-3.5 [--inset:48px]">
                            <BoltIcon size={20} className="mt-[1px] shrink-0 text-muted" />
                            <div className="min-w-0">
                              <span className="badge badge-neutral">Store note</span>
                              <p className="t-subhead mt-1.5 text-ink">{n.reason}</p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}

                    {overview && (
                      <section className="order-6 mt-6 @[52rem]:order-none" aria-labelledby="health-title">
                        <div className="section-head">
                          <h2 id="health-title">Store health</h2>
                        </div>
                        <dl className="flat-list">
                          {health.map(([k, v, t, urgent]) => (
                            <div key={k} className="cell flex min-h-[48px] items-center gap-3 px-4 py-2.5 [--inset:36px]">
                              <TypeGlyph type={t} />
                              <dt className="t-subhead flex-1 text-ink">{k}</dt>
                              <dd className={`num whitespace-nowrap text-[15px] font-semibold ${urgent ? "text-red" : ""}`}>{v}</dd>
                            </div>
                          ))}
                        </dl>
                      </section>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}

          {view === "team" && (overview ? <TeamView key={teamKey} today={overview.today} initialDate={teamDate} /> : <div className="h-[480px] animate-pulse rounded-[12px] bg-fill" />)}

          {view === "products" && <ProductsView onOpenAction={(id) => setSelectedId(id)} onPanel={setProductPanel} />}

          {view === "more" && (
            <>
              <ScreenHeader title="More" />
              <section aria-label="Your store" className="mt-6 flex items-center gap-3.5 px-1">
                {/* eslint-disable-next-line @next/next/no-img-element -- static export, SVG mark */}
                <img src="/avrora-mark.svg" alt="Avrora" width={48} height={48} className="size-12 shrink-0" />
                <div className="min-w-0">
                  <div className="t-title3 truncate">{overview?.store_name.split(", ")[0] ?? " "}</div>
                  <div className="t-subhead truncate text-muted">{overview ? (overview.store_name.split(", ")[1] ?? "") : " "}</div>
                </div>
              </section>
              {overview && (
                <dl className="card mt-4 grid grid-cols-3 divide-x divide-[var(--divider)] py-3">
                  {[
                    ["Products", `${overview.products}`],
                    ["Suggestions", actions ? `${actions.length}` : "–"],
                    ["Decided", `${shown.length}`],
                  ].map(([k, v]) => (
                    <div key={k} className="flex min-w-0 flex-col px-4">
                      <dt className="t-footnote order-last text-muted">{k}</dt>
                      <dd className="num text-[20px] font-semibold leading-[26px] tracking-[-0.02em]">{v}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <section className="mt-6">
                <div className="flat-list">
                  <SettingsRow label="All suggestions" Icon={ListIcon} onClick={() => setView("all")} detail={actions ? `${actions.length}` : undefined} />
                  <SettingsRow label="Decisions" Icon={ClockIcon} onClick={() => setView("log")} detail={`${shown.length}`} />
                </div>
                <p className="group-footer text-muted">Everything the store data points to, beyond today&apos;s five.</p>
              </section>
              <section className="mt-6">
                <div className="section-head">
                  <h2>Settings</h2>
                </div>
                <div className="flat-list">
                  <SettingsRow label="AI settings" Icon={SparkleIcon} onClick={() => setAiOpen(true)} />
                  <SettingsRow label="Notifications" Icon={BellIcon} onClick={() => setNotifOpen(true)} />
                </div>
                <p className="group-footer hidden text-muted [@media(hover:hover)_and_(pointer:fine)]:block" data-testid="shortcuts">
                  Keyboard: J and K move through the list, A approves, D dismisses, Esc closes.
                </p>
              </section>
              <p className="t-footnote mt-8 px-4 text-center text-muted">
                Store data is made up for this demo. Map: avrora.ua, © OpenStreetMap contributors.
              </p>
            </>
          )}

          {view === "all" && (
            <>
              <ScreenHeader title="All suggestions" back={<BackToMore onClick={() => setView("more")} />} />
              <p className="t-subhead mt-1 px-1 text-muted">Everything the store data points to, highest value first.</p>
              <div role="tablist" aria-label="Filter by type" className="scroll-row -mx-4 mt-5 pb-1 pl-4 [scroll-padding-left:16px] md:mx-0 md:pl-0">
                {FILTERS.map((f) => (
                  <button
                    key={f}
                    role="tab"
                    aria-selected={filter === f}
                    aria-label={f === "ALL" ? "All" : TYPE_META[f].label}
                    onClick={() => setFilter(f)}
                    className="chip t-subhead"
                  >
                    {f !== "ALL" && (
                      <span
                        aria-hidden
                        className="type-glyph"
                        data-outline={f === "CHECK_DELIVERY" ? "" : undefined}
                        style={{ background: f === "ORDER" ? "var(--red)" : filter === f ? "#d4d4d8" : "#a1a1aa" }}
                      />
                    )}
                    <span className="sm:hidden">{f === "ALL" ? "All" : TYPE_META[f].short}</span>
                    <span className="hidden sm:inline">{f === "ALL" ? "All" : TYPE_META[f].label}</span>
                  </button>
                ))}
              </div>
              <div className="section-head mt-6">
                <h2>{list.length} suggestions</h2>
                <span className="t-footnote num text-muted">{money(list.reduce((sum, a) => sum + a.risk_uah, 0))} in total</span>
              </div>
              <ul className="flat-list">
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
              <ScreenHeader title="Decisions" back={<BackToMore onClick={() => setView("more")} />} />
              <p className="t-subhead mt-1 px-1 text-muted">Every approval and dismissal, newest first.</p>
              {shown.length > 0 && (
                <p className="card t-subhead num mt-4 flex gap-5 px-4 py-3">
                  <span className="inline-flex items-center gap-2">
                    <CheckIcon size={15} className="text-green" />
                    <span><b className="font-semibold">{shown.filter((d) => d.decision !== "reject").length}</b> approved</span>
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <CloseIcon size={13} className="text-muted" />
                    <span><b className="font-semibold">{shown.filter((d) => d.decision === "reject").length}</b> dismissed</span>
                  </span>
                </p>
              )}
              {decisions && shown.length === 0 ? (
                <div className="card mt-6 px-4 py-8 text-center">
                  <ClockIcon size={24} className="mx-auto text-muted" />
                  <p className="t-headline mt-3">No decisions yet.</p>
                  <p className="t-subhead mt-1 text-muted">Approve or dismiss a priority on Today.</p>
                </div>
              ) : (
                logGroups.map(([day, items]) => (
                  <section key={day} className="mt-6" aria-label={day}>
                    <div className="section-head">
                      <h2>{day}</h2>
                      <span className="t-footnote num text-muted">{items.length}</span>
                    </div>
                    <ul className="flat-list">
                      <AnimatePresence initial={false}>
                        {items.map((d) => {
                          const a = all.get(d.action_id);
                          const rejected = d.decision === "reject";
                          return (
                            <motion.li
                              key={d.action_id}
                              layout
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0, transition: { duration: 0.12 } }}
                              className="cell flex items-start gap-3 pl-4 pr-2 [--inset:68px]"
                              style={{ background: d.action_id === selectedId ? "var(--selected)" : undefined }}
                            >
                              <span className="t-footnote num w-[40px] shrink-0 pt-[15px] font-semibold text-muted">
                                {new Date(d.decided_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                              </span>
                              <button onClick={() => setSelectedId(d.action_id)} className="min-w-0 flex-1 py-3 text-left active:opacity-70">
                                <span className="t-headline line-clamp-2 block">{a?.product_name ?? "Earlier suggestion"}</span>
                                <span className={`t-subhead mt-[2px] flex items-center gap-1.5 font-medium ${rejected ? "text-muted" : "text-green"}`}>
                                  {rejected ? <CloseIcon size={11} /> : <CheckIcon size={13} />}
                                  {d.decision === "approve"
                                    ? "Approved"
                                    : d.decision === "change"
                                      ? `Approved with change: ${d.value}`
                                      : `Dismissed · ${d.reason}`}
                                </span>
                                {a && (
                                  <span className="t-footnote mt-1 flex items-center gap-1.5 text-muted">
                                    <TypeGlyph type={a.type} />
                                    {TYPE_META[a.type].label}
                                  </span>
                                )}
                              </button>
                              <button
                                data-id={d.action_id}
                                onClick={undoClick}
                                className="btn-text t-subhead mt-1 shrink-0 px-3"
                              >
                                Undo
                              </button>
                            </motion.li>
                          );
                        })}
                      </AnimatePresence>
                    </ul>
                  </section>
                ))
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
        <ul className="dock pointer-events-auto flex h-[var(--dock-h)] w-full max-w-[400px] px-1 md:w-auto md:max-w-none">
          {TABS.map(({ id, label, Icon }) => (
            <li key={id} className="flex flex-1 md:w-[78px] md:flex-none">
              <button
                onClick={() => setView(id)}
                aria-current={tabActive(id) ? "page" : undefined}
                className={`dock-item flex flex-1 flex-col items-center justify-center gap-[3px] text-[11px] leading-[13px] transition-colors ${
                  tabActive(id) ? "font-semibold" : "font-medium hover:text-ink"
                }`}
              >
                <Icon size={22} className="relative" />
                <span className="relative">{label}</span>
                {id === "today" && toDecide > 0 && (
                  <span
                    aria-label={`${toDecide} to decide`}
                    className="num absolute left-1/2 top-[6px] ml-[5px] grid h-[18px] min-w-[18px] place-items-center rounded-full border-2 border-white bg-ink px-[4px] text-[11px] font-semibold leading-none text-white"
                  >
                    {toDecide}
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
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16, transition: { duration: 0.18, ease: [0.4, 0, 1, 1] } }}
              transition={TOAST_SPRING}
              data-testid="toast"
              className="material pointer-events-auto flex min-h-[48px] w-full max-w-[420px] items-center gap-3 rounded-[12px] bg-ink pl-4 pr-1.5 text-white shadow-[0_8px_24px_rgba(16,24,40,0.16)]"
            >
              <span className="t-subhead min-w-0 flex-1 py-2.5">{toast.text}</span>
              {toast.undoId && (
                <button
                  onClick={() => {
                    void undo(toast.undoId!);
                    setToast(null);
                  }}
                  className="t-subhead min-h-[44px] shrink-0 rounded-[10px] px-3 font-semibold text-white underline underline-offset-4 active:bg-white/10"
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
            transition={SCRIM_FADE}
            onClick={() => setSelectedId(null)}
            className="fixed inset-0 z-20 bg-[var(--scrim)] lg:hidden"
          />
        )}
        {selected && (
          <motion.div
            key="sheet"
            initial={wide ? { opacity: 0, x: 24 } : { y: "100%" }}
            animate={wide ? { opacity: 1, x: 0 } : { y: 0 }}
            exit={wide ? { opacity: 0, x: 24 } : { y: "100%" }}
            transition={SHEET_SPRING}
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
    </MotionConfig>
  );
}

function BackToMore({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="btn-text -ml-1.5 mb-1 text-[17px] font-medium">
      <BackIcon size={20} />
      More
    </button>
  );
}

function SettingsRow({ label, Icon, onClick, detail }: { label: string; Icon: typeof SunIcon; onClick: () => void; detail?: string }) {
  return (
    <button onClick={onClick} className="cell flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left [--inset:48px] transition-colors hover:bg-[#fafafa] active:bg-fill">
      <Icon size={20} className="shrink-0 text-muted" />
      <span className="t-callout flex-1">{label}</span>
      {detail && <span className="t-subhead num text-muted" aria-hidden>{detail}</span>}
      <ChevronIcon className="text-[var(--label-3)]" />
    </button>
  );
}
