import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialState } from '../src/domain.js';
import { createDeliveryRequirement } from '../src/delivery-requirements.js';
import { migrateMainDelivery } from '../server/delivery-migration.js';
import { planRequirementSchedule } from '../src/requirement-schedule.js';
import { filterRequirements, projectOverview } from '../src/project-overview.js';
import type { Presentation } from '../src/api.js';

const data = { ...JSON.parse(await readFile('fixtures/presentation.json', 'utf8')), teamsProject: JSON.parse(await readFile('fixtures/teams-project.json', 'utf8')) } as Presentation;
const userId = 'REQ-ba1e28a4-3755-4b4f-9b24-82b872d1187c';
function fixture() {
  const state = initialState(); migrateMainDelivery(state);
  state.workspace.deliveryRequirements![0].createdAt = '2026-10-27T03:01:58.582Z';
  for (const [id, at, stage] of [['MKT-E2E-001', '04:06:35.586', 'awaiting-acceptance'], ['MKT-E2E-ACCEPT-001', '04:06:35.618', 'accepted'], ['MKT-OWNER-001', '08:54:09.591', 'verifying']] as const) {
    const task = createDeliveryRequirement(state, 'owner', { projectId: 'carddemo', id, title: id, description: '排期隔离夹具', assigneeId: 'member' }, `2026-10-27T${at}Z`);
    task.stage = stage;
  }
  createDeliveryRequirement(state, 'owner', { projectId: 'carddemo', id: userId, title: '用户填写的排期', description: '仅验证排序与排期的隔离数据', assigneeId: 'member', due: '2026-10-30' }, '2026-10-27T13:18:05.932Z');
  return state;
}

test('approved schedule changes only four missing local due values and preserves all existing dates and execution facts', () => {
  const state = fixture(), original = structuredClone(state), plan = planRequirementSchedule(state);
  assert.equal(plan.changes.length, 4); assert.deepEqual(state, original);
  assert.equal(plan.state.workspace.deliveryRequirements!.find(task => task.id === userId)!.due, '2026-10-30');
  const reverted = structuredClone(plan.state);
  for (const change of plan.changes) delete reverted.workspace.deliveryRequirements!.find(task => task.id === change.taskId)!.due;
  assert.deepEqual(reverted, original, 'stage, assignments, timestamps, revision, session/adoption data and every other field stay exact');
  const second = planRequirementSchedule(plan.state); assert.deepEqual(second.changes, []); assert.deepEqual(second.state, plan.state);
  state.workspace.deliveryRequirements![0].due = '2026-11-12';
  assert.equal(planRequirementSchedule(state).state.workspace.deliveryRequirements![0].due, '2026-11-12');
  state.workspace.deliveryRequirements!.find(task => task.id === 'MKT-OWNER-001')!.createdAt = '2026-11-01T00:00:00Z';
  assert.throws(() => planRequirementSchedule(state), /不得早于实际创建日期/);
});

test('both project requirement lists and filters sort by creation, not progress updates; unknown source dates stay last', () => {
  const state = planRequirementSchedule(fixture()).state, saved = structuredClone(state);
  const expected = [userId, 'MKT-OWNER-001', 'MKT-E2E-ACCEPT-001', 'MKT-E2E-001', 'DEMO-MKT-001', 'MKT-002', 'MKT-003', 'MKT-004', 'MKT-005'];
  const model = projectOverview(state, data, 'carddemo', '2026-10-27');
  assert.deepEqual(model.requirements.map(item => item.source.sourceRecordId), expected);
  assert.deepEqual(model.requirements.map(item => item.due), ['2026-10-30', '2026-10-29', '2026-10-27', '2026-10-28', '2026-10-30', '2026-10-30', '2026-10-29', '2026-10-28', '2026-10-27']);
  assert.ok(model.requirements.slice(5).every(item => item.createdAt === undefined));
  for (const filter of ['pending', 'active', 'acceptance', 'delivered'] as const) {
    const rows = filterRequirements(model, filter); assert.deepEqual(rows, model.requirements.filter(item => rows.includes(item))); assert.equal(rows.length, model.counts[filter]);
  }
  assert.deepEqual(state, saved);
  state.workspace.deliveryRequirements![0].updatedAt = '2099-01-01T00:00:00Z';
  assert.deepEqual(projectOverview(state, data, 'carddemo').requirements.map(item => item.source.sourceRecordId), expected);
  createDeliveryRequirement(state, 'owner', { projectId: 'teams', id: 'MKT-TEAM-OLD', title: '较早创建', description: '仅验证排序与排期的隔离数据', due: '2026-11-01' }, '2026-10-27T01:00:00Z');
  createDeliveryRequirement(state, 'owner', { projectId: 'teams', id: 'MKT-TEAM-NEW', title: '最新创建', description: '仅验证排序与排期的隔离数据', due: '2026-11-02' }, '2026-10-27T02:00:00Z');
  const teams = projectOverview(state, data, 'teams');
  assert.deepEqual(teams.requirements.map(item => item.taskId), ['MKT-TEAM-NEW', 'MKT-TEAM-OLD', 'T104', 'T105', 'T106', 'T107']);
  assert.deepEqual(teams.requirements.slice(2).map(item => item.due), data.teamsProject.tasks.filter(task => task.type === '需求').map(task => task.due));
});

test('schedule tool is dry-run by default, refuses live/stale state and applies a backed-up due-only atomic patch', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'requirement-schedule-'))), path = join(directory, 'state.json');
  try {
    const state = fixture(), original = JSON.stringify(state, null, 2) + '\n'; await writeFile(path, original);
    const sha = createHash('sha256').update(original).digest('hex');
    const run = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', 'scripts/fill-requirement-schedule.ts', '--state', path, ...args], { encoding: 'utf8' });
    const dry = run(); assert.equal(dry.status, 0, dry.stderr); assert.equal(JSON.parse(dry.stdout).changes.length, 4); assert.equal(await readFile(path, 'utf8'), original);
    const apply = ['--apply', 'yes', '--expect-revision', String(state.revision), '--expect-sha256', sha, '--service-stopped', 'yes'];
    await writeFile(join(directory, 'server.pid'), String(process.pid));
    assert.match(run(...apply).stderr, /仍在运行/); assert.equal(await readFile(path, 'utf8'), original); await rm(join(directory, 'server.pid'));
    assert.notEqual(run(...apply.map(value => value === sha ? '0'.repeat(64) : value)).status, 0);
    assert.notEqual(run('--apply', 'yes', '--expect-revision', String(state.revision + 1), '--expect-sha256', sha, '--service-stopped', 'yes').status, 0);
    const applied = run(...apply); assert.equal(applied.status, 0, applied.stderr);
    const result = JSON.parse(applied.stdout); assert.equal(await readFile(result.backup, 'utf8'), original);
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), planRequirementSchedule(state).state);
    assert.notEqual(run(...apply).status, 0, 'stale hash cannot be applied again');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
