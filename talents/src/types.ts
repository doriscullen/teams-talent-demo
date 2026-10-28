// The state the page works on: Talents' own state (server/model.ts) merged with the team, projects,
// sources and sessions read from iCode Teams (server/teams-data.ts clientState).
import type { Commit, DocTreeGroup, DocVersion, Over, Submission } from '../server/model.ts';
export type { Submission };
export type { Commit, DocTreeGroup, DocVersion, Over };

export type Role = 'admin' | 'dev';

export interface Member { id: string; name: string; role: 'owner' | 'member'; status?: string; title: string }
export interface Team { name: string; admin: string; me: string; members: Member[] }
/** A project skill from Teams (项目可用 Skill); its SKILL.md is read on demand (api.getSkill). */
export interface ProjectSkill { id: string; name: string; version: string; description: string; path: string; sha256: string }
export interface Project { id: string; name: string; description?: string; skills: ProjectSkill[] }

export interface Source {
  id: string; type: 'repo' | 'docs' | 'sessions'; name: string; path: string; desc?: string;
  /** The project the source belongs to; null for a team-level source. The sessions pseudo source has none. */
  fromTeams?: boolean; projectId?: string | null; auto?: boolean;
  branch?: string; origin?: string; commit?: Commit | null; prs?: number;
  files?: number; tree?: DocTreeGroup[]; titles?: Record<string, string>;
  from?: { kind: 'teams' | 'git' | 'shared'; project?: string; origin?: string; branch?: string };
  lastCheck?: string; versions?: DocVersion[];
}

export interface Session {
  id: string; title: string; updated: string; turns: number; messages: number; tokens: number; files: number;
  owner: string; ownerName?: string; projectId: string; agent?: string; model?: string; cwd?: string; requirementId?: string; summary?: string;
  /** Teams has collected the session's transcript; only such sessions can be diagnosed. */
  transcript?: boolean;
}

export interface Category { id: string; name: string; desc: string }
export interface Capability {
  id: string; cat: string; name: string; desc: string;
  input: 'repo' | 'docs' | 'sessions' | 'repo+pr' | 'repo+snippet'; inputLabel: string; output: string;
  update?: string; noUpdate?: string; skill?: boolean; prompt?: string;
}

export type Schedule = { kind: 'now' } | { kind: 'once'; at: string } | { kind: 'daily'; time: string };
export interface RunPlan { seconds: number; steps: string[]; logs: string[] }
/** Tasks and artifacts belong to a project, or to the team (projectId null); so do the sources they use. */
export interface Task {
  id: string; projectId: string | null; name?: string; cap: string; sources: string[]; sessions?: string[]; prs?: number[];
  created?: string; status: 'idle' | 'running' | 'success' | 'failed';
  mode?: 'update' | 'build'; input?: { from: string; to: string }; schedule: Schedule; skipUnchanged?: boolean;
  prompt?: string; agent?: string;
  run?: { startedAt: number; plan: RunPlan };
  lastRun?: string; duration?: string; lastLogs?: string[];
  artifact?: string; produced?: string; unchanged?: boolean;
}

export interface Basis { version?: string; commit?: string }
export interface Revision { kind: 'chat' | 'manual'; file: string; text: string; prompt?: string; summary?: string; at: string }
export interface Draft { created: string; task?: string; revisions: Revision[]; basis: Basis | null }
export interface Published {
  version: number; at: string; note: string; delivery: 'local' | 'cloud';
  /** Ids of the agents the knowledge is meant for; absent: every agent. */
  agents?: string[];
  files?: string[]; specs?: string[]; over?: Record<string, Over>; basis?: Basis | null; auto?: boolean;
}
/** kind: index (queried online), files (knowledge files), or diagnosis (a trajectory diagnosis: a report and
 *  improvement suggestions, applied one by one instead of being reviewed and published). */
export interface Artifact {
  id: string; projectId: string | null; cap: string; name: string; desc: string; sources: string[]; kind: 'index' | 'files' | 'diagnosis';
  files?: string[]; specs?: string[]; stats?: [string, string][]; folder?: string; skills?: string[]; usage?: string; mcpName?: string;
  sessions?: string[]; topic?: string;
  /** A diagnosis: how each suggestion of the report (content/trajectory/<topic>/report.json) was handled. */
  suggestions?: SuggestionState[];
  /** A project's AGENTS.md rules: each applied suggestion adds a rule and publishes the next version. */
  rules?: AgentRule[];
  published: Published | null; draft: Draft | null;
  submission?: Submission;
}
export interface SuggestionState { id: string; status: 'pending' | 'applied' | 'submitted' | 'declined'; at?: string; result?: string; reason?: string; submission?: Submission }
export interface AgentRule { id: string; text: string; version: number; at: string; from: { artifact: string; suggestion: string } }
/** A new version of a project skill, written by applying a diagnosis suggestion; Teams reads it from the shared directory. */
export interface SkillVersion {
  projectId: string; skillId: string; version: string; basedOn: { version: string; sha256?: string }; at: string; note: string;
  from: { artifact: string; suggestion: string }; files: { path: string; text: string }[];
}

export interface TalentsState {
  role: Role;
  agents: { id: string; name: string }[];
  categories: Category[];
  capabilities: Capability[];
  prs: Record<string, { number: number; title: string; merged: string }[]>;
  tasks: Task[];
  artifacts: Artifact[];
  /** Diagnosis reports available in content/trajectory/<topic>/, each for the session it analysed. */
  trajTopics: Record<string, { title: string; session: string }>;
  skillVersions: SkillVersion[];
  team: Team; projects: Project[]; sources: Source[]; sessions: Session[];
}

export interface TeamsInfo { origin: string; from: 'shared' | 'seed' | 'none'; exportedAt: string }
