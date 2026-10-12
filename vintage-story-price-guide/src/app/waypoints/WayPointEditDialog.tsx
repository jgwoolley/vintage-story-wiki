'use client';

import { SubmitSnackbarMessage } from "@/components/SnackbarProvider";
import { Autocomplete, Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, TextField } from "@mui/material";
import { Dispatch, SetStateAction, useCallback, useState } from "react";
import { getWaypointCommand, stringifyWayPoint, WayPoint, WayPointInput } from "@/utils/utils";;

const submitSnackbarMessage: SubmitSnackbarMessage = (key, value, data) => {
    console.log({ key, value, data });
}

type WayPointsDataGridProps = {
    open: boolean,
    setOpen: Dispatch<SetStateAction<boolean>>
    rows: WayPoint[],
    setRows: Dispatch<SetStateAction<WayPoint[]>>,
    editRow: WayPointInput,
    setEditRow: Dispatch<SetStateAction<WayPointInput>>,
    setSourceNode: Dispatch<SetStateAction<WayPoint | undefined>>,
    setDestinationNode: Dispatch<SetStateAction<WayPoint | undefined>>,
    onZoomWayPoint: (waypoint: WayPoint) => void,
}

type NumericTextInputProps = {
    label: string, 
    value: string, 
    onUpdate: (waypoint: WayPointInput, value: string) => void,
    setEditRow: Dispatch<SetStateAction<WayPointInput>>,
}

function NumericTextInput({ label, value, onUpdate, setEditRow} : NumericTextInputProps) {
    const [ isError, setIsError ] = useState(false);

    return (
        <TextField 
            required
            id={label}
            label={label}
            type="text"
            variant="standard"
            value={value}
            error={isError}
            helperText={isError ? "Please enter a valid number.": undefined }
            onChange={(x) => {
                const value = x.target.value;
                const parsedValue = parseFloat(value);
                setIsError(isNaN(parsedValue));
                setEditRow(prev => {
                    const newRow: WayPointInput = {
                        ...prev,
                    };
                    onUpdate(newRow, value);
                    return newRow;
                });
            }}
        />
    )
}

