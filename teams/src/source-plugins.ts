import { fourRequirementScenario } from '../../shared/four-requirement-scenarios.js';
import { approvedRequirementSchedule } from './requirement-schedule.js';
import { matchesPlatinumCashbackPage } from '../../shared/platinum-cashback-page.js';
import type { Presentation } from './api.js';
import { externalPlatforms } from './external-platforms.js';

export type SourcePluginId = typeof externalPlatforms[number]['id'];
export type SourceProjectId = string;
export type SourceAssetKind = 'repository' | 'code' | 'requirement' | 'defect' | 'document' | 'test-case';

export interface SourceAssetReference {
  readonly collection: 'sources' | 'teams-documents' | 'graph';
  readonly path: string;
  readonly label: string;
  readonly extent: 'full-file' | 'excerpt';
  readonly origin: 'existing-local-file';
}

/** A source record is available for selection; it is never a project association. */
export interface SourcePluginAsset {
  readonly id: string;
  readonly pluginId: SourcePluginId;
  readonly sourceRecordId: string;
  readonly kind: SourceAssetKind;
  readonly title: string;
  readonly summary: string;
  readonly detail: string;
  readonly sourceProjectId: SourceProjectId;
  readonly sourceProjectName: string;
  readonly origin: 'plugin-mock' | 'teams-task';
  readonly version?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly references: readonly SourceAssetReference[];
  /** Stable asset IDs in the requirements plugin, within the same source project. */
  readonly relatedRequirementIds: readonly string[];
  readonly requirement?: { category: 'requirement' | 'research' | 'issue-input'; owner: string; plannedEnd?: string; taskId?: string; delivery?: { phase: '准备' | '开发' | '验证' | '待验收' | '已交付'; summary: string } };
  readonly testCase?: { readonly given:string; readonly steps:string; readonly expected:string };
  readonly issue?: { owner: string; severity: string; status: string; closed: boolean | null; confirmed: boolean; blocksDelivery: boolean; progress: string };
}

export type SourcePluginData = Pick<Presentation, 'blueprint' | 'teamsProject' | 'sources'> & Partial<Pick<Presentation, 'graph'>>;
export interface SourceAssetFilter { pluginId?: SourcePluginId; sourceProjectId?: SourceProjectId }
export interface SourcePluginProvider {
  readonly id: SourcePluginId;
  readonly name: string;
  readonly kinds: readonly SourceAssetKind[];
  provide(data: SourcePluginData): readonly SourcePluginAsset[];
}
export interface SourcePluginCatalog {
  readonly plugins: readonly SourcePluginProvider[];
  list(filter?: SourceAssetFilter): readonly SourcePluginAsset[];
  get(assetId: string): SourcePluginAsset | undefined;
  readReference(reference: SourceAssetReference): string | undefined;
}

export const sourceAssetKindLabels: Record<SourceAssetKind, string> = {
  repository: '代码仓', code: '代码资产', requirement: '需求', defect: '问题单 / 缺陷', document: '设计与业务资料', 'test-case': '测试用例',
};
export const sourceAssetId = (pluginId: SourcePluginId, projectId: SourceProjectId, sourceRecordId: string) => `${pluginId}:${projectId}:${sourceRecordId}`;

const cardRequirement = sourceAssetId('requirements', 'carddemo', 'DEMO-MKT-001');
const teamRequirement = (id: string) => sourceAssetId('requirements', 'teams', id);
const marketingDesign = 'teams/docs/cashback-contract.md';
const marketingIntegration = 'workspace/carddemo-java-1025/docs/design/adr/ADR-009-marketing-integration.md';
const authenticationScope = 'workspace/carddemo-java-1025/docs/design/adr/ADR-007-authentication-scope.md';
const localFile = (collection: SourceAssetReference['collection'], path: string, label: string): SourceAssetReference => ({
  collection, path, label, extent: collection === 'graph' ? 'excerpt' : 'full-file', origin: 'existing-local-file',
});
const cardDesignReference = () => localFile('sources', marketingDesign, '阅读已有营销能力设计');
const teamDocumentReference = (path: string, label: string) => localFile('teams-documents', path, label);

