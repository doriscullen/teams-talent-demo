// Simulated task runs. A run lasts `seconds`; its steps and log lines are revealed as time passes.
// Logs follow the real engines' output (Talents engines/, the trajectory analyser in bank-report-handoff);
// nothing is executed. Finishing a run produces (or updates) an artifact.
import type { Artifact, Capability, Draft, RunPlan, Session, Source, TalentsState, Task } from '../types.ts';
import { content } from '../content.ts';
import { hashId, now, num, uid, versionLabel } from './format.ts';
import { basisOf, capability, changesSince, latestVersion, minerFiles, session, source, sourceState } from './model.ts';
import { engineOf, operationText } from './engine.ts';
import { report } from './suggestions.ts';


/** The artifact a run of this task would build or update (same level, same capability on the same input);
 *  every diagnosis run makes a new one. */
export function existingArtifact(st: TalentsState, t: Pick<Task, 'projectId' | 'cap' | 'sources' | 'sessions'>) {
  return st.artifacts.find(x => {
    if (x.projectId !== t.projectId) return false;
    if (x.cap !== t.cap && !(t.cap === 'miner-diff' && x.cap === 'miner-pr')) return false;
    if (t.cap === 'traj') return false;
    return x.sources[0] === t.sources[0];
  }) ?? null;
}

/** Builds a plan step by step: each step starts at the log line written next, so progress follows the log. */
function planner() {
  const steps: string[] = [], logs: string[] = [], marks: number[] = [];
  return {
    step(name: string) { steps.push(name); marks.push(logs.length); },
    log(...lines: string[]) { logs.push(...lines); },
    done(seconds: number): RunPlan { return { seconds, steps, logs, marks }; },
  };
}
const K = '[icode-knowledge]';
const short = (sha?: string | null) => (sha ?? '').slice(0, 7);
/** What Talents writes before handing over to the engine: the execution, the prepared source, the input file. */
function preamble(log: (...l: string[]) => void, cap: Capability, t: Task, src: Source | null, update: boolean) {
  const exec = hashId('exec:' + t.id + ':' + (t.lastRun ?? ''), 8);
  log(K + ' 执行 ' + exec + '：' + cap.name + (update ? ' 更新' : ' 构建') + (cap.version ? '（定义版本 ' + cap.version + '）' : ''));
  if (src?.type === 'repo') log(K + ' 准备代码仓 ' + src.name + '：切换到 ' + (src.branch ?? 'main') + '，快进拉取到 ' + short(src.commit?.sha));
  if (src?.type === 'docs') log(K + ' 检查文档来源 ' + src.name + '：' + (src.files ?? 0) + ' 个文件，使用 ' + versionLabel(latestVersion(src)) + ' 的快照');
  log(K + ' 写入输入文件 runs/' + exec + '/input.json');
  return exec;
}

