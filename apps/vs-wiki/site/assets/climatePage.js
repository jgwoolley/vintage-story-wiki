// Seed climate lookup (site/tools/climate/index.njk). Wires the form to climate.js (a port of the
// game's realistic climate generator) and matches the result against the wiki's own wild-plant and
// tree climate bands, rendered into #climateSpawns by the template.
import { RealisticClimate, CELL_BLOCKS, temperatureAtY, rainfallAtY, matchingSpawns } from "./climate.js";

const $ = (id) => document.getElementById(id);
const num = (id, fallback) => {
  const v = Number($(id).value);
  return Number.isFinite(v) ? v : fallback;
};
const spawns = JSON.parse($("climateSpawns").textContent);
const fmt = (c) => `${c.toFixed(1)} °C`;

function world() {
  return new RealisticClimate({
    seed: Math.trunc(num("clSeed", 0)),
    mapSizeZ: num("clSize", 1024000),
    polarEquatorDistance: num("clPolar", 50000),
    startingClimate: $("clStart").value,
    tempMul: num("clTempMul", 1),
    rainMul: num("clRainMul", 1),
    geologicActivity: Math.max(0.01, num("clGeo", 0.05)),
  });
}

// Blue (cold) -> green -> red (hot) over the stored 0-255 temperature.
function tempColor(t) {
  const f = t / 255;
  const r = Math.round(255 * Math.min(1, Math.max(0, f * 2 - 0.5)));
  const g = Math.round(255 * (1 - Math.abs(f * 2 - 1)) * 0.9);
  const b = Math.round(255 * Math.min(1, Math.max(0, 1.5 - f * 2)));
  return `rgb(${r},${g},${b})`;
}

function drawMap(w, centerX, centerZ) {
  const canvas = $("clMap");
  const ctx = canvas.getContext("2d");
  const cells = 64, px = canvas.width / cells;
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const x = centerX + (i - cells / 2) * CELL_BLOCKS;
      const z = centerZ + (j - cells / 2) * CELL_BLOCKS;
      ctx.fillStyle = tempColor(w.climateAt(x, z).temperature);
      ctx.fillRect(i * px, j * px, px, px);
    }
  }
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 2;
  ctx.strokeRect(canvas.width / 2 - 4, canvas.height / 2 - 4, 8, 8);
}

function render() {
  const w = world();
  const spawn = w.spawnBlock();
  const x = spawn.x + num("clX", 0), z = spawn.z + num("clZ", 0), y = num("clY", 125);
  const c = w.climateAt(x, z);

  const spawnC = temperatureAtY(w.spawnTemperature, 110);
  $("clSpawn").textContent = `Spawn latitude: about ${fmt(spawnC)} at sea level (before per-area variation). Latitude zigzag offset: ${w.zOffset.toFixed(1)} cells.`;
  const celsius = temperatureAtY(c.temperature, y);
  $("clTemp").textContent = `Temperature at y=${y}: ${fmt(celsius)} (sea level: ${fmt(temperatureAtY(c.temperature, 110))}; stored value ${c.temperature}/255).`;
  const rain = rainfallAtY(c.rain, y);
  $("clRain").textContent = `Rainfall at y=${y}: ${(rain / 255 * 100).toFixed(0)}% (stored value ${rain}/255).`;
  $("clGeoOut").textContent = `Geologic activity: ${(c.geologicActivity / 255 * 100).toFixed(0)}% (stored value ${c.geologicActivity}/255).`;

  const hits = matchingSpawns(spawns, celsius, rain / 255);
  $("clSpawnCount").textContent = `${hits.length} of ${spawns.length} climate bands match.`;
  const list = $("clSpawnList");
  list.replaceChildren(
    ...hits
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label))
      .map((h) => {
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = h.url;
        a.textContent = h.label;
        li.append(`${h.kind}: `, a);
        return li;
      }),
  );
  drawMap(w, x, z);
}

for (const el of document.querySelectorAll("#clForm input, #clForm select, #clPos input")) el.addEventListener("input", render);
render();
