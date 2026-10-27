import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { chromium, type Browser, type Route } from 'playwright';
import { initialState } from '../src/domain.js';
import { createDeliveryRequirement } from '../src/delivery-requirements.js';
import { queueTaskPreparation, taskAutomation } from '../src/task-automation.js';
import type { TalentNodeInputs } from '../src/talent-node-inputs.js';
import type { ProjectWorkPlan } from '../src/project-work.js';
import type { NativePreparationReceipt } from '../src/native-preparation.js';

// UI protocol projections only: no server/native/model launch or persisted state.
const origin = 'http://127.0.0.1:46241', out = 'test-results/task-preparation';
const at = '2026-10-28T00:00:00.000Z', state = initialState();
const data = { ...JSON.parse(await readFile('fixtures/presentation.json', 'utf8')), teamsProject: JSON.parse(await readFile('fixtures/teams-project.json', 'utf8')), baseline: JSON.parse(await readFile('teams-baseline.json', 'utf8')), skillCatalog: [], skillContents: {}, localPaths: { cli: 'fixture/cli', collaborationSkill: 'fixture/SKILL.md' } };
const tasks = ['carddemo', 'teams'].map(projectId => {
  const task = createDeliveryRequirement(state, 'owner', { projectId, id: 'REQ-' + randomUUID(), title: projectId + ' 自动准备范围', description: projectId + ' 独立需求背景；其他业务政策待确认。', assigneeId: 'member' }, at);
  queueTaskPreparation(state, { projectId, taskId: task.id }, at); return task;
});
const receipts = new Map<string, NativePreparationReceipt>();
for (const task of tasks) receipts.set(task.id, { status: 'ready', sessionId: randomUUID(), runId: randomUUID(), directory: '/fixture/project', preparedAt: at, contextPath: '/fixture/context', skillPath: '/fixture/skill', contextSha256: 'a'.repeat(64), sessionSha256: 'b'.repeat(64), agent: 'fixture-agent', agentLabel: '隔离配置', model: 'fixture-model', modelLabel: '隔离配置', readEvidence: [{ path: '/fixture/context', callId: 'fixture-read', sha256: 'a'.repeat(64) }], summary: '隔离界面夹具，不代表真实执行' });
const nodeInputs = (projectId: string, taskId: string, nodeId: 'prepare'|'develop'|'verify' = 'prepare'): TalentNodeInputs => ({ projectId, taskId, generation: 'fixture', origin: 'ui-fixture', nodeId, requirement: { id: taskId, title: '需求', description: '范围背景' }, knowledge: { status: 'ready', version: '1', assets: [{ id: taskId + '-knowledge', title: projectId + ' ' + nodeId + ' 当前任务业务规则', version: '1', detail: '界面隔离夹具', origin: 'teams-node-preset' }] }, skills: [{ id: 'bank-domain-marketing', name: projectId + ' ' + nodeId + ' 当前任务业务 Skill', version: '1.0.0', sha256: 'a'.repeat(64), contentSha256: 'b'.repeat(64), content: '界面隔离夹具', source: 'teams-registered-package' }], selection: { version: '1', source: 'teams-node-selection', status: 'configured', basis: 'recommendation', note: '仅当前任务节点的输入', missingSkillIds: [], knowledge: [{ id: taskId + '-knowledge', slot: nodeId === 'prepare' ? 'business-documents' : nodeId === 'develop' ? 'development-knowledge' : 'project-standards', reason: '范围匹配', nodeId }], skills: [{ id: 'bank-domain-marketing', slot: nodeId === 'prepare' ? 'business-skills' : nodeId === 'develop' ? 'project-standards' : 'quality-skills', reason: '范围匹配', nodeId }] } });
const plan = (taskId: string, valid = false): ProjectWorkPlan => {
  const task = tasks.find(task => task.id === taskId)!, receipt = receipts.get(taskId)!;
  const ready = taskAutomation(state, { projectId: task.projectId, taskId })?.preparation?.status === 'ready';
  return { target: { projectId: task.projectId, taskId, nodeId: 'prepare', tab: 'delivery' }, projectName: task.projectId, title: task.title, location: '需求澄清', source: '隔离测试', planToken: 'fixture-token', instance: { name: 'iCode', installed: true, terminal: { id: 'fixture', name: '隔离终端' } }, directory: { root: valid || ready ? receipt.directory : null, valid: valid || ready, kind: 'git-binding', diagnostic: '需要有效项目目录' }, context: { frozen: false, summary: '本任务输入', versions: '1', selectedSkills: [], assets: [] }, defaultAction: ready ? 'resume' : 'new', actions: ready ? [{ id: 'resume', label: '进入已准备会话', enabled: true }] : [{ id: 'new', label: '等待会话准备', enabled: false }], ...(ready ? { history: { sessionId: receipt.sessionId, directory: receipt.directory, title: task.title, available: true, active: null, configuration: { agent: receipt.agent, agentLabel: receipt.agentLabel, model: receipt.model, modelLabel: receipt.modelLabel } } } : {}) };
};
const bundle = await build({ entryPoints: ['src/main.tsx'], bundle: true, outdir: out + '/bundle', write: false, format: 'esm', minify: true, target: ['chrome120'], define: { 'process.env.NODE_ENV': '"production"' } });
const html = '<!doctype html><html lang="zh-CN"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/main.css"><div id="root"></div><script type="application/json" id="demo-system-runtime">' + JSON.stringify({ app: 'teams', teamsOrigin: origin, talentOrigin: 'http://127.0.0.1:46242' }) + '</script><script type="module" src="/main.js"></script></html>';
let browser: Browser | undefined, heldInput: Route | undefined, delayTask: string | undefined;
const errors: string[] = [], posts: Array<{path:string;body:any}> = [], inputRequests: string[] = [], nodeRequests: string[] = [], checks: string[] = [];
try {
  await mkdir(out, { recursive: true }); browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(8000); page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), json = (value: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) });
    const asset = bundle.outputFiles.find(file => '/' + basename(file.path) === url.pathname);
    if (asset) return route.fulfill({ contentType: asset.path.endsWith('.css') ? 'text/css' : 'text/javascript', body: Buffer.from(asset.contents) });
    if (url.pathname === '/teams' || url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
    if (request.method() === 'POST') {
      const body = request.postDataJSON(); posts.push({ path: url.pathname, body });
      if (url.pathname === '/api/native/work-bind') return json(plan(body.target.taskId, true));
      if (url.pathname === '/api/task-automation' && body.step === 'preparation') { const record = taskAutomation(state, body)!; record.preparation!.status = 'preparing-session'; record.preparation!.retryable = false; state.revision++; return json(state); }
      throw new Error('Unexpected write: ' + url.pathname);
    }
    if (url.pathname === '/api/bootstrap') return json({ token: 'fixture', state, data });
    if (url.pathname === '/api/state') return json(state);
    if (url.pathname === '/api/session') return json({ token: 'fixture' });
    if (url.pathname === '/api/task-node-inputs') { inputRequests.push(url.searchParams.get('taskId')!); nodeRequests.push(url.searchParams.get('taskId')! + '/' + url.searchParams.get('nodeId'));  if (url.searchParams.get('taskId') === delayTask) { heldInput = route; return; } return json(nodeInputs(url.searchParams.get('projectId')!, url.searchParams.get('taskId')!,url.searchParams.get('nodeId')! as 'prepare'|'develop'|'verify')); }
    if (url.pathname === '/api/task-session-stream') return json({ sessions: [], selectedSessionId: null, turns: [], cursor: null, reset: true, hasMore: false, observedAt: at, pollAfterMs: 2000, note: '未提供真实会话，不能生成对话内容。' });
    if (url.pathname === '/api/project-work') return json(plan(url.searchParams.get('taskId')!));
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not configured in fixture"}' });
  });
  const visit = async (index: number, role = 'member', node = 'prepare') => { const task = tasks[index]; await page.goto(origin + '/teams?demo-role=' + role + '#/projects?' + new URLSearchParams({ project: task.projectId, tab: 'delivery', task: task.id, node })); await page.locator('[data-delivery-scope="' + task.projectId + '/' + task.id + '"]').waitFor(); };
  const advance = (index: number, status: 'importing'|'preparing-session'|'ready'|'failed'|'waiting-directory') => { const record = taskAutomation(state, { projectId: tasks[index].projectId, taskId: tasks[index].id })!; record.preparation!.status = status; record.preparation!.updatedAt = new Date(Date.parse(at) + state.revision * 1000).toISOString(); record.knowledge!.status = status === 'importing' ? 'running' : 'ready'; record.preparation!.progress.push({ at: record.preparation!.updatedAt, phase: status === 'importing' ? 'knowledge' : 'session', status: status === 'ready' ? 'completed' : status === 'failed' ? 'failed' : status === 'waiting-directory' ? 'waiting' : 'started', source: status === 'importing' ? 'teams-import' : 'native-cli', summary: tasks[index].projectId + ' ' + status + ' 准备进展' }); record.preparation!.retryable = ['failed','waiting-directory'].includes(status); if (status === 'ready') record.preparation!.session = receipts.get(tasks[index].id); state.revision++; };
  for (const index of [0,1]) {
    const task = tasks[index], input = page.locator('[data-node-section=input]'); await visit(index);
    await page.locator('[data-flow-node=knowledge-prepare]').getByText('待获取', { exact: true }).waitFor();
    assert.ok(await page.getByRole('button', { name: 'iCode 作业', exact: true }).isEnabled());
    await page.getByRole('button',{name:'iCode 作业',exact:true}).click();const firstConfirmation=page.getByRole('dialog',{name:'准备 iCode 会话',exact:true});await firstConfirmation.waitFor();await firstConfirmation.getByRole('button',{name:/取\s*消/}).click();assert.equal(posts.length,0);
    assert.match(await input.innerText(), new RegExp(task.description)); assert.equal(await input.locator('[data-artifact-slot]').count(), 0); assert.equal(inputRequests.includes(task.id), false);
    advance(index, 'importing'); await page.locator('[data-flow-node=knowledge-prepare]').getByText('获取中', { exact: true }).waitFor();
    assert.equal(inputRequests.includes(task.id), false); assert.equal(await input.locator('[data-artifact-slot]').count(), 0);
    await page.reload(); await input.getByText('获取中', { exact: true }).waitFor(); assert.equal(inputRequests.includes(task.id), false);
    if (index === 0) await page.screenshot({path:out+'/importing.png',animations:'disabled'});
    advance(index, 'preparing-session'); await page.locator('[data-flow-node=prepare]').getByText('准备会话', { exact: true }).waitFor();
    await page.locator('[data-flow-node=knowledge-prepare]').getByText('已完成', { exact: true }).waitFor();
    await input.getByText(task.projectId + ' prepare 当前任务业务规则', { exact: true }).waitFor();
    assert.ok(await page.getByRole('button', { name: 'iCode 作业', exact: true }).isEnabled());
    await page.locator('[aria-label=任务进展]').getByText(task.projectId + ' preparing-session 准备进展', { exact: true }).waitFor();
    assert.equal(await page.locator('[data-session-turn]').count(), 0);
    if (index === 0) await page.locator('[aria-label=任务进展]').screenshot({path:out+'/preparing-progress.png',animations:'disabled'});
    advance(index, 'ready');
    if (index === 0) {
      const preparation = taskAutomation(state, {projectId:task.projectId,taskId:task.id})!.preparation!;
      delete preparation.session; state.revision++;
      await page.locator('[data-flow-node=prepare]').getByText('正在核对会话',{exact:true}).waitFor();
      assert.ok(await page.getByRole('button',{name:'iCode 作业',exact:true}).isEnabled());
      preparation.session = receipts.get(task.id); state.revision++;
    }
    await page.locator('[data-flow-node=prepare]').getByText('会话已准备', { exact: true }).waitFor();
    assert.ok(await page.getByRole('button', { name: 'iCode 作业', exact: true }).isEnabled());
    await page.getByRole('button', { name: 'iCode 作业', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '进入已准备会话', exact: true }); await dialog.waitFor();
    assert.ok(await dialog.getByRole('radio', { name: '进入已准备会话', exact: true }).isChecked());
    assert.equal(await dialog.getByRole('radio').count(), 1); await dialog.locator('.ant-modal-close').click();
    await page.screenshot({ path: `${out}/${task.projectId}-ready.png`, animations: 'disabled' });
    await visit(index, 'owner'); assert.ok(await page.getByRole('button', { name: 'iCode 作业', exact: true }).isDisabled());
    checks.push(task.projectId + ': background-only until import, polling inputs, receipt gate, resume only, other actor disabled, no synthetic turns');
  }
  assert.equal(posts.length, 0);
  for (const index of [0,1]) {
    const task = tasks[index], record = taskAutomation(state, { projectId:task.projectId, taskId:task.id })!;
    const preparedSession = record.preparation!.session!.sessionId;
    await visit(index,'member','develop');
    await page.locator('[data-flow-node=knowledge-develop]').getByText('等待上游',{exact:true}).waitFor();
    assert.equal(nodeRequests.includes(task.id+'/develop'),false);
    assert.ok(await page.getByRole('button',{name:'iCode 作业',exact:true}).isDisabled());
    assert.equal(await page.locator('.task-talent-rail [data-flow-node]').count(),4);
    assert.deepEqual(await page.locator('.task-talent-rail button>strong').allTextContents(),['需求知识获取','开发知识获取','测试知识获取','数据收集']);
    const advanceNode = (node:'develop'|'verify',status:'queued'|'running'|'ready'|'failed') => {
      const item=record.nodeKnowledge![node]!;item.status=status;item.startedAt=at;item.finishedAt=status==='ready'?at:null;
      if(status==='ready')item.nodeInputs=nodeInputs(task.projectId,task.id,node);
      if(status==='failed')item.error='隔离测试中的阶段获取失败';state.revision++;
    };
    advanceNode('develop','queued');await page.locator('[data-flow-node=knowledge-develop]').getByText('待获取',{exact:true}).waitFor();
    advanceNode('develop','running');await page.locator('[data-flow-node=knowledge-develop]').getByText('获取中',{exact:true}).waitFor();
    assert.equal(nodeRequests.includes(task.id+'/develop'),false);
    assert.equal(await page.locator('[data-flow-node=knowledge-develop]').evaluate(el=>getComputedStyle(el).animationName),'task-flow-breathe');
    const directions=await page.locator('[data-connection]').evaluateAll(elements=>Object.fromEntries(elements.map(el=>[el.getAttribute('data-connection'),el.getAttribute('d')])));
    for(const node of ['prepare','develop','verify']) {const points=directions['knowledge-'+node]!.match(/-?\d+(?:\.\d+)?/g)!.map(Number);assert.ok(points[3]<points[1],'knowledge arrow points upward');}
    const down=directions['accept-collection']!.match(/-?\d+(?:\.\d+)?/g)!.map(Number);assert.ok(down[3]>down[1]);
    const colors=await page.locator('.task-flow-card>strong').evaluateAll(elements=>elements.map(el=>getComputedStyle(el).color));
    const textColor=await page.locator('body').evaluate(el=>getComputedStyle(el).color);assert.ok(colors.every(color=>color===textColor),'node titles use readable body text in both rails');
    const mainColor=await page.locator('[data-connection=prepare-develop]').evaluate(el=>getComputedStyle(el).stroke),talentColor=await page.locator('[data-connection=knowledge-prepare]').evaluate(el=>getComputedStyle(el).stroke);assert.notEqual(mainColor,talentColor,'main and Talent retain distinct structure colors');
    const selectedStyle=await page.locator('.task-flow-card.selected').evaluate(el=>({outline:getComputedStyle(el).outlineWidth,marker:getComputedStyle(el,'::after').width}));assert.deepEqual(selectedStyle,{outline:'2px',marker:'3px'},'selection remains explicit without colored headings');
    assert.equal(await page.locator('[data-flow-node=knowledge-develop] .ant-tag').getAttribute('data-status-tone'),'processing');assert.ok(await page.locator('[data-flow-node=knowledge-develop] .ant-tag-blue').count());
    if(index===0)await page.locator('.task-delivery-flow').screenshot({path:out+'/four-stages-running.png',animations:'disabled'});
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await page.locator('[data-flow-node=knowledge-develop]').evaluate(el=>getComputedStyle(el).animationName),'none');
    assert.equal(await page.locator('[data-flow-node=knowledge-develop] .flow-progress-icon svg').evaluate(el=>getComputedStyle(el).animationName),'none');
    await page.emulateMedia({reducedMotion:'no-preference'});
    advanceNode('develop','ready');task.nodes.develop.status='running';state.revision++;
    await page.locator('[data-node-section=input]').getByText(task.projectId+' develop 当前任务业务规则',{exact:true}).waitFor();
    assert.equal(await page.locator('[data-flow-node=knowledge-develop]').evaluate(el=>getComputedStyle(el).animationName),'none');
    assert.equal(await page.locator('[data-flow-node=develop]').evaluate(el=>getComputedStyle(el).animationName),'task-flow-breathe');
    assert.ok(await page.getByRole('button',{name:'iCode 作业',exact:true}).isEnabled());
    await page.getByRole('button',{name:'测试知识获取详情',exact:true}).click();await page.getByRole('dialog').getByText('等待上游',{exact:true}).waitFor();
    assert.doesNotMatch(await page.getByRole('dialog').innerText(),/develop 当前任务业务规则/);await page.getByRole('dialog').locator('.ant-drawer-close').click();
    await visit(index,'member','verify');assert.equal(nodeRequests.includes(task.id+'/verify'),false);
    advanceNode('verify','running');await page.locator('[data-flow-node=knowledge-verify]').getByText('获取中',{exact:true}).waitFor();
    advanceNode('verify','failed');await page.locator('[data-flow-node=knowledge-verify]').getByText('获取失败',{exact:true}).waitFor();
    assert.ok(await page.locator('[data-flow-node=knowledge-verify] .ant-tag-red').count());
    assert.equal(await page.locator('[data-flow-node=knowledge-verify]').evaluate(el=>getComputedStyle(el).animationName),'none');
    advanceNode('verify','ready');task.nodes.develop.status='complete';task.nodes.verify.status='running';state.revision++;
    await page.locator('[data-node-section=input]').getByText(task.projectId+' verify 当前任务业务规则',{exact:true}).waitFor();
    assert.doesNotMatch(await page.locator('[data-node-section=input]').innerText(),/develop 当前任务业务规则|prepare 当前任务业务规则/);
    assert.equal(record.preparation!.session!.sessionId,preparedSession);assert.equal(await page.locator('[data-session-turn]').count(),0);
    await page.reload();await page.locator('[data-node-section=input]').getByText(task.projectId+' verify 当前任务业务规则',{exact:true}).waitFor();
    checks.push(task.projectId+': four ordered Talent columns, exact upward/downward edges, two colors, per-node readiness, no inherited inputs or extra session, motion stops/reduced-motion');
  }
  assert.equal(posts.length,0);
  delayTask = tasks[0].id; await visit(0);
  for (let i=0;i<50&&!heldInput;i++) await new Promise(resolve=>setTimeout(resolve,20));
  assert.ok(heldInput, 'node-input response held for scope isolation');
  await page.evaluate(task => {location.hash='/projects?'+new URLSearchParams({project:task.projectId,tab:'delivery',task:task.id,node:'prepare'});}, tasks[1]);
  await page.locator('[data-delivery-scope="teams/'+tasks[1].id+'"]').waitFor();
  await heldInput.fulfill({contentType:'application/json',body:JSON.stringify(nodeInputs('carddemo',tasks[0].id))}); delayTask=undefined;
  await page.locator('[data-node-section=input]').getByText('teams prepare 当前任务业务规则',{exact:true}).waitFor();
  assert.doesNotMatch(await page.locator('[data-node-section=input]').innerText(), /carddemo/);
  checks.push('late node-input response cannot repopulate a different project/task after SPA navigation');
  advance(0, 'failed'); taskAutomation(state, {projectId:'carddemo',taskId:tasks[0].id})!.preparation!.error = '界面测试中的准备失败'; await visit(0);
  await page.getByRole('button', { name: '重新准备', exact: true }).click(); await page.locator('[data-flow-node=prepare]').getByText('准备会话', {exact:true}).waitFor();
  assert.equal(posts.at(-1)!.body.taskId, tasks[0].id); assert.equal(posts.at(-1)!.body.step, 'preparation');
  advance(0, 'waiting-directory'); await page.getByRole('button', { name: '配置工作目录', exact: true }).click();
  const directoryDialog = page.getByRole('dialog', { name:'配置工作目录', exact:true }); await directoryDialog.waitFor(); assert.equal(await directoryDialog.getByRole('radio').count(),0);
  await directoryDialog.getByRole('textbox', {name:'本机工作目录',exact:true}).fill('/fixture/project'); await directoryDialog.getByRole('button',{name:'核验并绑定目录',exact:true}).click();
  await directoryDialog.waitFor({state:'hidden'}); assert.deepEqual(posts.slice(-2).map(item=>item.path),['/api/native/work-bind','/api/task-automation']);
  await visit(1); assert.doesNotMatch(await page.locator('[data-preparation-task]').innerText(), /carddemo/);
  await page.setViewportSize({width:390,height:844}); await page.screenshot({path:out+'/ready-narrow.png',animations:'disabled'}); assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.equal(posts.filter(item=>item.path==='/api/native/work-start').length,0); assert.deepEqual(errors,[]);
  checks.push('scope switch, failed retry, directory binding schedules preparation without start, refresh, 390px layout');
  await writeFile(out+'/result.json',JSON.stringify({passed:true,checks,posts:posts.map(item=>({path:item.path,taskId:item.body.taskId??item.body.target?.taskId})),errors},null,2));
  console.log(JSON.stringify({passed:true,checks,out}));
} finally { await browser?.close(); }
