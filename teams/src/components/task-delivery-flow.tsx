import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { Alert, Button, Descriptions, Drawer, Empty, List, Tag } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';
import { useDemo } from '../context.js';
import { triggerTaskAutomation } from '../api.js';
import { deliveryRequirement } from '../delivery-requirements.js';
import { taskAutomation, taskNodeKnowledge, collectTaskSessions, type TaskScope, type KnowledgeImport, type TaskAutomation } from '../task-automation.js';
import { taskExecutableBy } from '../task-visibility.js';
import type { TalentNodeInputs } from '../talent-node-inputs.js';
import { useTaskNodeInputs } from './use-task-node-inputs.js';
import '../task-delivery-flow.css';

export type FlowStatusTone = 'default' | 'processing' | 'success' | 'warning' | 'error';
const statusTagColors: Record<FlowStatusTone, string> = { default: 'default', processing: 'blue', success: 'green', warning: 'orange', error: 'red' };
export const nodeStatusTones = { pending: 'default', running: 'processing', blocked: 'error', complete: 'success', 'waiting-owner': 'warning' } as const;
export const preparationStatusTones: Record<NonNullable<TaskAutomation['preparation']>['status'], FlowStatusTone> = { queued: 'default', importing: 'processing', 'preparing-session': 'processing', ready: 'success', 'waiting-directory': 'default', failed: 'error' };
export const importedStatusTones: Record<string, FlowStatusTone> = { '已确认': 'success', '已提交': 'success', '已形成场景': 'success', '已完成': 'success', '待 C 评审': 'warning', '待 A 确认': 'warning', '未开始': 'default', '未执行': 'default', '未提交': 'default', '仅有测试准备': 'default', '来源未提供': 'default' };
export interface FlowNode { id: string; label: string; role: string; description: string; status: string; statusTone?: FlowStatusTone; complete?: boolean; running?: boolean; summary?: string }
const knowledgeNodes = [{ id: 'prepare', label: '需求知识获取', trigger: '分配后自动获取' }, { id: 'develop', label: '开发知识获取', trigger: 'PRD 确认后自动获取' }, { id: 'verify', label: '测试知识获取', trigger: '开发成果提交后自动获取' }] as const;
type KnowledgeNode = typeof knowledgeNodes[number]['id'];
export const knowledgeLabels: Record<KnowledgeImport['status'], string> = { 'waiting-upstream': '等待上游', queued: '待获取', running: '获取中', ready: '已完成', waiting: '等待输入就绪', failed: '获取失败' };
const knowledgeStatusTones: Record<KnowledgeImport['status'], FlowStatusTone> = { 'waiting-upstream': 'default', queued: 'default', running: 'processing', ready: 'success', waiting: 'default', failed: 'error' };
const collectionLabels = { queued: '待收集', running: '收集中', collected: '已收集 · 待共享', empty: '无关联会话', failed: '收集失败' };