export function runPlan(st: TalentsState, t: Task): RunPlan {
  const cap = capability(st, t.cap), src = source(st, t.sources[0]);
  const sid = hashId(t.id || 'task');
  const update = !!(t.mode === 'update' && t.input);
  const ch = update && src ? changesSince(src, src.type === 'docs' ? { version: t.input!.from } : { commit: t.input!.from }) : null;
  const p = planner();
  if (t.cap === 'traj') return trajPlan(st, t, sid);
  if (cap.custom) return customPlan(st, t, cap, src, update, sid);

  if (t.cap === 'codegraph') {
    const a = existingArtifact(st, t), stat = (label: string) => a?.stats?.find(s => s[0] === label)?.[1] ?? '';
    const P = '[icode-knowledge-codegraph]', repo = src?.path ?? '', sync = !!a;
    p.step('自检');
    preamble(p.log, cap, t, src, update);
    p.log(K + ' 自检：python3 scripts/run.py --check', P + ' 自检通过：codegraph 1.6.0（codegraph --version）');
    p.step(sync ? '同步代码图谱' : '建立代码图谱');
    p.log(P + ' 代码版本：分支 ' + (src?.branch ?? 'main') + '，提交 ' + short(src?.commit?.sha) + '；上次成功的构建或更新：' + (sync ? (t.input?.from ?? short(src?.commit?.sha)) : '无记录'));
    if (sync) p.log(P + ' 运行：codegraph sync ' + repo,
      'Detecting changes since last sync… ' + (ch?.count ? ch.count + ' commits, 14 files changed (11 modified, 3 added)' : 'no changes'),
      ...(ch?.count ? ['Re-parsing 14 files…', 'Updated 212 symbols, 486 references'] : []));
    else p.log(P + ' 运行：codegraph init ' + repo + ' --yes', 'Scanning files… ' + (stat('文件') || '412') + ' files', 'Parsing symbols… ' + (stat('节点') || '3,918') + ' nodes',
      'Resolving references… ' + (stat('关系') || '9,204') + ' edges', 'Index written to .codegraph/codegraph.db');
    p.step('校验索引');
    p.log(P + ' 运行：codegraph status ' + repo + ' --json',
      P + ' 完成：' + repo + ' 的索引已校验通过（' + (sync ? 'sync' : 'init') + '）。', K + ' 进程退出，退出码 0');
    return p.done(sync ? 6 : 9);
  }
  if (t.cap === 'doc-index') {
    const P = '[icode-knowledge-rag]', touched = ch ? (ch.added?.length ?? 0) + (ch.modified?.length ?? 0) : 0;
    p.step('自检');
    preamble(p.log, cap, t, src, update);
    p.log(K + ' 自检：python3 scripts/run.py --check', P + ' 自检通过：icode-docs-rag 0.4.2，向量模型 bge-m3 可用');
    p.step(update ? '处理变化的文档' : '切分并建立索引');
    p.log(P + ' 文档版本：' + versionLabel(latestVersion(src)) + '；上次构建：' + (update ? versionLabel(t.input!.from) : '无记录'));
    if (update) p.log(P + ' 文档变化：' + (ch?.text || '无'), P + ' 切分 ' + touched + ' 个文档，生成 ' + touched * 46 + ' 个片段',
      P + ' 计算向量：bge-m3，1,024 维，' + touched * 46 + ' 个片段', P + ' 更新 BM25 倒排索引',
      ch?.removed?.length ? P + ' 移除 ' + ch.removed.length + ' 个已删除文档的片段' : P + ' 没有需要移除的片段');
    else p.log(P + ' 读取 ' + (src?.files ?? 0) + ' 个文档', P + ' 按标题层级切分，生成 1,146 个片段', P + ' 计算向量：bge-m3，1,024 维', P + ' 建立 BM25 倒排索引');
    p.step('校验');
    p.log(P + ' 抽样 20 个问题回查：命中率 95%', P + ' 完成：索引校验通过，共 ' + (src?.files ?? 0) + ' 个文档', K + ' 进程退出，退出码 0');
    return p.done(update ? 7 : 9);
  }
  if (t.cap === 'miner-pr' || t.cap === 'miner-diff') {
    const diff = t.cap === 'miner-diff', skill = 'icode-' + t.cap, run = '.icode-knowledge/miner/.runs/' + hashId(sid, 8);
    const prs = (st.prs[t.sources[0]] ?? []).filter(x => t.prs?.includes(x.number));
    p.step('准备输入');
    preamble(p.log, cap, t, src, false);
    p.log('• iCode：' + agentName(st, t) + ' 就绪，会话 ' + sid, '→ skill  ' + skill, '→ script  ' + skill + '/scripts/prepare_input.py --input-file input.json', '  ✓ 0.1s',
      '  本次输入：', '  - 范式描述：' + (t.name || '未填写，在阶段三根据' + (diff ? '代码片段' : ' PR ') + '归纳'),
      '  - 代码仓：' + (src?.path ?? '') + '（分支 ' + (src?.branch ?? 'main') + '，提交 ' + short(src?.commit?.sha) + '）',
      ...(diff ? ['  - 代码片段：' + run + '/input/snippets/'] : ['  - PR：每个 PR 的输入在 ' + run + '/input/prs/<编号> 目录下',
        ...prs.map(x => '    - #' + x.number + '“' + x.title + '”')]),
      '  输出位置：运行目录 ' + run + '，产物目录 .icode-knowledge/miner');
    p.step(diff ? '分析代码片段' : '分析代码变更');
    if (diff) p.log('→ read   ' + run + '/input/spec_desc.txt', '→ read   ' + run + '/input/snippets/01-*.patch');
    else prs.forEach(x => p.log('→ read   ' + run + '/input/prs/' + x.number + '/description.md', '→ read   ' + run + '/input/prs/' + x.number + '/files.md', '→ read   ' + run + '/input/prs/' + x.number + '/diff.patch（第 1–240 行）'));
    p.log('→ resource  ' + skill + '/assets/analyzer_template.md', '需要补充上下文：读取相关服务的领域对象和应用服务。',
      '→ grep   class .*Service in services/', '→ read   services/marketing-service/src/main/java/com/carddemo/marketing/application/RewardEvaluationService.java',
      '→ write  ' + run + '/analyzer.md');
    p.step('总结并归档范式');
    p.log('→ resource  ' + skill + '/assets/summarizer_template.md', '→ write  ' + run + '/summary.md', '→ write  ' + run + '/naming.json',
      '→ script  ' + skill + '/scripts/archive_spec.py ' + run, '  ✓ 0.1s', '  已归档：.icode-knowledge/miner/' + (t.name || '<范式名称>'),
      '✓ Done · ' + (17 + prs.length * 3) + ' tool calls · session ' + sid, K + ' 进程退出，退出码 0');
    return p.done(14);
  }
  // doc-extract (Skill)
  p.step(update ? '读取文档变化' : '读取文档');
  preamble(p.log, cap, t, src, update);
  p.log('• iCode：' + agentName(st, t) + ' 就绪，会话 ' + sid, '→ skill  doc-knowledge-extract', '→ script  doc-knowledge-extract/scripts/prepare_input.py --input-file input.json', '  ✓ 0.2s',
    '  本次输入：文档集「' + (src?.name ?? '') + '」' + versionLabel(latestVersion(src)) + '，' + (src?.files ?? 0) + ' 个文件' + (update ? '；上一版产物和文档变化' : ''));
  if (update) {
    p.log('读取文档变化（' + versionLabel(t.input!.from) + ' → ' + versionLabel(t.input!.to) + '）：' + (ch?.text || '无变化'));
    [...(ch?.added ?? []), ...(ch?.modified ?? [])].forEach(f => p.log('→ read   ' + f));
    (ch?.removed ?? []).forEach(f => p.log('已删除：' + f + '，标出引用它的知识条目'));
    p.step('修订受影响的知识');
    const prev = existingArtifact(st, t), outs = prev ? (prev.files ?? []).filter(f => !/index\.md$/.test(f)).map(f => f.split('/').pop()!) : [];
    if (src?.fromTeams) p.log('→ read   上一版 业务规则目录.md', '→ edit   业务规则目录.md：补充新增文档中的返现规则', '→ edit   统一语言术语表.md：补充新增术语', '→ edit   数据字典.md：补充新增字段');
    else outs.forEach(f => p.log('→ read   上一版 ' + f, '→ edit   ' + f + '：修订受这些文档影响的条目'));
  } else {
    (src?.tree ?? []).flatMap(g => g.files.map(f => (g.dir ? g.dir + '/' : '') + f)).slice(0, 6).forEach(f => p.log('→ read   ' + f));
    p.step('提取知识');
    p.log('→ write  业务规则目录.md', '→ write  数据字典.md', '→ write  统一语言术语表.md');
  }
  p.step('整理产物');
  p.log('→ write  index.md', '✓ Done，会话 ' + sid, K + ' 进程退出，退出码 0');
  return p.done(12);
}
const agentName = (st: TalentsState, t: Task) => st.agents.find(a => a.id === (t.agent ?? st.agents[0]?.id))?.name ?? 'Code Agent';

