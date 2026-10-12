import { useBrowserIsDarkMode } from "@/hooks/useBrowserIsDarkMode";
import cytoscape from "cytoscape";


type PatchedCytoscapeNode = cytoscape.Css.Node & { color: string | undefined };

// Cytoscape stylesheet definitions for nodes and edges
export default function useWayPointStylesheet(): cytoscape.Stylesheet[] {
    const isDarkMode = useBrowserIsDarkMode();

    const defaultNodeStyle : PatchedCytoscapeNode = {
        'background-color': isDarkMode ? '#fff': '#666',
        label: 'data(label)',
        "overlay-color": isDarkMode ? '#fff': '#444',
        color: isDarkMode ? '#fff': undefined,
        'width': '20px', // Fixed node size
        'height': '20px',
        'border-width': 1,
        'border-color': isDarkMode ? '#fff': '#444',
    };

    return [
    {
        selector: 'node',
        style: defaultNodeStyle,
    },
    {
        selector: 'edge',
        style: {
            'width': 2,
            'line-color': '#ccc',
            'target-arrow-color': '#ccc',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            'label': 'data(weight)', // Show weight if applicable
            'opacity': 0,
        },
    },
    {
        selector: '.highlighted-path',
        style: {
            'line-color': 'red',
            'target-arrow-color': 'red',
            'width': 4,
            // 'visibility': 'visible', // Ensure visible
            'opacity': 1, // Ensure opaque
            // 'z-index': 9999, // Bring highlighted path to front
        },
    },
    {
        selector: '.highlighted-node',
        style: {
            'background-color': 'blue',
            'border-width': 2,
            'border-color': 'darkblue',
            // 'z-index': 9999, // Bring highlighted node to front
        },
    },
    {
        selector: '.source-node',
        style: {
            'background-color': 'green',
            'border-width': 3,
            'border-color': 'darkgreen',
            // 'z-index': 9999,
        },
    },
    {
        selector: '.hidden-edge',
        style: {
            // 'visibility': 'hidden', // Used to hide non-shortest path edges
            'opacity': 0,
            'width': 0.1, // Small width to avoid rendering artifacts even if invisible
        },
    },
    // Style for teleporter edges (weight = 0)
    {
        selector: 'edge[weight = 0]',
        style: {
            'line-color': 'purple',
            'target-arrow-color': 'purple',
            'line-style': 'dotted', // Make them dotted for visual distinction
            'label': 'Teleporter',
            // 'font-size': '10px',
            // 'text-background-color': '#f0f',
            // 'text-background-opacity': 0.7,
        },
    },
];
}

