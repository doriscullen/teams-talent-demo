import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initialState } from '../src/domain.js';
import { updateWorkspace } from '../src/workspace.js';
import { createDeliveryRequirement } from '../src/delivery-requirements.js';
import { preferredDeliveryTask, projectDeliveryTasks, orderDeliveryTasks } from '../src/project-delivery-tasks.js';
import { projectOverview } from '../src/project-overview.js';

const data = { ...JSON.parse(await readFile('fixtures/presentation.json', 'utf8')), teamsProject: JSON.parse(await readFile('fixtures/teams-project.json', 'utf8')) };
const at = '2026-10-27T00:00:00Z';
const add = (state: ReturnType<typeof initialState>, projectId: string, id: string) => createDeliveryRequirement(state, 'owner', { projectId, id, title: id + ' 交付需求', description: '独立项目范围', assigneeId: 'member', skillIds: ['dev-frontend-ui'] }, at);

test('delivery display orders each actor group by createdAt only and leaves unknown dates last without changing selection or source data',()=>{
 const rows=[{id:'OLD',assigneeId:'member',createdAt:'2026-10-26T00:00:00Z',updatedAt:'2027-01-01T00:00:00Z'},{id:'T105',assigneeId:null},{id:'OTHER-NEW',assigneeId:'owner',createdAt:'2026-10-28T01:00:00Z'},{id:'NEW',assigneeId:'member',createdAt:'2026-10-28T00:00:00Z'},{id:'T104',assigneeId:null},{id:'INVALID',assigneeId:null,createdAt:'not-a-date'}];
 const before=JSON.stringify(rows),selected=rows[0];
 const ordered=orderDeliveryTasks(rows);
 assert.deepEqual(ordered.filter(row=>row.assigneeId==='member').map(row=>row.id),['NEW','OLD']);
 assert.deepEqual(ordered.filter(row=>row.assigneeId!=='member').map(row=>row.id),['OTHER-NEW','INVALID','T104','T105']);
 rows[0].updatedAt='2028-01-01T00:00:00Z';assert.deepEqual(orderDeliveryTasks(rows).map(row=>row.id),ordered.map(row=>row.id));assert.equal(ordered.find(row=>row.id===selected.id),selected);
 rows[0].updatedAt='2027-01-01T00:00:00Z';assert.equal(JSON.stringify(rows),before);
});

test('delivery selector and management share actual task identity, owner, status and routes as records are added', () => {
  const state = initialState();
  assert.deepEqual(projectDeliveryTasks(state, 'carddemo').map(task => task.id), ['DEMO-MKT-001']);
  assert.equal(projectOverview(state, data, 'carddemo').requirements.length, 5);
  add(state, 'carddemo', 'MKT-NAV-001');
  const second = add(state, 'carddemo', 'MKT-NAV-002'); second.stage = 'awaiting-acceptance';
  const tasks = projectDeliveryTasks(state, 'carddemo'), overview = projectOverview(state, data, 'carddemo');
  assert.deepEqual(tasks.map(task => task.id), ['DEMO-MKT-001', 'MKT-NAV-001', 'MKT-NAV-002']);
  for (const task of tasks) {
    const row = overview.requirements.find(row => row.taskId === task.id)!;
    assert.equal(row.owner, task.owner); assert.equal(row.phase, task.phase); assert.equal(row.deliveryStatus, task.status);
    if (!task.pendingAssignment) assert.equal(row.route, task.route);
    const params = new URLSearchParams(task.route.split('?')[1]);
    assert.equal(params.get('project'), 'carddemo'); assert.equal(params.get('task'), task.id); assert.equal(params.get('node'), task.node);
  }
  assert.equal(tasks.at(-1)?.node, 'accept');
  assert.ok(overview.requirements.filter(row => !row.taskId).every(row => row.route === undefined));
});

test('created-project delivery tasks stay in their own project and preserve source-only and snapshot boundaries', () => {
  const id = '27272727-2727-4272-8272-272727272727';
  const state = updateWorkspace(initialState(), 'project.create', 'owner', { id, name: '新交付项目', description: '', remoteUrl: 'https://github.com/example/new.git', repositoryIdentity: 'github.com/example/new' });
  assert.deepEqual(projectDeliveryTasks(state, id), []);
  const own = add(state, id, 'MKT-NEW-001');
  const other = add(state, 'carddemo', 'MKT-NEW-001'); other.stage = 'verifying';
  const saved = JSON.stringify(state), tasks = projectDeliveryTasks(state, id), overview = projectOverview(state, data, id);
  assert.deepEqual(tasks.map(task => task.id), ['MKT-NEW-001']);
  assert.equal(tasks[0].record, own); assert.equal(tasks[0].node, 'prepare');
  assert.equal(projectDeliveryTasks(state, 'carddemo').at(-1)?.record, other);
  assert.equal(overview.requirements[0].source.sourceProjectName, '新交付项目');
  assert.equal(overview.requirements[0].route, tasks[0].route);
  assert.deepEqual(projectDeliveryTasks(state, 'teams'), []);
  assert.deepEqual(projectOverview(state, data, 'teams').requirements.map(row => row.taskId), ['T104', 'T105', 'T106', 'T107']);
  assert.equal(JSON.stringify(state), saved);
});

