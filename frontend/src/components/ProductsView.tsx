"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import useSWR from "swr";
import type { ProductList, ProductRow, StoreUpdate } from "@/lib/api";
import { fetcher } from "@/lib/api";
import { ChevronIcon, CloseIcon } from "./icons";
import { ProductPanel } from "./ProductPanel";
import { ScreenHeader } from "./ScreenHeader";
import { ProductThumb } from "./CategoryIcon";
import { coverText, dayLabel, StatusChip, UPDATE_COLOR } from "./ProductStatus";

type Sort = "attention" | "name" | "cover";
const SORTS: { id: Sort; label: string }[] = [
  { id: "attention", label: "Priority" },
  { id: "name", label: "A–Z" },
  { id: "cover", label: "Lasts least" },
];
const FEED_PREVIEW = 4;
const PANEL_W = 400;

const LIST =
  "overflow-hidden rounded-[12px] border border-[var(--border)] bg-paper shadow-[0_1px_2px_rgba(16,24,40,0.04)]";

type Filter = "all" | "attention" | "running" | "late" | "hard" | "over";
const FILTERS: {
  id: Filter;
  label: string;
  match: (r: ProductRow) => boolean;
}[] = [
  { id: "all", label: "All", match: () => true },
  { id: "attention", label: "Needs attention", match: (r) => r.attention },
  {
    id: "running",
    label: "Running low",
    match: (r) => r.status === "running_out" || r.status === "low",
  },
  { id: "late", label: "Late", match: (r) => r.status === "late" },
  {
    id: "hard",
    label: "Hard to find",
    match: (r) => r.status === "hard_to_find",
  },
  {
    id: "over",
    label: "Overstocked",
    match: (r) => r.status === "overstocked",
  },
];

const SearchIcon = () => (
  <svg
    width={18}
    height={18}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    aria-hidden
  >
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m15.5 15.5 5 5" />
  </svg>
);

const short = (r: ProductRow) =>
  r.status === "running_out" || r.status === "low";
const lastsText = (r: ProductRow) =>
  r.days_cover === null ? "Not selling" : coverText(r.days_cover);

/** Desktop columns: Product | Status | In stock | Lasts | Price | chevron. */
const COLS =
  "lg:grid lg:grid-cols-[minmax(0,1fr)_132px_84px_104px_92px_16px] lg:gap-x-4";

function TableHead() {
  return (
    <div
      aria-hidden
      className={`hidden border-b border-[var(--border)] bg-[#fafafa] py-2.5 pl-4 pr-4 text-[13px] font-medium leading-[18px] text-[var(--text-2,#52525b)] ${COLS}`}
    >
      <span className="pl-[52px]">Product</span>
      <span>Status</span>
      <span className="text-right">In stock</span>
      <span className="text-right">Lasts</span>
      <span className="text-right">Price</span>
      <span />
    </div>
  );
}

const ProductItem = ({
  r,
  selected,
  onOpen,
}: {
  r: ProductRow;
  selected: boolean;
  onOpen: () => void;
}) => (
  <li
    className="cell [--inset:68px] [contain-intrinsic-size:auto_68px] [content-visibility:auto] lg:[--inset:0px]"
    style={selected ? { background: "#fafafa", boxShadow: "inset 3px 0 0 var(--ink)" } : undefined}
  >
    <button
      type="button"
      onClick={onOpen}
      aria-current={selected ? "true" : undefined}
      className={`flex min-h-[68px] w-full items-center gap-3 py-3 pl-4 pr-3 text-left transition-colors duration-150 hover:bg-[#fafafa] active:bg-[#f4f4f5] lg:min-h-[64px] lg:items-center lg:pr-4 ${COLS}`}
    >
      <span className="flex min-w-0 flex-1 items-center gap-3">
        <ProductThumb category={r.category} />
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-medium leading-[20px]">
            {r.name}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 lg:hidden">
            <StatusChip status={r.status} />
            <span className="t-footnote num text-muted">
              {r.stock} in stock
            </span>
          </span>
          <span className="t-footnote mt-0.5 hidden text-muted lg:block">
            {r.supplier}
          </span>
        </span>
      </span>
      <span className="hidden lg:block">
        <StatusChip status={r.status} />
      </span>
      <span className="num-col hidden text-right text-[14px] lg:block">
        {r.stock}
      </span>
      <span
        className="num shrink-0 whitespace-nowrap text-right text-[14px] leading-[20px] text-muted lg:text-[14px] lg:font-normal"
        style={short(r) ? { color: "#b91c1c", fontWeight: 500 } : undefined}
      >
        {lastsText(r)}
      </span>
      <span className="num-col hidden text-right text-[14px] lg:block">
        ₴{r.price.toFixed(2)}
      </span>
      <ChevronIcon size={13} className="shrink-0 text-muted" />
    </button>
  </li>
);

