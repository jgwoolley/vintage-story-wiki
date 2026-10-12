import { useMemo } from "react";
import { calculateDistance, WayPoint } from "@/utils/utils";;

export type UseWayPointEdgesProps = {
    waypoints: WayPoint[],
}

export default function useWayPointEdges({ waypoints }: UseWayPointEdgesProps) {
    /**
        * Memoized calculation of Cytoscape elements (nodes and edges) from waypoints.
        */
    return useMemo<cytoscape.ElementDefinition[]>(() => {
        const results: cytoscape.ElementDefinition[] = [];
        const addedEdges = new Set<string>(); // To prevent duplicate edges (e.g., A-B and B-A)

        // 1. Add Nodes
        for (const waypoint of waypoints) {
            results.push({
                group: 'nodes', // Explicitly define group
                position: waypoint.position,
                data: waypoint.data,
            });
        }

        // 2. Add Edges (for all relevant connections)
        for (let i = 0; i < waypoints.length; i++) {
            const source = waypoints[i];
            // Iterate from i+1 to avoid self-loops and duplicate edges (A-B vs B-A)
            for (let j = i + 1; j < waypoints.length; j++) {
                const destination = waypoints[j];

                const weight = Math.round(calculateDistance({
                    source: source,
                    destination: destination,
                }));

                // Only add an edge if it has a valid, non-infinite distance (0 for teleporters included)
                if (weight !== Infinity && !isNaN(weight)) {
                    // Create a canonical edge ID to avoid duplicates (e.g., ensure edge-A-B is same as edge-B-A)
                    const edgeId = [source.data.id, destination.data.id].sort().join('-'); // Sort IDs for consistent ID
                    if (!addedEdges.has(edgeId)) { // Check if this unique edge has already been added
                        results.push({
                            group: 'edges', // Explicitly define group
                            data: {
                                source: source.data.id,
                                target: destination.data.id,
                                weight: weight,
                                id: edgeId,
                            },
                        });
                        addedEdges.add(edgeId); // Mark as added
                    }
                }
            }
        }
        return results;
    }, [waypoints]); // Dependency on waypoints
}