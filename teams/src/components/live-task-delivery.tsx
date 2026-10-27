import { TaskPreparationProgress, preparationHint, preparationStatusLabel, preparationReady } from './task-preparation-progress.js';
import {useTaskNodeInputs} from './use-task-node-inputs.js';
import {taskExecutableBy} from '../task-visibility.js';
import { useState } from 'react';
import { Alert, Button, Collapse, Empty, Input, List, Modal, Space, Tag, Typography } from 'antd';
import { taskNodeView } from '../task-node-contract.js';
import { TaskNodeArtifacts, TaskCompletionCriteria, nodeArtifactSummary } from './task-node-artifacts.js';
import { useDemo } from '../context.js';
import { type DeliveryRequirement, type RequirementNode } from '../delivery-requirements.js';
import { deliveryRequirementAction } from '../api.js';
import { collectTaskSessions, taskAutomation, taskNodeKnowledge } from '../task-automation.js';
import { projectMembers } from '../teams-domain.js';
import { taskVisibleTo } from '../task-visibility.js';
import { TaskDeliveryFlow, knowledgeLabels, nodeStatusTones, preparationStatusTones } from './task-delivery-flow.js';
import { CollaborationProgress } from './collaboration-progress.js';
import { TaskSessionActivity } from './task-session-activity.js';
import { TaskSessions } from './task-sessions.js';
import { DeliveryTaskSidebar, type DeliveryTaskListItem } from './delivery-task-sidebar.js';
import { TaskDeliveryLayout, deliveryNodeLabels } from './task-delivery-layout.js';
export { deliveryNodeLabels } from './task-delivery-layout.js';

const statusLabels = { pending: '待开始', running: '进行中', blocked: '阻塞', complete: '已完成', 'waiting-owner': '待 Owner 验收' };
const stamp = (at?: string | null) => at ? new Date(at).toLocaleString('zh-CN') : '尚无执行时间';
const firstSentence = (text: string) => text.split(/(?<=。)|\n/).find(part => part.trim())?.trim() ?? '';