export function TaskDeliveryFlow({ scope, nodes, selected, onSelect, readonly = false, showAutomation = true, ariaPrefix = '节点：', nodeInputs }: { nodeInputs?: TalentNodeInputs; scope: TaskScope; nodes: FlowNode[]; selected: string; onSelect(id: string): void; readonly?: boolean; showAutomation?: boolean; ariaPrefix?: string }) {
  const { state, role, receiveState } = useDemo();
  const [detail, setDetail] = useState<KnowledgeNode | 'collection' | null>(null), [pending, setPending] = useState(false), [error, setError] = useState('');
  const record = taskAutomation(state, scope), task = deliveryRequirement(state, scope.projectId, scope.taskId), inFlight = useRef(false);
  const scopeKey = [scope.projectId, scope.taskId, role].join('/'), activeScope = useRef(scopeKey); activeScope.current = scopeKey;
  const canRetry = !readonly && !!task && (role === 'owner' || taskExecutableBy(role, task.assigneeId));
  useEffect(() => { setDetail(null); setError(''); }, [scopeKey]);
  const trigger = async (step: 'collection' | 'node-knowledge', nodeId?: KnowledgeNode) => {
    if (inFlight.current) return;
    inFlight.current = true; setPending(true); setError(''); const key = scopeKey;
    try { receiveState(await triggerTaskAutomation(role, scope, step, true, nodeId)); }
    catch (cause) { if (activeScope.current === key) setError((cause as Error).message); }
    finally { inFlight.current = false; if (activeScope.current === key) setPending(false); }
  };
  // Reading knowledge never schedules an import. Retain accepted-task collection.
  useEffect(() => { if (!readonly && role === 'owner' && record?.collection?.status === 'queued') void trigger('collection'); }, [readonly, role, record?.collection?.status, scope.projectId, scope.taskId]);
  const detailNode = detail && detail !== 'collection' ? detail : 'prepare';
  const detailKnowledge = taskNodeKnowledge(record, detailNode);
  const detailRead = useTaskNodeInputs(scope.projectId, scope.taskId, detailNode, !!detail && detail !== 'collection' && (!detailKnowledge || detailKnowledge.status === 'ready'));
  const detailInputs = detailKnowledge?.status === 'ready' ? detailKnowledge.nodeInputs ?? detailRead.value : !detailKnowledge ? detailRead.value ?? (nodeInputs?.nodeId === detailNode ? nodeInputs : undefined) : undefined;
  const knowledgeStatus = (id: KnowledgeNode) => { const item = taskNodeKnowledge(record, id); return item ? knowledgeLabels[item.status] : readonly ? '来源只读 · 未执行' : '尚无获取记录'; };
  const collection = record?.collection, receiptId = collection?.reporting?.receipt?.id ?? '';
  const receiptStatus = receiptId.startsWith('SHARED-') ? '已写入共享目录' : receiptId.startsWith('TALENT-INBOX-') ? '历史 Talent 已接收' : '已取得归集回执';
  const collectionStatus = collection?.reporting?.status === 'reported' ? '已完成' : collection?.reporting?.status === 'uploading' ? '共享中' : collection?.reporting?.status === 'failed' ? '共享失败' : collection ? collectionLabels[collection.status] : '等待验收';
  const collectionTone: FlowStatusTone = readonly ? 'default' : collection?.reporting?.status === 'reported' ? 'success' : collection?.reporting?.status === 'uploading' ? 'processing' : collection?.reporting?.status === 'failed' || collection?.status === 'failed' ? 'error' : collection?.status === 'running' ? 'processing' : collection?.status === 'collected' ? 'success' : 'default';
  const collectionRunning = collection?.status === 'running' || collection?.reporting?.status === 'uploading';
  const sessions = collection?.sessions ?? collectTaskSessions(state, scope);
  const flow = useRef<HTMLDivElement>(null), refs = useRef(new Map<string, HTMLButtonElement>()), marker = useId().replace(/\W/g, '');
  const [lines, setLines] = useState<{ id: string; d: string; layer: 'main' | 'talent'; running: boolean }[]>([]);
  const statusKey = nodes.map(node => node.id + ':' + node.running).join(',') + knowledgeNodes.map(node => ':' + taskNodeKnowledge(record, node.id)?.status).join('') + ':' + collectionRunning;
  useEffect(() => {
    const root = flow.current; if (!root) return;
    const measure = () => {
      const base = root.getBoundingClientRect(), rect = (id: string) => refs.current.get(id)?.getBoundingClientRect();
      const line = (id: string, x1: number, y1: number, x2: number, y2: number, layer: 'main' | 'talent', running = false) => ({ id, layer, running, d: 'M ' + (x1-base.left) + ' ' + (y1-base.top) + ' L ' + (x2-base.left) + ' ' + (y2-base.top) });
      const output: typeof lines = [];
      nodes.slice(1).forEach((node, index) => { const a = rect(nodes[index].id), b = rect(node.id); if (a && b) output.push(line(nodes[index].id + '-' + node.id, a.right + 2, a.y + a.height / 2, b.left - 4, b.y + b.height / 2, 'main', !!node.running)); });
      if (showAutomation) {
        knowledgeNodes.forEach(node => { const a = rect('knowledge-' + node.id), b = rect(node.id); if (a && b) output.push(line('knowledge-' + node.id, a.x + a.width / 2, a.top - 2, b.x + b.width / 2, b.bottom + 4, 'talent', taskNodeKnowledge(record, node.id)?.status === 'running')); });
        const a = rect('accept'), b = rect('auto-collection'); if (a && b) output.push(line('accept-collection', a.x + a.width / 2, a.bottom + 2, b.x + b.width / 2, b.top - 4, 'talent', collectionRunning));
      }
      setLines(output);
    };
    const observer = new ResizeObserver(measure); observer.observe(root); for (const element of refs.current.values()) observer.observe(element); measure();
    return () => observer.disconnect();
  }, [statusKey, showAutomation, scopeKey]);
  const bind = (id: string) => (element: HTMLButtonElement | null) => { if (element) refs.current.set(id, element); else refs.current.delete(id); };
  const detailLabel = knowledgeNodes.find(item => item.id === detail)?.label ?? '数据收集';
  return <div className="task-delivery-flow" data-flow-task={scope.taskId}>
    <div ref={flow} className={'task-flow-grid' + (!showAutomation ? ' no-automation' : '')} style={{ '--flow-count': nodes.length } as CSSProperties}>
      <div className="task-main-rail" aria-label="任务交付节点">{nodes.map(node => <Button key={node.id} htmlType="button" ref={bind(node.id)} data-flow-node={node.id} data-running={!!node.running} aria-label={ariaPrefix + node.label} aria-current={selected === node.id ? 'step' : undefined} aria-pressed={selected === node.id} className={'task-flow-card' + (selected === node.id ? ' selected' : '') + (node.running ? ' is-running' : '')} onClick={() => onSelect(node.id)}><strong>{node.label}</strong><span className="task-flow-status"><Tag data-status-tone={node.statusTone ?? 'default'} color={statusTagColors[node.statusTone ?? 'default']}>{node.running && <LoadingOutlined className="flow-progress-icon" spin />} {node.status}</Tag></span><small>{node.role} · {node.summary ?? (readonly ? '原项目记录' : node.complete ? '已有产出' : '暂无产出')}</small></Button>)}</div>
      {showAutomation && <section className="task-talent-rail" aria-label="Talent 自动协作"><div className="task-talent-title"><span>Talent</span><small>按节点获取知识 · 验收后收集数据</small></div>
        {knowledgeNodes.map(node => { const item = taskNodeKnowledge(record, node.id), running = item?.status === 'running'; return <Button key={node.id} htmlType="button" ref={bind('knowledge-' + node.id)} data-flow-node={'knowledge-' + node.id} data-knowledge-state={item?.status ?? 'unrecorded'} data-running={running} className={'task-flow-card task-auto-card' + (running ? ' is-running' : '')} aria-label={node.label + '详情'} onClick={() => setDetail(node.id)}><strong>{node.label}</strong><span className="task-flow-status"><Tag data-status-tone={item ? knowledgeStatusTones[item.status] : 'default'} color={statusTagColors[item ? knowledgeStatusTones[item.status] : 'default']}>{running && <LoadingOutlined className="flow-progress-icon" spin />} {knowledgeStatus(node.id)}</Tag></span><small>{node.trigger}</small></Button>; })}
        <Button htmlType="button" ref={bind('auto-collection')} data-flow-node="auto-collection" data-running={collectionRunning} className={'task-flow-card task-auto-card' + (collectionRunning ? ' is-running' : '')} aria-label="数据收集详情" onClick={() => setDetail('collection')}><strong>数据收集</strong><span className="task-flow-status"><Tag data-status-tone={collectionTone} color={statusTagColors[collectionTone]}>{collectionRunning && <LoadingOutlined className="flow-progress-icon" spin />} {readonly ? '来源只读 · 未执行' : collectionStatus}</Tag></span><small>验收通过后自动收集</small></Button>
      </section>}
      <svg className="task-flow-connectors" aria-hidden="true"><defs>{(['main', 'talent'] as const).map(layer => <marker key={layer} id={marker + layer} viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 L6 3 L0 6 Z" fill={'var(--flow-' + layer + ')'} /></marker>)}</defs>{lines.map(line => <path key={line.id} data-connection={line.id} className={line.running ? 'is-running' : undefined} d={line.d} fill="none" stroke={'var(--flow-' + line.layer + ')'} strokeWidth="2" markerEnd={'url(#' + marker + line.layer + ')'} />)}</svg>
    </div>
    {error && <Alert type="error" title="自动步骤未完成" description={error} />}
    <Drawer title={detailLabel} width={650} open={!!detail} onClose={() => setDetail(null)} destroyOnHidden>
      {detail && detail !== 'collection' ? <div className="page-stack"><Tag color={statusTagColors[detailKnowledge ? knowledgeStatusTones[detailKnowledge.status] : 'default']}>{knowledgeStatus(detail)}</Tag><p>{knowledgeNodes.find(item => item.id === detail)!.trigger}，无需手动开始。</p>
        {detailKnowledge && <p className="muted">最近更新：{new Date(detailKnowledge.finishedAt ?? detailKnowledge.startedAt).toLocaleString('zh-CN')}</p>}
        {detailKnowledge?.status === 'waiting-upstream' && <p>{detail === 'develop' ? '等待需求澄清的 PRD 确认。' : '等待功能开发成果提交。'}</p>}
        {detailKnowledge?.status === 'running' && <p>正在获取本节点相关知识与 Skill，完成后自动显示。</p>}
        {detailKnowledge?.error && <Alert type="error" title="知识获取未完成" description={detailKnowledge.error} />}
        {detailRead.error && <Alert type="warning" title="节点输入读取未完成" description={detailRead.error} />}
        {detailInputs ? <><p>{detailInputs.selection.note}</p><List size="small" header="本节点知识" dataSource={detailInputs.knowledge.assets} locale={{ emptyText: '尚无本节点相关知识' }} renderItem={item => <List.Item>{item.title} · {item.version}</List.Item>} /><List size="small" header="本节点 Skill" dataSource={detailInputs.skills} locale={{ emptyText: '尚无本节点相关 Skill' }} renderItem={item => <List.Item>{item.name} · {item.version}</List.Item>} /><p className="muted">知识获取不代替交付人的采用确认；已有采用版本保持不变。</p></> : !detailKnowledge && <p className="muted">此任务没有本次自动获取记录；来源资料与执行事实分别保留。</p>}
        {canRetry && detailKnowledge?.status === 'failed' && <Button loading={pending} onClick={() => void trigger('node-knowledge', detail)}>重试知识获取</Button>}
      </div> : <div className="page-stack">
        <p>仅在 Owner 验收通过后自动收集本任务关联会话，按工具与会话标识去重并保留来源节点。</p>
        <Descriptions column={1} size="small" items={[{ key: 'status', label: '状态', children: readonly ? '来源只读 · 未执行' : collectionStatus }, { key: 'count', label: '会话数量', children: collection?.sessions.length ?? 0 }, { key: 'time', label: '收集时间', children: collection?.finishedAt ?? '—' }, { key: 'upload', label: '共享至 Talents', children: collection?.reporting?.status === 'reported' ? receiptStatus : collection?.reporting?.reason ?? '尚未共享' }]} />
        {collection?.error && <Alert type="error" title="数据收集未完成，验收结论保持有效" description={collection.error} />}
        <List size="small" dataSource={sessions} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无本任务关联会话" /> }} renderItem={item => <List.Item><div><strong>{item.tool} · {item.sessionId}</strong><p className="muted">来源节点：{item.nodeIds.join('、')} · {item.sources.join('、')}</p><small>{item.firstAt} — {item.lastAt}</small></div></List.Item>} />
        {collection?.reporting?.status === 'failed' && <Alert type="error" title="会话共享未完成，验收结论保持有效" description={collection.reporting.reason} />}<p className="muted">共享回执确认文件已写入共享目录，不代表 Talents 已读取或分析。</p>{collection?.reporting?.receipt && <pre className="task-collection-receipt">{JSON.stringify(collection.reporting.receipt, null, 2)}</pre>}
        {role === 'owner' && collection && (['failed', 'running'].includes(collection.status) || collection.reporting?.status === 'failed' || collection.reporting?.status === 'pending') && <Button loading={pending} onClick={() => void trigger('collection')}>重试数据收集</Button>}
      </div>}
    </Drawer>
  </div>;
}
