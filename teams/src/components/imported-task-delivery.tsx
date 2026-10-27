import {useTaskNodeInputs} from './use-task-node-inputs.js';
import { Alert, Button, Collapse, Empty, List, Space, Tag } from 'antd';
import type { Presentation } from '../api.js';
import { useDemo } from '../context.js';
import { displayText } from '../display-text.js';
import { deliveryStages, importedSelectedStage, importedStage, importedTaskNodeView } from '../imported-delivery.js';
import { TaskNodeArtifacts, TaskCompletionCriteria, nodeArtifactSummary } from './task-node-artifacts.js';
import { TaskDeliveryLayout, deliveryNodeLabels } from './task-delivery-layout.js';
import { DeliveryTaskSidebar, type DeliveryTaskListItem } from './delivery-task-sidebar.js';
import { TaskSessionActivity } from './task-session-activity.js';
import { TaskDeliveryFlow, importedStatusTones } from './task-delivery-flow.js';

export function ImportedTaskDelivery({ snapshot: s, params, jump, sidebarItems }: { sidebarItems?: readonly DeliveryTaskListItem[]; snapshot: Presentation['teamsProject']; params: URLSearchParams; jump(tab: string, extra?: Record<string, string>): void }) {
  const { showText, role } = useDemo();

  const task = s.tasks.find(item => item.id === (params.get('task') ?? s.selection.taskId));
  if (!task) return <Alert type="error" title="任务未包含在导入快照中" action={<Button onClick={() => jump('management')}>查看任务清单</Button>} />;
  const node = importedSelectedStage(task, params.get('node'), task.id === s.selection.taskId ? s.selection.nodeId : undefined);
  if (!node) return <Alert type="error" title="交付节点不存在" action={<Button onClick={() => jump('delivery', { task: task.id })}>返回任务</Button>} />;
  return <ImportedTaskBody key={task.id+':'+node+':'+role} s={s} task={task} node={node} jump={jump} sidebarItems={sidebarItems}/>;
}
function ImportedTaskBody({s,task,node,jump,sidebarItems}:{sidebarItems?:readonly DeliveryTaskListItem[];s:Presentation['teamsProject'];task:Presentation['teamsProject']['tasks'][number];node:import('../delivery-requirements.js').RequirementNode;jump(tab:string,extra?:Record<string,string>):void}){
  const {showText,role,data}=useDemo();
  const inputsRead=useTaskNodeInputs('teams',task.id,node);
  const view = importedTaskNodeView(task, node,inputsRead.value,data);
  const go = (node: string) => jump('delivery', { task: task.id, node });
  const selected = importedStage(task, node), sourceIds = new Set(selected.nodes.map(item => item.id));
  const sessions = s.sessions.filter(session => session.target.task === task.id && session.target.node && sourceIds.has(session.target.node));
  const detail = (title: string, value: unknown) => showText(task.id + ' · ' + title, JSON.stringify(value, null, 2));
  const previous = deliveryStages.slice(0, deliveryStages.indexOf(node)).flatMap(id => importedStage(task, id).outputs);
  const route = (id: string, stage: string) => 'projects?' + new URLSearchParams({ project: 'teams', tab: 'delivery', task: id, node: stage });
  const input = <>
    <p className="task-node-requirement">{displayText(task.goal)}</p>
    {inputsRead.error&&<Alert type="warning" title="Talent 节点输入读取未完成" description={inputsRead.error} action={<Button onClick={inputsRead.refresh}>重新获取</Button>}/>}
    <p className="muted">{inputsRead.value?.selection.note??(inputsRead.pending?'正在读取节点输入':'尚无相关输入')}</p>
    <TaskNodeArtifacts items={view.inputs} onSource={go} />
    <div className="task-node-input-summary"><span>原项目版本 {task.version}</span><span>{selected.nodes.length} 个来源环节</span><span>来源输入，尚无本次采用记录</span></div>
    {task.type === '调研' && <p className="muted">本任务为来源调研；本阶段保留调研与建议记录。</p>}
    <Collapse ghost size="small" items={[{ key: 'inputs', label: '查看需求、来源版本与上游结果', children: <div className="page-stack"><p>范围：{displayText(task.scope)}</p><ul>{task.criteria.map(item => <li key={item}>{item}</li>)}</ul><p className="muted">来源：{displayText(task.origin)} · 源码版本 {s.sourceCommit.slice(0, 7)}</p><List size="small" header="原流程上游成果" dataSource={previous} locale={{ emptyText: '原流程未提供更早的成果' }} renderItem={item => <List.Item><div><strong>{item.name}</strong><p>{displayText(item.output)}</p></div></List.Item>} /><Button size="small" onClick={() => detail('完整任务来源', task)}>查看原任务数据</Button></div> }]} />
  </>;
  const execution = <>
    <div className="task-node-execution-summary"><span>来源状态 · {selected.status}</span><span>{sessions.length} 条关联作业快照</span></div>
    <p className="muted">原项目节点记录按四个交付阶段归类，未记为本次 iCode 执行。Talent 自动导入与归集没有本次执行回执。</p>
    <section className="task-process-progress" aria-label="任务进展"><h3>任务进展</h3><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚无此节点的 CLI 进度回传" /></section>
    <TaskSessionActivity key={task.id + ':' + node + ':' + role} projectId="teams" taskId={task.id} nodeId={node} readonlySource />
    {selected.nodes.length ? <Collapse ghost size="small" items={[{ key: 'records', label: '查看本阶段原节点与作业记录', children: <div className="page-stack"><List size="small" dataSource={selected.nodes} renderItem={item => <List.Item data-imported-source-node={item.id}><div><Space wrap><strong>{item.name}</strong><Tag>{item.status}</Tag><span className="muted">{item.owner}</span></Space><p className="task-node-fulltext">{displayText(item.brief)}</p><Button size="small" onClick={() => detail(item.name + ' · 原节点数据', item)}>查看原节点详情</Button></div></List.Item>} />{sessions.map(session => <div key={session.key} data-imported-session={session.key}><strong>{displayText(session.title)}</strong><p>{displayText(session.resultText)}</p><Button size="small" onClick={() => detail('原作业上下文', session)}>查看原作业上下文</Button></div>)}</div> }]} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="来源未提供此阶段记录" />}
  </>;
  const result = <>
    <p>按统一节点标准核对交付物；原流程成果保留原文，不自动认定为对应标准产物。</p>
    <h3 className="task-deliverables-heading">交付物</h3><TaskNodeArtifacts items={view.deliverables} onSource={go} /><TaskCompletionCriteria view={view} />

    {node === 'verify' && <p className="muted">来源验证记录未包含本次实际检查或预置复检回执，不据此变更本地质量状态。</p>}
    {node === 'accept' && <p className="muted">原验收状态仅供查阅；此页不会形成新的 Owner 确认或 Talent 上报。</p>}
  </>;
  return <TaskDeliveryLayout projectId="teams" taskId={task.id} title={task.title} owner={'成员 ' + task.owner} node={node} nodeOwner={'来源责任人 · ' + selected.owner} contentKey={task.id + ':' + node + ':' + role}
    sidebar={<DeliveryTaskSidebar projectId="teams" selectedTaskId={task.id} items={sidebarItems ?? s.tasks.map(item => ({ id: item.id, title: item.title, owner: '成员 ' + item.owner, status: item.status, accepted: item.status === '已验收', route: route(item.id, importedSelectedStage(item, null, item.id === s.selection.taskId ? s.selection.nodeId : undefined)!) }))} />}
    flow={<TaskDeliveryFlow scope={{ projectId: 'teams', taskId: task.id }} nodeInputs={inputsRead.value} readonly selected={node} onSelect={id => jump('delivery', { task: task.id, node: id })} nodes={deliveryStages.map(id => { const stage = importedStage(task, id); return { id, label: deliveryNodeLabels[id], role: stage.owner, description: '', status: stage.status, statusTone: importedStatusTones[stage.status] ?? 'default', complete: false, summary: nodeArtifactSummary(importedTaskNodeView(task, id)) }; })} />}
    sections={{ input: { action: <Tag>原项目输入</Tag>, content: input }, execution: { action: <Tag>来源记录 · 只读</Tag>, content: execution }, result: { content: result } }}
    materials={<><h4>需求说明</h4><div className="task-material-description"><p>{displayText(task.goal)}</p><p>范围：{displayText(task.scope)}</p></div><h4>验收标准</h4><ul className="task-material-criteria">{task.criteria.map(item => <li key={item}>{item}</li>)}</ul><h4>来源资料</h4><p>{displayText(task.origin)}</p><p className="muted">原项目版本 {task.version} · 截止 {task.due}</p><Button type="link" size="small" onClick={() => detail('完整任务来源', task)}>查看原任务数据</Button></>}
  />;
}