// ---------- 轨迹洞察 ----------
// The analyser (icode-traj-logic-analyser, recipe generalization-zh-vis) unfolds each session, parses it into spans,
// compresses and labels them, generalises the trace with an evidence ledger, then diagnoses and renders the report.
// The prepared session has the numbers of its real run; other sessions get numbers in proportion to their size.
const REAL = { spans: 1558, raw: 2155, delegations: 27, truncated: 353, leaves: 1512, mechanical: 1361, batches: 137, stages: 3, evidence: 2824, links: 3749, nodes: 628, reviewed: 133 };
function trajNumbers(st: TalentsState, s: Session | null) {
  if (s && Object.values(st.trajTopics).some(x => x.session === s.id)) return REAL;
  const spans = Math.max(180, Math.round((s?.messages || (s?.turns ?? 20) * 12) * 2.4)), leaves = Math.round(spans * 0.97);
  return { spans, raw: Math.round(spans * 1.38), delegations: Math.round((s?.turns ?? 20) / 4), truncated: Math.round(spans * 0.22), leaves, mechanical: Math.round(leaves * 0.9),
    batches: Math.ceil(leaves / 11), stages: Math.min(6, 2 + Math.round((s?.turns ?? 20) / 30)), evidence: Math.round(spans * 1.8), links: Math.round(spans * 2.4), nodes: Math.round(spans * 0.4), reviewed: Math.round(spans * 0.085) };
}
function trajPlan(st: TalentsState, t: Task, sid: string): RunPlan {
  const p = planner(), ids = t.sessions ?? [], n = ids.length, cap = capability(st, 'traj');
  const ws = 'runs/' + hashId('exec:' + t.id + ':' + (t.lastRun ?? ''), 8) + '/ch-traj-proprocess';
  const sessions = ids.map(id => session(st, id)), all = sessions.map(s => trajNumbers(st, s));
  const total = (k: keyof typeof REAL) => num(all.reduce((sum, x) => sum + x[k], 0));
  const r = report(trajTopic(st, ids)), ctx = t.context;
  const skills = (ctx?.skills ?? []).map(id => st.projects.flatMap(x => x.skills).find(s => s.id === id)?.name ?? id);
  const docs = (ctx?.docs ?? []).map(id => source(st, id)?.name ?? id);

  p.step('读取会话轨迹');
  preamble(p.log, cap, t, null, false);
  p.log('• iCode：' + agentName(st, t) + ' 就绪，会话 ' + sid, '→ skill  icode-traj-logic-analyser 0.1.6',
    '→ script  scripts/run.py preflight --workspace ' + ws, '  分析模型：deepseek/deepseek-v4.1-flash（标注、归纳、中文化）；分析推理：关闭；配置来源：宿主连接',
    '→ script  scripts/run.py raw sessions/ --recipe generalization-zh-vis --parser chrys --llm-concurrency 4 --background',
    '  任务已启动：' + ws + '/jobs/' + hashId(sid, 6) + '；进度页 status.html',
    '读取 ' + n + ' 个会话' + (ctx && (skills.length || docs.length || ctx.note) ? '；补充材料：' + [skills.length && 'Skill ' + skills.join('、'), docs.length && '文档 ' + docs.join('、'), ctx.note && '任务说明'].filter(Boolean).join('，') : ''));
  // Sessions are processed four at a time; the log names the first few.
  sessions.slice(0, 3).forEach((s, i) => p.log('[ingest.session_unfold] [' + (i + 1) + '/' + n + '] ' + (s?.title ?? ids[i]) + '：' + (s?.turns ?? '') + ' 轮，展开压缩历史，委派子任务 ' + all[i].delegations + ' 次'));
  if (n > 3) p.log('[ingest.session_unfold] [' + n + '/' + n + '] 其余 ' + (n - 3) + ' 个会话展开完成，委派子任务共 ' + num(all.slice(3).reduce((sum, x) => sum + x.delegations, 0)) + ' 次');
  p.step('解析与压缩');
  p.log('[ingest.unified_parsing] 原始 span ' + total('raw') + ' 个，进入分析 ' + total('spans') + ' 个（工具调用、消息、委派）',
    '[enrich.compression] 智能截断 ' + total('truncated') + ' 处；去重系统提示词，保留原文引用');
  p.step('行为标注');
  const batches = all.reduce((sum, x) => sum + x.batches, 0);
  p.log('[enrich.label_summary] 叶子节点 ' + total('leaves') + ' 个：机械操作 ' + total('mechanical') + ' 个，认知或待判 ' + num(all.reduce((s, x) => s + x.leaves - x.mechanical, 0)) + ' 个',
    ...[1, 2, 3].map(k => '[enrich.label_summary] 认知标注 批次 ' + Math.round(batches * k / 3) + '/' + batches + (k === 3 ? '，失败 0，重试 0' : '')));
  p.step('轨迹归纳与证据认证');
  p.log('[enrich.trace_generalization] 执行阶段 ' + total('stages') + ' 个；证据节点 ' + total('evidence') + ' 个，证据链接 ' + total('links') + ' 条',
    '[enrich.trace_generalization] 证据账本校验通过，认证状态 certified（schema 4.0）', '[enrich.generalization_zh] 中文化完成：首译 1 轮，补译 0 个字段');
  p.step('诊断分析');
  p.log('[diagnosis.prepare] 逻辑节点 ' + total('nodes') + ' 个' + (skills.length || docs.length ? '；绑定补充材料 ' + (skills.length + docs.length) + ' 份' : ''),
    '[diagnosis.review] 逐项细查 ' + total('reviewed') + ' 个节点，对照完成声明、测试与证据',
    '[diagnosis.chains] 问题链 ' + (r?.chains ?? 0) + ' 条：验证类 3、实现与验证类 2、实现类 1',
    '[diagnosis.improvements] 优化建议 ' + (r?.suggestions.length ?? 0) + ' 条：Skill 1、提示词 1、工具 1');
  p.step('生成报告');
  p.log('[report] 渲染 轨迹诊断报告.html：执行脉络、问题链、模式与经验、优化建议', '[report] 数据契约校验通过；关键结论均链接到原始证据',
    '✓ Done · ' + (n > 1 ? n + ' 个会话' : '1 个会话') + ' · session ' + sid, K + ' 进程退出，退出码 0');
  return p.done(Math.min(30, 18 + n * 2));
}