export default function WayPointEditDialog({ rows, setRows, open, setOpen, editRow, setEditRow, setSourceNode, setDestinationNode, onZoomWayPoint }: WayPointsDataGridProps) {
    // const submitSnackbarMessage = useContext(SubmitSnackbarContext);

    const handleClose = useCallback(() => {
        setOpen(false);
    }, [setOpen]);

    const handleDelete = useCallback(() => {
        handleClose();
        setRows(prev => prev.filter(prevRow => prevRow.data.id !== editRow.data.id));
    }, [handleClose, setRows, editRow]);

    const onSubmit = useCallback((event: React.FormEvent) => {
        event.preventDefault();
        setRows(prev => {
            const results = prev.map(prevRow => {
                if (prevRow.data.id === editRow.data.id) {
                    return {
                        position: {
                            x: parseFloat(editRow.position.x),
                            y: parseFloat(editRow.position.y),
                        },
                        data: {
                            id: editRow.data.id,
                            label: editRow.data.label,
                            height: parseFloat(editRow.data.height),
                            createdTime: editRow.data.createdTime,
                            modifiedTime: editRow.data.modifiedTime,
                            origin: editRow.data.origin,
                            pinned: editRow.data.pinned,
                            color: editRow.data.color,
                            icon: editRow.data.icon,
                        },
                        connection: editRow.connection,
                    };
                } else if(prevRow.data.id === editRow.connection?.data.id) {
                    const newConnection = rows.find(x => x.data.id === editRow.data.id);
                    return  {
                        ...prevRow,
                        connection: newConnection,
                    };
                } else if(prevRow.data.id === editRow.connection?.connection?.data.id) {
                    return  {
                        ...prevRow,
                        connection: undefined,
                    };
                } 
                else {
                    return prevRow;
                }
            });
            submitSnackbarMessage("Submitted Changes", "success", results);
            handleClose();
            return results;
        });
    }, [
        rows, 
        setRows,
        editRow, 
        handleClose, 
        // submitSnackbarMessage,
    ]);

    return (
        <Dialog open={open} onClose={handleClose}>
            <DialogTitle>Edit Waypoint</DialogTitle>
            <DialogContent sx={{ paddingBottom: 0 }}>
                <DialogContentText>
                    Please update the waypoint details below.
                </DialogContentText>
                <Box
                    component="form"
                    sx={{ '& > :not(style)': { m: 1, width: '25ch' } }}
                    noValidate
                    autoComplete="off"
                >
                    <TextField
                        margin="dense"
                        id="name"
                        label="id"
                        type="text"
                        fullWidth
                        variant="standard"
                        disabled={true}
                        value={editRow.data.id}
                    />
                    <TextField
                        autoFocus
                        required
                        margin="dense"
                        id="name"
                        label="Waypoint"
                        type="text"
                        fullWidth
                        variant="standard"
                        value={editRow.data.label}
                        onChange={(x) => {
                            setEditRow(prev => {
                                const newRow: WayPointInput = {
                                    ...prev,
                                };
                                newRow.data.label = x.target.value;
                                return newRow;
                            });
                        }}
                    />
                    <NumericTextInput 
                        label="x"
                        value={editRow.position.x} 
                        onUpdate={(waypoint, value) => {
                            waypoint.position.x = value;
                        }} 
                        setEditRow={setEditRow}                    
                    />
                    <NumericTextInput 
                        label="y"
                        value={editRow.data.height} 
                        onUpdate={(waypoint, value) => {
                            waypoint.data.height = value;
                        }} 
                        setEditRow={setEditRow}                    
                    />
                    <NumericTextInput 
                        label="z"
                        value={editRow.position.y} 
                        onUpdate={(waypoint, value) => {
                            waypoint.position.y = value;
                        }} 
                        setEditRow={setEditRow}                    
                    />
                    <TextField
                        margin="dense"
                        id="origin"
                        label="Origin"
                        type="text"
                        fullWidth
                        variant="standard"
                        disabled={true}
                        value={editRow.data.origin}
                    />
                    <TextField
                        margin="dense"
                        id="createdTime"
                        label="Created Time"
                        type="text"
                        fullWidth
                        variant="standard"
                        disabled={true}
                        value={editRow.data.createdTime}
                    />
                    <TextField
                        margin="dense"
                        id="modifiedTime"
                        label="Modified Time"
                        type="text"
                        fullWidth
                        variant="standard"
                        disabled={true}
                        value={editRow.data.modifiedTime}
                    />
                    <Autocomplete
                        disablePortal
                        options={rows}
                        getOptionLabel={x => stringifyWayPoint(x)}
                        sx={{ width: 300 }}
                        value={editRow.connection ? editRow.connection : null}
                        onChange={(_, newValue) => {
                            setEditRow((prev) => {
                                return {
                                    ...prev,
                                    connection: newValue ?? undefined,
                                }
                            });
                        }}
                        renderInput={(params) => <TextField {...params} label="Connection" />}
                    />
                </Box>
                <Box>
                    <Button onClick={() => {
                        const row = rows.find(x => x.data.id === editRow.data.id);
                        if (row != undefined) {
                            setSourceNode(row);
                        }
                    }}>set source</Button>
                    <Button onClick={() => {
                        const row = rows.find(x => x.data.id === editRow.data.id);
                        if (row != undefined) {
                            setDestinationNode(row);
                        }
                    }}>set destination</Button>
                    <Button onClick={() => {
                        const row = rows.find(x => x.data.id === editRow.data.id);
                        if (row != undefined) {
                            onZoomWayPoint(row);
                        }
                    }}>Zoom</Button>
                    <Button onClick={async () => {
                        const row = rows.find(x => x.data.id === editRow.data.id);
                        if (row == undefined) {
                            return;
                        }
                        const command = getWaypointCommand(row);
                        await navigator.clipboard.writeText(command);
                    }}>Get Command</Button>
                    <Button onClick={() => {
                        if (editRow.connection != undefined) {
                            onZoomWayPoint(editRow.connection);
                        }
                    }}>Zoom On Connection</Button>
                </Box>
                <DialogActions
                    sx={{
                        flexDirection: { xs: 'column', sm: 'row' }, // Stack vertically on extra-small screens, row on small and up
                        '& > button': {
                            width: { xs: '100%', sm: 'auto' }, // Make buttons full width on extra-small
                            mb: { xs: 1, sm: 0 }, // Add bottom margin to stacked buttons
                        },
                        justifyContent: 'flex-end', // Keep buttons aligned to the end
                    }}
                >
                    <Button onClick={handleClose}>Cancel</Button>
                    <Button onClick={handleDelete}>Remove</Button>
                    <Button onClick={(e) => { onSubmit(e) }} type="submit">Submit</Button>
                </DialogActions>
            </DialogContent>
        </Dialog>
    )
}