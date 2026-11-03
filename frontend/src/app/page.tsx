"use client";

import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { ActionRow } from "@/components/ActionRow";
import { AiSheet } from "@/components/AiSheet";
import { DetailPanel } from "@/components/DetailPanel";
import { NotificationsSheet } from "@/components/NotificationsSheet";
import { LiveConditions } from "@/components/LiveConditions";
import { NetworkMap } from "@/components/NetworkMap";
import { BellIcon, BoltIcon, ChevronIcon, ClockIcon, ListIcon, MapIcon, SparkleIcon, SunIcon, TypeIcon } from "@/components/icons";
import { Ring } from "@/components/Ring";
import type { Action, ActionType, Briefing, Decision, DecisionKind, Overview, Signal, Signals } from "@/lib/api";
import { savedKey, useAi } from "@/lib/ai";
import { applyOrder, type Replan, replanByRules, replanWithModel } from "@/lib/replan";
import { api, fetcher } from "@/lib/api";
import { longDate, money, TYPE_META } from "@/lib/format";

type View = "today" | "all" | "log" | "map";

const NAV: { id: View; label: string; Icon: typeof SunIcon }[] = [
  { id: "today", label: "Today", Icon: SunIcon },
  { id: "all", label: "All suggestions", Icon: ListIcon },
  { id: "log", label: "Decisions", Icon: ClockIcon },
  { id: "map", label: "Map", Icon: MapIcon },
];

const FILTERS: (ActionType | "ALL")[] = ["ALL", "ORDER", "DISCOUNT", "MOVE_TO_FRONT", "CHECK_DELIVERY"];

