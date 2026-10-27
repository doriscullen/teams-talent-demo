/**
 * Data exchanged through the shared data directory (DEMO_SHARED_DIR, default shared/data).
 * Each subdirectory has exactly one writer:
 *   teams/snapshot.json            written by Teams, read by Talents
 *   talents/knowledge.json         written by Talents, read by Teams
 *   talents/files/<id>/v<n>/<path> published artifact files, written by Talents
 *   talents/skills/<id>/<version>/<path>  project skill versions written by Talents
 * shared/seed/ holds committed copies of the same files, used when a writer has not started yet.
 * Paths inside the payloads are relative to the repository root.
 */

export interface SharedMember { id: string; name: string; role: 'owner' | 'member'; status: 'active' | 'invited' }
export interface SharedRepository { id: string; name: string; path?: string; remote?: string; branch?: string; description?: string }
export interface SharedDocument { id: string; title: string; path: string; summary: string }
/** A project skill (the project's "项目可用 Skill" in Teams); path is its SKILL.md and sha256 that file's digest. */
export interface SharedSkill { id: string; name: string; version: string; description: string; path: string; sha256: string }
export interface SharedProject { id: string; name: string; description: string; readonly: boolean; repositories: SharedRepository[]; documents: SharedDocument[]; skills: SharedSkill[] }
/** A session a member shared with the team in Teams; Talents uses these as trajectory diagnosis input. */
export interface SharedSession {
  id: string; projectId: string; title: string; memberId: string; memberName: string;
  updatedAt: string; turns: number; agent: string; model: string; cwd: string;
  requirementId?: string; summary?: string;
  /** Teams has collected the session's transcript (after the delivery was accepted); only such sessions can be diagnosed. */
  transcript?: boolean;
}
export interface TeamsSnapshot {
  schemaVersion: 1; exportedAt: string;
  team: { name: string; members: SharedMember[] };
  projects: SharedProject[];
  sessions: SharedSession[];
}

export interface PublishedFile { path: string; title: string; type: 'markdown' | 'html' | 'json' | 'text' }
export interface PublishedArtifact {
  /** projectId: the project it belongs to; null for team-level knowledge, which every project uses. */
  id: string; projectId: string | null; name: string; description: string;
  capability: string; capabilityName: string; category: string;
  kind: 'index' | 'files'; version: number; publishedAt: string; note: string;
  delivery: 'local' | 'cloud'; stats?: [string, string][]; files: PublishedFile[];
  /** Ids of the agents the knowledge is meant for; absent when it is meant for every agent. */
  agents?: string[];
}
/** A new version of a project skill, written by Talents when a trajectory diagnosis suggestion is applied. Its files
 *  (paths inside the skill, e.g. SKILL.md) replace the skill's files of the same path; the other files are unchanged. */
export interface PublishedSkillVersion {
  projectId: string; skillId: string; version: string; basedOn: { version: string; sha256?: string };
  publishedAt: string; note: string; files: PublishedFile[];
}
export interface TalentsKnowledge { schemaVersion: 1; exportedAt: string; artifacts: PublishedArtifact[]; skills?: PublishedSkillVersion[] }

export const sharedPaths = {
  teamsSnapshot: 'teams/snapshot.json',
  talentsKnowledge: 'talents/knowledge.json',
  talentsFile: (artifactId: string, version: number, path: string) => `talents/files/${artifactId}/v${version}/${path}`,
  talentsSkillFile: (skillId: string, version: string, path: string) => `talents/skills/${skillId}/${version}/${path}`,
};
