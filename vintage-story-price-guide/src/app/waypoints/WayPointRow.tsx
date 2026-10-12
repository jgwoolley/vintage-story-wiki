'use client';

import { Dispatch, SetStateAction } from "react";
import { WayPoint } from "@/utils/utils";;
import WayPointSelection from "./WayPointSelection";

export type WayPointRowProps = {
    row: WayPoint,
    editRow: number,
    setEditRow: Dispatch<SetStateAction<number>>,
    index: number,
    waypoints: WayPoint[],
    setWaypoints: Dispatch<SetStateAction<WayPoint[]>>
    splitWaypoints: (start: number, deleteCount?: number) => WayPoint[],
    onZoom: (waypoint: WayPoint) => void,
    sourceNode: WayPoint | undefined,
    setSourceNode: (waypoint: WayPoint | undefined) => void,
    destinationNode: WayPoint | undefined,
    setDestinationNode: (waypoint: WayPoint | undefined) => void,
    showDebugInfo: boolean,
}

export default function WayPointRow({ 
    waypoints, 
    setWaypoints, 
    row, 
    index, 
    splitWaypoints, 
    editRow, 
    setEditRow, 
    onZoom,
    sourceNode,
    setSourceNode,
    destinationNode,
    setDestinationNode,
    showDebugInfo
}: WayPointRowProps) {
    if (editRow === index) {
        return (
            <tr>
                <td>
                    <input value={row.data.label} onChange={(e) => {
                        row.data.label = e.target.value;
                        setWaypoints([...waypoints]);
                    }} />
                </td>
                {showDebugInfo && <td>{row.data.id}</td>}
                <td>
                    <input value={row.position.x} onChange={(e) => {
                        const value = parseInt(e.target.value);
                        if(value == undefined || isNaN(value)) {
                            return;
                        }
                        row.position.x = value;
                        setWaypoints([...waypoints]);
                    }} />
                </td>
                <td>
                    <input value={row.data.height} onChange={(e) => {
                        const value = parseInt(e.target.value);
                        if(value == undefined || isNaN(value)) {
                            return;
                        }
                        row.data.height = value;
                        setWaypoints([...waypoints]);
                    }} />
                </td>
                <td>
                    <input value={row.position.y} onChange={(e) => {
                        const value = parseInt(e.target.value);
                        if(value == undefined || isNaN(value)) {
                            return;
                        }
                        row.position.y = value;
                        setWaypoints([...waypoints]);
                    }} />
                </td>
                <td>
                    <WayPointSelection
                        name="destinationNode"
                        id="destinationNode"
                        node={row.connection}
                        setNode={(value) => {
                            row.connection = value;
                            setWaypoints([...waypoints]);
                        }}
                        waypoints={waypoints}
                        emptyValid={true}
                    />
                </td>
                {showDebugInfo && <td>{row.connection?.data.id}</td>} 
                <td>
                    <button onClick={() => splitWaypoints(index, 1)}>remove</button>
                    <button onClick={() => setEditRow(-1)}>save</button>
                </td>
            </tr>
        )
    }

    const isSource = sourceNode?.data.id === row.data.id;
    const isDestination = destinationNode?.data.id === row.data.id;

    return (
        <tr>
            <td>{isSource || isDestination ? <b>{row.data.label}</b>: <span>{row.data.label}</span>}</td>
            {showDebugInfo && <td>{isSource || isDestination ? <b>{row.data.label}</b>: <span>{row.data.id}</span>}</td>}
            <td>{row.position.x}</td>
            <td>{row.data.height}</td>
            <td>{row.position.y}</td>
            <td>{row.connection?.data.label}</td>
            {showDebugInfo && <td>{row.connection?.data.id}</td>}
            <td>
                <button onClick={() => setEditRow(index)}>edit</button>
                <button onClick={() => onZoom(row)}>zoom</button>
                <button onClick={() => {
                    setSourceNode(row);
                    onZoom(row);
                }}>set source</button>
                <button onClick={() => {
                    setDestinationNode(row);
                    onZoom(row);
                }}>set destination</button>
            </td>
        </tr>
    )
}