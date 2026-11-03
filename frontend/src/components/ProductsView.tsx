"use client";

import { AnimatePresence, motion } from "motion/react";
import { useDeferredValue, useLayoutEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import type { ProductList, ProductRow, StoreUpdate } from "@/lib/api";
import { fetcher } from "@/lib/api";
import { ChevronIcon, CloseIcon } from "./icons";
import { ProductPanel } from "./ProductPanel";
import { coverText, dayLabel, StatusChip, UPDATE_COLOR } from "./ProductStatus";

type Sort = "attention" | "name" | "cover";
const SORTS: { id: Sort; label: string }[] = [
  { id: "attention", label: "Needs attention" },
  { id: "name", label: "A–Z" },
  { id: "cover", label: "Lasts least" },
];
const FEED_PREVIEW = 4;
const PANEL_W = 400;

const SearchIcon = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m15.5 15.5 5 5" />
  </svg>
);

function stockLine(r: ProductRow) {
  const parts = [`${r.stock} in stock`, r.days_cover === null ? "not selling" : `lasts ${coverText(r.days_cover).toLowerCase()}`];
  return parts.join(" · ");
}

const ProductItem = ({ r, selected, onOpen }: { r: ProductRow; selected: boolean; onOpen: () => void }) => (
  <li className="cell [contain-intrinsic-size:auto_68px] [content-visibility:auto]" style={{ background: selected ? "var(--selected)" : undefined }}>
    <button
      type="button"
      onClick={onOpen}
      aria-current={selected ? "true" : undefined}
      className="flex w-full items-center gap-2 py-[10px] pl-4 pr-3 text-left transition-colors active:bg-fill"
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-3">
          <span className="t-body truncate">{r.name}</span>
          <span className="t-body num shrink-0 text-label-2">₴{r.price.toFixed(2)}</span>
        </span>
        <span className="mt-[3px] flex items-center gap-1.5">
          <StatusChip status={r.status} />
          <span className="t-footnote num min-w-0 truncate text-label-2">
            <span className="hidden sm:inline">{r.category} · </span>
            {stockLine(r)}
          </span>
        </span>
      </span>
      <ChevronIcon size={13} className="shrink-0 text-[#c4c4c7]" />
    </button>
  </li>
);

