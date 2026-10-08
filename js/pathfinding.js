/*
 * Shortest-path algorithms: Dijkstra and A*.
 *
 * Both are the same best-first search over a binary min-heap; they differ only in the
 * priority used to pick the next node:
 *   Dijkstra:  f(n) = g(n)            (cost so far)
 *   A*:        f(n) = g(n) + h(n)     (cost so far + straight-line distance to the goal)
 * Because h never overestimates, A* returns the same optimal cost while settling fewer nodes.
 */
(function (root) {
  "use strict";

  /** Binary min-heap keyed by priority. Stale entries are skipped by the caller (lazy deletion). */
  class MinHeap {
    constructor() { this.items = []; this.prios = []; }
    get size() { return this.items.length; }

    push(item, prio) {
      const it = this.items, pr = this.prios;
      let i = it.length;
      it.push(item); pr.push(prio);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (pr[p] <= prio) break;
        it[i] = it[p]; pr[i] = pr[p];
        i = p;
      }
      it[i] = item; pr[i] = prio;
    }

    pop() {
      const it = this.items, pr = this.prios;
      const top = it[0], topPrio = pr[0];
      const lastItem = it.pop(), lastPrio = pr.pop();
      const n = it.length;
      if (n > 0) {
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i, mp = lastPrio;
          if (l < n && pr[l] < mp) { m = l; mp = pr[l]; }
          if (r < n && pr[r] < mp) { m = r; mp = pr[r]; }
          if (m === i) break;
          it[i] = it[m]; pr[i] = pr[m];
          i = m;
        }
        it[i] = lastItem; pr[i] = lastPrio;
      }
      return { item: top, prio: topPrio };
    }
  }

  function bestFirstSearch(graph, source, target, opts, useHeuristic) {
    const t0 = (typeof performance !== "undefined" ? performance : Date).now();
    const n = graph.nodeCount;
    const g = new Float64Array(n).fill(Infinity);
    const prevEdge = new Int32Array(n).fill(-1);
    const settled = new Uint8Array(n);
    const explored = [];   // nodes in the order they were settled (for visualisation)
    const heap = new MinHeap();
    const h = useHeuristic ? (u) => graph.heuristic(u, target) : () => 0;
    let pushes = 1, relaxations = 0;

    g[source] = 0;
    heap.push(source, h(source));

    while (heap.size) {
      const { item: u } = heap.pop();
      if (settled[u]) continue;           // stale heap entry
      settled[u] = 1;
      explored.push(u);
      if (u === target) break;
      // A place node is a destination, never a shortcut through a building.
      if (u !== source && graph.isPlace(u)) continue;

      for (const eid of graph.adj[u]) {
        const e = graph.edges[eid];
        const v = graph.other(e, u);
        if (settled[v]) continue;
        const w = graph.cost(e, opts);
        if (w === Infinity) continue;
        relaxations++;
        const nd = g[u] + w;
        if (nd < g[v]) {
          g[v] = nd;
          prevEdge[v] = eid;
          heap.push(v, nd + h(v));
          pushes++;
        }
      }
    }

    const timeMs = (typeof performance !== "undefined" ? performance : Date).now() - t0;
    const result = {
      algorithm: useHeuristic ? "astar" : "dijkstra",
      found: settled[target] === 1,
      cost: g[target],
      distance: 0,
      path: [],
      edges: [],
      explored,
      pushes,
      relaxations,
      timeMs,
    };
    if (!result.found) return result;

    for (let v = target; v !== source;) {
      const e = graph.edges[prevEdge[v]];
      result.edges.push(e.id);
      result.path.push(v);
      result.distance += e.length;
      v = graph.other(e, v);
    }
    result.path.push(source);
    result.path.reverse();
    result.edges.reverse();
    return result;
  }

  const dijkstra = (graph, s, t, opts) => bestFirstSearch(graph, s, t, opts, false);
  const astar = (graph, s, t, opts) => bestFirstSearch(graph, s, t, opts, true);

  const api = { MinHeap, dijkstra, astar };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else Object.assign(root, { PathFinding: api });
})(typeof window !== "undefined" ? window : globalThis);
