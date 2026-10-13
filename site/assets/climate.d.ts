// Type declarations for climate.js (the .js stays plain browser-loadable ES module JS).

export const CLIMATE_MAP_SCALE: number;
export const CLIMATE_MAP_SUBSCALE: number;
export const CELL_BLOCKS: number;
export const SEA_LEVEL: number;
export const STARTING_CLIMATES: Record<string, [number, number]>;

export function descaleTemperature(celsius: number): number;
export function temperatureAtY(storedTemp: number, y: number): number;
export function rainfallAtY(storedRain: number, y: number): number;

export interface ClimateValue {
  temperature: number; // stored 0-255 sea-level temperature
  rain: number; // stored 0-255
  geologicActivity: number; // stored 0-255
}

export interface RealisticClimateOptions {
  seed: number;
  mapSizeZ?: number;
  polarEquatorDistance?: number;
  startingClimate?: string;
  tempMul?: number;
  rainMul?: number;
  geologicActivity?: number;
}

export class RealisticClimate {
  constructor(options: RealisticClimateOptions);
  spawnTemperature: number;
  zOffset: number;
  halfRange: number;
  mapSizeZ: number;
  baseTemperature(cellZ: number): number;
  cellClimate(cx: number, cz: number): ClimateValue;
  climateAt(blockX: number, blockZ: number): ClimateValue;
  spawnBlock(): { x: number; z: number };
}

export interface ClimateBand {
  minTemp?: number | null;
  maxTemp?: number | null;
  minRain?: number | null;
  maxRain?: number | null;
}
export function matchingSpawns<T extends ClimateBand>(spawns: T[], celsius: number, rain01: number): T[];
