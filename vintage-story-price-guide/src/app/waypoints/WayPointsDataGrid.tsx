'use client';

import { Button, ButtonGroup } from "@mui/material";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import { calculateDistance, WayPoint } from "@/utils/utils";;

type WayPointsDataGridProps = {
    sourceNode: WayPoint | undefined,
    destinationNode: WayPoint | undefined,
    rows: WayPoint[],
    onZoom: (waypoint: WayPoint) => void,
    setSourceNode: (waypoint: WayPoint | undefined) => void,
    setDestinationNode: (waypoint: WayPoint | undefined) => void,
    handleOpenEditDialog: (waypoint: WayPoint) => void,
}

export default function WayPointsDataGrid({ sourceNode, destinationNode, rows, onZoom, setSourceNode, setDestinationNode, handleOpenEditDialog}: WayPointsDataGridProps) {
    const columns: GridColDef<WayPoint>[] = [
        {
            field: 'id',
            headerName: 'id',
            valueGetter: (_, row) => row.connection?.data.id,
        },
        {
            field: 'label',
            headerName: 'Waypoint',
            valueGetter: (_, row) => row.data.label,
        },
        {
            field: 'x',
            headerName: 'X',

            valueGetter: (_, row) => row.position.x,

        },
        {
            field: 'y',
            headerName: 'Y',
            valueGetter: (_, row) => row.data.height,

        },
        {
            field: 'z',
            headerName: 'Z',
            valueGetter: (_, row) => row.position.y,
        },
        {
            field: 'connection',
            headerName: 'connection',
            valueGetter: (_, row) => row.connection?.data.label,
        },
        {
            field: 'createdTime',
            headerName: 'createdTime',
            valueGetter: (_, row) => row.connection?.data.createdTime,
        },
        {
            field: 'modifiedTime',
            headerName: 'modifiedTime',
            valueGetter: (_, row) => row.connection?.data.modifiedTime,
        },
        {
            field: 'origin',
            headerName: 'origin',
            valueGetter: (_, row) => row.connection?.data.origin,
        },
        {
            field: 'distance',
            headerName: 'Distance From Source',
            valueGetter: (_, row) => {
                if(sourceNode != undefined) {
                    return calculateDistance({source: sourceNode, destination: row});
                }
                return Infinity;
            },
        },
        {
            field: 'actions',
            headerName: 'Actions',
            sortable: false,
            filterable: false,
            hideable: false,
            flex: 1,
            renderCell: ({ row }) => {
                return (<ButtonGroup>
                    <Button variant="outlined" onClick={() => handleOpenEditDialog(row)}>edit</Button>
                    <Button variant="outlined" onClick={() => onZoom(row)}>zoom</Button>
                    <Button variant={sourceNode?.data.id === row.data.id ? "contained": "outlined"} onClick={() => {
                        setSourceNode(row);
                        onZoom(row);
                    }}>set source</Button>
                    <Button variant={destinationNode?.data.id === row.data.id ? "contained": "outlined"} onClick={() => {
                        setDestinationNode(row);
                        onZoom(row);
                    }}>set destination</Button>
                </ButtonGroup>)
            }
        }
    ];

    return (
        <>
            <DataGrid
                columns={columns}
                rows={rows}
                getRowId={x => x.data.id}
                initialState={{columns: {columnVisibilityModel: { 
                    distance: false ,
                    createdTime: false,
                    modifiedTime: false,
                    origin: false,
                    id: false,
                }}}}
            />
            
        </>
    )
}