test('current delivery routes follow real stages without changing the selected record or another project', () => {
  const state = initialState(), task = add(state, 'carddemo', 'MKT-NAV-003');
  for (const [stage, node] of [['preparing', 'prepare'], ['developing', 'develop'], ['returned', 'develop'], ['verifying', 'verify'], ['awaiting-acceptance', 'accept'], ['accepted', 'accept']] as const) {
    task.stage = stage; const selected = projectDeliveryTasks(state, 'carddemo').find(item => item.id === task.id)!;
    assert.equal(selected.node, node); assert.equal(selected.record, task);
    assert.equal(projectOverview(state, data, 'carddemo').requirements.find(row => row.taskId === task.id)?.route, selected.route);
    assert.equal(state.stage, 'draft');
  }
});

test('project tasks and counts are shared while execution and preferred selection use stable actor identity', async () => {
  const { filterRequirements, filterIssues } = await import('../src/project-overview.js');
  const { visibleGenericTasks, taskExecutableBy, currentActorId } = await import('../src/task-visibility.js');
  const state = initialState();
  // A duplicate display name must not turn another stable member ID into the current member.
  state.workspace.team.members.push({ id: 'member-other', name: '陈晨', role: 'member', status: 'active' });
  state.assigned = true; state.assigneeId = 'member-other'; state.stage = 'assigned';
  add(state, 'carddemo', 'MKT-MINE-001');
  const other = add(state, 'carddemo', 'MKT-OTHER-001'); other.assigneeId = 'member-other';
  state.workspace.genericTasks = [
    { id: 'GT-own', projectId: 'carddemo', title: '本人工作', description: '', assigneeId: 'member', due: null, status: 'pending', result: '', createdAt: at, updatedAt: at },
    { id: 'GT-other', projectId: 'carddemo', title: '其他成员工作', description: '', assigneeId: 'member-other', due: null, status: 'pending', result: '', createdAt: at, updatedAt: at },
    { id: 'GT-unassigned', projectId: 'carddemo', title: '待分配工作', description: '', assigneeId: null, due: null, status: 'pending', result: '', createdAt: at, updatedAt: at },
  ];
  const saved = JSON.stringify(state);
  const owner = projectOverview(state, data, 'carddemo', undefined, 'owner'), member = projectOverview(state, data, 'carddemo', undefined, 'member');
  assert.equal(owner.counts.all, 7); assert.equal(owner.counts.issues, 7);
  assert.deepEqual(projectDeliveryTasks(state, 'carddemo', 'owner').map(task => task.id), ['DEMO-MKT-001', 'MKT-MINE-001', 'MKT-OTHER-001']);
  assert.deepEqual(projectDeliveryTasks(state, 'carddemo', 'member').map(task => task.id), ['DEMO-MKT-001', 'MKT-MINE-001', 'MKT-OTHER-001']);
  assert.equal(preferredDeliveryTask(projectDeliveryTasks(state, 'carddemo', 'member'), 'member')?.id, 'MKT-MINE-001');
  assert.equal(currentActorId('owner'), 'owner'); assert.equal(currentActorId('member'), 'member');
  assert.equal(taskExecutableBy('member', 'member-other'), false); assert.equal(taskExecutableBy('owner', 'member'), false);
  assert.equal(taskExecutableBy('owner', 'owner'), true); assert.equal(taskExecutableBy('member', 'member'), true); assert.equal(taskExecutableBy('owner', null), false);
  assert.deepEqual(member.requirements.map(item => item.id), owner.requirements.map(item => item.id));
  assert.deepEqual(member.issues.map(item => item.id), owner.issues.map(item => item.id));
  assert.deepEqual(visibleGenericTasks(state, 'carddemo', 'member').map(task => task.id), ['GT-own', 'GT-other', 'GT-unassigned']);
  assert.equal(visibleGenericTasks(state, 'carddemo', 'owner').length, 3);
  for (const filter of ['all', 'pending', 'active', 'acceptance', 'delivered'] as const) assert.equal(member.counts[filter], filterRequirements(member, filter).length);
  for (const filter of ['issues', 'open', 'closed', 'unconfirmed', 'blocking'] as const) assert.equal(member.counts[filter], filterIssues(member, filter).length);
  assert.equal(member.counts.all, member.counts.pending + member.counts.active + member.counts.acceptance + member.counts.delivered);
  assert.equal(member.counts.issues, member.counts.open + member.counts.closed + member.counts.unconfirmed);
  assert.equal(JSON.stringify(state), saved);
  state.assigneeId = 'member';
  assert.deepEqual(projectDeliveryTasks(state, 'carddemo', 'member').map(task => task.id), ['DEMO-MKT-001', 'MKT-MINE-001', 'MKT-OTHER-001']);
  state.assigned = false; state.assigneeId = null;
  assert.equal(projectDeliveryTasks(state, 'carddemo', 'owner')[0].status, '待分配');
  assert.ok(projectDeliveryTasks(state, 'carddemo', 'member').some(task => task.id === 'DEMO-MKT-001'));
  assert.equal(taskExecutableBy('member', projectDeliveryTasks(state, 'carddemo', 'member')[0].assigneeId), false);
});

