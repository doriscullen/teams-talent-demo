import { issueSeverityLabels } from './project-issues.js';
import { projectMembers } from './teams-domain.js';
import { collectTaskSessions, taskAutomation, type CollectedSession, type TaskAutomation, type TaskScope } from './task-automation.js';
import { orderDeliveryTasks, projectDeliveryTasks, type DeliveryPhase } from './project-delivery-tasks.js';
import { verificationChecks,type DeliveryRequirement } from './delivery-requirements.js';
import type { Presentation } from './api.js';
import type { DemoState, Role } from './domain.js';
import { projectTasksVisibleTo, sourceTaskAssigneeId, taskVisibleTo } from './task-visibility.js';
import type { CollaborationEvent } from './collaboration.js';
import { cardProjectOverviewSourceIds, createSourcePluginCatalog, type SourcePluginAsset } from './source-plugins.js';

export type { DeliveryPhase } from './project-delivery-tasks.js';
export type OverviewFilter = 'all' | 'pending' | 'active' | 'acceptance' | 'delivered' | 'issues' | 'open' | 'closed' | 'unconfirmed' | 'blocking';
export interface QualityConclusion { label: string; result: string; passed: boolean }
export interface OverviewRequirement {
  id: string; source: SourcePluginAsset; owner: string; assigneeId?: string | null; phase: DeliveryPhase; createdAt?: string; due?: string; overdue: boolean;
  taskId?: string; route?: string; deliveryStatus?: string; scope: string; pendingConfirmation: boolean; issues: OverviewIssue[]; quality: QualityConclusion[]; activity?: CollaborationEvent;
}
export interface OverviewIssue {
  id: string; source: SourcePluginAsset; owner: string; assigneeId?: string | null; severity: string; status: string; progress: string;
  closed: boolean | null; confirmed: boolean; blocksDelivery: boolean; relatedIds: string[];
}
export interface ProjectOverview { requirements: OverviewRequirement[]; research: OverviewRequirement[]; issues: OverviewIssue[]; counts: Record<OverviewFilter, number>; scope: string; asOf: string; projectActivity?: CollaborationEvent }
const route = (project: string, tab: string, extra: Record<string, string> = {}) => 'projects?' + new URLSearchParams({ project, tab, ...extra });
const unknownQuality = (): QualityConclusion[] => [
  { label: '功能', result: '未验收', passed: false }, { label: 'Review', result: '未提供报告', passed: false },
  { label: '测试', result: '未检查', passed: false }, { label: '安全', result: '待验证', passed: false },
];
function deliveryQuality(task:DeliveryRequirement):QualityConclusion[]{
 const checks=verificationChecks(task),passed=checks.length>0&&checks.every(check=>check.status==='passed');
 return [{label:'功能',result:task.stage==='accepted'?'Owner 已验收':'待 Owner 验收',passed:task.stage==='accepted'},
  {label:'Review',result:'按检查记录核对报告与来源',passed:false},
  {label:'测试',result:!checks.length?'本轮未检查':checks.some(check=>check.status==='failed')?'本轮检查有失败':checks.some(check=>check.source==='preset')?'本轮通过 · 含预置结果':'本轮实际检查通过',passed},
  {label:'安全',result:'查看具体检查与证据，未自动放行',passed:false}];
}