type AssetInput = Pick<SourcePluginAsset, 'sourceRecordId' | 'kind' | 'title' | 'summary' | 'detail'> & Partial<Pick<SourcePluginAsset, 'version' | 'createdAt' | 'updatedAt' | 'references' | 'relatedRequirementIds' | 'requirement' | 'issue' | 'testCase'>>;
const cardAdditionalRequirements: readonly AssetInput[] = [
  { sourceRecordId: 'MKT-002', kind: 'requirement', title: '返现明细查询', summary: '按交易查看已有返现的金额、处理状态与来源，支持分页和筛选。',
    requirement: { category: 'requirement', plannedEnd: approvedRequirementSchedule['MKT-002'].due, owner: '陈晨', delivery: { phase: '开发', summary: '明细查询与分页开发中，正在处理重复记录问题。' } },
    detail: '范围：展示已有返现记录，按交易与处理状态查询。\n验收关注：明细与交易可对应，分页无重复和遗漏。\n本需求不调整返现资格、比例或结算规则。' },
  { sourceRecordId: 'MKT-003', kind: 'requirement', title: '账单返现汇总', summary: '按账单周期展示已有返现记录的汇总，并支持下钻明细。',
    requirement: { category: 'requirement', plannedEnd: approvedRequirementSchedule['MKT-003'].due, owner: '苏晴', delivery: { phase: '验证', summary: '正在核对汇总与明细的一致性，合计差异待修复。' } },
    detail: '范围：按账单周期聚合已有返现记录。\n验收关注：汇总可下钻，合计与所含明细一致。\n统计使用既有入账记录，不新增入账或退款规则。' },
  { sourceRecordId: 'MKT-004', kind: 'requirement', title: '返现到账通知', summary: '展示返现到账消息，提供金额、到账时间和关联交易入口。',
    requirement: { category: 'requirement', plannedEnd: approvedRequirementSchedule['MKT-004'].due, owner: '杨帆', delivery: { phase: '待验收', summary: '通知内容已提交确认，关联交易摘要问题待复测。' } },
    detail: '范围：基于已有到账记录展示通知与详情。\n验收关注：消息与到账记录对应，关联交易可定位。\n通知不产生返现入账，也不改变活动权益。' },
  { sourceRecordId: 'MKT-005', kind: 'requirement', title: '历史权益查询', summary: '查询已结束权益的适用期间与原始条款，保留权益版本。',
    requirement: { category: 'requirement', plannedEnd: approvedRequirementSchedule['MKT-005'].due, owner: '赵宁', delivery: { phase: '已交付', summary: '来源记录已交付；日期排序问题已关闭，筛选交互问题待处理。' } },
    detail: '范围：查看历史权益及其当时有效的条款版本。\n验收关注：历史期间与版本对应，不以当前规则覆盖旧条款。\n历史权益不作为 MKT-001 新需求的业务约束。' },
];
const cardAdditionalIssues: readonly AssetInput[] = [
  { sourceRecordId: 'CARD-BUG-003', kind: 'defect', title: '返现明细翻页出现重复记录', summary: '翻页后部分交易重复出现，影响明细查询交付。',
    issue: { owner: '陈晨', severity: '高', status: '处理中', closed: false, confirmed: true, blocksDelivery: true, progress: '正在调整分页排序与游标，修复后核对跨页去重。' },
    detail: '问题：分页边界记录重复。\n期望：同一查询范围内每条记录只出现一次。\n影响：阻塞返现明细查询交付。', relatedRequirementIds: [sourceAssetId('requirements', 'carddemo', 'MKT-002')] },
  { sourceRecordId: 'CARD-BUG-004', kind: 'defect', title: '账单返现汇总与明细合计不一致', summary: '汇总金额与下钻明细合计存在差异。',
    issue: { owner: '苏晴', severity: '高', status: '待修复', closed: false, confirmed: true, blocksDelivery: true, progress: '已定位统计范围不一致，等待统一汇总与明细过滤条件。' },
    detail: '问题：同一账单周期的汇总与明细使用不同过滤范围。\n期望：汇总等于当前范围内的明细合计。\n影响：阻塞账单返现汇总交付。', relatedRequirementIds: [sourceAssetId('requirements', 'carddemo', 'MKT-003')] },
  { sourceRecordId: 'CARD-BUG-005', kind: 'defect', title: '返现到账通知缺少关联交易摘要', summary: '通知金额与时间可见，关联交易摘要未完整展示。',
    issue: { owner: '杨帆', severity: '中', status: '待复测', closed: false, confirmed: true, blocksDelivery: false, progress: '摘要展示已调整，等待复测后确认关闭。' },
    detail: '问题：通知详情缺少关联交易摘要。\n期望：用户可辨认到账消息对应的交易。\n当前状态：待复测，尚未关闭。', relatedRequirementIds: [sourceAssetId('requirements', 'carddemo', 'MKT-004')] },
  { sourceRecordId: 'CARD-BUG-006', kind: 'defect', title: '历史权益查询切换条件后保留旧筛选', summary: '切换权益类型时仍保留上一次的筛选条件。',
    issue: { owner: '赵宁', severity: '低', status: '待处理', closed: false, confirmed: true, blocksDelivery: false, progress: '已记录交互问题，等待安排调整。' },
    detail: '问题：切换查询类型后旧条件仍然生效。\n期望：展示当前有效条件，支持清除筛选。\n范围：已交付历史权益查询的后续问题。', relatedRequirementIds: [sourceAssetId('requirements', 'carddemo', 'MKT-005')] },
  { sourceRecordId: 'CARD-BUG-007', kind: 'defect', title: '历史权益日期排序错误', summary: '历史权益按显示字符串排序，未使用实际日期顺序。',
    issue: { owner: '赵宁', severity: '低', status: '已关闭', closed: true, confirmed: true, blocksDelivery: false, progress: '来源记录已确认修复并关闭。' },
    detail: '问题：跨月权益记录顺序错误。\n处理：按权益日期排序。\n当前状态：来源记录已关闭。', relatedRequirementIds: [sourceAssetId('requirements', 'carddemo', 'MKT-005')] },
];
/** Explicit built-in project links; another project must associate each source separately. */
export const cardProjectOverviewSourceIds = [
  cardRequirement, sourceAssetId('defects', 'carddemo', 'CARD-BUG-001'), sourceAssetId('defects', 'carddemo', 'CARD-BUG-002'),
  ...cardAdditionalRequirements.map(item => sourceAssetId('requirements', 'carddemo', item.sourceRecordId)),
  ...cardAdditionalIssues.map(item => sourceAssetId('defects', 'carddemo', item.sourceRecordId)),
] as const;
function asset(data: SourcePluginData, pluginId: SourcePluginId, projectId: SourceProjectId, value: AssetInput): SourcePluginAsset {
  return Object.freeze({
    ...value,
    id: sourceAssetId(pluginId, projectId, value.sourceRecordId), pluginId,
    sourceProjectId: projectId,
    sourceProjectName: projectId === 'teams' ? data.teamsProject.project.name : 'Credit Card',
    origin: 'plugin-mock' as const,
    detail: `来源记录 · ${value.sourceRecordId}\n\n${value.detail}`,
    references: Object.freeze((value.references ?? []).map(reference => Object.freeze({ ...reference }))),
    relatedRequirementIds: Object.freeze([...(value.relatedRequirementIds ?? [])]),
  });
}