test('unmapped snapshots and other assignments remain readable without gaining execution identity', async () => {
  const { sourceTaskAssigneeId } = await import('../src/task-visibility.js');
  const id = '28282828-2828-4282-8282-282828282828';
  const state = updateWorkspace(initialState(), 'project.create', 'owner', { id, name: '无本人任务项目', description: '', remoteUrl: 'https://github.com/example/private.git', repositoryIdentity: 'github.com/example/private' });
  state.workspace.team.members.push({ id: 'member-other', name: '其他成员', role: 'member', status: 'active' });
  add(state, id, 'MKT-PRIVATE-001').assigneeId = 'member-other';
  const source = projectOverview(state, data, 'carddemo').requirements.find(row => row.source.sourceRecordId === 'MKT-002')!.source;
  assert.equal(sourceTaskAssigneeId(source, 'carddemo'), 'member');
  assert.equal(sourceTaskAssigneeId(source, id), null);
  assert.equal(sourceTaskAssigneeId({ ...source, id: 'requirements:carddemo:UNMAPPED', requirement: { ...source.requirement!, owner: '陈晨' } }, 'carddemo'), null);
  assert.deepEqual(projectDeliveryTasks(state, id, 'member').map(task => task.id), ['MKT-PRIVATE-001']);
  assert.equal(projectOverview(state, data, id, undefined, 'owner').counts.all, 1);
  assert.equal(projectOverview(state, data, id, undefined, 'member').counts.all, 1);
  assert.equal(preferredDeliveryTask(projectDeliveryTasks(state, id, 'member'), 'member')?.id, 'MKT-PRIVATE-001');
  const snapshot = projectOverview(state, data, 'teams', undefined, 'member');
  assert.equal(snapshot.requirements.length, 4); assert.equal(snapshot.research.length, 1); assert.equal(snapshot.issues.length, 1);
  assert.ok(snapshot.requirements.every(item => !item.assigneeId));
  assert.equal(projectOverview(state, data, 'teams', undefined, 'owner').counts.all, 4);
});

test('Owner personal task is preferred without changing the shared project collection', () => {
  const state = initialState(); add(state, 'carddemo', 'MKT-MEMBER-004'); const own = add(state, 'carddemo', 'MKT-OWNER-004'); own.assigneeId = 'owner';
  const tasks = projectDeliveryTasks(state, 'carddemo');
  assert.equal(preferredDeliveryTask(tasks, 'owner')?.id, own.id); assert.equal(preferredDeliveryTask(tasks, 'member')?.id, 'MKT-MEMBER-004');
  assert.equal(tasks.length, 3); assert.equal(preferredDeliveryTask([], 'owner'), undefined);
});

test('shared visibility stays within active project membership', async () => {
  const { projectTasksVisibleTo, visibleGenericTasks } = await import('../src/task-visibility.js');
  let state = updateWorkspace(initialState(), 'team.create', 'owner', { id: 'team-30303030-3030-4030-8030-303030303030', name: 'Owner 专属团队' });
  state = updateWorkspace(state, 'project.create', 'owner', { id: '30303030-3030-4030-8030-303030303030', name: '团队专属项目', description: '', remoteUrl: 'https://github.com/example/scoped.git', repositoryIdentity: 'github.com/example/scoped', teamId: 'team-30303030-3030-4030-8030-303030303030' });
  const projectId='30303030-3030-4030-8030-303030303030';
  createDeliveryRequirement(state,'owner',{projectId,id:'MKT-PRIVATE-OWNER',title:'专属项目任务',description:'不可越过项目成员范围',assigneeId:'owner',skillIds:['dev-frontend-ui']},at);
  assert.equal(projectTasksVisibleTo(state,projectId,'owner'),true); assert.equal(projectTasksVisibleTo(state,projectId,'member'),false);
  assert.equal(projectDeliveryTasks(state,projectId,'owner').length,1); assert.deepEqual(projectDeliveryTasks(state,projectId,'member'),[]);
  assert.equal(projectOverview(state,data,projectId,undefined,'member').counts.all,0); assert.deepEqual(visibleGenericTasks(state,projectId,'member'),[]);
});
