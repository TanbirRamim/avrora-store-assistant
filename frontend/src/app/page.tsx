"use client";

import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";
import { ActionRow } from "@/components/ActionRow";
import { DetailPanel } from "@/components/DetailPanel";
import { BoltIcon, ClockIcon, ListIcon, SunIcon, TypeIcon } from "@/components/icons";
import { Ring } from "@/components/Ring";
import type { Action, ActionType, Briefing, Decision, DecisionKind, Overview } from "@/lib/api";
import { api, fetcher } from "@/lib/api";
import { longDate, money, TYPE_META } from "@/lib/format";

type View = "today" | "all" | "log";

const NAV: { id: View; label: string; Icon: typeof SunIcon }[] = [
  { id: "today", label: "Today", Icon: SunIcon },
  { id: "all", label: "All suggestions", Icon: ListIcon },
  { id: "log", label: "Decisions", Icon: ClockIcon },
];

const FILTERS: (ActionType | "ALL")[] = ["ALL", "ORDER", "DISCOUNT", "MOVE_TO_FRONT", "CHECK_DELIVERY"];

export default function Home() {
  const [view, setView] = useState<View>("today");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("ALL");

  const { data: overview, error: overviewError } = useSWR<Overview>("/api/overview", fetcher);
  const { data: briefing } = useSWR<Briefing>("/api/briefing", fetcher);
  const { data: actions } = useSWR<Action[]>("/api/actions", fetcher);
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
  const toggle = (a: Action) => (decided.has(a.id) ? undo(a.id) : decide(a.id, "approve"));

  if (overviewError) {
    return (
      <main className="grid h-full place-items-center p-8 text-center">
        <div>
          <h1 className="text-[22px] font-semibold">The store data service isn&apos;t running</h1>
          <p className="mt-2 text-label-2">Start it with <code className="rounded bg-fill px-1.5 py-0.5">uv run uvicorn avrora.api.main:app</code> in the backend folder, then reload.</p>
        </div>
      </main>
    );
  }

  const priorities = briefing?.priorities ?? [];
  const open = priorities.filter((a) => !decided.has(a.id));
  const handled = priorities.filter((a) => decided.has(a.id));
  const list = (actions ?? []).filter((a) => filter === "ALL" || a.type === filter);

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <nav
        aria-label="Sections"
        className="hidden w-[232px] shrink-0 flex-col border-r border-separator bg-[var(--sidebar)] px-3 pb-4 pt-6 backdrop-blur-xl md:flex"
      >
        <div className="px-2 pb-5">
          <div className="text-[13px] font-semibold">{overview?.store_name ?? " "}</div>
          <div className="text-[12px] text-label-2">{overview ? `${overview.products} products` : " "}</div>
        </div>
        <ul className="space-y-0.5">
          {NAV.map(({ id, label, Icon }) => (
            <li key={id}>
              <button
                onClick={() => setView(id)}
                aria-current={view === id ? "page" : undefined}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-[14px] ${
                  view === id ? "bg-fill font-medium text-label" : "text-label-2 hover:text-label"
                }`}
              >
                <Icon size={17} className={view === id ? "text-tint" : ""} />
                {label}
                {id === "today" && open.length > 0 && (
                  <span className="num ml-auto text-[12px] text-label-2">{open.length}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-auto px-2 text-[11px] leading-relaxed text-label-3">
          Demo data for a fictional store.
        </div>
      </nav>

      {/* Main */}
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="sticky top-0 z-10 flex gap-1 border-b border-separator bg-[var(--sidebar)] p-2 backdrop-blur-xl md:hidden">
          {NAV.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setView(id)}
              className={`flex-1 rounded-lg py-1.5 text-[13px] font-medium ${view === id ? "bg-surface shadow-sm" : "text-label-2"}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mx-auto max-w-[760px] px-5 pb-16 pt-8 md:px-8 md:pt-12">
          {view === "today" && (
            <>
              <header className="flex items-end justify-between gap-4">
                <div>
                  <p className="text-[13px] font-medium text-label-2">{overview ? longDate(overview.today) : " "}</p>
                  <h1 className="text-[34px] font-bold leading-tight tracking-[-0.02em]">Today</h1>
                </div>
                {priorities.length > 0 && <Ring done={handled.length} total={priorities.length} />}
              </header>
              <p className="mt-3 max-w-[60ch] text-[17px] leading-snug text-label-2">
                {briefing?.summary ?? "Preparing today's priorities…"}
              </p>

              {briefing?.notices.map((n) => (
                <div key={n.id} className="mt-5 flex gap-3 rounded-xl bg-surface px-4 py-3 ring-1 ring-separator">
                  <BoltIcon size={18} className="mt-0.5 shrink-0 text-label-2" />
                  <p className="text-[14px] leading-snug text-label-2">{n.reason}</p>
                </div>
              ))}

              <LayoutGroup>
                <section className="mt-7">
                  <h2 className="mb-2 px-4 text-[13px] font-semibold text-label-2">
                    {open.length ? "To decide" : "All done for today"}
                  </h2>
                  <motion.ul layout className="overflow-hidden rounded-xl bg-surface ring-1 ring-separator">
                    <AnimatePresence initial={false}>
                      {open.map((a) => (
                        <ActionRow
                          key={a.id}
                          action={a}
                          selected={a.id === selectedId}
                          onOpen={() => setSelectedId(a.id)}
                          onToggle={() => toggle(a)}
                        />
                      ))}
                    </AnimatePresence>
                    {!briefing && <li className="h-[300px] animate-pulse bg-fill" />}
                    {briefing && open.length === 0 && (
                      <li className="px-4 py-6 text-[14px] text-label-2">
                        Every priority has a decision. Open “All suggestions” to look further ahead.
                      </li>
                    )}
                  </motion.ul>
                </section>

                {handled.length > 0 && (
                  <motion.section layout className="mt-7">
                    <h2 className="mb-2 px-4 text-[13px] font-semibold text-label-2">Handled</h2>
                    <motion.ul layout className="overflow-hidden rounded-xl bg-surface ring-1 ring-separator">
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
                <dl className="mt-9 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-separator ring-1 ring-separator sm:grid-cols-4">
                  {[
                    ["Running out", overview.stockout_risks, "items"],
                    ["Late deliveries", overview.late_deliveries, "orders"],
                    ["Hard to find", overview.visibility_issues, "items"],
                    ["Slow stock", money(overview.slow_stock_value_uah), "tied up"],
                  ].map(([k, v, u]) => (
                    <div key={k as string} className="bg-surface px-4 py-3">
                      <dt className="text-[12px] text-label-2">{k}</dt>
                      <dd className="num mt-0.5 text-[20px] font-semibold">
                        {v} <span className="text-[12px] font-normal text-label-3">{u}</span>
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </>
          )}

          {view === "all" && (
            <>
              <h1 className="text-[34px] font-bold tracking-[-0.02em]">All suggestions</h1>
              <p className="mt-1 text-[15px] text-label-2">Everything the store data points to, highest value first.</p>
              <div role="tablist" className="mt-5 inline-flex flex-wrap gap-0.5 rounded-[10px] bg-fill p-0.5">
                {FILTERS.map((f) => (
                  <button
                    key={f}
                    role="tab"
                    aria-selected={filter === f}
                    onClick={() => setFilter(f)}
                    className="relative rounded-lg px-3 py-1 text-[13px] font-medium"
                  >
                    {filter === f && (
                      <motion.span
                        layoutId="seg"
                        className="absolute inset-0 rounded-lg bg-surface shadow-sm"
                        transition={{ type: "spring", stiffness: 500, damping: 40 }}
                      />
                    )}
                    <span className="relative">{f === "ALL" ? "All" : TYPE_META[f].label}</span>
                  </button>
                ))}
              </div>
              <ul className="mt-4 overflow-hidden rounded-xl bg-surface ring-1 ring-separator">
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
              <h1 className="text-[34px] font-bold tracking-[-0.02em]">Decisions</h1>
              <p className="mt-1 text-[15px] text-label-2">Every approval and dismissal, newest first.</p>
              {decisions && decisions.length === 0 ? (
                <p className="mt-8 text-[15px] text-label-2">No decisions yet. Approve or dismiss a priority on Today.</p>
              ) : (
                <ul className="mt-5 divide-y divide-separator overflow-hidden rounded-xl bg-surface ring-1 ring-separator">
                  {(decisions ?? []).map((d) => {
                    const a = all.get(d.action_id);
                    return (
                      <li key={d.action_id} className="flex items-center gap-3 px-4 py-3">
                        {a && (
                          <span style={{ color: TYPE_META[a.type].color }}>
                            <TypeIcon type={a.type} />
                          </span>
                        )}
                        <button onClick={() => setSelectedId(d.action_id)} className="min-w-0 flex-1 text-left">
                          <div className="truncate text-[15px] font-medium">{a?.product_name ?? d.action_id}</div>
                          <div className="text-[13px] text-label-2">
                            {d.decision === "approve" ? "Approved" : d.decision === "change" ? `Approved with change: ${d.value}` : `Dismissed: ${d.reason}`}
                            {" · "}
                            {new Date(d.decided_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                          </div>
                        </button>
                        <button onClick={() => undo(d.action_id)} className="text-[14px] font-medium text-tint">
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
              className="fixed inset-0 z-20 bg-black/25 lg:hidden"
            />
            <div className="fixed inset-x-0 bottom-0 top-12 z-30 overflow-hidden rounded-t-2xl lg:static lg:inset-auto lg:z-auto lg:w-[420px] lg:shrink-0 lg:rounded-none lg:py-3">
              <DetailPanel
                key={selected.id}
                action={selected}
                decision={decided.get(selected.id)}
                onClose={() => setSelectedId(null)}
                onDecide={(kind, opts) => decide(selected.id, kind, opts)}
                onUndo={() => undo(selected.id)}
              />
            </div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
