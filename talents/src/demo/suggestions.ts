// Trajectory diagnosis suggestions. A diagnosis is not reviewed and published like knowledge: each suggestion
// is submitted as a PR (or declined) on its own. A skill suggestion changes the project skill's files; a tool or
// prompt suggestion adds a rule to the repository's AGENTS.md (server/pull-requests.ts).
import type { AgentRule, Artifact, ProjectSkill, SkillVersion, SuggestionState, TalentsState } from '../types.ts';
import { content } from '../content.ts';
import { artifact, project } from './model.ts';
import { now } from './format.ts';

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

// ---------- Project skills, with the versions Talents wrote (earlier demo state) ----------
/** The current version of a project skill: the latest one Talents wrote, else the one Teams lists. */
export function currentSkill(st: TalentsState, pid: string, id: string): { skill: ProjectSkill; written: SkillVersion | null } | null {
  const skill = project(st, pid)?.skills.find(s => s.id === id);
  if (!skill) return null;
  const written = st.skillVersions.filter(v => v.projectId === pid && v.skillId === id).at(-1) ?? null;
  return { skill: written ? { ...skill, version: written.version } : skill, written };
}
// ---------- AGENTS.md rules ----------
export const RULES_FILE = 'rules/AGENTS.md';
/** Rules in a version of the AGENTS.md rules (all of them when no version is given). */
export const rulesAt = (a: Artifact, version?: number) => (a.rules ?? []).filter(r => version === undefined || r.version <= version);
export function rulesMarkdown(rules: Pick<AgentRule, 'text'>[]) {
  return '# AGENTS.md 规则\n\n> 从会话轨迹诊断中沉淀的项目规则，应用后写入代码仓 AGENTS.md 的 iCode Talents 区块。\n\n' + rules.map((r, i) => (i + 1) + '. ' + r.text).join('\n') + '\n';
}
export function decline(d: TalentsState, a: Artifact, id: string, reason: string) {
  settle(d, a, id, { status: 'declined', reason: reason.trim() || undefined });
}
export function reopen(d: TalentsState, a: Artifact, id: string) { settle(d, a, id, { status: 'pending' }); }
function settle(d: TalentsState, a: Artifact, id: string, change: Omit<SuggestionState, 'id'>) {
  const x = artifact(d, a.id)!;
  x.suggestions = [...(x.suggestions ?? []).filter(s => s.id !== id), { id, ...change, at: now() }];
}
