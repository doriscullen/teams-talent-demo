// Knowledge artifacts: versions (published / original draft / current revision), file contents, diff,
// and what applying to iCode would write on the developer's machine.
import type { Artifact, Scope, TalentsState } from '../types.ts';
import { content, skillTree } from '../content.ts';
import { agent, levelName, projectRepos, source } from './model.ts';
import { RULES_FILE, rulesAt, rulesMarkdown } from './suggestions.ts';

const TALENTS_HOME = '~/.icode-talents';
const SKILL_DIRS = { chrys: '~/.chrys/skills', agents: '~/.agents/skills' };
const TEAM_MCP = 'talents-team';

export type Which = 'published' | 'original' | 'current';
export const isIndex = (a: Artifact) => a.kind === 'index';
export const kind = (a: Artifact) => a.kind === 'index' ? 'mcp' : a.cap === 'traj' ? 'memory' : 'skill';
export const kindLabel = { mcp: '在线查询（MCP）', skill: 'Skill', memory: '项目规则' };
export const deliveryLabel = { local: '同步到本地', cloud: '云端查询' };
/** The agents published knowledge is meant for (Published.agents). */
export const audienceText = (st: TalentsState, agents?: string[]) => agents ? agents.map(id => agent(st, id)?.name ?? id).join('、') : '全部智能体';
export function status(a: Artifact) {
  if (a.published && a.draft) return 'update';
  if (a.published) return 'published';
  return 'draft';
}

// ---------- Files and versions ----------
export const files = (a: Artifact, which: Which) => which === 'published' && a.published ? (a.published.files ?? a.files ?? []) : (a.files ?? []);
export const specsOf = (a: Artifact, which: Which) => which === 'published' && a.published ? (a.published.specs ?? a.specs) : a.specs;
export function minerIndex(specs: string[] = []) {
  const text = content('miner/index.md') ?? '';
  const rows: Record<string, string> = {};
  text.split(/\r?\n/).forEach(l => { const m = /^\|\s*\[([^\]]+)\]/.exec(l); if (m) rows[m[1]] = l; });
  const head = text.split(/\r?\n/).filter(l => /^#|^>/.test(l)).join('\n');
  return head + '\n\n| 名称 | 描述 | 首次归档时间 |\n| --- | --- | --- |\n' + specs.map(n => rows[n] ?? '| [' + n + '](<./' + n + '/summary.md>) | — | — |').join('\n') + '\n';
}
function baseText(a: Artifact, which: Which, key: string) {
  if (key === 'miner/index.md') return minerIndex(specsOf(a, which));
  if (key === RULES_FILE) return rulesMarkdown(rulesAt(a, which === 'published' ? a.published?.version : undefined));
  const over = which === 'published' ? a.published?.over?.[key] : undefined;
  if (over) return typeof over === 'string' ? content(over) : over.text;
  return content(key);
}
/** which: 'published' | 'original' (as the capability produced it) | 'current' (after revisions) */
export function text(a: Artifact, which: Which, key: string) {
  if (which === 'current' && a.draft) {
    for (let i = a.draft.revisions.length - 1; i >= 0; i--) if (a.draft.revisions[i].file === key) return a.draft.revisions[i].text;
  }
  return baseText(a, which === 'published' ? 'published' : 'original', key);
}
export function fileLabel(key: string) {
  if (key === RULES_FILE) return 'AGENTS.md 规则';
  const parts = key.split('/');
  const name = parts.pop()!;
  if (name === 'summary.md') return '范式总结';
  if (name === 'analyzer.md') return '代码分析报告';
  if (name === 'metadata.json') return 'PR #' + parts.pop();
  if (name === 'meta.json') return parts[1] ? parts[1] + '：挖掘元数据' : '挖掘元数据';
  if (name === 'index.md') return parts[0] === 'miner' ? '范式索引' : '索引';
  return name.replace(/\.(md|html)$/, '');
}
/** Miner artifacts list files per spec: 范式总结, 代码分析报告, then PR records (PR mode) or mining metadata (diff mode). */
export function fileGroups(a: Artifact, list: string[]) {
  if (a.folder !== 'miner') return [{ title: '', items: list }];
  const groups: { title: string; items: string[] }[] = [{ title: '', items: list.filter(f => f === 'miner/index.md') }], by: Record<string, { title: string; items: string[] }> = {};
  list.forEach(f => {
    const m = /^miner\/([^/]+)\//.exec(f);
    if (!m) return;
    if (!by[m[1]]) { by[m[1]] = { title: m[1], items: [] }; groups.push(by[m[1]]); }
    by[m[1]].items.push(f);
  });
  return groups;
}

