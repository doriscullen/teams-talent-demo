import type { GraphSnapshot } from '../../shared/codegraph.ts';

export type GraphLevel = 'service' | 'file' | 'symbol';
export interface ViewNode { id: string; name: string; service: string; kind: string; members: string[]; x?: number; y?: number }
export interface ViewLink { source: string; target: string; kind: string; count: number; uncertain: boolean }
export interface GraphOptions {
  level: GraphLevel; service: string; tests: boolean; crossCalls: boolean; kinds: string[];
  relation: string; focus: string; hops: number;
}
const SYMBOLS = new Set(['class', 'interface', 'enum', 'method', 'function', 'route']);

export function graphView(graph: GraphSnapshot, options: GraphOptions) {
  const { level, service, tests, crossCalls, kinds, relation, focus, hops } = options;
  let nodes = graph.nodes.filter(n => (tests || !n.test) && (!service || n.service === service)
    && (level !== 'symbol' || (kinds.length ? kinds.includes(n.kind) : SYMBOLS.has(n.kind))));
  let ids = new Set(nodes.map(n => n.id));
  let edges = graph.edges.filter(e => ids.has(e.source) && ids.has(e.target)
    && (!relation || e.kind === relation) && (crossCalls || !(e.crossService && e.kind === 'calls')));
  if (level === 'symbol' && focus && ids.has(focus)) {
    const neighborhood = new Set([focus]);
    for (let i = 0; i < hops; i++) {
      const next = new Set(neighborhood);
      for (const e of edges) if (neighborhood.has(e.source) || neighborhood.has(e.target)) { next.add(e.source); next.add(e.target); }
      for (const id of next) neighborhood.add(id);
    }
    nodes = nodes.filter(n => neighborhood.has(n.id));
    ids = neighborhood;
    edges = edges.filter(e => ids.has(e.source) && ids.has(e.target));
  }
  const key = (n: typeof nodes[number]) => level === 'service' ? n.service : level === 'file' ? n.filePath : n.id;
  const groups = new Map<string, ViewNode>(), groupFor = new Map<string, string>();
  for (const n of nodes) {
    const id = key(n);
    groupFor.set(n.id, id);
    if (!groups.has(id)) groups.set(id, { id, name: level === 'service' ? n.service : level === 'file' ? n.filePath.split('/').at(-1)! : n.name,
      service: n.service, kind: level === 'symbol' ? n.kind : level, members: [] });
    groups.get(id)!.members.push(n.id);
  }
  const links = new Map<string, ViewLink>();
  for (const e of edges) {
    const source = groupFor.get(e.source)!, target = groupFor.get(e.target)!;
    if (source === target && level !== 'symbol') continue;
    const id = JSON.stringify([source, target, e.kind]);
    if (!links.has(id)) links.set(id, { source, target, kind: e.kind, count: 0, uncertain: e.crossService && e.kind === 'calls' });
    links.get(id)!.count++;
  }
  return { nodes: [...groups.values()], links: [...links.values()] };
}
