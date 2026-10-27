// Shapes of the Talents state. The page (src/) owns most of the fields' behaviour,
// so only what the server reads is typed precisely; the rest is passed through.

export interface Commit { sha: string; message: string; time: string }
/** A document-set version: recorded when a check finds changed files, named by that check's time. */
export interface DocVersion { at: string; initial?: number; files?: string[]; added?: string[]; modified?: string[]; removed?: string[] }
/** Talents' own metadata about a source that Teams owns (keyed by the Teams-derived source id). */
export interface SourceMeta { origin?: string; commit?: Commit; prs?: number; lastCheck?: string; versions?: DocVersion[] }
export const SOURCE_META_KEYS = ['origin', 'commit', 'prs', 'lastCheck', 'versions'] as const;

export interface DocTreeGroup { dir: string; files: string[] }
/** A local document directory registered in Talents (the only source Talents owns). */
export interface LocalSource {
  id: string; type: 'docs'; name: string; path: string; desc?: string; files: number; tree: DocTreeGroup[];
  from: { kind: 'git' | 'shared'; origin?: string; branch?: string }; lastCheck: string; versions: DocVersion[];
  /** The project it was registered in; null when registered at team level. */
  projectId: string | null;
}

/** A source as the front-end sees it: Teams-derived (repo / doc set), local, or the team-sessions pseudo source. */
export interface Source {
  id: string; type: 'repo' | 'docs' | 'sessions'; name: string; path: string; desc?: string;
  fromTeams?: boolean; projectId?: string | null;
  branch?: string; origin?: string; commit?: Commit | null; prs?: number;
  files?: number; tree?: DocTreeGroup[]; titles?: Record<string, string>; from?: { kind: string; [key: string]: unknown };
  lastCheck?: string; versions?: DocVersion[]; auto?: boolean;
}

export type Over = string | { text: string };
export interface Published {
  version: number; at: string; note: string; delivery: 'local' | 'cloud';
  /** Ids of the agents the knowledge is meant for; absent: every agent. */
  agents?: string[];
  files?: string[]; specs?: string[]; over?: Record<string, Over>; basis?: { version?: string; commit?: string } | null; auto?: boolean;
}
export interface Draft { created: string; task?: string; revisions: { file: string; text: string; [key: string]: unknown }[]; basis?: unknown }
/** Tasks and artifacts belong to a project (projectId) or to the team (null), as their sources do. */
export interface Artifact {
  id: string; projectId: string | null; cap: string; name: string; desc: string; sources: string[]; kind: 'index' | 'files';
  files?: string[]; specs?: string[]; stats?: [string, string][]; folder?: string; skills?: string[];
  published: Published | null; draft: Draft | null; [key: string]: unknown;
}
export interface Capability { id: string; cat: string; name: string; [key: string]: unknown }

/** Everything Talents persists. Team, members, projects, Teams sources and sessions are never stored here. */
export interface TalentsState {
  schemaVersion: 1; seedVersion: number; revision: number;
  role: 'admin' | 'dev';
  agents: { id: string; name: string }[];
  categories: { id: string; name: string; desc: string }[];
  capabilities: Capability[];
  localSources: LocalSource[];
  sourceMeta: Record<string, SourceMeta>;
  prs: Record<string, { number: number; title: string; merged: string }[]>;
  tasks: Record<string, unknown>[];
  artifacts: Artifact[];
  trajTopics: Record<string, { skill: string; title: string; keywords: string[] }>;
  dev: { applied: Record<string, unknown>; local: Record<string, unknown>[] };
}
/** Keys of TalentsState the front-end may change through PUT /api/state, taken as they come. */
export const CLIENT_OWNED_KEYS = ['role', 'agents', 'categories', 'capabilities', 'prs', 'tasks', 'artifacts', 'trajTopics', 'dev'] as const;

export class HttpError extends Error { constructor(message: string, readonly status = 400) { super(message); } }
