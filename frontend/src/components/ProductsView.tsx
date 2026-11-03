"use client";

import { AnimatePresence, motion } from "motion/react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import type { ProductList, ProductRow, ProductStatus, StoreUpdate } from "@/lib/api";
import { fetcher } from "@/lib/api";
import { ChevronIcon, CloseIcon } from "./icons";
import { ProductPanel } from "./ProductPanel";
import { ScreenHeader } from "./ScreenHeader";
import { CoverBar, coverText, dayLabel, StatusChip, UPDATE_COLOR } from "./ProductStatus";

type Sort = "attention" | "name" | "cover";
const SORTS: { id: Sort; label: string }[] = [
  { id: "attention", label: "Needs attention" },
  { id: "name", label: "A–Z" },
  { id: "cover", label: "Lasts least" },
];
const FEED_PREVIEW = 4;
const PANEL_W = 400;

const LIST = "overflow-hidden rounded-[14px] bg-paper";

type Health = "running" | "late" | "hard" | "over" | "fine";
const HEALTH: { id: Health; label: string; statuses: ProductStatus[]; color: string }[] = [
  { id: "running", label: "Running low", statuses: ["running_out", "low"], color: "var(--red)" },
  { id: "late", label: "Late delivery", statuses: ["late"], color: "var(--orange)" },
  { id: "hard", label: "Hard to find", statuses: ["hard_to_find"], color: "var(--ink)" },
  { id: "over", label: "Overstocked", statuses: ["overstocked"], color: "var(--orange)" },
  { id: "fine", label: "In good shape", statuses: ["ok", "on_order"], color: "var(--green)" },
];

const SearchIcon = () => (
  <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m15.5 15.5 5 5" />
  </svg>
);

const lasts = (r: ProductRow) => (r.days_cover === null ? "Not selling" : `Lasts ${coverText(r.days_cover).toLowerCase()}`);

const ProductItem = ({ r, selected, onOpen }: { r: ProductRow; selected: boolean; onOpen: () => void }) => (
  <li className="cell [--inset:16px] [contain-intrinsic-size:auto_84px] [content-visibility:auto]" style={{ background: selected ? "var(--selected)" : undefined }}>
    <button
      type="button"
      onClick={onOpen}
      aria-current={selected ? "true" : undefined}
      className="flex min-h-[72px] w-full items-center gap-3 py-3 pl-4 pr-3 text-left transition-colors hover:bg-[rgba(0,0,0,0.03)] active:bg-fill"
    >
      <span className="min-w-0 flex-1">
        <span className="t-body block font-semibold md:truncate">{r.name}</span>
        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <StatusChip status={r.status} />
          <span className="t-footnote num text-muted">{r.stock} in stock</span>
          <span className="t-footnote num hidden text-muted md:inline">{r.supplier}</span>
        </span>
      </span>
      <span className="w-[92px] shrink-0 md:w-[150px]">
        <span className="t-footnote num block text-right font-medium" style={{ color: r.status === "running_out" || r.status === "low" ? "var(--red)" : undefined }}>
          {lasts(r)}
        </span>
        <CoverBar days={r.days_cover} status={r.status} className="mt-1.5" />
      </span>
      <span className="t-body num hidden w-[76px] shrink-0 text-right md:block">₴{r.price.toFixed(2)}</span>
      <ChevronIcon size={13} className="shrink-0 text-muted" />
    </button>
  </li>
);

