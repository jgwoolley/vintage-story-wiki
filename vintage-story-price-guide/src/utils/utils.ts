import { Position } from "cytoscape";
import { z } from "zod";

export const WayPointOriginSchema = z.enum(["browser"]);
export type WayPointOrigin = z.infer<typeof WayPointOriginSchema>;

export const WayPointDataSchema = z.object({
    id: z.string(),
    label: z.string(),
    height: z.number(),
    createdTime: z.coerce.date(),
    modifiedTime: z.coerce.date(),
    origin: WayPointOriginSchema,
    pinned: z.boolean().optional(),
    color: z.string().optional(),
    icon: z.string().optional(),
});

export type WayPointData = z.infer<typeof WayPointDataSchema>;

export const WayPointJsonSchema = z.object({
    data: WayPointDataSchema,
    position: z.object({
        x: z.number(),
        y: z.number(),
    }),
    connection: z.string().optional(),
});

export type WayPointJson = z.infer<typeof WayPointJsonSchema>;

export const VintageStoryToolDataSchema = z.object({
    createdTime: z.coerce.date(),
    modifiedTime: z.coerce.date(),
    source: z.string().optional(),
    destination: z.string().optional(),
    waypoints: z.array(WayPointJsonSchema),
});

export type VintageStoryToolData = z.infer<typeof VintageStoryToolDataSchema>;

export type WayPointInput = {
    position: {x: string, y: string},
    data: Omit<WayPointData, "height"> & { "height": string, },
    connection?: WayPoint,
};

export type WayPoint = {
    data: WayPointData,
    position: Position,
    connection?: WayPoint,
}

export function calculateDistance({ source, destination }: { source: WayPoint, destination: WayPoint }) {
    if (source.connection?.data.id === destination.data.id || destination.connection?.data.id === source.data.id) {
        return 0;
    }

    const dx = source.position.x - destination.position.x;
    const dz = source.position.y - destination.position.y;
    return Math.sqrt(dx * dx + dz * dz);
}

export function deserializeWayPoints(waypoints: VintageStoryToolData): [WayPoint[], Set<string>] {
    const results: WayPoint[] = [];
    const ids = new Set<string>();
    for (const row of waypoints.waypoints) {
        const id = row.data.id;
        if (ids.has(id)) {
            console.error(`Duplicate ids: ${id}`);
            return [[] , new Set<string>()];
        } else {
            ids.add(id);
        }

        const newRow: WayPoint = {
            position: row.position,
            data: {
                id: id,
                height: row.data.height,
                label: row.data.label,
                modifiedTime: row.data.modifiedTime,
                createdTime: row.data.createdTime,
                origin: "browser",
                pinned: row.data.pinned || false, // TODO: Remove
                color: row.data.color || "red", // TODO: Remove
                icon: row.data.icon || "circle", // TODO: Remove
            },
        };
        results.push(newRow);
    }

    for (const sourceJson of waypoints.waypoints) {
        const { connection: connectionId } = sourceJson;
        if (connectionId != undefined) {
            const source = results.find(x => x.data.id === sourceJson.data.id);
            const connection = results.find(x => x.data.id === connectionId);
            if (source == undefined || connection == undefined) {
                console.error({ sourceJson, source, connection });
                continue;
            }
            source.connection = connection;
        }
    }

    return [results, ids];
}

export type SerializeWayPointsArgs = { 
    createdTime: Date | undefined, 
    modifiedTime: Date | undefined, 
    waypoints: WayPoint[], 
    sourceNode: WayPoint | undefined, 
    destinationNode: WayPoint | undefined,
}

export function serializeWayPoints({ createdTime, modifiedTime, waypoints, sourceNode, destinationNode }: SerializeWayPointsArgs): VintageStoryToolData {
    const newWaypoints: WayPointJson[] = [];
    for (const row of waypoints) {
        const newRow: WayPointJson = {
            data: {
                id: row.data.id,
                label: row.data.label,
                height: row.data.height,
                createdTime: new Date(),
                modifiedTime: new Date(),
                origin: row.data.origin,
            },
            position: {
                x: row.position.x,
                y: row.position.y,
            },
            connection: row.connection?.data.id,
        }

        newWaypoints.push(newRow);
    }

    return {
        source: sourceNode?.data.id,
        destination: destinationNode?.data.id,
        modifiedTime: modifiedTime ? modifiedTime : new Date(),
        createdTime: createdTime ? createdTime : new Date(),
        waypoints: newWaypoints,
    };
}

export function stringifyWayPoint(waypoint: WayPoint) {
    return `${waypoint.data.label} (${waypoint.position.x}, ${waypoint.data.height}, ${waypoint.position.y})`;
}

/**
 * Type for a single step in the calculated path.
 */
export type PathStep = {
    id: string,
    from: cytoscape.NodeSingular;
    to: cytoscape.NodeSingular;
    distance: number;
};

export function convertNodeToWayPoint(node: cytoscape.NodeSingular): WayPoint {
    const position = node.position();
    const data = WayPointDataSchema.parse({
        id: node.data("id"),
        label: node.data("label"),
        height: node.data("height"),
        createdTime: node.data("createdTime"),
        modifiedTime: node.data("modifiedTime"),
        origin: node.data("origin"),
        pinned: node.data("pinned"),
        color: node.data("color"),
        icon: node.data("icon"),
    });

    return {
        data: data,
        position: position,
    }
}

export function getWaypointCommand({data: {icon, height: y, pinned, color, label}, position: {x, y: z}}: WayPoint): string {
    return `/waypoint addati ${icon} ${x} ${y} ${z} ${pinned ? "true": "false"} ${color} ${label}`;
}
    