"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoJSONSource, Map as MapLibre, MapLayerMouseEvent, Popup } from "maplibre-gl";
import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CloseIcon } from "./icons";

/**
 * Ukraine supply network: official Avrora stores, Avrora distribution centres, partners and
 * manufacturers, and OpenStreetMap warehouses, logistics centres and food-production sites.
 * MapLibre draws everything on the GPU, so 7,500 points and their clusters stay smooth while
 * zooming. Tiles: OpenFreeMap (free, no key).
 */

type Category = "avrora" | "supply" | "warehouse" | "logistics" | "food";

interface Props {
  c: Category;
  id: string;
  n?: string; // name
  a?: string; // address
  o?: string; // operator
  b?: string; // brand
  w?: string; // website
  s?: string; // status, when not active
  r?: string; // role (supply nodes) or kind of site (food)
  t?: string; // opening hours (Avrora stores) or note (supply nodes)
  u?: string; // source link (supply nodes)
  l?: string; // source name (supply nodes)
}

interface Feature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: Props;
}

const STYLE = "https://tiles.openfreemap.org/styles/positron";
const DATA = "/map/locations.min.json";
const WORKER = "/map/maplibre-gl-worker.mjs"; // copied from node_modules by `npm run map-worker`
const STORE: [number, number] = [28.4682, 49.2331]; // Avrora Store #417, Vinnytsia
const UKRAINE: [[number, number], [number, number]] = [[22.1, 44.3], [40.3, 52.4]];

export const CATEGORIES: Record<Category, { one: string; color: string }> = {
  avrora: { one: "Avrora store", color: "#ff9500" },
  supply: { one: "Supply partner", color: "#ff2d55" },
  warehouse: { one: "Warehouse", color: "#5856d6" },
  logistics: { one: "Logistics centre", color: "#0a9396" },
  food: { one: "Food production", color: "#34c759" },
};

const STATUS: Record<string, string> = {
  disused: "Disused",
  abandoned: "Abandoned",
  ruins: "Ruins",
  damaged: "Damaged",
  unclear: "Operating status unclear",
  destroyed_historic: "Destroyed",
};

type Filter = "all" | "avrora" | "supply" | "storage" | "food";
const FILTERS: { id: Filter; label: string; cats: Category[] }[] = [
  { id: "all", label: "All", cats: ["avrora", "supply", "warehouse", "logistics", "food"] },
  { id: "avrora", label: "Avrora", cats: ["avrora"] },
  { id: "supply", label: "Supply", cats: ["supply"] },
  { id: "storage", label: "Storage", cats: ["warehouse", "logistics"] },
  { id: "food", label: "Food", cats: ["food"] },
];
const inFilter = (filter: Filter, c: Category) => FILTERS.find((f) => f.id === filter)!.cats.includes(c);

const fmt = new Intl.NumberFormat("en-US");

/** Kind line above the name: the role for supply nodes and food sites, else the category. */
const kind = (p: Props) => p.r ?? CATEGORIES[p.c].one;

function source(p: Props): { href: string; label: string } | null {
  if (p.c === "avrora") {
    const id = p.id.split("-").pop();
    return { href: `https://avrora.ua/index.php?dispatch=store_locator.view&store_location_id=${id}`, label: "View on avrora.ua" };
  }
  if (p.c === "supply") return p.u ? { href: p.u, label: `Source: ${p.l ?? "public record"}` } : null;
  const [type, osmId] = p.id.split("/");
  return osmId ? { href: `https://www.openstreetmap.org/${type}/${osmId}`, label: "View on OpenStreetMap" } : null;
}

function popupHtml(p: Props) {
  const color = CATEGORIES[p.c].color;
  const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  const link = source(p);
  const rows = [
    p.a && `<div class="nm-row">${esc(p.a)}</div>`,
    (p.o || p.b) && `<div class="nm-row">Operator: ${esc(p.o || p.b!)}</div>`,
    p.t && p.c === "avrora" && `<div class="nm-row">Open ${esc(p.t)}</div>`,
    p.s && `<div class="nm-row nm-status">${STATUS[p.s] ?? esc(p.s)}</div>`,
    p.t && p.c !== "avrora" && `<div class="nm-row nm-note">${esc(p.t)}</div>`,
  ].filter(Boolean);
  return `
    <div class="nm-kind" style="color:${color}"><span class="nm-dot" style="background:${color}"></span>${esc(kind(p))}</div>
    <div class="nm-name">${esc(p.n ?? "No name in OpenStreetMap")}</div>
    ${rows.join("")}
    ${link ? `<a class="nm-link" href="${esc(link.href)}" target="_blank" rel="noopener noreferrer">${esc(link.label)}</a>` : ""}`;
}