// ---------- Diff ----------
export type DiffOp = [' ' | '+' | '-', string];
export function diffLines(oldText: string | null, newText: string | null): DiffOp[] {
  const a = oldText ? oldText.split(/\r?\n/) : [], b = (newText ?? '').split(/\r?\n/);
  const n = a.length, m = b.length;
  const dp: Int32Array[] = [];
  for (let i = 0; i <= n; i++) dp.push(new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops: DiffOp[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push([' ', a[i]]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push(['-', a[i]]); i++; }
    else { ops.push(['+', b[j]]); j++; }
  }
  while (i < n) ops.push(['-', a[i++]]);
  while (j < m) ops.push(['+', b[j++]]);
  return ops;
}

// ---------- Applying on the developer's machine ----------
/** Local clones of this artifact's project code repositories; none for team-level knowledge. */
export function localRepos(st: TalentsState, a: Artifact) {
  const repoIds = a.projectId ? projectRepos(st, a.projectId).map(r => r.id) : [];
  return st.dev.local.filter(l => l.type === 'repo' && l.repo && repoIds.includes(l.repo));
}
/** Why a scope kind is unavailable for this artifact; empty when it can be chosen. */
export function scopeOptions(st: TalentsState, a: Artifact) {
  const k = kind(a);
  return {
    repo: k === 'mcp' ? '索引通过智能体的在线查询使用，只能应用到指定智能体' : (localRepos(st, a).length ? '' : '本机还没有这个项目的代码仓'),
    global: k === 'mcp' ? '索引通过智能体的在线查询使用，只能应用到指定智能体' : k === 'memory' ? '项目规则只能写入代码仓或指定智能体' : '',
    agent: '',
  };
}
/** Where one-click apply puts the knowledge: the agents the admin meant it for; otherwise the project's local
 *  repositories, falling back to every agent (team knowledge has no repositories). */
export function defaultScope(st: TalentsState, a: Artifact): Scope {
  const k = kind(a), meant = a.published?.agents, every = st.agents.map(g => g.id);
  if (meant) return { kind: 'agent', agents: meant };
  if (k === 'mcp') return { kind: 'agent', agents: every };
  const repos = localRepos(st, a);
  if (repos.length) return { kind: 'repo', repos: repos.map(r => r.repo!) };
  return k === 'memory' ? { kind: 'agent', agents: every } : { kind: 'global', dir: 'chrys' };
}
function localPath(st: TalentsState, repoId: string) {
  return st.dev.local.find(x => x.repo === repoId)?.path ?? source(st, repoId)?.path ?? repoId;
}
export function scopeText(st: TalentsState, scope: Scope) {
  if (scope.kind === 'repo') return scope.repos.map(id => source(st, id)?.name ?? id).join('、');
  if (scope.kind === 'global') return '所有智能体';
  return scope.agents.map(id => agent(st, id)?.name ?? id).join('、');
}
export function sentence(st: TalentsState, a: Artifact, scope: Scope) {
  const k = kind(a), target = scopeText(st, scope);
  if (k === 'mcp') return '在 ' + target + ' 中可以在线查询「' + a.name + '」。';
  if (k === 'memory') return '把 ' + rulesAt(a, a.published?.version).length + ' 条项目规则写入 ' + target + (scope.kind === 'repo' ? ' 的 AGENTS.md。' : ' 的记忆。');
  const how = a.published?.delivery === 'cloud' ? '在线查询' : '同步到本机';
  return '「' + a.name + '」' + how + '，在 ' + target + ' 中可用' + (a.skills ? '，配套 Skill「' + a.skills.join('、') + '」' : '') + '。';
}
const block = (title: string, lines: string[]) =>
  ['<!-- icode-talents:begin -->', '## ' + title + '（由 iCode Talents 维护）', ...lines, '<!-- icode-talents:end -->'].map(l => '+ ' + l);
const mcpLines = () => ['tools:', '  mcp:', '+   - name: ' + TEAM_MCP, '+     transport: http', '+     url: https://talents.bank.local/mcp', '+     headers:', '+       Authorization: "Bearer {{TALENTS_TOKEN}}"'];
function specLines(a: Artifact) {
  if (a.folder !== 'miner') return files(a, 'published').map(f => f.split('/').slice(-2).join('/'));
  return ['index.md', ...(specsOf(a, 'published') ?? []).map(n => n + '/（范式总结、代码分析报告、PR 资料）')];
}
export interface FileChange { path: string; verb: '新增' | '更新'; lines: string[] }
/** The files applying the artifact with this scope writes; lines starting with + are added. */
export function changes(st: TalentsState, a: Artifact, scope: Scope): FileChange[] {
  const out = new Map<string, FileChange>();
  const add = (path: string, verb: FileChange['verb'], lines: string[] = []) => {
    const f = out.get(path) ?? { path, verb, lines: [] };
    f.lines = f.lines.concat(lines);
    out.set(path, f);
  };
  let knowledgeDir = TALENTS_HOME + '/knowledge/' + levelName(st, a.projectId) + '/' + (a.folder ?? '') + '/';
  const cloud = !a.published || a.published.delivery === 'cloud' || isIndex(a);
  const agents = scope.kind === 'agent' ? scope.agents : st.agents.map(g => g.id);
  const k = kind(a);
  const where = cloud ? '通过 MCP 工具 `' + TEAM_MCP + '.search` 查询（知识：' + a.name + '）' : '`' + knowledgeDir + '`';
  let line = '- ' + a.name + '：' + where + '。' + (a.usage ?? a.desc) + (a.skills ? '；配套 Skill ' + a.skills.join('、') + '。' : '');

  if (cloud) agents.forEach(g => add('~/.chrys/agents/' + g + '.yaml', '更新', mcpLines()));
  const inRepo = a.folder === 'miner' && scope.kind === 'repo';
  if (inRepo) {
    knowledgeDir = '<代码仓>/.icode-knowledge/miner/';
    line = '- ' + a.name + '：`.icode-knowledge/miner/`（先读 index.md）。' + (a.usage ?? a.desc) + '。';
  }
  if (!cloud && k !== 'memory' && !inRepo) add(knowledgeDir, '新增', specLines(a));

  if (k === 'memory') {
    const ruleLines = rulesAt(a, a.published?.version).map(r => '- ' + r.text);
    if (scope.kind === 'repo') scope.repos.forEach(rid => add(localPath(st, rid) + '/AGENTS.md', '更新', block('项目规则', ruleLines)));
    else {
      add(TALENTS_HOME + '/memory/项目规则.md', '新增', ruleLines.map(l => '+ ' + l));
      agents.forEach(g => add('~/.chrys/agents/' + g + '.yaml', '更新', ['memory:', '  files:', '+   - ' + TALENTS_HOME + '/memory/项目规则.md']));
    }
  } else if (scope.kind === 'repo') {
    scope.repos.forEach(rid => {
      const root = localPath(st, rid);
      if (inRepo && !cloud) add(root + '/.icode-knowledge/miner/', '新增', specLines(a));
      (a.skills ?? []).forEach(sk => add(root + '/.agents/skills/' + sk + '/', '新增', ['Skill，' + skillTree(sk).length + ' 个文件']));
      add(root + '/AGENTS.md', '更新', block('项目知识', [line]));
    });
  } else {
    const skillRoot = scope.kind === 'global' ? SKILL_DIRS[scope.dir] : TALENTS_HOME + '/skills';
    (a.skills ?? []).forEach(sk => add(skillRoot + '/' + sk + '/', '新增', ['Skill，' + skillTree(sk).length + ' 个文件']));
    add(TALENTS_HOME + '/knowledge-index.md', '更新', ['+ ' + line]);
    agents.forEach(g => {
      let lines: string[] = [];
      if (scope.kind === 'agent' && a.skills) lines = lines.concat(['skills:', '  paths:'], a.skills.map(sk => '+   - ' + skillRoot + '/' + sk));
      lines = lines.concat(['memory:', '  files:', '+   - ' + TALENTS_HOME + '/knowledge-index.md']);
      add('~/.chrys/agents/' + g + '.yaml', '更新', lines);
    });
  }
  // Agent configs collect lines from several steps; keep each line once.
  for (const f of out.values()) if (/\.yaml$/.test(f.path)) f.lines = [...new Set(f.lines)];
  return [...out.values()];
}
