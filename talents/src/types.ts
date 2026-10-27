// The state the page works on: Talents' own state (server/model.ts) merged with the team, projects,
// sources and sessions read from iCode Teams (server/teams-data.ts clientState).
import type { Commit, DocTreeGroup, DocVersion, Over } from '../server/model.ts';
export type { Commit, DocTreeGroup, DocVersion, Over };

export type Role = 'admin' | 'dev';

export interface Member { id: string; name: string; role: 'owner' | 'member'; status?: string; title: string }
export interface Team { name: string; admin: string; me: string; members: Member[] }
export interface Project { id: string; name: string; description?: string }

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
  owner: string; ownerName?: string; projectId: string; agent?: string;
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
export interface Artifact {
  id: string; projectId: string | null; cap: string; name: string; desc: string; sources: string[]; kind: 'index' | 'files';
  files?: string[]; specs?: string[]; stats?: [string, string][]; folder?: string; skills?: string[]; usage?: string; mcpName?: string;
  sessions?: string[]; topic?: string; skillPatch?: string;
  published: Published | null; draft: Draft | null;
}

export type Scope = { kind: 'repo'; repos: string[] } | { kind: 'global'; dir: 'chrys' | 'agents' } | { kind: 'agent'; agents: string[] };
export interface Applied { version: number; scope: Scope; at: string }
export interface LocalDir { id: string; type: 'repo' | 'docs'; name: string; path: string; repo: string | null; index: { at: string; files: string } | null; applied: boolean }

export interface TalentsState {
  role: Role;
  agents: { id: string; name: string }[];
  categories: Category[];
  capabilities: Capability[];
  prs: Record<string, { number: number; title: string; merged: string }[]>;
  tasks: Task[];
  artifacts: Artifact[];
  trajTopics: Record<string, { skill: string; title: string; keywords: string[] }>;
  dev: { applied: Record<string, Applied>; local: LocalDir[] };
  team: Team; projects: Project[]; sources: Source[]; sessions: Session[];
}

export interface TeamsInfo { origin: string; from: 'shared' | 'seed' | 'none'; exportedAt: string }
