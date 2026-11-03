# Avrora stores and Ukraine supply network map

The app's **Map** section is restricted to Ukraine. Its only retail layer is the official Avrora store list; no other supermarket, grocery or department-store chains are shown. Everything else is supply infrastructure.

| Layer | Filter | Points | Source |
| --- | --- | --- | --- |
| Avrora stores | Avrora | 1,935 | Official Avrora store locator, `country=UA`, active stores only |
| Avrora logistics, partners and manufacturers | Supply | 17 | Public company and press sources, cited per point |
| Warehouses | Storage | 5,320 | OpenStreetMap (snapshot below) |
| Logistics/distribution centres | Storage | 8 | OpenStreetMap (snapshot below) |
| Food production, beverage and grain sites | Food | 281 | OpenStreetMap, same extract |
| **Total** | All | **7,561** | |

The 883 OpenStreetMap department stores in the full export are other retailers and are left out of the map.

## Avrora stores

- Data cut-off: 3 November 2026
- File: `avrora-stores.geojson`
- Source: [Avrora store locator](https://avrora.ua/magazyny/). Each point keeps its store-locator id, address, city and opening hours; the popup links back to the store's page on avrora.ua.
- Spot check: five randomly chosen stores were compared with their avrora.ua pages; address and coordinates matched for all five.

"Avrora #3371" is the store-locator id, which is not necessarily the number on the shop front. The app's own Avrora Store #417 in Vinnytsia is fictional demo data and is unrelated to locator id 417.

## Supply partners

`supply-chain.geojson` and `supply-chain.csv` hold 17 hand-researched points, each with a public source link:

- 4 Avrora logistics sites: distribution centres in Poltava (damaged 22 August 2026), Vinnytsia and Lviv (M10 industrial park), and the Boryspil import warehouse (status unclear)
- 1 former Avrora distribution centre in Stoianka, destroyed on 31 August 2026
- 4 food partners recognised at Avrora Partners Day 2025
- 1 Fine-Eat private-label manufacturer, identified from a product label
- 7 factories of brands in Avrora's assortment (Roshen, MacCoffee)

`location_precision` records how exact each point is: some are a street address, others only a registered office, a district or a settlement. The points give supply-chain context; they do not imply shipment routes, and no factory is assigned to specific products. A manufacturer in Moldova was researched and deliberately left out.

Main sources: [Avrora partner portal](https://corporate.avrora.ua/for-partners/), [Avrora Partners Day 2025](https://rau.ua/news/partners-day-avrora/), [Avrora logistics interview](https://rau.ua/news/optimizacija-avrora-logistici/), [Avrora Lviv distribution-centre announcement](https://corporate.avrora.ua/news/avrora-vidkrila-rozpodilchii-tsentr-u-lvovi), [Roshen factories](https://www.roshen.com/ua/ua/kontakty/fabryky).

## Food infrastructure

`food-infrastructure.geojson` has 281 non-retail OpenStreetMap features from the same Ukraine extract: 160 food production/processing sites (including bakeries, slaughterhouses and dairies), 17 beverage producers and 104 grain processing/storage sites (grain dryers, elevators, mills, oil mills and silos tagged with grain content). Shops are excluded.

## OpenStreetMap snapshot

- Data date: 2 November 2026
- Generated: 3 November 2026
- Total locations: 6,211
- Department stores: 883 (in the export, not on the map)
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

- Locations are clustered on the GPU by MapLibre. The 17 supply partners are drawn as larger pins in their own layer and are never clustered.
- Filter: All, Avrora, Supply, Storage (warehouses and logistics centres), Food.
- Search by name, address, operator or role.
- Clicking a location opens a popup with its details and a link to its source: the avrora.ua store page, the cited article for supply partners, or OpenStreetMap.
- A separate pin marks Avrora Store #417 in Vinnytsia; the "Your store" button centres the map on it.

## Data files

All files are in `frontend/public/map/`:

- `ukraine-locations.geojson` and `ukraine-locations.csv`: the full OpenStreetMap export, served as static files (for example `/map/ukraine-locations.csv`).
- `summary.json`: counts, source file, checksum and matched tags of the OpenStreetMap export.
- `avrora-stores.geojson`: official Avrora stores.
- `supply-chain.geojson` and `supply-chain.csv`: Avrora logistics, partners and manufacturers with sources.
- `food-infrastructure.geojson`: OpenStreetMap food, beverage and grain sites.
- `locations.min.json`: the compact file the map loads.

`locations.min.json` is generated from these files by `scripts/slim_map_data.py`. The script skips department stores, keeps only the fields the map uses, shortens category names, rounds coordinates to 5 decimals, translates store opening hours to English and drops placeholder names. The export puts German category labels such as "Lagerhalle" on unnamed places; these are removed, so only real names remain. To regenerate after updating the export, run from the repository root:

```bash
python3 scripts/slim_map_data.py
```

The MapLibre web worker (`maplibre-gl-worker.mjs`) is copied from `node_modules` into `frontend/public/map/` by `npm run map-worker`. This runs automatically before `npm run dev` and `npm run build`. The copied file is gitignored.

## Licence and attribution

OpenStreetMap data (warehouses, logistics centres, food infrastructure): © OpenStreetMap contributors, Open Database License (ODbL). Attribution and applicable ODbL obligations must be preserved when the data is redistributed or published.

Avrora store locations come from Avrora's public store locator and the supply-partner facts from the linked public sources; they remain attributed to those sources and are not covered by the ODbL.

Base map tiles: OpenFreeMap, using the OpenMapTiles schema (© OpenMapTiles), built from OpenStreetMap data. The attribution is shown on the map.
