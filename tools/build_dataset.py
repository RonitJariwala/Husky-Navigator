#!/usr/bin/env python3
"""
Builds the Northeastern campus routing dataset from raw OpenStreetMap data.

    data/raw/{ways,bldg,poi}.json  ->  data/campus-data.js

Steps
  1. Turn every walkable OSM way into weighted, undirected edges (nodes keyed by coordinate).
  2. Keep the largest connected component so every place is reachable.
  3. Attach each campus place to up to 4 nearby walkway nodes ("entrances").
  4. Contract chains of degree-2 nodes into single edges that keep their full geometry.
  5. Write a compact JS file the browser can load straight from disk (no server needed).
"""
import json
import math
import os
from collections import defaultdict

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
RAW = os.path.join(ROOT, "data", "raw")
OUT = os.path.join(ROOT, "data", "campus-data.js")

LAT0 = 42.3390  # local projection origin (campus centre)
M_PER_DEG_LAT = 111_320.0
M_PER_DEG_LON = 111_320.0 * math.cos(math.radians(LAT0))

ENTRANCE_RADIUS_M = 25      # walkway nodes this close to a footprint count as entrances
ENTRANCE_SEPARATION_M = 35  # entrances of one building must be at least this far apart
MAX_ENTRANCES = 4

# ---------------------------------------------------------------------------
# Curated campus places. key = OSM name (or None for a manual point).
# (id, display name, OSM name, category, aliases, description, manual lat/lon)
# ---------------------------------------------------------------------------
PLACES = [
    # Academic
    ("ell", "Ell Hall", "Ell Hall", "academic", ["ell"], "Administrative offices; home of Blackman Auditorium.", None),
    ("richards", "Richards Hall", "Richards Hall", "academic", [], "Classrooms and faculty offices on Huntington Ave.", None),
    ("dodge", "Dodge Hall", "Dodge Hall", "academic", ["damore mckim", "business"], "D'Amore-McKim School of Business.", None),
    ("hayden", "Hayden Hall", "Hayden Hall", "academic", [], "Classrooms and offices.", None),
    ("churchill", "Churchill Hall", "Churchill Hall", "academic", [], "Classrooms and offices.", None),
    ("forsyth", "Forsyth Building", "Forsyth Building", "academic", [], "Classrooms and labs on Forsyth St.", None),
    ("shillman", "Shillman Hall", "Shillman Hall", "academic", [], "Large lecture halls and classrooms.", None),
    ("snell-eng", "Snell Engineering Center", "Snell Engineering Center", "academic", ["sec", "engineering"], "College of Engineering classrooms and labs.", None),
    ("mugar", "Mugar Life Sciences", "Mugar Life Sciences Building", "academic", ["mugar", "life sciences"], "Life sciences classrooms and labs.", None),
    ("hurtig", "Hurtig Hall", "Hurtig Hall", "academic", ["chemistry"], "Science labs and classrooms.", None),
    ("robinson", "Robinson Hall", "Robinson Hall", "academic", [], "Science labs and offices.", None),
    ("meserve", "Meserve Hall", "Meserve Hall", "academic", [], "Social sciences and humanities offices.", None),
    ("holmes", "Holmes Hall", "Holmes Hall", "academic", [], "Humanities departments.", None),
    ("lake", "Lake Hall", "Lake Hall", "academic", [], "Faculty offices and classrooms.", None),
    ("nightingale", "Nightingale Hall", "Nightingale Hall", "academic", [], "Faculty offices and classrooms.", None),
    ("ryder", "Ryder Hall", "Ryder Hall", "academic", [], "Classrooms and lecture halls on Leon St.", None),
    ("behrakis", "Behrakis Health Sciences Center", "Behrakis Health Sciences Center", "academic", ["bouve", "health"], "Bouvé College of Health Sciences.", None),
    ("kariotis", "Kariotis Hall", "Kariotis Hall", "academic", [], "Classrooms.", None),
    ("knowles", "Knowles Center", "Knowles Center", "academic", ["law"], "School of Law.", None),
    ("cargill", "Cargill Hall", "Cargill Hall", "academic", ["law"], "School of Law.", None),
    ("dockser", "Dockser Hall (Law)", "Northeastern University School of Law-Dockser Hall -Nulawlab", "academic", ["law", "nulawlab"], "School of Law; NuLawLab.", None),
    ("stearns", "Stearns Center", "Stearns Center", "academic", [], "Classrooms.", None),
    ("wvh", "West Village H", "West Village H", "academic", ["khoury", "computer science", "wvh", "cs"], "Khoury College of Computer Sciences.", None),
    ("cushing", "Cushing Hall", "Cushing Hall", "academic", [], "Academic building on Hemenway St.", None),
    ("cahners", "Cahners Hall", "Cahners Hall", "academic", [], "Academic building on Hemenway St.", None),
    # Research
    ("isec", "ISEC", "Interdisciplinary Science & Engineering Complex", "research", ["interdisciplinary science", "isec"], "Interdisciplinary Science & Engineering Complex; reached by the ISEC pedestrian bridge.", None),
    ("exp", "EXP", "Northeastern EXP", "research", ["exp"], "Science and engineering research building next to ISEC.", None),
    ("egan", "Egan Research Center", "Maureen and Richard J. Egan Engineering and Science Research Center", "research", ["egan"], "Engineering and science research labs.", None),
    ("dana", "Dana Research Center", "Dana Research Center", "research", [], "Engineering research labs.", None),
    # Library
    ("snell", "Snell Library", "Snell Library", "library", ["library"], "Main library — study spaces, Digital Media Commons, open late.", None),
    # Student life
    ("curry", "Curry Student Center", "Curry Student Center", "student", ["csc", "afterhours", "food court", "dining"], "Student center: food court, Afterhours, student organizations.", None),
    ("blackman", "Blackman Auditorium", "Blackman Auditorium", "student", ["auditorium"], "Performances, lectures and events (inside Ell Hall).", None),
    ("raytheon", "Raytheon Amphitheater", "Raytheon Amphitheater", "student", ["amphitheater"], "Lecture hall and events space.", None),
    ("latinx", "Latinx Student Cultural Center", "Latinx Student Cultural Center", "student", ["lsc"], "Cultural center and community space.", None),
    ("aac", "Asian American Center", "Asian-American Center", "student", [], "Cultural center and community space.", None),
    ("obryant", "John D. O'Bryant Institute", None, "student", ["african american institute", "obryant"], "African American Institute.", (42.33747, -71.09117)),
    ("hillel", "Northeastern Hillel", "Northeastern University Hillel", "student", [], "Jewish student life.", None),
    ("catholic", "Catholic Center", "Catholic Center at Northeastern University", "student", [], "Catholic campus ministry.", None),
    ("fenway-center", "Fenway Center", "Fenway Center", "student", [], "Event venue on St. Stephen St.", None),
    # Athletics
    ("marino", "Marino Recreation Center", "Roger M. and Michelle S. Marino Recreation Center", "athletics", ["gym", "marino", "fitness"], "Fitness center — weights, cardio, courts.", None),
    ("cabot", "Cabot Center", "Cabot Physical Education Center", "athletics", ["cabot cage", "athletics"], "Athletics department and Cabot Cage.", None),
    ("barletta", "Barletta Natatorium", "Barletta Natatorium", "athletics", ["pool", "swimming"], "Swimming pool.", None),
    ("squash", "SquashBusters", "Badger & Rosen SquashBusters Center", "athletics", ["squash", "gym"], "Squash courts and fitness.", None),
    ("matthews", "Matthews Arena", None, "athletics", ["hockey", "arena"], "Historic arena on St. Botolph St.", (42.34177, -71.08447)),
    # Residential
    ("speare", "Speare Hall", "Speare Hall", "residential", ["speare"], "First-year residence hall; dining hall.", None),
    ("stetson-e", "Stetson East", "Stetson East", "residential", ["stetson"], "First-year residence hall.", None),
    ("stetson-w", "Stetson West", "Stetson West", "residential", ["stetson"], "First-year residence hall.", None),
    ("ev", "East Village", "East Village Residence Hall", "residential", ["ev"], "Upper-class residence hall on St. Botolph St.", None),
    ("iv", "International Village", "International Village", "residential", ["iv", "dining"], "Residence hall and dining hall on Tremont St.", None),
    ("wva", "West Village A", None, "residential", ["wva"], "Residence hall.", (42.33734, -71.09313)),
    ("wvb", "West Village B", "West Village B", "residential", ["wvb"], "Residence hall.", None),
    ("wvc", "West Village C", "West Village C", "residential", ["wvc"], "Residence hall.", None),
    ("wve", "West Village E", "West Village E", "residential", ["wve"], "Residence hall.", None),
    ("wvf", "West Village F", "West Village F", "residential", ["wvf"], "Residence hall.", None),
    ("wvg", "West Village G", "West Villlage G", "residential", ["wvg"], "Residence hall.", None),
    ("willis", "Willis Hall", "Willis Hall", "residential", [], "Residence hall.", None),
    ("burstein", "Burstein Hall", "Burstein Hall", "residential", [], "Residence hall.", None),
    ("rubenstein", "Rubenstein Hall", None, "residential", [], "Residence hall.", (42.33838, -71.09332)),
    ("davenport-a", "Davenport Commons A", "Davenport Commons A", "residential", ["davenport"], "Residence hall on Columbus Ave.", None),
    ("davenport-b", "Davenport Commons B", "Davenport Commons B", "residential", ["davenport"], "Residence hall on Columbus Ave.", None),
    ("smith", "Smith Hall", "Smith Hall", "residential", [], "Residence hall on Hemenway St.", None),
    ("kerr", "Kerr Hall", "Kerr Hall", "residential", [], "Residence hall on the Fenway.", None),
    ("melvin", "Melvin Hall", "Melvin Hall", "residential", [], "Residence hall on the Fenway.", None),
    ("kennedy", "Kennedy Hall", None, "residential", [], "Residence hall on Hemenway St.", (42.34287, -71.09048)),
    ("light", "Light Hall", "Light Hall", "residential", [], "Residence hall on St. Stephen St.", None),
    ("levine", "Levine Hall", "Levine Hall and Saint Stephen Street Complex", "residential", [], "Residence hall on St. Stephen St.", None),
    ("337-hunt", "337 Huntington Ave", "337 Huntington Avenue", "residential", [], "Residence hall.", None),
    ("319-hunt", "319 Huntington Ave", "319 Huntington Ave", "residential", [], "Northeastern building on Huntington Ave.", None),
    # Transit
    ("ruggles", "Ruggles Station", "Ruggles", "transit", ["orange line", "commuter rail", "mbta", "t"], "MBTA Orange Line, Commuter Rail and buses.", None),
    ("t-neu", "Northeastern T Stop", "Northeastern", "transit", ["green line", "e line", "mbta", "t"], "MBTA Green Line (E branch) on Huntington Ave.", None),
    ("t-symphony", "Symphony Station", "Symphony", "transit", ["green line", "mbta", "t"], "MBTA Green Line (E branch).", None),
    # Parking
    ("columbus-garage", "Columbus Parking Garage", "Columbus Parking Garage", "parking", ["parking", "garage"], "Visitor and permit parking.", None),
    ("gainsborough-garage", "Gainsborough Garage", "Gainsborough Parking Garage", "parking", ["parking", "garage"], "Permit parking.", None),
    ("renaissance-garage", "Renaissance Garage", "Rennaissance Parking Garage", "parking", ["parking", "garage"], "Permit and visitor parking off Tremont St.", None),
    ("wv-garage", "West Village Garage", "West Village Parking Garage", "parking", ["parking", "garage"], "Permit parking.", None),
    # Open spaces
    ("centennial", "Centennial Common", "Centennial Common", "outdoor", ["quad", "lawn"], "The central campus lawn.", None),
    ("krentzman", "Krentzman Quad", "Krentzman Quadrangle", "outdoor", ["quad"], "Quad off Huntington Ave.", None),
    ("science-quad", "Science Quad", "Science Quad", "outdoor", ["quad"], "Quad between the science buildings.", None),
    ("wv-quad", "West Village Quad", "West Village Quadrangle", "outdoor", ["quad"], "Courtyard in West Village.", None),
]

