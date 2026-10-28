// Initial Talents state (formerly the static demo's js/data.js). Team, members, projects, code repositories,
// design documents and shared sessions are NOT here: they come from the Teams snapshot (teams-data.ts).
// What is here is owned by Talents: capabilities, tasks, artifacts, the developer's machine, the local
// document source, and Talents' own metadata about Teams sources (document versions, commits, PRs).
import { minerFiles } from './content.ts';
import { platinumCashbackPageArtifact } from './platinum-cashback-page.ts';
import { fourRequirementArtifacts } from './four-requirements.ts';
import type { TalentsState } from './model.ts';

/** Bump only for an explicit incompatible seed migration: another version replaces stored state.
 * Additive demo sources belong to fresh initialization/reset and must not reset existing user data. */
export const SEED_VERSION = 8;

export const PROJECT_ID = 'carddemo';
/** Source ids derived from the Teams snapshot (see teams-data.ts): repository id, and one document set per project. */
export const REPO_ID = 'repository:carddemo:carddemo-java-1025';
export const DOCSET_ID = 'docset:carddemo';
export const STD_ID = 's-std';

const MINER_V1 = ['跨服务幂等记账', '乐观锁更新账户余额', '统一错误码与异常处理'];
const MINER_V2 = [...MINER_V1, '营销奖励发放'];
const BIZ_FILES = ['doc-knowledge/index.md', 'doc-knowledge/业务规则目录.md', 'doc-knowledge/统一语言术语表.md', 'doc-knowledge/数据字典.md'];
const STD_FILES = ['doc-knowledge/银行编码规范要点.md'];

const PRS: [number, string, string][] = [
  [12, '各服务统一 ApiError 与 GlobalExceptionHandler', '2026-09-22'],
  [19, '下游不可用统一映射 503', '2026-09-25'],
  [23, '账户维护改用 @Version 乐观锁', '2026-09-28'],
  [29, '卡片维护并发冲突返回 409', '2026-09-30'],
  [35, '校验错误保留存量提示文案', '2026-10-03'],
  [38, 'customer-service：SSN 首段与 FICO 范围校验', '2026-10-05'],
  [41, '账单支付改为本地 PENDING + 远程扣款', '2026-10-08'],
  [44, 'card-service：卡片更新不再覆盖 CVV', '2026-10-10'],
  [47, '日终入账单笔幂等与部分成功', '2026-10-12'],
  [50, '过期授权清理时释放占用额度', '2026-10-14'],
  [52, '记账 / 还款 / 计息改为领域方法', '2026-10-16'],
  [55, '利息计算按披露组取利率，未命中回落 DEFAULT', '2026-10-18'],
  [58, '返现入账按 rewardId 幂等', '2026-10-19'],
  [61, '新增 marketing-service 奖励评估', '2026-10-21'],
  [63, '入账后触发奖励评估', '2026-10-22'],
  [64, 'transaction-service：交易明细导出', '2026-10-23'],
  [66, '返现失败保留 PENDING 并支持人工重试', '2026-10-24'],
];

