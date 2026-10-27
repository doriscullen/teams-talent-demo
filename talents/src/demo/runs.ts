// Simulated task runs. A run lasts `seconds`; its steps and log lines are revealed as time passes.
// Logs follow the real engines' output. Finishing a run produces (or updates) an artifact.
import type { Artifact, Draft, RunPlan, TalentsState, Task } from '../types.ts';
import { content } from '../content.ts';
import { hashId, now, uid, versionLabel } from './format.ts';
import { basisOf, capability, changesSince, latestVersion, minerFiles, session, source, sourceState } from './model.ts';
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

export function runPlan(st: TalentsState, t: Task): RunPlan {
  const src = source(st, t.sources[0]);
  const sid = hashId(t.id || 'task');
  const update = t.mode === 'update' && t.input;
  const ch = update && src ? changesSince(src, src.type === 'docs' ? { version: t.input!.from } : { commit: t.input!.from }) : null;
  if (t.cap === 'traj') {
    const ids = t.sessions ?? [], n = ids.length;
    const logs = ['• iCode：Code Agent 就绪，会话 ' + sid, '→ skill  session-trajectory-diagnosis', '读取 ' + n + ' 个会话的轨迹'];
    ids.slice(0, 6).forEach((id, i) => {
      const s = session(st, id);
      logs.push('[' + (i + 1) + '/' + n + '] ' + (s ? s.title : id) + '：还原 ' + (s ? s.turns : '') + ' 轮对话的因果链');
    });
    if (n > 6) logs.push('… 其余 ' + (n - 6) + ' 个会话');
    logs.push('定位过程错误：覆盖不全 2 处、验证错误 1 处、虚假完成声明 1 处', '→ write  轨迹诊断报告.html', '→ write  改进建议.md', '✓ Done，会话 ' + sid);
    return { seconds: Math.min(24, 10 + n * 2), steps: ['读取会话轨迹', '诊断过程错误', '生成报告与改进建议'], logs };
  }
  if (t.cap === 'codegraph') {
    const a = existingArtifact(st, t);
    return { seconds: 3, steps: ['读取演示快照', '展示归档统计'], logs: [
      '[codegraph] 演示使用已归档的真实扫描结果，不执行 init / sync。',
      ...(a?.stats ?? []).map(([label, value]) => `[codegraph] ${label}：${value}`),
      '[codegraph] 可在产物详情中浏览图谱；需要替换演示数据时手动导出新快照。',
    ] };
  }
  if (t.cap === 'doc-index') {
    const l1 = '[rag] 文档版本：' + versionLabel(latestVersion(src)) + '；上次构建：' + (update ? versionLabel(t.input!.from) : '无记录');
    const touched = ch ? (ch.added?.length ?? 0) + (ch.modified?.length ?? 0) : 0;
    return update
      ? { seconds: 7, steps: ['读取文档变化', '更新索引', '校验'], logs: [l1, '[rag] 文档变化：' + (ch?.text || '无'),
          '[rag] 切分 ' + touched + ' 个文档，生成 ' + touched * 46 + ' 个片段',
          '[rag] 计算向量：bge-m3，1,024 维', '[rag] 更新 BM25 倒排索引', ch?.removed?.length ? '[rag] 移除 ' + ch.removed.length + ' 个已删除文档的片段' : '[rag] 没有需要移除的片段',
          '[rag] 完成：索引校验通过，共 ' + src!.files + ' 个文档'] }
      : { seconds: 9, steps: ['读取文档', '构建索引', '校验'], logs: [l1, '[rag] 读取 ' + src!.files + ' 个文档', '[rag] 切分并生成 1,146 个片段',
          '[rag] 计算向量：bge-m3，1,024 维', '[rag] 建立 BM25 倒排索引', '[rag] 完成：索引校验通过'] };
  }
  if (t.cap === 'miner-pr' || t.cap === 'miner-diff') {
    const run = '.icode-knowledge/miner/.runs/' + hashId(sid, 8);
    const diff = t.cap === 'miner-diff';
    const lm = ['• iCode：Code Agent 就绪，会话 ' + sid, '→ skill  icode-' + t.cap, '→ script  icode-' + t.cap + '/scripts/prepare_input.py', '  ✓ 0.1s',
      diff ? '准备完成。读取场景描述与代码片段。' : '准备完成。先读取 PR 资料、模板和分析模板。'];
    if (t.prs) (t.prs).forEach(n => lm.push('→ read   ' + run + '/input/prs/' + n + '/description.md', '→ read   ' + run + '/input/prs/' + n + '/diff.patch'));
    else lm.push('→ read   ' + run + '/input/spec_desc.txt', '→ read   ' + run + '/input/snippets/snippets/01-*.patch', '→ read   ' + run + '/input/template.md');
    lm.push('→ resource  icode-' + t.cap + '/assets/analyzer_template.md', '需要补充上下文：读取相关服务的领域对象和应用服务。',
      '→ grep   class .*Service in services/', '→ read   services/marketing-service/src/main/java/com/carddemo/marketing/application/RewardEvaluationService.java',
      '→ write  ' + run + '/analyzer.md', '→ resource  icode-' + t.cap + '/assets/summarizer_template.md', '→ write  ' + run + '/summary.md',
      '→ write  ' + run + '/naming.json', '→ script  icode-' + t.cap + '/scripts/archive_spec.py', '  ✓ 0.1s',
      '✓ Done · 4m 19s · ' + (17 + (t.prs ?? []).length * 2) + ' tool calls · session ' + sid);
    return { seconds: 14, steps: diff ? ['准备输入', '分析代码片段', '总结并归档范式'] : ['准备输入', '分析代码变更', '总结并归档范式'], logs: lm };
  }
  // doc-extract (Skill)
  const names = t.sources.map(id => source(st, id)?.name ?? '');
  const le = ['• iCode：Code Agent 就绪，会话 ' + sid, '→ skill  doc-knowledge-extract', '→ script  doc-knowledge-extract/scripts/prepare_input.py', '  ✓ 0.2s'];
  if (update) {
    le.push('读取文档变化（' + versionLabel(t.input!.from) + ' → ' + versionLabel(t.input!.to) + '）：' + (ch?.text || '无变化'));
    [...(ch?.added ?? []), ...(ch?.modified ?? [])].forEach(f => le.push('→ read   ' + f));
    (ch?.removed ?? []).forEach(f => le.push('已删除：' + f + '，标出引用它的知识条目'));
    const prev = existingArtifact(st, t), outs = prev ? (prev.files ?? []).filter(f => !/index\.md$/.test(f)).map(f => f.split('/').pop()!) : [];
    if (src?.fromTeams) le.push('→ read   上一版 业务规则目录.md', '→ edit   业务规则目录.md：补充新增文档中的返现规则', '→ edit   统一语言术语表.md：补充新增术语', '→ edit   数据字典.md：补充新增字段');
    else outs.forEach(f => le.push('→ read   上一版 ' + f, '→ edit   ' + f + '：修订受这些文档影响的条目'));
  } else {
    le.push('读取 ' + names.join('、') + ' 的全部文档', '→ write  业务规则目录.md', '→ write  数据字典.md', '→ write  统一语言术语表.md');
  }
  le.push('✓ Done，会话 ' + sid);
  return { seconds: 12, steps: update ? ['读取文档变化', '修订受影响的知识', '整理产物'] : ['读取文档', '提取知识', '整理产物'], logs: le };
}

