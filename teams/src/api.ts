import { currentSystemContext, systemRuntime } from './system-links.js';
import type { PublishedArtifact, PublishedFile, PublishedSkillVersion } from '../../shared/contracts.js';
import type { DemoState, Role, Action } from './domain.js';
import type { WorkspaceAction } from './workspace.js';
import type blueprint from '../fixtures/demo-blueprint.json';
import type inventory from '../fixtures/skill-inventory.json';
import type teamsProject from '../fixtures/teams-project.json';
export interface Presentation {
  skillCatalog: import('./resource-sharing.js').SkillCatalogEntry[];
  localPaths: { collaborationSkill: string; cli: string };
  teamsProject: typeof teamsProject;
  blueprint: typeof blueprint; skills: typeof inventory;
  skillContents: Record<string, string>;
  evidence: { id: string; title: string; body: string }[];
  graph: { id: string; name: string; file: string; description: string; excerpt: string }[];
  sources: { file: string; content: string }[];
  baseline: { sourceRoot: string; commit: string; files: { source: string; target: string; sha256: string }[] };
}
export interface NativeStatus {
  terminalName?: string;
  terminals?: Array<{ id: string; name: string }>;
  selectedTerminal?: string;
  terminalError?: string;
  icode: { installed: boolean; path: string; version: string | null; workspace: string; sessionId: string; sessionAvailable: boolean; active: { pid: number; application: string | null; tty: string } | null };
  opencode: { installed: boolean; path: string | null; version: string | null; unsupportedReason?: string };
  verification: { status: string; at: string; messageCount: number; note: string } | null;
}
const tokens = new Map<string, string>();
async function tracedJson<T>(service: 'teams', path: string, init?: RequestInit): Promise<T> {
  const origin = systemRuntime().teamsOrigin;
  if (init?.method === 'POST' && !tokens.has(origin)) {
    const session = await tracedJson<{token:string}>(service, '/api/session'); tokens.set(origin, session.token);
  }
  let result: Response;
  try { result = await fetch(origin + path, { ...init, signal: AbortSignal.timeout(10000), headers: { 'Content-Type': 'application/json', 'X-Demo-Token': tokens.get(origin) ?? '', 'X-Demo-Request': crypto.randomUUID(), ...init?.headers } }); }
  catch (error) { throw new Error(`无法连接 Teams 项目服务（${origin}）：${(error as Error).message}`); }
  const data = await result.json();
  if (!result.ok) { if (result.status === 403) tokens.delete(origin); throw new Error(data.error ?? '请求失败'); }
  return data;
}
const projectQuery = () => '?project=' + encodeURIComponent(currentSystemContext().projectId);
export async function bootstrap() {
  const data = await tracedJson<{ token: string; state: DemoState; data: Presentation }>('teams', '/api/bootstrap' + projectQuery());
  tokens.set(systemRuntime().teamsOrigin, data.token); return data;
}
export const getState = () => tracedJson<DemoState>('teams', '/api/state');
export const getTools = () => tracedJson<NativeStatus>('teams', '/api/tools');
export const act = (state: DemoState, role: Role, action: Action, reason?: string, assigneeId?: string) => tracedJson<DemoState>('teams', '/api/action', { method: 'POST', body: JSON.stringify({ revision: state.revision, action, reason, assigneeId, ...currentSystemContext(), role }) });
export const updateWorkspace = (state: DemoState, role: Role, kind: WorkspaceAction, payload: Record<string,unknown>) => tracedJson<DemoState>('teams', '/api/workspace', { method: 'POST', body: JSON.stringify({ revision:state.revision, kind, payload, ...currentSystemContext(), role }) });
export const reset = (state: DemoState, role: Role) => tracedJson<DemoState>('teams', '/api/reset', { method: 'POST', body: JSON.stringify({ revision: state.revision, role }) });
export const native = <T = any>(role: Role, action: string, data: Record<string, unknown> = {}) => tracedJson<T>('teams', '/api/native/' + action, { method: 'POST', body: JSON.stringify({ role, ...data }) });
/** skills: the latest version Talents wrote of each project skill, with its files' content. */
export type TalentsSkillVersion = Omit<PublishedSkillVersion, 'files'> & { files: Array<PublishedSkillVersion['files'][number] & { content: string | null }> };
export const getTalentsKnowledge = (projectId: string) => tracedJson<{ talentsOrigin: string; artifacts: PublishedArtifact[]; skills: TalentsSkillVersion[] }>('teams', '/api/talents/knowledge?project=' + encodeURIComponent(projectId));
export const getTalentsFile = (artifact: PublishedArtifact, path: string) => tracedJson<PublishedFile & { content: string }>('teams', '/api/talents/file?' + new URLSearchParams({ artifact: artifact.id, version: String(artifact.version), path }));

export const getProjectWork = (role: Role, target: import('./project-work.js').ProjectWorkSelection) => tracedJson<import('./project-work.js').ProjectWorkPlan>('teams', '/api/project-work?' + new URLSearchParams({ role, ...target }).toString());
export const bindProjectWork = (role: Role, target: import('./project-work.js').ProjectWorkSelection, directory: string) => native<import('./project-work.js').ProjectWorkPlan>(role, 'work-bind', { target, directory });
export const startProjectWork = (role: Role, request: {requestId: string; target: import('./project-work.js').ProjectWorkSelection; action: import('./project-work.js').ProjectWorkAction; planToken: string}) => native<import('./project-work.js').ProjectWorkReceipt>(role, 'work-start', request);

export const getSkillApplication = (role: Role, scope: import('./skill-application.js').SkillApplicationScope) => tracedJson<import('./skill-application.js').SkillApplicationPlan>('teams', '/api/skill-application?' + new URLSearchParams({ role, ...scope }));
export const applySkillApplication = (role: Role, input: import('./skill-application.js').SkillApplicationScope & { planToken: string; requestId: string }) => native<import('./skill-application.js').SkillApplicationReceipt>(role, 'skill-apply', { ...input });

export const getResourceContent = (role: Role, scope: {resourceId:string;version:string;sha256:string}) => tracedJson<{version:string;sha256:string;contentSha256:string;content:string}>('teams', '/api/resource-content?' + new URLSearchParams({ role, ...scope }));

export const triggerTaskAutomation = (role: Role, scope: import('./task-automation.js').TaskScope, step: 'knowledge' | 'collection', retry = false) => tracedJson<DemoState>('teams', '/api/task-automation', { method: 'POST', body: JSON.stringify({ role, ...scope, step, retry }) });

export const deliveryRequirementAction=(state:DemoState,role:Role,input:Record<string,unknown>)=>tracedJson<DemoState>('teams','/api/delivery-requirements',{method:'POST',body:JSON.stringify({revision:state.revision,role,...input})});