/** Keep flight targets clear of the floating card: below it or beside it, whichever leaves more map. */
function cardPadding(el: HTMLElement | null, cardEl: HTMLElement | null) {
  const zero = { top: 0, left: 0, right: 0, bottom: 0 };
  const box = el?.getBoundingClientRect();
  const c = cardEl?.getBoundingClientRect();
  if (!box || !c || !box.width) return zero;
  const below = c.bottom - box.top;
  const beside = c.right - box.left;
  return box.width * (box.height - below) >= (box.width - beside) * box.height
    ? { ...zero, top: Math.min(below, box.height * 0.5) }
    : { ...zero, left: beside };
}

/** Shift a flight target into the middle of the uncovered area (offset doesn't stick, unlike padding). */
function cardOffset(el: HTMLElement | null, cardEl: HTMLElement | null): [number, number] {
  const p = cardPadding(el, cardEl);
  return [p.left / 2, p.top / 2];
}

/** Initial fit: Ukraine in the map area that the card doesn't cover. */
function fitPadding(el: HTMLElement | null, cardEl: HTMLElement | null) {
  const p = cardPadding(el, cardEl);
  return { top: p.top + 16, left: p.left + 16, right: 16, bottom: 16 };
}

export function NetworkMap() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibre | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const popupCat = useRef<Category | null>(null);
  const [features, setFeatures] = useState<Feature[] | null>(null);
  const [ready, setReady] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [failed, setFailed] = useState(false);

  // data
  useEffect(() => {
    let live = true;
    fetch(DATA)
      .then((r) => r.json())
      .then((d: { features: Feature[] }) => live && setFeatures(d.features))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  const total = features?.length ?? 0;

  const visible = useMemo(() => (features ?? []).filter((f) => inFilter(filter, f.properties.c)), [features, filter]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return visible
      .filter((f) => [f.properties.n, f.properties.a, f.properties.o, f.properties.b, f.properties.r].some((v) => v?.toLowerCase().includes(q)))
      .slice(0, 6);
  }, [visible, query]);

  // map
  useEffect(() => {
    let disposed = false;
    (async () => {
      const maplibre = await import("maplibre-gl");
      maplibre.setWorkerUrl(WORKER);
      if (disposed || !container.current) return;
      const map = new maplibre.Map({
        container: container.current,
        style: STYLE,
        bounds: UKRAINE,
        fitBoundsOptions: { padding: fitPadding(container.current, card.current) },
        maxBounds: [[2, 33], [60, 62]],
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
      });
      map.touchZoomRotate.disableRotation();
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), "bottom-right");
      // compact attribution starts expanded; keep it as the small (i) button like Apple Maps' "Legal"
      // MapLibre re-expands it whenever sources change, so collapse it until the user opens it themselves.
      let attribOpened = false;
      container.current.querySelector(".maplibregl-ctrl-attrib-button")?.addEventListener("click", () => (attribOpened = true));
      map.on("data", () => {
        if (!attribOpened) container.current?.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
      });
      mapRef.current = map;

      const el = document.createElement("div");
      el.className = "nm-store";
      el.setAttribute("aria-label", "Avrora Store #417, Vinnytsia");
      el.innerHTML = `<img src="/avrora-mark.svg" alt="" width="28" height="28">`;
      new maplibre.Marker({ element: el }).setLngLat(STORE).addTo(map);

      popupRef.current = new maplibre.Popup({ closeButton: false, maxWidth: "280px", offset: 10, className: "nm-popup" });

      map.on("error", (e) => console.warn("map:", e.error?.message));
      map.on("load", () => {
        map.addSource("places", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
          cluster: true,
          clusterRadius: 44,
          clusterMaxZoom: 13,
          promoteId: "id",
        });
        // supply partners are few and the reason to open the map, so they are never folded into clusters
        map.addSource("key", { type: "geojson", data: { type: "FeatureCollection", features: [] }, promoteId: "id" });
        map.addLayer({
          id: "clusters",
          type: "circle",
          source: "places",
          filter: ["has", "point_count"],
          paint: {
            "circle-color": "rgba(28,28,30,0.86)",
            "circle-radius": ["step", ["get", "point_count"], 13, 25, 16, 150, 19, 600, 23],
            "circle-stroke-width": 1.5,
            "circle-stroke-color": "#ffffff",
            "circle-radius-transition": { duration: 300 },
          },
        });
        map.addLayer({
          id: "cluster-count",
          type: "symbol",
          source: "places",
          filter: ["has", "point_count"],
          layout: {
            "text-field": ["get", "point_count_abbreviated"],
            "text-font": ["Noto Sans Bold"],
            "text-size": ["step", ["get", "point_count"], 11, 150, 12],
            "text-allow-overlap": true,
          },
          paint: { "text-color": "#ffffff" },
        });
        map.addLayer({
          id: "points",
          type: "circle",
          source: "places",
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-color": [
              "match",
              ["get", "c"],
              "avrora",
              CATEGORIES.avrora.color,
              "logistics",
              CATEGORIES.logistics.color,
              "food",
              CATEGORIES.food.color,
              CATEGORIES.warehouse.color,
            ],
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 4, 12, 6, 16, 8],
            "circle-stroke-width": 1.5,
            "circle-stroke-color": "#ffffff",
            "circle-opacity": ["case", ["has", "s"], 0.45, 1],
            "circle-stroke-opacity": ["case", ["has", "s"], 0.45, 1],
          },
        });
        map.addLayer({
          id: "key-points",
          type: "circle",
          source: "key",
          paint: {
            "circle-color": CATEGORIES.supply.color,
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 5.5, 12, 8, 16, 10],
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
            "circle-opacity": ["case", ["has", "s"], 0.6, 1],
          },
        });

        map.on("click", "clusters", async (e: MapLayerMouseEvent) => {
          const f = e.features?.[0];
          if (!f) return;
          const zoom = await (map.getSource("places") as GeoJSONSource).getClusterExpansionZoom(f.properties.cluster_id);
          map.easeTo({ center: (f.geometry as unknown as { coordinates: [number, number] }).coordinates, zoom: zoom + 0.3, duration: 600 });
        });
        const open = (e: MapLayerMouseEvent) => {
          const f = e.features?.[0];
          if (!f) return;
          const coords = (f.geometry as unknown as { coordinates: [number, number] }).coordinates;
          popupCat.current = (f.properties as Props).c;
          popupRef.current?.setLngLat(coords).setHTML(popupHtml(f.properties as Props)).addTo(map);
        };
        map.on("click", "points", (e: MapLayerMouseEvent) => {
          // a supply partner drawn on top of a point wins the click
          if (!map.queryRenderedFeatures(e.point, { layers: ["key-points"] }).length) open(e);
        });
        map.on("click", "key-points", open);
        for (const layer of ["clusters", "points", "key-points"]) {
          map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
          map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
        }
        setReady(true);
      });
    })();
    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // keep the source in step with the filter
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const key = (f: Feature) => f.properties.c === "supply";
    (map.getSource("places") as GeoJSONSource).setData({ type: "FeatureCollection", features: visible.filter((f) => !key(f)) });
    (map.getSource("key") as GeoJSONSource).setData({ type: "FeatureCollection", features: visible.filter(key) });
    // close the popup only if its place has just been filtered out
    if (popupCat.current && !inFilter(filter, popupCat.current)) popupRef.current?.remove();
  }, [ready, visible, filter]);

  const focus = (f: Feature) => {
    const map = mapRef.current;
    if (!map) return;
    setQuery("");
    // wait a frame so the card has collapsed its results list before measuring it
    requestAnimationFrame(() => {
      map.flyTo({ center: f.geometry.coordinates, zoom: 15, duration: 1400, essential: true, offset: cardOffset(container.current, card.current) });
      // open right away: the popup is anchored to the coordinates, so it rides along with the flight
      popupCat.current = f.properties.c;
      popupRef.current?.setLngLat(f.geometry.coordinates).setHTML(popupHtml(f.properties)).addTo(map);
    });
  };

  const toStore = () => mapRef.current?.flyTo({ center: STORE, zoom: 11, duration: 1400, essential: true, offset: cardOffset(container.current, card.current) });

  return (
    <div className="relative h-full w-full bg-[#f2efe9]">
      <div className="absolute inset-0">
        <div ref={container} className="h-full w-full" aria-label="Map of the Ukraine supply network" role="region" />
      </div>

      <motion.div
        ref={card}
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 34 }}
        className="absolute left-3 right-3 top-3 z-10 rounded-[14px] bg-[rgba(255,255,255,0.92)] p-3 shadow-[0_8px_30px_rgba(0,0,0,0.12),0_0_0_0.5px_rgba(0,0,0,0.06)] backdrop-blur-xl md:left-4 md:right-auto md:top-4 md:w-[380px]"
      >
        <h1 className="t-headline px-1">Supply network</h1>
        <p className="t-footnote px-1 text-label-2">
          {features ? `${fmt.format(total)} places in Ukraine from Avrora and OpenStreetMap` : failed ? "The map data could not be loaded." : "Loading places…"}
        </p>

        <div role="tablist" aria-label="Show on map" className="mt-3 flex rounded-[9px] bg-fill p-[2px]">
          {FILTERS.map(({ id: f, label, cats }) => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className="t-caption relative flex flex-1 items-center justify-center gap-1 rounded-[7px] px-1 py-[5px] font-medium"
            >
              {filter === f && (
                <motion.span
                  layoutId="map-seg"
                  className="absolute inset-0 rounded-[7px] bg-white shadow-[0_3px_8px_rgba(0,0,0,0.12),0_3px_1px_rgba(0,0,0,0.04)]"
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                />
              )}
              {f !== "all" && <span className="relative size-2 rounded-full" style={{ background: CATEGORIES[cats[0]].color }} />}
              <span className="relative">{label}</span>
            </button>
          ))}
        </div>
        <p className="t-caption num mt-1.5 px-1 text-label-2" aria-live="polite">
          {features && `${fmt.format(visible.length)} shown`}
        </p>

        <div className="relative mt-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search store, address or partner"
            aria-label="Search places"
            className="t-subhead w-full rounded-[10px] bg-fill px-3 py-[7px] outline-none placeholder:text-label-2"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 grid size-[18px] -translate-y-1/2 place-items-center rounded-full bg-[#8e8e93] text-white"
            >
              <CloseIcon size={9} />
            </button>
          )}
        </div>
        {query.trim().length >= 2 && (
          <ul className="mt-2 overflow-hidden rounded-[10px] bg-white" aria-label="Search results">
            {results.length === 0 && <li className="t-subhead px-3 py-2.5 text-label-2">No places match.</li>}
            {results.map((f) => (
              <li key={f.properties.id} className="cell [--inset:12px]">
                <button onClick={() => focus(f)} className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-fill">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: CATEGORIES[f.properties.c].color }} />
                  <span className="min-w-0">
                    <span className="t-subhead block truncate">{f.properties.n ?? kind(f.properties)}</span>
                    <span className="t-caption block truncate text-label-2">{f.properties.a ?? kind(f.properties)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </motion.div>

      <button
        onClick={toStore}
        className="t-subhead absolute bottom-[44px] right-[10px] md:bottom-[124px] z-10 flex items-center gap-1.5 rounded-full bg-[rgba(255,255,255,0.9)] py-1.5 pl-1.5 pr-3 font-medium shadow-[0_4px_14px_rgba(0,0,0,0.14),0_0_0_0.5px_rgba(0,0,0,0.06)] backdrop-blur-xl"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- static export, SVG mark */}
        <img src="/avrora-mark.svg" alt="" width={24} height={24} className="size-6" />
        Your store
      </button>
    </div>
  );
}
