/*
 * Husky Navigator — UI layer: map rendering, search boxes, route visualisation.
 */
(function () {
  "use strict";

  const { CampusGraph, PathFinding, buildDirections } = window;
  const graph = new CampusGraph(window.CAMPUS_DATA);

  const CATEGORIES = {
    academic:    { label: "Academic",     color: "#6366f1" },
    research:    { label: "Research",     color: "#0891b2" },
    library:     { label: "Library",      color: "#8b5cf6" },
    student:     { label: "Student life", color: "#db2777" },
    athletics:   { label: "Athletics",    color: "#16a34a" },
    residential: { label: "Residential",  color: "#ca8a04" },
    transit:     { label: "Transit",      color: "#2563eb" },
    parking:     { label: "Parking",      color: "#64748b" },
    outdoor:     { label: "Open space",   color: "#65a30d" },
  };

  const ALGOS = {
    astar: {
      label: "A*",
      desc: "Best-first search guided by straight-line distance to the goal: <code>f(n) = g(n) + h(n)</code>. Finds the same shortest route while exploring far fewer nodes.",
    },
    dijkstra: {
      label: "Dijkstra",
      desc: "Expands outward in order of distance walked: <code>f(n) = g(n)</code>. Guaranteed shortest route, but it searches in every direction.",
    },
    compare: {
      label: "Compare",
      desc: "Runs both algorithms on the same trip so you can see how much of the campus each one has to search.",
    },
  };

  const SPEEDS = [1, 2, 3, 5, 8, 12, 20, 32, 50, 90]; // nodes revealed per animation frame
  const WALK_M_PER_MIN = 80; // ~3 mph

  const ICONS = {
    start: '<circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="9"/>',
    arrive: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    straight: '<path d="M12 20V4M6 10l6-6 6 6"/>',
    left: '<path d="M19 20v-7a4 4 0 0 0-4-4H5M10 4 5 9l5 5"/>',
    right: '<path d="M5 20v-7a4 4 0 0 1 4-4h10M14 4l5 5-5 5"/>',
    "slight-left": '<path d="M16 20V12L8 4M8 11V4h7"/>',
    "slight-right": '<path d="M8 20V12l8-8M16 11V4H9"/>',
    uturn: '<path d="M8 20V9a4 4 0 0 1 8 0v4M12 10l4 4 4-4"/>',
    stairs: '<path d="M3 20h5v-5h5v-5h5V5h3"/>',
  };

  // ------------------------------------------------------------------ state
  const state = {
    from: null,
    to: null,
    algo: "astar",
    accessible: false,
    animate: true,
    speed: 5,
    category: "all",
    runToken: 0,
  };

  const $ = (sel) => document.querySelector(sel);
  const fmtDist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);
  const fmtMiles = (m) => `${(m / 1609.34).toFixed(2)} mi`;
  const fmtMs = (ms) => (ms < 0.1 ? `${(ms * 1000).toFixed(0)} µs` : `${ms.toFixed(2)} ms`);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const isDark = () => {
    const t = document.documentElement.dataset.theme;
    return t ? t === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  };

  // ------------------------------------------------------------------ map
  const map = L.map("map", { zoomControl: false, minZoom: 15, maxZoom: 20 });
  L.control.zoom({ position: "topright" }).addTo(map);
  map.attributionControl.addAttribution('Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors');

  // Stacking order: basemap 250 < building polygons (overlayPane 400) < graph < search < streets < route.
  const pane = (name, z) => { map.createPane(name).style.zIndex = z; return name; };
  const baseCanvas = L.canvas({ padding: 0.5, pane: pane("basePane", 250) });
  const graphCanvas = L.canvas({ padding: 0.5, pane: pane("graphPane", 405) });
  const searchCanvas = {
    dijkstra: L.canvas({ padding: 0.5, pane: pane("dijkstraPane", 410) }),
    astar: L.canvas({ padding: 0.5, pane: pane("astarPane", 411) }),
  };
  const STREET_PANE = pane("streetPane", 415);
  const ROUTE_PANE = pane("routePane", 420);

  // ---- Vector basemap drawn from the OSM data (no tile server or API key needed) ----
  const BASE_THEME = {
    light: { major: "#ffffff", majorCase: "#d3d5da", minor: "#ffffff", service: "#f9f9fa", path: "#c4c7ce",
             park: "#d4e7cd", rail: "#a1a1aa", building: "#dcdde2", buildingLine: "#c5c7cc" },
    dark:  { major: "#3b3b42", majorCase: "#2a2a30", minor: "#303036", service: "#29292e", path: "#3d3d45",
             park: "#1b2a1e", rail: "#5b5b64", building: "#24242a", buildingLine: "#303037" },
  };
  const ROAD_STYLE = [ // by road class: [base width in px at zoom 17, theme colour key]
    [9, "major"], [5, "minor"], [3, "service"], [1.3, "path"],
  ];
  const base = { group: L.layerGroup().addTo(map), roads: [], casings: [], parks: [], rail: [], buildings: [] };
  const bd = window.CAMPUS_DATA.base;
  const toLatLngs = (flat) => { const out = []; for (let i = 0; i < flat.length; i += 2) out.push([flat[i], flat[i + 1]]); return out; };

  for (const poly of bd.parks) base.parks.push(L.polygon(poly, { renderer: baseCanvas, stroke: false, fillOpacity: 1, interactive: false }).addTo(base.group));
  for (const poly of window.CAMPUS_DATA.context) {
    base.buildings.push(L.polygon(poly, { renderer: baseCanvas, weight: 0.8, fillOpacity: 1, interactive: false }).addTo(base.group));
  }
  for (const [cls, flat] of bd.roads) {
    if (cls === 0) base.casings.push(L.polyline(toLatLngs(flat), { renderer: baseCanvas, interactive: false, lineCap: "round" }).addTo(base.group));
  }
  for (const [cls, flat] of bd.roads) {
    base.roads.push([cls, L.polyline(toLatLngs(flat), { renderer: baseCanvas, interactive: false, lineCap: "round", lineJoin: "round" }).addTo(base.group)]);
  }
  for (const [tunnel, flat] of bd.rail) {
    base.rail.push([tunnel, L.polyline(toLatLngs(flat), { renderer: baseCanvas, interactive: false, dashArray: "8 5" }).addTo(base.group)]);
  }

  const streetMarkers = bd.labels.map(([name, lat, lon, angle]) => L.marker([lat, lon], {
    pane: STREET_PANE, interactive: false, keyboard: false,
    icon: L.divIcon({ className: "street-label", html: `<span style="transform:translate(-50%,-50%) rotate(${angle}deg)">${esc(name)}</span>`, iconSize: [0, 0] }),
  }).addTo(map));

  function styleBasemap() {
    const t = BASE_THEME[isDark() ? "dark" : "light"];
    const k = Math.min(2.5, Math.max(0.35, Math.pow(2, map.getZoom() - 17)));
    base.parks.forEach((l) => l.setStyle({ fillColor: t.park }));
    base.buildings.forEach((l) => l.setStyle({ fillColor: t.building, color: t.buildingLine }));
    base.casings.forEach((l) => l.setStyle({ color: t.majorCase, weight: ROAD_STYLE[0][0] * k + 2 }));
    base.roads.forEach(([cls, l]) => l.setStyle({ color: t[ROAD_STYLE[cls][1]], weight: Math.max(cls === 3 ? 0.8 : 1, ROAD_STYLE[cls][0] * k) }));
    base.rail.forEach(([tunnel, l]) => l.setStyle({ color: t.rail, weight: Math.max(1.5, 2.5 * k), opacity: tunnel ? 0.35 : 0.9 }));
  }
  map.on("zoomend", styleBasemap);

  // ---- Base map options. Esri services are free to use with attribution and need no API key.
  const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/";
  const esri = (service, attribution) => L.tileLayer(`${ESRI}${service}/MapServer/tile/{z}/{y}/{x}`, {
    attribution, maxZoom: 20, maxNativeZoom: 19,
  });
  const IMAGERY_ATTR = "Imagery &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community";
  const imagery = esri("World_Imagery", IMAGERY_ATTR);
  const BASEMAPS = {
    campus:    { label: "Campus",      hint: "Drawn from OSM data · works offline", layers: [base.group], ownStreetLabels: true },
    satellite: { label: "Satellite",   hint: "Aerial imagery", layers: [imagery], imagery: true, ownStreetLabels: true },
    hybrid:    { label: "Hybrid",      hint: "Imagery + roads & place names", imagery: true, thumb: ["World_Imagery", "Reference/World_Transportation"],
                 layers: [imagery, esri("Reference/World_Transportation", IMAGERY_ATTR), esri("Reference/World_Boundaries_and_Places", IMAGERY_ATTR)] },
    streets:   { label: "Streets",     hint: "Esri street map", layers: [esri("World_Street_Map", "Tiles &copy; Esri")], lightTiles: true },
    topo:      { label: "Topographic", hint: "Terrain & landmarks", layers: [esri("World_Topo_Map", "Tiles &copy; Esri")], lightTiles: true },
  };
  BASEMAPS.satellite.thumb = ["World_Imagery"];
  BASEMAPS.streets.thumb = ["World_Street_Map"];
  BASEMAPS.topo.thumb = ["World_Topo_Map"];

  const savedView = (() => { try { return JSON.parse(localStorage.getItem("husky-map") || "{}"); } catch (e) { return {}; } })();
  const view = {
    basemap: BASEMAPS[savedView.basemap] ? savedView.basemap : "campus",
    overlay: Number.isFinite(savedView.overlay) ? savedView.overlay : 100, // building highlight strength, %
    labels: savedView.labels !== false,
  };
  const saveView = () => { try { localStorage.setItem("husky-map", JSON.stringify(view)); } catch (e) { /* storage unavailable */ } };

  function setBasemap(id) {
    for (const b of Object.values(BASEMAPS)) b.layers.forEach((l) => map.hasLayer(l) && map.removeLayer(l));
    const b = BASEMAPS[id];
    b.layers.forEach((l) => l.addTo(map));
    view.basemap = id;
    const el = map.getContainer();
    el.classList.toggle("is-satellite", !!b.imagery);
    el.classList.toggle("is-light-tiles", !!b.lightTiles);
    el.classList.toggle("hide-street-labels", !b.ownStreetLabels);
    document.querySelectorAll(".bm-option").forEach((o) => o.setAttribute("aria-pressed", o.dataset.basemap === id));
    const cur = document.querySelector(".layers-btn .lb-name");
    if (cur) cur.textContent = b.label;
    saveView();
    if (typeof writeHash === "function" && state.ready) writeHash();
  }

  const LayersControl = L.Control.extend({
    options: { position: "topright" },
    onAdd() {
      const el = L.DomUtil.create("div", "layers-control");
      // Live thumbnails: the zoom-16 tile under the campus centre.
      const t = map.project(L.latLng(42.3390, -71.0890), 16).divideBy(256).floor();
      const thumb = (b) => b.thumb
        ? b.thumb.map((svc) => `<img src="${ESRI}${svc}/MapServer/tile/16/${t.y}/${t.x}" alt="" loading="lazy">`).join("")
        : '<span class="bm-campus-thumb"><i></i><i></i><i></i><b></b><b></b></span>';
      el.innerHTML = `
        <button class="layers-btn" aria-expanded="false" aria-haspopup="true" title="Map layers">
          <svg viewBox="0 0 24 24"><path d="M12 3 2 8.5 12 14l10-5.5L12 3z"/><path d="m2 15.5 10 5.5 10-5.5"/></svg>
          <span class="lb-name"></span>
        </button>
        <div class="layers-panel" role="dialog" aria-label="Map layers" hidden>
          <div class="lp-title">Map type</div>
          <div class="bm-grid">
            ${Object.entries(BASEMAPS).map(([id, b]) => `
              <button class="bm-option" data-basemap="${id}" aria-pressed="false" title="${b.hint}">
                <span class="bm-thumb">${thumb(b)}</span>
                <span class="bm-label">${b.label}</span>
              </button>`).join("")}
          </div>
          <div class="lp-hint" id="bm-hint"></div>
          <div class="lp-title">Overlays</div>
          <label class="lp-row">
            <span>Building highlights</span>
            <input type="range" min="0" max="100" step="5" id="opt-overlay" aria-label="Building highlight strength">
            <output id="overlay-val"></output>
          </label>
          <label class="lp-row lp-check">
            <span>Labels</span>
            <input type="checkbox" id="opt-labels">
          </label>
        </div>`;
      L.DomEvent.disableClickPropagation(el);
      L.DomEvent.disableScrollPropagation(el);
      const btn = el.querySelector(".layers-btn"), panel = el.querySelector(".layers-panel");
      const hint = el.querySelector("#bm-hint");
      const showHint = (id) => { hint.textContent = BASEMAPS[id].hint; };
      const toggle = (open) => { panel.hidden = !open; btn.setAttribute("aria-expanded", open); };
      btn.addEventListener("click", () => toggle(panel.hidden));
      document.addEventListener("click", (e) => { if (!el.contains(e.target)) toggle(false); });
      document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden) { toggle(false); btn.focus(); } });
      el.querySelectorAll(".bm-option").forEach((o) => {
        o.addEventListener("click", () => { setBasemap(o.dataset.basemap); showHint(o.dataset.basemap); });
        o.addEventListener("mouseenter", () => showHint(o.dataset.basemap));
        o.addEventListener("mouseleave", () => showHint(view.basemap));
      });
      const slider = el.querySelector("#opt-overlay"), out = el.querySelector("#overlay-val");
      slider.value = view.overlay;
      out.textContent = `${view.overlay}%`;
      slider.addEventListener("input", () => {
        view.overlay = +slider.value;
        out.textContent = `${view.overlay}%`;
        graph.places.forEach((p) => placeShapes.get(p.id).setStyle(placeStyle(p)));
        saveView();
      });
      const labels = el.querySelector("#opt-labels");
      labels.checked = view.labels;
      labels.addEventListener("change", () => {
        view.labels = labels.checked;
        map.getContainer().classList.toggle("no-labels", !view.labels);
        saveView();
      });
      map.getContainer().classList.toggle("no-labels", !view.labels);
      setTimeout(() => showHint(view.basemap));
      return el;
    },
  });
  new LayersControl().addTo(map);

  const placeBounds = L.latLngBounds(graph.places.map((p) => [p.lat, p.lon]));
  map.fitBounds(placeBounds.pad(-0.15));
  map.setMaxBounds(placeBounds.pad(0.6));

  const layers = {
    places: L.layerGroup().addTo(map),
    graph: L.layerGroup(),
    explored: L.layerGroup().addTo(map),
    route: L.layerGroup().addTo(map),
    highlight: L.layerGroup().addTo(map),
    markers: L.layerGroup().addTo(map),
  };

  // Campus places.
  const placeShapes = new Map();
  function placeStyle(p, hover) {
    const color = CATEGORIES[p.cat].color;
    const on = state.category === "all" || p.cat === state.category;
    const k = view.overlay / 100; // user-controlled highlight strength
    if (!p.poly) {
      const o = Math.max(k, 0.35); // keep point places findable
      return { color: "#fff", weight: 2, fillColor: color, radius: 8, opacity: on ? o : 0.2, fillOpacity: on ? (hover ? 1 : 0.85 * o) : 0.15 };
    }
    // Imagery is busy, so outlines get a little heavier there.
    const sat = !!BASEMAPS[view.basemap].imagery;
    const fill = hover ? Math.max(0.5, 0.5 * k) : (p.cat === "outdoor" ? 0.14 : 0.28) * k;
    return {
      color, fillColor: color, weight: hover ? 2.5 : sat ? 2 : 1.5,
      opacity: hover ? 1 : on ? 0.9 * Math.max(k, 0.25) : 0.15, fillOpacity: on ? fill : 0.05,
    };
  }

  for (const p of graph.places) {
    const shape = p.poly ? L.polygon(p.poly, placeStyle(p)) : L.circleMarker([p.lat, p.lon], placeStyle(p));
    shape.bindTooltip(p.name, { permanent: true, direction: "center", className: "place-label", interactive: false });
    shape.bindPopup(() => popupHtml(p), { closeButton: true, autoPanPadding: [40, 40] });
    shape.on("mouseover", () => shape.setStyle(placeStyle(p, true)));
    shape.on("mouseout", () => shape.setStyle(placeStyle(p)));
    shape.addTo(layers.places);
    placeShapes.set(p.id, shape);
  }

  // ---- Label decluttering: show the most important labels first, hide any that would overlap ----
  const CAT_PRIORITY = { library: 0, transit: 1, student: 1, academic: 2, research: 2, athletics: 3, residential: 4, outdoor: 5, parking: 6 };
  const areaOf = (p) => (p.poly ? L.latLngBounds(p.poly).getNorthEast().distanceTo(L.latLngBounds(p.poly).getSouthWest()) : 0);
  const labelOrder = graph.places.slice().sort((a, b) => CAT_PRIORITY[a.cat] - CAT_PRIORITY[b.cat] || areaOf(b) - areaOf(a));

  function declutter() {
    map.getContainer().classList.toggle("hide-labels", map.getZoom() < 16);
    const placed = [];
    const tryPlace = (el) => {
      if (!el) return;
      el.style.visibility = "";
      const r = el.getBoundingClientRect();
      if (!r.width) return;
      const hit = placed.some((q) => r.left < q.right + 4 && r.right + 4 > q.left && r.top < q.bottom + 2 && r.bottom + 2 > q.top);
      if (hit) el.style.visibility = "hidden";
      else placed.push(r);
    };
    const first = [state.from, state.to].filter(Boolean);
    for (const p of first.concat(labelOrder.filter((p) => !first.includes(p)))) {
      const tip = placeShapes.get(p.id).getTooltip();
      tryPlace(tip && tip.getElement());
    }
    for (const m of streetMarkers) tryPlace(m.getElement() && m.getElement().firstChild);
  }
  map.on("zoomend", declutter);

  function popupHtml(p) {
    const cat = CATEGORIES[p.cat];
    return `
      <div class="pop-cat"><span class="cat-dot" style="background:${cat.color}"></span>${cat.label}</div>
      <div class="pop-name">${esc(p.name)}</div>
      <p class="pop-desc">${esc(p.desc)}</p>
      <div class="pop-btns">
        <button data-set="from" data-place="${p.id}">Start here</button>
        <button class="go" data-set="to" data-place="${p.id}">Go here</button>
      </div>`;
  }

  map.getContainer().addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-set]");
    if (!btn) return;
    setEndpoint(btn.dataset.set, graph.place(btn.dataset.place));
    map.closePopup();
  });

  // Walkway graph overlay (built lazily — ~2k edges).
  let graphDrawn = false;
  function drawGraph() {
    if (graphDrawn) return;
    graphDrawn = true;
    for (const e of graph.edges) {
      if (e.kind === "entrance") continue;
      L.polyline(e.coords, {
        renderer: graphCanvas, interactive: false, weight: e.kind === "road" ? 1 : 1.6,
        color: e.kind === "steps" ? "#ef4444" : isDark() ? "#71717a" : "#52525b",
        opacity: e.kind === "road" ? 0.35 : 0.7, dashArray: e.kind === "steps" ? "2 3" : null,
      }).addTo(layers.graph);
    }
    for (let i = 0; i < graph.walkNodeCount; i++) {
      L.circleMarker([graph.lat[i], graph.lon[i]], {
        renderer: graphCanvas, interactive: false, radius: 1.8, weight: 0, fillOpacity: 0.9,
        fillColor: isDark() ? "#a1a1aa" : "#3f3f46",
      }).addTo(layers.graph);
    }
  }

  // ------------------------------------------------------------------ search boxes
  function normalize(s) { return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, ""); }

  function searchPlaces(query) {
    const q = normalize(query.trim());
    if (!q) return graph.places.slice().sort((a, b) => a.name.localeCompare(b.name));
    const scored = [];
    for (const p of graph.places) {
      const name = normalize(p.name);
      let score = -1;
      if (name.startsWith(q)) score = 100;
      else if (name.split(" ").some((w) => w.startsWith(q))) score = 80;
      else if (p.aliases.some((a) => normalize(a).startsWith(q))) score = 70;
      else if (name.includes(q)) score = 60;
      else if (p.aliases.some((a) => normalize(a).includes(q)) || normalize(CATEGORIES[p.cat].label).startsWith(q)) score = 40;
      if (score >= 0) scored.push([score, p]);
    }
    return scored.sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name)).map((x) => x[1]);
  }

  const fields = {};
  function setupField(role) {
    const wrap = document.querySelector(`.field[data-role="${role}"]`);
    const input = wrap.querySelector("input");
    const list = wrap.querySelector(".suggestions");
    const clear = wrap.querySelector(".clear-btn");
    let items = [], active = -1;

    function render() {
      items = searchPlaces(input.value).slice(0, 40);
      active = items.length ? 0 : -1;
      list.innerHTML = items.length
        ? items.map((p, i) => `
          <li role="option" id="${role}-opt-${i}" data-i="${i}" aria-selected="${i === active}">
            <span class="cat-dot" style="background:${CATEGORIES[p.cat].color}"></span>
            <span class="s-name">${esc(p.name)}</span>
            <span class="s-cat">${CATEGORIES[p.cat].label}</span>
          </li>`).join("")
        : `<li class="empty">No campus places match “${esc(input.value)}”</li>`;
      open(true);
    }
    function open(on) {
      list.classList.toggle("open", on);
      input.setAttribute("aria-expanded", on);
    }
    function highlight(i) {
      if (!items.length) return;
      active = (i + items.length) % items.length;
      list.querySelectorAll("li[role=option]").forEach((li, j) => li.setAttribute("aria-selected", j === active));
      const li = list.children[active];
      li && li.scrollIntoView({ block: "nearest" });
      input.setAttribute("aria-activedescendant", `${role}-opt-${active}`);
    }
    function choose(i) {
      const p = items[i];
      open(false);
      if (!p) return;
      setEndpoint(role, p);
      if (role === "from" && !state.to) setTimeout(() => fields.to.input.focus(), 0);
      else input.blur();
    }

    input.addEventListener("focus", () => { input.select(); render(); });
    input.addEventListener("input", render);
    input.addEventListener("blur", () => setTimeout(() => { open(false); syncField(role); }, 120));
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); highlight(active + 1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); highlight(active - 1); }
      else if (e.key === "Enter") { e.preventDefault(); if (list.classList.contains("open")) choose(active); else findRoute(); }
      else if (e.key === "Escape") { open(false); input.blur(); }
    });
    list.addEventListener("mousedown", (e) => {
      const li = e.target.closest("li[data-i]");
      if (li) { e.preventDefault(); choose(+li.dataset.i); }
    });
    clear.addEventListener("click", () => { setEndpoint(role, null); input.focus(); });
    fields[role] = { wrap, input };
  }
  setupField("from");
  setupField("to");

  function syncField(role) {
    const { wrap, input } = fields[role];
    input.value = state[role] ? state[role].name : "";
    wrap.classList.toggle("has-value", !!state[role]);
  }

  // ------------------------------------------------------------------ endpoints & markers
  function pinIcon(letter) {
    return L.divIcon({ className: "", html: `<div class="marker-pin ${letter.toLowerCase()}"><span>${letter}</span></div>`, iconSize: [34, 34], iconAnchor: [17, 40] });
  }

  function setEndpoint(role, place) {
    state[role] = place;
    syncField(role);
    clearRoute();
    drawMarkers();
    $("#go").disabled = !(state.from && state.to && state.from !== state.to);
    declutter();
    if (place && !(state.from && state.to)) map.panTo([place.lat, place.lon], { animate: true });
    if (state.from && state.to && state.from !== state.to) findRoute();
    writeHash();
  }

  function drawMarkers() {
    layers.markers.clearLayers();
    if (state.from) L.marker([state.from.lat, state.from.lon], { icon: pinIcon("A"), zIndexOffset: 1000, keyboard: false }).addTo(layers.markers);
    if (state.to) L.marker([state.to.lat, state.to.lon], { icon: pinIcon("B"), zIndexOffset: 1000, keyboard: false }).addTo(layers.markers);
  }

  $("#swap").addEventListener("click", () => {
    [state.from, state.to] = [state.to, state.from];
    syncField("from"); syncField("to"); drawMarkers();
    if (state.from && state.to) findRoute(); else clearRoute();
    writeHash();
  });

  // ------------------------------------------------------------------ options
  document.querySelectorAll(".segmented button").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.algo = btn.dataset.algo;
      document.querySelectorAll(".segmented button").forEach((b) => b.setAttribute("aria-checked", b === btn));
      $("#algo-desc").innerHTML = ALGOS[state.algo].desc;
      writeHash();
      if (state.from && state.to && state.from !== state.to) findRoute();
    });
  });
  $("#algo-desc").innerHTML = ALGOS[state.algo].desc;

  $("#opt-accessible").addEventListener("change", (e) => {
    state.accessible = e.target.checked;
    writeHash();
    if (state.from && state.to && state.from !== state.to) findRoute();
  });
  $("#opt-animate").addEventListener("change", (e) => {
    state.animate = e.target.checked;
    $("#speed-row").hidden = !state.animate;
  });
  $("#opt-speed").addEventListener("input", (e) => { state.speed = +e.target.value; });
  $("#opt-graph").addEventListener("change", (e) => {
    if (e.target.checked) { drawGraph(); layers.graph.addTo(map); }
    else map.removeLayer(layers.graph);
  });
  $("#go").addEventListener("click", findRoute);

  $("#theme-toggle").addEventListener("click", () => {
    const next = isDark() ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("husky-theme", next); } catch (e) { /* storage unavailable */ }
    styleBasemap();
    if (graphDrawn) {
      const visible = map.hasLayer(layers.graph);
      layers.graph.clearLayers(); graphDrawn = false;
      if (visible) drawGraph();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement.tagName !== "INPUT") { e.preventDefault(); fields.from.input.focus(); }
  });

  // ------------------------------------------------------------------ routing
  const opts = () => ({ avoidStairs: state.accessible });

  /** Average runtime over many runs — a single run is too fast for the browser's timer. */
  function benchmark(fn, s, t) {
    const runs = 40;
    const t0 = performance.now();
    for (let i = 0; i < runs; i++) fn(graph, s, t, opts());
    return (performance.now() - t0) / runs;
  }

  function clearRoute() {
    state.runToken++;
    layers.explored.clearLayers();
    layers.route.clearLayers();
    layers.highlight.clearLayers();
    $("#results").hidden = true;
    $("#map-status").hidden = true;
  }

  function findRoute() {
    const { from, to } = state;
    if (!from || !to || from === to) return;
    clearRoute();
    const token = state.runToken;

    const which = state.algo === "compare" ? ["dijkstra", "astar"] : [state.algo];
    const runs = {};
    for (const a of which) {
      runs[a] = PathFinding[a](graph, from.node, to.node, opts());
      runs[a].avgMs = benchmark(PathFinding[a], from.node, to.node);
    }
    const main = runs.astar || runs.dijkstra;

    if (!main.found) {
      renderNoRoute();
      return;
    }

    const steps = buildDirections(graph, main, from, to);
    const finish = () => {
      if (token !== state.runToken) return;
      drawRoute(main);
      renderResults(runs, main, steps);
      setTimeout(() => { if (token === state.runToken) $("#map-status").hidden = true; }, 1600);
    };

    const routeBounds = L.latLngBounds(main.path.map((n) => [graph.lat[n], graph.lon[n]]));
    map.flyToBounds(routeBounds.pad(0.25), { duration: 0.6, paddingTopLeft: [20, 60], maxZoom: 18 });

    if (state.animate) animateSearch(runs, token, finish);
    else { drawExplored(runs, Infinity); finish(); }
  }

  function exploredMarker(node, algo) {
    return L.circleMarker([graph.lat[node], graph.lon[node]], {
      renderer: searchCanvas[algo], interactive: false, radius: algo === "astar" ? 4 : 5, weight: 0,
      fillColor: algo === "astar" ? "#f97316" : "#0ea5e9", fillOpacity: algo === "astar" ? 0.75 : 0.45,
    });
  }

  function drawExplored(runs, upto) {
    for (const a of ["dijkstra", "astar"]) {
      if (!runs[a]) continue;
      const ex = runs[a].explored;
      for (let i = 0; i < Math.min(upto, ex.length); i++) {
        if (!graph.isPlace(ex[i])) exploredMarker(ex[i], a).addTo(layers.explored);
      }
    }
  }

  function animateSearch(runs, token, done) {
    const algos = ["dijkstra", "astar"].filter((a) => runs[a]);
    const idx = Object.fromEntries(algos.map((a) => [a, 0]));
    const status = $("#map-status");
    status.hidden = false;

    // Wait for the fly-to so the animation plays on screen.
    setTimeout(function frame() {
      if (token !== state.runToken) return;
      const perFrame = SPEEDS[state.speed - 1];
      let remaining = false;
      for (const a of algos) {
        const ex = runs[a].explored;
        const end = Math.min(ex.length, idx[a] + perFrame);
        for (let i = idx[a]; i < end; i++) {
          if (!graph.isPlace(ex[i])) exploredMarker(ex[i], a).addTo(layers.explored);
        }
        idx[a] = end;
        if (end < ex.length) remaining = true;
      }
      status.innerHTML = algos.map((a) => `
        <span class="ms-item"><span class="ms-dot" style="background:${a === "astar" ? "var(--astar)" : "var(--dijkstra)"}"></span>
        ${ALGOS[a].label}: ${idx[a]} / ${runs[a].explored.length} nodes</span>`).join("");
      if (remaining) requestAnimationFrame(frame);
      else done();
    }, 450);
  }

  function routeLatLngs(result) {
    const coords = [];
    result.edges.forEach((eid, i) => {
      const e = graph.edges[eid];
      if (e.kind === "entrance") return;
      const seg = e.a === result.path[i] ? e.coords : e.coords.slice().reverse();
      coords.push(...(coords.length ? seg.slice(1) : seg));
    });
    return coords;
  }

  function drawRoute(result) {
    const coords = routeLatLngs(result);
    const routeColor = getComputedStyle(document.documentElement).getPropertyValue("--route").trim() || "#c8102e";
    const entranceStyle = { pane: ROUTE_PANE, color: routeColor, weight: 3, dashArray: "4 6", opacity: 0.9, interactive: false };
    const first = result.path[1], last = result.path[result.path.length - 2];
    L.polyline([[state.from.lat, state.from.lon], [graph.lat[first], graph.lon[first]]], entranceStyle).addTo(layers.route);
    L.polyline([[graph.lat[last], graph.lon[last]], [state.to.lat, state.to.lon]], entranceStyle).addTo(layers.route);
    if (coords.length > 1) {
      L.polyline(coords, { pane: ROUTE_PANE, color: isDark() ? "#000" : "#fff", weight: 10, opacity: 0.9, interactive: false }).addTo(layers.route);
      L.polyline(coords, { pane: ROUTE_PANE, color: routeColor, weight: 6, opacity: 1, interactive: false }).addTo(layers.route);
      L.polyline(coords, { pane: ROUTE_PANE, color: "#fff", weight: 2, opacity: 0.8, dashArray: "2 10", className: "route-flow", interactive: false }).addTo(layers.route);
    }
  }

  // ------------------------------------------------------------------ results panel
  function statTile(value, unit, label) {
    return `<div class="stat"><div class="v">${value}${unit ? `<small>${unit}</small>` : ""}</div><div class="k">${label}</div></div>`;
  }

  function renderNoRoute() {
    const el = $("#results");
    el.hidden = false;
    el.innerHTML = `<p class="no-route">No route found between <strong>${esc(state.from.name)}</strong> and <strong>${esc(state.to.name)}</strong>${state.accessible ? " without stairs. Try turning off <em>Accessible route</em>." : "."}</p>`;
  }

  function renderResults(runs, main, steps) {
    const el = $("#results");
    const minutes = Math.max(1, Math.round(main.distance / WALK_M_PER_MIN));
    const stairs = main.edges.filter((e) => graph.edges[e].kind === "steps").length;
    const badges = state.algo === "compare"
      ? `<span class="badge astar">A*</span> <span class="badge dijkstra">Dijkstra</span>`
      : `<span class="badge ${state.algo}">${ALGOS[state.algo].label}</span>`;

    let html = `
      <div class="res-head">
        <div class="res-title">${esc(state.from.name)} <span>→</span> ${esc(state.to.name)}</div>
        <div>${state.accessible ? '<span class="badge access">Step-free</span> ' : ""}${badges}</div>
      </div>
      <div class="stats">
        ${statTile(fmtDist(main.distance).split(" ")[0], fmtDist(main.distance).split(" ")[1], `Distance · ${fmtMiles(main.distance)}`)}
        ${statTile(minutes, "min", "Walking time")}`;

    if (state.algo !== "compare") {
      html += `
        ${statTile(main.explored.length, "", `Nodes explored of ${graph.nodeCount}`)}
        ${statTile(fmtMs(main.avgMs).split(" ")[0], fmtMs(main.avgMs).split(" ")[1], "Compute time")}
      </div>`;
    } else {
      const a = runs.astar, d = runs.dijkstra;
      const saved = Math.round(100 - (100 * a.explored.length) / d.explored.length);
      const same = Math.abs(a.cost - d.cost) < 1e-6;
      const max = Math.max(a.explored.length, d.explored.length);
      const row = (k, av, dv, fmt, lowerWins = true) => {
        const aw = lowerWins ? av < dv : av > dv, dw = lowerWins ? dv < av : dv > av;
        return `<tr><td>${k}</td><td class="${aw ? "win" : ""}">${fmt(av)}</td><td class="${dw ? "win" : ""}">${fmt(dv)}</td></tr>`;
      };
      html += `
        ${statTile(a.explored.length, "", "A* nodes explored")}
        ${statTile(d.explored.length, "", "Dijkstra nodes explored")}
      </div>
      <div class="compare">
        <p class="compare-headline" style="margin-top:12px">
          A* explored <strong>${saved}% fewer nodes</strong> ${same ? `and found the <strong>same ${fmtDist(a.distance)} route</strong>` : "for this trip"}.
        </p>
        <div class="bar-row"><span class="name" style="color:var(--astar)">A*</span><div class="track"><div class="fill" style="width:0;background:var(--astar)" data-w="${(100 * a.explored.length) / max}"></div></div><span class="num">${a.explored.length}</span></div>
        <div class="bar-row"><span class="name" style="color:var(--dijkstra)">Dijkstra</span><div class="track"><div class="fill" style="width:0;background:var(--dijkstra)" data-w="${(100 * d.explored.length) / max}"></div></div><span class="num">${d.explored.length}</span></div>
        <table class="cmp-table">
          <thead><tr><th>Metric</th><th>A*</th><th>Dijkstra</th></tr></thead>
          <tbody>
            ${row("Nodes explored", a.explored.length, d.explored.length, String)}
            ${row("Edges relaxed", a.relaxations, d.relaxations, String)}
            ${row("Heap pushes", a.pushes, d.pushes, String)}
            ${row("Compute time", a.avgMs, d.avgMs, fmtMs)}
            ${row("Route cost", a.cost, d.cost, (v) => v.toFixed(1))}
          </tbody>
        </table>
      </div>`;
    }

    html += `
      <div class="dir-head">
        <h2 class="section-label">Directions · ${steps.length} steps${stairs ? ` · ${stairs} stair${stairs > 1 ? "s" : ""}` : ""}</h2>
        <button class="link-btn" id="fit-route">Show whole route</button>
      </div>
      <ol class="directions">
        ${steps.map((s, i) => `
          <li data-step="${i}" tabindex="0">
            <span class="dir-icon"><svg viewBox="0 0 24 24">${ICONS[s.icon] || ICONS.straight}</svg></span>
            <span class="dir-text">${esc(s.text)}</span>
            <span class="dir-dist">${s.distance ? fmtDist(s.distance) : ""}</span>
          </li>`).join("")}
      </ol>`;

    el.innerHTML = html;
    el.hidden = false;
    requestAnimationFrame(() => el.querySelectorAll(".fill").forEach((f) => { f.style.width = f.dataset.w + "%"; }));

    const routeBounds = L.latLngBounds(main.path.map((n) => [graph.lat[n], graph.lon[n]]));
    $("#fit-route").addEventListener("click", () => { layers.highlight.clearLayers(); el.querySelectorAll(".directions li").forEach((x) => x.classList.remove("active")); map.flyToBounds(routeBounds.pad(0.25), { duration: 0.5 }); });

    el.querySelectorAll(".directions li").forEach((li) => {
      const step = steps[+li.dataset.step];
      const show = (zoom) => {
        layers.highlight.clearLayers();
        L.polyline(step.coords, { pane: ROUTE_PANE, color: "#facc15", weight: 9, opacity: 0.95, interactive: false }).addTo(layers.highlight);
        if (zoom) {
          el.querySelectorAll(".directions li").forEach((x) => x.classList.toggle("active", x === li));
          map.flyToBounds(L.latLngBounds(step.coords).pad(0.6), { duration: 0.4, maxZoom: 19 });
        }
      };
      li.addEventListener("mouseenter", () => show(false));
      li.addEventListener("mouseleave", () => { if (!li.classList.contains("active")) layers.highlight.clearLayers(); });
      li.addEventListener("click", () => show(true));
      li.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); show(true); } });
    });

    if (window.matchMedia("(max-width: 860px)").matches) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ------------------------------------------------------------------ explore list
  function renderChips() {
    const counts = {};
    graph.places.forEach((p) => { counts[p.cat] = (counts[p.cat] || 0) + 1; });
    const chips = [`<button class="chip" data-cat="all" aria-pressed="${state.category === "all"}">All ${graph.places.length}</button>`]
      .concat(Object.entries(CATEGORIES).filter(([k]) => counts[k]).map(([k, c]) =>
        `<button class="chip" data-cat="${k}" aria-pressed="${state.category === k}"><span class="cat-dot" style="background:${c.color}"></span>${c.label}</button>`));
    $("#chips").innerHTML = chips.join("");
  }

  function renderPlaceList() {
    const list = graph.places
      .filter((p) => state.category === "all" || p.cat === state.category)
      .sort((a, b) => a.name.localeCompare(b.name));
    $("#place-list").innerHTML = list.map((p) => `
      <li data-place="${p.id}" tabindex="0">
        <span class="cat-dot" style="background:${CATEGORIES[p.cat].color}"></span>
        <div class="p-text"><div class="p-name">${esc(p.name)}</div><div class="p-desc">${esc(p.desc)}</div></div>
        <div class="mini-btns">
          <button class="mini-btn" data-set="from" data-place="${p.id}" title="Start here">From</button>
          <button class="mini-btn" data-set="to" data-place="${p.id}" title="Go here">To</button>
        </div>
      </li>`).join("");
    // Dim places outside the selected category on the map.
    for (const p of graph.places) placeShapes.get(p.id).setStyle(placeStyle(p));
  }

  $("#chips").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    state.category = chip.dataset.cat;
    renderChips();
    renderPlaceList();
  });

  $("#place-list").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-set]");
    if (btn) { setEndpoint(btn.dataset.set, graph.place(btn.dataset.place)); return; }
    const li = e.target.closest("li[data-place]");
    if (!li) return;
    const p = graph.place(li.dataset.place);
    map.flyTo([p.lat, p.lon], 18, { duration: 0.5 });
    map.once("moveend", () => placeShapes.get(p.id).openPopup([p.lat, p.lon]));
  });
  $("#place-list").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.matches("li[data-place]")) e.target.click();
  });

  // ------------------------------------------------------------------ shareable URL
  function writeHash() {
    const params = new URLSearchParams();
    if (state.from) params.set("from", state.from.id);
    if (state.to) params.set("to", state.to.id);
    if (state.algo !== "astar") params.set("algo", state.algo);
    if (state.accessible) params.set("accessible", "1");
    if (view.basemap !== "campus") params.set("map", view.basemap);
    history.replaceState(null, "", params.toString() ? `#${params}` : location.pathname + location.search);
  }

  function readHash() {
    const params = new URLSearchParams(location.hash.slice(1));
    const algo = params.get("algo");
    if (BASEMAPS[params.get("map")]) setBasemap(params.get("map"));
    if (algo && ALGOS[algo]) document.querySelector(`.segmented [data-algo="${algo}"]`).click();
    if (params.get("accessible") === "1") { state.accessible = true; $("#opt-accessible").checked = true; }
    if (params.get("animate") === "0") { state.animate = false; $("#opt-animate").checked = false; $("#speed-row").hidden = true; }
    const from = graph.place(params.get("from")), to = graph.place(params.get("to"));
    if (from) { state.from = from; syncField("from"); }
    if (to) { state.to = to; syncField("to"); }
    drawMarkers();
    $("#go").disabled = !(state.from && state.to && state.from !== state.to);
    writeHash();
    if (state.from && state.to && state.from !== state.to) findRoute();
  }

  // ------------------------------------------------------------------ boot
  $("#graph-stats").textContent = `${graph.walkNodeCount.toLocaleString()} nodes · ${graph.edges.length.toLocaleString()} edges · ${graph.places.length} places`;
  styleBasemap();
  setBasemap(view.basemap);
  state.ready = true;
  renderChips();
  renderPlaceList();
  readHash();
  requestAnimationFrame(declutter);
})();
