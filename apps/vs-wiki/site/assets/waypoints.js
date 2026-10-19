// WayPoint tool logic (site/tools/waypoints/index.njk). Ported from the vintage-story-price-guide
// project's utils.ts: pure data/path functions with no DOM, so they're easy to reason about.
//
// A waypoint is { id, label, x, z, height, pinned, color, icon, connection? } where x/z are
// ground-plane world coordinates, `height` is Y, and `connection` is the id of another waypoint
// it is linked to by a translocator (traveling between connected waypoints costs 0 distance).

/** Straight-line ground distance between two waypoints; 0 if a translocator links them. */
export function calculateDistance(source, destination) {
  if (source.connection === destination.id || destination.connection === source.id) return 0;
  return Math.hypot(source.x - destination.x, source.z - destination.z);
}

/**
 * Cheapest route between two waypoints. The graph is complete (you can walk between any two
 * waypoints) with `calculateDistance` as edge weights, so plain O(n^2) Dijkstra is plenty.
 * Returns [{ from, to, distance }, ...] (empty if from === to or either id is unknown).
 */
export function shortestPath(waypoints, sourceId, destinationId) {
  const byId = new Map(waypoints.map((w) => [w.id, w]));
  if (!byId.has(sourceId) || !byId.has(destinationId) || sourceId === destinationId) return [];
  const dist = new Map(waypoints.map((w) => [w.id, Infinity]));
  const prev = new Map();
  const done = new Set();
  dist.set(sourceId, 0);
  while (done.size < waypoints.length) {
    let current = null;
    for (const w of waypoints) {
      if (!done.has(w.id) && (current === null || dist.get(w.id) < dist.get(current.id))) current = w;
    }
    if (current === null || dist.get(current.id) === Infinity) break;
    done.add(current.id);
    if (current.id === destinationId) break;
    for (const other of waypoints) {
      if (done.has(other.id)) continue;
      const candidate = dist.get(current.id) + calculateDistance(current, other);
      if (candidate < dist.get(other.id)) {
        dist.set(other.id, candidate);
        prev.set(other.id, current.id);
      }
    }
  }
  const steps = [];
  for (let id = destinationId; prev.has(id); id = prev.get(id)) {
    const from = byId.get(prev.get(id));
    const to = byId.get(id);
    steps.unshift({ from, to, distance: calculateDistance(from, to) });
  }
  return steps;
}

/** "X, Y, Z" for display: relative to `spawn` ({x, y, z}, as the game shows coordinates) when given, else absolute. */
export function formatCoords(w, spawn) {
  return spawn ? `${w.x - spawn.x}, ${w.height - spawn.y}, ${w.z - spawn.z}` : `${w.x}, ${w.height}, ${w.z}`;
}

export function stringifyWayPoint(w, spawn) {
  return `${w.label} (${formatCoords(w, spawn)})`;
}

/** The in-game chat command that recreates this waypoint. */
export function getWaypointCommand({ icon, height, pinned, color, label, x, z }) {
  return `/waypoint addati ${icon} ${x} ${height} ${z} ${pinned ? "true" : "false"} ${color} ${label}`;
}

/** Serialized shape (what Download writes / Upload reads). */
export function serializeWayPoints({ waypoints, source, destination, createdTime, spawn }) {
  return {
    createdTime: createdTime ?? new Date().toISOString(),
    modifiedTime: new Date().toISOString(),
    source,
    destination,
    spawn,
    waypoints: waypoints.map((w) => ({ ...w })),
  };
}

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * Validate parsed JSON; returns { waypoints, source, destination, createdTime } or throws an
 * Error with a human-readable reason. Also accepts the price guide's older export shape
 * ({ data: {id,label,height,...}, position: {x, y}, connection }), where position.y is the z axis.
 */
export function deserializeWayPoints(json) {
  if (!json || !Array.isArray(json.waypoints)) throw new Error("Expected an object with a `waypoints` array.");
  const ids = new Set();
  const waypoints = json.waypoints.map((row, i) => {
    const legacy = row?.data && row?.position;
    const w = legacy
      ? { id: row.data.id, label: row.data.label, height: row.data.height, x: row.position.x, z: row.position.y,
          pinned: row.data.pinned, color: row.data.color, icon: row.data.icon, connection: row.connection }
      : row;
    if (typeof w?.id !== "string" || !w.id) throw new Error(`Waypoint #${i + 1} has no id.`);
    if (ids.has(w.id)) throw new Error(`Duplicate waypoint id: ${w.id}`);
    ids.add(w.id);
    if (!isNum(w.x) || !isNum(w.z) || !isNum(w.height)) throw new Error(`Waypoint "${w.label ?? w.id}" needs numeric x, z and height.`);
    return {
      id: w.id, label: String(w.label ?? w.id), x: w.x, z: w.z, height: w.height,
      pinned: Boolean(w.pinned), color: w.color || "red", icon: w.icon || "circle",
      connection: typeof w.connection === "string" ? w.connection : undefined,
    };
  });
  for (const w of waypoints) if (w.connection && !ids.has(w.connection)) w.connection = undefined;
  return { waypoints, source: json.source, destination: json.destination, createdTime: json.createdTime,
    spawn: [json.spawn?.x, json.spawn?.y, json.spawn?.z].every(isNum) ? json.spawn : undefined };
}