function Feed({ items, today, onOpen }: { items: StoreUpdate[]; today: string; onOpen: (id: string) => void }) {
  return (
    <ul className="group-list" aria-label="Store updates">
      {items.map((u, i) => (
        <li key={`${u.product_id}-${u.kind}-${u.date}-${i}`} className="cell [--inset:34px]">
          <button type="button" onClick={() => onOpen(u.product_id)} className="flex w-full items-start gap-3 py-[10px] pl-4 pr-3 text-left active:bg-fill">
            <span className="mt-[7px] size-2 shrink-0 rounded-full" style={{ background: UPDATE_COLOR[u.kind] }} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-3">
                <span className="t-subhead truncate font-semibold">{u.name}</span>
                <span className="t-footnote shrink-0 text-label-2">{dayLabel(u.date, today)}</span>
              </span>
              <span className="t-subhead block text-label-2">{u.text}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Every product in the store with its stock status and recent changes. */
export function ProductsView({ onOpenAction }: { onOpenAction?: (actionId: string) => void }) {
  const { data, error, mutate, isValidating } = useSWR<ProductList>("/api/products", fetcher);
  const [query, setQuery] = useState("");
  const q = useDeferredValue(query.trim().toLowerCase());
  const [category, setCategory] = useState("All");
  const [sort, setSort] = useState<Sort>("attention");
  const [feedOpen, setFeedOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const rows = data?.products;
  const categories = useMemo(() => ["All", ...[...new Set((rows ?? []).map((r) => r.category))].sort()], [rows]);
  const shown = useMemo(() => {
    const out = (rows ?? []).filter(
      (r) =>
        (category === "All" || r.category === category) &&
        (!q || `${r.name} ${r.category} ${r.supplier} ${r.product_id}`.toLowerCase().includes(q)),
    );
    if (sort === "name") out.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "cover") out.sort((a, b) => (a.days_cover ?? Infinity) - (b.days_cover ?? Infinity) || a.name.localeCompare(b.name));
    return out;
  }, [rows, category, q, sort]);
  const attention = shown.filter((r) => r.attention);
  const rest = shown.filter((r) => !r.attention);
  const needCount = (rows ?? []).filter((r) => r.attention).length;
  const selected = selectedId ? rows?.find((r) => r.product_id === selectedId) : undefined;

  // Desktop: the inspector is fixed on the right; slide the list left so it stays clear of it when there is room.
  const root = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    const measure = () => {
      const el = root.current?.parentElement;
      if (!el || !selected || window.innerWidth < 1024) return setShift(0);
      const box = el.getBoundingClientRect();
      const overlap = box.right - (window.innerWidth - PANEL_W - 24);
      const room = box.left - (el.offsetParent?.getBoundingClientRect().left ?? 0) - 16;
      setShift(overlap > 0 ? Math.min(overlap, Math.max(room, 0)) : 0);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [selected]);

  if (error && !data) {
    return (
      <div className="px-1 pt-10 text-center">
        <h1 className="t-title2">Can&apos;t load the products</h1>
        <p className="t-body mt-2 text-label-2">Check your connection and try again.</p>
        <button
          onClick={() => mutate()}
          disabled={isValidating}
          className="t-body mt-5 rounded-[12px] bg-tint-fill px-5 py-2 font-semibold text-white active:opacity-80 disabled:opacity-50"
        >
          {isValidating ? "Trying…" : "Retry"}
        </button>
      </div>
    );
  }

  const feed = data?.updates ?? [];
  const list = (title: string, items: ProductRow[], key: string) =>
    items.length > 0 && (
      <section className="mt-6" key={key}>
        <h2 className="group-header">
          {title} <span className="num">({items.length})</span>
        </h2>
        <ul className="group-list">
          {items.map((r) => (
            <ProductItem key={r.product_id} r={r} selected={r.product_id === selectedId} onOpen={() => setSelectedId(r.product_id)} />
          ))}
        </ul>
      </section>
    );

  return (
    <>
      <motion.div ref={root} animate={{ x: -shift }} transition={{ type: "spring", stiffness: 420, damping: 40 }}>
        <header className="px-1">
          <p className="t-subhead text-label-2">{rows ? `${rows.length} products · ${needCount} need attention` : " "}</p>
          <h1 className="t-large-title">Products</h1>
        </header>

        <label className="mt-4 flex items-center gap-2 rounded-[10px] bg-fill px-2.5 py-[7px] text-label-2">
          <SearchIcon />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, supplier or code"
            aria-label="Search products"
            className="t-body min-w-0 flex-1 bg-transparent text-label outline-none placeholder:text-label-2 [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="grid size-[18px] place-items-center rounded-full bg-label-3 text-white">
              <CloseIcon size={10} />
            </button>
          )}
        </label>

        <div role="group" aria-label="Category" className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
              className={`t-subhead shrink-0 rounded-full px-3 py-[5px] font-medium transition-colors ${
                category === c ? "bg-tint-fill text-white" : "bg-surface text-label hover:bg-fill-2"
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        <div role="tablist" aria-label="Sort" className="mt-3 flex w-full rounded-[9px] bg-fill p-[2px] sm:inline-flex sm:w-auto">
          {SORTS.map((s) => (
            <button
              key={s.id}
              role="tab"
              aria-selected={sort === s.id}
              onClick={() => setSort(s.id)}
              className="t-footnote relative flex-1 whitespace-nowrap rounded-[7px] px-3 py-[5px] font-medium sm:flex-none"
            >
              {sort === s.id && (
                <motion.span
                  layoutId="product-sort"
                  className="absolute inset-0 rounded-[7px] bg-white shadow-[0_3px_8px_rgba(0,0,0,0.12),0_3px_1px_rgba(0,0,0,0.04)]"
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                />
              )}
              <span className="relative">{s.label}</span>
            </button>
          ))}
        </div>

        {!rows ? (
          <div className="group-list mt-8 h-[480px] animate-pulse" />
        ) : shown.length === 0 ? (
          <div className="group-list t-subhead mt-8 px-4 py-4 text-label-2">No products match “{query.trim()}”.</div>
        ) : sort === "attention" ? (
          <>
            {list("Needs attention", attention, "a")}
        {!q && category === "All" && feed.length > 0 && data && (
          <section className="mt-8">
            <h2 className="group-header flex items-baseline justify-between">
              <span>Updates</span>
              {feed.length > FEED_PREVIEW && (
                <button type="button" onClick={() => setFeedOpen((v) => !v)} className="t-footnote font-medium normal-case text-tint">
                  {feedOpen ? "Show less" : `Show all ${feed.length}`}
                </button>
              )}
            </h2>
            <Feed items={feedOpen ? feed : feed.slice(0, FEED_PREVIEW)} today={data.today} onOpen={setSelectedId} />
            <p className="group-footer">Late deliveries and items that sold out or stopped selling first, then what arrived in the last 3 days and what is due this week.</p>
          </section>
        )}

            {list(attention.length ? "Everything else" : "Products", rest, "b")}
          </>
        ) : (
          list("Products", shown, "all")
        )}
        {rows && <p className="group-footer">Lasts: days the stock covers at the expected daily sales. Prices in hryvnia.</p>}
      </motion.div>

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
              className="fixed inset-x-0 bottom-0 top-10 z-30 lg:inset-y-0 lg:left-auto lg:right-0 lg:top-0 lg:border-l lg:border-separator lg:shadow-[-8px_0_24px_rgba(0,0,0,0.06)]"
              style={{ ["--w" as string]: `${PANEL_W}px` }}
            >
              <div className="h-full lg:w-[var(--w)]">
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
