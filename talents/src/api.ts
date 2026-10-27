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
export interface SubmitRequest { artifactId: string; suggestionId?: string; repository: string; base: string; note: string; skillDirectory?: string }
/** Submits a PR. The service streams one JSON line per step as it starts ({ step }), then { boot } or { error }. */
export async function submitPullRequest(request: SubmitRequest, onStep: (step: number) => void): Promise<Boot> {
  const response = await fetch('/api/pull-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
  if (!response.ok || !response.headers.get('Content-Type')?.includes('ndjson')) {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiError(data.error ?? '请求失败', response.status);
    return data as Boot;
  }
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  for (let rest = ''; ;) {
    const { value, done } = await reader.read();
    const lines = (rest + (value ?? '')).split('\n');
    rest = lines.pop()!;
    for (const line of lines.filter(Boolean)) {
      const message = JSON.parse(line);
      if ('step' in message) onStep(message.step);
      else if ('error' in message) throw new ApiError(message.error, 400);
      else return message.boot as Boot;
    }
    if (done) throw new ApiError('提交中断，请重试', 500);
  }
}
/** Where a project's PRs go by default (server/pull-requests.ts defaultTarget). */
export interface PullRequestTarget { repository: string; base: string; fork: boolean; directory: string }
export const pullRequestTarget = (projectId: string) => api<PullRequestTarget>('GET', '/api/pull-requests/target?project=' + encodeURIComponent(projectId));
/** SKILL.md of a project skill, read from the repository through the Talents service. */
export const getSkill = (projectId: string, id: string) => api<ProjectSkill & { content: string }>('GET', '/api/skill?project=' + encodeURIComponent(projectId) + '&id=' + encodeURIComponent(id));
