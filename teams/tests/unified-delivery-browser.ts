import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { build } from 'esbuild';
import { deliveryStages, importedStage } from '../src/imported-delivery.js';
import { nodeResultFixture } from './node-contract-fixtures.js';
import { taskNodeDefinitions, taskNodeView } from '../src/task-node-contract.js';
import type { TaskSessionStreamResponse, TaskSessionTurn } from '../src/task-session-stream.js';
import type { RequirementNode } from '../src/delivery-requirements.js';
import type { Presentation } from '../src/api.js';
import { randomUUID, createHash } from 'node:crypto';
import { chromium, type Browser } from 'playwright';
import type { DemoState } from '../src/domain.js';
import { initialState } from '../src/domain.js';
import { createDeliveryRequirement } from '../src/delivery-requirements.js';
import { Store } from '../server/store.js';
const bundle = await build({ entryPoints: ['src/main.tsx'], bundle: true, outdir: 'test-results/unified-delivery/bundle', write: false, format: 'esm', minify: true, target: ['chrome120'], define: { 'process.env.NODE_ENV': '"production"' } });
const dir = await mkdtemp(join(tmpdir(), 'unified-delivery-ui-'));
const teams = 'http://127.0.0.1:46078', talent = 'http://127.0.0.1:46088';
const env = { ...process.env, DEMO_PORT: '46078', DEMO_TALENT_PORT: '46088', DEMO_STATE_DIR: join(dir, 'teams'), DEMO_SHARED_DIR: join(dir, 'shared'), DEMO_SHARED_SEED_DIR: join(dir, 'no-seed'), DEMO_NATIVE_DISABLED: '1' };
const ids = ['DEMO-MKT-001', 'MKT-E2E-001'];
// Existing records predate native preparation. New-task 20s/native preparation
// has its own HTTP and real-native probes; this suite exercises their shared UI.
const seed=initialState();seed.assigned=true;seed.assigneeId='member';seed.stage='assigned';
await mkdir(join(dir,'teams'),{recursive:true});await writeFile(join(dir,'teams/state.json'),JSON.stringify(seed));
const fixtureStore=new Store(join(dir,'teams/state.json'));await fixtureStore.init();
await fixtureStore.transact(current=>{const next=structuredClone(current);for(const input of [
 {id:ids[1],title:'第二条独立需求的完整标题用于验证两行省略与任务资料范围',description:'独立需求乙：核对本任务的输入和结果。仅用于界面范围验证，不代表真实 iCode 执行。',assigneeId:'member'},
 {id:'MKT-UI-OTHER-003',title:'其他成员的任务',description:'共享可读，只有明确交付人能够执行。',assigneeId:'su'},
])createDeliveryRequirement(next,'owner',{projectId:'carddemo',skillIds:['dev-frontend-ui'],...input},new Date().toISOString());return next;});
let logs = '', browser: Browser | undefined;
const children = ['server/index.ts'].map(entry => {
  const child = spawn(process.execPath, ['--import', 'tsx', entry], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', data => logs += data); child.stderr.on('data', data => logs += data); return child;
});
const state = async () => await (await fetch(teams + '/api/state')).json() as DemoState;
const post = async (path: string, body: object) => {
  const { token } = await (await fetch(teams + '/api/session')).json();
  const response = await fetch(teams + path, { method: 'POST', headers: { origin: teams, 'content-type': 'application/json', 'x-demo-token': token }, body: JSON.stringify({ role: 'owner', revision: (await state()).revision, ...body }) });
  const value = await response.json(); assert.equal(response.status, 200, JSON.stringify(value)); return value;
};
const hashes = async () => Promise.all([join(dir, 'teams/state.json')].map(async path => createHash('sha256').update(await readFile(path)).digest('hex')));
const out = 'test-results/unified-delivery';
try {
  let ready = false;
  for (let n = 0; n < 120; n++) { try { if ((await fetch(teams + '/api/health')).ok) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.ok(ready, logs);
  // Produce task states and receipts through the normal isolated HTTP contract.
  // These protocol fixtures do not launch iCode or claim external scan execution.
  for (const id of ids) {
    const scope = { projectId: 'carddemo', taskId: id }, runId = randomUUID(), sessionId = 'ui-protocol-' + randomUUID();
    for (const nodeId of ['prepare', 'develop', 'verify'] as const) {
      if(nodeId!=='prepare') {
        let ready=false;
        for(let attempt=0;attempt<70;attempt++){const automation=(await state()).workspace.taskAutomation?.find(item=>item.projectId===scope.projectId&&item.taskId===id);if(automation?.nodeKnowledge?.[nodeId]?.status==='ready'){ready=true;break;}await new Promise(resolve=>setTimeout(resolve,500));}
        assert.ok(ready,id+' '+nodeId+' knowledge must complete before adoption');
      }
      const context = await (await fetch(teams + '/api/collaboration/context?' + new URLSearchParams({ ...scope, nodeId }))).json();
      const adoption = await post('/api/collaboration', { role: 'member', kind: 'inputs.adopt', operationId: randomUUID(), input: { ...scope, nodeId, runId, sessionId, expectedRevision: context.revision, basisDigest: context.basisDigest, readReferences: context.skills.map((skill: { id: string }) => skill.id) } });
      const report = (kind: string, extra: object) => post('/api/collaboration', { role: 'member', kind, operationId: randomUUID(), input: { ...scope, nodeId, runId, sessionId, adoptionId: adoption.receipt.adoptionId, expectedRevision: 0, ...extra } });
      const input = async (extra: object) => ({ expectedRevision: (await state()).revision, summary: id + ' / ' + nodeId + ' 的界面协议验证记录', evidence: [{ kind: 'local-file', value: 'tests/unified-delivery-browser.ts', description: '界面协议测试文件；不是原生模型执行证据' }], ...extra });
      if (nodeId === 'prepare') { await report('result.submit', await input(nodeResultFixture('prepare'))); continue; }
      await report('progress.add', await input({ phase: 'started' }));
      if (nodeId === 'verify') await report('result.submit', await input(nodeResultFixture('verify', { failed: true })));
      await report('result.submit', await input(nodeResultFixture(nodeId)));
    }
  }
  const saved = await state(), before = await hashes();
  await mkdir(out, { recursive: true });
  const posts: string[] = [], errors: string[] = [], checks: object[] = [];
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } }); page.setDefaultTimeout(8000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => { if (route.request().method() !== 'GET') { posts.push(route.request().url()); return route.abort(); } const asset = bundle.outputFiles.find(file => '/' + basename(file.path) === new URL(route.request().url()).pathname); if (asset) return route.fulfill({ contentType: asset.path.endsWith('.css') ? 'text/css' : 'text/javascript', body: Buffer.from(asset.contents) }); return route.continue(); });
  const visit = async (id: string, node: string, role = 'owner') => { await page.goto(teams + '/teams?demo-role=' + role + '#/projects?' + new URLSearchParams({ project: 'carddemo', tab: 'delivery', task: id, node })); await page.locator('[data-delivery-scope="carddemo/' + id + '"]').waitFor(); };
  for (const id of ids) for (const node of ['prepare', 'develop', 'verify', 'accept']) {
    await visit(id, node);
    assert.deepEqual(await page.locator('[data-node-section]').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.nodeSection)), ['input', 'result', 'execution']);
    assert.deepEqual(await page.locator('[data-node-section]>.framework-card>.card-heading>h2').allTextContents(), ['输入', '结果', '执行过程']);
    const material = page.locator('.task-permanent-materials'); assert.equal(await material.getAttribute('data-material-task'), id);
    assert.ok((await material.innerText()).includes(saved.workspace.deliveryRequirements!.find(task => task.id === id)!.description.split('。')[0]));
    assert.doesNotMatch(await material.innerText(), /本次采用的输入|查看输入来源详情|dev-frontend-ui/);
    assert.equal(await material.getByRole('button', { name: /收起|展开|关闭/ }).count(), 0); assert.equal(await page.getByRole('button', { name: /展开任务资料|收起任务资料/ }).count(), 0);
    assert.equal(await page.locator('[data-action]').count(), 0);
    const initial = await page.locator('.project-node-content').innerText(); assert.doesNotMatch(initial, /ui-protocol-|"operationId"|"runId"|\/Users\/|\.runtime\//);
    await page.getByRole('heading', { name: '任务进展', exact: true }).waitFor(); await page.getByRole('heading', { name: '会话过程', exact: true }).waitFor();
    if (node === 'prepare') { await page.getByText('查看需求、采用版本与上游结果', { exact: true }).click(); await page.getByText('知识与 Skill 版本', { exact: true }).waitFor(); assert.ok(await page.locator('[data-node-section=input]').getByRole('button', { name: /^阅读 / }).count() > 0); }
    const expected = (saved.workspace.collaboration?.events ?? []).filter(event => event.projectId === 'carddemo' && event.taskId === id && event.nodeId === node);
    assert.deepEqual(await page.locator('[data-collaboration-event]').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.collaborationEvent)), expected.map(event => event.id));
    if (expected.length) { await page.getByRole('button', { name: '查看会话、操作与证据引用', exact: true }).last().click(); const detail = JSON.parse(await page.locator('.drawer-console').innerText()); assert.equal(detail.taskId, id); assert.equal(detail.nodeId, node); await page.locator('.ant-drawer-open .ant-drawer-close').click(); await page.locator('.ant-drawer-open').waitFor({ state: 'hidden' }); }
    if (node === 'verify') { await page.getByText('查看检查与复检记录（8）', { exact: true }).click(); assert.equal(await page.locator('[data-check-source=actual]').count(), 2); assert.equal(await page.locator('[data-check-source=preset]').count(), 6); }
    if (node === 'accept') { await page.getByRole('button', { name: '通过需求验收', exact: true }).click(); await page.getByRole('dialog', { name: '确认通过需求验收' }).waitFor(); await page.getByRole('dialog').getByRole('button', { name: /取\s*消/ }).click(); }
    const definition = taskNodeDefinitions[node as RequirementNode];
    assert.deepEqual(await page.locator('[data-node-section=result] [data-artifact-slot]').evaluateAll(items => items.map(item => (item as HTMLElement).dataset.artifactSlot)), definition.deliverableRequirements.filter(item=>!item.optional).map(item => item.id));
    assert.deepEqual(await page.locator('[data-completion-criterion]').evaluateAll(items => items.map(item => (item as HTMLElement).dataset.completionCriterion)), definition.completionCriteria.map(item => item.id));
    if (node !== 'accept') { assert.equal(await page.locator('[data-node-section=result] [data-artifact-status=ready]').count(), definition.deliverableRequirements.filter(item=>!item.optional).length); assert.equal(await page.locator('[data-criterion-status=reported]').count(), definition.completionCriteria.length); }
    if (node === 'develop') {
      const prd = taskNodeView(saved, saved.workspace.deliveryRequirements!.find(task => task.id === id)!, 'prepare').deliverables[0].references[0];
      assert.equal(await page.locator('[data-node-section=input] [data-artifact-slot=prd] [data-artifact-reference]').getAttribute('data-artifact-reference'), prd.id);
      await page.locator('[data-node-section=input] [data-artifact-slot=prd]').getByRole('button', { name: '查看引用', exact: true }).click(); assert.ok((await page.locator('.drawer-console').innerText()).includes('fixture://isolated-contract/prd')); await page.locator('.ant-drawer-open .ant-drawer-close').click(); await page.locator('.ant-drawer-open').waitFor({ state: 'hidden' });
    }
    checks.push({ id, node, events: expected.length });
  }
  await visit(ids[0], 'prepare');
  assert.equal(await page.locator('.project-delivery-sidebar').getAttribute('data-task-count'), '3');
  for (const id of [ids[1], ids[0]]) {
    await page.locator('[data-delivery-task="' + id + '"]').click();
    await page.locator('[data-material-task="' + id + '"]').waitFor();
    assert.equal(await page.locator('[data-delivery-task="' + id + '"]').getAttribute('aria-current'), 'page');
    assert.equal(new URLSearchParams(page.url().split('?').at(-1)).get('node'), 'accept');
  }
  await page.reload(); await page.locator('[data-material-task="' + ids[0] + '"]').waitFor();
  for (const theme of ['light', 'dark']) for (const width of [1600, 1440, 390]) {
    await page.evaluate(value => localStorage.setItem('carddemo-theme', value), theme); await page.setViewportSize({ width, height: 1050 }); await visit(ids[1], 'develop'); await page.reload(); await page.locator('[data-material-task="' + ids[1] + '"]').waitFor(); await page.locator('.page-scroll').evaluate(element => { element.scrollTop = 0; }); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
    const heading = await page.locator('.project-flow-heading').boundingBox(), title = await page.locator('.project-flow-heading>strong').boundingBox(); assert.ok(heading && title && heading.height <= 120 && title.width >= 180);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const sidebar = await page.locator('[data-delivery-task]').evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { width: r.width, height: r.height, overflow: node.scrollWidth > node.clientWidth }; }));
    assert.ok(sidebar.every(card => card.width > card.height && card.height >= 90 && card.height <= 110 && !card.overflow), JSON.stringify(sidebar));
    const main = await page.locator('.project-node-main').boundingBox(), material = await page.locator('.task-permanent-materials').boundingBox(); assert.ok(main && material);
    assert.ok(width >= 1440 ? material.x >= main.x + main.width - 1 : material.y >= main.y + main.height - 1);
    await page.screenshot({ path: out + '/' + theme + '-' + width + '.png', fullPage: true, animations: 'disabled' });
    if (width === 390) { await page.locator('.task-permanent-materials').scrollIntoViewIfNeeded(); await page.screenshot({ path: out + '/' + theme + '-' + width + '-materials.png', fullPage: true, animations: 'disabled' }); }
  }
  await visit(ids[1], 'verify', 'member'); assert.deepEqual(await page.locator('[data-delivery-task]').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.deliveryTask)), [ids[1], ids[0], 'MKT-UI-OTHER-003']);
  await page.reload(); await page.locator('[data-material-task="' + ids[1] + '"]').waitFor(); assert.equal(await page.getByRole('button', { name: '通过需求验收', exact: true }).count(), 0);
  await visit('MKT-UI-OTHER-003', 'develop', 'member'); assert.equal(await page.locator('[data-material-task=MKT-UI-OTHER-003]').count(), 1); assert.equal(await page.getByRole('button', { name: 'iCode 作业', exact: true }).isDisabled(), true);
  // Controlled transport fixtures exercise polling/scroll behavior only, without native execution claims.
  let streamEpoch = 1, streamOffline = false;
  const activeSession = 'ui-protocol-active', historySession = 'ui-protocol-history';
  const turn = (index: number, sessionId = activeSession): TaskSessionTurn => ({ id: sessionId + ':' + index, sessionId, runId: 'ui-only-run', nodeId: 'develop', turnId: 'native-turn-' + index, round: index + 1, startedAt: '2026-10-27T00:00:00Z', updatedAt: '2026-10-27T00:00:00Z', status: index === 29 && streamEpoch === 1 ? 'running' : 'ended', user: { id: 'user-' + index, at: '2026-10-27T00:00:00Z', text: '实际用户输入协议夹具 ' + index }, replies: [{ id: 'reply-' + index, at: '2026-10-27T00:00:01Z', text: '模型可见回复协议夹具 ' + index + (index === 29 && streamEpoch >= 2 ? ' · 增量追加的完整回复' : '') }] });
  const streamRoute = async (route: import('playwright').Route) => {
    const query = new URL(route.request().url()).searchParams;
    if (query.get('projectId') !== 'carddemo' || query.get('taskId') !== ids[1] || query.get('nodeId') !== 'develop') return route.fallback();
    if (streamOffline) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '协议夹具：对话读取暂不可用' }) });
    const selected = query.get('sessionId') ?? activeSession, initial = !query.get('cursor');
    const value: TaskSessionStreamResponse = { sessions: [{ id: activeSession, title: '协议夹具活动会话', tool: 'icode', nodeIds: ['develop'], runIds: ['ui-only-run'], status: 'running', lastAt: '2026-10-27T00:00:00Z' }, { id: historySession, title: '协议夹具历史会话', tool: 'icode', nodeIds: ['develop'], runIds: ['ui-only-run'], status: 'completed', lastAt: '2026-10-26T00:00:00Z' }], selectedSessionId: selected, turns: selected === historySession ? initial ? [turn(1, historySession)] : [] : initial ? Array.from({ length: streamEpoch === 3 ? 31 : 30 }, (_, index) => turn(index)) : query.get('cursor') === 'fixture:1' && streamEpoch >= 2 ? [turn(29), ...(streamEpoch === 3 ? [turn(30)] : [])] : query.get('cursor') === 'fixture:2' && streamEpoch === 3 ? [turn(30)] : [], cursor: 'fixture:' + streamEpoch, reset: initial, hasMore: false, observedAt: '2026-10-27T00:00:00Z', pollAfterMs: 1000, note: '只用于 UI 协议回归的传输夹具' };
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) });
  };
  await page.route('**/api/task-session-stream?**', streamRoute);
  await page.setViewportSize({ width: 1440, height: 1050 }); await visit(ids[1], 'develop');
  await page.locator('[data-session-turn="' + activeSession + ':29"]').waitFor(); assert.equal(await page.locator('[data-session-turn]').count(), 30);
  assert.equal(await page.locator('[data-message-role=user]').count(), 30); assert.equal(await page.locator('[data-message-role=assistant]').count(), 30); assert.doesNotMatch(await page.locator('.task-session-activity').innerText(), /工具开始|工具完成|工具错误|调用耗时|model.cycle|spans/);
  const eventViewport = page.locator('.task-session-events'); await eventViewport.scrollIntoViewIfNeeded();
  await eventViewport.evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')); }); streamEpoch = 2;
  const latest = page.getByRole('button', { name: '有新对话内容 · 查看最新', exact: true });
  await latest.waitFor(); assert.ok(await eventViewport.evaluate(element => element.scrollTop) < 2); assert.equal(await page.locator('[data-session-turn]').count(), 30); assert.equal(await page.locator('[data-session-message=reply-29]').count(), 1); assert.match(await page.locator('[data-session-message=reply-29]').innerText(), /增量追加的完整回复/);
  streamEpoch = 3; await page.locator('[data-session-turn="' + activeSession + ':30"]').waitFor(); assert.equal(await page.locator('[data-session-turn]').count(), 31); assert.ok(await eventViewport.evaluate(element => element.scrollTop) < 2);
  await latest.click(); assert.ok(await eventViewport.evaluate(element => element.scrollTop) > 0);
  await page.locator('.task-session-activity').scrollIntoViewIfNeeded(); await page.screenshot({path:out+'/conversation-turns.png',fullPage:false,animations:'disabled'});
  await page.getByRole('combobox', { name: '选择任务会话', exact: true }).click(); await page.getByTitle('协议夹具历史会话 · 已结束', { exact: true }).click();
  await page.locator('[data-session-turn="' + historySession + ':1"]').waitFor(); assert.equal(await page.locator('[data-session-turn]').count(), 1); assert.equal(await page.locator('[data-event-session="' + activeSession + '"]').count(), 0);
  await visit(ids[1], 'prepare'); await page.locator('.task-session-activity').waitFor(); assert.equal(await page.locator('[data-session-turn^=ui-protocol-]').count(), 0);
  streamOffline = true; await visit(ids[1], 'develop'); await page.getByText('会话过程读取未完成', { exact: true }).waitFor(); streamOffline = false;
  await page.locator('.task-session-activity').getByRole('button', { name: /重\s*试/ }).click(); await page.locator('[data-session-turn="' + activeSession + ':30"]').waitFor();
  await page.unroute('**/api/task-session-stream?**', streamRoute);
  // Imported source records share the same shell while keeping original evidence and identities.
  const snapshot = JSON.parse(await readFile('fixtures/teams-project.json', 'utf8')) as Presentation['teamsProject'];
  const importedChecks: object[] = [];
  const visitImported = async (task: string, node: string, role = 'owner') => { await page.goto(teams + '/teams?demo-role=' + role + '#/projects?' + new URLSearchParams({ project: 'teams', tab: 'delivery', task, node })); };
  await page.setViewportSize({ width: 1600, height: 1050 });
  for (const task of snapshot.tasks) for (const node of deliveryStages) {
    await visitImported(task.id, node); await page.locator('[data-material-task="' + task.id + '"]').waitFor();
    assert.deepEqual(await page.locator('.task-main-rail [data-flow-node]').evaluateAll(nodes => nodes.map(item => (item as HTMLElement).dataset.flowNode)), deliveryStages);
    assert.deepEqual(await page.locator('.task-main-rail strong').allTextContents(), ['需求澄清', '功能开发', '测试验证', '需求验收']);
    assert.equal(await page.locator('.task-talent-rail [data-flow-node]').count(), 4);
    assert.equal(await page.locator('[data-flow-node=auto-collection]').getByText('来源只读 · 未执行', { exact: true }).count(), 1);
    await page.locator('[data-flow-node=knowledge-prepare]').getByText('来源只读 · 未执行', { exact: true }).waitFor();
    assert.deepEqual(await page.locator('[data-node-section]>.framework-card>.card-heading>h2').allTextContents(), ['输入', '结果', '执行过程']);
    const material = await page.locator('.task-permanent-materials').innerText();
    assert.doesNotMatch(material, /本次采用的输入|查看输入来源详情/); for (const criterion of task.criteria) assert.ok(material.includes(criterion));
    assert.equal(await page.getByRole('button', { name: '通过需求验收', exact: true }).count(), 0);
    assert.equal(await page.locator('[data-collaboration-event]').count(), 0);
    assert.equal(await page.locator('.project-delivery-sidebar').getAttribute('data-task-count'), String(snapshot.tasks.length));
    const source = importedStage(task, node);
    assert.deepEqual(await page.locator('[data-node-section=result] [data-artifact-slot=source-output] [data-artifact-reference]').evaluateAll(nodes => nodes.map(item => (item as HTMLElement).dataset.artifactReference)), source.outputs.slice(0, 2).map(item => 'source:teams:' + task.id + ':' + item.id));
    if (source.outputs.length > 2) { await page.locator('[data-node-section=result] [data-artifact-slot=source-output]').getByRole('button', { name: '查看全部 ' + source.outputs.length + ' 项', exact: true }).click(); const sourceText = await page.locator('.drawer-console').innerText(); for (const output of source.outputs) assert.ok(sourceText.includes(output.output)); await page.locator('.ant-drawer-open .ant-drawer-close').click(); await page.locator('.ant-drawer-open').waitFor({ state: 'hidden' }); }
    for (const item of taskNodeDefinitions[node].deliverableRequirements) assert.equal(await page.locator('[data-node-section=result] [data-artifact-slot="' + item.id + '"]').getAttribute('data-artifact-status'), 'unregistered');
    assert.equal(await page.locator('[data-criterion-status=reported]').count(), 0);
    if(node==='verify'&&task.id==='T104'){
      const cases=page.locator('[data-node-section=input] [data-artifact-slot=test-cases]');
      await cases.getByText(/TEAMS-TC-001/).waitFor();assert.match(await cases.innerText(),/企业测试资产插件.*用例定义/);
      await cases.getByRole('button',{name:'查看引用',exact:true}).click();const text=await page.locator('.drawer-console').innerText();assert.match(text,/TEAMS-TC-001/);assert.match(text,/expected/);await page.locator('.ant-drawer-open .ant-drawer-close').click();
    }
    if(node==='verify'&&task.id==='T108')assert.equal(await page.locator('[data-node-section=input] [data-artifact-slot=test-cases] [data-artifact-reference]').count(),0);
    if (source.nodes.length) {
      await page.getByText('查看本阶段原节点与作业记录', { exact: true }).click();
      assert.deepEqual(await page.locator('[data-imported-source-node]').evaluateAll(nodes => nodes.map(item => (item as HTMLElement).dataset.importedSourceNode)), source.nodes.map(item => item.id));
      await page.getByRole('button', { name: '查看原节点详情', exact: true }).first().click();
      assert.deepEqual(JSON.parse(await page.locator('.drawer-console').innerText()), source.nodes[0]);
      await page.locator('.ant-drawer-open .ant-drawer-close').click(); await page.locator('.ant-drawer-open').waitFor({ state: 'hidden' });
    } else { await page.getByText('来源未提供此阶段记录', { exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: 'iCode 作业', exact: true }).count(), 0); }
    importedChecks.push({ task: task.id, node, sourceNodeIds: source.nodes.map(item => item.id) });
  }
  await visitImported('T104', 'review'); await page.locator('[data-material-task=T104]').waitFor(); assert.equal(await page.locator('[data-flow-node=prepare]').getAttribute('aria-current'), 'step');
  assert.equal(await page.getByRole('button', { name: 'iCode 作业', exact: true }).isDisabled(), true);
  assert.equal(await page.locator('[data-task-group=mine]').getAttribute('data-group-count'), '0');
  await page.getByRole('button', { name: '查看需求执行记录', exact: true }).click(); await page.getByRole('dialog', { name: 'T104 · 来源执行记录' }).waitFor();
  await page.locator('.ant-drawer-open .ant-drawer-close').click(); await page.locator('.ant-drawer-open').waitFor({ state: 'hidden' });
  await page.locator('[data-delivery-task=T108]').click(); await page.locator('[data-material-task=T108]').waitFor(); await page.reload(); await page.locator('[data-material-task=T108]').waitFor();
  await page.getByRole('button', { name: '查看需求执行记录', exact: true }).click(); await page.getByText('此任务阶段未提供关联作业快照', { exact: true }).waitFor();
  await page.locator('.ant-drawer-open .ant-drawer-close').click(); await page.locator('.ant-drawer-open').waitFor({ state: 'hidden' });
  for (const theme of ['light', 'dark']) for (const width of [1440, 390]) {
    await page.evaluate(value => localStorage.setItem('carddemo-theme', value), theme); await page.setViewportSize({ width, height: 1050 });
    await visitImported('T104', 'prepare'); await page.reload(); await page.locator('[data-material-task=T104]').waitFor(); await page.locator('.page-scroll').evaluate(element => { element.scrollTop = 0; });
    assert.equal(await page.locator('html').getAttribute('data-theme'), theme); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: out + '/teams-' + theme + '-' + width + '.png', fullPage: true, animations: 'disabled' });
    if (width === 390) { await page.locator('.task-permanent-materials').scrollIntoViewIfNeeded(); await page.screenshot({ path: out + '/teams-' + theme + '-' + width + '-materials.png', fullPage: true, animations: 'disabled' }); }
  }
  await visitImported('T104', 'prepare', 'member'); await page.locator('[data-material-task=T104]').waitFor();
  assert.equal(await page.locator('[data-delivery-task]').count(), snapshot.tasks.length); assert.equal(await page.getByRole('button', { name: '查看需求执行记录', exact: true }).count(), 1); assert.equal(await page.getByRole('button', { name: 'iCode 作业', exact: true }).isDisabled(), true);
  assert.deepEqual(posts, []); assert.deepEqual(errors, []); assert.deepEqual(await hashes(), before);
  await writeFile(out + '/result.json', JSON.stringify({ passed: true, checks, importedChecks, importedSourceNodesPreserved: true, sidebarRepeatedInputsRemoved: true, streamUiProtocol: { sessionSwitch: true, incrementalTurns: true, sameMessageUpdates: true, noToolTimeline: true, readingPositionPreserved: true, latestJump: true, scopeCleared: true, explicitErrorAndRetry: true, nativeExecution: false }, fixedThreeSections: true, permanentMaterials: true, compactTasks: true, roleScope: true, browserPostAttempts: posts, pageErrors: errors, isolatedStateUnchanged: true, nativeInvocations: 0 }, null, 2));
  console.log('Unified delivery UI passed: 8 live + 20 imported task nodes, exact source records, source launch scope, 10 layouts, permanent materials, 0 browser POST/native, isolated state unchanged');
} finally {
  await browser?.close();
  await Promise.all(children.map(child => new Promise<void>(resolve => { if (child.exitCode !== null) { resolve(); return; } child.once('exit', () => resolve()); child.kill('SIGTERM'); })));
  await rm(dir, { recursive: true, force: true });
}