function repositoryAssets(data: SourcePluginData): readonly SourcePluginAsset[] {
  const card = (value: AssetInput) => asset(data, 'repository', 'carddemo', value);
  const repo = data.teamsProject.project.repos[0];
  return [
    card({
      sourceRecordId: 'carddemo-java-1025', kind: 'repository', title: '白金卡返现规则',
      summary: '当前返现规则及本地协作流程源码。', version: '当前规则版本',
      detail: '逻辑位置：teams/src/cashback.ts 与 teams/src/domain.ts\n范围：卡片资格、期间、金额计算和工作流状态。\nJava 快照仅是保留的来源资料，不是当前规则的运行实现。',
      relatedRequirementIds: [cardRequirement],
    }),
    ...(data.graph ?? []).map(source => card({
      sourceRecordId: `code-${source.id}`, kind: 'code', title: `${source.name} · 源码`,
      summary: source.file, version: '当前源码节选',
      detail: `当前规则源码\n文件：${source.file}\n记录引用当前当前源码节选。`,
      references: [localFile('graph', source.file, '阅读已有源码节选')], relatedRequirementIds: [cardRequirement],
    })),
    asset(data, 'repository', 'teams', {
      sourceRecordId: 'icode-teams', kind: 'repository', title: repo.name,
      summary: repo.note, version: `源码快照 ${data.teamsProject.sourceCommit.slice(0, 7)}`,
      detail: `项目：${data.teamsProject.project.name}\n代码仓：${repo.name}\n分支：${repo.branch}\n源目录：${repo.path}\n${repo.note}\n记录来自已导入的 Teams 项目快照；引用文件保留原文。`,
      references: [teamDocumentReference('README.md', '阅读仓库 README'), teamDocumentReference('AGENTS.md', '阅读仓库规范 AGENTS.md')],
    }),
  ];
}

