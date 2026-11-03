# Ukraine commercial network map

The app's **Map** section shows public OpenStreetMap entries for department stores, warehouses and logistics/distribution centres in Ukraine.

## Snapshot

- Data date: 2 November 2026
- Generated: 3 November 2026
- Total locations: 6,211
- Department stores: 883
- Warehouses: 5,320
- Logistics/distribution centres: 8
- Locations with a real name: 1,103
- Source: OpenStreetMap / Geofabrik Ukraine country extract
- Source SHA-256: `5b3e09c08ee819aa0b9047179c510aaab027eb477e3b2370e3ceba13d195fe35`

## Included tags

- `shop=department_store`
- `building=warehouse`
- `building:use=warehouse`
- `industrial=warehouse`
- `industrial=logistics`
- `industrial=distribution`

Point features retain their coordinates. Areas use an interior representative point. Duplicate matches are removed, entries outside the Ukraine boundary are excluded, and explicitly military or sensitive-tagged features are excluded. This is a reproducible open-data snapshot, not a guarantee of completeness, current operation or commercial availability.

## Implementation

The map is a React component, `frontend/src/components/NetworkMap.tsx`, built on MapLibre GL 6. Base tiles are OpenFreeMap "positron" vector tiles, which need no API key.

- Locations are clustered on the GPU by MapLibre.
- Category filter: Stores, Warehouses, Logistics.
- Search by name, address or operator.
- Clicking a location opens a popup with its details and a "View on OpenStreetMap" link.
- A separate pin marks Avrora Store #417 in Vinnytsia; the "Your store" button centres the map on it.

## Data files

All files are in `frontend/public/map/`:

- `ukraine-locations.geojson` and `ukraine-locations.csv`: the full export, served as static files (for example `/map/ukraine-locations.csv`).
- `summary.json`: counts, source file, checksum and matched tags.
- `locations.min.json`: the compact file the map loads.

`locations.min.json` is generated from the GeoJSON export by `scripts/slim_map_data.py`. The script keeps only the fields the map uses, shortens category names, rounds coordinates to 5 decimals and drops placeholder names. The export puts German category labels such as "Lagerhalle" on unnamed places; these are removed, so only real names remain. To regenerate after updating the export, run from the repository root:

```bash
python3 scripts/slim_map_data.py
```

The MapLibre web worker (`maplibre-gl-worker.mjs`) is copied from `node_modules` into `frontend/public/map/` by `npm run map-worker`. This runs automatically before `npm run dev` and `npm run build`. The copied file is gitignored.

## Licence and attribution

Map data: © OpenStreetMap contributors, Open Database License (ODbL). Attribution and applicable ODbL obligations must be preserved when the data is redistributed or published.

Base map tiles: OpenFreeMap, using the OpenMapTiles schema (© OpenMapTiles), built from OpenStreetMap data. The attribution is shown on the map.
