/** Focused scenario integration. Isolated storage; native preparation is never invoked. */
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { RequirementNode } from '../src/delivery-requirements.js';
import type { TalentNodeInputs } from '../src/talent-node-inputs.js';

const directory = await mkdtemp(join(tmpdir(), 'platinum-page-scenario-'));
process.env.DEMO_STATE_DIR = join(directory, 'state');
process.env.DEMO_SHARED_DIR = join(directory, 'shared');
process.env.DEMO_SHARED_SEED_DIR = resolve('../shared/seed');
process.env.DEMO_NATIVE_DISABLED = '1';
const [{ Store, atomicJson }, { readFixtures }, { createDeliveryRequirement }, { queueTaskPreparation, taskAutomation }, { talentNodeInputs }, { readTalentNodeInputs }, { registeredTaskSkill }, { loadSourceSkillPackage }, { projectKnowledge, readTalentsFile }, { TaskPreparationService }, { collaborationContext }] = await Promise.all([
  import('../server/store.js'), import('../server/http-shared.js'), import('../src/delivery-requirements.js'), import('../src/task-automation.js'), import('../server/talent-node-inputs.js'), import('../server/talent-node-client.js'), import('../server/talent-intake.js'), import('../server/skill-packages.js'), import('../server/shared-data.js'), import('../server/task-preparation.js'), import('../server/collaboration-service.js'),
]);
const title = '白金卡消费返现权益说明页', artifactId = 'a-platinum-cashback-page';
const description = '白金卡客户在未来3个月消费额外返现0.5%。增加权益入口与说明页，非白金卡不展示入口；不修改业务计算或入账。日期起算、消费范围、限额、结算等待确认。';
const nodes: RequirementNode[] = ['prepare', 'develop', 'verify', 'accept'];
const files: Record<RequirementNode, string[]> = {
  prepare: ['权益展示规则', '待确认清单', '现有模块与UI参考'],
  develop: ['权益展示规则', '现有模块与UI参考', '待确认清单'],
  verify: ['验收用例', '权益展示规则', '待确认清单'],
  accept: ['验收用例', '权益展示规则', '待确认清单'],
};
const skills: Record<RequirementNode, string[]> = {
  prepare: ['ba-requirement-analysis', 'ba-acceptance-criteria'],
  develop: ['arch-solution-design', 'dev-frontend-ui', 'dev-unit-test'],
  verify: ['dev-code-reviewer', 'dev-unit-test', 'qa-integration-test', 'sec-scan-review'],
  accept: ['qa-uat-support'],
};
const checks: string[] = [], projections: Record<string, unknown> = {};
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
try {
  const data = await readFixtures(), store = new Store(join(directory, 'state.json')); await store.init();
  const state = store.state, originalMain = structuredClone(state.workspace.deliveryRequirements!.find(task => task.id === 'DEMO-MKT-001'));
  function create(projectId: string, name = title, id = 'REQ-' + randomUUID(), body = description) {
    const task = createDeliveryRequirement(state, 'owner', { projectId, id, title: name, description: body, assigneeId: 'member' }, new Date().toISOString());
    queueTaskPreparation(state, { projectId, taskId: id }, new Date().toISOString()); return task;
  }
  const task = create('carddemo'), scope = { projectId: task.projectId, taskId: task.id }, published = await projectKnowledge('carddemo');
  const artifact = published.find(item => item.id === artifactId); assert.ok(artifact, 'dedicated published Talents artifact is required'); assert.equal(artifact.version, 1);
  const project = { id: 'carddemo', name: state.workspace.project.name, generation: 'isolated-scenario' };
  const input = (node: RequirementNode, selected = task, catalog = published, load = registeredTaskSkill) => talentNodeInputs({ state, project: { ...project, id: selected.projectId } }, data, selected.id, node, 'http://talents.invalid', load, catalog, readTalentsFile);
  const before = JSON.stringify(state), byNode = new Map<RequirementNode, TalentNodeInputs>();
  for (const node of nodes) {
    const value = await input(node); byNode.set(node, value);
    assert.equal(value.requirement.description, description); assert.equal(value.taskId, task.id); assert.equal(value.nodeId, node);
    assert.deepEqual(value.skills.map(skill => skill.id), skills[node]);
    const selected = value.knowledge.assets.filter(asset => asset.origin === 'talents-shared' && asset.id.includes(artifactId));
    assert.equal(selected.length, 3, node + ' must select three dedicated published files');
    const paths: string[] = [];
    for (const asset of selected) {
      assert.equal(asset.version, '1'); assert.equal(asset.sourceProjectId, 'carddemo'); assert.equal(asset.sourceRecordId, task.id);
      assert.ok(asset.references); assert.equal(asset.references.length, 1, 'each selected source links its exact published file');
      const reference = asset.references[0], source = await readTalentsFile(artifactId, 1, reference.path); paths.push(reference.path);
      assert.equal(asset.detail, source.content, 'node content is the published full text'); assert.notEqual(asset.detail, description, 'knowledge is not just the requirement repeated');
      assert.ok(source.content.length > 100); assert.ok(value.selection.knowledge.some(selection => selection.id === asset.id && selection.nodeId === node));
    }
    assert.deepEqual(paths.map(path => path.split('/').at(-1)!.replace(/\.md$/, '')).sort(), [...files[node]].sort());
    for (const skill of value.skills) {
      const actual = await loadSourceSkillPackage(skill.id), body = actual.files.find(file => file.path === 'SKILL.md')!;
      assert.equal(skill.version, actual.version); assert.equal(skill.sha256, actual.sha256); assert.equal(skill.content, body.bytes.toString('utf8')); assert.equal(skill.contentSha256, hash(skill.content));
    }
    projections[node] = { knowledge: selected.map(asset => ({ id: asset.id, version: asset.version, path: asset.references![0].path, sha256: hash(asset.detail) })), skills: value.skills.map(skill => ({ id: skill.id, version: skill.version, sha256: skill.sha256, contentSha256: skill.contentSha256 })) };
  }
  assert.equal(JSON.stringify(state), before); checks.push('random REQ selects four-node dedicated knowledge and exact registered Skill packages without adopting or mutating');
  const provenance = artifact.files.find(file => file.path.endsWith('provenance.json')); assert.ok(provenance); const sourceFacts = JSON.parse((await readTalentsFile(artifactId, 1, provenance.path)).content);
  assert.equal(sourceFacts.artifactId, artifactId); assert.equal(sourceFacts.projectId, 'carddemo'); assert.equal(sourceFacts.exactTitle, title);
  for (const source of sourceFacts.sourceFiles) assert.equal(hash(await readFile(resolve('..', source.path))), source.sha256, 'source provenance must match the real repository file');
  for (const file of sourceFacts.knowledgeFiles) assert.equal(hash((await readTalentsFile(artifactId, 1, file.path)).content), file.sha256, 'published knowledge must match its declared provenance');
  const rules = (await readTalentsFile(artifactId, 1, 'platinum-cashback-page/权益展示规则.md')).content, implementation = (await readTalentsFile(artifactId, 1, 'platinum-cashback-page/现有模块与UI参考.md')).content;
  assert.match(rules, /额外\s*0\.5%/); assert.match(rules, /未来\s*3\s*个月/); assert.match(rules, /非白金卡.*不可见/); assert.match(rules, /不新增.*返现计算.*入账/); assert.match(rules, /日期起算.*未定/);
  assert.match(implementation, /pageCardDetail/); assert.match(implementation, /CardResponse/); assert.match(implementation, /没有白金等级/);
  checks.push('published source content is readable, matches repository/provenance hashes and retains the agreed policy and implementation limits');

  for (const [projectId, name, id] of [
    ['carddemo', title + '补充', 'REQ-' + randomUUID()], ['carddemo', '库存数量说明页', 'REQ-' + randomUUID()],
    ['teams', title, 'REQ-' + randomUUID()], ['carddemo', title, 'MKT-SCENARIO-BOUNDARY'],
  ]) {
    const other = create(projectId, name, id, '仅整理本需求页面内容；详细规则待确认。');
    for (const node of nodes) assert.ok(!(await input(node, other)).knowledge.assets.some(asset => asset.id.includes(artifactId)), projectId + '/' + name + ' must not inherit the bank scenario');
  }
  for (const node of nodes) {
    const main = state.workspace.deliveryRequirements!.find(item => item.id === 'DEMO-MKT-001')!;
    assert.ok(!(await input(node, main)).knowledge.assets.some(asset => asset.id.includes(artifactId)), 'fixed main task keeps its original preset');
  }
  assert.deepEqual(state.workspace.deliveryRequirements!.find(item => item.id === 'DEMO-MKT-001'), originalMain); checks.push('near titles, unrelated titles, another project and fixed MKT records do not inherit the dedicated bank scenario');

  task.nodeInputSnapshots = { develop: structuredClone(byNode.get('develop')!) }; task.inputDigest = 'c'.repeat(64);
  const frozen = structuredClone(task), updatedPublished = published.map(item => item.id === artifactId ? { ...item, version: 2, description: 'later publication must not replace adoption' } : item);
  const frozenResult = await input('develop', task, updatedPublished, async () => { throw new Error('frozen inputs must not read replacement Skill packages'); });
  assert.equal(frozenResult.selection.basis, 'adopted-node'); assert.deepEqual(frozenResult.knowledge, frozen.nodeInputSnapshots!.develop!.knowledge); assert.deepEqual(frozenResult.skills, frozen.nodeInputSnapshots!.develop!.skills); assert.deepEqual(task, frozen);
  delete task.nodeInputSnapshots; delete task.inputDigest; checks.push('node snapshots retain exact versions, bytes and adoption digest after a later publication');

  const historical = create('carddemo'), old = structuredClone(byNode.get('develop')!);
  historical.talentInputsSnapshot = { projectId: 'carddemo', taskId: historical.id, generation: old.generation, origin: old.origin, requirement: { id: historical.id, title: historical.title, description: historical.description }, knowledge: { status: 'ready', version: 'historical-only', assets: [{ ...old.knowledge.assets[0], id: 'historical-explicit', sourceRecordId: historical.id, version: 'historical-only', detail: 'Previously adopted source remains exact.' }] }, skills: [old.skills[1]] };
  historical.inputDigest = 'd'.repeat(64); const historicalBefore = structuredClone(historical), historicalResult = await input('develop', historical);
  assert.equal(historicalResult.selection.basis, 'historical-subset'); assert.equal(historicalResult.knowledge.assets.length, 1); assert.equal(historicalResult.knowledge.assets[0].id, 'historical-explicit'); assert.deepEqual(historicalResult.skills, historical.talentInputsSnapshot.skills); assert.deepEqual(historical, historicalBefore); checks.push('historical task-wide adoption is not populated with new recommended content');

  const oldReady = create('carddemo'), ordinary = create('carddemo', '原先的通用说明页', 'REQ-' + randomUUID(), '只记录已保存的需求内容。');
  const cached = structuredClone(await input('prepare', ordinary)); cached.taskId = oldReady.id; cached.requirement = { id: oldReady.id, title: oldReady.title, description: oldReady.description };
  for (const asset of cached.knowledge.assets) { asset.id = asset.id.replace(ordinary.id, oldReady.id); asset.sourceRecordId = oldReady.id; }
  for (const item of cached.selection.knowledge) item.id = item.id.replace(ordinary.id, oldReady.id);
  const oldRecord = taskAutomation(state, { projectId: oldReady.projectId, taskId: oldReady.id })!;
  oldRecord.knowledge = { ...oldRecord.knowledge!, status: 'ready', finishedAt: new Date().toISOString(), nodeInputs: cached };
  const oldBytes = JSON.stringify(oldRecord), oldTaskBytes = JSON.stringify(oldReady);
  const held = await readTalentNodeInputs(state, data, { projectId: oldReady.projectId, taskId: oldReady.id, nodeId: 'prepare' });
  assert.deepEqual(held, cached); assert.ok(!held.knowledge.assets.some(asset => asset.id.includes(artifactId))); assert.equal(JSON.stringify(oldRecord), oldBytes); assert.equal(JSON.stringify(oldReady), oldTaskBytes);
  checks.push('already imported generic preparation remains immutable after a matching scenario is published');

  // The real timer and import functions run. The native boundary only observes
  // imported inputs and returns an explicit unavailable-directory result.
  await atomicJson(join(directory, 'state.json'), state);
  let nativeCalls = 0;
  const scheduler = new TaskPreparationService(store, data, { prepareSession: async () => { nativeCalls++; const actual = taskAutomation(store.state, scope)!.knowledge!.nodeInputs!; assert.deepEqual(actual.knowledge, byNode.get('prepare')!.knowledge); return { status: 'waiting-directory', reason: 'Isolated verification: native processes are not started.' }; } });
  const keepAlive = setInterval(() => {}, 1000);
  try {
    const pending = scheduler.schedule(scope); for (let attempt = 0; attempt < 100 && taskAutomation(store.state, scope)!.knowledge!.status !== 'running'; attempt++) await new Promise(resolve => setTimeout(resolve,10));
    const hidden = await readTalentNodeInputs(store.state, data, { ...scope, nodeId: 'prepare' }); assert.deepEqual(hidden.skills, []); assert.deepEqual(hidden.knowledge.assets, []); assert.equal(nativeCalls, 0);
    const hiddenContext = await collaborationContext(store.state, data, { ...scope, nodeId: 'prepare', tab: 'delivery' }); assert.deepEqual(hiddenContext.skills, []); assert.deepEqual(hiddenContext.knowledge.assets, []);
    await pending;
  } finally { clearInterval(keepAlive); }
  const record = taskAutomation(store.state, scope)!; assert.equal(record.knowledge!.status, 'ready'); assert.equal(record.preparation!.status, 'waiting-directory'); assert.equal(nativeCalls, 1);
  const elapsed = Date.parse(record.knowledge!.finishedAt!) - Date.parse(record.knowledge!.startedAt!); assert.ok(elapsed >= 20000);
  const visible = await readTalentNodeInputs(store.state, data, { ...scope, nodeId: 'prepare' }), context = await collaborationContext(store.state, data, { ...scope, nodeId: 'prepare', tab: 'delivery' });
  assert.deepEqual(visible, record.knowledge!.nodeInputs); assert.deepEqual(context.nodeInputs, visible);
  const finalTask = store.state.workspace.deliveryRequirements!.find(item => item.id === task.id)!; assert.equal(finalTask.preparedAt, undefined); assert.ok(Object.values(finalTask.nodes).every(node => node.status === 'pending')); assert.equal(store.state.workspace.collaboration, undefined);
  const saved = JSON.stringify(record.knowledge); await scheduler.schedule(scope); assert.equal(nativeCalls, 1); assert.equal(JSON.stringify(taskAutomation(store.state, scope)!.knowledge), saved);
  checks.push('actual 20-second import hides inputs before ready, exposes the same UI/CLI source afterwards, preserves node gates and does not invoke iCode');
  const result = { passed: true, taskId: task.id, artifact: { id: artifact.id, version: artifact.version, fileCount: artifact.files.length }, importElapsedMs: elapsed, nativeModelStarted: false, liveStateTouched: false, checks, projections };
  await mkdir('test-results/platinum-page-scenario', { recursive: true }); await writeFile('test-results/platinum-page-scenario/result.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} finally { await rm(directory, { recursive: true, force: true }); }
