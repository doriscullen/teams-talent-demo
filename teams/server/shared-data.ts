import { readFile } from 'node:fs/promises';
import { join, normalize, isAbsolute } from 'node:path';
import { atomicJson } from './store.js';
import { sharedDir, sharedSeedDir } from './config.js';
import { DomainError, type DemoState } from '../src/domain.js';
import type { Presentation } from '../src/api.js';
import type { SourcePluginCatalog } from '../src/source-plugins.js';
import { sharedPaths, type PublishedArtifact, type SharedProject, type SharedSession, type SharedSkill, type TalentsKnowledge, type TeamsSnapshot } from '../../shared/contracts.js';
import teamSessions from '../fixtures/team-sessions.json' with { type: 'json' };

/** Reads a shared file written by the other project, falling back to the committed seed copy. */
async function readShared(path: string): Promise<Buffer | null> {
  for (const dir of [sharedDir, sharedSeedDir]) {
    try { return await readFile(join(dir, path)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return null;
}

const repositoryPath = (path: string) => 'workspace/' + path;
/** Same "YYYY-MM-DD HH:mm" Beijing-time form as the session fixture. */
const localMinute = (iso: string) => new Date(new Date(iso).getTime() + 8 * 3600_000).toISOString().slice(0, 16).replace('T', ' ');
/** The card project's skills: those of the demo blueprint, as its "项目可用 Skill" panel lists them. */
function cardSkills(fixtures: Presentation): SharedSkill[] {
  const ids = new Set(fixtures.blueprint.skill_groups.flatMap(group => group.skills));
  return fixtures.skillCatalog.filter(skill => ids.has(skill.id)).map(skill => ({ id: skill.id, name: skill.name, version: skill.version,
    description: skill.description, path: repositoryPath('skills/' + skill.id + '/SKILL.md'), sha256: skill.contentSha256 }));
}
function cardProject(state: DemoState, fixtures: Presentation, catalog: SourcePluginCatalog): SharedProject {
  const project = state.workspace.project;
  const documents = project.assets.filter(asset => asset.kind === 'document').map(asset => {
    const source = asset.sourceAssetId ? catalog.get(asset.sourceAssetId) : undefined;
    return { id: asset.sourceAssetId ?? asset.id, title: asset.title, path: source?.references[0]?.path ?? asset.location, summary: source?.summary ?? '' };
  });
  return { id: 'carddemo', name: project.name, description: project.description, readonly: false,
    repositories: [{ id: 'repository:carddemo:' + project.repository, name: project.repository, path: repositoryPath(project.repository), branch: 'main', description: 'Java 21 微服务：7 个服务和 Web UI' }],
    documents, skills: cardSkills(fixtures) };
}
function sessions(state: DemoState): SharedSession[] {
  const members = new Map(state.workspace.team.members.map(member => [member.id, member.name]));
  const card = (value: Omit<SharedSession, 'projectId' | 'memberName' | 'cwd'>): SharedSession =>
    ({ ...value, projectId: 'carddemo', memberName: members.get(value.memberId) ?? value.memberId, cwd: repositoryPath(state.workspace.project.repository) });
  const shared = teamSessions.sessions.map(card);
  for (const record of state.workspace.taskAutomation ?? []) {
    if (record.collection?.reporting?.status !== 'reported') continue;
    const task = state.workspace.deliveryRequirements?.find(task => task.projectId === record.projectId && task.id === record.taskId);
    for (const session of record.collection.sessions) {
      shared.unshift({ id: session.tool + ':' + session.sessionId + ':' + record.taskId,
        projectId: record.projectId, requirementId: record.taskId, title: task?.title ?? '白金卡消费返现需求',
        memberId: task?.assigneeId ?? state.assigneeId ?? 'member', memberName: members.get(task?.assigneeId ?? state.assigneeId ?? 'member') ?? '项目成员',
        updatedAt: localMinute(session.lastAt), turns: 0, agent: session.tool, model: '未提供',
        cwd: task?.workDirectory ?? repositoryPath(state.workspace.project.repository), summary: session.nodeIds.join('、') });
    }
  }
  const delivery = teamSessions.delivery;
  if (state.workspace.sessionReported) shared.unshift(card({ ...delivery, updatedAt: localMinute(state.workspace.reportAt ?? new Date().toISOString()) }));
  return shared;
}
export function teamsSnapshot(state: DemoState, fixtures: Presentation, catalog: SourcePluginCatalog): TeamsSnapshot {
  const imported = fixtures.teamsProject.project;
  return {
    schemaVersion: 1, exportedAt: new Date().toISOString(),
    team: { name: state.workspace.team.name, members: state.workspace.team.members },
    projects: [
      cardProject(state, fixtures, catalog),
      { id: 'teams', name: imported.name, description: imported.description, readonly: true,
        repositories: imported.repos.map(repo => ({ id: 'repository:teams:' + repo.name, name: repo.name, remote: repo.name, branch: repo.branch, description: repo.note })),
        documents: imported.docs.map(doc => ({ id: 'design-library:teams:' + doc.path, title: doc.name, path: doc.path, summary: doc.description })),
        // The imported project's skills exist only in its source snapshot, not as files in this repository.
        skills: [] },
      ...(state.workspace.projects ?? []).map(project => ({ id: project.id, name: project.name, description: project.description, readonly: false,
        repositories: [{ id: 'repository:' + project.id, name: project.repositoryIdentity, remote: project.remoteUrl }], documents: [], skills: [] })),
    ],
    sessions: sessions(state),
  };
}
export async function exportTeamsSnapshot(state: DemoState, fixtures: Presentation, catalog: SourcePluginCatalog) {
  await atomicJson(join(sharedDir, sharedPaths.teamsSnapshot), teamsSnapshot(state, fixtures, catalog));
}

export async function readTalentsKnowledge(): Promise<TalentsKnowledge> {
  const content = await readShared(sharedPaths.talentsKnowledge);
  if (!content) return { schemaVersion: 1, exportedAt: '', artifacts: [] };
  const value = JSON.parse(content.toString('utf8')) as TalentsKnowledge;
  if (value.schemaVersion !== 1 || !Array.isArray(value.artifacts)) throw new DomainError('Talents 知识数据格式无效', 502);
  return value;
}
/** Knowledge published to the project, and team-level knowledge, which every project uses. */
export async function projectKnowledge(projectId: string): Promise<PublishedArtifact[]> {
  return (await readTalentsKnowledge()).artifacts.filter(artifact => artifact.projectId === projectId || artifact.projectId === null);
}
/** The version Teams records as "project knowledge built": the project's business knowledge if published, else any artifact. */
export function knowledgeVersion(artifacts: PublishedArtifact[]) {
  const sorted = [...artifacts].sort((a, b) => Number(a.projectId === null) - Number(b.projectId === null) || a.id.localeCompare(b.id));
  const main = sorted.find(artifact => artifact.capability === 'doc-extract') ?? sorted[0];
  return main ? `${main.name} v${main.version}` : undefined;
}
export async function readTalentsFile(artifactId: string, version: number, path: string) {
  const artifact = (await readTalentsKnowledge()).artifacts.find(item => item.id === artifactId && item.version === version);
  const file = artifact?.files.find(item => item.path === path);
  if (!artifact || !file || isAbsolute(path) || normalize(path).startsWith('..')) throw new DomainError('Talents 产物文件不存在', 404);
  const content = await readShared(sharedPaths.talentsFile(artifactId, version, path));
  if (!content) throw new DomainError('Talents 产物文件尚未同步', 404);
  return { ...file, content: content.toString('utf8') };
}
