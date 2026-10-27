import cytoscape, { type Core, type ElementDefinition, type LayoutOptions } from 'cytoscape';
import dagre from 'cytoscape-dagre';
import { useEffect, useMemo, useRef } from 'react';
import type { Edge, Flag, TabNode } from '../shared/types';
import { displayHost } from '../shared/urls';
import { nodeBadge, nodeColor } from './nodeActions';

cytoscape.use(dagre);

export interface GraphProps {
  nodes: TabNode[];
  edges: Edge[];
  flags: Flag[];
  selectedId: string | null;
  onSelect: (nodeId: string | null) => void;
}

const STYLE: cytoscape.StylesheetJson = [
  {
    selector: 'node',
    style: {
      'background-color': '#161b22',
      'border-width': 2,
      'border-color': 'data(color)',
      label: 'data(label)',
      color: '#e6edf3',
      'font-size': '9px',
      'text-valign': 'center',
      'text-halign': 'center',
      'text-wrap': 'ellipsis',
      'text-max-width': '110px',
      width: '132px',
      height: '40px',
      shape: 'round-rectangle',
    },
  },
  {
    selector: 'node[badge != ""]',
    style: {
      'border-style': 'double',
      'border-width': 3,
    },
  },
  {
    selector: 'node.current',
    style: {
      'background-color': '#1f2a3d',
      'border-color': '#58a6ff',
      'border-width': 3,
    },
  },
  {
    selector: 'edge',
    style: {
      width: 1,
      'line-color': '#30363d',
      'target-arrow-color': '#30363d',
      'target-arrow-shape': 'triangle',
      'arrow-scale': 0.7,
      'curve-style': 'bezier',
      opacity: 0.9,
    },
  },
  {
    selector: 'edge[type = "revisit"]',
    style: { 'line-style': 'dashed', 'line-color': '#8b949e' },
  },
  {
    selector: 'edge[type = "new-tab"]',
    style: { 'line-color': '#2f81f7', 'target-arrow-color': '#2f81f7' },
  },
  {
    selector: 'edge[type = "spa"]',
    style: { 'line-color': '#a371f7', 'target-arrow-color': '#a371f7' },
  },
];

function labelFor(node: TabNode): string {
  const title = node.title.trim();
  if (!title) return displayHost(node.url);
  return title.length > 32 ? `${title.slice(0, 31)}…` : title;
}

function elementsFor(nodes: TabNode[], edges: Edge[], flags: Flag[]): ElementDefinition[] {
  const nodeElements: ElementDefinition[] = nodes.map((node) => ({
    data: {
      id: node.id,
      label: labelFor(node),
      color: nodeColor(node, flags),
      badge: nodeBadge(node),
    },
  }));
  const edgeElements: ElementDefinition[] = edges
    .filter((edge) => nodes.some((node) => node.id === edge.from) && nodes.some((n) => n.id === edge.to))
    .map((edge) => ({
      data: { id: edge.id, source: edge.from, target: edge.to, type: edge.type },
    }));
  return [...nodeElements, ...edgeElements];
}

export function Graph({ nodes, edges, flags, selectedId, onSelect }: GraphProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const nodesRef = useRef(nodes);
  const onSelectRef = useRef(onSelect);
  const lastIdsRef = useRef('');
  nodesRef.current = nodes;
  onSelectRef.current = onSelect;

  const elements = useMemo(() => elementsFor(nodes, edges, flags), [nodes, edges, flags]);

  useEffect(() => {
    if (!containerRef.current) return;
    const cy = cytoscape({
      container: containerRef.current,
      elements: [],
      style: STYLE,
      layout: { name: 'grid' },
      wheelSensitivity: 0.2,
      minZoom: 0.15,
      maxZoom: 2.5,
    });

    cy.on('tap', 'node', (event) => {
      onSelectRef.current(event.target.id());
    });
    cy.on('tap', (event) => {
      if (event.target === cy) onSelectRef.current(null);
    });
    cy.on('dbltap', 'node', (event) => {
      const node = nodesRef.current.find((candidate) => candidate.id === event.target.id());
      if (!node) return;
      void focusTab(node);
    });

    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, []);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const ids = nodes.map((node) => node.id).join('|');
    if (ids !== lastIdsRef.current) {
      lastIdsRef.current = ids;
      cy.elements().remove();
      cy.add(elements);
      const layout = cy.layout({
        name: 'dagre',
        rankDir: 'TB',
        nodeSep: 18,
        rankSep: 64,
        edgeSep: 12,
        animate: false,
        fit: true,
        padding: 24,
      } as LayoutOptions);
      layout.run();
      return;
    }
    for (const element of elements) {
      const cyNode = cy.getElementById(String(element.data.id));
      if (cyNode.nonempty()) cyNode.data(element.data);
    }
  }, [elements, nodes]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes().removeClass('current');
    if (selectedId) cy.getElementById(selectedId).addClass('current');
  }, [selectedId]);

  return (
    <div className="graph">
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      {nodes.length === 0 && (
        <div className="empty" style={{ position: 'absolute', inset: 0 }}>
          <strong>No pages recorded yet</strong>
          <span className="small">Browse in Chrome and pages will appear here as a tree.</span>
        </div>
      )}
      <div className="graph-tools">
        <button
          type="button"
          onClick={() => {
            const cy = cyRef.current;
            if (!cy) return;
            cy.fit(undefined, 30);
          }}
        >
          Fit
        </button>
        <button
          type="button"
          onClick={() => {
            const cy = cyRef.current;
            if (!cy) return;
            const current = nodes.find((node) => node.id === selectedId);
            if (current) cy.center(cy.getElementById(current.id));
          }}
        >
          Center
        </button>
      </div>
    </div>
  );
}

async function focusTab(node: TabNode): Promise<void> {
  try {
    const tab = await chrome.tabs.update(node.tabId, { active: true });
    if (tab?.windowId !== undefined) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
  } catch {
    await chrome.tabs.create({ url: node.url });
  }
}
