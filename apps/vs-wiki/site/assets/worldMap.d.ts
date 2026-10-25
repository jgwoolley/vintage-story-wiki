// Types for worldMap.js (plain JS shipped to the browser as-is), for the tests.
export const TILE_SIZE: number;
export interface ProtobufField {
  id: number;
  number?: number;
  bytes?: Uint8Array;
}
export interface MapPiece {
  tileX: number;
  tileZ: number;
  rgba: Uint8ClampedArray;
  version: number;
  lastModified: number;
}
export interface MapOverview {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  blocksPerPixel: number;
  x: number;
  z: number;
  tiles: number;
}
export function parseProtobuf(data: Uint8Array): ProtobufField[];
export function tileOf(position: number): { tileX: number; tileZ: number };
export function decodePiece(position: number, data: Uint8Array | null): MapPiece | null;
/** `db` is an opened sql.js Database. */
export function readPieces(db: unknown): MapPiece[];
export function renderOverview(pieces: MapPiece[], maxSize?: number): MapOverview | null;
