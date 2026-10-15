// Port of Vintage Story's *realistic* world-climate generator (the deterministic part), so the
// wiki can answer "what's the climate at X,Z in the world with seed S". Pure ES module, no DOM or
// Node APIs (browser-loadable and importable from tests), like schematicDecode.js.
//
// Ported from vsessentialsmod `Systems/WorldGen/Standard/ChunkGen/0.GenMaps/`:
//   NoiseBase.cs (seeded LCG), NoiseClimateRealistic.cs (latitude zigzag + per-cell randomness),
//   MapLayerClimate.cs (cell grid + smoothstep blend) and vsapi `Common/Climate.cs` (altitude).
// NOT ported (so results are approximate near any given block): `MapLayerPerlinWobble`, a simplex
// warp the game applies after this stage that displaces the map by up to ~29 map pixels
// (~900 blocks); the forest/shrub maps; landforms (terrain height). See RESEARCH.md.
//
// C# semantics that matter here: `long` arithmetic wraps at 64 bits (BigInt + asIntN), `float`
// rounds to 32 bits (Math.fround), `(int)` truncates toward zero (Math.trunc).

const MUL = 6364136223846793005n;
const ADD = 1442695040888963407n;
const wrap = (v) => BigInt.asIntN(64, v);
const f32 = Math.fround;

/** `TerraGenConfig`: one climate-map pixel is 32 blocks; the noise grid is one cell per 16 pixels. */
export const CLIMATE_MAP_SCALE = 32;
export const CLIMATE_MAP_SUBSCALE = 16;
/** Blocks per noise cell (the resolution of the randomness): 512. */
export const CELL_BLOCKS = CLIMATE_MAP_SCALE * CLIMATE_MAP_SUBSCALE;
export const SEA_LEVEL = 110;

/** `Climate.TemperatureScaleConversion`: real °C [-20, 40] <-> stored int [0, 255]. */
const TEMP_SCALE = f32(255 / 60);

/** `Climate.DescaleTemperature`: °C -> stored 0-255 temperature. */
export function descaleTemperature(celsius) {
  const v = Math.trunc(f32(f32(celsius + 20) * TEMP_SCALE));
  return Math.min(255, Math.max(0, v));
}

/**
 * `Climate.GetScaledAdjustedTemperatureFloat`: °C at height `y` for a stored 0-255 sea-level
 * temperature. Temperature falls 1 stored unit per 1.5 blocks above sea level.
 */
export function temperatureAtY(storedTemp, y) {
  const dist = y - SEA_LEVEL;
  const v = f32(f32(f32(storedTemp - f32(dist / f32(1.5))) / TEMP_SCALE) - 20);
  return Math.min(40, Math.max(-20, v));
}

/** `Climate.GetRainFall`: stored 0-255 rainfall at height `y`. */
export function rainfallAtY(storedRain, y) {
  const d = y - SEA_LEVEL;
  const v = storedRain + Math.trunc(d / 2) + 5 * Math.min(8, Math.max(0, 8 - d));
  return Math.min(255, Math.max(0, v));
}

/** Starting-climate presets of the `startingClimate` world option: spawn latitude temperature range, °C. */
export const STARTING_CLIMATES = {
  default: [6, 14],
  hot: [28, 32],
  warm: [19, 23],
  cool: [-5, 1],
  icy: [-15, -10],
};

/** `NoiseBase`: the game's seeded 64-bit LCG, reseeded per map cell. */
class Rng {
  constructor(worldSeed) {
    const s = BigInt(worldSeed);
    const step = wrap(s * MUL + ADD);
    let m = s;
    m = wrap(m * step); m = wrap(m + 1n);
    m = wrap(m * step); m = wrap(m + 2n);
    m = wrap(m * step); m = wrap(m + 3n);
    this.mapGenSeed = m;
    // The constructor assigns currentSeed from a still-zero mapGenSeed, so it starts at ADD.
    this.current = ADD;
  }

  initPositionSeed(x, z) {
    let c = this.mapGenSeed;
    c = wrap(c * wrap(c * MUL + ADD)); c = wrap(c + BigInt(x));
    c = wrap(c * wrap(c * MUL + ADD)); c = wrap(c + BigInt(z));
    c = wrap(c * wrap(c * MUL + ADD)); c = wrap(c + BigInt(x));
    c = wrap(c * wrap(c * MUL + ADD)); c = wrap(c + BigInt(z));
    this.current = c;
  }

  /** Pseudo-random int in [0, max). */
  nextInt(max) {
    let r = Number((this.current >> 24n) % BigInt(max));
    if (r < 0) r += max;
    this.current = wrap(this.current * wrap(this.current * MUL + ADD));
    this.current = wrap(this.current + this.mapGenSeed);
    return r;
  }
}

/** One lerp channel of `GameMath.BiLerpRgbColor`, in float arithmetic, on values packed at `scale`. */
function lerpChannel(lt, rt, lb, rb, lx, ly, shift) {
  const lerp = (a, b, t) => f32(a + f32(f32(b - a) * t));
  const mask = 0xff << shift;
  const a = lt & mask, b = rt & mask, c = lb & mask, d = rb & mask;
  return (Math.trunc(lerp(lerp(a, b, lx), lerp(c, d, lx), ly)) & mask) >>> shift;
}

