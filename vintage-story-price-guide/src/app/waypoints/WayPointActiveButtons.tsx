'use client';

import FileUploader from "@/components/FileUploader";
import useVintageStoryToolData from "@/hooks/useVintageStoryToolData";
import { WayPoint } from "@/utils/utils";
import { Button, ButtonGroup } from "@mui/material";
import { Dispatch, SetStateAction } from "react";
;

export type WayPointActiveButtonsProps = {
    sourceNode: WayPoint | undefined,
    setSourceNode: Dispatch<SetStateAction<WayPoint | undefined>>,
    destinationNode: WayPoint | undefined,
    setDestinationNode: Dispatch<SetStateAction<WayPoint | undefined>>,
    waypoints: WayPoint[],
    setWaypoints: Dispatch<SetStateAction<WayPoint[]>>,
    onZoomPosition: (position: cytoscape.Position) => void,
}

export default function WayPointActiveButtons({ waypoints, setWaypoints, sourceNode, setSourceNode, destinationNode, setDestinationNode, onZoomPosition, }: WayPointActiveButtonsProps) {
    const {
        uploadWayPoints,
        downloadWayPoints
    } = useVintageStoryToolData({
        waypoints, 
        setWaypoints, 
        sourceNode, 
        setSourceNode, 
        destinationNode, 
        setDestinationNode,
    });

    return (
        <ButtonGroup >
            <FileUploader handleFiles={uploadWayPoints}>Upload Waypoints</FileUploader>
            <Button
                onClick={() => {
                    // Ensure new waypoint gets a unique ID
                    const newId = `new-${Date.now()}-${waypoints.length}-${Math.random().toString(36).substring(2, 9)}`; // More robust unique ID
                    const position: cytoscape.Position = {x: 0, y: 0};
                    const newRow: WayPoint = {
                        data: {
                            id: newId,
                            label: `Waypoint ${waypoints.length + 1}`,
                            height: 0,
                            createdTime: new Date(),
                            modifiedTime: new Date(),
                            origin: "browser",
                        },
                        position: position,
                    }

                    setWaypoints(prevWaypoints => [...prevWaypoints, newRow]);
                    //TODO: This is not working...
                    // onZoomPosition(position);
                }}
            >
                Add Waypoint
            </Button>
            <Button
                onClick={downloadWayPoints}
            >
                Download Waypoints
            </Button>
            <Button
                onClick={() => {
                    setWaypoints([]);
                }}
            >
                Delete WayPoints
            </Button>
            <Button onClick={() => onZoomPosition({ x: 0, y: 0 })}>Recenter</Button>
        </ButtonGroup>
    )
}