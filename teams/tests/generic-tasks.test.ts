import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialState } from '../src/domain.js';
import { updateWorkspace } from '../src/workspace.js';
import { projectOverview } from '../src/project-overview.js';
import { Store } from '../server/store.js';
const data = { ...JSON.parse(await readFile('fixtures/presentation.json', 'utf8')), teamsProject: JSON.parse(await readFile('fixtures/teams-project.json', 'utf8')) };
const draft = () => ({ id: 'GT-' + randomUUID(), projectId: 'carddemo', title: '整理本地运行指引', description: '核对启动命令和依赖', assigneeId: 'member', due: '2026-11-01' });

test('general task create/assign/start/complete preserves requirement, issue and acceptance state', () => {
  const initial = initialState(), input = draft();
  let state = updateWorkspace(initial, 'task.create', 'owner', input);
  assert.equal(initial.workspace.genericTasks, undefined);
  assert.deepEqual(projectOverview(state, data, 'carddemo').counts, projectOverview(initial, data, 'carddemo').counts);
  state = updateWorkspace(state, 'task.assign', 'owner', { ...input, assigneeId: null });
  assert.throws(() => updateWorkspace(state, 'task.start', 'member', input), /被分配/);
  state = updateWorkspace(state, 'task.assign', 'owner', input);
  state = updateWorkspace(state, 'task.start', 'member', input);
  assert.throws(() => updateWorkspace(state, 'task.assign', 'owner', input), /已开始/);
  state = updateWorkspace(state, 'task.complete', 'member', { ...input, result: '已核对并记录实际启动步骤。' });
  assert.equal(state.workspace.genericTasks![0].status, 'completed');
  assert.equal(state.workspace.genericTasks![0].result, '已核对并记录实际启动步骤。');
  assert.equal(state.stage, initial.stage); assert.equal(state.checks, initial.checks); assert.equal(state.security, initial.security);
  assert.equal(state.assigned, false); assert.equal(state.context, null);
  assert.throws(() => updateWorkspace(state, 'task.start', 'member', input), /重复开始/);
  assert.throws(() => updateWorkspace(state, 'task.complete', 'member', { ...input, result: '重复' }), /先开始/);
});

test('general tasks enforce role, project, assignee and input boundaries', () => {
  const initial = initialState(), input = draft();
  assert.throws(() => updateWorkspace(initial, 'task.create', 'member', input), /无权/);
  assert.throws(() => updateWorkspace(initial, 'task.create', 'owner', { ...input, projectId: 'teams' }), /不支持修改/);
  assert.throws(() => updateWorkspace(initial, 'task.create', 'owner', { ...input, projectId: randomUUID() }), /不支持修改/);
  assert.throws(() => updateWorkspace(initial, 'task.create', 'owner', { ...input, assigneeId: 'unknown' }), /有效成员/);
  assert.throws(() => updateWorkspace(initial, 'task.create', 'owner', { ...input, due: '2026-02-30' }), /日期无效/);
  assert.throws(() => updateWorkspace(initial, 'task.create', 'owner', { ...input, title: ' ' }), /title 无效/);
  let state = updateWorkspace(initial, 'task.create', 'owner', input);
  assert.throws(() => updateWorkspace(state, 'task.create', 'owner', input), /已存在/);
  assert.throws(() => updateWorkspace(state, 'task.start', 'owner', input), /被分配/);
  assert.throws(() => updateWorkspace(state, 'task.complete', 'member', { ...input, result: '未开始' }), /先开始/);
  state = updateWorkspace(state, 'task.start', 'member', input);
  assert.throws(() => updateWorkspace(state, 'task.complete', 'member', { ...input, result: ' ' }), /result 无效/);
  const projectId = randomUUID();
  state = updateWorkspace(state, 'project.create', 'owner', { id: projectId, name: '独立项目', description: '', remoteUrl: 'https://example.test/repo.git', repositoryIdentity: 'example.test/repo' });
  assert.throws(() => updateWorkspace(state, 'task.complete', 'member', { ...input, projectId, result: '跨项目' }), /不存在/);
  state = updateWorkspace(state, 'task.create', 'owner', { ...draft(), projectId });
  assert.deepEqual(state.workspace.genericTasks!.map(task => task.projectId), ['carddemo', projectId]);
  assert.equal(projectOverview(state, data, projectId).counts.all, 0);
});

test('optional task state preserves original backup during main-task migration and persists under the original revision lock', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'general-task-store-'));
  try {
    const path = join(dir, 'state.json'), original = JSON.stringify(initialState()); await writeFile(path, original);
    const store = new Store(path); await store.init(); assert.equal(await readFile(path + '.pre-unified-delivery.json', 'utf8'), original); const preserved=structuredClone(store.state); delete preserved.workspace.deliveryRequirements; assert.deepEqual(preserved,JSON.parse(original));
    const input = draft(); await store.update(0, 'task.create', 'owner', input);
    await assert.rejects(store.update(0, 'task.create', 'owner', draft()), /刷新后重试/);
    const reloaded = new Store(path); await reloaded.init(); assert.deepEqual(reloaded.state, store.state);
    const corrupt = structuredClone(store.state); corrupt.workspace.genericTasks![0].projectId = 'teams'; await writeFile(path, JSON.stringify(corrupt));
    await assert.rejects(new Store(path).init(), /通用任务记录无效/); assert.equal(await readFile(path, 'utf8'), JSON.stringify(corrupt));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