const smoothStep = (x) => f32(f32(x * x) * f32(3 - f32(2 * x)));

/**
 * The realistic climate noise for one world. `seed` is the numeric world seed (an int32). A text
 * seed is turned into that int by the game's closed server code, which isn't in the cloned
 * sources, so it is deliberately not supported here.
 */
export class RealisticClimate {
  constructor({
    seed,
    mapSizeZ = 1024000,
    polarEquatorDistance = 50000,
    startingClimate = "default",
    tempMul = 1,
    rainMul = 1,
    geologicActivity = 0.05,
  }) {
    const [spawnMinTemp, spawnMaxTemp] = STARTING_CLIMATES[startingClimate] ?? STARTING_CLIMATES.default;
    this.rng = new Rng(BigInt(seed) + 1n); // NoiseClimateRealistic passes seed + 1 to NoiseBase
    this.tempMul = f32(tempMul);
    this.rainMul = f32(rainMul);
    this.geologicActivityInv = f32(1 / f32(geologicActivity));
    this.halfRange = polarEquatorDistance / CLIMATE_MAP_SCALE / CLIMATE_MAP_SUBSCALE;

    const minD = descaleTemperature(spawnMinTemp);
    const maxD = descaleTemperature(spawnMaxTemp);
    /** Stored (0-255) sea-level temperature at the spawn latitude, before per-cell randomness. */
    this.spawnTemperature = minD + this.rng.nextInt(maxD - minD + 1);
    const zPerDeg = this.halfRange / 255;
    const mapZCells = mapSizeZ / CLIMATE_MAP_SCALE / CLIMATE_MAP_SUBSCALE;
    /** Shifts the latitude zigzag so the world's middle row sits at the spawn temperature. */
    this.zOffset = this.spawnTemperature * zPerDeg - mapZCells / 2;
    this.mapSizeZ = mapSizeZ;
  }

  /** Latitude-only stored temperature (0-255 scale, before per-cell randomness) at noise row `cellZ`. */
  baseTemperature(cellZ) {
    const P = this.halfRange;
    const z = cellZ + this.zOffset;
    return (255 / P) * (P - Math.abs((Math.abs(z) % (2 * P)) - P));
  }

  /** `GetRandomClimate` at integer noise cell (cx, cz): stored 0-255 temperature, rain, geologic activity. */
  cellClimate(cx, cz) {
    const rng = this.rng;
    rng.initPositionSeed(cx, cz);
    const tempRnd = rng.nextInt(51) - 35;
    const preTemp = Math.trunc(this.baseTemperature(cz)) + tempRnd;
    const temperature = Math.min(255, Math.max(0, Math.trunc(f32(preTemp * this.tempMul))));
    const rain = Math.min(255, Math.trunc(f32(rng.nextInt(256) * this.rainMul)));
    const geo = Math.trunc(Math.max(0, Math.pow(f32(rng.nextInt(256) / 255), this.geologicActivityInv) * 255));
    return { temperature, rain, geologicActivity: geo };
  }

  /**
   * Climate at a world block position (absolute coordinates, not relative to spawn): the four
   * surrounding noise cells blended with a smoothstep, as `MapLayerClimate` does. The game's noise
   * grid is offset by 14 map pixels from the block grid (regions are generated with a 2-pixel pad),
   * which is the `- 14` below. Ignores the later perlin wobble (see file header).
   */
  climateAt(blockX, blockZ) {
    const u = (blockX / CLIMATE_MAP_SCALE - 14) / CLIMATE_MAP_SUBSCALE;
    const v = (blockZ / CLIMATE_MAP_SCALE - 14) / CLIMATE_MAP_SUBSCALE;
    const cx = Math.floor(u), cz = Math.floor(v);
    const lx = smoothStep(f32(u - cx)), ly = smoothStep(f32(v - cz));
    const pack = (c) => (c.temperature << 16) + (c.rain << 8) + c.geologicActivity;
    const lt = pack(this.cellClimate(cx, cz));
    const rt = pack(this.cellClimate(cx + 1, cz));
    const lb = pack(this.cellClimate(cx, cz + 1));
    const rb = pack(this.cellClimate(cx + 1, cz + 1));
    return {
      temperature: lerpChannel(lt, rt, lb, rb, lx, ly, 16),
      rain: lerpChannel(lt, rt, lb, rb, lx, ly, 8),
      geologicActivity: lerpChannel(lt, rt, lb, rb, lx, ly, 0),
    };
  }

  /** The world's default spawn: the map center (`GenMaps`: `(MapSize + chunkSize) / 2`, chunk = 32). */
  spawnBlock() {
    const center = Math.trunc((this.mapSizeZ + 32) / 2);
    return { x: center, z: center };
  }
}

/**
 * Wild plants/trees whose spawn climate band contains a point. `spawns` entries carry the
 * `minTemp`/`maxTemp` (°C) and `minRain`/`maxRain` (0-1) the ingest already extracted. A missing
 * (undefined or null) bound means unbounded on that side.
 */
export function matchingSpawns(spawns, celsius, rain01) {
  return spawns.filter(
    (s) =>
      (s.minTemp == null || celsius >= s.minTemp) &&
      (s.maxTemp == null || celsius <= s.maxTemp) &&
      (s.minRain == null || rain01 >= s.minRain) &&
      (s.maxRain == null || rain01 <= s.maxRain),
  );
}