export default function Home() {
  const [view, setViewState] = useState<View>("today");
  const mainRef = useRef<HTMLElement>(null);
  const setView = (v: View) => {
    setViewState(v);
    mainRef.current?.scrollTo({ top: 0 });
  };
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("ALL");

  const { data: overview, error: overviewError } = useSWR<Overview>("/api/overview", fetcher);
  const { data: baseBriefing } = useSWR<Briefing>("/api/briefing", fetcher);
  const ai = useAi();
  const briefing = ai.briefing ?? baseBriefing;
  const [aiOpen, setAiOpen] = useState(false);
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
  const { data: actions } = useSWR<Action[]>("/api/actions", fetcher);
  // Outside conditions; if the route is missing or fails, the card simply stays hidden.
  const { data: signals } = useSWR<Signals>("/api/signals", fetcher, { refreshInterval: 60_000, shouldRetryOnError: false });
  const [replanState, setReplan] = useState<Replan | null>(null);
  const [replanBusy, setReplanBusy] = useState(false);
  const [replanError, setReplanError] = useState<string | null>(null);
  const { data: decisions, mutate: mutateDecisions } = useSWR<Decision[]>("/api/decisions", fetcher);

  const decided = useMemo(() => new Map((decisions ?? []).map((d) => [d.action_id, d])), [decisions]);
  const all = useMemo(() => {
    const byId = new Map<string, Action>();
    for (const a of [...(briefing?.priorities ?? []), ...(actions ?? [])]) if (!byId.has(a.id)) byId.set(a.id, a);
    return byId;
  }, [briefing, actions]);
  const selected = selectedId ? all.get(selectedId) : undefined;

  const decide = useCallback(
    async (id: string, kind: DecisionKind, opts?: { reason?: string; value?: number }) => {
      const d = await api.decide(id, kind, opts);
      await mutateDecisions((cur) => [d, ...(cur ?? []).filter((x) => x.action_id !== id)], { revalidate: false });
    },
    [mutateDecisions],
  );
  const undo = useCallback(
    async (id: string) => {
      await api.undo(id);
      await mutateDecisions((cur) => (cur ?? []).filter((x) => x.action_id !== id), { revalidate: false });
    },
    [mutateDecisions],
  );
  const runReplan = async (s: Signal) => {
    const base = briefing?.priorities ?? [];
    setReplanError(null);
    if (!ai.hasKey) return setReplan(replanByRules(s, base, ai.lang));
    setReplanBusy(true);
    try {
      setReplan(await replanWithModel(savedKey(), s, base, ai.lang));
    } catch (err) {
      setReplanError(err instanceof Error ? err.message : "The re-plan could not be written.");
    } finally {
      setReplanBusy(false);
    }
  };
  const toggle = (a: Action) => (decided.has(a.id) ? undo(a.id) : decide(a.id, "approve"));

  if (overviewError && view !== "map") {
    return (
      <main className="grid h-full place-items-center p-8 text-center">
        <div>
          <h1 className="text-[22px] font-semibold">The store data service isn&apos;t running</h1>
          <p className="mt-2 text-label-2">Start it with <code className="rounded bg-fill px-1.5 py-0.5">uv run uvicorn avrora.api.main:app</code> in the backend folder, then reload.</p>
        </div>
      </main>
    );
  }

  // a re-plan only holds while its signal is still current
  const replan = replanState && signals?.signals.some((s) => s.id === replanState.signalId) ? replanState : null;
  const basePriorities = briefing?.priorities ?? [];
  const priorities = replan ? applyOrder(basePriorities, replan.order) : basePriorities;
  const movedUp = (a: Action) => replan !== null && priorities.indexOf(a) < basePriorities.indexOf(a);
  const open = priorities.filter((a) => !decided.has(a.id));
  const handled = priorities.filter((a) => decided.has(a.id));
  const list = (actions ?? []).filter((a) => filter === "ALL" || a.type === filter);

  const header = (title: string, subtitle?: string, trailing?: React.ReactNode) => (
    <header className="flex items-end justify-between gap-4 px-1">
      <div>
        {subtitle && <p className="t-subhead text-label-2">{subtitle}</p>}
        <h1 className="t-large-title">{title}</h1>
      </div>
      {trailing}
    </header>
  );

  return (
    <div className="flex h-full overflow-hidden">
      {/* macOS sidebar */}
      <nav
        aria-label="Sections"
        className="hidden w-[240px] shrink-0 flex-col border-r border-separator bg-[var(--sidebar)] px-2.5 pb-4 pt-5 backdrop-blur-2xl md:flex"
      >
        <div className="flex items-center gap-2.5 px-2 pb-6">
          {/* eslint-disable-next-line @next/next/no-img-element -- static export, SVG mark */}
          <img src="/avrora-mark.svg" alt="Avrora" width={32} height={32} className="size-8 shrink-0" />
          <div className="min-w-0">
            <div className="t-footnote truncate font-semibold">{overview?.store_name.split(", ")[0] ?? " "}</div>
            <div className="t-caption truncate text-label-2">
              {overview ? `${overview.store_name.split(", ")[1] ?? ""} · ${overview.products} products` : " "}
            </div>
          </div>
        </div>
        <ul className="space-y-px">
          {NAV.map(({ id, label, Icon }) => (
            <li key={id}>
              <button
                onClick={() => setView(id)}
                aria-current={view === id ? "page" : undefined}
                className={`t-subhead flex w-full items-center gap-2.5 rounded-[6px] px-2 py-[5px] ${
                  view === id ? "bg-fill-2 font-medium" : "hover:bg-fill"
                }`}
              >
                <Icon size={17} className="text-tint" />
                {label}
                {id === "today" && open.length > 0 && (
                  <span className="t-footnote num ml-auto text-label-2" aria-label={`${open.length} to decide`}>{open.length}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
        <button
          onClick={() => setNotifOpen(true)}
          className="t-subhead mt-auto flex w-full items-center gap-2.5 rounded-[6px] px-2 py-[5px] hover:bg-fill"
        >
          <BellIcon size={17} className="text-tint" />
          Notifications
        </button>
        <p className="t-caption mt-3 px-2 text-label-2">Store data is fictional. Map data: OpenStreetMap.</p>
      </nav>

      <main ref={mainRef} className={`relative min-w-0 flex-1 ${view === "map" ? "overflow-hidden pb-[calc(56px+env(safe-area-inset-bottom))] md:pb-0" : "overflow-y-auto pb-24 md:pb-0"}`}>
        {view === "map" && <NetworkMap />}
        <div className={view === "map" ? "hidden" : "mx-auto max-w-[720px] px-4 pb-16 pt-6 md:px-8 md:pt-10"}>
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
                  {briefing.source === "model" ? "Written by the OTH model, numbers checked." : "Ranked by rules."}
                  <button onClick={() => setAiOpen(true)} className="font-medium text-tint">
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
                        Every priority has a decision. See All suggestions to look further ahead.
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
                      <div key={k} className="cell flex items-center justify-between px-4 py-[11px]">
                        <dt className="t-body">{k}</dt>
                        <dd className="t-body num text-label-2">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )}

              {/* phones have no sidebar: settings live at the end of Today, as in iOS */}
              <section className="mt-8 md:hidden">
                <h2 className="group-header">Settings</h2>
                <div className="group-list">
                  <button onClick={() => setNotifOpen(true)} className="cell flex w-full items-center gap-3 px-4 py-[9px] text-left">
                    <span className="icon-tile size-[30px]" style={{ background: "var(--order)" }}>
                      <BellIcon size={17} />
                    </span>
                    <span className="t-body flex-1">Notifications</span>
                    <ChevronIcon className="text-label-3" />
                  </button>
                </div>
              </section>
            </>
          )}

          {view === "all" && (
            <>
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
                    className="t-footnote relative flex-1 whitespace-nowrap rounded-[7px] px-3 py-[5px] font-medium sm:flex-none"
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
              {decisions && decisions.length === 0 ? (
                <div className="group-list t-subhead mt-8 px-4 py-4 text-label-2">
                  No decisions yet. Approve or dismiss a priority on Today.
                </div>
              ) : (
                <ul className="group-list mt-8">
                  {(decisions ?? []).map((d) => {
                    const a = all.get(d.action_id);
                    return (
                      <li key={d.action_id} className="cell flex items-center gap-3 px-4 py-[11px]">
                        <button onClick={() => setSelectedId(d.action_id)} className="min-w-0 flex-1 text-left">
                          <div className="t-body truncate">{a?.product_name ?? d.action_id}</div>
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
                        <button onClick={() => undo(d.action_id)} className="t-body shrink-0 text-tint">
                          Undo
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </div>
      </main>

      {/* iOS tab bar */}
      <nav
        aria-label="Sections"
        className="fixed inset-x-0 bottom-0 z-10 flex border-t border-separator bg-[rgba(249,249,249,0.94)] pb-[max(env(safe-area-inset-bottom),8px)] pt-1.5 backdrop-blur-xl md:hidden"
      >
        {NAV.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setView(id)}
            aria-current={view === id ? "page" : undefined}
            className={`flex flex-1 flex-col items-center gap-0.5 text-[10px] font-medium ${view === id ? "text-tint" : "text-[#6e6e73]"}`}
          >
            <Icon size={24} />
            {label}
          </button>
        ))}
      </nav>

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
          <>
            <motion.div
              key="scrim"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedId(null)}
              className="fixed inset-0 z-20 bg-black/30 lg:hidden"
            />
            <div className="fixed inset-x-0 bottom-0 top-10 z-30 lg:static lg:inset-auto lg:z-auto lg:w-[400px] lg:shrink-0 lg:border-l lg:border-separator">
              <DetailPanel
                key={selected.id}
                action={selected}
                decision={decided.get(selected.id)}
                onClose={() => setSelectedId(null)}
                onDecide={(kind, opts) => decide(selected.id, kind, opts)}
                onUndo={() => undo(selected.id)}
                onAddKey={() => setAiOpen(true)}
              />
            </div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
