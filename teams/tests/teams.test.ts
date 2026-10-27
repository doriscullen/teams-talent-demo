import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialState, transition } from '../src/domain.js';
import { updateWorkspace } from '../src/workspace.js';
import { allTeams, findTeam, projectMembers, projectTeam, validateTeams, visibleTeams } from '../src/teams-domain.js';
import { Store } from '../server/store.js';
const group = () => ({ id: 'team-' + randomUUID(), name: '客户服务团队' });
const project = () => ({ id: randomUUID(), name: '客户服务门户', description: '', remoteUrl: 'https://example.test/customer.git', repositoryIdentity: 'example.test/customer' });

test('team creation retains the original team and business state; rejects invalid, duplicate and unauthorized creation', () => {
  const initial = initialState(), input = group(), next = updateWorkspace(initial, 'team.create', 'owner', input);
  assert.equal(allTeams(next).length, 2); assert.deepEqual(next.workspace.team, initial.workspace.team);
  assert.deepEqual(findTeam(next, input.id).members, [initial.workspace.team.members[0]]);
  assert.equal(projectTeam(next, 'carddemo').id, 'carddemo'); assert.equal(visibleTeams(next, 'member').length, 1);
  assert.equal(next.stage, initial.stage); assert.equal(next.context, initial.context); assert.equal(initial.workspace.teams, undefined);
  for (const name of ['', ' ', 'a'.repeat(81), 'bad\nname']) assert.throws(() => updateWorkspace(initial, 'team.create', 'owner', { ...input, name }), /团队名称/);
  assert.throws(() => updateWorkspace(next, 'team.create', 'owner', { ...group(), name: ' 客户服务团队 ' }), /名称已存在/);
  assert.throws(() => updateWorkspace(next, 'team.create', 'owner', input), /标识无效或已存在/);
  assert.throws(() => updateWorkspace(initial, 'team.create', 'member', input), /无权/);
  assert.throws(() => updateWorkspace(initial, 'team.create', 'owner', { ...input, id: 'carddemo' }), /标识/);
  validateTeams(next);
});

test('member, invitation, rename and role mutations require a team scope and never change another team', () => {
  const input = group(); let state = updateWorkspace(initialState(), 'team.create', 'owner', input);
  const original = structuredClone(state.workspace.team), scope = { teamId: input.id };
  assert.throws(() => updateWorkspace(state, 'member.invite', 'owner', { name: '刘宁' }), /团队范围/);
  state = updateWorkspace(state, 'member.invite', 'owner', { ...scope, memberId: 'member' });
  assert.equal(visibleTeams(state, 'member').length, 1);
  state = updateWorkspace(state, 'member.approve', 'owner', { ...scope, id: 'member' });
  assert.equal(visibleTeams(state, 'member').length, 2); assert.deepEqual(state.workspace.team, original);
  assert.throws(() => updateWorkspace(state, 'member.role', 'owner', { ...scope, id: 'member', role: 'owner' }), /固定成员身份/);
  state = updateWorkspace(state, 'member.invite', 'owner', { ...scope, name: '刘宁' });
  const id = findTeam(state, input.id).members.at(-1)!.id;
  assert.throws(() => updateWorkspace(state, 'member.approve', 'owner', { teamId: 'carddemo', id }), /不存在/);
  state = updateWorkspace(state, 'member.approve', 'owner', { ...scope, id });
  state = updateWorkspace(state, 'member.role', 'owner', { ...scope, id, role: 'owner' });
  assert.equal(findTeam(state, input.id).members.find(member => member.id === id)!.role, 'owner');
  state = updateWorkspace(state, 'member.remove', 'owner', { ...scope, id });
  state = updateWorkspace(state, 'team.update', 'owner', { ...scope, name: '新客户服务团队' });
  assert.deepEqual(state.workspace.team, original); assert.equal(findTeam(state, input.id).name, '新客户服务团队');
  for (const action of ['team.update', 'member.invite', 'member.approve', 'member.role', 'member.remove', 'team.project.assign'] as const) assert.throws(() => updateWorkspace(state, action, 'member', { ...scope, name: '越权', id: 'member' }), /无权/);
  assert.throws(() => updateWorkspace(state, 'team.update', 'owner', { teamId: 'missing', name: '错误' }), /不存在/);
  assert.throws(() => updateWorkspace(state, 'team.update', 'owner', { ...scope, name: original.name }), /名称已存在/);
  validateTeams(state);
});