export function seedState(): TalentsState {
  return {
    schemaVersion: 1, seedVersion: SEED_VERSION, revision: 1,
    role: 'admin',
    agents: [
      { id: 'Code', name: 'Code Agent' },
      { id: 'QA', name: 'Q&A Agent' },
      { id: 'Reviewer', name: '代码评审助手' },
    ],
    // The only source Talents owns: a local document directory registered here.
    localSources: [
      { id: STD_ID, type: 'docs', name: '银行开发规范', path: '/Volumes/team-share/standards/bank-dev', files: 10, desc: '行内 Java 开发、安全、数据库与接口规范',
        from: { kind: 'shared' }, lastCheck: '2026-10-26 02:30', projectIds: [PROJECT_ID],
        versions: [
          { at: '2026-10-22 16:40', added: ['密码与密钥管理规范.md'], modified: ['安全编码指南.md'] },
          { at: '2026-10-12 10:00', initial: 9 },
        ],
        tree: [{ dir: '', files: ['Java编码规范.md', '安全编码指南.md', '密码与密钥管理规范.md', '数据库设计规范.md', '接口设计规范.md', '日志与审计规范.md', '金额与精度处理规范.md', '异常与错误码规范.md', '单元测试规范.md', '代码评审清单.md'] }] },
    ],
    // Talents' mock metadata about sources Teams owns; versions newest first.
    sourceMeta: {
      [REPO_ID]: { origin: 'git@code.bank.local:carddemo/carddemo-java-1025.git', prs: 66,
        commit: { sha: '4e1b7c2', message: '返现失败保留 PENDING 并支持人工重试 (#66)', time: '2026-10-24 15:58' } },
      [DOCSET_ID]: { lastCheck: '2026-10-27 09:05',
        versions: [
          { at: '2026-10-27 09:05', added: ['teams/docs/cashback-contract.md'] },
          { at: '2026-10-26 10:00', initial: 2, files: ['workspace/carddemo-java-1025/docs/design/adr/ADR-009-marketing-integration.md', 'workspace/carddemo-java-1025/docs/design/adr/ADR-007-authentication-scope.md'] },
        ] },
    },
    prs: { [REPO_ID]: PRS.map(([number, title, merged]) => ({ number, title, merged })) },
    categories: [
      { id: 'index', name: '知识索引', desc: '快速找到相关的代码和文档' },
      { id: 'doc', name: '文档知识提取', desc: '从需求、设计文档中提取业务知识' },
      { id: 'code', name: '代码知识挖掘', desc: '从 PR 和代码变更中反推开发范式与业务规则' },
      { id: 'traj', name: '轨迹分析', desc: '从 Agent 会话中找出问题和改进点' },
    ],
    capabilities: [
      // update: what the capability does when asked to update an existing artifact; absent = it only builds.
      { id: 'codegraph', cat: 'index', name: 'CodeGraph', desc: '为代码仓构建代码图谱，查询符号定义、调用关系和依赖。', input: 'repo', inputLabel: '1 个代码仓', output: '代码图谱索引（MCP 查询）',
        update: '只同步上次构建以来的代码变化' },
      { id: 'doc-index', cat: 'index', name: '文档 RAG 检索', desc: 'BM25 + 向量混合检索，按问题找到相关段落。', input: 'docs', inputLabel: '1 个文档集', output: '检索索引（MCP 查询）',
        update: '只处理新增和修改的文档，移除已删除文档的片段' },
      { id: 'doc-extract', cat: 'doc', name: '业务知识提取', desc: '从文档中提取业务规则、统一语言术语和数据字典。', input: 'docs', inputLabel: '1 个文档集', output: '业务知识文档', skill: true,
        update: '根据文档变化修订受影响的知识',
        prompt: '从所选文档集中提取业务规则、统一语言术语和数据字典，每条知识注明出处。' },
      { id: 'miner-pr', cat: 'code', name: '开发范式挖掘（PR）', desc: '分析已合并的 PR，总结可复用的开发范式。', input: 'repo+pr', inputLabel: '1 个代码仓和若干 PR', output: '开发范式库', skill: true, noUpdate: '每次运行归档新的范式',
        prompt: '总结所选 PR 体现的开发范式，归档到代码仓的开发范式库。' },
      { id: 'miner-diff', cat: 'code', name: '开发范式挖掘（代码片段）', desc: '结合代码仓上下文分析代码片段，总结开发范式。', input: 'repo+snippet', inputLabel: '1 个代码仓和代码片段', output: '开发范式库', skill: true, noUpdate: '每次运行归档新的范式',
        prompt: '总结所给代码片段体现的开发范式，归档到代码仓的开发范式库。' },
      { id: 'traj', cat: 'traj', name: '会话轨迹诊断', desc: '还原 Agent 会话中的错误过程，定位问题并给出改进建议。', input: 'sessions', inputLabel: '1 到多个团队会话', output: '诊断报告和改进建议', skill: true, noUpdate: '每次运行生成新的诊断',
        prompt: '诊断所选会话中 Agent 的过程错误，给出可复用的改进建议。' },
    ],
    tasks: [
      { id: 't-cg-java', name: '', cap: 'codegraph', sources: [REPO_ID], schedule: { kind: 'daily', time: '02:00' }, mode: 'update', skipUnchanged: true, input: { from: 'b81d3e9', to: '4e1b7c2' }, status: 'success', lastRun: '2026-10-26 02:00', duration: '12 秒', artifact: 'a-cg-java', created: '2026-10-20 10:20' },
      { id: 't-docidx', name: '', cap: 'doc-index', sources: [DOCSET_ID], schedule: { kind: 'daily', time: '02:30' }, mode: 'update', skipUnchanged: true, input: { from: '2026-10-26 10:00', to: '2026-10-27 09:05' }, status: 'success', lastRun: '2026-10-27 09:10', duration: '18 秒', artifact: 'a-docidx', created: '2026-10-26 10:12' },
      { id: 't-biz', name: '', cap: 'doc-extract', sources: [DOCSET_ID], mode: 'update', input: { from: '2026-10-26 10:00', to: '2026-10-27 09:05' }, schedule: { kind: 'now' }, status: 'success', lastRun: '2026-10-27 09:31', duration: '6 分 12 秒', artifact: 'a-biz', created: '2026-10-25 22:24' },
      { id: 't-std', name: '', cap: 'doc-extract', sources: [STD_ID], schedule: { kind: 'now' }, status: 'success', lastRun: '2026-10-18 11:22', duration: '9 分 05 秒', artifact: 'a-std', created: '2026-10-18 11:13' },
      { id: 't-miner', name: '', cap: 'miner-pr', sources: [REPO_ID], prs: [12, 19, 23, 29, 35, 41, 47, 52, 58, 61, 63, 66], schedule: { kind: 'now' }, status: 'success', lastRun: '2026-10-24 17:10', duration: '26 分 41 秒', artifact: 'a-miner', created: '2026-10-24 16:43' },
    ],
    // published: what developers see; draft: the latest run, waiting for review (revisions are added while reviewing).
    // basis: the source state the artifact was built from (a document version, or a commit for code).
    artifacts: [
      platinumCashbackPageArtifact(),
      ...fourRequirementArtifacts(1),
      ...fourRequirementArtifacts(2),
      { id: 'a-cg-java', cap: 'codegraph', name: 'carddemo-java-1025 CodeGraph', desc: '查询 carddemo-java-1025 中类、方法的定义与调用关系。', sources: [REPO_ID], kind: 'index',
        stats: [['文件', '1,284'], ['节点', '41,206'], ['关系', '152,883']], mcpName: 'codegraph',
        published: { version: 3, at: '2026-10-26 02:05', note: '同步代码变化：3 个新提交', delivery: 'cloud', project: PROJECT_ID, basis: { commit: '4e1b7c2' }, auto: true }, draft: null },
      { id: 'a-docidx', cap: 'doc-index', name: '信用卡营销交付文档 RAG 检索', desc: '按问题检索信用卡营销交付文档中的相关段落。', sources: [DOCSET_ID], kind: 'index',
        stats: [['文档', '3'], ['片段', '146'], ['向量维度', '1,024']], mcpName: 'docs-rag',
        published: { version: 2, at: '2026-10-27 09:12', note: '同步文档变化：新增 1', delivery: 'cloud', project: PROJECT_ID, basis: { version: '2026-10-27 09:05' }, auto: true }, draft: null },
      { id: 'a-biz', cap: 'doc-extract', name: '信用卡营销返现业务知识', desc: '业务规则目录、统一语言术语表和数据字典，每条注明出处。', sources: [DOCSET_ID], kind: 'files', folder: '业务知识',
        files: BIZ_FILES, skills: ['bank-domain-payments'], usage: '涉及返现规则、字段含义、术语或业务流程时先查阅',
        published: { version: 1, at: '2026-10-26 14:40', note: '首次发布', delivery: 'local', project: PROJECT_ID, files: BIZ_FILES, basis: { version: '2026-10-26 10:00' },
          over: { 'doc-knowledge/业务规则目录.md': 'doc-knowledge-v1/业务规则目录.md' } },
        draft: { created: '2026-10-27 09:31', task: 't-biz', revisions: [], basis: { version: '2026-10-27 09:05' } } },
      { id: 'a-std', cap: 'doc-extract', name: '银行编码规范要点', desc: '分层、建模、接口与安全约定，以及五类检查规则。', sources: [STD_ID], kind: 'files', folder: '编码规范',
        files: STD_FILES, skills: ['dev-bank-coding-standards'], usage: '编写或评审代码时对照检查',
        published: { version: 1, at: '2026-10-18 14:02', note: '首次发布', delivery: 'local', project: PROJECT_ID, files: STD_FILES, basis: { version: '2026-10-12 10:00' } }, draft: null },
      { id: 'a-miner', cap: 'miner-pr', name: 'carddemo-java-1025 开发范式', desc: '从已合并 PR 总结的实现范式，含步骤、约束和示例代码。', sources: [REPO_ID], kind: 'files', folder: 'miner',
        specs: MINER_V2, files: minerFiles(MINER_V2), skills: ['find-reference-spec'], usage: '开发新需求或修改现有功能前，用 find-reference-spec 查找可参考的范式',
        published: { version: 2, at: '2026-10-24 17:40', note: '新增范式「营销奖励发放」', delivery: 'local', project: PROJECT_ID, specs: MINER_V2, files: minerFiles(MINER_V2) },
        history: [{ version: 1, specs: MINER_V1 }], draft: null },
    ],
    // Trajectory reports are picked by matching the selected sessions' titles; the first topic is the default.
    trajTopics: {
      platinum: { skill: 'dev-backend-service', title: '白金卡返现交付', keywords: ['白金卡', '返现', '资格', '卡片等级', '期间', '0.5%'] },
      reward: { skill: 'dev-api-integration', title: '营销奖励幂等', keywords: ['幂等', '重复', '冲正', '回滚', '入账'] },
    },
    // The developer's own machine.
    dev: {
      applied: {
        'a-cg-java': { version: 3, scope: { kind: 'agent', agents: ['Code'] }, at: '2026-10-20 11:20' },
        'a-std': { version: 1, scope: { kind: 'global', dir: 'chrys' }, at: '2026-10-18 15:00' },
        'a-miner': { version: 1, scope: { kind: 'repo', repos: [REPO_ID] }, at: '2026-10-22 16:30' },
        'a-biz': { version: 1, scope: { kind: 'repo', repos: [REPO_ID] }, at: '2026-10-26 15:10' },
      },
      local: [
        { id: 'l-java', type: 'repo', name: 'carddemo-java-1025', path: '~/code/carddemo-java-1025', repo: REPO_ID, index: { at: '2026-10-26 09:02', files: '1,291' }, applied: true },
        { id: 'l-notes', type: 'docs', name: '个人开发笔记', path: '~/notes/carddemo', index: null, applied: false },
      ],
    },
  };
}
