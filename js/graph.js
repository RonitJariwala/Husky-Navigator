/*
 * Campus graph model.
 *
 * Walkway intersections become graph nodes; each campus place adds one extra "place node"
 * at its centre, linked to its entrances. Edge cost = walked length × a walkability factor,
 * and every factor is >= 1, so the straight-line distance is a valid (admissible) A* heuristic.
 */
(function (root) {
  "use strict";

  const EARTH_R = 6371008.8;
  const RAD = Math.PI / 180;

  function haversine(lat1, lon1, lat2, lon2) {
    const dLat = (lat2 - lat1) * RAD;
    const dLon = (lon2 - lon1) * RAD;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_R * Math.asin(Math.sqrt(a));
  }

  function bearing(lat1, lon1, lat2, lon2) {
    const y = Math.sin((lon2 - lon1) * RAD) * Math.cos(lat2 * RAD);
    const x = Math.cos(lat1 * RAD) * Math.sin(lat2 * RAD) -
      Math.sin(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.cos((lon2 - lon1) * RAD);
    return (Math.atan2(y, x) / RAD + 360) % 360;
  }

  // How much "longer" each kind of segment feels to walk.
  const KIND_FACTOR = {
    path: 1.0,      // footpaths, quads, pedestrian ways
    sidewalk: 1.0,
    indoor: 1.0,    // building corridors
    entrance: 1.0,  // entrance -> centre of a building
    crossing: 1.2,  // waiting at crosswalks
    steps: 1.25,    // slower; removed entirely in accessible mode
    street: 1.15,   // service roads / small streets without sidewalks mapped
    road: 1.6,      // centre line of arterial roads — strongly prefer sidewalks
  };

  class CampusGraph {
    constructor(data) {
      const kinds = data.meta.kinds;
      this.names = data.names;
      this.places = data.places;
      this.placeIndex = new Map();

      const nWalk = data.nodes.length;
      const n = nWalk + data.places.length;
      this.nodeCount = n;
      this.walkNodeCount = nWalk;
      this.lat = new Float64Array(n);
      this.lon = new Float64Array(n);
      this.placeOfNode = new Int32Array(n).fill(-1);
      data.nodes.forEach(([la, lo], i) => { this.lat[i] = la; this.lon[i] = lo; });

      this.edges = [];
      this.adj = Array.from({ length: n }, () => []);

      for (const [a, b, kindIdx, nameIdx, , mid] of data.edges) {
        const coords = [[this.lat[a], this.lon[a]]];
        for (let i = 0; i < mid.length; i += 2) coords.push([mid[i], mid[i + 1]]);
        coords.push([this.lat[b], this.lon[b]]);
        this._addEdge(a, b, kinds[kindIdx], nameIdx >= 0 ? this.names[nameIdx] : null, coords);
      }

      data.places.forEach((p, i) => {
        const node = nWalk + i;
        this.lat[node] = p.lat;
        this.lon[node] = p.lon;
        this.placeOfNode[node] = i;
        p.node = node;
        this.placeIndex.set(p.id, p);
        for (const e of p.entrances) {
          this._addEdge(e, node, "entrance", p.name, [[this.lat[e], this.lon[e]], [p.lat, p.lon]]);
        }
      });
    }

    _addEdge(a, b, kind, name, coords) {
      let length = 0;
      for (let i = 1; i < coords.length; i++) {
        length += haversine(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
      }
      const id = this.edges.length;
      this.edges.push({ id, a, b, kind, name, coords, length });
      this.adj[a].push(id);
      this.adj[b].push(id);
    }

    other(edge, node) { return edge.a === node ? edge.b : edge.a; }

    /** Walking cost of an edge, or Infinity if the edge is not allowed under `opts`. */
    cost(edge, opts) {
      if (opts && opts.avoidStairs && edge.kind === "steps") return Infinity;
      return edge.length * KIND_FACTOR[edge.kind];
    }

    /** Straight-line distance in metres — never more than the true walking cost. */
    heuristic(u, v) {
      return haversine(this.lat[u], this.lon[u], this.lat[v], this.lon[v]);
    }

    isPlace(node) { return this.placeOfNode[node] >= 0; }

    place(id) { return this.placeIndex.get(id); }
  }

  const api = { CampusGraph, haversine, bearing, KIND_FACTOR };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== "undefined" ? window : globalThis);
