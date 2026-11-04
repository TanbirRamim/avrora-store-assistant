/** Category icons and the neutral product thumbnail (no product photos exist). Stroke style matches icons.tsx. */

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

const PATHS: Record<string, React.ReactNode> = {
  // mug
  Kitchen: (
    <>
      <path d="M4.5 8h11v7.5a4 4 0 0 1-4 4h-3a4 4 0 0 1-4-4z" />
      <path d="M15.5 10h1.5a2.5 2.5 0 0 1 0 5h-1.5" />
      <path d="M8 3.5c-.6.8-.6 1.7 0 2.5M11.5 3.5c-.6.8-.6 1.7 0 2.5" />
    </>
  ),
  // spray bottle
  Household: (
    <>
      <path d="M8 9.5h6l1 2.5v8.5H7V12z" />
      <path d="M9.5 9.5V6h3v3.5" />
      <path d="M9.5 6h-2V4h7.5l1.5 2" />
      <path d="M17.5 4.5h1.5M17.5 7h1.5" />
    </>
  ),
  // tube + bottle
  Cosmetics: (
    <>
      <path d="M5.5 10.5h5v10h-5z" />
      <path d="M6.5 10.5V7.5h3v3" />
      <path d="M7 7.5V4h2v3.5" />
      <path d="M14 20.5l1-10h4l1 10z" />
      <path d="M15.5 10.5V8h3v2.5" />
    </>
  ),
  // snowflake
  Seasonal: (
    <>
      <path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9" />
      <path d="M9.8 4.8 12 7l2.2-2.2M9.8 19.2 12 17l2.2 2.2" />
    </>
  ),
  // pencil
  Stationery: (
    <>
      <path d="M15.5 4.5 19.5 8.5 9 19H5v-4z" />
      <path d="M13 7l4 4" />
    </>
  ),
  // building blocks
  Toys: (
    <>
      <path d="M4 13.5h7v7H4zM13 13.5h7v7h-7zM8.5 4.5h7v7h-7z" />
    </>
  ),
};

const FALLBACK = (
  <>
    <path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z" />
    <path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" />
  </>
);

export function CategoryIcon({ category, size = 20, className }: { category: string; size?: number; className?: string }) {
  return (
    <svg {...base(size)} className={className}>
      {PATHS[category] ?? FALLBACK}
    </svg>
  );
}

/** 40 px (48 in the sheet) bordered tile with the category icon, standing in for a product photo. */
export function ProductThumb({ category, size = 40 }: { category: string; size?: 40 | 48 }) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded-[8px] border border-[var(--border)] bg-[#f4f4f5] text-[#52525b]"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <CategoryIcon category={category} size={size === 48 ? 24 : 20} />
    </span>
  );
}
