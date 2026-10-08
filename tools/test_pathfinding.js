#!/usr/bin/env node
/*
 * Verifies the routing engine on the real dataset:
 *   - every pair of campus places is reachable
 *   - A* and Dijkstra always return the same (optimal) cost
 *   - A* never settles more nodes than Dijkstra
 *   - accessible mode never uses stairs
 *   - directions can be generated for every route
 * Run:  node tools/test_pathfinding.js
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../data/campus-data.js"), "utf8"), sandbox);
const data = sandbox.window.CAMPUS_DATA;

const { CampusGraph } = require("../js/graph.js");
const { dijkstra, astar, MinHeap } = require("../js/pathfinding.js");
const { buildDirections } = require("../js/directions.js");

let failures = 0;
const check = (ok, msg) => { if (!ok) { failures++; console.error("  ✗ " + msg); } };

// MinHeap sanity
const heap = new MinHeap();
const nums = Array.from({ length: 500 }, () => Math.random());
nums.forEach((x, i) => heap.push(i, x));
const popped = [];
while (heap.size) popped.push(heap.pop().prio);
check(popped.every((x, i) => i === 0 || popped[i - 1] <= x), "MinHeap pops in sorted order");

const graph = new CampusGraph(data);
const places = graph.places;
console.log(`Graph: ${graph.walkNodeCount} walkway nodes, ${graph.edges.length} edges, ${places.length} places`);

let pairs = 0, aSettled = 0, dSettled = 0, aTime = 0, dTime = 0, maxDist = 0;
for (const accessible of [false, true]) {
  const opts = { avoidStairs: accessible };
  for (const from of places) {
    for (const to of places) {
      if (from === to) continue;
      const d = dijkstra(graph, from.node, to.node, opts);
      const a = astar(graph, from.node, to.node, opts);
      const tag = `${from.name} → ${to.name}${accessible ? " (accessible)" : ""}`;
      check(d.found && a.found, `reachable: ${tag}`);
      check(Math.abs(d.cost - a.cost) < 1e-6, `equal cost: ${tag} (dijkstra ${d.cost.toFixed(2)} vs A* ${a.cost.toFixed(2)})`);
      check(a.explored.length <= d.explored.length, `A* settles ≤ Dijkstra: ${tag}`);
      if (accessible) check(a.edges.every((e) => graph.edges[e].kind !== "steps"), `no stairs: ${tag}`);
      const inner = a.path.slice(1, -1).filter((n) => graph.isPlace(n));
      check(inner.length === 0, `no cutting through buildings: ${tag}`);
      const steps = buildDirections(graph, a, from, to);
      check(steps.length >= 2 && steps[steps.length - 1].icon === "arrive", `directions: ${tag}`);
      pairs++; aSettled += a.explored.length; dSettled += d.explored.length;
      aTime += a.timeMs; dTime += d.timeMs; maxDist = Math.max(maxDist, a.distance);
    }
  }
}

console.log(`Checked ${pairs} routes (normal + accessible). Longest route: ${maxDist.toFixed(0)} m`);
console.log(`Avg nodes settled — Dijkstra: ${(dSettled / pairs).toFixed(0)}, A*: ${(aSettled / pairs).toFixed(0)} ` +
  `(${(100 - (100 * aSettled) / dSettled).toFixed(0)}% fewer)`);
console.log(`Avg time — Dijkstra: ${(dTime / pairs).toFixed(3)} ms, A*: ${(aTime / pairs).toFixed(3)} ms`);
if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nAll checks passed ✓");
