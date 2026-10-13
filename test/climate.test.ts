import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RealisticClimate, descaleTemperature, temperatureAtY, rainfallAtY, matchingSpawns, CELL_BLOCKS,
} from "../site/assets/climate.js";

// Expected values come from an independent Python re-implementation of the C# arithmetic
// (64-bit wrapping LCG, signed shifts, float32 rounding), not from this module.
const REFERENCE: Record<string, { spawnTemp: number; cells: Record<string, [number, number, number]> }> = {
  "12345": { spawnTemp: 121, cells: { "0,0": [63, 112, 0], "1,0": [37, 131, 0], "0,1": [53, 219, 35], "-5,7": [71, 209, 217], "1000,1000": [95, 255, 0], "33,-90": [184, 95, 0] } },
};

test("matches the independent reference for spawn temperature and per-cell climate", () => {
  const c = new RealisticClimate({ seed: 12345 });
  assert.equal(c.spawnTemperature, REFERENCE["12345"].spawnTemp);
  assert.ok(Math.abs(c.zOffset - -953.6611519607843) < 1e-9);
  for (const [key, [t, r, g]] of Object.entries(REFERENCE["12345"].cells)) {
    const [x, z] = key.split(",").map(Number);
    assert.deepEqual(c.cellClimate(x, z), { temperature: t, rain: r, geologicActivity: g }, key);
  }
});

test("same seed is deterministic, different seeds differ", () => {
  const a = new RealisticClimate({ seed: 1 }).cellClimate(10, 10);
  assert.deepEqual(new RealisticClimate({ seed: 1 }).cellClimate(10, 10), a);
  const others = [2, 3, 4, 5].map((s) => JSON.stringify(new RealisticClimate({ seed: s }).cellClimate(10, 10)));
  assert.ok(others.some((o) => o !== JSON.stringify(a)));
});

test("negative, zero and int32-max seeds don't throw and stay in range", () => {
  for (const seed of [-1, 0, -2147483648, 2147483647]) {
    const c = new RealisticClimate({ seed });
    for (let i = -3; i <= 3; i++) {
      const v = c.climateAt(512000 + i * 700, 512000 - i * 1300);
      for (const n of [v.temperature, v.rain, v.geologicActivity]) assert.ok(n >= 0 && n <= 255 && Number.isInteger(n));
    }
  }
});

test("spawn temperature lands in the starting-climate range", () => {
  const ranges: Record<string, [number, number]> = { default: [6, 14], hot: [28, 32], warm: [19, 23], cool: [-5, 1], icy: [-15, -10] };
  for (const [name, [lo, hi]] of Object.entries(ranges)) {
    for (let seed = 0; seed < 20; seed++) {
      const c = new RealisticClimate({ seed, startingClimate: name });
      assert.ok(c.spawnTemperature >= descaleTemperature(lo) && c.spawnTemperature <= descaleTemperature(hi), `${name} seed ${seed}`);
    }
  }
});

test("the world's middle row sits at the spawn temperature before randomness", () => {
  const c = new RealisticClimate({ seed: 7 });
  const midCell = c.mapSizeZ / CELL_BLOCKS / 2;
  assert.ok(Math.abs(c.baseTemperature(midCell) - c.spawnTemperature) <= 1);
});

test("latitude is a zigzag: temperature rises toward the equator then falls again", () => {
  const c = new RealisticClimate({ seed: 7 });
  const vals = Array.from({ length: 400 }, (_, i) => c.baseTemperature(i - 200));
  assert.ok(Math.max(...vals) <= 255.0001 && Math.min(...vals) >= -0.0001);
  assert.ok(Math.max(...vals) > 200 && Math.min(...vals) < 50);
});

test("global temperature/precipitation multipliers scale the output", () => {
  const base = new RealisticClimate({ seed: 3 }).cellClimate(5, 5);
  const wet = new RealisticClimate({ seed: 3, rainMul: 0.5 }).cellClimate(5, 5);
  assert.equal(wet.rain, Math.trunc(base.rain * 0.5)); // base used a multiplier of 1, so base.rain is the raw roll
  const hot = new RealisticClimate({ seed: 3, tempMul: 0 }).cellClimate(5, 5);
  assert.equal(hot.temperature, 0);
});

test("blending: a position exactly on a cell corner equals that cell", () => {
  const c = new RealisticClimate({ seed: 99 });
  // u = (x/32 - 14)/16 is an integer when x = 32 * (14 + 16 * n)
  const x = 32 * (14 + 16 * 5), z = 32 * (14 + 16 * 9);
  assert.deepEqual(c.climateAt(x, z), c.cellClimate(5, 9));
});

test("altitude formulas (vsapi Climate.cs)", () => {
  assert.equal(descaleTemperature(-20), 0);
  assert.equal(descaleTemperature(40), 255);
  assert.equal(descaleTemperature(60), 255);
  assert.equal(temperatureAtY(255, 110), 40);
  assert.equal(temperatureAtY(0, 110), -20);
  // 150 blocks above sea level costs 100 stored units = 23.5 °C
  assert.ok(Math.abs(temperatureAtY(200, 260) - (((200 - 100) / (255 / 60)) - 20)) < 1e-4);
  assert.equal(rainfallAtY(100, 110), 100 + 5 * 8); // at sea level the low-altitude bonus applies
  assert.equal(rainfallAtY(100, 150), 100 + 20);
  assert.equal(rainfallAtY(250, 150), 255);
});

test("matchingSpawns treats a missing bound as open", () => {
  const spawns = [
    { id: "a", minTemp: 10, maxTemp: 20, minRain: 0.2, maxRain: 0.8 },
    { id: "b", minTemp: 25 },
    { id: "c" },
    { id: "d", minTemp: null, maxTemp: null, minRain: null, maxRain: null },
  ];
  assert.deepEqual(matchingSpawns(spawns, 15, 0.5).map((s) => s.id), ["a", "c", "d"]);
  assert.deepEqual(matchingSpawns(spawns, 30, 0.9).map((s) => s.id), ["b", "c", "d"]);
});
