import { displayText, displayRequirementId } from '../display-text.js';
import { useMemo, useState } from 'react';
import { Button, Checkbox, Descriptions, Drawer, Empty, Form, Input, Modal, Segmented, Select, Space, Table, Tabs, Tag } from 'antd';
import { TeamsPageIntro } from '../components/teams-reuse.js';
import { useDemo } from '../context.js';
import { FrameworkCard } from '../vendor/teams/components/page-layout.js';
import { presence, teamUsage, type DemoMember, type Presence } from '../operations.js';
import { teamWorkIndex, type TeamWorkEntry } from '../project-overview.js';
import { RequirementDetail, requirementPhaseLabel } from '../components/requirement-detail.js';
import { TaskSessions } from '../components/task-sessions.js';
import { CollaborationProgress } from '../components/collaboration-progress.js';
import { TaskSessionActivity } from '../components/task-session-activity.js';
import { canLinkTaskSession, type CollectedSession, type TaskScope } from '../task-automation.js';
import { TraceMonitor, type TraceMonitorRoute } from './trace-monitor.js';
import '../operations.css';

const colors: Partial<Record<Presence, string>> = { '执行中': 'green', '等待人工处理': 'gold', '在线空闲': 'blue' };
const activityLabels = { started: '已开始', progress: '进度回传', blocked: '报告阻塞', result: '成果待确认' } as const;
const knowledgeLabels = { 'waiting-upstream': '等待上游', queued: '待导入', running: '导入中', ready: '导入完成', waiting: '等待输入就绪', failed: '导入未完成' } as const;
const collectionLabels = { queued: '等待归集', running: '正在归集', collected: '已归集', empty: '暂无会话', failed: '归集未完成' } as const;
const conversationNodeLabels = { develop: '功能开发', verify: '测试验证' } as const;
type ConversationNode = keyof typeof conversationNodeLabels;
type ConversationRow = CollectedSession & { id: string; entry: TeamWorkEntry };

export function MemberUsageTable() {
  const { state } = useDemo();
  return <Table<DemoMember> size="middle" rowKey="id" pagination={false} dataSource={teamUsage(state)} scroll={{ x: 720 }}
    expandable={{ rowExpandable: row => row.instances.length > 0, expandedRowRender: row => <div className="instance-list">{row.instances.map(instance => <Descriptions key={instance.id} size="small" column={2} items={[
      { key: 'id', label: '执行实例', children: instance.id }, { key: 'state', label: '状态', children: <Tag color={colors[instance.state]}>{instance.state}</Tag> },
      { key: 'task', label: '任务', children: instance.task }, { key: 'project', label: '项目', children: instance.project },
    ]} />)}</div> }}
    columns={[
      { title: '成员', dataIndex: 'name', width: 100 },
      { title: '运行状态', width: 140, render: (_, row) => <Tag color={colors[presence(row)]}>{presence(row)}</Tag> },
      { title: '当前任务 / 项目', render: (_, row) => <div className="member-task"><strong>{row.instances[0]?.task ?? '尚未使用 iCode'}</strong><small>{row.instances[0]?.project ?? '—'}</small></div> },
      { title: '最近活跃', dataIndex: 'lastActive', width: 130 },
    ]} />;
}

function SourceTags({ entry }: { entry: TeamWorkEntry }) {
  return <Space wrap><Tag color={entry.projectId === 'teams' ? 'blue' : 'purple'}>{entry.projectId === 'teams' ? '导入快照' : entry.item.source.origin === 'teams-task' ? 'Teams 任务' : '当前工作流'}</Tag>{entry.item.activity && <Tag color="green">本机回传</Tag>}{entry.item.source.requirement?.category === 'research' && <Tag>调研</Tag>}</Space>;
}
const ownerLabel = (entry: TeamWorkEntry) => entry.projectId === 'teams' ? '快照责任人 · ' + entry.item.owner : entry.item.owner;