// ---- Mod data (Nf3tData.json) ----
// The translocator-locator mod (https://github.com/jgwoolley/translocator-locator-cmd) writes
// Nf3tData.json into the game's ModData folder: everything is keyed by savegame GUID.
//   TranslocatorsPerSavegame[guid]       [{ Position: {X,Y,Z}, TargetLocation: {X,Y,Z} | null }]
//   WayPointsPerSavegame[guid]           [{ Name, CodePath, Icon, Color, Pos: {X, Z, InternalY} }]
//   DefaultSpawnPositionPerSavegame[guid] {X,Y,Z}
//   LastTranslocatorPathPerSavegame[guid] { StartPos, GoalPos }
// One savegame at a time becomes the planner's waypoint list.

/** True for the mod's Nf3tData.json shape (as opposed to this tool's own export). */
export function isModData(json) {
  return Boolean(json && typeof json === "object" && !Array.isArray(json) && (json.TranslocatorsPerSavegame || json.WayPointsPerSavegame));
}

/** Savegames in the mod data that have anything to import, busiest first: [{ id, translocators, waypoints }]. */
export function modDataSavegames(json) {
  const ids = new Set([...Object.keys(json.TranslocatorsPerSavegame ?? {}), ...Object.keys(json.WayPointsPerSavegame ?? {})]);
  return [...ids]
    .map((id) => ({ id, translocators: json.TranslocatorsPerSavegame?.[id]?.length ?? 0, waypoints: json.WayPointsPerSavegame?.[id]?.length ?? 0 }))
    .filter((s) => s.translocators + s.waypoints > 0)
    .sort((a, b) => b.translocators + b.waypoints - (a.translocators + a.waypoints));
}

const posKey = (p) => `${p.X},${p.Y},${p.Z}`;

/**
 * Converts one savegame of mod data into planner state. Translocators become waypoints linked to the
 * translocator at their TargetLocation (if it was also recorded); the game's own waypoints, the world
 * spawn and the last route's start/goal are added too, and the route's start/goal preselected. Waypoints on
 * a translocator are dropped. `spawn` is returned so coordinates can be shown relative to it.
 */
export function importModData(json, savegameId) {
  const waypoints = [];
  const translocators = json.TranslocatorsPerSavegame?.[savegameId] ?? [];
  const idAt = new Map(translocators.map((t) => [posKey(t.Position), `translocator:${posKey(t.Position)}`]));
  for (const t of translocators) {
    const { X, Y, Z } = t.Position;
    const id = idAt.get(posKey(t.Position));
    if (waypoints.some((w) => w.id === id)) continue;
    waypoints.push({
      id, label: "Translocator", x: X, z: Z, height: Y, pinned: false, color: "red", icon: "spiral",
      connection: t.TargetLocation ? idAt.get(posKey(t.TargetLocation)) : undefined,
    });
  }
  // A waypoint sitting on a translocator (the game auto-creates those for static translocators) would just
  // duplicate it, so only the translocator is kept. Waypoint positions can be off by a block.
  const onTranslocator = (p) => translocators.some((t) => Math.abs(t.Position.X - p.X) <= 1 && Math.abs(t.Position.Z - p.Z) <= 1 && Math.abs(t.Position.Y - (p.InternalY ?? 0)) <= 2);
  for (const [i, w] of (json.WayPointsPerSavegame?.[savegameId] ?? []).entries()) {
    if (onTranslocator(w.Pos)) continue;
    waypoints.push({
      id: `waypoint:${i}`, label: w.Name || w.CodePath || `Waypoint ${i + 1}`, x: w.Pos.X, z: w.Pos.Z, height: w.Pos.InternalY ?? 0,
      pinned: false, color: w.Color || "red", icon: w.Icon || "circle",
    });
  }
  const extra = (id, label, p, icon) => p && waypoints.push({ id, label, x: p.X, z: p.Z, height: p.Y, pinned: false, color: "red", icon });
  const spawn = json.DefaultSpawnPositionPerSavegame?.[savegameId];
  extra("spawn", "World spawn", spawn, "home");
  const last = json.LastTranslocatorPathPerSavegame?.[savegameId];
  extra("path-start", "Last route start", last?.StartPos, "circle");
  extra("path-goal", "Last route goal", last?.GoalPos, "circle");
  return {
    waypoints,
    source: last?.StartPos ? "path-start" : "",
    destination: last?.GoalPos ? "path-goal" : "",
    createdTime: undefined,
    spawn: spawn ? { x: spawn.X, y: spawn.Y, z: spawn.Z } : undefined,
  };
}