/** Source identity defines one row; adopted Teams tasks contribute delivery facts to that row. */
export function projectOverview(state: DemoState, data: Presentation, projectId: string, asOf = new Date().toISOString().slice(0, 10), role: Role = 'owner'): ProjectOverview {
  if (!projectTasksVisibleTo(state, projectId, role)) return { requirements: [], research: [], issues: [], counts: { all: 0, pending: 0, active: 0, acceptance: 0, delivered: 0, issues: 0, open: 0, closed: 0, unconfirmed: 0, blocking: 0 }, scope: '当前身份不在该项目任务范围内。', asOf };
  const catalog = createSourcePluginCatalog(data);
  const deliveryTasks = projectDeliveryTasks(state, projectId);
  const associated = projectId === 'carddemo' ? state.workspace.project.assets : state.workspace.projects?.find(project => project.id === projectId)?.assets ?? [];
  // These are explicit demo project links, separate from provider availability.
  const included = new Set(associated.flatMap(asset => asset.sourceAssetId ? [asset.sourceAssetId] : []));
  if (projectId === 'carddemo') cardProjectOverviewSourceIds.forEach(id => included.add(id));
  if (projectId === 'teams') [...data.teamsProject.tasks.map(task => `requirements:teams:REQ-${task.id}`), 'requirements:teams:REQ-WINDOWS-RECONNECT', 'defects:teams:TEAMS-BUG-001'].forEach(id => included.add(id));
  const sources = [...included].map(id => catalog.get(id)).filter((asset): asset is SourcePluginAsset => !!asset);
  const allWork: OverviewRequirement[] = sources.filter(source => source.kind === 'requirement').map(source => {
    const item: OverviewRequirement = { id: source.id, source, owner: '未分配', assigneeId: sourceTaskAssigneeId(source, projectId), phase: '待开展', createdAt: source.createdAt, due: undefined, overdue: false, scope: '已关联来源 · 未纳入 Teams 交付', pendingConfirmation: true, issues: [], quality: unknownQuality() };
    if (projectId === 'carddemo' && source.id === 'requirements:carddemo:DEMO-MKT-001') {
      const task = deliveryTasks.find(task => task.id === 'DEMO-MKT-001')!;
      item.taskId = task.id; item.createdAt = task.createdAt; item.due = task.record?.due; item.owner = task.owner; item.assigneeId = task.assigneeId; item.phase = task.phase; item.deliveryStatus = task.status; item.pendingConfirmation = task.pendingAssignment;
      item.scope = 'Teams 任务交付'; item.route = !task.pendingAssignment ? task.route : route(projectId, 'management');
      item.quality = task.record?deliveryQuality(task.record):[
        { label: '功能', result: state.stage === 'accepted' ? '验收通过' : state.uat ? '边界验收结果已记录' : '待验收', passed: state.stage === 'accepted' },
        { label: 'Review', result: '1 项待核验', passed: false },
        { label: '测试', result: state.checks === 'passed' ? state.stage === 'returned' ? '历史 9/9 · 待复验' : '历史复测 9/9' : state.checks === 'failed' ? '历史检查 7/8 · 失败' : '未检查', passed: state.checks === 'passed' && state.stage !== 'returned' },
        { label: '安全', result: '待验证', passed: false },
      ];
    } else if (source.sourceProjectId === projectId && source.requirement?.delivery) {
      item.owner = source.requirement.owner; item.phase = source.requirement.delivery.phase; item.due = source.requirement.plannedEnd;
      item.pendingConfirmation = false; item.scope = '需求平台交付记录 · 尚未关联执行与验收证据';
      item.quality = unknownQuality();
      item.quality[0].result = item.phase === '已交付' ? '来源已交付 · 验收证据待关联' : item.phase === '待验收' ? '等待 Owner 验收' : '未验收';
    } else if (projectId === 'teams') {
      const task = data.teamsProject.tasks.find(task => source.id === `requirements:teams:REQ-${task.id}`);
      if (task) {
        item.taskId = task.id; item.owner = '成员 ' + task.owner; item.due = task.due; item.pendingConfirmation = false; item.scope = 'Teams 交付快照';
        const accept = task.nodes.find(node => node.id === 'accept'), build = task.nodes.find(node => node.id === 'build'), test = task.nodes.find(node => node.id === 'test');
        item.phase = task.status === '已验收' ? '已交付' : task.status === '待验收' ? '待验收' : task.status === '待开始' ? '待开展' : test && !['未执行', '未开始'].includes(test.status) ? '验证' : build && !['未开始', '未提交'].includes(build.status) ? '开发' : '准备';
        const node = item.phase === '已交付' || item.phase === '待验收' ? 'accept' : item.phase === '验证' ? 'test' : item.phase === '开发' ? 'build' : task.id === 'T104' ? 'review' : task.nodes[0].id;
        item.route = route(projectId, 'delivery', { task: task.id, node });
        item.quality = [{ label: '功能', result: accept?.status === '已完成' ? '已验收（快照）' : '待验收', passed: accept?.status === '已完成' }, { label: 'Review', result: '未提供代码报告', passed: false }, { label: '测试', result: test?.status === '已完成' ? '完成记录（快照）' : task.type === '调研' && !test ? '不适用（调研）' : '未检查', passed: false }, { label: '安全', result: '待验证', passed: false }];
      }
    }
    item.overdue = !!item.due && /^\d{4}-\d{2}-\d{2}$/.test(item.due) && item.due < asOf && item.phase !== '已交付';
    return item;
  });
  for(const task of deliveryTasks)if(task.record&&task.id!=='DEMO-MKT-001'){
    const source:SourcePluginAsset={id:'teams-task:'+projectId+':'+task.id,pluginId:'requirements',sourceRecordId:task.id,kind:'requirement',title:task.title,summary:task.record.description,detail:task.record.description,sourceProjectId:projectId,sourceProjectName:projectId==='carddemo'?state.workspace.project.name:projectId==='teams'?data.teamsProject.project.name:state.workspace.projects?.find(project=>project.id===projectId)?.name??projectId,origin:'teams-task',version:'1',createdAt:task.createdAt,updatedAt:task.record.updatedAt,references:[],relatedRequirementIds:[]};
    allWork.push({id:source.id,source,owner:task.owner,assigneeId:task.assigneeId,phase:task.phase,deliveryStatus:task.status,createdAt:task.createdAt,due:task.record.due,overdue:!!task.record.due&&task.record.due<asOf&&task.phase!=='已交付',taskId:task.id,route:task.route,scope:'Teams需求',pendingConfirmation:task.pendingAssignment,issues:[],quality:deliveryQuality(task.record)});
  }
  const allRequirements = allWork.filter(item => !item.source.requirement || item.source.requirement.category === 'requirement');
  const requirements = orderDeliveryTasks(allRequirements.filter(item => taskVisibleTo(role, item.assigneeId)));
  const research = allWork.filter(item => taskVisibleTo(role, item.assigneeId) && item.source.requirement?.category === 'research');
  const latestReport = (taskId?: string) => (state.workspace.collaboration?.events ?? []).filter(event => event.projectId === projectId && event.taskId === taskId).reduce<CollaborationEvent | undefined>((latest, event) => !latest || event.revision > latest.revision ? event : latest, undefined);
  for (const item of allWork) if (item.taskId) item.activity = latestReport(item.taskId);
  const issues: OverviewIssue[] = sources.filter(source => source.kind === 'defect').map(source => {
    // A linked foreign issue is a source reference, not this project's treatment record.
    const issue = source.sourceProjectId === projectId ? source.issue : undefined;
    const item: OverviewIssue = { id: source.id, source, owner: issue?.owner ?? '未分配', assigneeId: sourceTaskAssigneeId(source, projectId), severity: issue?.severity ?? '未标注', status: issue?.status ?? '待确认', progress: issue?.progress ?? '暂无处理记录', closed: issue?.closed ?? null, confirmed: issue?.confirmed ?? false, blocksDelivery: false, relatedIds: [...source.relatedRequirementIds] };
    let blocking = issue?.blocksDelivery ?? false;
    if (projectId === 'carddemo' && source.id === 'defects:carddemo:CARD-BUG-001' && state.checks !== 'none') {
      item.closed = state.checks === 'passed'; item.status = item.closed ? '已修复关闭' : '待修复'; blocking = !item.closed;
      item.progress = item.closed ? '修复 E4 与复测 E5 已关联' : '规则检查 E3：6/7，等待修复与复测';
    }
    item.blocksDelivery = item.closed === false && blocking && allRequirements.some(requirement => item.relatedIds.includes(requirement.id) && requirement.phase !== '已交付' && (requirement.taskId || requirement.source.sourceProjectId === projectId && requirement.source.requirement?.delivery));
    return item;
  }).filter(item => taskVisibleTo(role, item.assigneeId));
  for(const issue of state.workspace.projectIssues??[])if(issue.projectId===projectId){
    const source:SourcePluginAsset={id:'teams-issue:'+projectId+':'+issue.id,pluginId:'defects',sourceRecordId:issue.id,kind:'defect',title:issue.title,summary:issue.description,detail:issue.description,sourceProjectId:projectId,sourceProjectName:projectId==='carddemo'?state.workspace.project.name:projectId==='teams'?data.teamsProject.project.name:state.workspace.projects?.find(project=>project.id===projectId)?.name??projectId,origin:'teams-task',version:'1',updatedAt:issue.updatedAt,references:[],relatedRequirementIds:[]};
    issues.push({id:source.id,source,owner:projectMembers(state,projectId).find(member=>member.id===issue.assigneeId)?.name??'未分配',assigneeId:issue.assigneeId||null,severity:issueSeverityLabels[issue.severity],status:'待处理',progress:'Teams 本地记录 · 尚无处理记录；未同步外部问题平台',closed:false,confirmed:true,blocksDelivery:false,relatedIds:[]});
  }
  for (const requirement of requirements) requirement.issues = issues.filter(issue => issue.closed !== true && issue.confirmed && issue.relatedIds.includes(requirement.id));
  const result: ProjectOverview = { requirements, research, issues, counts: { all: 0, pending: 0, active: 0, acceptance: 0, delivered: 0, issues: 0, open: 0, closed: 0, unconfirmed: 0, blocking: 0 }, scope: projectId === 'teams' ? `已纳入交付的 ${requirements.length} 项需求与 ${research.length} 项调研分别统计；待确认讨论尚未转成任务。导入记录与本地新建需求分开保留来源。` : projectId === 'carddemo' ? '汇总已关联平台来源与 Teams 本地新建记录；本地需求进度按当前任务状态呈现。' : '仅统计本项目已关联与本地新建的需求和问题；来源关联不代表已进入交付。', asOf };
  for (const filter of ['all', 'pending', 'active', 'acceptance', 'delivered'] as const) result.counts[filter] = filterRequirements(result, filter).length;
  for (const filter of ['issues', 'open', 'closed', 'unconfirmed', 'blocking'] as const) result.counts[filter] = filterIssues(result, filter).length;
  if (role === 'owner') result.projectActivity = latestReport();
  return result;
}
export interface TeamWorkEntry { id: string; projectId: string; projectName: string; item: OverviewRequirement; scope: TaskScope; sessions: CollectedSession[]; automation?: TaskAutomation }
export function teamWorkIndex(state: DemoState, data: Presentation, role: Role = 'owner'): TeamWorkEntry[] {
  const projects = [
    { id: 'carddemo', name: state.workspace.project.name },
    { id: 'teams', name: data.teamsProject.project.name },
    ...(state.workspace.projects ?? []).map(project => ({ id: project.id, name: project.name })),
  ];
  return projects.flatMap(project => {
    const model = projectOverview(state, data, project.id, undefined, role);
    return [...model.requirements, ...model.research].filter(item => item.taskId).map(item => {
      const scope = { projectId: project.id, taskId: item.taskId! };
      return { id: project.id + ':' + item.id, projectId: project.id, projectName: project.name, item, scope, sessions: collectTaskSessions(state, scope), automation: taskAutomation(state, scope) };
    });
  });
}
export function filterRequirements(data: ProjectOverview, filter: OverviewFilter) { return data.requirements.filter(item => filter === 'pending' ? item.phase === '待开展' : filter === 'active' ? ['准备', '开发', '验证'].includes(item.phase) : filter === 'acceptance' ? item.phase === '待验收' : filter === 'delivered' ? item.phase === '已交付' : true); }
export function filterIssues(data: ProjectOverview, filter: OverviewFilter) { return data.issues.filter(item => filter === 'blocking' ? item.blocksDelivery : filter === 'open' ? item.closed === false : filter === 'closed' ? item.closed === true : filter === 'unconfirmed' ? item.closed === null : true); }