export function LiveTaskDelivery({ task, node, sidebarItems }: { task: DeliveryRequirement; node: RequirementNode; sidebarItems?: readonly DeliveryTaskListItem[] }) {
  const { state, data, role, navigate, receiveState, run, showText } = useDemo();
  const [busy, setBusy] = useState(false), [accepting, setAccepting] = useState(false), [returning, setReturning] = useState(false), [reason, setReason] = useState('');
  const scope = { projectId: task.projectId, taskId: task.id };
  const record = taskAutomation(state, scope), member = projectMembers(state, task.projectId).find(item => item.id === task.assigneeId);
  const nodeState = task.nodes[node];
  const preparation = record?.preparation;
  const nodeKnowledge = node === 'accept' ? undefined : taskNodeKnowledge(record, node);
  const awaitingKnowledge = !!nodeKnowledge && nodeKnowledge.status !== 'ready';
  const preparingNode = node === 'prepare' && !!preparation && nodeState.status === 'pending';
  const inputsRead=useTaskNodeInputs(task.projectId,task.id,node,!awaitingKnowledge);
  const view = taskNodeView(state, task, node, data,inputsRead.value);
  const events = (state.workspace.collaboration?.events ?? []).filter(event => event.projectId === task.projectId && event.taskId === task.id && event.nodeId === node);
  const adoptions = (state.workspace.collaboration?.adoptions ?? []).filter(item => item.projectId === task.projectId && item.taskId === task.id && item.nodeId === node);
  const result = events.filter(event => event.phase === 'result').reduce<(typeof events)[number] | undefined>((latest, event) => !latest || event.revision > latest.revision ? event : latest, undefined);
  const sessions = collectTaskSessions(state, scope).filter(session => node === 'accept' || session.nodeIds.includes(node));
  const snapshot = task.talentInputsSnapshot;
  const hasCurrentBasis = (id: RequirementNode) => [...(state.workspace.collaboration?.events ?? []), ...(state.workspace.collaboration?.adoptions ?? [])].some(item => item.projectId === task.projectId && item.taskId === task.id && item.nodeId === id) || id === 'accept' && task.checks.some(check => !!check.sessionId);
  const legacyNode = !!task.legacyBasis && !hasCurrentBasis(node);
  const knowledge=(inputsRead.value?.knowledge.assets??[]).map(asset=>({title:asset.title,version:asset.version??'未标注'}));
  const skills=(inputsRead.value?.skills??[]).map(skill=>({title:skill.name,version:skill.version}));
  const upNodes: RequirementNode[] = node === 'prepare' ? [] : node === 'develop' ? ['prepare'] : node === 'verify' ? ['develop'] : ['develop', 'verify'];
  const inputState=awaitingKnowledge ? knowledgeLabels[nodeKnowledge.status] : inputsRead.pending?'正在读取节点输入':inputsRead.error?'节点输入读取未完成':inputsRead.value?.selection.status==='not-configured'?'此节点未配置输入':inputsRead.value?.selection.basis==='adopted-node'?'本节点已明确采用':inputsRead.value?.selection.basis==='historical-subset'?'历史采用的相关部分':'当前节点建议 · 待明确采用';
  const go = (id: string) => navigate('projects?' + new URLSearchParams({ project: task.projectId, tab: 'delivery', task: task.id, node: id }));
  const act = async (action: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const saved = await run(() => deliveryRequirementAction(state, role, { ...scope, action, reason }));
      if (saved) { receiveState(saved); setAccepting(false); setReturning(false); }
    } finally { setBusy(false); }
  };
  if (!taskVisibleTo(role, task.assigneeId)) return <Alert type="info" title="此任务不在当前成员范围" />;
  const detail = (title: string, content: string) => showText(task.title + ' · ' + title, content);
  const resultHint = node === 'prepare'
    ? task.preparedAt ? '输入已明确采用，后续开发使用本次冻结版本。' : preparationReady(preparation) ? '会话已读取任务资料，等待交付人确认采用并形成澄清成果。' : '等待交付人在 iCode 读取并确认采用本次输入。'
    : node === 'accept'
      ? task.stage === 'accepted' ? 'Owner 已确认通过需求验收。' : task.stage === 'awaiting-acceptance' ? '开发与验证成果已提交，等待 Owner 确认。' : task.stage === 'returned' ? 'Owner 已退回，等待补充后重新提交。' : '等待开发与验证完成后提交验收。'
      : result ? nodeState.status === 'complete' ? '本节点成果已回传，可查看成果引用与完整记录。' : '已有成果回传；当前处理状态以上方进度为准。' : '尚未收到本节点的成果提交。';
  const inputDetails = <div className="page-stack">
    <Typography.Paragraph className="task-node-fulltext">{task.description}</Typography.Paragraph>
    <p className="muted">{inputsRead.value?.selection.note??'尚未读取节点输入。'}</p>
    <List size="small" header="知识与 Skill 版本" dataSource={[...knowledge.map(item => ({ ...item, kind: '知识' })), ...skills.map(item => ({ ...item, kind: 'Skill' }))]} locale={{ emptyText: '尚无已读取的版本记录' }} renderItem={(item) => <List.Item><span>{item.kind} · {item.title}</span><Tag title={item.version}>{item.version}</Tag></List.Item>} />
    {inputsRead.value?.skills.length ? <Space wrap>{inputsRead.value.skills.map(skill => <Button size="small" key={skill.id} onClick={() => detail(skill.name + ' · ' + skill.version, skill.content)}>阅读 {skill.name}</Button>)}</Space> : null}
    {upNodes.map(id => <div key={id}><strong>{deliveryNodeLabels[id]} · {statusLabels[task.nodes[id].status]}</strong><p className="task-node-fulltext">{task.nodes[id].summary || '尚无上游结果。'}</p></div>)}
  </div>;
  return <TaskDeliveryLayout projectId={task.projectId} taskId={task.id} title={task.title} owner={member?.name ?? '待分配'} node={node} nodeOwner={node === 'accept' ? '确认人 · 林悦' : '交付人 · ' + (member?.name ?? '待分配')} contentKey={task.projectId + ':' + task.id + ':' + node + ':' + role}
    sidebar={<DeliveryTaskSidebar projectId={task.projectId} selectedTaskId={task.id} items={sidebarItems} />}
    flow={<TaskDeliveryFlow scope={scope} selected={node} onSelect={go} nodeInputs={inputsRead.value} nodes={(Object.keys(deliveryNodeLabels) as RequirementNode[]).map(id => ({ id, label: deliveryNodeLabels[id], role: id === 'accept' ? 'Owner' : member?.name ?? '待分配', description: '', statusTone: id === 'prepare' && preparation && task.nodes[id].status === 'pending' ? preparation.status === 'ready' && !preparationReady(preparation) ? 'processing' : preparationStatusTones[preparation.status] : nodeStatusTones[task.nodes[id].status], status: id === 'prepare' && preparation && task.nodes[id].status === 'pending' ? preparationStatusLabel(preparation) : task.nodes[id].status === 'complete' && task.legacyBasis && !hasCurrentBasis(id) ? '历史完成' : statusLabels[task.nodes[id].status], running: task.nodes[id].status === 'running' || id === 'prepare' && preparation?.status === 'preparing-session', complete: task.nodes[id].status === 'complete' && !(task.legacyBasis && !hasCurrentBasis(id)), summary: nodeArtifactSummary(taskNodeView(state, task, id, data)) }))} />}
    sections={{ input: { action: <Tag>{inputState}</Tag>, content: <>
          <p className="task-node-requirement">{awaitingKnowledge ? task.description : firstSentence(task.description)}</p>
          {awaitingKnowledge ? <><p className="muted">{nodeKnowledge.status === 'waiting-upstream' ? node === 'develop' ? 'PRD 确认后自动获取开发知识与 Skill。' : '开发成果提交后自动获取测试知识与 Skill。' : nodeKnowledge.status === 'running' ? '正在获取本节点相关知识与 Skill，完成后自动显示。' : nodeKnowledge.status === 'failed' ? '知识获取未完成，可在下方对应知识节点查看原因。' : '等待自动获取本节点相关知识与 Skill。'}</p>{node !== 'prepare' && <TaskNodeArtifacts items={view.inputs.filter(item => item.references.some(reference => !!reference.sourceNode))} onSource={go} />}</> : <>
          {inputsRead.error&&<Alert type="warning" title="Talent 节点输入读取未完成" description={inputsRead.error} action={<Button onClick={inputsRead.refresh}>重新获取</Button>}/>}
          {!inputsRead.pending&&<Space><span className="muted">{inputsRead.value?.selection.note}</span><Button type="link" size="small" onClick={inputsRead.refresh}>重新获取节点输入</Button></Space>}
          <TaskNodeArtifacts items={view.inputs} onSource={go} />
          <div className="task-node-input-summary"><span>知识 {knowledge.length} 项</span><span>当前节点 Skill {skills.length} 项</span>{upNodes.map(id => <span key={id}>{deliveryNodeLabels[id]}：{statusLabels[task.nodes[id].status]}</span>)}</div>
          {!task.assigneeId && <Alert type="info" title="需求待分配" description="请先在任务管理选择交付人，再开始需求澄清。" action={<Button size="small" onClick={() => navigate('projects?' + new URLSearchParams({ project: task.projectId, tab: 'management', category: 'requirements', item: (task.projectId === 'carddemo' && task.id === 'DEMO-MKT-001' ? 'requirements:' : 'teams-task:') + task.projectId + ':' + task.id }))}>进入任务管理</Button>} />}
          <Collapse ghost size="small" items={[{ key: 'inputs', label: '查看需求、采用版本与上游结果', children: inputDetails }]} /></>}
        </> }, execution: { action: <Tag color={nodeState.status === 'complete' && !legacyNode ? 'green' : nodeState.status === 'blocked' ? 'orange' : undefined}>{preparingNode ? preparationStatusLabel(preparation!) : legacyNode && nodeState.status === 'complete' ? '历史完成' : statusLabels[nodeState.status]}</Tag>, content: <>
          <div className="task-node-execution-summary"><span>{stamp(preparingNode ? preparation?.updatedAt : nodeState.updatedAt)}</span><span>{events.length} 条工作回传</span>{node === 'prepare' && preparation && <span>{preparation.progress.length} 条准备记录</span>}{sessions.length > 0 && <span>{sessions.length} 个关联会话</span>}</div>
          <p>{preparingNode ? preparationHint(preparation!) : node === 'accept' ? '验收结论由 Owner 确认。' : nodeState.status === 'pending' ? '使用顶部 iCode 作业入口开始工作，执行进度由会话回传。' : nodeState.status === 'blocked' ? '当前节点存在待处理事项，请查看进度与证据记录。' : nodeState.status === 'complete' ? legacyNode ? '保留历史完成记录；本轮执行以 CLI 回传为准。' : '当前节点已完成，执行依据可按需查看。' : '当前节点正在执行，按里程碑回传进展。'}</p>
          {legacyNode && <p className="muted">历史迁移记录，未记为本次 iCode 执行。</p>}
          <section className="task-process-progress" aria-label="任务进展"><h3>任务进展</h3>{node === 'prepare' && <TaskPreparationProgress key={preparation?.id + ':' + role} scope={scope} />}<CollaborationProgress {...scope} nodeId={node} embedded /></section>
          <TaskSessionActivity key={task.id + ':' + node + ':' + role} {...scope} nodeId={node} />
          {(node === 'develop' || node === 'verify' || node === 'accept') && <Collapse ghost size="small" items={[{ key: 'session-links', label: '查看会话关联管理', children: <TaskSessions key={task.id + ':' + node} scope={scope} node={node === 'accept' ? undefined : node} readonly={node === 'accept'} /> }]} />}
        </> }, result: { content: <>
          <p>{resultHint}</p>
          <h3 className="task-deliverables-heading">交付物</h3><TaskNodeArtifacts items={view.deliverables} onSource={go} /><TaskCompletionCriteria view={view} />
          {node === 'prepare' && <Space wrap><Tag>{task.preparedAt ? '采用记录已保存' : '尚未确认采用'}</Tag>{adoptions.length > 0 && <Button size="small" onClick={() => detail('本节点采用依据', JSON.stringify(adoptions, null, 2))}>查看采用依据</Button>}</Space>}
          {(node === 'develop' || node === 'verify') && <>
            <Space wrap><Tag>{result?.evidence.length ?? 0} 项成果引用</Tag>{result && <Button size="small" onClick={() => detail('本节点成果与证据', JSON.stringify(result, null, 2))}>查看成果与证据</Button>}</Space>
            {node === 'verify' && <><p className="muted">检查历史：{task.checks.filter(check => check.source === 'actual').length} 条实际执行结果 · {task.checks.filter(check => check.source === 'preset').length} 条预置检查结果</p><Collapse ghost size="small" items={[{ key: 'checks', label: '查看检查与复检记录（' + task.checks.length + '）', children: <List size="small" dataSource={task.checks} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚无检查结果" /> }} renderItem={check => <List.Item data-check-id={check.id} data-check-source={check.source}><div><Space wrap><Tag color={check.status === 'passed' ? 'green' : 'orange'}>{check.status === 'passed' ? '通过' : '发现问题'}</Tag><Tag>{check.source === 'actual' ? '实际执行结果' : '预置检查结果'}</Tag><span className="muted">{stamp(check.at)}</span></Space><p className="task-node-fulltext">{check.summary}</p></div></List.Item>} /> }]} /><p className="muted">预置结果与实际执行分别保留；功能检查通过不代表安全验证或 Owner 验收已通过。</p></>}
          </>}
          {node === 'accept' && <>
            {task.acceptedAt && <p className="muted">验收时间：{stamp(task.acceptedAt)}</p>}
            {task.stage === 'returned' && task.nodes.accept.summary && <Button size="small" onClick={() => detail('退回说明', task.nodes.accept.summary)}>查看退回说明</Button>}
            {role === 'owner' && task.stage === 'awaiting-acceptance' && <Space wrap><Button type="primary" onClick={() => setAccepting(true)}>通过需求验收</Button><Button onClick={() => setReturning(true)}>退回补充</Button></Space>}
            {task.stage === 'accepted' && <p className="muted">{record?.collection?.reporting?.status === 'reported' ? record.collection.reporting.receipt?.id.startsWith('SHARED-') ? '会话已写入共享目录，不代表 Talents 已读取或分析。' : record.collection.reporting.receipt?.id.startsWith('TALENT-INBOX-') ? '历史 Talent 接收回执已保留，可在数据收集节点查看。' : '会话归集已完成，回执来源可在数据收集节点查看。' : record?.collection?.reporting?.status === 'failed' ? '会话上报未完成，请在数据收集节点查看详情。' : '会话归集与上报状态见数据收集节点，尚未取得接收回执。'}</p>}
          </>}
        </> } }}
    materials={<>      <h4>需求说明</h4>
      <div className="task-material-description">{task.description.split(/(?<=。)|\n/).filter(part => part.trim()).map((part, index) => <p key={index}>{part.trim()}</p>)}</div>
      <h4>验收标准</h4>
      <p className="muted">尚未单独登记验收标准。以本任务说明和确认记录为准。</p>
      {task.legacyBasis && <><p className="muted">本任务保留历史迁移依据，与本轮执行记录分别展示。</p><Button type="link" size="small" onClick={() => detail('历史迁移依据', JSON.stringify(task.legacyBasis, null, 2))}>查看历史依据</Button></>}
</>}
  >
    <Modal title="确认通过需求验收" open={accepting} onCancel={() => setAccepting(false)} confirmLoading={busy} okButtonProps={{ 'aria-label': '确认通过独立需求验收', disabled: busy }} cancelButtonProps={{ disabled: busy }} onOk={() => void act('accept')}><p>{task.title}</p><p>确认需求成果后，会自动汇总本任务关联的会话并上报 Talent。上报状态独立于验收结论。</p></Modal>
    <Modal title="退回补充" open={returning} onCancel={() => setReturning(false)} confirmLoading={busy} okButtonProps={{ disabled: busy || !reason.trim() }} onOk={() => void act('return')}><Input.TextArea value={reason} onChange={event => setReason(event.target.value)} placeholder="说明需要补充的内容" /></Modal>
  </TaskDeliveryLayout>;
}