function Feed({ items, today, onOpen }: { items: StoreUpdate[]; today: string; onOpen: (id: string) => void }) {
  return (
    <ul aria-label="Store updates">
      {items.map((u, i) => (
        <li key={`${u.product_id}-${u.kind}-${u.date}-${i}`} className="relative">
          {i < items.length - 1 && <span className="absolute bottom-[-8px] left-[8px] top-[24px] w-[1.5px] bg-[var(--rule)]" aria-hidden />}
          <button
            type="button"
            onClick={() => onOpen(u.product_id)}
            className="flex min-h-[44px] w-full items-start gap-3 rounded-[10px] py-2 pr-2 text-left transition-colors hover:bg-[rgba(0,0,0,0.03)] active:bg-fill"
          >
            <span className="relative mt-[6px] ml-[4px] size-[10px] shrink-0 rounded-full ring-[3px] ring-[var(--floor)]" style={{ background: UPDATE_COLOR[u.kind] }} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-3">
                <span className="t-subhead truncate font-semibold">{u.name}</span>
                <span className="t-footnote num shrink-0 text-muted">{dayLabel(u.date, today)}</span>
              </span>
              <span className="t-subhead block text-muted">{u.text}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Every product in the store with its stock status and recent changes. */
export function ProductsView({ onOpenAction, onPanel }: { onOpenAction?: (actionId: string) => void; onPanel?: (open: boolean) => void }) {
  const { data, error, mutate, isValidating } = useSWR<ProductList>("/api/products", fetcher);
  const [query, setQuery] = useState("");
  const q = useDeferredValue(query.trim().toLowerCase());
  const [category, setCategory] = useState("All");
  const [health, setHealth] = useState<Health | null>(null);
  const [sort, setSort] = useState<Sort>("attention");
  const [feedOpen, setFeedOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const rows = data?.products;
  const categories = useMemo(() => ["All", ...[...new Set((rows ?? []).map((r) => r.category))].sort()], [rows]);
  const counts = useMemo(() => {
    const c = Object.fromEntries(HEALTH.map((h) => [h.id, 0])) as Record<Health, number>;
    for (const r of rows ?? []) {
      const h = HEALTH.find((x) => x.statuses.includes(r.status));
      if (h) c[h.id]++;
    }
    return c;
  }, [rows]);
  const healthMeta = HEALTH.find((h) => h.id === health);
  const shown = useMemo(() => {
    const out = (rows ?? []).filter(
      (r) =>
        (category === "All" || r.category === category) &&
        (!healthMeta || healthMeta.statuses.includes(r.status)) &&
        (!q || `${r.name} ${r.category} ${r.supplier} ${r.product_id}`.toLowerCase().includes(q)),
    );
    if (sort === "name") out.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "cover") out.sort((a, b) => (a.days_cover ?? Infinity) - (b.days_cover ?? Infinity) || a.name.localeCompare(b.name));
    return out;
  }, [rows, category, healthMeta, q, sort]);
  const attention = shown.filter((r) => r.attention);
  const rest = shown.filter((r) => !r.attention);
  const total = rows?.length ?? 0;
  const needCount = (rows ?? []).filter((r) => r.attention).length;
  const selected = selectedId ? rows?.find((r) => r.product_id === selectedId) : undefined;

  // Desktop: the panel is fixed on the right; the page narrows the content column so nothing sits under it.
  const panelOpen = Boolean(selected && data);
  useEffect(() => {
    onPanel?.(panelOpen);
  }, [panelOpen, onPanel]);
  useEffect(() => () => onPanel?.(false), [onPanel]);

  if (error && !data) {
    return (
      <div className="mx-auto mt-10 max-w-[420px] rounded-[14px] bg-paper px-6 py-8 text-center">
        <h1 className="t-title2">Can&apos;t load the products</h1>
        <p className="t-body mt-2 text-muted">Check your connection and try again.</p>
        <button onClick={() => mutate()} disabled={isValidating} className="btn-ink mt-5 disabled:opacity-50">
          {isValidating ? "Trying…" : "Retry"}
        </button>
      </div>
    );
  }

  const feed = data?.updates ?? [];
  const showFeed = !q && category === "All" && !health && sort === "attention" && feed.length > 0 && Boolean(data);
  const list = (title: string, items: ProductRow[], key: string) =>
    items.length > 0 && (
      <section key={key} className="lg:col-start-1">
        <h2 className="t-headline mb-2 flex items-baseline gap-2 px-1">
          {title} <span className="num t-subhead font-normal text-muted">{items.length}</span>
        </h2>
        <ul data-testid="product-list" aria-label={title} className={LIST}>
          {items.map((r) => (
            <ProductItem key={r.product_id} r={r} selected={r.product_id === selectedId} onOpen={() => setSelectedId(r.product_id)} />
          ))}
        </ul>
      </section>
    );

  // Desktop uses the full window width instead of the page's reading column.
  const wide = `min(1160px, calc(100vw - ${panelOpen ? 400 : 0}px - 96px))`;

  return (
    <>
      <div className="lg:ml-[calc((720px-var(--pw))/2)] lg:w-[var(--pw)]" style={{ ["--pw" as string]: wide }}>
        <ScreenHeader title="Products" />

        {/* The one yellow tag: what needs the manager now */}
        <section aria-label="Stock health" className="price-tag mt-4">
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pl-3">
            <span className="tag-figure">{rows ? needCount : "–"}</span>
            <span className="t-title3">need attention</span>
          </p>
          <p className="t-subhead num mt-2 pl-3 font-medium">
            {rows ? `${total} products, ${counts.running} running low and ${counts.late} with a late delivery.` : "Loading the shelves…"}
          </p>
        </section>

        {/* Status filters: flat text with counts */}
        <div
          role="group"
          aria-label="Filter by status"
          className="-mx-4 mt-4 flex gap-5 overflow-x-auto border-b border-[var(--rule)] px-5 [scrollbar-width:none] md:mx-0 md:px-1"
        >
          {HEALTH.map((h) => {
            const on = health === h.id;
            return (
              <button
                key={h.id}
                type="button"
                aria-pressed={on}
                disabled={!rows}
                onClick={() => setHealth(on ? null : h.id)}
                className={`t-subhead -mb-px flex min-h-[44px] shrink-0 items-center gap-1.5 whitespace-nowrap border-b-[3px] font-medium transition-colors ${
                  on ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"
                }`}
              >
                <span className="size-2 rounded-full" style={{ background: h.color }} aria-hidden />
                {h.label}
                <span className="num font-semibold text-ink">{rows ? counts[h.id] : "–"}</span>
              </button>
            );
          })}
        </div>

        {/* Find: search, categories, sort */}
        <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center">
          <label className="flex min-h-[48px] flex-1 items-center gap-2 rounded-[14px] bg-paper px-3.5 text-muted">
            <SearchIcon />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, supplier or code"
              aria-label="Search products"
              className="t-body min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-muted [&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="-mr-2 grid size-[44px] place-items-center">
                <span className="grid size-[20px] place-items-center rounded-full bg-ink text-white">
                  <CloseIcon size={10} />
                </span>
              </button>
            )}
          </label>
          <div role="tablist" aria-label="Sort" className="flex items-center gap-1">
            <span className="t-subhead mr-1 text-muted">Sort</span>
            {SORTS.map((s) => (
              <button
                key={s.id}
                role="tab"
                aria-selected={sort === s.id}
                onClick={() => setSort(s.id)}
                className={`t-subhead min-h-[44px] whitespace-nowrap rounded-full px-3 font-medium transition-colors ${
                  sort === s.id ? "text-ink underline decoration-[2px] underline-offset-[6px]" : "text-muted hover:text-ink"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div role="group" aria-label="Category" className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 py-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
              className={`t-subhead min-h-[44px] shrink-0 whitespace-nowrap rounded-full px-4 font-medium transition-colors ${
                category === c ? "bg-ink text-white" : "text-ink shadow-[inset_0_0_0_1.5px_var(--ink)] hover:bg-fill"
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        {healthMeta && (
          <div className="mt-2 flex items-center gap-2 px-1">
            <span className="t-subhead text-muted">
              Showing <span className="font-semibold text-ink">{healthMeta.label.toLowerCase()}</span>
            </span>
            <button type="button" onClick={() => setHealth(null)} className="t-subhead min-h-[44px] px-2 font-semibold underline underline-offset-4">
              Show all
            </button>
          </div>
        )}

        <div className="mt-5 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-x-8">
          {!rows ? (
            <div className={`${LIST} h-[480px] animate-pulse`} />
          ) : shown.length === 0 ? (
            <div className={`${LIST} t-subhead px-5 py-6 text-muted lg:col-span-2`}>
              {query.trim() ? `No products match “${query.trim()}”.` : "No products here."}
            </div>
          ) : sort === "attention" && !health ? (
            <>
              {list("Needs attention", attention, "a")}
              {showFeed && data && (
                <section className="lg:sticky lg:top-6 lg:col-start-2 lg:row-span-2 lg:row-start-1">
                  <h2 className="t-headline mb-1 flex min-h-[24px] items-baseline justify-between px-1">
                    <span>Updates</span>
                    {feed.length > FEED_PREVIEW && (
                      <button type="button" onClick={() => setFeedOpen((v) => !v)} className="t-subhead -my-3 min-h-[44px] px-1 font-semibold underline underline-offset-4">
                        {feedOpen ? "Show less" : `Show all ${feed.length}`}
                      </button>
                    )}
                  </h2>
                  <Feed items={feedOpen ? feed : feed.slice(0, FEED_PREVIEW)} today={data.today} onOpen={setSelectedId} />
                  <p className="t-footnote mt-1 px-1 text-muted">Late deliveries and sell-outs first, then arrivals from the last 3 days and what is due this week.</p>
                </section>
              )}
              {list(attention.length ? "Everything else" : "Products", rest, "b")}
            </>
          ) : (
            list(healthMeta ? healthMeta.label : "Products", shown, "all")
          )}
        </div>
        {rows && <p className="t-footnote mt-3 px-1 text-muted">Bars show how many days the stock lasts, up to a month. Prices in hryvnia. Demo data.</p>}
      </div>

      <AnimatePresence>
        {selected && data && (
          <>
            <motion.div
              key="product-scrim"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedId(null)}
              className="fixed inset-0 z-20 bg-black/30 lg:hidden"
            />
            <div
              key="product-panel"
              className="fixed inset-x-0 bottom-0 top-10 z-30 lg:bottom-3 lg:left-auto lg:right-3 lg:top-3 lg:w-[376px]"
              style={{ ["--w" as string]: `${PANEL_W}px` }}
            >
              <div className="h-full">
                <ProductPanel
                  key={selected.product_id}
                  row={selected}
                  today={data.today}
                  onClose={() => setSelectedId(null)}
                  onOpenAction={
                    onOpenAction &&
                    ((id) => {
                      setSelectedId(null);
                      onOpenAction(id);
                    })
                  }
                />
              </div>
            </div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
