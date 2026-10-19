// Types for waypoints.js (plain browser JS), so the tests can import it under `tsc`.
export interface WayPoint {
  id: string; label: string; x: number; z: number; height: number;
  pinned: boolean; color: string; icon: string; connection?: string;
}
export interface WayPointState { waypoints: WayPoint[]; source?: string; destination?: string; createdTime?: string; spawn?: { x: number; y: number; z: number } }
export interface PathStep { from: WayPoint; to: WayPoint; distance: number }
export function shortestPath(waypoints: WayPoint[], sourceId: string, destinationId: string): PathStep[];
export function deserializeWayPoints(json: unknown): WayPointState;
export function isModData(json: unknown): boolean;
export function modDataSavegames(json: any): { id: string; translocators: number; waypoints: number }[];
export function importModData(json: any, savegameId: string): WayPointState;
export function formatCoords(w: WayPoint, spawn?: { x: number; y: number; z: number }): string;
export function stringifyWayPoint(w: WayPoint, spawn?: { x: number; y: number; z: number }): string;
