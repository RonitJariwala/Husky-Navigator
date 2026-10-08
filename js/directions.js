/*
 * Turns a path (list of edges) into human-readable, turn-by-turn walking directions.
 */
(function (root) {
  "use strict";

  const bearingFn = root.bearing || (typeof require !== "undefined" && require("./graph.js").bearing);

  const KIND_LABEL = {
    path: "the walkway",
    sidewalk: "the sidewalk",
    crossing: "the crosswalk",
    steps: "the stairs",
    indoor: "the indoor corridor",
    street: "the street",
    road: "the road",
  };
  const CARDINAL = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];

  function turnOf(delta) {
    const a = Math.abs(delta), side = delta < 0 ? "left" : "right";
    if (a < 25) return { verb: "Continue", icon: "straight" };
    if (a < 60) return { verb: `Bear ${side}`, icon: `slight-${side}` };
    if (a < 145) return { verb: `Turn ${side}`, icon: side };
    return { verb: "Turn around", icon: "uturn" };
  }

  // Bearing over the first/last ~15 m of a polyline, so tiny kinks don't count as turns.
  function headingAt(coords, fromEnd) {
    const pts = fromEnd ? coords.slice().reverse() : coords;
    const [lat0, lon0] = pts[0];
    let j = 1, d = 0;
    while (j < pts.length - 1 && d < 15) {
      d += Math.hypot((pts[j][0] - pts[j - 1][0]) * 111320, (pts[j][1] - pts[j - 1][1]) * 82000);
      if (d < 15) j++;
    }
    const b = bearingFn(lat0, lon0, pts[j][0], pts[j][1]);
    return fromEnd ? (b + 180) % 360 : b;
  }

  // Signed turn angle (-180..180, negative = left) when walking from leg `prev` into leg `next`.
  function turnBetween(prev, next) {
    return ((headingAt(next.coords, false) - headingAt(prev.coords, true) + 540) % 360) - 180;
  }

  function build(graph, result, fromPlace, toPlace) {
    // 1. Orient every edge in the direction of travel and group by (kind, street name).
    const legs = [];
    result.edges.forEach((eid, i) => {
      const e = graph.edges[eid];
      if (e.kind === "entrance") return;
      const forward = e.a === result.path[i];
      const coords = forward ? e.coords : e.coords.slice().reverse();
      const label = e.name || KIND_LABEL[e.kind];
      const last = legs[legs.length - 1];
      const sameAsLast = last && last.label === label && last.kind === e.kind;
      if (sameAsLast && Math.abs(turnBetween(last, { coords })) < 45) {
        last.coords = last.coords.concat(coords.slice(1));
        last.distance += e.length;
      } else {
        legs.push({ kind: e.kind, label, named: !!e.name, coords, distance: e.length });
      }
    });

    // 2. Fold tiny connector legs (< 8 m) into their neighbour, then re-merge legs that now
    //    run back-to-back on the same street.
    const absorb = (into, l) => { into.coords = into.coords.concat(l.coords.slice(1)); into.distance += l.distance; };
    for (let i = legs.length - 1; i >= 1; i--) {
      const l = legs[i];
      if (l.distance < 8 && l.kind !== "steps" && l.kind !== "crossing") {
        absorb(legs[i - 1], l);
        legs.splice(i, 1);
      }
    }
    for (let i = legs.length - 1; i >= 1; i--) {
      const a = legs[i - 1], b = legs[i];
      if (b.label === a.label && b.kind === a.kind && (b.named || Math.abs(turnBetween(a, b)) < 25)) {
        absorb(legs[i - 1], legs[i]);
        legs.splice(i, 1);
      }
    }

    // 3. Phrase each leg.
    const steps = [];
    if (!legs.length) {
      const entrance = result.path[1];
      steps.push({
        text: `Exit ${fromPlace.name} — ${toPlace.name} is right next door`,
        icon: "start", distance: result.distance, kind: "path",
        coords: [[fromPlace.lat, fromPlace.lon], [graph.lat[entrance], graph.lon[entrance]]],
      });
    }
    legs.forEach((leg, i) => {
      let text, icon;
      if (i === 0) {
        const dir = CARDINAL[Math.round(headingAt(leg.coords, false) / 45) % 8];
        text = `Leave ${fromPlace.name} and head ${dir} on ${leg.label}`;
        icon = "start";
      } else {
        const t = turnOf(turnBetween(legs[i - 1], leg));
        icon = t.icon;
        if (leg.kind === "crossing") text = `${t.verb} and cross ${leg.named ? leg.label : "the street"}`;
        else if (leg.kind === "steps") { text = `${t.verb} and take the stairs`; icon = "stairs"; }
        else if (leg.kind === "indoor") text = `${t.verb} through the indoor corridor`;
        else if (t.verb === "Continue") text = `Continue on ${leg.label}`;
        else text = `${t.verb} onto ${leg.label}`;
      }
      steps.push({ text, icon, distance: leg.distance, coords: leg.coords, kind: leg.kind });
    });
    const tail = steps.length ? steps[steps.length - 1].coords : [[toPlace.lat, toPlace.lon]];
    steps.push({ text: `Arrive at ${toPlace.name}`, icon: "arrive", distance: 0, coords: [tail[tail.length - 1], [toPlace.lat, toPlace.lon]], kind: "arrive" });
    return steps;
  }

  const api = { buildDirections: build };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== "undefined" ? window : globalThis);
