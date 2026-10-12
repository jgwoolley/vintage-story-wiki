import { SubmitSnackbarMessage } from "@/components/SnackbarProvider";
import cytoscape from "cytoscape";
import { Dispatch, SetStateAction, useEffect } from "react";
import { PathStep, WayPoint } from "@/utils/utils";;

export type UseWayPointGraphProps = {
    cy: cytoscape.Core | null,
    sourceNode: WayPoint | undefined,
    // setSourceNode: Dispatch<SetStateAction<WayPoint | undefined>>,
    destinationNode: WayPoint | undefined,
    // setDestinationNode: Dispatch<SetStateAction<WayPoint | undefined>>,
    setPathSteps: Dispatch<SetStateAction<PathStep[]>>,
    waypoints: WayPoint[],
    // submitMessage: SubmitSnackbarMessage,
};

export type CalculateGraphProps = {
    cy: cytoscape.Core | null,
    sourceNode: WayPoint | undefined,
    destinationNode: WayPoint | undefined,
    setPathSteps: Dispatch<SetStateAction<PathStep[]>>,
    waypoints: WayPoint[],
    // submitSnackbarMessage: SubmitSnackbarMessage,
};

const submitSnackbarMessage: SubmitSnackbarMessage = (key, value, data) => {
    console.log({key, value, data});
}

function calculateGraph({ cy, sourceNode, destinationNode, setPathSteps, waypoints }: CalculateGraphProps) {
    if (cy == undefined) {
        return;
    }

    // Clear all previous highlights and classes
    cy.elements().removeClass('highlighted-path highlighted-node source-node highlighted-target hidden-edge');

    if (waypoints == undefined || waypoints.length === 0) {
        return;
    }

    const sourceCyNode = sourceNode ? cy.$(`#${sourceNode.data.id}`) : cy.collection();
    const destinationCyNode = destinationNode ? cy.$(`#${destinationNode.data.id}`) : cy.collection();

    if (sourceNode == undefined || sourceCyNode.empty() || destinationNode == undefined || destinationCyNode.empty()) {
        // Only submit a message if *after* a path was previously found, or if nodes were expected to exist.
        // For initial renders where nodes might not be ready, simply return without a message.
        // This is the key to avoid the render-triggered setState.
        // We'll rely on the main useEffect dependencies to re-trigger when nodes become available.

        // If source or destination became undefined, clear path steps and show all edges
        if (sourceNode === undefined || destinationNode === undefined || sourceNode.data.id === destinationNode.data.id) {
            cy.edges("edge[weight != 0]").removeClass('hidden-edge');
            setPathSteps([]);
        }
        console.error("nodes aren't ready");
        return; // Do not proceed or submit message if nodes aren't ready
    }

    cy.edges().addClass('hidden-edge'); // Temporarily hide all edges for path highlighting


    if (sourceCyNode.length === 0 || destinationCyNode.length === 0) {
        submitSnackbarMessage("Failed to calculate graph", "error", { 
            source: sourceCyNode, 
            destination: destinationCyNode, 
            sourceNode, destinationNode, 
            sourceId: sourceNode.data.id, 
            destinationId: destinationNode.data.id 
        });
        console.error("Failed to calculate graph");
        return;
    }

    const aStarResult = cy.elements().aStar({
        root: sourceCyNode,
        goal: destinationCyNode,
        // root: `#${sourceNode.data.id}`,
        // goal: `#${destinationNode.data.id}`,
        weight: edges => {
            const edge = edges[0];
            const edgeWeight = edge.data('weight');
            // Ensure weight is a number, default to 1 if problematic
            return typeof edgeWeight === 'number' && !isNaN(edgeWeight) ? edgeWeight : 1;
        },
        directed: false, // Set to true if your graph is directed
    });

    const path = aStarResult.path;

    if(path == undefined|| path.length <= 0 || aStarResult.found === false) {
        submitSnackbarMessage("No path found between selected nodes. Showing all edges.", "error");
        cy.edges("edge[weight != 0]").removeClass('hidden-edge'); // If no path, show all edges again
        cy.getElementById(sourceNode.data.id).addClass('source-node');
        if (destinationNode) {
            cy.getElementById(destinationNode.data.id).addClass('highlighted-node');
        }
        return;
    }

    path.nodes().addClass('highlighted-node');

    // Ensure source and destination nodes are specifically highlighted
    cy.getElementById(sourceNode.data.id).addClass('source-node');
    cy.getElementById(destinationNode.data.id).addClass('highlighted-node');

    // Populate path steps for the table
    const currentPathSteps: PathStep[] = [];
    for (let i = 0; i < path.nodes().length - 1; i++) {
        const fromNode = path.nodes()[i];
        const toNode = path.nodes()[i + 1];
        const edges = fromNode.edgesWith(toNode);
        edges.removeClass('hidden-edge').addClass('highlighted-path');
        if (edges.length > 0) {
            edges.forEach(edge => {
                currentPathSteps.push({
                    id: edge.id(),
                    from: fromNode,
                    to: toNode,
                    distance: edge.data('weight') || 0, // TODO: Fix this
                });
            })
        }
    }
    setPathSteps(currentPathSteps);
    // cy.fit(path);
}

export function useWayPointGraph({ cy, sourceNode, destinationNode, setPathSteps, waypoints }: UseWayPointGraphProps) {    

    /**
     * useEffect hook for handling shortest path highlighting and edge visibility.
     */
    useEffect(() => {
        console.log("redraw");
        try {
            calculateGraph({
                cy,
                setPathSteps, 
                sourceNode, 
                destinationNode, 
                waypoints,
            });
        } catch (e) {
            // TODO: This error might be happening due to issues serializing the source / dest objects...
            console.error({ e, sourceNode, destinationNode });
        }
    }, [
        cy,
        setPathSteps, 
        sourceNode, 
        destinationNode, 
        waypoints,
    ]); // Re-run when these dependencies change
}