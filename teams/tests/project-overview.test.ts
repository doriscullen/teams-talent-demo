import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initialState, type DemoState } from '../src/domain.js';
import { updateWorkspace } from '../src/workspace.js';
import { createSourcePluginCatalog } from '../src/source-plugins.js';
import { filterIssues, filterRequirements, projectOverview, teamWorkIndex } from '../src/project-overview.js';
import { createDeliveryRequirement } from '../src/delivery-requirements.js';
import type { CollaborationEvent } from '../src/collaboration.js';
const data = { ...JSON.parse(await readFile('fixtures/presentation.json', 'utf8')), teamsProject: JSON.parse(await readFile('fixtures/teams-project.json', 'utf8')) };
const catalog = createSourcePluginCatalog(data);
const overview = (state: DemoState, project = 'carddemo') => projectOverview(state, data, project, '2026-10-26');

test('CardDemo main requirement changes within one deduplicated project set; quality and blockers remain independent', () => {
  const state = initialState();
  for (const [stage, checks, phase, open, blocked] of [['draft', 'none', '待开展', 0, 0], ['developing', 'none', '开发', 0, 0], ['failed', 'failed', '验证', 1, 1], ['fixed', 'passed', '验证', 0, 0], ['returned', 'passed', '开发', 0, 0], ['submitted', 'passed', '待验收', 0, 0], ['accepted', 'passed', '已交付', 0, 0]] as const) {
    const result = overview({ ...state, stage, checks, assigned: stage !== 'draft' });
    assert.equal(result.requirements.length, 5); assert.equal(result.requirements[0].taskId, 'DEMO-MKT-001'); assert.equal(result.requirements[0].phase, phase);
    assert.equal(result.counts.open, open + 4); assert.equal(result.counts.blocking, blocked + 2); assert.equal(result.issues.length, 7);
    assert.equal(result.counts.closed, checks === 'none' ? 1 : 2 - open); assert.equal(result.counts.unconfirmed, checks === 'none' ? 2 : 1);
    assert.equal(result.counts.pending, stage === 'draft' ? 1 : 0);
    assert.equal(result.counts.delivered, stage === 'accepted' ? 2 : 1);
    assert.equal(result.requirements[0].quality.find(item => item.label === '安全')?.passed, false);
    assert.equal(result.requirements[0].quality.find(item => item.label === 'Review')?.passed, false);
    assert.equal(result.requirements[0].quality.find(item => item.label === '功能')?.passed, stage === 'accepted');
    if (stage === 'returned') { assert.equal(result.requirements[0].quality.find(item => item.label === '测试')?.passed, false); assert.match(result.requirements[0].quality.find(item => item.label === '测试')!.result, /待复验/); }
  }
});
test('Teams task projections count once; research, problem input and unknown close state have explicit scope', () => {
  const result = overview(initialState(), 'teams');
  assert.deepEqual(result.requirements.map(item => item.taskId), ['T104', 'T105', 'T106', 'T107']); assert.equal(result.research[0].taskId, 'T108');
  assert.equal(result.research[0].quality.find(item => item.label === '测试')?.result, '不适用（调研）');
  assert.deepEqual(result.counts, { all: 4, pending: 0, active: 1, acceptance: 1, delivered: 2, issues: 1, open: 0, closed: 0, unconfirmed: 1, blocking: 0 });
  assert.equal(result.requirements[0].phase, '准备'); assert.ok(result.requirements[0].route?.includes('node=review'));
  assert.ok(result.requirements.find(item => item.taskId === 'T106')?.route?.includes('node=accept'));
  assert.equal(result.issues.length, 1); assert.equal(result.issues[0].closed, null); assert.equal(result.issues[0].blocksDelivery, false);
  assert.equal(result.requirements.filter(item => item.overdue).length, 2); assert.ok(result.requirements.every(item => !item.quality.find(q => q.label === '安全')?.passed));
});
test('empty and cross-project source associations do not inherit original delivery or duplicate totals', () => {
  const id = 'a6a6e619-033b-4bd8-b3cc-b9f42fce6863';
  let state = updateWorkspace(initialState(), 'project.create', 'owner', { id, name: '隔离概览', description: '', remoteUrl: 'mock://overview', repositoryIdentity: 'overview' });
  assert.deepEqual(overview(state, id).counts, { all: 0, pending: 0, active: 0, acceptance: 0, delivered: 0, issues: 0, open: 0, closed: 0, unconfirmed: 0, blocking: 0 });
  state = updateWorkspace(state, 'asset.link', 'owner', { projectId: id, sourceAssetId: 'requirements:teams:REQ-T105' }, catalog.list());
  const result = overview(state, id); assert.equal(result.counts.all, 1); assert.equal(result.counts.delivered, 0); assert.equal(result.requirements[0].phase, '待开展'); assert.equal(result.requirements[0].route, undefined); assert.equal(result.requirements[0].owner, '未分配'); assert.equal(result.requirements[0].due, undefined);
  const duplicate = structuredClone(state); duplicate.workspace.projects![0].assets!.push({ ...duplicate.workspace.projects![0].assets![0], id: 'another-local-reference' });
  assert.equal(overview(duplicate, id).counts.all, 1); assert.equal(overview(state).counts.all, 5); assert.equal(overview(state, 'teams').counts.all, 4);
});
test('every metric uses the same exact requirement or issue set as its drill-down filter', () => {
  for (const result of [overview(initialState()), overview({ ...initialState(), stage: 'failed', checks: 'failed' }), overview(initialState(), 'teams')]) {
    for (const filter of ['all', 'pending', 'active', 'acceptance', 'delivered'] as const) assert.equal(result.counts[filter], filterRequirements(result, filter).length);
    for (const filter of ['issues', 'open', 'closed', 'unconfirmed', 'blocking'] as const) assert.equal(result.counts[filter], filterIssues(result, filter).length);
    assert.equal(new Set(result.requirements.map(item => item.id)).size, result.requirements.length);
    assert.equal(new Set(result.issues.map(item => item.id)).size, result.issues.length);
    assert.equal(result.counts.all, result.counts.pending + result.counts.active + result.counts.acceptance + result.counts.delivered);
    assert.equal(result.counts.issues, result.counts.open + result.counts.closed + result.counts.unconfirmed);
    assert.ok(filterIssues(result, 'blocking').every(item => filterIssues(result, 'open').includes(item)));
  }
});