function requirementAssets(data: SourcePluginData): readonly SourcePluginAsset[] {
  const reconnect = data.teamsProject.inputs.find(input => input.id === 'D201');
  if (!reconnect) throw new Error('Teams 项目数据缺少 D201 需求依据');
  return [
    asset(data, 'requirements', 'carddemo', {
      sourceRecordId: 'DEMO-MKT-001', kind: 'requirement', title: '信用卡消费返现', version: '需求 r1',
      requirement: { category: 'requirement', owner: '待分配', taskId: 'DEMO-MKT-001' },
      summary: data.blueprint.scenario.slice,
      detail: `需求范围：${data.blueprint.scenario.slice}\n\n已确认：\n1. 目标客户为白金卡客户。\n2. 消费期间为未来 3 个月。\n3. 消费额外返现比例为 0.5%。\n\n待确认：活动日期、周期起算、消费范围与排除项、是否报名、消费门槛、返现上限、结算入账及退款规则。\n\n当前本地规则与正式政策分别记录；正式业务细则需确认。`,
      references: [cardDesignReference()],
    }),
    ...cardAdditionalRequirements.map(item => asset(data, 'requirements', 'carddemo', {
      ...item, version: '需求 r1',
      detail: `需求来源：需求平台\n负责人：${item.requirement!.owner}\n交付状态：${item.requirement!.delivery!.phase}\n进展：${item.requirement!.delivery!.summary}\n\n${item.detail}\n\n进展来自需求平台记录，尚未关联 iCode 执行会话或验收证据。`,
    })),
    ...data.teamsProject.tasks.map(task => asset(data, 'requirements', 'teams', {
      sourceRecordId: `REQ-${task.id}`, kind: 'requirement', title: task.title,
      requirement: { category: task.type === '需求' ? 'requirement' : 'research', owner: '成员 ' + task.owner, plannedEnd: task.due, taskId: task.id },
      summary: task.goal, version: 'Teams 需求快照',
      detail: `依据：已导入 Teams 事项 ${task.id}（${task.type}）。\n目标：${task.goal}\n\n需求标准：\n${task.criteria.map((criterion, index) => `${index + 1}. ${criterion}`).join('\n')}\n\n这里只投影事项的需求定义，不包含交付节点、会话、执行状态或发布结果。`,
    })),
    asset(data, 'requirements', 'teams', {
      sourceRecordId: 'REQ-WINDOWS-RECONNECT', kind: 'requirement', title: reconnect.title,
      requirement: { category: 'issue-input', owner: '成员 C' },
      summary: '重启后恢复 Agent 连接，并区分正常重启与异常退出路径。', version: '需求 r1',
      detail: `依据：已导入 Teams 输入 ${reconnect.id}。\n来源引用：${reconnect.ref}\n\n${reconnect.text}\n\n该需求根据已导入输入整理。`,
    }),
  ];
}

