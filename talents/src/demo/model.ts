// Lookups and source changes over the client state.
import type { Artifact, Basis, Capability, Source, TalentsState, Task } from '../types.ts';
import { content } from '../content.ts';

const byId = <T extends { id: string }>(list: T[], id: string | null | undefined) => list.find(x => x.id === id) ?? null;
export const source = (st: TalentsState, id: string | null | undefined) => byId(st.sources, id);
export const capability = (st: TalentsState, id: string) => byId(st.capabilities, id) as Capability;
export const task = (st: TalentsState, id: string | null | undefined) => byId(st.tasks, id);
export const artifact = (st: TalentsState, id: string | null | undefined) => byId(st.artifacts, id);
export const session = (st: TalentsState, id: string) => byId(st.sessions, id);
export const project = (st: TalentsState, id: string | null | undefined) => byId(st.projects, id);
export const agent = (st: TalentsState, id: string) => byId(st.agents, id);
export const member = (st: TalentsState, id: string) => byId(st.team.members, id);
export const memberName = (st: TalentsState, id: string, fallback?: string) => member(st, id)?.name ?? fallback ?? id;

// ---------- Team and project levels ----------
// A level is a project id, or null for the team. Sources, tasks and artifacts each belong to one level.
export const levelName = (st: TalentsState, pid: string | null) => pid ? project(st, pid)?.name ?? pid : '团队';
/** Repositories and document sets of the level. */
export const levelSources = (st: TalentsState, pid: string | null) => st.sources.filter(s => s.type !== 'sessions' && (s.projectId ?? null) === pid);
export const projectRepos = (st: TalentsState, pid: string) => levelSources(st, pid).filter(s => s.type === 'repo');
/** Sessions a task of the level can analyse: the project's, or at team level those of every project. */
export const levelSessions = (st: TalentsState, pid: string | null) => pid ? st.sessions.filter(s => s.projectId === pid) : st.sessions;

/** Files of a development-pattern library: index, then per spec 范式总结, 代码分析报告, its PR records (PR mode)
 *  or its mining metadata (diff mode: meta.json records the scenario, repository and engine; see content/miner). */
export function minerFiles(names: string[]) {
  const map: Record<string, string> = JSON.parse(content('miner/pr-map.json') ?? '{}');
  const out = ['miner/index.md'];
  names.forEach(n => {
    out.push('miner/' + n + '/summary.md', 'miner/' + n + '/analyzer.md');
    const prs = Object.keys(map).filter(pr => map[pr] === n);
    if (prs.length) prs.forEach(pr => out.push('miner/' + n + '/input/prs/' + pr + '/metadata.json'));
    else if (content('miner/' + n + '/meta.json') != null) out.push('miner/' + n + '/meta.json');
  });
  return out;
}

// ---------- Source changes ----------
/** Document paths a Teams document set held at its latest recorded version (replaying the version records). */
export function knownFiles(src: Source) {
  const files = new Set<string>();
  (src.versions ?? []).slice().reverse().forEach(v => {
    [...(v.files ?? []), ...(v.added ?? []), ...(v.modified ?? [])].forEach(f => files.add(f));
    (v.removed ?? []).forEach(f => files.delete(f));
  });
  return [...files];
}
export const sourceFiles = (src: Source) => (src.tree ?? []).flatMap(g => g.files.map(f => (g.dir ? g.dir + '/' : '') + f));

/** Document sets: a check that finds changed files records a version (newest first), named by the check's time. */
export const latestVersion = (src: Source | null) => src?.versions?.length ? src.versions[0].at : null;
export interface DocChanges { from: string | null; to: string | null; added: string[]; modified: string[]; removed: string[]; count: number; text?: string }
/** Net changes after version `since` up to the latest: a file added then removed drops out, added then modified stays added. */
export function docChanges(src: Source, since?: string | null): DocChanges {
  const state: Record<string, 'added' | 'modified' | 'removed' | null> = {};
  const out: DocChanges = { from: since ?? null, to: latestVersion(src), added: [], modified: [], removed: [], count: 0 };
  (src.versions ?? []).slice().reverse().forEach(v => {
    if (since && v.at <= since) return;
    if (!since && v.initial) return;
    (v.added ?? []).forEach(f => { state[f] = state[f] === 'removed' ? 'modified' : 'added'; });
    (v.modified ?? []).forEach(f => { if (!state[f]) state[f] = 'modified'; });
    (v.removed ?? []).forEach(f => { state[f] = state[f] === 'added' ? null : 'removed'; });
  });
  Object.entries(state).forEach(([f, s]) => { if (s) out[s].push(f); });
  out.count = out.added.length + out.modified.length + out.removed.length;
  return out;
}
export const changeCounts = (c: { added: string[]; modified: string[]; removed: string[] }) =>
  ([['新增', c.added], ['修改', c.modified], ['删除', c.removed]] as const).filter(x => x[1].length).map(x => x[0] + ' ' + x[1].length).join('、');

/** Where an artifact (or a run) starts from: the latest document version, or the current commit. */
export function sourceState(src: Source | null): Basis | null {
  if (!src) return null;
  if (src.type === 'docs') return { version: latestVersion(src) ?? undefined };
  if (src.type === 'repo') return src.commit ? { commit: src.commit.sha } : null;
  return null;
}
export const basisOf = (a: Artifact) => a.draft?.basis ?? a.published?.basis ?? null;
export interface Changes { from?: string | null; to?: string | null; count: number; text: string; added?: string[]; modified?: string[]; removed?: string[] }
/** What changed in the artifact's source since its basis; null when the capability cannot tell. */
export function changesSince(src: Source | null, basis: Basis | null | undefined): Changes | null {
  if (!src || !basis) return null;
  if (src.type === 'docs') { const c = docChanges(src, basis.version); return { ...c, text: changeCounts(c) }; }
  if (src.type === 'repo') {
    if (!src.commit) return null;
    const n = basis.commit === src.commit.sha ? 0 : 3;
    return { from: basis.commit, to: src.commit.sha, count: n, text: n ? n + ' 个新提交' : '' };
  }
  return null;
}

export function taskName(st: TalentsState, t: Pick<Task, 'name' | 'cap' | 'sources' | 'sessions'>) {
  if (t.name) return t.name;
  const what = t.sessions ? t.sessions.length + ' 个会话' : t.sources.map(id => source(st, id)?.name ?? '已移除的来源').join('、');
  return capability(st, t.cap).name + '：' + what;
}
