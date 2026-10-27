// Trajectory diagnosis suggestions. A diagnosis is not reviewed and published like knowledge: each suggestion
// is applied (or declined) on its own. A skill suggestion writes a new version of the project skill; a tool or
// prompt suggestion adds a rule to the project's AGENTS.md rules, which developers apply to their repositories.
import type { AgentRule, Artifact, ProjectSkill, SkillVersion, SuggestionState, TalentsState } from '../types.ts';
import { content } from '../content.ts';
import { artifact, project } from './model.ts';
import { now, uid } from './format.ts';

export interface SuggestionFile { path: string; before: string; after: string; reason?: string }
export interface Suggestion {
  id: string; kind: 'tool' | 'skill' | 'prompt'; title: string; priority: 'high' | 'medium' | 'low';
  background: string; observation: string; goal: string; change: string; risks: string[]; validation: string[];
  /** A skill suggestion: the project skill it changes; files are paths inside the skill. */
  skill?: string; files: SuggestionFile[];
}
export interface Report { title: string; summary: string; generatedAt: string; chains: number; suggestions: Suggestion[] }

/** content/trajectory/<topic>/report.json (written by tools/import-trajectory.mjs). */
export function report(topic?: string): Report | null {
  const text = topic ? content('trajectory/' + topic + '/report.json') : null;
  return text ? JSON.parse(text) : null;
}
/** The AGENTS.md rule a tool or prompt suggestion proposes (content/trajectory/<topic>/rules.json, written by hand). */
export function proposedRule(topic: string | undefined, id: string) {
  const text = topic ? content('trajectory/' + topic + '/rules.json') : null;
  return (text ? JSON.parse(text)[id] : null) as string | null ?? '';
}
export const kindLabel: Record<Suggestion['kind'], string> = { tool: '工具调用', skill: 'Skill', prompt: '任务指令' };
export const priorityLabel: Record<Suggestion['priority'], string> = { high: '高', medium: '中', low: '低' };

export const isDiagnosis = (a: Artifact) => a.kind === 'diagnosis';
export const stateOf = (a: Artifact, id: string): SuggestionState => a.suggestions?.find(s => s.id === id) ?? { id, status: 'pending' };
export const pendingCount = (a: Artifact) => isDiagnosis(a) ? (a.suggestions ?? []).filter(s => s.status === 'pending').length : 0;

// ---------- Project skills, with the versions Talents wrote ----------
/** The current version of a project skill: the latest one Talents wrote, else the one Teams lists. */
export function currentSkill(st: TalentsState, pid: string, id: string): { skill: ProjectSkill; written: SkillVersion | null } | null {
  const skill = project(st, pid)?.skills.find(s => s.id === id);
  if (!skill) return null;
  const written = st.skillVersions.filter(v => v.projectId === pid && v.skillId === id).at(-1) ?? null;
  return { skill: written ? { ...skill, version: written.version } : skill, written };
}
/** 1.0.0 -> 1.1.0 */
export const nextVersion = (version: string) => { const [major, minor = 0] = version.split('.').map(Number); return major + '.' + (minor + 1) + '.0'; };
const withVersion = (text: string, version: string) => text.replace(/^(\|\s*version\s*\|\s*)[^|\s]+(\s*\|)/m, '$1' + version + '$2');

/** Writes the suggested files as a new version of the project skill. */
export function applySkill(d: TalentsState, a: Artifact, s: Suggestion, version: string, note: string) {
  const current = currentSkill(d, a.projectId!, s.skill!)!;
  d.skillVersions.push({
    projectId: a.projectId!, skillId: s.skill!, version, note, at: now(), from: { artifact: a.id, suggestion: s.id },
    basedOn: current.written ? { version: current.written.version } : { version: current.skill.version, sha256: current.skill.sha256 },
    files: s.files.map(f => ({ path: f.path, text: f.path === 'SKILL.md' ? withVersion(f.after, version) : f.after })),
  });
  settle(d, a, s.id, { status: 'applied', result: s.skill + ' ' + version });
}

// ---------- AGENTS.md rules ----------
export const RULES_FILE = 'rules/AGENTS.md';
export const rulesId = (pid: string) => 'a-rules-' + pid;
/** Rules in a version of the AGENTS.md rules (all of them when no version is given). */
export const rulesAt = (a: Artifact, version?: number) => (a.rules ?? []).filter(r => version === undefined || r.version <= version);
export function rulesMarkdown(rules: Pick<AgentRule, 'text'>[]) {
  return '# AGENTS.md 规则\n\n> 从会话轨迹诊断中沉淀的项目规则，应用后写入代码仓 AGENTS.md 的 iCode Talents 区块。\n\n' + rules.map((r, i) => (i + 1) + '. ' + r.text).join('\n') + '\n';
}
/** Adds the rule to the project's AGENTS.md rules and publishes their next version. */
export function applyRule(d: TalentsState, a: Artifact, s: Suggestion, text: string, note: string) {
  const pid = a.projectId!;
  let rules = artifact(d, rulesId(pid));
  if (!rules) {
    rules = { id: rulesId(pid), projectId: pid, cap: 'traj', name: 'AGENTS.md 规则', desc: '从会话轨迹诊断中沉淀的项目规则，应用后写入代码仓的 AGENTS.md。',
      sources: [], kind: 'files', files: [RULES_FILE], folder: '项目规则', usage: '在这个项目中工作时遵守', rules: [], published: null, draft: null };
    d.artifacts.unshift(rules);
  }
  const version = (rules.published?.version ?? 0) + 1;
  rules.rules!.push({ id: uid('r'), text: text.trim(), version, at: now(), from: { artifact: a.id, suggestion: s.id } });
  rules.published = { version, at: now(), note, delivery: 'local', files: [RULES_FILE] };
  settle(d, a, s.id, { status: 'applied', result: 'AGENTS.md 规则 v' + version });
}

export function decline(d: TalentsState, a: Artifact, id: string, reason: string) {
  settle(d, a, id, { status: 'declined', reason: reason.trim() || undefined });
}
export function reopen(d: TalentsState, a: Artifact, id: string) { settle(d, a, id, { status: 'pending' }); }
function settle(d: TalentsState, a: Artifact, id: string, change: Omit<SuggestionState, 'id'>) {
  const x = artifact(d, a.id)!;
  x.suggestions = [...(x.suggestions ?? []).filter(s => s.id !== id), { id, ...change, at: now() }];
}
