import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialState } from '../src/domain.js';
import { updateWorkspace } from '../src/workspace.js';
import { Store } from '../server/store.js';
import { createSourcePluginCatalog } from '../src/source-plugins.js';

const fixtures = { ...JSON.parse(await readFile('fixtures/presentation.json', 'utf8')), teamsProject: JSON.parse(await readFile('fixtures/teams-project.json', 'utf8')) };
const catalog = createSourcePluginCatalog(fixtures);

const draft = (name = '客户服务门户') => ({ id: randomUUID(), name, description: '独立项目说明', remoteUrl: 'https://github.com/example/portal.git', repositoryIdentity: 'github.com/example/portal' });
function businessState(state: ReturnType<typeof initialState>) { const copy = structuredClone(state); delete copy.workspace.projects; copy.revision = 0; copy.audit = []; return copy; }

test('created projects keep independent identities and metadata without changing the existing workflow', () => {
  const initial = initialState(), first = draft(), second = draft('知识服务');
  let state = updateWorkspace(initial, 'project.create', 'owner', first);
  state = updateWorkspace(state, 'project.create', 'owner', second);
  state = updateWorkspace(state, 'project.metadata.update', 'owner', { ...first, name: '客户门户新版' });
  assert.equal(state.workspace.projects?.length, 2);
  assert.equal(state.workspace.projects?.[0].name, '客户门户新版');
  assert.equal(state.workspace.projects?.[1].name, '知识服务');
  assert.deepEqual(businessState(state), businessState(initial));
  assert.equal(initial.workspace.projects, undefined);
});

test('project creation and editing enforce Owner access, required fields and exact project identity', () => {
  const initial = initialState(), project = draft(), before = JSON.stringify(initial);
  for (const kind of ['project.create', 'project.metadata.update'] as const) assert.throws(() => updateWorkspace(initial, kind, 'member', project), /无权/);
  for (const field of ['name', 'remoteUrl', 'repositoryIdentity']) assert.throws(() => updateWorkspace(initial, 'project.create', 'owner', { ...project, [field]: '  ' }), /不能为空/);
  for (const id of ['carddemo', 'teams']) assert.throws(() => updateWorkspace(initial, 'project.create', 'owner', { ...project, id }), /标识无效/);
  assert.throws(() => updateWorkspace(initial, 'project.metadata.update', 'owner', project), /不存在/);
  assert.equal(JSON.stringify(initial), before);
  const created = updateWorkspace(initial, 'project.create', 'owner', project), saved = JSON.stringify(created);
  assert.throws(() => updateWorkspace(created, 'project.create', 'owner', project), /已存在/);
  assert.equal(JSON.stringify(created), saved);
});

test('existing state is preserved in migration backup; created metadata persists and corrupt records fail explicitly', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'teams-projects-')), path = join(dir, 'state.json');
  try {
    const original = JSON.stringify(initialState()); await writeFile(path, original);
    const store = new Store(path); await store.init(); assert.equal(await readFile(path + '.pre-unified-delivery.json', 'utf8'), original); const preserved=structuredClone(store.state); delete preserved.workspace.deliveryRequirements; assert.deepEqual(preserved,JSON.parse(original));
    const project = draft(); await store.update(0, 'project.create', 'owner', project);
    const reloaded = new Store(path); await reloaded.init(); assert.deepEqual(reloaded.state, store.state);
    assert.equal(reloaded.state.workspace.projects?.[0].id, project.id);
    const broken = structuredClone(reloaded.state); broken.workspace.projects![0].id = 'carddemo';
    await writeFile(path, JSON.stringify(broken)); await assert.rejects(new Store(path).init(), /标识无效/);
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), broken);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('source associations validate the provider record, preserve project isolation and do not create tasks', () => {
  const initial = initialState(), project = draft();
  let state = updateWorkspace(initial, 'project.create', 'owner', project);
  assert.equal(state.workspace.projects?.[0].assets, undefined);
  state = updateWorkspace(state, 'asset.link', 'owner', { projectId: project.id, sourceAssetId: 'requirements:carddemo:DEMO-MKT-001', title: 'untrusted title' }, catalog.list());
  assert.equal(state.workspace.projects?.[0].assets?.[0].title, '信用卡消费返现');
  assert.equal(state.workspace.projects?.[0].assets?.[0].sourceAssetId, 'requirements:carddemo:DEMO-MKT-001');
  assert.deepEqual(businessState(state), businessState(initial));
  assert.equal(state.assigned, false); assert.equal(state.context, null);
  const before = JSON.stringify(state);
  assert.throws(() => updateWorkspace(state, 'asset.link', 'member', { projectId: project.id, sourceAssetId: 'requirements:carddemo:DEMO-MKT-001' }, catalog.list()), /无权/);
  assert.throws(() => updateWorkspace(state, 'asset.link', 'owner', { projectId: project.id, sourceAssetId: 'unknown' }, catalog.list()), /不存在/);
  assert.throws(() => updateWorkspace(state, 'asset.link', 'owner', { projectId: project.id, sourceAssetId: 'requirements:carddemo:DEMO-MKT-001' }, catalog.list()), /已关联/);
  assert.throws(() => updateWorkspace(state, 'asset.link', 'owner', { projectId: 'teams', sourceAssetId: 'requirements:carddemo:DEMO-MKT-001' }, catalog.list()), /只读/);
  assert.throws(() => updateWorkspace(state, 'asset.link', 'owner', { projectId: 'carddemo', sourceAssetId: 'repository:teams:icode-teams' }, catalog.list()), /本项目/);
  assert.throws(() => updateWorkspace(state, 'asset.link', 'owner', { projectId: 'carddemo', sourceAssetId: 'repository:carddemo:carddemo-java-1025' }, catalog.list()), /已关联/);
  assert.equal(JSON.stringify(state), before);
});

test('project source and manual references persist with exact target scope', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'teams-project-assets-')), path = join(dir, 'state.json');
  try {
    const store = new Store(path); await store.init(); const initial = structuredClone(store.state), project = draft();
    await store.update(0, 'project.create', 'owner', project);
    await store.update(1, 'asset.link', 'owner', { projectId: project.id, sourceAssetId: 'repository:teams:icode-teams' }, catalog.list());
    await store.update(2, 'asset.add', 'owner', { projectId: project.id, title: '项目说明', kind: 'document', location: 'demo://project/notes' });
    const reloaded = new Store(path); await reloaded.init();
    assert.deepEqual(reloaded.state, store.state); assert.equal(reloaded.state.workspace.projects?.[0].assets?.length, 2);
    assert.deepEqual(businessState(reloaded.state), businessState(initial));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