test('task reports use exact project/task scope and never turn a developer result into accepted delivery', () => {
  const state = initialState();
  const report = (revision: number, phase: CollaborationEvent['phase'], projectId = 'carddemo', taskId: string | undefined = 'DEMO-MKT-001'): CollaborationEvent => ({ id: 'event-' + revision, operationId: 'op-' + revision, projectId, taskId, nodeId: 'develop', role: 'member', runId: 'run-a', sessionId: null, adoptionId: 'adopt-a', phase, summary: '真实回传记录', blocker: phase === 'blocked' ? '等待接口约定' : null, evidence: [], at: '2026-10-26T00:00:00Z', revision });
  state.workspace.collaboration = { adoptions: [], operations: [], events: [report(1, 'blocked'), report(2, 'result', 'teams'), report(3, 'result', 'carddemo', 'another-task')] };
  assert.equal(overview(state).requirements[0].activity?.phase, 'blocked');
  assert.equal(overview(state).counts.blocking, 2, 'a work report is not a second defect source');
  state.workspace.collaboration.events.push(report(4, 'progress'));
  assert.equal(overview(state).requirements[0].activity?.phase, 'progress');
  state.workspace.collaboration.events.push(report(5, 'result'));
  assert.equal(overview(state).requirements[0].activity?.phase, 'result');
  assert.equal(overview(state).requirements[0].phase, '待开展'); assert.equal(overview(state).counts.delivered, 1);
});


test('source-backed project requirements and issues have exact initial totals without borrowing iCode evidence', () => {
  const result = overview(initialState());
  assert.deepEqual(result.counts, { all: 5, pending: 1, active: 2, acceptance: 1, delivered: 1, issues: 7, open: 4, closed: 1, unconfirmed: 2, blocking: 2 });
  assert.deepEqual(result.requirements.map(item => item.source.sourceRecordId), ['DEMO-MKT-001', 'MKT-002', 'MKT-003', 'MKT-004', 'MKT-005']);
  assert.deepEqual(result.requirements.slice(1).map(item => [item.source.title, item.owner, item.phase]), [
    ['返现明细查询', '陈晨', '开发'], ['账单返现汇总', '苏晴', '验证'], ['返现到账通知', '杨帆', '待验收'], ['历史权益查询', '赵宁', '已交付'],
  ]);
  for (const item of result.requirements.slice(1)) {
    assert.equal(item.taskId, undefined); assert.equal(item.route, undefined); assert.equal(item.source.pluginId, 'requirements');
    assert.deepEqual(item.source.references, []); assert.ok(item.source.detail.includes(item.source.requirement!.delivery!.summary));
    assert.ok(item.quality.every(conclusion => !conclusion.passed), 'a source delivery label must not invent verified quality evidence');
  }
  assert.equal(result.requirements[0].source.title, '信用卡消费返现');
  assert.match(result.requirements[0].source.summary, /白金卡客户未来 3 个月.*额外增加 0\.5%/);
  assert.match(result.requirements[0].source.detail, /待确认：活动日期/);
  assert.deepEqual(filterIssues(result, 'blocking').map(item => item.source.sourceRecordId), ['CARD-BUG-003', 'CARD-BUG-004']);
  assert.deepEqual(filterIssues(result, 'closed').map(item => item.source.sourceRecordId), ['CARD-BUG-007']);
  assert.deepEqual(filterIssues(result, 'unconfirmed').map(item => item.source.sourceRecordId), ['CARD-BUG-001', 'CARD-BUG-002']);
  for (const item of result.issues.slice(2)) {
    assert.equal(item.source.pluginId, 'defects'); assert.deepEqual(item.source.references, []);
    assert.equal(item.relatedIds.length, 1); assert.ok(result.requirements.some(requirement => item.relatedIds.includes(requirement.id)));
  }
});