export function TeamWork() {
  const { navigate, state, data, role, update, busy } = useDemo();
  const [project, setProject] = useState('all'), [owner, setOwner] = useState('all'), [phase, setPhase] = useState('all');
  const [selected, setSelected] = useState<TeamWorkEntry | null>(null), [includeSnapshots, setIncludeSnapshots] = useState(false);
  const [reportOpen, setReportOpen] = useState(false), [reportTaskId, setReportTaskId] = useState<string>();
  const [reportForm] = Form.useForm();
  const params = new URLSearchParams(location.hash.split('?')[1] ?? ''), requestedTab = params.get('tab');
  const activeTab = requestedTab === 'sessions' || (requestedTab === 'members' && role === 'owner') ? requestedTab : 'tasks';
  const sessionView = activeTab === 'sessions' && role === 'owner' && params.get('view') === 'traces' ? 'traces' : 'conversations';
  const changeRoute = (tab: string, view?: string) => {
    const next = new URLSearchParams(params);
    if (tab === 'tasks') next.delete('tab'); else next.set('tab', tab);
    if (tab === 'sessions') next.set('view', role === 'owner' && view === 'traces' ? 'traces' : 'conversations'); else next.delete('view');
    const query = next.toString(); navigate('team-work' + (query ? '?' + query : ''));
  };
  const entries = useMemo(() => teamWorkIndex(state, data, role).filter(entry => (includeSnapshots || entry.projectId !== 'teams') && (role === 'owner' || entry.item.assigneeId === role)), [state, data, role, includeSnapshots]);
  const projects = [...new Map(entries.map(entry => [entry.projectId, entry.projectName])).entries()];
  const owners = [...new Set(entries.map(entry => entry.item.owner))];
  const visible = entries.filter(entry => (project === 'all' || entry.projectId === project) && (owner === 'all' || entry.item.owner === owner) && (phase === 'all' || entry.item.phase === phase));
  const reportNodes = (entry: TeamWorkEntry) => (['develop', 'verify'] as const).filter(node => canLinkTaskSession(state, role, entry.scope, node));
  const reportable = visible.filter(entry => reportNodes(entry).length > 0), reportEntry = reportable.find(entry => entry.id === reportTaskId);
  const selectedEntry = selected ? entries.find(entry => entry.id === selected.id) ?? selected : null;
  const sessionRows: ConversationRow[] = visible.flatMap(entry => entry.sessions.map(session => ({ ...session, id: entry.id + ':' + session.tool + ':' + session.sessionId, entry })));
  const requestedSession = params.get('session'), requestedNode = params.get('node');
  const selectedSession = (requestedSession ? sessionRows.find(row => row.sessionId === requestedSession && row.entry.scope.projectId === params.get('project') && row.entry.scope.taskId === params.get('task')) : sessionRows[0]) ?? null;
  const selectedNode: ConversationNode = requestedNode === 'verify' && selectedSession?.nodeIds.includes('verify') ? 'verify' : selectedSession && !selectedSession.nodeIds.includes('develop') ? 'verify' : 'develop';
  const openConversation = (scope: TaskScope, node: ConversationNode, sessionId: string) => {
    const next = new URLSearchParams(params); next.set('tab', 'sessions'); next.set('view', 'conversations'); next.set('project', scope.projectId); next.set('task', scope.taskId); next.set('node', node); next.set('session', sessionId);
    next.delete('traceProject'); next.delete('traceSession'); next.delete('trace'); navigate('team-work?' + next.toString());
  };
  const selectConversation = (row: ConversationRow, node?: ConversationNode) => {
    const nextNode = node ?? (row.nodeIds.includes(selectedNode) ? selectedNode : row.nodeIds[0] === 'verify' ? 'verify' : 'develop');
    openConversation(row.entry.scope, nextNode, row.sessionId);
  };
  const openReport = () => {
    const first = reportable[0]; if (!first) return;
    setReportTaskId(first.id); reportForm.resetFields(); reportForm.setFieldsValue({ task: first.id, nodeId: reportNodes(first)[0], tool: 'icode', sessionId: '' }); setReportOpen(true);
  };
  const traceProjectId = params.get('traceProject') ?? selectedSession?.entry.scope.projectId ?? (project === 'all' ? undefined : project);
  const traceSessionId = params.get('traceSession') ?? selectedSession?.sessionId, traceId = params.get('trace');
  const selectTrace = (route: TraceMonitorRoute) => {
    const next = new URLSearchParams(params); next.set('tab', 'sessions'); next.set('view', 'traces');
    if (route.projectId) next.set('traceProject', route.projectId); else next.delete('traceProject');
    if (route.sessionId) next.set('traceSession', route.sessionId); else next.delete('traceSession');
    if (route.traceId) next.set('trace', route.traceId); else next.delete('trace');
    navigate('team-work?' + next.toString());
  };
  const filters = <div className="team-work-filters"><Space wrap><Select aria-label="筛选追溯项目" value={project} onChange={setProject} options={[{ value: 'all', label: '全部项目' }, ...projects.map(([value, label]) => ({ value, label }))]} /><Select aria-label="筛选交付人" value={owner} onChange={setOwner} options={[{ value: 'all', label: '全部交付人' }, ...owners.map(value => ({ value, label: entries.find(entry => entry.item.owner === value)?.projectId === 'teams' ? '快照责任人 · ' + value : value }))]} /><Select aria-label="筛选交付阶段" value={phase} onChange={setPhase} options={[{ value: 'all', label: '全部阶段' }, ...(['待开展', '准备', '开发', '验证', '待验收', '已交付'] as const).map(value => ({ value, label: requirementPhaseLabel(value) }))]} />{role === 'owner' && <Checkbox checked={includeSnapshots} onChange={event => { setIncludeSnapshots(event.target.checked); if (!event.target.checked) { setProject('all'); setOwner('all'); } }}>显示导入快照</Checkbox>}</Space><span>{visible.length} / {entries.length} 项任务</span></div>;
  return <div className="page-stack team-work-page"><TeamsPageIntro actions={<Tag>{entries.length} 项任务</Tag>}>统一查看任务交付、原生会话与 OTLP 调用轨迹；导入快照按需展开并独立标识。</TeamsPageIntro>
    <Tabs activeKey={activeTab} onChange={value => changeRoute(value)} items={[
      { key: 'tasks', label: '任务作业', children: <>{filters}<FrameworkCard title="跨任务作业索引"><Table<TeamWorkEntry> rowKey="id" size="middle" pagination={false} scroll={{ x: 1120 }} dataSource={visible} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前筛选没有任务作业" /> }} columns={[
        { title: '项目 / 需求', width: 270, render: (_, entry) => <div className="team-work-cell"><strong>{entry.projectName}</strong><span>{displayText(entry.item.source.title)}</span><small>{displayRequirementId(entry.scope.taskId)}</small></div> },
        { title: includeSnapshots ? '交付人 / 来源责任人' : '交付人', width: includeSnapshots ? 180 : 105, render: (_, entry) => ownerLabel(entry) },
        { title: '交付阶段', width: 115, render: (_, entry) => <Tag color={entry.item.phase === '已交付' ? 'green' : entry.item.phase === '待验收' ? 'gold' : undefined}>{requirementPhaseLabel(entry.item.phase)}</Tag> },
        { title: '最近回传', render: (_, entry) => <div className="team-work-cell"><span>{entry.item.activity ? activityLabels[entry.item.activity.phase] : '未回传'}</span><small>{entry.item.activity ? displayText(entry.item.activity.summary) : '尚无此任务的本机回传'}</small></div> },
        { title: '会话 / 自动化', width: 175, render: (_, entry) => <div className="team-work-cell"><span>{entry.sessions.length} 个会话</span><small>{entry.automation?.collection ? collectionLabels[entry.automation.collection.status] : entry.automation?.knowledge ? '知识导入 · ' + knowledgeLabels[entry.automation.knowledge.status] : '未触发自动归集'}</small></div> },
        { title: '来源', width: 155, render: (_, entry) => <SourceTags entry={entry} /> },
        { title: '操作', width: 95, render: (_, entry) => <Button type="link" size="small" onClick={() => setSelected(entry)}>查看详情</Button> },
      ]} /></FrameworkCard></> },
      { key: 'sessions', label: '会话与轨迹', children: <div className="team-work-session-view">
        <div className="team-work-session-toolbar"><Space wrap><Button aria-label="上报任务会话" onClick={openReport} disabled={!reportable.length} title={reportable.length ? '关联本机已有会话并查看正文' : '当前筛选中没有可由你上报的进行中任务'}>上报会话</Button><Segmented aria-label="切换会话与轨迹视图" value={sessionView} onChange={value => changeRoute('sessions', String(value))} options={[{ value: 'conversations', label: '任务会话' }, ...(role === 'owner' ? [{ value: 'traces', label: '调用 Trace' }] : [])]} /></Space><span>{sessionView === 'traces' ? '按实际上报项目查看 OTLP 调用链；不代表任务业务进度。' : '选择原生会话读取真实对话；OTLP 调用链独立核验。'}</span></div>
        <div className="team-work-conversation-view" hidden={sessionView !== 'conversations'}>{filters}<div className="team-work-conversation-layout">
          <FrameworkCard title="任务会话" action={<Tag>{sessionRows.length} 个</Tag>}><div className="team-work-session-list">{sessionRows.length ? sessionRows.map(row => <button type="button" key={row.id} data-conversation-session={row.sessionId} aria-pressed={selectedSession?.id === row.id} className={'team-work-session-item' + (selectedSession?.id === row.id ? ' selected' : '')} onClick={() => selectConversation(row)}>
            <span className="team-work-session-item-heading"><Tag>{row.tool}</Tag><strong>{displayText(row.entry.item.source.title)}</strong></span>
            <small>{row.entry.projectName} · {displayRequirementId(row.entry.scope.taskId)}</small><code title={row.sessionId}>{row.sessionId}</code>
            <span className="team-work-session-item-meta"><span>{row.nodeIds.map(node => node === 'verify' ? '测试验证' : '功能开发').join(' / ')}</span><time dateTime={row.lastAt}>{new Date(row.lastAt).toLocaleString('zh-CN', { hour12: false })}</time></span>
          </button>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前筛选没有任务会话" />}</div></FrameworkCard>
          <FrameworkCard title="真实对话正文" action={selectedSession ? <Tag>{conversationNodeLabels[selectedNode]}</Tag> : undefined}>{selectedSession ? <>
            <div className="team-work-conversation-context"><div><strong>{displayText(selectedSession.entry.item.source.title)}</strong><span>{selectedSession.entry.projectName} · {displayRequirementId(selectedSession.entry.scope.taskId)}</span><code title={selectedSession.sessionId}>{selectedSession.tool} · {selectedSession.sessionId}</code></div><Select aria-label="选择会话节点" value={selectedNode} onChange={node => selectConversation(selectedSession, node)} options={selectedSession.nodeIds.map(node => ({ value: node, label: node === 'verify' ? '测试验证' : '功能开发' }))} /></div>
            {activeTab === 'sessions' && sessionView === 'conversations' && <TaskSessionActivity key={selectedSession.id + ':' + selectedNode} projectId={selectedSession.entry.scope.projectId} taskId={selectedSession.entry.scope.taskId} nodeId={selectedNode} sessionId={selectedSession.sessionId} showSessionSelector={false} readonlySource={selectedSession.entry.projectId === 'teams'} />}
          </> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={requestedSession ? '所选会话不在当前筛选范围或已不可用' : sessionRows.length ? '选择左侧会话查看真实对话正文' : '当前筛选没有可读取的原生会话'} />}</FrameworkCard>
        </div></div>
        {sessionView === 'traces' && <div className="team-work-trace-shell" data-trace-view="otlp"><TraceMonitor projectId={traceProjectId} sessionId={traceSessionId} traceId={traceId} onRouteChange={selectTrace} /></div>}
      </div> },
      ...(role === 'owner' ? [{ key: 'members', label: '成员运行概览', children: <FrameworkCard title="成员与执行实例" action={<Tag>运营样例</Tag>}><MemberUsageTable /><p className="muted">展开成员行可查看实例。此处不用于跨成员实时状态或交付追溯；本机实际状态请在 Agent 管理中核验。</p></FrameworkCard> }] : []),
    ]} />
    <Drawer title={selectedEntry?.item.source.title ?? '任务详情'} width={820} open={!!selectedEntry} onClose={() => setSelected(null)} destroyOnHidden>{selectedEntry && <div className="page-stack"><SourceTags entry={selectedEntry} /><RequirementDetail projectId={selectedEntry.projectId} item={selectedEntry.item} />{selectedEntry.projectId !== 'teams' && <>
      {selectedEntry.automation && <FrameworkCard title="自动化与 Talents 共享"><Descriptions column={1} size="small" items={[{ key: 'knowledge', label: '知识导入', children: selectedEntry.automation.knowledge ? knowledgeLabels[selectedEntry.automation.knowledge.status] : '未触发' }, { key: 'collection', label: '验收后归集', children: selectedEntry.automation.collection ? collectionLabels[selectedEntry.automation.collection.status] : '未触发' }, { key: 'reporting', label: 'Talents 共享', children: selectedEntry.automation.collection?.reporting?.status === 'reported' ? '已共享 · ' + selectedEntry.automation.collection.reporting.receipt?.id : selectedEntry.automation.collection?.reporting?.reason ?? '尚未共享' }]} /></FrameworkCard>}
      <TaskSessions readonly scope={selectedEntry.scope} /><CollaborationProgress projectId={selectedEntry.scope.projectId} taskId={selectedEntry.scope.taskId} />
    </>}{selectedEntry.scope.projectId === 'carddemo' && selectedEntry.scope.taskId === 'DEMO-MKT-001' && <Button onClick={() => navigate('trace')}>打开主任务交付记录</Button>}</div>}</Drawer>
    <Modal title="上报并查看任务会话" open={reportOpen && reportable.length > 0} onCancel={() => setReportOpen(false)} okText="上报并查看" cancelText="取消" confirmLoading={busy} okButtonProps={{ 'aria-label': '确认上报会话', disabled: busy }} cancelButtonProps={{ disabled: busy }} closable={!busy} maskClosable={!busy} onOk={() => reportForm.submit()}>
      <Form form={reportForm} layout="vertical" disabled={busy} onFinish={async values => { const entry = reportable.find(item => item.id === values.task); if (!entry) return; const result = await update('session.link', { ...entry.scope, nodeId: values.nodeId, tool: values.tool, sessionId: values.sessionId }); if (result) { setReportOpen(false); openConversation(entry.scope, values.nodeId, values.sessionId.trim()); } }}>
        <Form.Item name="task" label="任务" rules={[{ required: true, message: '请选择任务' }]}><Select aria-label="上报任务" value={reportTaskId} onChange={value => { setReportTaskId(value); const entry = reportable.find(item => item.id === value); if (entry) reportForm.setFieldValue('nodeId', reportNodes(entry)[0]); }} options={reportable.map(entry => ({ value: entry.id, label: entry.projectName + ' · ' + displayText(entry.item.source.title) + ' · ' + ownerLabel(entry) }))} /></Form.Item>
        <Form.Item name="nodeId" label="节点" rules={[{ required: true, message: '请选择节点' }]}><Select aria-label="上报节点" options={(reportEntry ? reportNodes(reportEntry) : []).map(node => ({ value: node, label: conversationNodeLabels[node] }))} /></Form.Item>
        <Form.Item name="tool" label="工具" rules={[{ required: true, message: '请选择工具' }]}><Select aria-label="上报会话工具" options={[{ value: 'icode', label: 'iCode' }, { value: 'opencode', label: 'OpenCode' }]} /></Form.Item>
        <Form.Item name="sessionId" label="本机会话标识" rules={[{ required: true, whitespace: true, message: '请输入本机会话标识' }]}><Input aria-label="上报会话标识" maxLength={200} placeholder="输入 iCode / OpenCode 已有 sessionId" /></Form.Item>
      </Form>
      <p className="muted">仅当前交付人可在开发或验证阶段关联本机已有会话。提交不会启动工具或伪造正文；原生记录可读取后才会显示对话。</p>
    </Modal>
  </div>;
}