// ---------- Imported capabilities ----------
function customPlan(st: TalentsState, t: Task, cap: Capability, src: Source | null, update: boolean, sid: string): RunPlan {
  const p = planner(), e = engineOf(cap), op = (update ? e?.update : null) ?? e?.build, P = '[' + cap.id + ']';
  const out = (src?.type === 'repo' && Object.values(e?.output ?? {})[0]?.relativeTo === 'repository' ? src.path + '/' : '') + (cap.outputPath ?? '');
  const values = Object.entries(t.params ?? {}).filter(([, v]) => v !== '' && !(Array.isArray(v) && !v.length));
  p.step('自检');
  preamble(p.log, cap, t, src, update);
  const pkg = (text: string) => text.replace('${inputFile.path}', 'input.json').replace(/\$\{package\.root\}/g, '<定义包>');
  if (e?.check) p.log(K + ' 自检：' + pkg(operationText(e.check)), P + ' 自检通过');
  else p.log(K + ' 这个能力没有声明自检');
  p.step(update ? '更新' : '构建');
  if (op?.skill) p.log('• iCode：' + agentName(st, t) + ' 就绪，会话 ' + sid, '→ skill  ' + op.skill.name, '→ read   input.json');
  else p.log(K + ' 运行：' + pkg(operationText(op)));
  p.log(P + ' 输入：' + (src?.name ?? '') + (values.length ? '；' + values.map(([k, v]) => k + ' = ' + (Array.isArray(v) ? v.join('、') : v)).join('；') : ''));
  if (cap.id === 'db-schema') p.log(P + ' 读取 Flyway 迁移脚本 42 个、JPA 实体 86 个', P + ' 还原表 86 张、字段 1,204 个、外键 97 个、索引 213 个',
    P + ' 比对实体与迁移脚本：3 处字段类型不一致，已在索引中标注');
  else p.log(P + ' 处理来源…', P + ' 写入 ' + out);
  p.step('校验产物');
  p.log(P + ' 完成：产物写入 ' + out, op?.skill ? '✓ Done，会话 ' + sid : '', K + ' 进程退出，退出码 0');
  return p.done(10);
}
const DB_SCHEMA_STATS: [string, string][] = [['表', '86'], ['字段', '1,204'], ['外键', '97']];

