import { Button } from "@mui/material"
import { useEffect, useState } from "react";

// TODO: WIP

export type FileDownloaderProps = {
    producer: () => File,
}

export default function FileDownloader({producer}: FileDownloaderProps) {
    const [url, setUrl] = useState<string>();
    const [filename, setFilename] = useState<string>();

    useEffect(() => {
        // This function will run when the component unmounts
        // or when the 'url' state changes.
        return () => {
            // If a URL exists, revoke it to free up memory
            if (url) {
                window.URL.revokeObjectURL(url);
            }
        };
    }, [url]); // The effect re-runs whenever the 'url' state changes

    if(url) {
        return <Button download={filename} href={url}>
            Download
        </Button>
    }

    return <Button onClick={() => {
        const file = producer();
        const url = window.URL.createObjectURL(file);
        setFilename(filename);
        setUrl(url);
    }}></Button>
}