# Edge kinds and how walkable they are. Factor >= 1 keeps the A* straight-line heuristic admissible.
KINDS = ["path", "sidewalk", "crossing", "steps", "indoor", "street", "road", "entrance"]


def classify(tags):
    hw = tags.get("highway")
    if tags.get("foot") in ("no",) or (tags.get("access") == "no" and tags.get("foot") not in ("yes", "designated")):
        return None
    if hw == "steps":
        return "steps"
    if hw == "corridor" or tags.get("indoor") == "yes":
        return "indoor"
    if tags.get("footway") == "crossing" or tags.get("crossing"):
        return "crossing"
    if tags.get("footway") == "sidewalk":
        return "sidewalk"
    if hw in ("footway", "pedestrian", "path", "cycleway"):
        return "path"
    if hw in ("residential", "service", "living_street", "unclassified"):
        return "street"
    if hw in ("primary", "secondary", "tertiary"):
        return "road"
    return None


def to_xy(lat, lon):
    return ((lon + 71.09) * M_PER_DEG_LON, (lat - LAT0) * M_PER_DEG_LAT)


def dist_m(a, b):
    ax, ay = to_xy(*a)
    bx, by = to_xy(*b)
    return math.hypot(ax - bx, ay - by)


def point_segment_m(p, a, b):
    px, py = to_xy(*p)
    ax, ay = to_xy(*a)
    bx, by = to_xy(*b)
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    t = 0 if L2 == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L2))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def inside(p, poly):
    lat, lon = p
    hit = False
    for i in range(len(poly)):
        (y1, x1), (y2, x2) = poly[i], poly[i - 1]
        if (y1 > lat) != (y2 > lat) and lon < (x2 - x1) * (lat - y1) / (y2 - y1) + x1:
            hit = not hit
    return hit


