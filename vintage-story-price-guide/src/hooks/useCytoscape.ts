import { useRef, useEffect, RefObject } from 'react';
import cytoscape, { CytoscapeOptions } from 'cytoscape';

export type UseCytoscapeParams = {
    container: RefObject<HTMLElement | null>,
    cy?: ((cy: cytoscape.Core) => void) | undefined,
    stylesheet?: cytoscape.Stylesheet[] | Promise<cytoscape.Stylesheet[]> | undefined,
} & Omit<CytoscapeOptions, "container" | "style">;

export default function useCytoscape({
    container,
    cy: cyFunction,
    selectionType,
    elements,
    stylesheet,
    layout,
    zoom,
    pan,
    minZoom,
    maxZoom,
    zoomingEnabled,
    userZoomingEnabled,
    panningEnabled,
    userPanningEnabled,
    boxSelectionEnabled,
    touchTapThreshold,
    desktopTapThreshold,
    autolock,
    autoungrabify,
    autounselectify,
    headless,
    styleEnabled,
    hideEdgesOnViewport,
    hideLabelsOnViewport,
    textureOnViewport,
    motionBlur,
    motionBlurOpacity,
    wheelSensitivity,
    pixelRatio,
}: UseCytoscapeParams): void {
    const cyRef = useRef<cytoscape.Core>(null);

    useEffect(() => {
        if (container.current == undefined) {
            return; // Don't initialize if container isn't ready
        }

        const cy = cytoscape({
            container: container.current,
            selectionType,
            touchTapThreshold,
            hideEdgesOnViewport,
            hideLabelsOnViewport,
            textureOnViewport,
            motionBlur,
            motionBlurOpacity,
            wheelSensitivity,
            pixelRatio,
            desktopTapThreshold,
            styleEnabled,
            headless,
            autounselectify,
            autolock,
            autoungrabify,
            boxSelectionEnabled,
            userPanningEnabled,
            panningEnabled,
            userZoomingEnabled,
            zoomingEnabled,
            maxZoom,
            minZoom,
            pan,
            zoom,
        });
        cyRef.current = cy;
        if (cyFunction != undefined) {
            cyFunction(cy);
        }

        return () => {
            if (cyRef.current != undefined) {
                cyRef.current.destroy(); // Destroy the Cytoscape instance
                cyRef.current = null;    // Clear the ref
            }
        };
    }, [
        container,
        container.current, // TODO: Remove
        selectionType,
        touchTapThreshold,
        hideEdgesOnViewport,
        hideLabelsOnViewport,
        textureOnViewport,
        motionBlur,
        motionBlurOpacity,
        wheelSensitivity,
        pixelRatio,
        desktopTapThreshold,
        styleEnabled,
        headless,
        autounselectify,
        autolock,
        autoungrabify,
        boxSelectionEnabled,
        userPanningEnabled,
        panningEnabled,
        userZoomingEnabled,
        zoomingEnabled,
        maxZoom,
        minZoom,
        pan,
        zoom,

        cyFunction,
    ]);

    useEffect(() => {
        if (!cyRef.current) return;
        cyRef.current.json({ elements });
    }, [elements]);

    useEffect(() => {
        if (cyRef.current == undefined || stylesheet == undefined) return;

        // Handle promise if necessary
        if (stylesheet instanceof Promise) {
            stylesheet.then(resolvedStylesheet => {
                if (cyRef.current) { // Check again in case component unmounted
                    cyRef.current.style(resolvedStylesheet);
                }
            });
        } else {
            cyRef.current.style(stylesheet);
        }
    }, [stylesheet]);

    useEffect(() => {
        if (cyRef.current == undefined || layout == undefined) return;
        cyRef.current.layout(layout);
    }, [layout]);
}