export function startRun(st: TalentsState, t: Task) {
  const src = source(st, t.sources[0]), a = existingArtifact(st, t), basis = a && basisOf(a);
  const at = sourceState(src);
  if (t.mode === 'update' && capability(st, t.cap).update && basis && at) t.input = { from: (basis.version ?? basis.commit)!, to: (at.version ?? at.commit)! };
  else delete t.input;
  t.status = 'running';
  t.lastRun = now();
  t.run = { startedAt: Date.now(), plan: runPlan(st, t) };
}

export interface Progress { pct: number; step: number; done: boolean; logs: string[] }
export function runProgress(t: Task, at = Date.now()): Progress {
  const r = t.run;
  if (!r) return { pct: 100, step: 99, done: true, logs: [] };
  const f = Math.min(1, (at - r.startedAt) / (r.plan.seconds * 1000));
  const steps = r.plan.steps.length;
  const logCount = Math.max(1, Math.ceil(f * r.plan.logs.length));
  // A plan with marks is in the step whose first log line was written last.
  const step = r.plan.marks ? Math.max(0, r.plan.marks.filter(m => m < logCount).length - 1) : Math.min(steps - 1, Math.floor(f * steps));
  return { pct: Math.round(f * 100), step, done: f >= 1, logs: r.plan.logs.slice(0, logCount).filter(Boolean) };
}
const seconds = (ms: number) => { const s = Math.max(1, Math.round(ms / 1000)); return s < 60 ? s + ' 秒' : Math.floor(s / 60) + ' 分 ' + String(s % 60).padStart(2, '0') + ' 秒'; };