function defectAssets(data: SourcePluginData): readonly SourcePluginAsset[] {
  const reconnect = data.teamsProject.inputs.find(input => input.id === 'D201');
  if (!reconnect) throw new Error('Teams 项目数据缺少 D201 问题依据');
  const web = data.graph?.find(source => source.id === 'web');
  return [
    asset(data, 'defects', 'carddemo', {
      sourceRecordId: 'CARD-BUG-001', kind: 'defect', title: '普通卡不应进入白金卡返现范围', version: '问题 r1',
      issue: { owner: '陈晨', severity: '未标注', status: '待复核', closed: null, confirmed: true, blocksDelivery: false, progress: '检查卡片等级与金额计算是否正确关联。' },
      summary: '补充普通卡反向用例，避免只验证白金卡正向输入。',
      detail: '问题场景：普通卡发生120元消费。\n问题描述：若只检查消费时间而遗漏卡片等级，会错误计算0.60元奖励。\n期望行为：普通卡不参与，奖励为0。\n当前处理状态由本次交付检查记录补充。',
      references: [cardDesignReference(), ...(web ? [localFile('graph', web.file, '阅读已有活动中心源码节选')] : [])], relatedRequirementIds: [cardRequirement],
    }),
    asset(data, 'defects', 'carddemo', {
      sourceRecordId: 'CARD-BUG-002', kind: 'defect', title: '重复评估需保持一笔奖励和一次入账', version: '问题 r1',
      issue: { owner: '未分配', severity: '未标注', status: '待复现', closed: null, confirmed: false, blocksDelivery: false, progress: '尚无缺陷复现或关闭记录。' },
      summary: '重复评估的幂等边界待核验。',
      detail: '问题描述：同一活动、同一交易收到重复评估请求。\n期望行为：首次按规则计算奖励；后续请求识别已评估，沿用原奖励标识，避免重复入账。\n复现状态：尚未复现，需结合关联需求与测试用例核验。',
      references: [cardDesignReference(), localFile('sources', marketingIntegration, '阅读已有营销集成决策')], relatedRequirementIds: [cardRequirement],
    }),
    ...cardAdditionalIssues.map(item => asset(data, 'defects', 'carddemo', {
      ...item, version: '问题 r1',
      detail: `问题来源：缺陷平台\n负责人：${item.issue!.owner}\n处理状态：${item.issue!.status}\n进展：${item.issue!.progress}\n\n${item.detail}\n\n处理状态来自缺陷平台记录，尚未关联 iCode 执行证据。`,
    })),
    asset(data, 'defects', 'teams', {
      sourceRecordId: 'TEAMS-BUG-001', kind: 'defect', title: reconnect.title, version: 'Teams 问题快照',
      issue: { owner: '成员 C', severity: '未标注', status: '待补复现 · 关闭状态未记录', closed: null, confirmed: true, blocksDelivery: false, progress: 'D201 → R20 讨论中，需补充正常重启和异常退出的复现步骤。' },
      summary: 'Windows 重启后的 Agent 连接恢复问题。',
      detail: `来源依据：Teams 输入 ${reconnect.id}。\n来源引用：${reconnect.ref}\n\n${reconnect.text}\n\n保留来源输入作为问题描述；处理与验证结果待补充。`,
      relatedRequirementIds: [teamRequirement('REQ-WINDOWS-RECONNECT')],
    }),
  ];
}

function designAssets(data: SourcePluginData): readonly SourcePluginAsset[] {
  const cards = [
    { sourceRecordId: 'marketing-capability', title: '营销能力设计', path: marketingDesign, summary: '白金卡资格、三个月期间、额外0.5%与金额舍入规则。' },
    { sourceRecordId: 'ADR-009', title: '营销集成与入账边界', path: marketingIntegration, summary: '交易入账与营销评估之间的调用、提交及重试约定。' },
    { sourceRecordId: 'ADR-007', title: '鉴权范围设计决策', path: authenticationScope, summary: '已有系统的认证范围与限制说明；属于设计资料。' },
  ];
  return [
    ...cards.map(document => asset(data, 'design-library', 'carddemo', {
      sourceRecordId: document.sourceRecordId, kind: 'document', title: document.title, summary: document.summary,
      version: '当前规则文件',
      detail: `文档路径：${document.path}\n${document.summary}\n\n插件仅提供文档目录记录；阅读入口返回当前规则文档。`,
      references: [localFile('sources', document.path, `阅读${document.title}`)], relatedRequirementIds: [cardRequirement],
    })),
    ...[{ name: '项目规范 AGENTS.md', path: 'AGENTS.md', description: data.teamsProject.project.agentsNote }, ...data.teamsProject.project.docs].map(document => asset(data, 'design-library', 'teams', {
      sourceRecordId: document.path, kind: 'document', title: document.name, summary: document.description,
      version: `源码快照 ${data.teamsProject.sourceCommit.slice(0, 7)}`,
      detail: `项目：${data.teamsProject.project.name}\n文档路径：${document.path}\n${document.description}\n\n插件记录引用原 Teams 导入快照，阅读入口保留原文。`,
      references: [teamDocumentReference(document.path, `阅读${document.name}`)],
    })),
  ];
}

