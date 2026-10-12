'use client';

import { Alert, AlertColor, Snackbar } from "@mui/material";
import { createContext, PropsWithChildren, useCallback, useState } from "react";

export type SubmitSnackbarMessage = (message: string, type: AlertColor, data?: unknown) => void;
export type SnackbarHandleClose = (event: React.SyntheticEvent | Event, reason?: string) => void;

export const SubmitSnackbarContext = createContext<SubmitSnackbarMessage>(() => { });

export default function SnackbarProvider({ children }: PropsWithChildren) {
    const [snackbarOpen, setSnackbarOpen] = useState(false);
    const [snackbarMessage, setSnackbarMessage] = useState("No Message");
    const [alertColor, setAlertColor] = useState<AlertColor>("info");

    const submitSnackbarMessage: SubmitSnackbarMessage = useCallback((message, type, data) => {
        console.log(data || message);
        setAlertColor(type);
        setSnackbarMessage(message);
        setSnackbarOpen(true);
    }, [setAlertColor, setSnackbarMessage, setSnackbarOpen]);

    const handleClose: SnackbarHandleClose = useCallback((_event, reason) => {
        if (reason === 'clickaway') {
            return;
        }
        setSnackbarOpen(false);
    }, [setSnackbarOpen]);

    return (
        <SubmitSnackbarContext.Provider value={submitSnackbarMessage}>
            {children}
            <Snackbar
                open={snackbarOpen}
                autoHideDuration={6000}
                onClose={handleClose}
            >
                <Alert
                    onClose={handleClose}
                    severity={alertColor}
                    variant="filled"
                    sx={{ width: "100%" }}
                >
                    {snackbarMessage}
                </Alert>
            </Snackbar>
        </SubmitSnackbarContext.Provider>
    )
}