/** Stops a running task: nothing is produced. A one-off task ends with it; a daily task runs again at its time. */
export function cancelRun(t: Task, by: string) {
  const r = t.run;
  if (r) { const p = runProgress(t); t.lastLogs = [...p.logs, K + ' 已取消：' + by + ' 在“' + r.plan.steps[p.step] + '”时取消了这次运行，产物没有改动']; t.duration = seconds(Date.now() - r.startedAt); }
  t.status = 'cancelled';
  delete t.run; delete t.produced; delete t.unchanged;
}

export function finishRun(st: TalentsState, t: Task) {
  const r = t.run;
  t.status = 'success';
  if (r) { t.duration = Math.round(r.plan.seconds) + ' 秒'; t.lastLogs = r.plan.logs.filter(Boolean); }
  delete t.run;
  const a = produce(st, t);
  if (a) { t.artifact = a.id; t.produced = a.id; } else delete t.produced;
  return a;
}

/** The report of the diagnosed session; sessions without a prepared report all get the first one. */
function trajTopic(st: TalentsState, ids: string[]) {
  return Object.keys(st.trajTopics).find(k => ids.includes(st.trajTopics[k].session)) ?? Object.keys(st.trajTopics)[0];
}
// Indexes are not reviewed after their first publish: each later run publishes itself, and an update that
// finds no change keeps the current version.
function autoPublish(st: TalentsState, a: Artifact, t: Task) {
  const src = source(st, t.sources[0]), p = a.published!;
  const c = t.mode === 'update' && t.input ? changesSince(src, src?.type === 'docs' ? { version: t.input.from } : { commit: t.input.from }) : null;
  t.unchanged = !!(c && !c.count);
  if (!t.unchanged) {
    a.published = { version: p.version + 1, at: now(), delivery: p.delivery, agents: p.agents, basis: a.draft!.basis, auto: true,
      note: c ? (src?.type === 'docs' ? '同步文档变化：' : '同步代码变化：') + c.text : '重新构建' };
  }
  a.draft = null;
}

/** Same capability on the same input -> a new draft version of that artifact; different input -> a new artifact.
 *  An imported capability without an MCP entry only writes its output directory: nothing to review. */
