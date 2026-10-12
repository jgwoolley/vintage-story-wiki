
import { downloadFile } from "@/utils/downloadFile";
import { Dispatch, SetStateAction, useCallback, useState } from "react";
import { deserializeWayPoints, serializeWayPoints, WayPoint, VintageStoryToolDataSchema } from "@/utils/utils";
import { SubmitSnackbarMessage } from "@/components/SnackbarProvider";

const submitSnackbarMessage: SubmitSnackbarMessage = (key, value, data) => {
    console.log({ key, value, data });
}

export type UseVintageStoryToolDataArgs = {
    sourceNode: WayPoint | undefined,
    setSourceNode: Dispatch<SetStateAction<WayPoint | undefined>>,
    destinationNode: WayPoint | undefined,
    setDestinationNode: Dispatch<SetStateAction<WayPoint | undefined>>,
    waypoints: WayPoint[],
    setWaypoints: Dispatch<SetStateAction<WayPoint[]>>,
}

export type UseVintageStoryToolDataResults = {
    uploadWayPoints: (files: FileList) => void,
    downloadWayPoints: () => void,
}

export default function useVintageStoryToolData({ setWaypoints, setSourceNode, setDestinationNode, waypoints, sourceNode, destinationNode, }: UseVintageStoryToolDataArgs): UseVintageStoryToolDataResults {
    const [createdTime, setCreatedTime] = useState<Date>();
    const [modifiedTime, setModifiedTime] = useState<Date>();
    // const submitSnackbarMessage = useContext(SubmitSnackbarContext);

    const uploadWayPoints = useCallback<(files: FileList) => void>(async (files: FileList) => {
        for (const file of files) {
            try {
                const data: unknown = JSON.parse(await file.text());
                const result = VintageStoryToolDataSchema.safeParse(data);

                if (result.success) {
                    if (createdTime != undefined) {
                        setCreatedTime(result.data.createdTime);
                    }

                    if (modifiedTime != undefined) {
                        setModifiedTime(result.data.modifiedTime);
                    }

                    const [deserializedWaypoints, newIds] = deserializeWayPoints(result.data);

                    // Ensure unique IDs when adding new waypoints
                    const newWaypoints = deserializedWaypoints.map((wp, i) => ({
                        ...wp,
                        id: wp.data.id || `uploaded-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 9)}`, // Robust unique ID
                    }));

                    setWaypoints(prevWaypoints => {
                        const oldIds = new Set(prevWaypoints.map(x => x.data.id));
                        const sharedIds = newIds.intersection(oldIds);
                        if (sharedIds.size > 0) {
                            submitSnackbarMessage("Failed to Upload WayPoints: Multiple WayPoints share same internal id", "error", { type: "Had shared ids", sharedIds })
                            // TODO: In event of shared ids maybe do something smarter...
                            return prevWaypoints;
                        }
                        submitSnackbarMessage("Uploaded WayPoints", "success", { type: "uploadWaypoints", newWaypoints });

                        return [...prevWaypoints, ...newWaypoints];
                    });

                    if (result.data.source) {
                        const value = newWaypoints.find(x => x.data.id === result.data.source);
                        console.log({ value, type: "found source" });
                        if (value) {
                            setSourceNode({ ...value });
                        } else {
                            console.error(`Could not find node with id: [${result.data.source}].`);
                        }
                    } else {
                        console.error(`Could not find source node.`);
                    }
                    if (result.data.destination) {
                        const value = newWaypoints.find(x => x.data.id === result.data.destination);
                        console.log({ value, type: "found dest" });
                        if (value) {
                            setDestinationNode({ ...value });
                        } else {
                            console.error(`Could not find destination node with id: [${result.data.destination}].`);
                        }
                    } else {
                        console.error(`Could not find destination node.`);
                    }

                } else {
                    submitSnackbarMessage("Failed to Upload WayPoints", "error", result.error);
                }
            } catch (error) {
                submitSnackbarMessage("Failed to Upload WayPoints", "error", error);
            }
        }
    }, [
        setWaypoints,
        // submitSnackbarMessage, 
        createdTime,
        modifiedTime,
        setDestinationNode,
        setSourceNode,
    ]);

    const downloadWayPoints = useCallback<() => void>(() => {
        const results = serializeWayPoints({ createdTime, modifiedTime, waypoints, sourceNode, destinationNode });
        console.log({ type: "downloadWaypoints", waypoints, results });
        const resultsText = JSON.stringify(results, null, 2);
        downloadFile(new File([resultsText], "waypoints.json")); // Prettier JSON output
    }, [waypoints, sourceNode, destinationNode, createdTime, modifiedTime]);

    return {
        uploadWayPoints,
        downloadWayPoints,
    }
}