function testAssets(data: SourcePluginData): readonly SourcePluginAsset[] {
  const titles: Record<string, string> = {
    'AC-01': '白金卡客户范围', 'AC-02': '未来 3 个月消费期间', 'AC-03': '消费额外返现 0.5%',
  };
  const definitions = [
    { id: 'TEAMS-TC-001', requirement: 'REQ-T104', title: '新成员获取项目配置前查看范围', given: '用户已加入团队，项目包含资料与配置。', steps: '打开团队项目，选择待应用配置，查看内容和影响范围。', expected: '展示项目资料、配置内容及作用范围；此处仅定义预期，不记录实际应用结果。' },
    { id: 'TEAMS-TC-002', requirement: 'REQ-T105', title: '切换项目后只显示目标项目内容', given: '两个项目分别拥有不同的资料与来源关联。', steps: '在侧栏依次进入两个项目，再进入一个未关联资产的新项目。', expected: '已有项目显示各自关联；新项目初始为空，不自动继承其他项目数据。' },
    { id: 'TEAMS-TC-003', requirement: 'REQ-T107', title: '工作目录与代码仓身份核对', given: '项目登记了代码仓，本机存在候选工作目录。', steps: '选择匹配目录，再选择不匹配目录，检查页面反馈。', expected: '匹配目录可按合同关联；不匹配目录明确提示，不能默认为已核验。' },
    { id: 'TEAMS-TC-004', requirement: 'REQ-WINDOWS-RECONNECT', title: 'Windows 正常重启与异常退出后的连接恢复', given: 'Windows 环境已接入一个 Agent 实例。', steps: '分别使用正常重启和异常退出的独立场景，再启动客户端检查连接提示。', expected: '呈现真实连接状态与可执行的下一步；此用例定义不代表已运行或验证通过。' },
  ];
  return [
    ...data.blueprint.acceptance_criteria.filter(criterion => criterion.id in titles).map(criterion => asset(data, 'test-assets', 'carddemo', {
      sourceRecordId: `CARD-TC-${criterion.id.slice(3)}`, kind: 'test-case', title: titles[criterion.id],
      summary: criterion.given, version: '用例 v1',
      testCase:{given:criterion.given,steps:'按已确认的 PRD 范围核对；未决政策不设虚构预期。',expected:criterion.expected},
      detail: `用例依据：验收标准 ${criterion.id}。\n前置条件 / 输入：${criterion.given}\n操作：按已确认的需求范围核对；具体执行步骤待业务细则明确后补充。\n预期结果：${criterion.expected}\n\n本记录是测试用例定义，不包含测试运行、测试报告或验收结论。`,
      references: [cardDesignReference()], relatedRequirementIds: [cardRequirement],
    })),
    ...definitions.map(definition => asset(data, 'test-assets', 'teams', {
      sourceRecordId: definition.id, kind: 'test-case', title: definition.title, summary: definition.given,
      version: '用例 v1', testCase:{given:definition.given,steps:definition.steps,expected:definition.expected},
      detail: `前置条件：${definition.given}\n操作步骤：${definition.steps}\n预期结果：${definition.expected}\n\n此为测试用例定义，未执行测试。`,
      relatedRequirementIds: [teamRequirement(definition.requirement)],
    })),
  ];
}

const provider = (id: SourcePluginId, kinds: readonly SourceAssetKind[], provide: SourcePluginProvider['provide']): SourcePluginProvider => Object.freeze({
  id, name: externalPlatforms.find(platform => platform.id === id)!.name, kinds: Object.freeze([...kinds]), provide,
});

/** Raw source providers. Talents knowledge is shown on the project knowledge page, not as a source. */
export const sourcePluginProviders: readonly SourcePluginProvider[] = Object.freeze([
  provider('repository', ['repository', 'code'], repositoryAssets),
  provider('requirements', ['requirement'], requirementAssets),
  provider('defects', ['defect'], defectAssets),
  provider('design-library', ['document'], designAssets),
  provider('test-assets', ['test-case'], testAssets),
]);