function Feed({
  items,
  today,
  onOpen,
}: {
  items: StoreUpdate[];
  today: string;
  onOpen: (id: string) => void;
}) {
  return (
    <ul aria-label="Store updates">
      {items.map((u, i) => (
        <li
          key={`${u.product_id}-${u.kind}-${u.date}-${i}`}
          className="relative"
        >
          {i < items.length - 1 && (
            <span
              className="absolute bottom-[-8px] left-[8px] top-[24px] w-[1.5px] bg-[var(--rule)]"
              aria-hidden
            />
          )}
          <button
            type="button"
            onClick={() => onOpen(u.product_id)}
            className="flex min-h-[44px] w-full items-start gap-3 rounded-[10px] py-2 pr-2 text-left transition-colors hover:bg-[rgba(0,0,0,0.03)] active:bg-fill"
          >
            <span
              className="relative mt-[6px] ml-[4px] size-[10px] shrink-0 rounded-full ring-[3px] ring-white"
              style={{ background: UPDATE_COLOR[u.kind] }}
              aria-hidden
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 text-[14px] font-medium">
                  {u.name}
                </span>
                <span className="t-footnote num shrink-0 text-muted">
                  {dayLabel(u.date, today)}
                </span>
              </span>
              <span className="block text-[14px] leading-[20px] text-muted">
                {u.text}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Every product in the store with its stock status and recent changes. */
export function ProductsView({
  onOpenAction,
  onPanel,
}: {
  onOpenAction?: (actionId: string) => void;
  onPanel?: (open: boolean) => void;
}) {
  const { data, error, mutate, isValidating } = useSWR<ProductList>(
    "/api/products",
    fetcher,
  );
  const [query, setQuery] = useState("");
  const q = useDeferredValue(query.trim().toLowerCase());
  const [category, setCategory] = useState("All");
  const [filter, setFilter] = useState<Filter>("attention");
  const [sort, setSort] = useState<Sort>("attention");
  const [feedOpen, setFeedOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const reduce = useReducedMotion();

  const rows = data?.products;
  const categories = useMemo(
    () => [...new Set((rows ?? []).map((r) => r.category))].sort(),
    [rows],
  );
  // Tab counts follow search and category, like an index table's saved views.
  const scoped = useMemo(
    () =>
      (rows ?? []).filter(
        (r) =>
          (category === "All" || r.category === category) &&
          (!q ||
            `${r.name} ${r.category} ${r.supplier} ${r.product_id}`
              .toLowerCase()
              .includes(q)),
      ),
    [rows, category, q],
  );
  const counts = useMemo(
    () =>
      Object.fromEntries(
        FILTERS.map((f) => [f.id, scoped.filter(f.match).length]),
      ) as Record<Filter, number>,
    [scoped],
  );
  const filterMeta = FILTERS.find((f) => f.id === filter)!;
  const shown = useMemo(() => {
    const out = scoped.filter(filterMeta.match);
    if (sort === "name") out.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "cover")
      out.sort(
        (a, b) =>
          (a.days_cover ?? Infinity) - (b.days_cover ?? Infinity) ||
          a.name.localeCompare(b.name),
      );
    return out;
  }, [scoped, filterMeta, sort]);
  const total = rows?.length ?? 0;
  const needCount = (rows ?? []).filter((r) => r.attention).length;
  const runningCount = (rows ?? []).filter(
    (r) => r.status === "running_out" || r.status === "low",
  ).length;
  const lateCount = (rows ?? []).filter((r) => r.status === "late").length;
  const selected = selectedId
    ? rows?.find((r) => r.product_id === selectedId)
    : undefined;

  // Desktop: the panel is fixed on the right; the page narrows the content column so nothing sits under it.
  const panelOpen = Boolean(selected && data);
  useEffect(() => {
    onPanel?.(panelOpen);
  }, [panelOpen, onPanel]);
  useEffect(() => () => onPanel?.(false), [onPanel]);

  if (error && !data) {
    return (
      <div className="mx-auto mt-10 max-w-[420px] rounded-[12px] border border-[var(--border)] bg-paper px-6 py-8 text-center">
        <h1 className="t-title2">Can&apos;t load the products</h1>
        <p className="t-body mt-2 text-muted">
          Check your connection and try again.
        </p>
        <button
          onClick={() => mutate()}
          disabled={isValidating}
          className="btn-ink mt-5 disabled:opacity-50"
        >
          {isValidating ? "Trying…" : "Retry"}
        </button>
      </div>
    );
  }

  const feed = data?.updates ?? [];
  const showFeed =
    !q &&
    category === "All" &&
    (filter === "attention" || filter === "all") &&
    feed.length > 0 &&
    Boolean(data);
  const sideFeed = showFeed && !panelOpen;
  const listKey = `${filter}|${category}|${sort}`;
  const fade = reduce
    ? { duration: 0 }
    : { duration: 0.18, ease: [0.2, 0, 0, 1] as const };

  // Desktop uses the full window width instead of the page's reading column.
  const wide = `min(1160px, calc(100vw - ${panelOpen ? 400 : 0}px - 96px))`;

  const feedSection = showFeed && data && (
    <section
      aria-label="Store updates"
      className={
        sideFeed ? "lg:sticky lg:top-6 lg:col-start-2 lg:row-start-1" : ""
      }
    >
      <div className="mb-2 flex min-h-[24px] items-center justify-between px-1">
        <h2 className="text-[15px] font-semibold leading-[20px]">Updates</h2>
        {feed.length > FEED_PREVIEW && (
          <button
            type="button"
            onClick={() => setFeedOpen((v) => !v)}
            className="-my-3 min-h-[44px] px-1 text-[14px] font-medium text-[var(--text-2,#52525b)] hover:text-ink"
          >
            {feedOpen ? "Show less" : `Show all ${feed.length}`}
          </button>
        )}
      </div>
      <div className={`${LIST} px-2 py-1`}>
        <Feed
          items={feedOpen ? feed : feed.slice(0, FEED_PREVIEW)}
          today={data.today}
          onOpen={setSelectedId}
        />
      </div>
    </section>
  );

  return (
    <>
      <div
        className="lg:ml-[calc((720px-var(--pw))/2)] lg:w-[var(--pw)]"
        style={{ ["--pw" as string]: wide }}
      >
        <ScreenHeader title="Products" />

        {/* Summary: key figure and one sentence */}
        <section aria-label="Stock health" className="mt-4">
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="num text-[30px] font-semibold leading-[36px] tracking-[-0.02em]">
              {rows ? needCount : "–"}
            </span>
            <span className="text-[17px] font-medium leading-[22px] tracking-[-0.01em]">
              need attention
            </span>
          </p>
          <p className="num mt-1 text-[14px] leading-[20px] text-muted">
            {rows
              ? `${total} products, ${runningCount} running low and ${lateCount} with a late delivery.`
              : "Loading the shelves…"}
          </p>
        </section>

        <div
          className={`mt-5 grid grid-cols-1 gap-6 ${sideFeed ? "lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start lg:gap-x-8" : ""}`}
        >
          {sideFeed && <div className="hidden lg:block">{feedSection}</div>}

          <div className="min-w-0 lg:col-start-1 lg:row-start-1">
            {/* Filter tabs with counts (Polaris index pattern) */}
            <div
              role="tablist"
              aria-label="Filter by status"
              className="scroll-row -mx-4 gap-0 border-b border-[var(--border)] px-1 md:mx-0 md:px-0"
            >
              {FILTERS.map((f) => {
                const on = filter === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    disabled={!rows}
                    onClick={() => setFilter(f.id)}
                    className={`relative flex min-h-[44px] shrink-0 items-center gap-1.5 whitespace-nowrap px-3 text-[14px] font-medium transition-colors duration-150 ${
                      on
                        ? "text-ink"
                        : "text-[var(--text-2,#52525b)] hover:text-ink"
                    }`}
                  >
                    {f.label}
                    <span
                      className={`num rounded-full px-1.5 text-[12px] leading-[18px] transition-colors duration-150 ${on ? "bg-ink text-white" : "bg-[#f4f4f5] text-[var(--text-2,#52525b)]"}`}
                    >
                      {rows ? counts[f.id] : "–"}
                    </span>
                    <span
                      aria-hidden
                      className={`absolute inset-x-3 bottom-[-1px] h-[2px] rounded-full bg-ink transition-opacity duration-150 ${on ? "opacity-100" : "opacity-0"}`}
                    />
                  </button>
                );
              })}
            </div>

            {/* Find: search, category, sort */}
            <div className="mt-3 flex flex-col gap-2 lg:flex-row lg:items-center">
              <label className="flex min-h-[48px] flex-1 cursor-text items-center gap-2 rounded-[10px] border border-[var(--border)] bg-paper pl-3 text-muted transition-shadow focus-within:border-ink focus-within:shadow-[0_0_0_3px_rgba(24,24,27,0.12)] lg:min-h-[44px]">
                <SearchIcon />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search name, supplier or code"
                  aria-label="Search products"
                  className="h-[46px] min-w-0 flex-1 bg-transparent pr-3 text-[16px] leading-[22px] text-ink outline-none placeholder:text-[var(--text-3)] lg:h-[42px] lg:text-[15px] [&::-webkit-search-cancel-button]:hidden"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label="Clear search"
                    className="grid size-[44px] shrink-0 place-items-center"
                  >
                    <span className="grid size-[20px] place-items-center rounded-full bg-[#e4e4e7] text-ink">
                      <CloseIcon size={10} />
                    </span>
                  </button>
                )}
              </label>
              <div className="flex gap-2">
                <Picker
                  label="Category"
                  value={category}
                  onChange={setCategory}
                  options={[
                    { id: "All", label: "All" },
                    ...categories.map((c) => ({ id: c, label: c })),
                  ]}
                />
                <Picker
                  label="Sort"
                  value={sort}
                  onChange={(v) => setSort(v as Sort)}
                  options={SORTS}
                  className="lg:hidden"
                />
              </div>
              <div
                role="radiogroup"
                aria-label="Sort"
                className="hidden items-center rounded-[10px] bg-[#f4f4f5] p-[3px] lg:flex"
              >
                {SORTS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    role="radio"
                    aria-checked={sort === s.id}
                    onClick={() => setSort(s.id)}
                    className={`min-h-[38px] whitespace-nowrap rounded-[8px] px-3 text-[14px] font-medium transition-[background-color,color,box-shadow] duration-150 ${
                      sort === s.id
                        ? "bg-paper text-ink shadow-[0_1px_2px_rgba(16,24,40,0.08),0_1px_3px_rgba(16,24,40,0.06)]"
                        : "text-[var(--text-2,#52525b)] hover:text-ink"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <p
              className="num mt-4 px-1 text-[13px] leading-[18px] text-[var(--text-2,#52525b)]"
              aria-live="polite"
            >
              {rows ? `Showing ${shown.length} of ${total} products` : " "}
            </p>

            <div className={`${LIST} mt-2`}>
              {!rows ? (
                <div className="h-[480px] animate-pulse bg-[#fafafa]" />
              ) : shown.length === 0 ? (
                <div className="t-subhead px-5 py-6 text-muted">
                  {query.trim()
                    ? `No products match “${query.trim()}”.`
                    : "No products here."}
                </div>
              ) : (
                <>
                  <TableHead />
                  <motion.ul
                    key={listKey}
                    data-testid="product-list"
                    aria-label={
                      filterMeta.label === "All" ? "Products" : filterMeta.label
                    }
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={fade}
                  >
                    {shown.map((r) => (
                      <ProductItem
                        key={r.product_id}
                        r={r}
                        selected={r.product_id === selectedId}
                        onOpen={() => setSelectedId(r.product_id)}
                      />
                    ))}
                  </motion.ul>
                </>
              )}
            </div>
            {rows && (
              <p className="t-footnote mt-3 px-1 text-muted">
                Prices in hryvnia. Demo data.
              </p>
            )}
          </div>
          {showFeed && (
            <div className={sideFeed ? "lg:hidden" : ""}>{feedSection}</div>
          )}
        </div>
      </div>

      {/* Portal: the view wrapper keeps a transform from its enter animation, which would trap position:fixed. */}
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {selected && data && (
              <>
                <motion.div
                  key="product-scrim"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setSelectedId(null)}
                  className="fixed inset-0 z-20 bg-[rgba(24,24,27,0.32)] lg:hidden"
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
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}

/** Compact menu button on a native select: 44 px+, keyboard and screen-reader friendly. */
function Picker({
  label,
  value,
  onChange,
  options,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { id: string; label: string }[];
  className?: string;
}) {
  return (
    <label
      className={`relative flex min-h-[48px] flex-1 items-center rounded-[10px] border border-[var(--border)] bg-paper transition-shadow focus-within:border-ink focus-within:shadow-[0_0_0_3px_rgba(24,24,27,0.12)] lg:min-h-[44px] lg:flex-none ${className}`}
    >
      <span
        aria-hidden
        className="pointer-events-none flex min-w-0 flex-1 items-baseline gap-1.5 whitespace-nowrap pl-3 pr-9 text-[15px] lg:text-[14px]"
      >
        <span className="text-[var(--text-2,#52525b)]">{label}</span>
        <span className="font-medium text-ink">
          {options.find((o) => o.id === value)?.label}
        </span>
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="absolute inset-0 size-full cursor-pointer appearance-none text-[16px] opacity-0"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronIcon
        size={12}
        className="pointer-events-none absolute right-3 rotate-90 text-muted"
      />
    </label>
  );
}
