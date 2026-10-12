'use client';

import useCytoscape, { UseCytoscapeParams } from "@/hooks/useCytoscape";
import { Box } from "@mui/material";
import { useRef } from "react";

export type CytoscapeComponent = { 
    // className?: string | undefined,
    // style?: CSSProperties | undefined,
} & Omit<UseCytoscapeParams, "container">;

export default function CytoscapeComponent(props: CytoscapeComponent) {
    const ref = useRef<HTMLDivElement>(null);
    useCytoscape({
        ...props,
        container: ref,
    });

    return (
         <Box ref={ref} sx={{ width: '100%', height: '50vh', border: "solid #ddd" }} />
    )
}