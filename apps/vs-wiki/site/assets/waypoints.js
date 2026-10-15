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

export function stringifyWayPoint(w) {
  return `${w.label} (${w.x}, ${w.height}, ${w.z})`;
}

/** The in-game chat command that recreates this waypoint. */
export function getWaypointCommand({ icon, height, pinned, color, label, x, z }) {
  return `/waypoint addati ${icon} ${x} ${height} ${z} ${pinned ? "true" : "false"} ${color} ${label}`;
}

/** Serialized shape (what Download writes / Upload reads). */
export function serializeWayPoints({ waypoints, source, destination, createdTime }) {
  return {
    createdTime: createdTime ?? new Date().toISOString(),
    modifiedTime: new Date().toISOString(),
    source,
    destination,
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
  return { waypoints, source: json.source, destination: json.destination, createdTime: json.createdTime };
}