export function startRun(st: TalentsState, t: Task) {
  const src = source(st, t.sources[0]), a = existingArtifact(st, t), basis = a && basisOf(a);
  const at = sourceState(src);
  if (t.mode === 'update' && capability(st, t.cap).update && basis && at) t.input = { from: (basis.version ?? basis.commit)!, to: (at.version ?? at.commit)! };
  else delete t.input;
  t.status = 'running';
  t.run = { startedAt: Date.now(), plan: runPlan(st, t) };
  t.lastRun = now();
}

export interface Progress { pct: number; step: number; done: boolean; logs: string[] }
export function runProgress(t: Task, at = Date.now()): Progress {
  const r = t.run;
  if (!r) return { pct: 100, step: 99, done: true, logs: [] };
  const f = Math.min(1, (at - r.startedAt) / (r.plan.seconds * 1000));
  const steps = r.plan.steps.length;
  const logCount = Math.max(1, Math.ceil(f * r.plan.logs.length));
  return { pct: Math.round(f * 100), step: Math.min(steps - 1, Math.floor(f * steps)), done: f >= 1, logs: r.plan.logs.slice(0, logCount) };
}

export function finishRun(st: TalentsState, t: Task) {
  const r = t.run;
  t.status = 'success';
  if (r) { t.duration = Math.round(r.plan.seconds) + ' 秒'; t.lastLogs = r.plan.logs; }
  delete t.run;
  const a = produce(st, t);
  t.artifact = a.id;
  t.produced = a.id;
  return a;
}

/** The report of the diagnosed session (only sessions with a report can be diagnosed). */
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

/** Same capability on the same input -> a new draft version of that artifact; different input -> a new artifact. */
export function produce(st: TalentsState, t: Task): Artifact {
  const cap = capability(st, t.cap);
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
    a.name = '会话轨迹诊断：' + st.trajTopics[topic].title;
    a.desc = r ? r.chains + ' 条问题链，' + r.suggestions.length + ' 条优化建议。' : '';
    a.kind = 'diagnosis'; a.sessions = ids.slice(); a.topic = topic;
    a.files = ['trajectory/' + topic + '/轨迹诊断报告.html'];
    a.suggestions = (r?.suggestions ?? []).map(s => ({ id: s.id, status: 'pending' }));
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
