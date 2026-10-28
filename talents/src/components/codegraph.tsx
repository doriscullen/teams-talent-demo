import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Input, Segmented, Select, Space, Spin, Tag } from 'antd';
import ForceGraph, { type LinkObject } from 'force-graph';
import { forceCollide, forceX, forceY } from 'd3-force-3d';
import type { GraphSnapshot } from '../../../shared/codegraph.ts';
import { graphView, type GraphLevel, type ViewNode } from '../codegraph-model.ts';
import { paintLabel, paintNode, paintSelection, palette, readTheme, rgba } from './codegraph-paint.ts';
import { InfoTip } from './ui.tsx';
import './codegraph.css';

type CanvasLink = LinkObject<ViewNode> & { kind: string; count: number; uncertain: boolean };
const EDGE = '#82999e';
const idOf = (end: CanvasLink['source']) => typeof end === 'object' ? end.id as string : end as string;
type Source = { filePath: string; startLine: number; endLine: number; content: string };
async function get<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? '读取失败');
  return data;
}

export function CodeGraphView() {
  const [graph, setGraph] = useState<GraphSnapshot>(), [failure, setFailure] = useState(''), [attempt, setAttempt] = useState(0);
  const [level, setLevel] = useState<GraphLevel>('symbol'), [service, setService] = useState('');
  const [tests, setTests] = useState(true), [crossCalls, setCrossCalls] = useState(true);
  const [relation, setRelation] = useState(''), [kinds, setKinds] = useState<string[]>([]), [hops, setHops] = useState(1);
  const [query, setQuery] = useState(''), [selected, setSelected] = useState(''), [focus, setFocus] = useState('');
  const [source, setSource] = useState<Source>(), [sourceError, setSourceError] = useState('');
  const host = useRef<HTMLDivElement>(null), instance = useRef<ForceGraph<ViewNode, CanvasLink>>(undefined);
  const selectedRef = useRef(''), syncRef = useRef<() => void>(undefined); selectedRef.current = selected;
  useEffect(() => {
    const controller = new AbortController(); setFailure(''); setGraph(undefined);
    get<GraphSnapshot>('/api/codegraph/carddemo', controller.signal).then(setGraph).catch(e => { if (!controller.signal.aborted) setFailure(e.message); });
    return () => controller.abort();
  }, [attempt]);
  const services = useMemo(() => [...new Set(graph?.nodes.map(n => n.service))].sort(), [graph]);
  const colors = useMemo(() => new Map(services.map((s, i) => [s, palette[i % palette.length]])), [services]);
  const options = { level, service, tests, crossCalls, kinds, relation, focus, hops };
  const view = useMemo(() => graph ? graphView(graph, options) : { nodes: [], links: [] }, [graph, level, service, tests, crossCalls, kinds, relation, focus, hops]);
  const selectedGroup = view.nodes.find(n => n.id === selected);
  const node = graph?.nodes.find(n => n.id === (level === 'symbol' ? selected : selectedGroup?.members.find(id => graph.nodes.find(n => n.id === id)?.kind === 'file') ?? selectedGroup?.members[0]));
  const results = useMemo(() => query.trim() ? view.nodes.filter(n => `${n.name} ${n.id}`.toLowerCase().includes(query.trim().toLowerCase())) : [], [view, query]);
  const choose = (n: ViewNode) => {
    setSelected(n.id);
    setQuery('');
    const chart = instance.current, positioned = chart?.graphData().nodes.find(item => item.id === n.id);
    if (!chart || !positioned) return;
    chart.centerAt(positioned.x ?? 0, positioned.y ?? 0, 600);
    if (level !== 'service') chart.zoom(Math.max(chart.zoom(), level === 'symbol' ? 2.6 : 1.8), 600);
  };
  useEffect(() => {
    if (!host.current || !graph) return;
    const container = host.current;
    const neighbours = new Map(view.nodes.map(n => [n.id, new Set<string>()]));
    for (const l of view.links) { neighbours.get(l.source)!.add(l.target); neighbours.get(l.target)!.add(l.source); }
    const degree = (n: ViewNode) => neighbours.get(n.id)!.size;
    const radius = new Map(view.nodes.map(n => [n.id, level === 'service' ? 10 + Math.sqrt(n.members.length) * .7
      : level === 'file' ? Math.min(14, 3 + Math.sqrt(degree(n)) * 1.2) : Math.min(10, 2 + Math.sqrt(degree(n)))]));
    // The best-connected nodes keep their labels when zoomed out; the rest appear as the user zooms in.
    const labelled = new Set([...view.nodes].sort((a, b) => degree(b) - degree(a)).slice(0, level === 'service' ? undefined : 15).map(n => n.id));
    const serviceOf = new Map(view.nodes.map(n => [n.id, n.service]));
    const focused = level === 'symbol' && neighbours.has(focus);
    const nodes = view.nodes.map(n => ({ ...n })), byId = new Map(nodes.map(n => [n.id, n]));
    if (focused) Object.assign(byId.get(focus)!, { fx: 0, fy: 0 });
    // Hover wins over selection; both light the node and its neighbours and dim everything else.
    let hovered = '', active = '', lit: Set<string> | undefined, ticks = 0, fitted = false;
    const linked = (l: CanvasLink) => !!active && (idOf(l.source) === active || idOf(l.target) === active);
    const baseAlpha = level === 'service' ? .5 : .35;
    let theme = readTheme(container);
    const chart = new ForceGraph<ViewNode, CanvasLink>(container).height(900)
      .nodeRelSize(1).nodeVal(n => radius.get(n.id)! ** 2).nodeColor(n => colors.get(n.service)!)
      .nodeLabel(n => {
        const tip = document.createElement('div'), title = tip.appendChild(document.createElement('strong'));
        title.textContent = n.name;
        tip.append(document.createElement('br'), `${n.kind} · ${n.service} · ${degree(n)} 个关联${level === 'symbol' ? '' : ` · ${n.members.length} 个符号`}`);
        return tip;
      })
      .nodeCanvasObjectMode(() => 'replace')
      .nodeCanvasObject((n, ctx) => paintNode(ctx, n.x!, n.y!, radius.get(n.id)!, colors.get(n.service)!, !!lit && !lit.has(n.id)))
      .linkCurvature(level === 'service' ? .25 : .18)
      // Links stay grey until their node is lit, then take the colour of the service they start from.
      .linkColor(l => linked(l) ? rgba(colors.get(serviceOf.get(idOf(l.source))!)!, .85) : rgba(EDGE, lit ? .06 : baseAlpha))
      .linkWidth(l => (linked(l) ? 2.2 : 1) * Math.min(level === 'service' ? 6 : 2.5, .6 + Math.log2(l.count + 1) * (level === 'service' ? .8 : .35)))
      .linkDirectionalArrowLength(l => level === 'symbol' && !linked(l) ? 0 : 4).linkDirectionalArrowRelPos(1)
      .linkDirectionalParticleWidth(level === 'service' ? 4 : 2.5).linkDirectionalParticleSpeed(.008).linkDirectionalParticleColor(l => colors.get(serviceOf.get(idOf(l.source))!)!)
      .linkLabel(e => `${e.kind} × ${e.count}`)
      .onRenderFramePost((ctx, scale) => {
        const chosen = byId.get(selectedRef.current);
        if (chosen) paintSelection(ctx, chosen.x!, chosen.y!, radius.get(chosen.id)!, scale, theme);
        const size = (level === 'service' ? 13 : 11) / scale, low = chart.screen2GraphCoords(0, 0), high = chart.screen2GraphCoords(chart.width(), 900);
        ctx.font = `500 ${size}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        for (const n of nodes) {
          const r = radius.get(n.id)!;
          if (n.x! < low.x || n.x! > high.x || n.y! < low.y || n.y! > high.y) continue;
          if (lit ? !lit.has(n.id) : !labelled.has(n.id) && r * scale < 7) continue;
          paintLabel(ctx, n.name, n.x!, n.y! + r + 3 / scale, scale, n.id === active, theme);
        }
      })
      .onNodeHover(n => { hovered = n?.id ?? ''; sync(); })
      .onNodeClick(choose).onBackgroundClick(() => setSelected(''))
      .d3VelocityDecay(.35).cooldownTicks(220)
      .onEngineTick(() => { if (++ticks === 70) chart.zoomToFit(900, 40); })
      .onEngineStop(() => { if (!fitted) chart.zoomToFit(600, 40); fitted = true; });
    // Services sit on a ring and pull their own nodes toward them, so each service settles as its own cluster.
    const services = [...new Set(view.nodes.map(n => n.service))], spread = Math.max(120, Math.sqrt(view.nodes.length) * 9);
    const anchors = new Map(services.map((s, i) => [s, services.length < 2 || level === 'service' ? [0, 0] : [Math.cos(2 * Math.PI * i / services.length) * spread, Math.sin(2 * Math.PI * i / services.length) * spread]]));
    const clustered = level !== 'service' && !focused, pull = level === 'service' ? .08 : .06;
    chart.d3Force('charge')!.strength(level === 'service' ? -900 : focused ? -160 : level === 'file' ? -45 : -22).distanceMax(level === 'service' ? Infinity : 320);
    chart.d3Force('link')!.distance(level === 'service' ? 200 : focused ? 70 : level === 'file' ? 34 : 20);
    chart.d3Force('collide', forceCollide<ViewNode>(n => radius.get(n.id)! + (level === 'service' ? 14 : 1.5)));
    // The service overview has a single anchor at the centre, which also keeps unlinked services from drifting off.
    chart.d3Force('x', clustered || level === 'service' ? forceX<ViewNode>(n => anchors.get(n.service)![0]).strength(pull) : null);
    chart.d3Force('y', clustered || level === 'service' ? forceY<ViewNode>(n => anchors.get(n.service)![1]).strength(pull) : null);
    const redraw = () => chart.nodeColor(chart.nodeColor()); // re-setting a styling prop requests a redraw
    // Particles run only on the lit links, so an idle graph stops redrawing.
    const sync = () => {
      active = hovered || selectedRef.current;
      lit = neighbours.has(active) ? new Set([active, ...neighbours.get(active)!]) : undefined;
      chart.linkDirectionalParticles(l => linked(l) ? 2 : 0);
      redraw();
    };
    const themeWatch = new MutationObserver(() => { theme = readTheme(container); redraw(); });
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    instance.current = chart; syncRef.current = sync;
    const observer = new ResizeObserver(([entry]) => chart.width(Math.max(1, entry.contentRect.width)));
    observer.observe(container);
    chart.graphData({ nodes, links: view.links.map(e => ({ ...e })) });
    sync();
    return () => { observer.disconnect(); themeWatch.disconnect(); chart._destructor(); instance.current = undefined; syncRef.current = undefined; };
  }, [graph, view, colors, level, focus]);
  useEffect(() => syncRef.current?.(), [selected]);
  useEffect(() => {
    setSource(undefined); setSourceError('');
    if (!node || !graph) return;
    const controller = new AbortController();
    get<Source>(`/api/codegraph/carddemo/source?id=${encodeURIComponent(node.id)}&snapshot=${graph.metadata.snapshotId}`, controller.signal)
      .then(setSource).catch(e => { if (!controller.signal.aborted) setSourceError(e.message); });
    return () => controller.abort();
  }, [node?.id, graph?.metadata.snapshotId]);
  if (failure) return <Alert type="error" title="无法读取代码图谱" description={failure} action={<Button onClick={() => setAttempt(a => a + 1)}>重试</Button>} />;
  if (!graph) return <Spin tip="正在读取真实索引…"><div style={{ height: 160 }} /></Spin>;
  const m = graph.metadata;
  const reset = () => { setSelected(''); setFocus(''); setQuery(''); };
  const connections = node ? graph.edges.filter(e => e.source === node.id || e.target === node.id) : [];
  return <div className="codegraph-view">
    <div className="cg-stats">{[['文件', m.files], ['节点', m.nodes], ['关系', m.edges]].map(([label, value]) => <div key={label}><strong>{Number(value).toLocaleString()}</strong><span>{label}</span></div>)}</div>
    <div className="cg-toolbar">
      <Segmented aria-label="图谱层级" value={level} onChange={v => { setLevel(v as GraphLevel); if (v === 'service') setService(''); reset(); }} options={[{ value: 'service', label: '服务概览' }, { value: 'file', label: '文件关系' }, { value: 'symbol', label: '符号关系' }]} />
      <Select aria-label="服务筛选" value={service} onChange={v => { setService(v); reset(); }} options={[{ value: '', label: '全部服务' }, ...services.map(value => ({ value, label: value }))]} />
      <Select aria-label="关系筛选" value={relation} onChange={setRelation} options={[{ value: '', label: '全部关系' }, ...Object.keys(m.edgeKinds).map(value => ({ value, label: value }))]} />
      {level === 'symbol' && <><Select mode="multiple" aria-label="符号类型" placeholder="类 / 接口 / 方法 / 路由" value={kinds} onChange={setKinds} options={Object.keys(m.nodeKinds).map(value => ({ value, label: value }))} /><Select aria-label="邻域深度" value={hops} onChange={setHops} options={[{ value: 1, label: '1 跳邻域' }, { value: 2, label: '2 跳邻域' }]} /></>}
      <Checkbox checked={tests} onChange={e => setTests(e.target.checked)}>包含测试</Checkbox>
      <Checkbox checked={crossCalls} onChange={e => setCrossCalls(e.target.checked)}>包含跨服务调用</Checkbox>
      <Button onClick={() => { reset(); instance.current?.zoomToFit(350, 35); }}>重置视图</Button>
    </div>
    <div className="cg-layout">
      <section className="cg-canvas-section">
        <div ref={host} className="cg-canvas" aria-label="代码关系图" />
        <div className="cg-search"><Input.Search aria-label="搜索图谱" placeholder="搜索当前图中的文件、类或方法" allowClear value={query} onChange={e => setQuery(e.target.value)} /><span className="caption" data-testid="graph-counts">{view.nodes.length} 节点 · {view.links.length} 连线</span></div>
        {query && <div className="cg-results" aria-label="搜索结果">{results.slice(0, 30).map(n => <button key={n.id} onClick={() => choose(n)}>{n.name}<small>{n.service} · {n.kind}</small></button>)}{!results.length && <p>当前筛选范围没有匹配结果</p>}{results.length > 30 && <p>共 {results.length} 项，显示前 30 项，请缩小搜索范围。</p>}</div>}
        {!view.nodes.length && <p className="cg-empty">当前筛选范围没有节点，请调整筛选条件。</p>}
        <div className="cg-legend">
          {services.filter(s => !service || s === service).map(s => <span key={s}><i style={{ background: colors.get(s) }} />{s}</span>)}
          <InfoTip>拖动节点调整布局，滚轮缩放，悬停高亮关联节点，点击查看详情。箭头和流动光点由 source 指向 target；同类型连线按原始边数量聚合。</InfoTip>
        </div>
      </section>
      <aside className="cg-detail">
        {!selectedGroup ? <p className="cg-placeholder">选择节点查看详情</p> : <>
          <Tag>{selectedGroup.kind}</Tag><h3>{selectedGroup.name}</h3><p className="path">{selectedGroup.id}</p><p>{selectedGroup.members.length} 个原始符号</p>
          {level === 'service' ? <Button onClick={() => { setService(selectedGroup.id); setLevel('file'); reset(); }}>浏览服务文件</Button> : level === 'file' ? <Button onClick={() => {
            const seed = graph.nodes.find(n => n.filePath === selectedGroup.id && ['class', 'interface', 'function'].includes(n.kind));
            setLevel('symbol'); setKinds([]); setSelected(seed?.id ?? ''); setFocus(seed?.id ?? '');
          }}>展开符号邻域</Button> : <Space wrap><Button onClick={() => setFocus(selected)}>聚焦邻域</Button><Button onClick={() => setFocus('')}>显示服务全部符号</Button></Space>}
          {node && level !== 'service' && <><p className="path">{node.filePath}:{node.startLine}–{node.endLine}</p><p>{node.layer}</p>{node.signature && <pre>{node.signature}</pre>}
            <h4>关联 <span className="section-count">{connections.length}</span></h4>
            <div className="cg-connections">{connections.slice(0, 40).map(e => {
              const incoming = e.target === node.id, other = graph.nodes.find(n => n.id === (incoming ? e.source : e.target));
              return other && <button key={e.id} onClick={() => { setService(''); setTests(tests || other.test); setKinds([]); setRelation(''); setLevel('symbol'); setSelected(other.id); setFocus(other.id); setCrossCalls(crossCalls || (e.crossService && e.kind === 'calls')); }}>
                {incoming ? '←' : '→'} {e.kind} · {other.name}<small>{e.provenance ?? '来源未标注'}{e.line ? ` · L${e.line}` : ''}</small>
              </button>;
            })}</div>
            <h4>快照源码{source && ` · L${source.startLine}–${source.endLine}`}</h4>{sourceError ? <Alert type="error" title={sourceError} /> : source ? <pre className="cg-source">{source.content.split('\n').map((line, i) => <span key={i} className={source.startLine + i >= node.startLine && source.startLine + i <= node.endLine ? 'cg-source-selected' : ''}><em>{source.startLine + i}</em>{line}{'\n'}</span>)}</pre> : <Spin />}
            {source && source.endLine < node.endLine && <p className="caption">仅预览前 300 行</p>}</>}
        </>}
      </aside>
    </div>

  </div>;
}
