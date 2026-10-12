'use client';

import { Table, TableBody, TableCell, TableContainer, TableHead, TableRow } from "@mui/material";
import cytoscape from "cytoscape";
import { calculateDistance, convertNodeToWayPoint, PathStep, WayPoint } from "@/utils/utils";;

export type OnZoomNode = (eles?: cytoscape.CollectionArgument, padding?: number) => void;

export type PathStepsTableProps = {
    pathSteps: PathStep[],
    onZoomNode: OnZoomNode,
    sourceNode: WayPoint | undefined,
    destinationNode: WayPoint | undefined,
}

type PathStepRowProps = {
    node: cytoscape.NodeSingular,
    distance: number,
    onZoomNode: OnZoomNode,
}

function PathStepRow({ node, distance, onZoomNode }: PathStepRowProps) {
    const waypoint = convertNodeToWayPoint(node);
    const {data: {label, height: y}, position: { x, y: z}} = waypoint;

    return (
        <TableRow>
            <TableCell sx={{ cursor: "pointer" }} onClick={() => onZoomNode(node)}>{label}</TableCell>
            <TableCell>{x}</TableCell>
            <TableCell>{y}</TableCell>
            <TableCell>{z}</TableCell>
            <TableCell>{distance}</TableCell>
        </TableRow>
    )
}

export default function PathStepsTable({ pathSteps, onZoomNode, sourceNode, destinationNode }: PathStepsTableProps) {
    if (sourceNode == undefined || destinationNode == undefined || pathSteps.length < 1) {
        return "No Path to display.";
    }

    return (
        <TableContainer>
            <Table>
                <TableHead>
                    <TableRow>
                        <TableCell>waypoint</TableCell>
                        <TableCell>x</TableCell>
                        <TableCell>y</TableCell>
                        <TableCell>z</TableCell>
                        <TableCell>distance</TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    <PathStepRow
                        node={pathSteps[0].from}
                        onZoomNode={onZoomNode}
                        distance={0}
                    />
                    {pathSteps.map((x, index) => (
                        <PathStepRow
                            key={index}
                            node={x.to}
                            onZoomNode={onZoomNode}
                            distance={Math.round(x.distance * 10) / 10}
                        />))}
                    <TableRow>
                        <TableCell><b>Total</b></TableCell>
                        <TableCell></TableCell>
                        <TableCell></TableCell>
                        <TableCell></TableCell>
                        <TableCell><b>{pathSteps.reduce((acc, obj) => acc + obj.distance, 0)}</b></TableCell>
                    </TableRow>
                    <TableRow>
                        <TableCell><b>Bird&#39;s Eye Distance</b></TableCell>
                        <TableCell></TableCell>
                        <TableCell></TableCell>
                        <TableCell></TableCell>
                        <TableCell><b>{Math.round(calculateDistance({ source: sourceNode, destination: destinationNode }))}</b></TableCell>
                    </TableRow>
                </TableBody>
            </Table>
        </TableContainer>
    )
}