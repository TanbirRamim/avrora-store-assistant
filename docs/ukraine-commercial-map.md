# Ukraine commercial network map

The app's **Map** section combines public OpenStreetMap entries for department stores, warehouses and logistics/distribution centres in Ukraine.

## Snapshot

- Data date: 2 November 2026
- Generated: 3 November 2026
- Total locations: 6,211
- Department stores: 883
- Warehouses: 5,320
- Logistics/distribution centres: 8
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

## Files and integration

The static assets live in `frontend/public/network-map/` and are copied into the Next.js static export. The map includes category filters, name/operator/address search, clustering and CSV/GeoJSON downloads.

Embedded consumers can use `window.UkraineCommercialMap` inside the map document or send `postMessage` actions on the `ukraine-commercial-map` channel. Supported actions are `setFilters`, `focusById` and `getSummary`.

## Licence

Map data: © OpenStreetMap contributors, Open Database License (ODbL). Attribution and applicable ODbL obligations must be preserved when the data is redistributed or published.