def dist_to_polygon(p, poly):
    if inside(p, poly):
        return 0.0
    return min(point_segment_m(p, poly[i - 1], poly[i]) for i in range(len(poly)))


def key(lat, lon):
    return (round(lat, 7), round(lon, 7))


def main():
    ways = json.load(open(os.path.join(RAW, "ways.json")))["elements"]
    bldgs = json.load(open(os.path.join(RAW, "bldg.json")))["elements"]
    pois = json.load(open(os.path.join(RAW, "poi.json")))["elements"]

    # ---- 1. raw graph -----------------------------------------------------
    names = []
    name_idx = {}

    def nid(name):
        if not name:
            return -1
        if name not in name_idx:
            name_idx[name] = len(names)
            names.append(name)
        return name_idx[name]

    # Sidewalks and crosswalks are rarely named in OSM; borrow the name of the street they follow.
    road_segs = defaultdict(list)  # street name -> segments
    for w in ways:
        t = w.get("tags", {})
        if t.get("name") and classify(t) in ("street", "road") and "geometry" in w:
            g = [(p["lat"], p["lon"]) for p in w["geometry"] if p]
            road_segs[t["name"]] += list(zip(g, g[1:]))

    def street_alongside(w, max_m):
        # Score each street by its mean distance to points sampled along the whole sidewalk,
        # so a sidewalk that merely touches a cross street at one end isn't named after it.
        g = [(p["lat"], p["lon"]) for p in w["geometry"] if p]
        samples = [((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) for a, b in zip(g, g[1:])]
        samples = samples[:: max(1, len(samples) // 6)]
        best_d, best_name = max_m, None
        for name, segs in road_segs.items():
            d = sum(min(point_segment_m(s, a, b) for a, b in segs) for s in samples) / len(samples)
            if d < best_d:
                best_d, best_name = d, name
        return best_name

    adj = defaultdict(dict)  # node -> {neighbour: (kind, nameIdx)}
    for w in ways:
        kind = classify(w.get("tags", {}))
        if not kind or "geometry" not in w:
            continue
        name = w["tags"].get("name")
        if not name and kind == "sidewalk":
            name = street_alongside(w, 18)
        elif not name and kind == "crossing":
            name = street_alongside(w, 6)
        nm = nid(name)
        pts = [key(g["lat"], g["lon"]) for g in w["geometry"] if g]
        for a, b in zip(pts, pts[1:]):
            if a != b:
                adj[a][b] = (kind, nm)
                adj[b][a] = (kind, nm)

    # ---- 2. largest connected component -----------------------------------
    seen, best = set(), set()
    for start in adj:
        if start in seen:
            continue
        comp, stack = {start}, [start]
        seen.add(start)
        while stack:
            u = stack.pop()
            for v in adj[u]:
                if v not in seen:
                    seen.add(v)
                    comp.add(v)
                    stack.append(v)
        if len(comp) > len(best):
            best = comp
    adj = {u: {v: e for v, e in nb.items() if v in best} for u, nb in adj.items() if u in best}
    print(f"raw graph: {len(adj)} nodes (largest component)")

    # ---- 3. places + entrances --------------------------------------------
    footprints = {}
    for b in bldgs:
        n = b["tags"].get("name")
        if n and b.get("geometry"):
            footprints[n] = [(g["lat"], g["lon"]) for g in b["geometry"]]
    poi_shapes = {}
    for p in pois:
        n = p.get("tags", {}).get("name")
        if not n:
            continue
        if p.get("geometry") and p["type"] == "way":
            poi_shapes.setdefault(n, [(g["lat"], g["lon"]) for g in p["geometry"]])
        elif p["type"] == "node":
            poi_shapes.setdefault(n, (p["lat"], p["lon"]))

    # walkway nodes that pedestrians can actually stand on (not the middle of Huntington Ave)
    walkable = [u for u, nb in adj.items() if any(k not in ("road",) for k, _ in nb.values())]

    places, keep = [], set()
    for pid, label, osm, cat, aliases, desc, manual in PLACES:
        shape = footprints.get(osm) or poi_shapes.get(osm) if osm else None
        poly = None
        if isinstance(shape, list) and len(shape) >= 3:
            poly = shape
            xs = [to_xy(*p) for p in poly]
            cx = sum(x for x, _ in xs) / len(xs)
            cy = sum(y for _, y in xs) / len(xs)
            centre = (LAT0 + cy / M_PER_DEG_LAT, -71.09 + cx / M_PER_DEG_LON)
            d = lambda u: dist_to_polygon(u, poly)
        else:
            centre = shape if isinstance(shape, tuple) else manual
            if centre is None:
                print(f"  !! no location for {label} ({osm}) — skipped")
                continue
            d = lambda u, c=centre: dist_m(u, c)
        cands = sorted(((d(u), u) for u in walkable), key=lambda t: t[0])
        chosen = []
        for dd, u in cands:
            if dd > ENTRANCE_RADIUS_M and chosen:
                break
            if all(dist_m(u, c) >= ENTRANCE_SEPARATION_M for c in chosen):
                chosen.append(u)
            if len(chosen) == MAX_ENTRANCES:
                break
        if cands[0][0] > 80:
            print(f"  !! {label}: nearest walkway is {cands[0][0]:.0f} m away")
        keep.update(chosen)
        places.append(dict(id=pid, name=label, cat=cat, aliases=aliases, desc=desc,
                           centre=centre, poly=poly, entrances=chosen))

    # ---- 4. contract degree-2 chains --------------------------------------
    def is_keep(u):
        nb = adj[u]
        if len(nb) != 2 or u in keep:
            return True
        e1, e2 = nb.values()
        return e1 != e2  # kind or street name changes here -> needed for directions

    keep.update(u for u in adj if is_keep(u))
    index = {u: i for i, u in enumerate(sorted(keep))}
    edges, done = [], set()
    for u in index:
        for v0 in adj[u]:
            if (u, v0) in done:
                continue
            kind, nm = adj[u][v0]
            chain, prev, cur = [u], u, v0
            while cur not in index:
                chain.append(cur)
                nxt = next(x for x in adj[cur] if x != prev)
                prev, cur = cur, nxt
            chain.append(cur)
            done.add((u, v0))
            done.add((cur, prev))
            if u == cur and len(chain) <= 2:
                continue
            length = sum(dist_m(a, b) for a, b in zip(chain, chain[1:]))
            mid = [c for p in chain[1:-1] for c in (round(p[0], 6), round(p[1], 6))]
            edges.append([index[u], index[cur], KINDS.index(kind), nm, round(length, 1), mid])

    nodes = [[round(lat, 6), round(lon, 6)] for lat, lon in sorted(keep)]
    print(f"contracted graph: {len(nodes)} nodes, {len(edges)} edges, {len(places)} places")

    out_places = []
    for p in places:
        out_places.append({
            "id": p["id"], "name": p["name"], "cat": p["cat"], "aliases": p["aliases"], "desc": p["desc"],
            "lat": round(p["centre"][0], 6), "lon": round(p["centre"][1], 6),
            "poly": [[round(a, 6), round(b, 6)] for a, b in p["poly"]] if p["poly"] else None,
            "entrances": [index[u] for u in p["entrances"]],
        })

    # Other named buildings in the area, drawn as context (not routable).
    context = [[[round(a, 6), round(b, 6)] for a, b in poly]
               for n, poly in footprints.items() if n not in {x[2] for x in PLACES}]

    # ---- 5. basemap layers (drawn by the app instead of third-party map tiles) ----
    def flat(geom):
        return [c for p in geom if p for c in (round(p["lat"], 6), round(p["lon"], 6))]

    road_class = {"primary": 0, "secondary": 0, "tertiary": 0, "residential": 1, "unclassified": 1,
                  "living_street": 1, "service": 2, "footway": 3, "pedestrian": 3, "path": 3,
                  "cycleway": 3, "steps": 3}
    roads = [[road_class[w["tags"]["highway"]], flat(w["geometry"])]
             for w in ways if w.get("geometry") and w["tags"].get("highway") in road_class]
    roads.sort(key=lambda r: -r[0])  # draw paths first, major roads on top

    rail_ways = json.load(open(os.path.join(RAW, "rail.json")))["elements"]
    rail = [[1 if w["tags"].get("tunnel") == "yes" else 0, flat(w["geometry"])] for w in rail_ways if w.get("geometry")]

    parks = [[[round(g["lat"], 6), round(g["lon"], 6)] for g in p["geometry"]]
             for p in pois if p["type"] == "way" and p.get("geometry")
             and p["tags"].get("leisure") in ("park", "garden", "common", "pitch")]

    # One label per street, placed at the middle of its longest stretch and rotated to follow it.
    stretches = defaultdict(list)
    for w in ways:
        t = w.get("tags", {})
        if t.get("name") and road_class.get(t.get("highway"), 9) <= 1 and w.get("geometry"):
            g = [(p["lat"], p["lon"]) for p in w["geometry"] if p]
            stretches[t["name"]].append(g)
    street_labels = []
    for name, ws in stretches.items():
        g = max(ws, key=lambda g: sum(dist_m(a, b) for a, b in zip(g, g[1:])))
        total = sum(dist_m(a, b) for a, b in zip(g, g[1:]))
        if total < 120:
            continue
        acc = 0
        for a, b in zip(g, g[1:]):
            acc += dist_m(a, b)
            if acc >= total / 2:
                break
        (ax, ay), (bx, by) = to_xy(*a), to_xy(*b)
        angle = -math.degrees(math.atan2(by - ay, bx - ax))
        if angle > 90:
            angle -= 180
        elif angle < -90:
            angle += 180
        street_labels.append([name, round((a[0] + b[0]) / 2, 6), round((a[1] + b[1]) / 2, 6), round(angle, 1)])

    data = {
        "base": {"roads": roads, "rail": rail, "parks": parks, "labels": street_labels},
        "meta": {
            "source": "© OpenStreetMap contributors (ODbL). Built by tools/build_dataset.py",
            "kinds": KINDS,
        },
        "nodes": nodes,
        "edges": edges,
        "names": names,
        "places": out_places,
        "context": context,
    }
    with open(OUT, "w") as f:
        f.write("// Generated by tools/build_dataset.py from OpenStreetMap data — do not edit by hand.\n")
        f.write("window.CAMPUS_DATA = ")
        json.dump(data, f, separators=(",", ":"))
        f.write(";\n")
    print(f"wrote {os.path.relpath(OUT, ROOT)} ({os.path.getsize(OUT) / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