export function createSourcePluginCatalog(data: SourcePluginData): SourcePluginCatalog {
  const records = sourcePluginProviders.flatMap(plugin => [...plugin.provide(data)]);
  const byId = new Map<string, SourcePluginAsset>();
  for (const record of records) {
    if (byId.has(record.id)) throw new Error(`源插件记录 ID 重复：${record.id}`);
    byId.set(record.id, record);
  }
  for (const record of records) for (const requirementId of record.relatedRequirementIds) {
    const requirement = byId.get(requirementId);
    if (!requirement || requirement.pluginId !== 'requirements' || requirement.sourceProjectId !== record.sourceProjectId) throw new Error(`源插件需求关联无效：${record.id} → ${requirementId}`);
  }
  return Object.freeze({
    plugins: sourcePluginProviders,
    list: (filter: SourceAssetFilter = {}) => Object.freeze(records.filter(record => (!filter.pluginId || record.pluginId === filter.pluginId) && (!filter.sourceProjectId || record.sourceProjectId === filter.sourceProjectId))),
    get: (assetId: string) => byId.get(assetId),
    readReference(reference: SourceAssetReference) {
      if (reference.collection === 'sources') return data.sources.find(source => source.file === reference.path)?.content;
      if (reference.collection === 'teams-documents') return data.teamsProject.documents.find(document => document.path === reference.path)?.content;
      if (reference.collection === 'graph') return data.graph?.find(source => source.file === reference.path)?.excerpt;
      return undefined;
    },
  });
}

/** Explicit project/task mapping; source candidates never become tests for unrelated tasks. */
export function taskTestCases(data:SourcePluginData,task:{projectId:string;id:string;title:string;description?:string}):readonly SourcePluginAsset[]{
 const four=fourRequirementScenario(task.projectId,task);
 if(four)return four.cases.map(item=>asset(data,'test-assets','carddemo',{sourceRecordId:item.id,kind:'test-case',title:item.title,summary:item.given,version:four.casesVersion,testCase:{given:item.given,steps:item.steps,expected:item.expected},detail:`${four.businessId} ${item.sourceSection} 原始用例定义（未执行）\n前置：${item.given}\n步骤：${item.steps}\n原文预期：${item.expected}\n本次执行同时应用独立 test-profile-v${four.version}；原文冲突保留，按已登记试验口径核对，不将原文矛盾示例作为通过依据。`,relatedRequirementIds:[]}));
 if(matchesPlatinumCashbackPage(task.projectId,task)){
  const cases=[
   {id:'PLATINUM-PAGE-TC-01',title:'白金卡与非白金卡入口隔离',given:'PRD 已确认可核验的客户资格字段；缺字段时记录阻塞。',steps:'分别以明确白金卡和非白金卡资格打开卡片详情。',expected:'仅白金卡展示消费返现权益入口；非白金卡不展示。'},
   {id:'PLATINUM-PAGE-TC-02',title:'权益说明与未决政策边界',given:'通过白金卡入口进入说明页。',steps:'核对适用客户、未来 3 个月、额外 0.5% 及未决事项。',expected:'已确认与待确认分开；日期起算、消费范围、上限、舍入、到账、退款不补造确定规则。'},
   {id:'PLATINUM-PAGE-TC-03',title:'未知资格与数据异常',given:'资格信息缺失、未知或请求失败。',steps:'查看入口与说明的异常反馈。',expected:'不把未知资格当成白金卡；采用 PRD 确认的异常提示，不伪称已取得资格。'},
   {id:'PLATINUM-PAGE-TC-04',title:'只读展示不触发资金操作',given:'当前需求范围只包含入口和说明页。',steps:'检查页面操作及相关调用，核对上游代码版本。',expected:'不新增实际返现计算、记账、入账或资金写操作；相关检查记录实际工具与结果。'},
  ];
  return cases.map(item=>asset(data,'test-assets','carddemo',{sourceRecordId:item.id,kind:'test-case',title:item.title,summary:item.given,version:'platinum-page-cases-v1',testCase:{given:item.given,steps:item.steps,expected:item.expected},detail:`用例 ID：${item.id}\n前置条件：${item.given}\n操作步骤：${item.steps}\n预期结果：${item.expected}\n\n企业测试资产插件的场景用例定义，未执行测试；按项目及精确需求标题匹配，采用前核对当前 PRD。`,relatedRequirementIds:[]}));
 }
 const requirementId=sourceAssetId('requirements',task.projectId,task.projectId==='teams'&&/^T\d+$/.test(task.id)?'REQ-'+task.id:task.id);
 return testAssets(data).filter(item=>item.sourceProjectId===task.projectId&&item.relatedRequirementIds.includes(requirementId));
}
