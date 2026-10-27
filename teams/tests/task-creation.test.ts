import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialState } from '../src/domain.js';
import { assignDeliveryRequirement, createDeliveryRequirement, validateDeliveryRequirements } from '../src/delivery-requirements.js';
import { createProjectIssue, validateProjectIssues } from '../src/project-issues.js';
import { projectOverview } from '../src/project-overview.js';
import { projectDeliveryTasks } from '../src/project-delivery-tasks.js';
import { projectMembers } from '../src/teams-domain.js';
import { updateWorkspace } from '../src/workspace.js';
import { Store, atomicJson } from '../server/store.js';
import { resolveProjectWork } from '../server/project-work.js';

const at = '2026-10-28T00:00:00.000Z';
const data = { ...JSON.parse(await readFile('fixtures/presentation.json', 'utf8')), teamsProject: JSON.parse(await readFile('fixtures/teams-project.json', 'utf8')) };
const requirement = (projectId: string) => ({ projectId, id: 'REQ-' + randomUUID(), title: '本地新需求', description: '明确范围\n尚待确认的业务事项', due: '2026-11-02' });
const issue = (projectId: string) => ({ projectId, id: 'ISSUE-' + randomUUID(), title: '本地问题', description: '明确复现条件\n未同步外部平台', severity: 'high' });

test('both projects create unassigned delivery records without fabricated Skills; list totals and planned date derive from those records', () => {
  const state = initialState(), sources = JSON.stringify(data.teamsProject), before = structuredClone(state);
  for (const project of ['carddemo', 'teams']) {
    const original = projectOverview(state, data, project), task = createDeliveryRequirement(state, 'owner', requirement(project), at);
    assert.equal(task.assigneeId, ''); assert.deepEqual(task.skillIds, []); assert.equal(task.stage, 'preparing');
    assert.ok(Object.values(task.nodes).every(node => node.status === 'pending')); assert.deepEqual(task.checks, []);
    const view = projectOverview(state, data, project, '2026-11-03');
    assert.equal(view.counts.all, original.counts.all + 1); assert.equal(view.counts.pending, original.counts.pending + 1);
    const row = view.requirements.find(item => item.taskId === task.id)!;
    assert.equal(row.due, '2026-11-02'); assert.equal(row.overdue, true); assert.equal(row.source.origin, 'teams-task');
    assert.equal(projectDeliveryTasks(state, project).find(item => item.id === task.id)!.pendingAssignment, true);
    assert.equal(resolveProjectWork(state, data, { projectId: project, tab: 'delivery', taskId: task.id, nodeId: 'prepare' }).target.taskId, task.id);
  }
  assert.equal(JSON.stringify(data.teamsProject), sources); assert.equal(state.stage, before.stage); assert.deepEqual(state.workspace.team, before.workspace.team);
  assert.deepEqual(projectMembers(state, 'teams').map(member => member.id), ['owner', 'member']); validateDeliveryRequirements(state);
});

test('creation validates content, dates, roles, project membership and stable IDs before changing state', () => {
  const state = initialState(), input = requirement('teams'), before = JSON.stringify(state);
  for (const fields of [{ title: '  ' }, { description: '' }, { title: 'x'.repeat(161) }, { description: '\u0000' }, { due: '2026-02-30' }, { due: 'today' }, { id: 'T104' }, { assigneeId: 'A' }, { skillIds: ['bad/id'] }]) assert.throws(() => createDeliveryRequirement(state, 'owner', { ...input, ...fields }, at));
  assert.throws(() => createDeliveryRequirement(state, 'member', input, at), /Owner/);
  assert.throws(() => createDeliveryRequirement(state, 'owner', { ...input, projectId: 'unknown' }, at), /项目不存在/);
  assert.equal(JSON.stringify(state), before);
});

test('creation replay preserves the current assignment; conflicting payload cannot overwrite and active execution cannot be reassigned', () => {
  const state = initialState(), input = requirement('teams'), task = createDeliveryRequirement(state, 'owner', input, at);
  assignDeliveryRequirement(state, 'owner', { projectId: 'teams', taskId: task.id, assigneeId: 'owner' }, at);
  const before = JSON.stringify(state); assert.equal(createDeliveryRequirement(state, 'owner', input, at), task); assert.equal(JSON.stringify(state), before);
  assert.throws(() => createDeliveryRequirement(state, 'owner', { ...input, title: 'overwrite' }, at), /不同创建内容/);
  assert.throws(() => assignDeliveryRequirement(state, 'member', { projectId: 'teams', taskId: task.id, assigneeId: 'member' }, at), /Owner/);
  assert.throws(() => assignDeliveryRequirement(state, 'owner', { projectId: 'carddemo', taskId: task.id, assigneeId: 'member' }, at), /不存在/);
  task.nodes.prepare.status = 'running'; assert.throws(() => assignDeliveryRequirement(state, 'owner', { projectId: 'teams', taskId: task.id, assigneeId: 'member' }, at), /已经开始/);
});

test('local issues persist explicit Teams origin and contribute to only their project list and open count', () => {
  let state = initialState();
  for (const project of ['carddemo', 'teams']) {
    const input = issue(project), before = projectOverview(state, data, project), other = projectOverview(state, data, project === 'teams' ? 'carddemo' : 'teams');
    state = updateWorkspace(state, 'issue.create', 'owner', input);
    const next = projectOverview(state, data, project), saved = state.workspace.projectIssues!.find(item => item.id === input.id)!;
    assert.equal(saved.source, 'teams'); assert.equal(saved.status, 'open'); assert.equal(next.counts.issues, before.counts.issues + 1); assert.equal(next.counts.open, before.counts.open + 1); assert.equal(next.counts.blocking, before.counts.blocking);
    assert.equal(next.issues.find(item => item.source.sourceRecordId === input.id)!.source.origin, 'teams-task');
    assert.deepEqual(projectOverview(state, data, project === 'teams' ? 'carddemo' : 'teams'), other);
    assert.equal(updateWorkspace(state, 'issue.create', 'owner', input), state);
    assert.throws(() => updateWorkspace(state, 'issue.create', 'owner', { ...input, title: 'changed' }), /不同创建内容/);
  }
  validateProjectIssues(state); const before = JSON.stringify(state);
  assert.throws(() => createProjectIssue(state, 'member', issue('teams'), at), /Owner/);
  for (const fields of [{ severity: 'urgent' }, { title: '' }, { description: '' }, { assigneeId: 'A' }, { id: 'bad' }]) assert.throws(() => createProjectIssue(state, 'owner', { ...issue('teams'), ...fields }, at));
  assert.equal(JSON.stringify(state), before);
});

test('new requirements and issues survive Store reopen without migrating or rewriting original project data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'teams-create-state-')), path = join(directory, 'state.json');
  try {
    const store = new Store(path); await store.init(); const initial = structuredClone(store.state);
    const next = structuredClone(initial); createDeliveryRequirement(next, 'owner', requirement('teams'), at); createProjectIssue(next, 'owner', issue('carddemo'), at); await atomicJson(path, next);
    const bytes = await readFile(path), reopened = new Store(path); await reopened.init();
    assert.deepEqual(reopened.state, next); assert.deepEqual(await readFile(path), bytes);
    assert.deepEqual(reopened.state.workspace.project, initial.workspace.project); assert.deepEqual(reopened.state.workspace.team, initial.workspace.team);
    assert.deepEqual(reopened.state.workspace.deliveryRequirements![0], initial.workspace.deliveryRequirements![0]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
