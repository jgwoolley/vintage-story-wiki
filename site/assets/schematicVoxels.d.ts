// Type declarations for schematicVoxels.js (the .js stays plain browser-loadable ES module JS).
export interface Voxel {
  x: number;
  y: number;
  z: number;
  packed: number;
  code: string;
}
export function isHiddenByDefault(code: string): boolean;
export function stringToColor(str: string): string;
export function assertSchematic(schematic: unknown): void;
export function toVoxels(schematic: { Indices: number[]; BlockIds: number[]; BlockCodes: Record<string, string> }): Voxel[];
export function fetchGzipText(url: string, onLength?: (length: number) => void): Promise<string>;
