import { DomainError, type DemoState, type Role } from './domain.js';
import { creationText, optionalAssignee, requireProjectCreator } from './task-creation.js';

export const issueSeverityLabels = { critical: '严重', high: '高', medium: '中', low: '低' } as const;
export interface ProjectIssue {
  id: string; projectId: string; title: string; description: string; severity: keyof typeof issueSeverityLabels;
  assigneeId: string; status: 'open'; source: 'teams'; createdAt: string; updatedAt: string; creationRequest: string;
}
export function createProjectIssue(state: DemoState, role: Role, input: Record<string, unknown>, at: string) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new DomainError('问题内容无效', 400);
  const projectId = creationText(input.projectId, '项目', 100); requireProjectCreator(state, role, projectId);
  const id = creationText(input.id, '问题标识', 100);
  if (!/^ISSUE-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new DomainError('问题标识无效', 400);
  if (typeof input.severity !== 'string' || !Object.hasOwn(issueSeverityLabels, input.severity)) throw new DomainError('请选择有效严重程度', 400);
  const fields = { id, projectId, title: creationText(input.title, '问题标题', 160), description: creationText(input.description, '问题说明', 4000, true), severity: input.severity as ProjectIssue['severity'], assigneeId: optionalAssignee(state, projectId, input.assigneeId) };
  const creationRequest = JSON.stringify(fields), existing = state.workspace.projectIssues?.find(item => item.id === id && item.projectId === projectId);
  if (existing) { if (existing.creationRequest !== creationRequest) throw new DomainError('同一问题标识不能用于不同创建内容', 409); return existing; }
  const issue: ProjectIssue = { ...fields, creationRequest, status: 'open', source: 'teams', createdAt: at, updatedAt: at };
  state.workspace.projectIssues = [...state.workspace.projectIssues ?? [], issue]; return issue;
}
export function validateProjectIssues(state: DemoState) {
  if (state.workspace.projectIssues === undefined) return;
  if (!Array.isArray(state.workspace.projectIssues)) throw new Error('本地问题清单无效');
  const ids = new Set<string>();
  for (const issue of state.workspace.projectIssues) {
    if (!issue || ids.has(issue.projectId + '/' + issue.id) || issue.source !== 'teams' || issue.status !== 'open' || !Number.isFinite(Date.parse(issue.createdAt)) || !Number.isFinite(Date.parse(issue.updatedAt))) throw new Error('本地问题记录无效；未自动覆盖');
    const clone = structuredClone(state); clone.workspace.projectIssues = [];
    const normalized = createProjectIssue(clone, 'owner', issue as unknown as Record<string, unknown>, issue.createdAt);
    if (normalized.creationRequest !== issue.creationRequest) throw new Error('本地问题创建依据无效');
    ids.add(issue.projectId + '/' + issue.id);
  }
}
