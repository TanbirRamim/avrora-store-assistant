/**
 * Shared motion values. They mirror the CSS custom properties in globals.css
 * (--dur-*, --ease-*), so sheets built with `motion` and with `.sheet-enter` move alike.
 */

/** Sheets and panels: a soft spring with no visible overshoot. */
export const SHEET_SPRING = { type: "spring", stiffness: 340, damping: 34, mass: 0.9 } as const;

/** The page behind a sheet dims and clears on this curve. */
export const SCRIM_FADE = { duration: 0.24, ease: [0.2, 0.8, 0.2, 1] } as const;

/** Tab switch: 160 ms cross-fade with a 4 px rise. */
export const VIEW_ENTER = { duration: 0.16, ease: [0.2, 0.8, 0.2, 1] } as const;

/** Toasts slide up from below and settle. */
export const TOAST_SPRING = { type: "spring", stiffness: 420, damping: 36 } as const;

/** How long an approved row shows its filled check before it moves to Handled. */
export const SETTLE_MS = 420;
