# Husky Navigator — Northeastern Campus Navigation (A* & Dijkstra)

An interactive walking-route planner for Northeastern University's Boston campus.
It finds the shortest walking route between any two campus places with **A\*** or **Dijkstra**,
animates the search on the map, and gives you turn-by-turn directions.


## Run it

No build step and no server needed. Just open `index.html` in a browser.

```bash
open index.html                 # macOS
# or serve it locally:
python3 -m http.server 8000     # then visit http://localhost:8000
```

Everything is bundled (Leaflet is under `vendor/` and the map is drawn from the dataset), so the app runs offline.
Only the Inter web font and the optional Satellite / Hybrid / Streets / Topographic maps (Esri, no API key) need the internet.

## Features

| | |
|---|---|
| **Algorithms** | A\*, Dijkstra, or **Compare**, which runs both and shows nodes explored, edges relaxed, heap pushes, compute time and route cost side by side |
| **Search visualisation** | Explored nodes animate on the map (orange = A\*, blue = Dijkstra) with adjustable speed |
| **Accessible routing** | "Avoid stairs" toggle removes every `steps` edge from the graph |
| **Turn-by-turn directions** | Real street names, e.g. *"Bear left and cross Huntington Avenue"*. Hover a step to highlight it, click to zoom |
| **Search boxes** | Fuzzy search with aliases (`khoury` → West Village H, `gym` → Marino, `library` → Snell), full keyboard support |
| **Map** | Campus buildings coloured by category, street labels, labels that hide when they would overlap |
| **Map types** | Layer picker with live thumbnails: **Campus** (custom, offline), **Satellite**, **Hybrid** (satellite + roads & names), **Streets**, **Topographic**. Also a building-highlight opacity slider and a labels on/off switch. Your choice is remembered and can be shared with `&map=satellite` |
| **Explore panel** | Browse 79 places by category, with one-click *From* / *To* buttons |
| **Walkway graph overlay** | Shows the actual nodes and edges the algorithms search (stairs in red) |
| **Shareable links** | Route state lives in the URL, e.g. `index.html#from=snell&to=isec&algo=compare&accessible=1` (add `&animate=0` to skip the animation) |
| **Design** | Light/dark mode, responsive layout for phones, Northeastern red theme |

## The dataset

All data comes from **OpenStreetMap**, not hand-placed points:

- **1,594 walkway nodes, 2,233 walkway edges.** Built from 1,000+ OSM footways, sidewalks, crosswalks, stairs, corridors and streets.
- **79 campus places** in 9 categories, using their real OSM building footprints.
- Each place connects to up to 4 nearby walkway nodes, its **entrances**, so a route can use whichever side of a building is closer.

```
tools/fetch_osm.sh        →  data/raw/*.json        (Overpass API download)
tools/build_dataset.py    →  data/campus-data.js    (graph + places + basemap)
```

To refresh the data from OSM or add a building, edit `PLACES` in `tools/build_dataset.py`, then run:

```bash
./tools/fetch_osm.sh            # optional: re-download the latest OSM data
python3 tools/build_dataset.py
```

How the build works:
1. Each walkable OSM way becomes weighted, undirected edges.
2. Only the largest connected component is kept, so every place is reachable.
3. Unnamed sidewalks and crosswalks take the name of the street they run alongside (used in directions).
4. Chains of degree-2 nodes are merged into single edges. Each merged edge keeps its full geometry, which shrinks the graph by about 63%.

## The algorithms (`js/pathfinding.js`)

Both use the same best-first search over a binary min-heap. Only the priority differs:

| | Priority | Explores |
|---|---|---|
| **Dijkstra** | `f(n) = g(n)` (distance walked so far) | Outward in every direction |
| **A\*** | `f(n) = g(n) + h(n)` (plus straight-line distance to the goal) | Mostly toward the goal |

**Edge cost** = real walked length (haversine along the path geometry) × a walkability factor:

| path / sidewalk / indoor | crosswalk | stairs | small street | arterial road centre line |
|---|---|---|---|---|
| 1.0 | 1.2 | 1.25 | 1.15 | 1.6 |

Every factor is ≥ 1 and the building "entrance" edges run to the building centre.
So the straight-line heuristic `h(n)` **never overestimates** (it is *admissible*), and A\* always returns the optimal route.
Building nodes can only be a start or an end, never a shortcut through a building.

## Tests

```bash
node tools/test_pathfinding.js
```

The test checks **all 12,324 place-to-place routes** (normal + accessible) on the real graph:
- A\* and Dijkstra always return the same cost
- A\* never explores more nodes
- accessible routes never use stairs
- no route cuts through a building
- directions generate for every route

Sample output:

```
Checked 12324 routes (normal + accessible). Longest route: 1227 m
Avg nodes settled — Dijkstra: 586, A*: 141 (76% fewer)
All checks passed ✓
```

## Project structure

```
index.html              App shell
css/styles.css          Styles (light/dark themes, responsive)
js/graph.js             CampusGraph: nodes, edges, costs, heuristic
js/pathfinding.js       MinHeap, Dijkstra, A*
js/directions.js        Path → turn-by-turn instructions
js/app.js               Map, search boxes, animation, results UI
data/campus-data.js     Generated dataset (do not edit by hand)
data/raw/               Raw OpenStreetMap downloads
tools/                  fetch_osm.sh, build_dataset.py, test_pathfinding.js
vendor/leaflet/         Leaflet 1.9.4 (map library)
```

## Credits

Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL).
Satellite imagery and street/topo tiles © Esri, Maxar, Earthstar Geographics, and the GIS User Community. Built with [Leaflet](https://leafletjs.com).
Building descriptions are brief summaries. Check Northeastern's official resources for hours and access.
