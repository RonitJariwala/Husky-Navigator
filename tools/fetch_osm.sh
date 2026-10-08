#!/usr/bin/env bash
# Downloads the raw Northeastern (Boston) campus data from OpenStreetMap via the Overpass API.
# Output goes to data/raw/. Afterwards run:  python3 tools/build_dataset.py
set -euo pipefail
cd "$(dirname "$0")/../data/raw"

BBOX='42.3345,-71.0945,42.3435,-71.0835'   # south,west,north,east around the campus
UA='NortheasternCampusNavigator/1.0 (student project)'
MIRRORS=(https://overpass-api.de/api/interpreter https://overpass.private.coffee/api/interpreter)

fetch() {  # fetch <query> <outfile>
  for attempt in 1 2 3 4 5; do
    for url in "${MIRRORS[@]}"; do
      if curl -sf -m 90 -A "$UA" --data-urlencode "data=$1" "$url" -o "$2.tmp" \
         && python3 -c "import json,sys; json.load(open(sys.argv[1]))['elements']" "$2.tmp" 2>/dev/null; then
        mv "$2.tmp" "$2"; echo "✓ $2"; return 0
      fi
      echo "  $url busy, retrying…"; sleep 8
    done
  done
  echo "✗ failed to fetch $2" >&2; return 1
}

fetch "[out:json][timeout:60];way[\"highway\"~\"^(footway|pedestrian|path|steps|living_street|residential|tertiary|secondary|primary|service|unclassified|corridor|cycleway)$\"]($BBOX);out tags geom;" ways.json
fetch "[out:json][timeout:60];way[\"building\"][\"name\"]($BBOX);out tags geom;" bldg.json
fetch "[out:json][timeout:60];(node[\"railway\"~\"station|tram_stop|halt\"][\"name\"](42.3345,-71.0950,42.3435,-71.0820);nwr[\"leisure\"][\"name\"]($BBOX);nwr[\"name\"~\"Krentzman|Centennial|Quad\"]($BBOX););out center tags geom;" poi.json
fetch "[out:json][timeout:60];way[\"railway\"~\"^(rail|subway|light_rail|tram)$\"]($BBOX);out tags geom;" rail.json
rm -f ./*.tmp
