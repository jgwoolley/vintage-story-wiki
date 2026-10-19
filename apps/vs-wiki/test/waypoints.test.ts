import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCoords, importModData, isModData, modDataSavegames, shortestPath, deserializeWayPoints } from "../site/assets/waypoints.js";

// Shape of the translocator-locator mod's Nf3tData.json (hand-built, not a real save).
const modData = {
  TranslocatorsPerSavegame: {
    a: [
      { Position: { X: 10, Y: 5, Z: 10 }, TargetLocation: { X: 1000, Y: 6, Z: 1000 } },
      { Position: { X: 1000, Y: 6, Z: 1000 }, TargetLocation: { X: 10, Y: 5, Z: 10 } },
      { Position: { X: 50, Y: 5, Z: 50 }, TargetLocation: null },
    ],
    b: [],
  },
  WayPointsPerSavegame: { a: [{ Name: "Home", CodePath: "x", Icon: "star", Color: "blue", Pos: { X: 0, Z: 0, InternalY: 100 } },
    { Name: "Broken static translocator", CodePath: "statictranslocator-broken-north", Pos: { X: 11, Z: 10, InternalY: 5 } }], b: [] },
  DefaultSpawnPositionPerSavegame: { a: { X: 512000, Y: 135, Z: 512000 } },
  LastTranslocatorPathPerSavegame: { a: { StartPos: { X: 5, Y: 1, Z: 5 }, GoalPos: { X: 1005, Y: 1, Z: 1005 } } },
};

test("isModData tells the mod file from the tool's own export", () => {
  assert.ok(isModData(modData));
  assert.ok(!isModData({ waypoints: [] }));
  assert.ok(!isModData(null));
});

test("modDataSavegames lists non-empty savegames, busiest first", () => {
  assert.deepEqual(modDataSavegames(modData), [{ id: "a", translocators: 3, waypoints: 2 }]);
});

test("importModData builds linked translocators, waypoints, spawn and the last route", () => {
  const state = importModData(modData, "a");
  // The second game waypoint sits on the translocator at (10,5,10), so only the translocator remains.
  assert.equal(state.waypoints.length, 3 + 1 + 3);
  assert.ok(!state.waypoints.some((w) => w.label === "Broken static translocator"));
  assert.deepEqual(state.spawn, { x: 512000, y: 135, z: 512000 });
  const t = state.waypoints.find((w) => w.id === "translocator:10,5,10")!;
  assert.equal(t.connection, "translocator:1000,6,1000");
  assert.equal(state.waypoints.find((w) => w.id === "translocator:50,5,50")!.connection, undefined);
  assert.deepEqual(state.waypoints.find((w) => w.id === "waypoint:0"), { id: "waypoint:0", label: "Home", x: 0, z: 0, height: 100, pinned: false, color: "blue", icon: "star" });
  assert.equal(state.source, "path-start");
  assert.equal(state.destination, "path-goal");
  // The result is valid planner state, and the translocator pair is a free hop in the route.
  const round = deserializeWayPoints({ waypoints: state.waypoints });
  const steps = shortestPath(round.waypoints, "path-start", "path-goal");
  assert.ok(steps.some((s) => s.distance === 0));
});

test("formatCoords is relative to spawn when known, absolute otherwise", () => {
  const w = { id: "w", label: "w", x: 512010, z: 511990, height: 140, pinned: false, color: "red", icon: "circle" };
  assert.equal(formatCoords(w, { x: 512000, y: 135, z: 512000 }), "10, 5, -10");
  assert.equal(formatCoords(w), "512010, 140, 511990");
});
