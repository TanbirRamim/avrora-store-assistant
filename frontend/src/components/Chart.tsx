"use client";

import { motion } from "motion/react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { shortDate } from "@/lib/format";

export interface Datum {
  date: string;
  value: number | null;
  projected?: boolean;
}

interface Props {
  title: string;
  unit: string;
  data: Datum[];
  kind: "bars" | "line";
  color: string;
  /** Optional horizontal reference, e.g. a reorder threshold */
  reference?: { value: number; label: string };
  height?: number;
}

const PAD = { top: 12, right: 12, bottom: 22, left: 34 };

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

/** One measure, one axis. Bars or a line, with a hover crosshair and tooltip. */
export function Chart({ title, unit, data, kind, color, reference, height = 150 }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(360);
  const [hover, setHover] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { x, y, max, step, ticks } = useMemo(() => {
    const vals = data.map((d) => d.value ?? 0).concat(reference ? [reference.value] : []);
    const max = niceMax(Math.max(...vals) * 1.1);
    const innerW = width - PAD.left - PAD.right;
    const step = innerW / data.length;
    const x = (i: number) => PAD.left + step * (i + 0.5);
    const y = (v: number) => PAD.top + (height - PAD.top - PAD.bottom) * (1 - v / max);
    return { x, y, max, step, ticks: [0, max / 2, max] };
  }, [data, width, height, reference]);

  const actual = data.map((d, i) => ({ ...d, i })).filter((d) => d.value !== null && !d.projected);
  const projected = data.map((d, i) => ({ ...d, i })).filter((d) => d.value !== null && d.projected);
  const linePath = (pts: { i: number; value: number | null }[]) =>
    pts.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)} ${y(p.value as number).toFixed(1)}`).join(" ");

  const firstProjected = projected[0]?.i;
  const h = hover !== null ? data[hover] : null;
  const labelEvery = Math.ceil(data.length / 5);

  return (
    <figure>
      <figcaption className="mb-1 flex items-baseline justify-between text-[13px]">
        <span className="font-semibold text-label">{title}</span>
        <span className="num text-label-2" aria-live="polite">
          {h && h.value !== null
            ? `${shortDate(h.date)} · ${Math.round(h.value * 10) / 10} ${unit}${h.projected ? " expected" : ""}`
            : unit}
        </span>
      </figcaption>
      <div ref={wrap} className="relative">
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${title}, last ${actual.length} days`}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const i = Math.floor((e.clientX - r.left - PAD.left) / step);
            setHover(i >= 0 && i < data.length ? i : null);
          }}
          className="block touch-none select-none"
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" />
              <text x={PAD.left - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--label-2)" className="num">
                {Math.round(t)}
              </text>
            </g>
          ))}
          {firstProjected !== undefined && (
            <rect
              x={x(firstProjected) - step / 2}
              y={PAD.top}
              width={width - PAD.right - (x(firstProjected) - step / 2)}
              height={height - PAD.top - PAD.bottom}
              fill="var(--fill)"
              opacity={0.5}
            />
          )}
          {reference && (
            <g>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y(reference.value)}
                y2={y(reference.value)}
                stroke="var(--label-2)"
                strokeDasharray="3 3"
              />
              <text x={width - PAD.right} y={y(reference.value) - 4} textAnchor="end" fontSize={11} fill="var(--label-2)">
                {reference.label}
              </text>
            </g>
          )}

          {kind === "bars" &&
            actual.map((d) => {
              const bw = Math.max(2, step - 2);
              const top = y(d.value as number);
              const base = y(0);
              return (
                <motion.rect
                  key={d.date}
                  x={x(d.i) - bw / 2}
                  width={bw}
                  rx={Math.min(3, bw / 2)}
                  initial={{ y: base, height: 0 }}
                  animate={{ y: top, height: Math.max(0, base - top) }}
                  transition={{ type: "spring", stiffness: 260, damping: 30, delay: d.i * 0.008 }}
                  fill={color}
                  opacity={hover === null || hover === d.i ? 1 : 0.45}
                />
              );
            })}

          {kind === "line" && actual.length > 1 && (
            <motion.path
              d={linePath(actual)}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeLinejoin="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            />
          )}

          {projected.length > 0 && (
            <path
              d={linePath(actual.length && kind === "line" ? [actual[actual.length - 1], ...projected] : projected)}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeDasharray="4 4"
            />
          )}

          {data.map((d, i) =>
            i % labelEvery === 0 ? (
              <text key={d.date} x={x(i)} y={height - 6} textAnchor="middle" fontSize={11} fill="var(--label-2)">
                {shortDate(d.date)}
              </text>
            ) : null,
          )}

          {h && h.value !== null && (
            <g pointerEvents="none">
              <line
                x1={x(hover!)}
                x2={x(hover!)}
                y1={PAD.top}
                y2={height - PAD.bottom}
                stroke="var(--label-3)"
                strokeWidth={1}
              />
              <circle cx={x(hover!)} cy={y(h.value)} r={4.5} fill={color} stroke="var(--surface)" strokeWidth={2} />
            </g>
          )}
        </svg>
      </div>
      <span className="sr-only">Maximum shown {max} {unit}.</span>
    </figure>
  );
}