test('additional source links deduplicate while another project keeps independent requirement and issue states', () => {
  const id = 'f05386c0-d57d-4d72-b2c4-3eea3e8f3d10';
  let state = updateWorkspace(initialState(), 'project.create', 'owner', { id, name: '独立项目', description: '', remoteUrl: 'mock://isolated', repositoryIdentity: 'isolated' });
  const initial = overview(state);
  const sources = ['requirements:carddemo:MKT-002', 'requirements:carddemo:MKT-005', 'defects:carddemo:CARD-BUG-003', 'defects:carddemo:CARD-BUG-007'];
  for (const sourceAssetId of sources) state = updateWorkspace(state, 'asset.link', 'owner', { projectId: id, sourceAssetId }, catalog.list());
  const localAssets = state.workspace.projects![0].assets!;
  localAssets.push(...localAssets.map((asset, index) => ({ ...asset, id: 'duplicate-' + index })));
  const local = overview(state, id);
  assert.deepEqual(local.counts, { all: 2, pending: 2, active: 0, acceptance: 0, delivered: 0, issues: 2, open: 0, closed: 0, unconfirmed: 2, blocking: 0 });
  assert.ok(local.requirements.every(item => item.owner === '未分配' && item.taskId === undefined && item.route === undefined));
  assert.ok(local.issues.every(item => item.closed === null && item.owner === '未分配' && !item.blocksDelivery && !item.confirmed));
  for (const sourceAssetId of sources) state.workspace.project.assets.push({ id: 'local-' + sourceAssetId, title: '重复引用', kind: 'source', location: sourceAssetId, sourceAssetId });
  assert.deepEqual(overview(state).counts, initial.counts);
  assert.equal(overview(state, 'teams').counts.all, 4);
});

test('an issue cannot block an already delivered requirement even if its source remains open', () => {
  const result = overview({ ...initialState(), assigned: true, stage: 'accepted', checks: 'failed' });
  const mainIssue = result.issues.find(item => item.source.sourceRecordId === 'CARD-BUG-001')!;
  assert.equal(mainIssue.closed, false); assert.equal(mainIssue.blocksDelivery, false);
  assert.equal(result.counts.open, 5); assert.equal(result.counts.blocking, 2);
  assert.equal(result.requirements.find(item => item.taskId === 'DEMO-MKT-001')!.phase, '已交付');
});

test('team work index combines main, imported and independent tasks with their own sessions', () => {
  const state = initialState(), at = '2026-10-26T08:00:00.000Z';
  const task = createDeliveryRequirement(state, 'owner', { projectId: 'carddemo', id: 'MKT-INDEX-001', title: '独立索引任务', description: '验证团队作业索引', assigneeId: 'member', skillIds: ['dev-code-reviewer'] }, at);
  state.workspace.taskAutomation = [{ projectId: 'carddemo', taskId: task.id, sessions: [{ projectId: 'carddemo', taskId: task.id, tool: 'icode', sessionId: 'session-index', nodeId: 'develop', source: 'manual', at }] }];
  const entries = teamWorkIndex(state, data), independent = entries.find(entry => entry.scope.taskId === task.id);
  assert.ok(entries.some(entry => entry.scope.taskId === 'DEMO-MKT-001'));
  assert.ok(entries.some(entry => entry.projectId === 'teams' && entry.scope.taskId === 'T104'));
  assert.equal(independent?.item.source.title, '独立索引任务');
  assert.equal(independent?.sessions.length, 1);
  assert.equal(independent?.sessions[0].sessionId, 'session-index');
  assert.equal(independent?.automation, state.workspace.taskAutomation[0]);
});
