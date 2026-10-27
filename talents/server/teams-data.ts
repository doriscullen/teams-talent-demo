// Reads the Teams snapshot and maps it into the Talents model. Teams owns the team, members,
// projects, code repositories, design documents and shared sessions; Talents shows them read-only
// and keeps only its own metadata about them (TalentsState.sourceMeta).
import { readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { sharedPaths, type SharedProject, type SharedSession, type TeamsSnapshot } from '../../shared/contracts.ts';
import { repositoryRoot, seedDir, sharedDir } from './config.ts';
import { CLIENT_OWNED_KEYS, HttpError, SOURCE_META_KEYS, type DocTreeGroup, type LocalSource, type Source, type SourceMeta, type TalentsState } from './model.ts';

export type SnapshotOrigin = 'shared' | 'seed' | 'none';
export interface TeamsData { snapshot: TeamsSnapshot; from: SnapshotOrigin }

const EMPTY: TeamsSnapshot = { schemaVersion: 1, exportedAt: '', team: { name: '', members: [] }, projects: [], sessions: [] };

/** The snapshot Teams last exported; falls back to the committed seed copy, then to an empty team. */
export async function readTeamsData(dirs: { shared: string; seed: string } = { shared: sharedDir, seed: seedDir }): Promise<TeamsData> {
  for (const [from, dir] of [['shared', dirs.shared], ['seed', dirs.seed]] as const) {
    let text: string;
    try { text = await readFile(join(dir, sharedPaths.teamsSnapshot), 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    const snapshot = JSON.parse(text) as TeamsSnapshot;
    if (snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.projects) || !Array.isArray(snapshot.team?.members)) throw new HttpError('Teams 快照格式无效：' + join(dir, sharedPaths.teamsSnapshot), 502);
    return { snapshot: { ...snapshot, sessions: snapshot.sessions ?? [] }, from };
  }
  return { snapshot: EMPTY, from: 'none' };
}

// ---------- Mapping ----------
export const SESSIONS_SOURCE: Source = { id: 's-sessions', type: 'sessions', name: '团队会话', path: 'iCode Teams 中成员共享的会话', auto: true };
export const docSetId = (projectId: string) => 'docset:' + projectId;
/** 2026-10-27T03:35:12.000Z -> 2026-10-27 11:35 (local time), the format the front-end uses everywhere. */
export function localMinute(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function commonDir(paths: string[]) {
  const dirs = paths.map(p => p.split('/').slice(0, -1));
  const first = dirs[0] ?? [];
  let n = first.length;
  for (const d of dirs) { let i = 0; while (i < n && d[i] === first[i]) i++; n = i; }
  return first.slice(0, n).join('/');
}
function tree(paths: string[]): DocTreeGroup[] {
  const groups = new Map<string, string[]>();
  for (const path of paths) {
    const i = path.lastIndexOf('/'), dir = i < 0 ? '' : path.slice(0, i);
    groups.set(dir, [...(groups.get(dir) ?? []), path.slice(i + 1)]);
  }
  return [...groups].map(([dir, files]) => ({ dir, files }));
}
/** Code repositories Talents can work on: those with a local clone. Remote-only repositories are not sources. */
function repoSources(project: SharedProject, meta: Record<string, SourceMeta>): Source[] {
  return project.repositories.filter(repo => repo.path).map(repo => {
    const m = meta[repo.id] ?? {};
    return { id: repo.id, type: 'repo', name: repo.name, path: repo.path!, desc: repo.description ?? '', fromTeams: true, projectId: project.id,
      branch: repo.branch ?? 'main', origin: m.origin ?? repo.remote ?? '', commit: m.commit ?? null, prs: m.prs ?? 0 };
  });
}
/** A project's design documents become one document set named "<project>文档". */
function docSet(project: SharedProject, meta: Record<string, SourceMeta>, exportedAt: string): Source[] {
  if (!project.documents.length) return [];
  const id = docSetId(project.id), m = meta[id] ?? {};
  const paths = project.documents.map(doc => doc.path);
  return [{ id, type: 'docs', name: project.name + '文档', path: commonDir(paths) || 'iCode Teams 已对接的 ' + paths.length + ' 份设计文档', fromTeams: true, projectId: project.id,
    desc: project.documents.map(doc => doc.title).join('、'),
    files: paths.length, tree: tree(paths), titles: Object.fromEntries(project.documents.map(doc => [doc.path, doc.title])),
    from: { kind: 'teams', project: project.name },
    lastCheck: m.lastCheck ?? localMinute(exportedAt),
    versions: m.versions ?? [{ at: localMinute(exportedAt), initial: paths.length, files: paths }] }];
}
// Deterministic "random" so the numbers stay put across reloads.
function wiggle(seed: number, spread: number) { const x = Math.sin(seed * 9301 + 49297) * 233280; return Math.abs(x - Math.floor(x)) * spread; }
function session(s: SharedSession, i: number) {
  const qa = s.agent === 'Q&A Agent';
  return { id: s.id, title: s.title, updated: s.updatedAt, created: s.updatedAt, cwd: s.cwd, turns: s.turns, agent: s.agent, model: s.model,
    owner: s.memberId, ownerName: s.memberName, projectId: s.projectId, requirementId: s.requirementId, summary: s.summary, transcript: !!s.transcript,
    messages: Math.round(s.turns * (2.2 + wiggle(i, 1.4))),
    tokens: Math.round(s.turns * (28000 + wiggle(i + 7, 36000))),
    files: qa ? 0 : Math.max(1, Math.round(s.turns * (0.12 + wiggle(i + 3, 0.2)))) };
}

/** Teams data in the shape the front-end uses. Read-only imported projects are hidden. */
export function teamsModel(snapshot: TeamsSnapshot, meta: Record<string, SourceMeta> = {}) {
  const members = snapshot.team.members;
  const owner = members.find(m => m.role === 'owner') ?? members[0];
  const me = members.find(m => m.id === 'member') ?? members.find(m => m.role === 'member') ?? owner;
  const projects = snapshot.projects.filter(p => !p.readonly);
  const sources = projects.flatMap(p => [...repoSources(p, meta), ...docSet(p, meta, snapshot.exportedAt)]);
  const visible = new Set(projects.map(p => p.id));
  return {
    team: { name: snapshot.team.name, admin: owner?.id ?? '', me: me?.id ?? '',
      members: members.map(m => ({ id: m.id, name: m.name, role: m.role, status: m.status, title: m.role === 'owner' ? 'Owner' : '成员' })) },
    projects: projects.map(p => ({ id: p.id, name: p.name, description: p.description, skills: p.skills ?? [] })),
    sources,
    sessions: snapshot.sessions.filter(s => visible.has(s.projectId)).map(session),
  };
}

/** SKILL.md of a project skill, read from the path Teams gives (relative to the repository root). */
export async function readSkill(snapshot: TeamsSnapshot, projectId: string, skillId: string, root = repositoryRoot) {
  const skill = snapshot.projects.find(p => p.id === projectId && !p.readonly)?.skills?.find(s => s.id === skillId);
  if (!skill) throw new HttpError('项目 Skill 不存在', 404);
  const path = resolve(root, skill.path);
  if (relative(root, path).startsWith('..')) throw new HttpError('Skill 路径无效', 400);
  try { return { ...skill, content: await readFile(path, 'utf8') }; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new HttpError('找不到 Skill 文件：' + skill.path, 404); throw error; }
}

/** The state the front-end works on: Talents state merged with the Teams-derived team, projects, sources and sessions. */
export function clientState(state: TalentsState, snapshot: TeamsSnapshot) {
  const teams = teamsModel(snapshot, state.sourceMeta);
  const owned = Object.fromEntries(CLIENT_OWNED_KEYS.map(key => [key, state[key]]));
  const sources: Source[] = [SESSIONS_SOURCE, ...teams.sources, ...state.localSources];
  return { ...owned, team: teams.team, projects: teams.projects, sources, sessions: teams.sessions };
}

/**
 * What Talents persists from a state the front-end sends back. Teams-derived data (team, projects,
 * sessions, the Teams fields of repositories and document sets) is dropped; Talents' own metadata
 * about Teams sources and the local document sources are kept.
 */
export function ownedState(client: Record<string, any>, previous: TalentsState): TalentsState {
  if (!client || typeof client !== 'object' || !Array.isArray(client.sources) || !Array.isArray(client.projects) || !Array.isArray(client.artifacts) || !Array.isArray(client.tasks)) throw new HttpError('状态格式无效', 400);
  const next = structuredClone(previous);
  for (const key of CLIENT_OWNED_KEYS) if (client[key] !== undefined) (next as any)[key] = client[key];
  const sourceMeta = { ...previous.sourceMeta }, localSources: LocalSource[] = [];
  for (const s of client.sources as Source[]) {
    if (s.type === 'sessions') continue;
    if (s.fromTeams) {
      const meta: SourceMeta = {};
      for (const key of SOURCE_META_KEYS) if (s[key] != null) (meta as any)[key] = s[key];
      sourceMeta[s.id] = meta;
      continue;
    }
    const { fromTeams, titles, ...rest } = s;
    localSources.push({ ...(rest as unknown as LocalSource), type: 'docs', projectId: typeof s.projectId === 'string' ? s.projectId : null });
  }
  return { ...next, sourceMeta, localSources };
}