test('project association is explicit and preserves assignment identity; new project members come from its own team', () => {
  const input = group(), draft = project(); let state = updateWorkspace(initialState(), 'team.create', 'owner', input);
  const originalMembers = projectMembers(state, 'carddemo');
  state = updateWorkspace(state, 'project.create', 'owner', { ...draft, teamId: input.id });
  assert.equal(projectTeam(state, draft.id).id, input.id); assert.deepEqual(projectMembers(state, 'carddemo'), originalMembers);
  assert.throws(() => updateWorkspace(state, 'task.create', 'owner', { id: 'GT-' + randomUUID(), projectId: draft.id, title: '新团队任务', description: '', due: '', assigneeId: 'member' }), /有效成员/);
  state = transition(state, 'assign', 'owner', { assigneeId: 'yang' });
  const transfer = { teamId: input.id, projectId: 'carddemo', fromTeamId: 'carddemo' };
  assert.throws(() => updateWorkspace(state, 'team.project.assign', 'owner', transfer), /先将项目已有交付人加入/);
  state = updateWorkspace(state, 'member.invite', 'owner', { teamId: input.id, memberId: 'yang' });
  state = updateWorkspace(state, 'member.approve', 'owner', { teamId: input.id, id: 'yang' });
  state = updateWorkspace(state, 'team.project.assign', 'owner', transfer);
  assert.equal(projectTeam(state, 'carddemo').id, input.id); assert.equal(state.assigneeId, 'yang'); assert.equal(state.stage, 'assigned');
  assert.throws(() => transition(state, 'assign', 'owner', { assigneeId: 'member' }), /有效的项目成员/);
  assert.throws(() => updateWorkspace(state, 'member.remove', 'owner', { teamId: input.id, id: 'yang' }), /先调整/);
  // The same identity in the unrelated original team can be removed without touching the assigned team's member.
  state = updateWorkspace(state, 'member.remove', 'owner', { teamId: 'carddemo', id: 'yang' });
  assert.ok(projectMembers(state, 'carddemo').some(member => member.id === 'yang'));
  assert.throws(() => updateWorkspace(state, 'team.project.assign', 'owner', { teamId: 'carddemo', projectId: 'carddemo', fromTeamId: 'carddemo' }), /已变化/);
  assert.throws(() => updateWorkspace(state, 'team.project.assign', 'owner', { ...transfer, projectId: 'teams' }), /没有可修改/);
  validateTeams(state);
});

test('legacy state is backed up byte-identically, extra teams persist, and malformed references fail without rewriting', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'team-state-'));
  try {
    const path = join(dir, 'state.json'), old = JSON.stringify(initialState()); await writeFile(path, old);
    const store = new Store(path); await store.init(); assert.equal(await readFile(path + '.pre-unified-delivery.json', 'utf8'), old); const preserved=structuredClone(store.state); delete preserved.workspace.deliveryRequirements; assert.deepEqual(preserved,JSON.parse(old));
    const input = group(); await store.update(store.state.revision, 'team.create', 'owner', input);
    await assert.rejects(store.update(0, 'team.create', 'owner', group()), /刷新后重试/);
    const reload = new Store(path); await reload.init(); assert.deepEqual(reload.state, store.state); validateTeams(reload.state);
    for (const bad of [{ ...reload.state.workspace, teams: null }, { ...reload.state.workspace, projectTeamId: 'missing' }]) {
      const text = JSON.stringify({ ...reload.state, workspace: bad }); await writeFile(path, text); await assert.rejects(new Store(path).init(), /团队/); assert.equal(await readFile(path, 'utf8'), text);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('new scoped delivery requirements protect their assigned member during team and project changes', async () => {
  const { createDeliveryRequirement } = await import('../src/delivery-requirements.js');
  const input = group(); let state = updateWorkspace(initialState(), 'team.create', 'owner', input);
  createDeliveryRequirement(state, 'owner', { projectId: 'carddemo', id: 'MKT-TEAM-SCOPE', title: '团队范围检查', description: '独立需求的交付人不能因调整团队而丢失', assigneeId: 'su', skillIds: ['dev-code-reviewer'] }, new Date().toISOString());
  assert.throws(() => updateWorkspace(state, 'member.remove', 'owner', { teamId: 'carddemo', id: 'su' }), /先调整/);
  const transfer = { teamId: input.id, projectId: 'carddemo', fromTeamId: 'carddemo' };
  assert.throws(() => updateWorkspace(state, 'team.project.assign', 'owner', transfer), /先将项目已有交付人加入/);
  state = updateWorkspace(state, 'member.invite', 'owner', { teamId: input.id, memberId: 'su' }); state = updateWorkspace(state, 'member.approve', 'owner', { teamId: input.id, id: 'su' });
  state = updateWorkspace(state, 'team.project.assign', 'owner', transfer); validateTeams(state);
  assert.equal(state.workspace.deliveryRequirements![0].assigneeId, 'su'); assert.equal(projectTeam(state, 'carddemo').id, input.id);
});
