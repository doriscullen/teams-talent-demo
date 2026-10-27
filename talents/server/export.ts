// Publishes Talents knowledge to the shared data directory for Teams: knowledge.json lists the
// published version of every published artifact, and each of its files is written under
// talents/files/<artifactId>/v<version>/<path>. Drafts and unpublished artifacts never leave Talents.
// It also lists the project skill versions Talents wrote, with their files under talents/skills/<id>/<version>/.
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { sharedPaths, type PublishedArtifact, type PublishedSkillVersion, type TalentsKnowledge } from '../../shared/contracts.ts';
import { atomicJson, atomicText } from './store.ts';
import { contentDir } from './config.ts';
import { fileLabel, fileType, minerIndex, readContent, RULES_FILE, rulesMarkdown } from './content.ts';
import type { Artifact, TalentsState } from './model.ts';
import { withCodegraph } from './codegraph.ts';

/** Text of a file as published (same rule as text(a, 'published', key) in src/demo/knowledge.ts). */
export function publishedText(a: Artifact, key: string, dir = contentDir): string | null {
  const p = a.published;
  if (!p) return null;
  if (key === 'miner/index.md') return minerIndex(p.specs ?? a.specs ?? [], dir);
  if (key === RULES_FILE) return rulesMarkdown((a.rules ?? []).filter(r => r.version <= p.version));
  const over = p.over?.[key];
  if (over != null) return typeof over === 'string' ? readContent(over, dir) : over.text;
  return readContent(key, dir);
}

export interface ExportedFile { path: string; text: string }
export interface Export { knowledge: TalentsKnowledge; files: Map<string, ExportedFile[]>; skillFiles: Map<string, ExportedFile[]> }

export function buildExport(state: TalentsState, dir = contentDir, exportedAt = new Date().toISOString()): Export {
  const caps = new Map(state.capabilities.map(c => [c.id, c]));
  const files = new Map<string, ExportedFile[]>();
  const artifacts: PublishedArtifact[] = [];
  for (const a of withCodegraph(state).artifacts) {
    const p = a.published;
    if (!p || a.kind === 'diagnosis' || a.submission) continue;
    const cap = caps.get(a.cap);
    const list: ExportedFile[] = [];
    if (a.kind !== 'index') for (const path of p.files ?? a.files ?? []) {
      const text = publishedText(a, path, dir);
      if (text == null) { console.warn(`Talents 导出：${a.id} v${p.version} 缺少文件 ${path}，已跳过`); continue; }
      list.push({ path, text });
    }
    files.set(a.id + '/v' + p.version, list);
    artifacts.push({
      id: a.id, projectId: a.projectId, name: a.name, description: a.desc,
      capability: a.cap, capabilityName: cap?.name ?? a.cap, category: cap?.cat ?? '',
      kind: a.kind, version: p.version, publishedAt: p.at, note: p.note, delivery: p.delivery,
      ...(a.stats ? { stats: a.stats } : {}), ...(p.agents ? { agents: p.agents } : {}),
      files: list.map(f => ({ path: f.path, title: fileLabel(f.path), type: fileType(f.path) })),
    });
  }
  const skillFiles = new Map<string, ExportedFile[]>();
  const skills: PublishedSkillVersion[] = (state.skillVersions ?? []).map(v => {
    skillFiles.set(v.skillId + '/' + v.version, v.files);
    return { projectId: v.projectId, skillId: v.skillId, version: v.version, basedOn: v.basedOn, publishedAt: v.at, note: v.note,
      files: v.files.map(f => ({ path: f.path, title: f.path, type: fileType(f.path) })) };
  });
  return { knowledge: { schemaVersion: 1, exportedAt, artifacts, ...(skills.length ? { skills } : {}) }, files, skillFiles };
}

/** Writes the export into `target` (a shared data or seed directory) and removes files of versions no longer published. */
export async function writeExport(target: string, data: Export) {
  const filesDir = join(target, 'talents', 'files');
  for (const [key, list] of data.files) {
    const [id, v] = key.split('/'), version = Number(v.slice(1));
    // Recreate the version directory so files no longer in the published list (e.g. removed specs) do not linger.
    const dir = join(filesDir, id, 'v' + version);
    await rm(dir, { recursive: true, force: true });
    for (const f of list) await atomicText(join(target, sharedPaths.talentsFile(id, version, f.path)), f.text);
  }
  for (const id of await list(filesDir)) {
    for (const v of await list(join(filesDir, id))) if (!data.files.has(id + '/' + v)) await rm(join(filesDir, id, v), { recursive: true, force: true });
    if (!(await list(join(filesDir, id))).length) await rm(join(filesDir, id), { recursive: true, force: true });
  }
  const skillsDir = join(target, 'talents', 'skills');
  for (const [key, list] of data.skillFiles) {
    const [id, version] = key.split('/');
    await rm(join(skillsDir, id, version), { recursive: true, force: true });
    for (const f of list) await atomicText(join(target, sharedPaths.talentsSkillFile(id, version, f.path)), f.text);
  }
  for (const id of await list(skillsDir)) {
    for (const v of await list(join(skillsDir, id))) if (!data.skillFiles.has(id + '/' + v)) await rm(join(skillsDir, id, v), { recursive: true, force: true });
    if (!(await list(join(skillsDir, id))).length) await rm(join(skillsDir, id), { recursive: true, force: true });
  }
  // knowledge.json last, so every file it lists is already in place.
  await atomicJson(join(target, sharedPaths.talentsKnowledge), data.knowledge);
}
async function list(dir: string) {
  try { return await readdir(dir); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}

/** Exports after state changes; skips the write when the published set is unchanged since the last export. */
export class KnowledgeExporter {
  private last = '';
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private target: string) {}
  export(state: TalentsState, force = false) {
    const next = this.queue.then(async () => {
      const data = buildExport(state);
      const signature = JSON.stringify([data.knowledge.artifacts, data.knowledge.skills, [...data.files], [...data.skillFiles]]);
      if (!force && signature === this.last) return false;
      await writeExport(this.target, data);
      this.last = signature;
      return true;
    });
    this.queue = next.catch(() => undefined);
    return next;
  }
}
