import type { DemoState, Role } from './domain.js';
import type { SourcePluginAsset } from './source-plugins.js';
import { projectMembers } from './teams-domain.js';
import { currentMemberId } from './task-assignment.js';

export const currentActorId = (role: Role): string => role;
export const taskExecutableBy = (role: Role, assigneeId?: string | null) => assigneeId === currentActorId(role);

// Callers scope records to the currently authorized project before this check.
// Shared task visibility does not confer permission to execute or mutate it.
export const taskVisibleTo = (role: Role, _assigneeId?: string | null) => role === 'owner' || role === 'member';

export function projectTasksVisibleTo(state: DemoState, projectId: string, role: Role) {
  if (projectId === 'teams') return taskVisibleTo(role); // Existing shared read-only import.
  if (projectId !== 'carddemo' && !state.workspace.projects?.some(project => project.id === projectId)) return false;
  return projectMembers(state, projectId).some(member => member.id === currentActorId(role) && member.status === 'active');
}

// These existing CardDemo source records explicitly identify Chen Chen, the local
// member identity. Imported Teams A/B/C and other source names have no such mapping.
// Resolve by source identity, never by the mutable/displayed owner name.
const sourceMemberIds: Readonly<Record<string, string>> = {
  'requirements:carddemo:MKT-002': currentMemberId,
  'defects:carddemo:CARD-BUG-001': currentMemberId,
  'defects:carddemo:CARD-BUG-003': currentMemberId,
};
export const sourceTaskAssigneeId = (source: SourcePluginAsset, projectId: string) => source.sourceProjectId === projectId ? sourceMemberIds[source.id] ?? null : null;
export const visibleGenericTasks = (state: DemoState, projectId: string, role: Role) => (state.workspace.genericTasks ?? []).filter(task => task.projectId === projectId && projectTasksVisibleTo(state, projectId, role) && taskVisibleTo(role, task.assigneeId));
