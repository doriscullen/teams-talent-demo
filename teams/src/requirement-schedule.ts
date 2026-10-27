import type { DemoState } from './domain.js';

/** Owner-approved schedule on 2026-10-27. These are dates, never execution facts. */
export const approvedRequirementSchedule = {
  'DEMO-MKT-001': { due: '2026-10-30', storage: 'teams' },
  'MKT-002': { due: '2026-10-30', storage: 'requirements-plugin' },
  'MKT-003': { due: '2026-10-29', storage: 'requirements-plugin' },
  'MKT-004': { due: '2026-10-28', storage: 'requirements-plugin' },
  'MKT-005': { due: '2026-10-27', storage: 'requirements-plugin' },
  'MKT-E2E-001': { due: '2026-10-28', storage: 'teams' },
  'MKT-E2E-ACCEPT-001': { due: '2026-10-27', storage: 'teams' },
  'MKT-OWNER-001': { due: '2026-10-29', storage: 'teams' },
} as const;

/** Explicit maintenance plan; no startup migration or display-time fallback. */
export function planRequirementSchedule(state: DemoState) {
  const next = structuredClone(state);
  const changes: Array<{ projectId: string; taskId: string; path: string; before: unknown; after: string }> = [];
  const preserved: Array<{ taskId: string; due: string }> = [];
  for (const [taskId, schedule] of Object.entries(approvedRequirementSchedule)) {
    if (schedule.storage !== 'teams') continue;
    const matches = (next.workspace.deliveryRequirements ?? []).flatMap((task, index) => task.projectId === 'carddemo' && task.id === taskId ? [{ task, index }] : []);
    if (matches.length !== 1) throw new Error('排期目标必须唯一且已存在：' + taskId);
    const { task, index } = matches[0];
    if (task.due !== undefined && task.due !== null && task.due !== '') { preserved.push({ taskId, due: task.due }); continue; }
    if (!Number.isFinite(Date.parse(task.createdAt)) || schedule.due < new Date(task.createdAt).toISOString().slice(0, 10)) throw new Error('计划日期不得早于实际创建日期：' + taskId);
    changes.push({ projectId: 'carddemo', taskId, path: `/workspace/deliveryRequirements/${index}/due`, before: task.due ?? null, after: schedule.due });
    task.due = schedule.due;
  }
  return { state: next, changes, preserved };
}
