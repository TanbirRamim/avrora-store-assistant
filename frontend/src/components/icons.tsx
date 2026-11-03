import type { ActionType } from "@/lib/api";

type P = { size?: number; className?: string };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

export const BoxIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z" />
    <path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" />
  </svg>
);

export const TagIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M3 12V4.5A1.5 1.5 0 0 1 4.5 3H12l9 9-9 9z" />
    <circle cx="7.5" cy="7.5" r="1.4" />
  </svg>
);

export const EyeIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const TruckIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M2.5 6h11v10h-11zM13.5 9.5h4l3 3.5V16h-7z" />
    <circle cx="6.5" cy="17.5" r="1.8" />
    <circle cx="17" cy="17.5" r="1.8" />
  </svg>
);

export const BoltIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M13 2.5 4.5 13.5H12l-1 8 8.5-11H12z" />
  </svg>
);

export const CheckIcon = ({ size = 14, className }: P) => (
  <svg {...base(size)} strokeWidth={2.6} className={className}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);

export const ChevronIcon = ({ size = 14, className }: P) => (
  <svg {...base(size)} strokeWidth={2.2} className={className}>
    <path d="m9 5 7 7-7 7" />
  </svg>
);

export const CloseIcon = ({ size = 14, className }: P) => (
  <svg {...base(size)} strokeWidth={2.2} className={className}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const SunIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
  </svg>
);

export const ListIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M9 6h11M9 12h11M9 18h11" />
    <circle cx="4.5" cy="6" r="1" />
    <circle cx="4.5" cy="12" r="1" />
    <circle cx="4.5" cy="18" r="1" />
  </svg>
);

export const ClockIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

export const MapIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="m3.5 5 5-2 7 2 5-2v16l-5 2-7-2-5 2z" />
    <path d="M8.5 3v16M15.5 5v16" />
  </svg>
);

export function TypeIcon({ type, size = 16 }: { type: ActionType; size?: number }) {
  switch (type) {
    case "ORDER":
      return <BoxIcon size={size} />;
    case "DISCOUNT":
      return <TagIcon size={size} />;
    case "MOVE_TO_FRONT":
      return <EyeIcon size={size} />;
    case "CHECK_DELIVERY":
      return <TruckIcon size={size} />;
    default:
      return <BoltIcon size={size} />;
  }
}

export const SparkleIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 3.5 13.8 9a2 2 0 0 0 1.2 1.2l5.5 1.8-5.5 1.8a2 2 0 0 0-1.2 1.2L12 20.5 10.2 15A2 2 0 0 0 9 13.8L3.5 12 9 10.2A2 2 0 0 0 10.2 9z" />
  </svg>
);

export const BellIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z" />
    <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
  </svg>
);
