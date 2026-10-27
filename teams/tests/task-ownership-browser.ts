import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { chromium, type Browser } from 'playwright';
import { initialState } from '../src/domain.js';
import { createDeliveryRequirement } from '../src/delivery-requirements.js';
import { updateWorkspace } from '../src/workspace.js';

// Isolated display fixtures; no iCode execution or fabricated production receipt.
const dir = await mkdtemp(join(tmpdir(), 'task-ownership-ui-'));
const out = 'test-results/task-ownership';
const teams = 'http://127.0.0.1:46076';
const talent = 'http://127.0.0.1:46086';
const projectId = '29292929-2929-4292-8292-292929292929';
let state = updateWorkspace(initialState(), 'project.create', 'owner', { id: projectId, name: '任务归属验证项目', description: '', remoteUrl: 'https://github.com/example/ownership.git', repositoryIdentity: 'github.com/example/ownership' });
const at = '2026-10-27T00:00:00Z';
const privateId='30303030-3030-4030-8030-303030303030', privateTeam='team-'+privateId;
state=updateWorkspace(state,'team.create','owner',{id:privateTeam,name:'Owner 专属团队'});
state=updateWorkspace(state,'project.create','owner',{id:privateId,name:'未加入的项目',description:'',remoteUrl:'https://github.com/example/private.git',repositoryIdentity:'github.com/example/private',teamId:privateTeam});
for (const [project, id, assigneeId, title] of [
  ['carddemo', 'MKT-OWNER-UI', 'owner', 'Owner 本人交付任务'],
  ['carddemo', 'MKT-MEMBER-UI', 'member', '陈晨本人交付任务'],
  ['carddemo', 'MKT-OTHER-UI', 'su', '其他交付人的任务：较长标题用于核对紧凑列表与省略'],
  [projectId, 'MKT-CREATED-UI', 'owner', '新项目 Owner 交付任务'],
  [privateId, 'MKT-PRIVATE-UI', 'owner', '非共享团队交付任务'],
] as const) {
  const task = createDeliveryRequirement(state, 'owner', { projectId: project, id, assigneeId, title, description: id + ' 仅为隔离界面范围夹具，不是已执行成果。', skillIds: ['dev-frontend-ui'] }, at);
  task.stage = 'developing'; task.preparedAt = at;
}
state.workspace.genericTasks = [
  { id: 'GT-00000000-0000-4000-8000-000000000001', projectId: 'carddemo', title: 'Owner 通用任务', description: '', assigneeId: 'owner', due: null, status: 'pending', result: '', createdAt: at, updatedAt: at },
  { id: 'GT-00000000-0000-4000-8000-000000000002', projectId: 'carddemo', title: '成员通用任务', description: '', assigneeId: 'member', due: null, status: 'pending', result: '', createdAt: at, updatedAt: at },
];
await mkdir(join(dir, 'teams'), { recursive: true });
await writeFile(join(dir, 'teams/state.json'), JSON.stringify(state));
const bundle = await build({ entryPoints: ['src/main.tsx'], bundle: true, outdir: join(out, 'bundle'), write: false, format: 'esm', minify: true, target: ['chrome120'], define: { 'process.env.NODE_ENV': '"production"' } });
const env = { ...process.env, DEMO_PORT: '46076', DEMO_TALENT_PORT: '46086', DEMO_STATE_DIR: join(dir, 'teams'), DEMO_SHARED_DIR: join(dir, 'shared'), DEMO_SHARED_SEED_DIR: join(dir, 'no-seed'), DEMO_NATIVE_DISABLED: '1' };
let logs = '', browser: Browser | undefined;
const children = ['server/index.ts'].map(entry => { const child = spawn(process.execPath, ['--import', 'tsx', entry], { env, stdio: ['ignore', 'pipe', 'pipe'] }); child.stdout.on('data', data => logs += data); child.stderr.on('data', data => logs += data); return child; });
const hashes = async () => Promise.all([join(dir, 'teams/state.json')].map(async path => createHash('sha256').update(await readFile(path)).digest('hex')));
try {
  let ready = false;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(teams + '/api/health')).ok) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.ok(ready, logs); const before = await hashes();
  await mkdir(out, { recursive: true });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } }); page.setDefaultTimeout(7000);
  const posts: string[] = [], errors: string[] = [], planRequests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/project-work') planRequests.push(request.url()); });
  await page.route('**/*', route => { if (route.request().method() !== 'GET') { posts.push(route.request().url()); return route.abort(); } const file = bundle.outputFiles.find(file => '/' + basename(file.path) === new URL(route.request().url()).pathname); return file ? route.fulfill({ contentType: file.path.endsWith('.css') ? 'text/css' : 'text/javascript', body: Buffer.from(file.contents) }) : route.continue(); });
  const visit = async (role: string, task?: string, project = 'carddemo') => { await page.goto(teams + '/teams?demo-role=' + role + '#/projects?' + new URLSearchParams({ project, tab: 'delivery', ...(task ? { task, node: 'develop' } : {}) })); await page.locator('.project-delivery-sidebar').waitFor(); };
  const selected = async () => page.locator('[data-delivery-task][aria-current=page]').getAttribute('data-delivery-task');
  const groupIds = async (group: string) => page.locator('[data-task-group=' + group + '] [data-delivery-task]').evaluateAll(items => items.map(item => (item as HTMLElement).dataset.deliveryTask));
  const switchRole = async (role: 'owner' | 'member') => { await page.getByRole('combobox', { name: '切换角色' }).click(); await page.locator('.ant-select-item-option-content').getByText(role === 'owner' ? '林悦 · 项目 Owner' : '陈晨 · 项目成员', { exact: true }).click(); };
  const launch = () => page.getByRole('button', { name: 'iCode 作业', exact: true });
  await visit('owner'); assert.equal(await selected(), 'MKT-OWNER-UI');
  assert.deepEqual(await groupIds('mine'), ['MKT-OWNER-UI']); assert.deepEqual((await groupIds('others')).sort(), ['DEMO-MKT-001', 'MKT-MEMBER-UI', 'MKT-OTHER-UI']);
  assert.equal(await page.locator('[data-task-group=mine]').getAttribute('data-group-count'), '1'); assert.equal(await page.locator('[data-task-group=others]').getAttribute('data-group-count'), '3');
  assert.equal(await launch().isEnabled(), true);
  const ownerPlan = page.waitForResponse(response => new URL(response.url()).pathname === '/api/project-work'); await launch().click(); assert.equal((await ownerPlan).status(), 200); await page.getByRole('dialog', { name: '启动 iCode', exact: true }).waitFor(); await page.locator('.project-work-modal .ant-modal-close').click();
  // Explicit selection remains shared across a role change; only execution controls change.
  await page.locator('[data-delivery-task=MKT-OWNER-UI]').click(); await switchRole('member');
  assert.equal(await selected(), 'MKT-OWNER-UI'); assert.deepEqual(await groupIds('mine'), ['MKT-MEMBER-UI']); assert.equal(await launch().isDisabled(), true);
  const requestCount = planRequests.length; const entrance = page.locator('.project-work-entrance'); await entrance.focus(); await page.keyboard.press('Enter'); await page.getByRole('tooltip').filter({ hasText: '由林悦负责，仅交付人可启动' }).waitFor(); assert.equal(planRequests.length, requestCount);
  await page.reload(); await page.locator('[data-material-task=MKT-OWNER-UI]').waitFor(); assert.equal(await selected(), 'MKT-OWNER-UI'); assert.equal(await launch().isDisabled(), true);
  await page.locator('[data-delivery-task=MKT-MEMBER-UI]').click(); await page.locator('[data-material-task=MKT-MEMBER-UI]').waitFor(); assert.equal(await launch().isEnabled(), true);
  const memberPlan = page.waitForResponse(response => new URL(response.url()).pathname === '/api/project-work'); await launch().click(); assert.equal((await memberPlan).status(), 200); await page.getByRole('dialog', { name: '启动 iCode', exact: true }).waitFor(); await page.locator('.project-work-modal .ant-modal-close').click();
  await switchRole('owner'); assert.equal(await selected(), 'MKT-MEMBER-UI'); assert.equal(await launch().isDisabled(), true);
  await page.locator('[data-delivery-task=DEMO-MKT-001]').click(); await page.locator('[data-material-task=DEMO-MKT-001]').waitFor(); assert.equal(await launch().isDisabled(), true); assert.match(await entrance.getAttribute('title') ?? '', /尚未分配/);
  for (const role of ['owner', 'member']) {
    await visit(role, 'MKT-OTHER-UI'); assert.equal(await selected(), 'MKT-OTHER-UI'); assert.equal(await launch().isDisabled(), true); assert.equal(await page.locator('[data-material-task=MKT-OTHER-UI]').count(), 1);
    await page.goto(teams + '/teams?demo-role=' + role + '#/projects?project=carddemo&tab=management'); await page.getByRole('tab', { name: '需求 · 8', exact: true }).waitFor();
    for (const title of ['Owner 本人交付任务', '陈晨本人交付任务']) assert.equal(await page.getByRole('button', { name: title, exact: true }).count(), 1);
    await page.getByRole('tab', { name: '通用任务 · 2', exact: true }).click(); await page.getByRole('button', { name: 'Owner 通用任务', exact: true }).click(); await page.getByRole('dialog', { name: 'Owner 通用任务', exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: '开始处理任务', exact: true }).count(), role === 'owner' ? 1 : 0);
  }
  await visit('owner', 'MKT-PRIVATE-UI', privateId); assert.equal(await launch().isEnabled(), true); await switchRole('member'); await page.getByText('当前身份不在该项目任务范围内', {exact:true}).waitFor(); assert.equal(await page.locator('[data-delivery-task],.task-permanent-materials').count(),0); assert.equal(await launch().count(),0);
  await visit('member', undefined, projectId); assert.equal(await selected(), 'MKT-CREATED-UI'); assert.deepEqual(await groupIds('mine'), []); assert.equal(await launch().isDisabled(), true); await page.getByText('暂无本人任务', { exact: true }).waitFor();
  await visit('member', 'MKT-CREATED-UI'); await page.getByText('此项目中不存在该需求任务', { exact: true }).waitFor(); assert.equal(await page.locator('.task-permanent-materials').count(), 0); assert.equal(await launch().count(), 0);
  await page.goto(teams + '/teams?demo-role=member#/projects?project=teams&tab=delivery&task=T104&node=prepare'); await page.locator('[data-material-task=T104]').waitFor(); assert.equal(await page.locator('[data-delivery-task]').count(), 5); assert.deepEqual(await groupIds('mine'), []); assert.equal(await launch().isDisabled(), true);
  for (const theme of ['light', 'dark']) for (const width of [1600, 390]) {
    await page.evaluate(value => localStorage.setItem('carddemo-theme', value), theme); await page.setViewportSize({ width, height: 1100 }); await visit('owner', 'MKT-OWNER-UI'); await page.reload(); await page.locator('[data-material-task=MKT-OWNER-UI]').waitFor();
    assert.equal(await page.locator('html').getAttribute('data-theme'), theme); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); const rows = await page.locator('[data-delivery-task]').evaluateAll(items => items.map(item => { const r = item.getBoundingClientRect(); return { width: r.width, height: r.height, overflow: item.scrollWidth > item.clientWidth }; })); assert.ok(rows.every(row => row.width > row.height && row.height >= 90 && row.height <= 110 && !row.overflow));
    await page.screenshot({ path: out + '/' + theme + '-' + width + '.png', fullPage: true, animations: 'disabled' });
  }
  assert.deepEqual(posts, []); assert.deepEqual(errors, []); assert.deepEqual(await hashes(), before);
  await writeFile(out + '/result.json', JSON.stringify({ passed: true, groupedByStableIdentity: true, ownerAndMemberPlans: true, otherTaskAndUnassignedDisabledBeforeRequest: true, directLinksAndRoleSwitchPreserveSelection: true, createdProjectAndSourceReadOnly: true, unauthorizedProjectExcluded: true, managementCountsShared: true, widths: [1600, 390], themes: ['light', 'dark'], browserPosts: posts, errors, stateHashes: before, nativeInvocations: 0 }, null, 2));
  console.log('Ownership UI passed: shared project records, own/other groups, two actors plan entry, no native or browser POST, unchanged isolated state');
} finally { await browser?.close(); await Promise.all(children.map(child => new Promise<void>(resolve => { if (child.exitCode !== null) return resolve(); child.once('exit', () => resolve()); child.kill('SIGTERM'); }))); await rm(dir, { recursive: true, force: true }); }
