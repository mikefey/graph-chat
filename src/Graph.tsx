import { useEffect, useMemo, useRef, useState } from 'react';
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import { select } from 'd3-selection';
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import 'd3-transition';
import { ROOT_ID, type ChatNode, type Tree } from './types';

interface SimNode extends SimulationNodeDatum {
  id: string;
  depth: number;
}
type SimLink = SimulationLinkDatum<SimNode> & { source: SimNode; target: SimNode };

const LEVEL_GAP = 90;

const radius = (n: ChatNode) => (n.role === 'root' ? 14 : 7 + Math.min(7, Math.sqrt(n.content.length) / 5));
const snippet = (s: string, len = 28) => {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > len ? `${flat.slice(0, len - 1)}…` : flat;
};

interface Props {
  tree: Tree;
  selectedId: string;
  activePath: Set<string>;
  onSelect: (id: string) => void;
}

export function Graph({ tree, selectedId, activePath, onSelect }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const simRef = useRef<Simulation<SimNode, SimLink>>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown>>(null);
  const simNodes = useRef(new Map<string, SimNode>());
  const [links, setLinks] = useState<SimLink[]>([]);
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);
  const transformRef = useRef(transform);
  transformRef.current = transform;
  const [, setFrame] = useState(0);

  // Set up simulation + zoom once.
  useEffect(() => {
    const sim = forceSimulation<SimNode, SimLink>()
      .force('link', forceLink<SimNode, SimLink>().id((d) => d.id).distance(LEVEL_GAP * 0.8).strength(0.9))
      .force('charge', forceManyBody().strength(-260).distanceMax(400))
      .force('collide', forceCollide(22))
      .force('x', forceX(0).strength(0.02))
      .force('y', forceY<SimNode>((d) => d.depth * LEVEL_GAP).strength(0.12))
      .on('tick', () => setFrame((f) => f + 1));
    simRef.current = sim;

    const svg = select(svgRef.current!);
    const z = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.15, 3])
      .filter((e: Event) => {
        const me = e as MouseEvent;
        return !(e.target as Element).closest('.node') && !me.button && (e.type === 'wheel' || !me.ctrlKey);
      })
      .on('zoom', (e) => setTransform(e.transform));
    zoomRef.current = z;
    const { width } = svgRef.current!.getBoundingClientRect();
    svg.call(z).on('dblclick.zoom', null);
    svg.call(z.transform, zoomIdentity.translate(width / 2, 80));

    return () => {
      sim.stop();
    };
  }, []);

  // Sync the tree into the simulation, spawning new nodes next to their parent.
  const nodeIds = Object.keys(tree).join();
  useEffect(() => {
    const sim = simRef.current!;
    const map = simNodes.current;
    const depthOf = (id: string): number => {
      const p = tree[id]?.parentId;
      return p ? depthOf(p) + 1 : 0;
    };

    for (const id of map.keys()) if (!tree[id]) map.delete(id);
    // Parents first, so children can spawn at the parent's position.
    const ordered = Object.values(tree).sort((a, b) => a.createdAt - b.createdAt);
    let added = false;
    for (const n of ordered) {
      if (map.has(n.id)) continue;
      const parent = n.parentId ? map.get(n.parentId) : undefined;
      const node: SimNode = {
        id: n.id,
        depth: depthOf(n.id),
        x: (parent?.x ?? 0) + (Math.random() - 0.5) * 30,
        y: (parent?.y ?? 0) + 30,
      };
      if (n.id === ROOT_ID) {
        node.fx = 0;
        node.fy = 0;
      }
      map.set(n.id, node);
      added = true;
    }

    const nextLinks = ordered
      .filter((n) => n.parentId && map.has(n.parentId))
      .map((n) => ({ source: map.get(n.parentId!)!, target: map.get(n.id)! }));
    sim.nodes([...map.values()]);
    (sim.force('link') as ReturnType<typeof forceLink<SimNode, SimLink>>).links(nextLinks);
    setLinks(nextLinks);
    sim.alpha(added ? 0.6 : 0.3).restart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeIds]);

  // Pan to the selected node if it has drifted off-screen.
  useEffect(() => {
    const t = setTimeout(() => {
      const n = simNodes.current.get(selectedId);
      const svgEl = svgRef.current;
      if (!n || !svgEl || !zoomRef.current) return;
      const { width, height } = svgEl.getBoundingClientRect();
      const [sx, sy] = transformRef.current.apply([n.x ?? 0, n.y ?? 0]);
      const m = 0.15;
      if (sx < width * m || sx > width * (1 - m) || sy < height * m || sy > height * (1 - m)) {
        select(svgEl).transition().duration(600).call(zoomRef.current.translateTo, n.x ?? 0, n.y ?? 0);
      }
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Dragging a node pins it; a press without movement selects it.
  const drag = useRef<{ id: string; startX: number; startY: number; moved: boolean } | null>(null);
  const toGraph = (e: React.PointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return transform.invert([e.clientX - rect.left, e.clientY - rect.top]);
  };
  const onPointerDown = (id: string) => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { id, startX: e.clientX, startY: e.clientY, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id === ROOT_ID) return;
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4) return;
    if (!d.moved) simRef.current!.alphaTarget(0.3).restart();
    d.moved = true;
    const n = simNodes.current.get(d.id)!;
    [n.fx, n.fy] = toGraph(e);
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) return onSelect(d.id);
    const n = simNodes.current.get(d.id)!;
    n.fx = n.fy = undefined;
    simRef.current!.alphaTarget(0);
  };

  const rendered = useMemo(() => Object.values(tree), [tree]);

  return (
    <svg ref={svgRef} className="graph" onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      <g transform={transform.toString()}>
        <g className="links">
          {links.map((l) => (
            <line
              key={l.target.id}
              className={activePath.has(l.target.id) ? 'link active' : 'link'}
              x1={l.source.x}
              y1={l.source.y}
              x2={l.target.x}
              y2={l.target.y}
            />
          ))}
        </g>
        <g className="nodes">
          {rendered.map((n) => {
            const s = simNodes.current.get(n.id);
            if (!s) return null;
            const r = radius(n);
            const cls = [
              'node',
              n.role,
              n.status,
              activePath.has(n.id) && 'on-path',
              n.id === selectedId && 'selected',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <g key={n.id} className={cls} transform={`translate(${s.x},${s.y})`} onPointerDown={onPointerDown(n.id)}>
                <title>{n.role === 'root' ? 'Start a new conversation' : n.content}</title>
                <circle className="halo" r={r + 6} />
                <circle r={r} />
                <text x={r + 6} dy="0.35em">
                  {n.role === 'root' ? 'start' : snippet(n.content) || '…'}
                </text>
              </g>
            );
          })}
        </g>
      </g>
    </svg>
  );
}
