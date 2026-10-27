// The Talents service (server/index.ts). Bootstrap returns Talents' own state merged with the team,
// members, projects, code repositories, design documents and sessions read from Teams; saving sends the
// whole state back and the service keeps only the Talents-owned part.
import type { ProjectSkill, TalentsState, TeamsInfo } from './types.ts';

export class ApiError extends Error { constructor(message: string, readonly status: number) { super(message); } }

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(data.error ?? '请求失败', response.status);
  return data as T;
}

export interface Boot { state: TalentsState; revision: number; teams: TeamsInfo }
export const bootstrap = () => api<Boot>('GET', '/api/bootstrap');
export const saveState = (revision: number, state: TalentsState) => api<{ revision: number }>('PUT', '/api/state', { revision, state });
export const resetState = () => api<Boot>('POST', '/api/reset', {});
/** SKILL.md of a project skill, read from the repository through the Talents service. */
export const getSkill = (projectId: string, id: string) => api<ProjectSkill & { content: string }>('GET', '/api/skill?project=' + encodeURIComponent(projectId) + '&id=' + encodeURIComponent(id));
