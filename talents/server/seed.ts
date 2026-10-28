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
export const SEED_VERSION = 12;

export const PROJECT_ID = 'carddemo';
/** Source ids derived from the Teams snapshot (see teams-data.ts): repository id, and one document set per project. */
export const REPO_ID = 'repository:carddemo:carddemo-java-1025';
export const DOCSET_ID = 'docset:carddemo';
export const STD_ID = 's-std';
/** The diagnosed iCode session (Teams shares it; content/trajectory/carddemo-19 holds its report). */
export const TRAJ_SESSION = '6b82c08d-eb3b-4bdc-b373-54fed16a7fcd';

const MINER_DIFF = ['消费返现与奖励发放', '跨服务幂等入账与失败重试', '活动资格判定与有效期控制', '账户余额乐观锁更新', '用户维护与删除保护'];
const MINER_PR = ['统一错误码与异常处理'];
const MINER_SPECS = [...MINER_DIFF, ...MINER_PR];
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
    // The only source Talents owns: a local document directory, registered at team level.
    localSources: [
      { id: STD_ID, type: 'docs', name: '银行开发规范', path: '/Volumes/team-share/standards/bank-dev', files: 10, desc: '行内 Java 开发、安全、数据库与接口规范',
        from: { kind: 'shared' }, lastCheck: '2026-10-26 02:30', projectId: null,
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
      { id: 'traj', name: '轨迹分析', desc: '从 Agent 执行轨迹中发现问题、沉淀经验' },
    ],
    capabilities: [
      // update: what the capability does when asked to update an existing artifact; absent = it only builds.
      { id: 'codegraph', version: '0.1.0', cat: 'index', name: 'CodeGraph', desc: '为代码仓构建代码图谱，查询符号定义、调用关系和依赖。', input: 'repo', inputLabel: '1 个代码仓', output: '代码图谱索引（MCP 查询）',
        update: '只同步上次构建以来的代码变化',
        detail: { input: '必须提供 1 个代码仓（本机路径，或 Git 远端和分支）；只分析代码本身，不需要额外文档。',
          abilities: [
            ['符号索引', '解析类、方法、字段等符号及其定义位置，按名称精确查找。'],
            ['调用与依赖关系', '建立调用链、继承和模块依赖，回答“谁调用了它”“改了它会影响哪里”。'],
            ['结构概览', '按包和服务聚类，呈现代码仓的整体结构和服务之间的联系。'],
            ['增量同步', '来源更新后只同步上次构建以来的代码变化，图谱始终与代码一致。'],
          ],
          output: '代码图谱索引，保留在远端，Agent 通过 MCP 查询；在 Talents 中可以交互浏览图谱并预览源码。' } },
      { id: 'doc-index', version: '0.1.0', cat: 'index', name: '文档 RAG 检索', desc: 'BM25 + 向量混合检索，按问题找到相关段落。', input: 'docs', inputLabel: '1 个文档集', output: '检索索引（MCP 查询）',
        update: '只处理新增和修改的文档，移除已删除文档的片段',
        detail: { input: '必须提供 1 个文档集，例如需求、设计、接口说明和规范等 Markdown 或文本文档。',
          abilities: [
            ['结构化切分', '按标题层级和段落切分文档，保留所在文档和章节，便于回查出处。'],
            ['混合检索', 'BM25 关键词匹配结合向量语义检索，专有术语和自然语言提问都能命中。'],
            ['结果融合排序', '合并两路检索结果重新排序，返回最相关的段落及其出处。'],
            ['增量更新', '只处理新增和修改的文档，移除已删除文档的片段，无需整体重建。'],
          ],
          output: '检索索引，保留在远端，Agent 通过 MCP 按问题查询相关段落。' } },
      { id: 'doc-extract', version: '0.1.0', cat: 'doc', name: '业务知识提取', desc: '从文档中提取业务规则、统一语言术语和数据字典。', input: 'docs', inputLabel: '1 个文档集', output: '业务知识文档', skill: true,
        update: '根据文档变化修订受影响的知识',
        prompt: '从所选文档集中提取业务规则、统一语言术语和数据字典，每条知识注明出处。',
        detail: { input: '必须提供 1 个文档集；需求、设计、接口说明和 ADR 越完整，提取的知识越准确。',
          abilities: [
            ['业务规则提取', '识别计算规则、约束条件和流程分支，整理成明确、可验证的规则描述。'],
            ['统一语言术语', '梳理领域术语、同义词和缩写，给出一致的定义，减少 Agent 的理解偏差。'],
            ['数据字典', '汇总业务实体、字段、取值范围和含义。'],
            ['出处追溯与增量修订', '每条知识注明来源文档；文档变化后只修订受影响的知识。'],
          ],
          output: '业务知识文档（Markdown），审阅后以 PR 提交到代码仓，Agent 开发时按需参考。' } },
      { id: 'miner-pr', version: '0.1.0', cat: 'code', name: '开发范式挖掘（PR）', desc: '分析已合并的 PR，总结可复用的开发范式。', input: 'repo+pr', inputLabel: '1 个代码仓和若干 PR', output: '开发范式库', skill: true, noUpdate: '每次运行归档新的范式',
        prompt: '总结所选 PR 体现的开发范式，归档到代码仓的开发范式库。',
        detail: { input: '必须提供 1 个代码仓和若干已合并的 PR；PR 的描述和评审讨论越完整，总结的范式越准确。',
          abilities: [
            ['变更意图理解', '结合 PR 描述、代码差异和代码仓上下文，理解每次变更要解决的问题。'],
            ['范式归纳', '从多次相似的变更中提炼分层结构、命名约定、错误处理等可复用做法。'],
            ['业务规则反推', '从代码变更中识别隐含的业务规则和边界条件。'],
            ['范式归档', '与已有范式去重合并，归档到开发范式库并重建 index.md。'],
          ],
          output: '开发范式库：每个范式一份文档，加上 index.md 索引；审阅后以 PR 提交到代码仓。' } },
      { id: 'miner-diff', version: '0.1.0', cat: 'code', name: '开发范式挖掘（代码片段）', desc: '结合代码仓上下文分析代码片段，总结开发范式。', input: 'repo+snippet', inputLabel: '1 个代码仓和代码片段', output: '开发范式库', skill: true, noUpdate: '每次运行归档新的范式',
        prompt: '总结所给代码片段体现的开发范式，归档到代码仓的开发范式库。',
        detail: { input: '必须提供 1 个代码仓和要分析的代码片段；代码仓提供上下文，帮助理解片段所在的模块和依赖。',
          abilities: [
            ['上下文关联', '定位片段在代码仓中的位置、调用方和依赖，理解它承担的职责。'],
            ['范式归纳', '提炼片段体现的实现方式，例如幂等处理、并发控制、校验与重试。'],
            ['适用条件说明', '写明范式适用的场景、前提和注意事项，避免被误用。'],
            ['范式归档', '与已有范式去重合并，归档到开发范式库并重建 index.md。'],
          ],
          output: '开发范式库：每个范式一份文档，加上 index.md 索引；审阅后以 PR 提交到代码仓。' } },
      { id: 'traj', version: '0.1.6', cat: 'traj', name: '轨迹洞察', desc: '从复杂的执行记录中梳理全貌、发现问题，沉淀可复用的经验与优化建议。', input: 'sessions', inputLabel: '1 到多个团队会话', output: '可视化诊断报告和改进方案', skill: true, noUpdate: '每次运行生成新的诊断',
        prompt: '诊断所选会话中 Agent 的过程错误，给出可复用的改进建议。',
        detail: { input: '必须提供 Session（会话轨迹）；可补充 Skill、相关文档、任务说明等，帮助深入诊断并形成更有针对性的建议。',
          abilities: [
            ['执行脉络重建', '串联任务、决策与行动，快速理解复杂过程。'],
            ['问题关联分析', '识别问题，追溯成因、影响与修复过程。'],
            ['模式与经验挖掘', '提炼重复出现的行为模式和有效做法。'],
            ['优化建议', '针对提示词、工具、Skill 和执行流程提出改进建议。'],
          ],
          output: '可交互的可视化诊断报告，以及具体的改进方案，包含修改建议、依据与验证方法；关键结论可追溯到原始证据。' } },
    ],
    tasks: [
      { id: 't-cg-java', projectId: PROJECT_ID, name: '', cap: 'codegraph', sources: [REPO_ID], schedule: { kind: 'daily', time: '02:00' }, mode: 'update', skipUnchanged: true, input: { from: 'b81d3e9', to: '4e1b7c2' }, status: 'success', lastRun: '2026-10-26 02:00', duration: '12 秒', artifact: 'a-cg-java', created: '2026-10-20 10:20' },
      { id: 't-docidx', projectId: PROJECT_ID, name: '', cap: 'doc-index', sources: [DOCSET_ID], schedule: { kind: 'daily', time: '02:30' }, mode: 'update', skipUnchanged: true, input: { from: '2026-10-26 10:00', to: '2026-10-27 09:05' }, status: 'success', lastRun: '2026-10-27 09:10', duration: '18 秒', artifact: 'a-docidx', created: '2026-10-26 10:12' },
      { id: 't-biz', projectId: PROJECT_ID, name: '', cap: 'doc-extract', sources: [DOCSET_ID], mode: 'update', input: { from: '2026-10-26 10:00', to: '2026-10-27 09:05' }, schedule: { kind: 'now' }, status: 'success', lastRun: '2026-10-27 09:31', duration: '6 分 12 秒', artifact: 'a-biz', created: '2026-10-25 22:24' },
      { id: 't-std', projectId: null, name: '', cap: 'doc-extract', sources: [STD_ID], schedule: { kind: 'now' }, status: 'success', lastRun: '2026-10-18 11:22', duration: '9 分 05 秒', artifact: 'a-std', created: '2026-10-18 11:13' },
      { id: 't-miner-errors', projectId: PROJECT_ID, name: '', cap: 'miner-pr', sources: [REPO_ID], prs: [12, 19, 35], schedule: { kind: 'now' }, status: 'success', lastRun: '2026-10-24 17:10', duration: '13 分 22 秒', artifact: 'a-miner', produced: 'a-miner', created: '2026-10-24 16:57' },
      { id: 't-miner-cashback', projectId: PROJECT_ID, name: '消费返现与奖励发放', cap: 'miner-diff', sources: [REPO_ID], mode: 'build', schedule: { kind: 'now' }, status: 'success', lastRun: '2026-10-27 11:06', duration: '8 分 12 秒', artifact: 'a-miner', produced: 'a-miner', created: '2026-10-27 11:04' },
      { id: 't-miner-idempotent', projectId: PROJECT_ID, name: '跨服务幂等入账与失败重试', cap: 'miner-diff', sources: [REPO_ID], mode: 'build', schedule: { kind: 'now' }, status: 'success', lastRun: '2026-10-27 17:44', duration: '9 分 26 秒', artifact: 'a-miner', produced: 'a-miner', created: '2026-10-27 17:42' },
      { id: 't-miner-eligibility', projectId: PROJECT_ID, name: '活动资格判定与有效期控制', cap: 'miner-diff', sources: [REPO_ID], mode: 'build', schedule: { kind: 'now' }, status: 'success', lastRun: '2026-10-27 17:50', duration: '7 分 48 秒', artifact: 'a-miner', produced: 'a-miner', created: '2026-10-27 17:48' },
      { id: 't-miner-lock', projectId: PROJECT_ID, name: '账户余额乐观锁更新', cap: 'miner-diff', sources: [REPO_ID], mode: 'build', schedule: { kind: 'now' }, status: 'success', lastRun: '2026-10-27 18:45', duration: '6 分 31 秒', artifact: 'a-miner', produced: 'a-miner', created: '2026-10-27 18:43' },
      { id: 't-miner-user', projectId: PROJECT_ID, name: '用户维护与删除保护', cap: 'miner-diff', sources: [REPO_ID], mode: 'build', schedule: { kind: 'now' }, status: 'success', lastRun: '2026-10-27 18:50', duration: '5 分 54 秒', artifact: 'a-miner', produced: 'a-miner', created: '2026-10-27 18:48' },
      { id: 't-traj', projectId: PROJECT_ID, name: '', cap: 'traj', sources: ['s-sessions'], sessions: [TRAJ_SESSION], schedule: { kind: 'now' }, status: 'success', lastRun: '2026-10-27 01:21', duration: '42 分 18 秒', artifact: 'a-traj', created: '2026-10-27 00:38' },
    ],
    // published: what developers see; draft: the latest run, waiting for review (revisions are added while reviewing).
    // basis: the source state the artifact was built from (a document version, or a commit for code).
    artifacts: [
      platinumCashbackPageArtifact(),
      ...fourRequirementArtifacts(1),
      ...fourRequirementArtifacts(2),
      { id: 'a-cg-java', projectId: PROJECT_ID, cap: 'codegraph', name: 'carddemo-java-1025 CodeGraph', desc: '查询 carddemo-java-1025 中类、方法的定义与调用关系。', sources: [REPO_ID], kind: 'index',
        stats: [], mcpName: 'codegraph',
        published: { version: 3, at: '2026-10-26 02:05', note: '同步代码变化：3 个新提交', delivery: 'cloud', agents: ['Code'], basis: { commit: '4e1b7c2' }, auto: true }, draft: null },
      { id: 'a-docidx', projectId: PROJECT_ID, cap: 'doc-index', name: '信用卡营销交付文档 RAG 检索', desc: '按问题检索信用卡营销交付文档中的相关段落。', sources: [DOCSET_ID], kind: 'index',
        stats: [['文档', '3'], ['片段', '146'], ['向量维度', '1,024']], mcpName: 'docs-rag',
        published: { version: 2, at: '2026-10-27 09:12', note: '同步文档变化：新增 1', delivery: 'cloud', agents: ['Code'], basis: { version: '2026-10-27 09:05' }, auto: true }, draft: null },
      { id: 'a-biz', projectId: PROJECT_ID, cap: 'doc-extract', name: '信用卡营销返现业务知识', desc: '业务规则目录、统一语言术语表和数据字典，每条注明出处。', sources: [DOCSET_ID], kind: 'files', folder: '业务知识',
        files: BIZ_FILES, skills: ['bank-domain-payments'], usage: '涉及返现规则、字段含义、术语或业务流程时先查阅',
        published: { version: 1, at: '2026-10-26 14:40', note: '首次发布', delivery: 'local', files: BIZ_FILES, basis: { version: '2026-10-26 10:00' },
          over: { 'doc-knowledge/业务规则目录.md': 'doc-knowledge-v1/业务规则目录.md' } },
        draft: { created: '2026-10-27 09:31', task: 't-biz', revisions: [], basis: { version: '2026-10-27 09:05' } } },
      { id: 'a-std', projectId: null, cap: 'doc-extract', name: '银行编码规范要点', desc: '分层、建模、接口与安全约定，以及五类检查规则。', sources: [STD_ID], kind: 'files', folder: '编码规范',
        files: STD_FILES, skills: ['dev-bank-coding-standards'], usage: '编写或评审代码时对照检查',
        published: { version: 1, at: '2026-10-18 14:02', note: '首次发布', delivery: 'local', agents: ['Code', 'Reviewer'], files: STD_FILES, basis: { version: '2026-10-12 10:00' } }, draft: null },
      { id: 'a-miner', projectId: PROJECT_ID, cap: 'miner-diff', name: 'carddemo-java-1025 开发范式', desc: '从已合并 PR 与代码片段挖掘的实现范式，含步骤、约束和示例代码。', sources: [REPO_ID], kind: 'files', folder: 'miner',
        specs: MINER_SPECS, files: minerFiles(MINER_SPECS), skills: ['find-reference-spec'], usage: '开发新需求或修改现有功能前，用 find-reference-spec 查找可参考的范式',
        published: { version: 2, at: '2026-10-27 18:50', note: '新增 5 个代码片段挖掘的开发范式，保留「统一错误码与异常处理」', delivery: 'local', specs: MINER_SPECS, files: minerFiles(MINER_SPECS) },
        history: [{ version: 1, specs: ['统一错误码与异常处理'] }], draft: null },
      // A diagnosis is not published: its suggestions are submitted as PRs one by one (server/pull-requests.ts).
      { id: 'a-traj', projectId: PROJECT_ID, cap: 'traj', name: '轨迹洞察：CardDemo 迁移与扩建（19 轮）', desc: '6 条问题链，3 条优化建议。', sources: ['s-sessions'], kind: 'diagnosis',
        sessions: [TRAJ_SESSION], topic: 'carddemo-19', files: ['trajectory/carddemo-19/轨迹诊断报告.html'],
        suggestions: ['change-01', 'change-02', 'change-03'].map(id => ({ id, status: 'pending' })),
        published: null, draft: { created: '2026-10-27 01:21', task: 't-traj', revisions: [], basis: null } },
    ],
    // Diagnosis reports in content/trajectory/<topic>/, each for the session it analysed.
    trajTopics: { 'carddemo-19': { title: 'CardDemo 迁移与扩建（19 轮）', session: TRAJ_SESSION } },
    // Project skill versions written directly by earlier demo builds; suggestions now go through PRs.
    skillVersions: [],
  };
}
