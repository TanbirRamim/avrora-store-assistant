# Avrora stores and Ukraine supply infrastructure

The app's **Map** section is restricted to Ukraine. Its retail layer contains only official Avrora stores. Other points are supply infrastructure: warehouses, logistics/distribution centres, food production and processing, beverage production, and grain processing/storage.

## Dataset snapshot

Data cut-off: 3 November 2026.

- 1,935 active stores from Avrora's official store locator, filtered to `country=UA`
- 5,320 warehouse/storage features from the Ukraine OpenStreetMap country extract
- 8 logistics/distribution centres from the same Ukraine extract
- 281 explicitly tagged non-retail food-infrastructure features: 160 food-production/processing sites, 17 beverage-production sites and 104 grain-processing/storage sites
- 17 highlighted Avrora logistics, food-partner, Fine-Eat and assortment-manufacturer nodes located in Ukraine
- 0 non-Avrora retail points

All OpenStreetMap infrastructure was read from the Ukraine extract dated 2 November 2026 and filtered against the Ukrainian national boundary. The Avrora layer accepts only active records whose official country field is `UA`. A previously researched manufacturer in Moldova is deliberately excluded from the map.

## Included and excluded

Included infrastructure tags cover warehouses, logistics/distribution centres, food factories and industrial food processing, beverage production, grain elevators, grain dryers, and grain silos with explicit grain content. General supermarkets, grocery shops, food shops, department stores and wholesale-retail stores are not included.

The highlighted Avrora/partner/manufacturer nodes provide supply-chain context. They do not create inferred shipment routes. Operating status is ordinary lifecycle information, not a confidence or trust rating.

## Main sources

- [Avrora official store locator](https://avrora.ua/magazyny/)
- [Avrora partner portal](https://corporate.avrora.ua/for-partners/)
- [Avrora Partners Day 2025](https://rau.ua/news/partners-day-avrora/)
- [Avrora logistics optimisation interview](https://rau.ua/news/optimizacija-avrora-logistici/)
- [Avrora Lviv distribution-centre announcement](https://corporate.avrora.ua/news/avrora-vidkrila-rozpodilchii-tsentr-u-lvovi)
- [OpenStreetMap](https://www.openstreetmap.org/)

## Files and integration

Static assets live in `frontend/public/network-map/`. Downloadable datasets include `data/network.geojson`, `data/avrora-stores.geojson`, `data/warehouses-logistics.geojson`, `data/food-infrastructure.geojson` and `data/supply-chain.geojson`.

Embedded consumers can use `window.AvroraSupplyMap` inside the map document or send `postMessage` actions on the `avrora-supply-map` channel. Supported actions are `setFilters`, `focusById` and `getSummary`.

## Licence

OpenStreetMap data: © OpenStreetMap contributors, Open Database License (ODbL). Other linked facts remain attributed to their public sources. Preserve attribution and applicable licence obligations when redistributing the datasets.