export function produce(st: TalentsState, t: Task): Artifact | null {
  const cap = capability(st, t.cap);
  if (cap.custom && !cap.mcp) return null;
  let a = existingArtifact(st, t);
  if (a?.id === 'a-cg-java') { t.unchanged = true; return a; }
  const draft: Draft = { created: now(), task: t.id, revisions: [], basis: sourceState(source(st, t.sources[0])) };
  if (a) {
    if (a.folder === 'miner') {
      const map: Record<string, string> = JSON.parse(content('miner/pr-map.json') ?? '{}');
      const base = (a.draft ? a.specs : a.published?.specs) ?? [];
      // PR mode: the selected PRs name the specs to add; diff mode: the task name is the spec.
      const add = t.prs ? t.prs.map(n => map[n]).filter(Boolean) : (t.name && t.name !== base[base.length - 1] ? [t.name] : []);
      a.specs = base.concat(add.filter((n, i) => !base.includes(n) && add.indexOf(n) === i));
      a.files = minerFiles(a.specs);
    }
    a.draft = draft;
    if (a.kind === 'index' && a.published) autoPublish(st, a, t);
    return a;
  }
  const src = source(st, t.sources[0])!;
  a = { id: uid('a'), projectId: t.projectId, cap: cap.id, sources: t.sources.slice(), published: null, draft, name: '', desc: '', kind: 'files' };
  if (t.cap === 'traj') {
    // A diagnosis: the report and its suggestions, each applied or declined on its own (see suggestions.ts).
    const ids = t.sessions ?? [], topic = trajTopic(st, ids), r = report(topic);
    a.name = '轨迹洞察：' + st.trajTopics[topic].title;
    a.desc = r ? r.chains + ' 条问题链，' + r.suggestions.length + ' 条优化建议。' : '';
    a.kind = 'diagnosis'; a.sessions = ids.slice(); a.topic = topic;
    a.files = ['trajectory/' + topic + '/轨迹诊断报告.html'];
    a.suggestions = (r?.suggestions ?? []).map(s => ({ id: s.id, status: 'pending' }));
  } else if (cap.custom) {
    a.name = src.name + ' ' + cap.name;
    a.desc = cap.desc;
    a.kind = 'index';
    a.stats = cap.id === 'db-schema' ? DB_SCHEMA_STATS : [['产物目录', cap.outputPath ?? '']];
    a.mcpName = engineOf(cap)?.applications?.[0]?.command ?? cap.id;
  } else if (cap.cat === 'index') {
    a.name = src.name + (cap.id === 'codegraph' ? ' CodeGraph' : ' RAG 检索');
    a.desc = cap.id === 'codegraph' ? '查询 ' + src.name + ' 中的代码定义与调用关系。' : '按问题检索 ' + src.name + ' 中的相关段落。';
    a.kind = 'index';
    a.stats = cap.id === 'codegraph' ? [] : [['文档', String(src.files || 30)], ['片段', '1,402'], ['向量维度', '1,024']];
    a.mcpName = cap.id === 'codegraph' ? 'codegraph' : 'docs-rag';
  } else if (cap.cat === 'doc') {
    a.name = src.name + ' 业务知识';
    a.desc = '从「' + src.name + '」提取的业务规则、术语和数据字典。';
    a.folder = '业务知识';
    a.files = ['doc-knowledge/index.md', 'doc-knowledge/业务规则目录.md', 'doc-knowledge/统一语言术语表.md', 'doc-knowledge/数据字典.md'];
    a.skills = ['bank-domain-payments'];
    a.usage = '涉及业务规则、字段含义、术语或业务流程时先查阅';
  } else {
    const map: Record<string, string> = JSON.parse(content('miner/pr-map.json') ?? '{}');
    a.specs = (t.prs ?? []).map(n => map[n]).filter((n, i, arr) => n && arr.indexOf(n) === i);
    if (!a.specs.length && t.name) a.specs = [t.name];
    if (!a.specs.length) a.specs = ['消费返现与奖励发放'];
    a.name = src.name + ' 开发范式';
    a.desc = '从代码变更或代码片段总结的实现范式，含步骤、约束和示例代码。';
    a.folder = 'miner';
    a.files = minerFiles(a.specs);
    a.skills = ['find-reference-spec'];
    a.usage = '开发新需求或修改现有功能前，用 find-reference-spec 查找可参考的范式';
  }
  st.artifacts.unshift(a);
  return a;
}
