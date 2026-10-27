import { displayText, displayRequirementId } from '../display-text.js';
import '../project-overview.css';
import { Alert, Button, Descriptions, Drawer, Empty, Select, Space, Table, Tabs, Tag } from 'antd';
import { useDemo } from '../context.js';
import { filterIssues, filterRequirements, projectOverview, type OverviewFilter, type OverviewIssue, type OverviewRequirement } from '../project-overview.js';
import { FrameworkCard } from '../vendor/teams/components/page-layout.js';
import { RequirementDetail, requirementPhaseLabel } from './requirement-detail.js';
import { metricGroups, taskManagementRoute, type TaskCategory } from './project-task-shared.js';
import { ProjectTaskCreate } from './project-task-create.js';
import { GeneralTasks } from './project-general-tasks.js';
import { projectTasksVisibleTo, visibleGenericTasks } from '../task-visibility.js';

export function ProjectTaskManagement({ projectId }: { projectId: string }) {
  const { state, data, role, navigate, showText } = useDemo();
  if (!projectTasksVisibleTo(state, projectId, role)) return <Alert type="info" title="当前身份不在该项目任务范围内" />;
  const model = projectOverview(state, data, projectId, undefined, role);
  const params = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const rawCategory = params.get('category') ?? (model.research.some(item => item.id === params.get('item')) ? 'general' : params.has('discussion') || params.get('view') === 'discussion' ? 'issues' : 'requirements');
  const tab: TaskCategory = rawCategory === 'issues' || rawCategory === 'general' ? rawCategory : 'requirements';
  const group = metricGroups.find(item => item.tab === tab);
  const defaultFilter = tab === 'issues' ? 'issues' : 'all';
  const filter: OverviewFilter = group?.metrics.some(item => item.key === params.get('filter')) ? params.get('filter') as OverviewFilter : defaultFilter;
  const related = tab === 'issues' ? params.get('requirement') : null;
  const go = (category: TaskCategory, extra: Record<string, string> = {}) => navigate(taskManagementRoute(projectId, category, extra));
  const preserved = { ...(filter !== defaultFilter ? { filter } : {}), ...(related ? { requirement: related } : {}) };
  const setDetail = (item: OverviewRequirement | OverviewIssue | null) => {
    const category = item ? 'phase' in item ? item.source.requirement?.category === 'research' ? 'general' : 'requirements' : 'issues' : tab;
    go(category, { ...(category === tab ? preserved : {}), ...(item ? { item: item.id } : {}) });
  };
  const detailItems = tab === 'requirements' ? model.requirements : tab === 'issues' ? model.issues : model.research;
  const detail = detailItems.find(item => item.id === params.get('item')) ?? null;
  const requirements = filterRequirements(model, filter);
  const issues = filterIssues(model, filter).filter(item => !related || item.relatedIds.includes(related));
  const genericTasks = visibleGenericTasks(state, projectId, role);
  const generalCount = model.research.length + genericTasks.length;
  const discussion = projectId === 'teams' && tab === 'issues' && params.get('discussion') ? data.teamsProject.discussions.find(item => item.id === params.get('discussion')) : undefined;
  const outsideScope = !!(params.get('item') || params.get('discussion')) && !detail && !discussion && !genericTasks.some(task => task.id === params.get('item'));
  const visibleCount = tab === 'requirements' ? requirements.length : tab === 'issues' ? issues.length : generalCount;
  const totalCount = tab === 'requirements' ? model.counts.all : tab === 'issues' ? model.counts.issues : generalCount;
  const filterLabel = group?.metrics.find(metric => metric.key === filter)?.label ?? '通用任务';
  const empty = <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={filter === defaultFilter && !related ? tab === 'requirements' ? '尚无项目需求' : '尚无项目问题' : '当前筛选没有记录'} />;
  return <div className="page-stack project-task-management" data-task-project={projectId}>
    {outsideScope && <Alert type="info" title="此项目中不存在该事项" action={<Button onClick={() => go(tab)}>查看项目任务</Button>} />}
    <p className="muted">项目内任务共享可读；交付人负责执行，Owner 负责分配与验收。</p>
    <FrameworkCard title="任务管理" action={<Space wrap>{tab !== 'general' && role === 'owner' && <ProjectTaskCreate key={projectId + ':' + role + ':' + tab} projectId={projectId} kind={tab === 'requirements' ? 'requirement' : 'issue'} onCreated={() => go(tab)} />}<span className="muted" data-overview-list-summary data-list-count={visibleCount} data-list-total={totalCount}>{filterLabel} · {visibleCount} / {totalCount} 项{tab === 'requirements' ? '需求' : tab === 'issues' ? '问题' : '通用任务'}</span>{group && <Select aria-label={tab === 'requirements' ? '筛选需求' : '筛选问题'} value={filter} onChange={value => go(tab, { ...preserved, filter: value })} options={group.metrics.map(metric => ({ value: metric.key, label: metric.label }))} />}{(filter !== defaultFilter || related) && <Button size="small" onClick={() => go(tab)}>清除筛选</Button>}</Space>}>
      {related && <p className="muted">仅显示关联需求：{model.requirements.find(item => item.id === related)?.source.title ?? related}</p>}
      <Tabs activeKey={tab} onChange={value => go(value as TaskCategory)} items={[{ key: 'requirements', label: `需求 · ${model.counts.all}` }, { key: 'issues', label: `问题 · ${model.counts.issues}` }, { key: 'general', label: `通用任务 · ${generalCount}` }]} />
      {tab === 'requirements' ? <Table<OverviewRequirement> className="overview-requirements" rowKey="id" size="small" pagination={false} scroll={{ x: 620 }} dataSource={requirements} locale={{ emptyText: empty }} columns={[
        { title: '需求', width: 240, render: (_, item) => <><Button type="link" className="overview-title" onClick={() => setDetail(item)}>{item.source.title}</Button><small className="muted">{displayRequirementId(item.taskId ?? item.source.sourceRecordId)}</small></> },
        { title: '交付人', width: 100, dataIndex: 'owner' },
        { title: '状态', width: 140, render: (_, item) => <Tag color={item.phase === '已交付' ? 'green' : item.phase === '待验收' ? 'gold' : undefined}>{item.deliveryStatus ?? requirementPhaseLabel(item.phase)}</Tag> },
        { title: '计划完成', width: 110, render: (_, item) => <>{item.due ?? '未排期'}{item.overdue && <small className="overview-overdue">延期{projectId === 'teams' ? '（快照）' : ''}</small>}</> },
      ]} /> : tab === 'issues' ? <Table<OverviewIssue> className="overview-issues" rowKey="id" size="small" pagination={false} scroll={{ x: 900 }} dataSource={issues} locale={{ emptyText: empty }} columns={[
        { title: '问题', width: 240, render: (_, item) => <><Button type="link" className="overview-title" onClick={() => setDetail(item)}>{item.source.title}</Button><small className="muted">{item.source.sourceRecordId}</small></> },
        { title: '严重程度', width: 90, dataIndex: 'severity' }, { title: '状态', width: 155, render: (_, item) => <Tag color={item.blocksDelivery ? 'red' : item.closed === true ? 'green' : undefined}>{item.status}</Tag> },
        { title: '负责人', width: 110, dataIndex: 'owner' },
        { title: '关联与阻塞', width: 150, render: (_, item) => <><span>{item.relatedIds.map(id => model.requirements.find(requirement => requirement.id === id)?.source.title ?? '来源需求尚未纳入交付').join('、')}</span>{item.blocksDelivery && <Tag color="red">阻塞交付</Tag>}</> },
        { title: '处理进展', dataIndex: 'progress' },
      ]} /> : <GeneralTasks projectId={projectId} research={model.research} />}
      {tab !== 'general' && !model.requirements.length && !model.issues.length && <Button onClick={() => navigate('projects?' + new URLSearchParams({ project: projectId, tab: 'content', panel: 'resources' }))}>查看项目资料</Button>}
      {model.requirements.some(item => item.due) && <p className="muted">计划日期按 {model.asOf} 判断；导入节点完成记录不代表已有真实测试或安全报告。</p>}
    </FrameworkCard>
    {projectId === 'teams' && <FrameworkCard title={discussion ? discussion.id + ' · ' + discussion.title : '原项目来源记录'}>{discussion && <><p>{displayText(discussion.summary)}</p><Button onClick={() => showText(discussion.id + ' · 原讨论记录', JSON.stringify(discussion, null, 2))}>查看讨论详情</Button></>}<Space wrap><Button onClick={() => showText('原 Teams 输入记录', JSON.stringify(data.teamsProject.inputs, null, 2))}>查看原始输入</Button><Button onClick={() => showText('原 Teams 讨论记录', JSON.stringify(data.teamsProject.discussions, null, 2))}>查看原始讨论</Button></Space><p className="muted">原项目任务与讨论保留来源记录，只读查阅；在此新建的需求与问题由 Teams 管理。</p></FrameworkCard>}
    <Drawer title={detail?.source.title ?? '项目事项'} width={740} open={!!detail} onClose={() => setDetail(null)} destroyOnHidden>{detail && <div className="page-stack">
      {'phase' in detail ? <RequirementDetail projectId={projectId} item={detail} /> : <>
        <p className="muted">来源：{detail.source.origin === 'teams-task' ? 'Teams' : '问题平台'} · {detail.source.sourceRecordId}</p><p>{displayText(detail.source.summary)}</p>
        <Descriptions column={1} size="small" items={[{ key: 'status', label: '状态', children: detail.status }, { key: 'severity', label: '严重程度', children: detail.severity }, { key: 'owner', label: '负责人', children: detail.owner }, { key: 'progress', label: '处理进度', children: detail.progress }, { key: 'blocking', label: '交付影响', children: detail.blocksDelivery ? '阻塞当前交付' : '没有确认的交付阻塞记录' }]} />
        <Space wrap>{detail.relatedIds.map(id => { const requirement = model.requirements.find(item => item.id === id); return requirement ? <Button type="link" size="small" key={id} onClick={() => setDetail(requirement)}>关联需求：{requirement.source.title}</Button> : null; })}{projectId === 'teams' && detail.source.sourceRecordId === 'TEAMS-BUG-001' && <Button type="link" onClick={() => navigate('projects?project=teams&tab=management&discussion=R20')}>查看 R20 复现讨论</Button>}<Button type="link" onClick={() => showText(detail.source.title + ' · 来源原文', displayText(detail.source.detail))}>查看来源</Button></Space>
      </>}
    </div>}</Drawer>
  </div>;
}
