import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Presentation } from '../src/api.js';
import { initialState } from '../src/domain.js';
import type { SkillApplicationPlan, SkillApplicationReceipt } from '../src/skill-application.js';

// Publication/subscription use the real isolated service. Native application is an
// explicit transport fixture here; server/Skill tests verify the filesystem path.
const origin = 'http://127.0.0.1:46176';
const dir = await mkdtemp(join(tmpdir(), 'resource-ui-')), output = 'test-results/resources';
await mkdir(output, { recursive: true });
const seed = initialState(); seed.workspace.acquiredResources = ['audit-evidence'];
// Only the assigned member can choose Skills on the prepare page.
seed.assigned = true; seed.assigneeId = 'member'; seed.stage = 'assigned';
await writeFile(join(dir, 'state.json'), JSON.stringify(seed));
const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { env: { ...process.env, DEMO_PORT: '46176', DEMO_TALENT_PORT: '46186', DEMO_STATE_DIR: dir, DEMO_SHARED_DIR: join(dir, 'shared'), DEMO_SHARED_SEED_DIR: join(dir, 'no-seed'), DEMO_NATIVE_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; server.stdout.on('data', value => logs += value); server.stderr.on('data', value => logs += value);
let browser;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) { try { const health = await (await fetch(origin + '/api/health')).json(); if (health.pid === server.pid && health.stateRoot === dir) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.ok(ready, logs);
  const bootstrap = await (await fetch(origin + '/api/bootstrap')).json() as { data: Presentation };
  assert.equal(bootstrap.data.skills.length, 59);
  assert.equal(Object.keys(bootstrap.data.skillContents).length, 59);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(10000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  let role: 'owner' | 'member' = 'owner';
  const visit = async (path: string) => { await page.goto(origin + '/teams?demo-role=' + role + '#/' + path); await page.getByRole('combobox', { name: '切换角色' }).waitFor(); };
  const switchRole = async (next: typeof role) => { role = next; await page.getByRole('combobox', { name: '切换角色' }).click(); await page.locator('.ant-select-item-option-content').getByText(next === 'owner' ? '林悦 · 项目 Owner' : '陈晨 · 项目成员', { exact: true }).click(); };
  const search = async (id: string) => { await page.getByRole('textbox', { name: '搜索资源' }).fill(id); await page.locator('.resource-card h3').getByText(id, { exact: true }).waitFor(); };
  const save = async (kind: string, click: () => Promise<unknown>) => { const [response] = await Promise.all([page.waitForResponse(value => value.url() === origin + '/api/workspace' && value.request().postDataJSON().kind === kind), click()]); assert.equal(response.status(), 200, await response.text()); };
  const closeText = async () => { const drawer = page.locator('.ant-drawer').filter({ has: page.locator('.drawer-console') }); await drawer.locator('.ant-drawer-close').click(); await page.locator('.drawer-console').waitFor({ state: 'hidden' }); };

  await visit('subscriptions'); assert.equal(await page.locator('.resource-library-entry').count(), 0);
  await switchRole('member'); assert.equal(await page.locator('.resource-library-entry').count(), 0);
  await switchRole('owner');
  await visit('resources');
  await page.getByRole('button', { name: '发布全部 Skill', exact: true }).click();
  const batch = page.getByRole('dialog', { name: '发布全部 Skill', exact: true });
  await save('resource.publish-all', () => batch.locator('[data-workspace="resource.publish-all"]').click());
  await batch.waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('button', { name: '发布全部 Skill', exact: true }).isEnabled(), false);
  await visit('publications');
  assert.equal(await page.locator('.resource-library-entry').count(), 13);
  assert.ok(!(await page.locator('.resource-library-list').innerText()).includes('研发效能团队'));
  await visit('resources');
  // Every full body is opened through the actual product action and compared byte-for-byte.
  for (const [index, skill] of bootstrap.data.skills.entries()) {
    await search(skill.name); await page.locator('.resource-card').filter({ has: page.getByRole('heading', { name: skill.name, exact: true }) }).getByRole('button', { name: '查看详情', exact: true }).click();
    await page.locator('[data-skill-content="' + skill.name + '"]').click(); await page.locator('.drawer-console').waitFor();
    assert.equal(await page.locator('.drawer-console').textContent(), bootstrap.data.skillContents[skill.name], skill.name);
    await closeText(); await page.getByRole('dialog').getByRole('button', { name: '知道了', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    if ((index + 1) % 10 === 0) console.log('Skill bodies checked', index + 1);
  }
  await page.getByRole('button', { name: '发布资源', exact: true }).click();
  const publish = page.getByRole('dialog', { name: '发布单个资源', exact: true });
  await save('resource.publish', () => publish.locator('[data-workspace="resource.publish"]').click());
  await publish.getByRole('button', { name: '查看我的发布', exact: true }).click();
  await page.locator('.resource-library-entry').first().waitFor();
  assert.equal(await page.locator('.resource-library-entry').count(), 14);
  assert.ok((await page.locator('.resource-library-list').innerText()).includes('Code Agent'));

  await visit('resources'); await search('audit-evidence');
  await page.locator('.resource-card').getByText('研发效能团队 · 资源库', { exact: true }).waitFor();
  await save('resource.acquire', () => page.locator('[data-resource="audit-evidence"]').click());
  await visit('subscriptions'); assert.equal(await page.locator('.resource-library-entry').count(), 1);
  await page.getByText('固定版本 2.0.0', { exact: false }).waitFor();
  await switchRole('member'); await page.getByText('当前用户尚未订阅资源，可在市场获取所需 Skill。', { exact: true }).waitFor();
  assert.equal(await page.locator('[data-skill-apply]').count(), 0);
  await visit('publications'); assert.equal(await page.locator('.resource-library-entry').count(), 0);
  await visit('projects?tab=delivery&node=prepare');
  const skillSelect = page.getByRole('combobox', { name: '选择业务 Skill' }); await skillSelect.click(); await skillSelect.fill('audit-evidence');
  assert.equal(await page.locator('.ant-select-item-option').filter({ hasText: 'audit-evidence' }).count(), 0); await page.keyboard.press('Escape');
  await visit('resources'); await search('audit-evidence');
  await save('resource.acquire', () => page.locator('[data-resource="audit-evidence"]').click());
  await visit('projects?tab=delivery&node=prepare'); await skillSelect.click(); await skillSelect.fill('audit-evidence');
  const subscribedOption = page.locator('.ant-select-item-option-content').getByText('audit-evidence · 2.0.0', { exact: true });
  await save('skills.select', () => subscribedOption.click()); await page.keyboard.press('Escape');
  await page.locator('.skill-pills').getByRole('button', { name: 'audit-evidence', exact: true }).waitFor();

  // Capture production UI request bodies; the fixture never reaches native service code.
  const applicationPosts: Record<string, unknown>[] = [], plans: URL[] = [];
  let failPlan = true, failApply = true;
  await page.route('**/api/skill-application?*', async route => {
    const url = new URL(route.request().url()); plans.push(url);
    if (failPlan) { await route.fulfill({ status: 503, json: { error: '应用目录核验暂不可用（测试响应）' } }); return; }
    const scope = Object.fromEntries(['projectId', 'resourceId', 'version', 'sha256'].map(key => [key, url.searchParams.get(key)!])) as Pick<SkillApplicationPlan, 'projectId' | 'resourceId' | 'version' | 'sha256'>;
    const plan: SkillApplicationPlan = { ...scope, scope: 'native-user', projectName: 'Credit Card', targetDirectory: join(dir, '测试用户/.chrys/skills'), skillDirectory: join(dir, '测试用户/.chrys/skills', scope.resourceId), files: [{ path: 'SKILL.md', sha256: scope.sha256 }], planToken: 'ui-plan-fixed-token', canApply: true };
    await route.fulfill({ json: plan });
  });
  await page.route('**/api/native/skill-apply', async route => {
    const body = route.request().postDataJSON(); applicationPosts.push(body);
    if (failApply) { await route.fulfill({ status: 503, json: { error: '应用请求待重试（测试响应）' } }); return; }
    const receipt: SkillApplicationReceipt = { ...body, status: 'applied', scope: 'native-user', targetDirectory: join(dir, '测试用户/.chrys/skills'), skillDirectory: join(dir, '测试用户/.chrys/skills/audit-evidence'), appliedAt: new Date().toISOString(), discovery: { status: 'discovered-and-read', note: '独立浏览器响应夹具；不调用原生工具。', source: 'browser-fixture' }, note: '固定版本文件已写入测试目标。' };
    await route.fulfill({ json: receipt });
  });
  await visit('subscriptions'); const launch = page.locator('[data-skill-apply="audit-evidence"]'); await launch.click();
  const dialog = page.getByRole('dialog', { name: 'audit-evidence · 应用到本机用户 iCode', exact: true });
  await dialog.getByText('应用目录核验暂不可用（测试响应）', { exact: true }).waitFor();
  failPlan = false; await dialog.getByRole('button', { name: '重新核验', exact: true }).click(); await dialog.getByText('订阅版本', { exact: true }).waitFor();
  assert.equal(await dialog.locator('[data-skill-apply-confirm]').isEnabled(), true);
  await dialog.getByRole('button', { name: '取消', exact: true }).click(); await dialog.waitFor({ state: 'hidden' }); assert.equal(applicationPosts.length, 0);
  await launch.click(); await dialog.getByText('订阅版本', { exact: true }).waitFor(); await dialog.locator('[data-skill-apply-confirm]').click(); await dialog.getByText('应用请求待重试（测试响应）', { exact: true }).waitFor();
  assert.equal(applicationPosts.length, 1); failApply = false; await dialog.locator('[data-skill-apply-confirm]').click();
  await dialog.getByText('已发现并读取', { exact: true }).waitFor(); assert.equal(applicationPosts.length, 2);
  assert.deepEqual(applicationPosts[0], applicationPosts[1]); assert.equal(applicationPosts[1].role, 'member'); assert.equal(applicationPosts[1].projectId, 'carddemo'); assert.equal(applicationPosts[1].resourceId, 'audit-evidence'); assert.equal(applicationPosts[1].version, '2.0.0'); assert.match(String(applicationPosts[1].sha256), /^[a-f0-9]{64}$/); assert.equal(applicationPosts[1].planToken, 'ui-plan-fixed-token');
  await page.screenshot({ path: output + '/application-receipt.png', fullPage: true, animations: 'disabled' });
  await dialog.getByRole('button', { name: '查看完整应用回执', exact: true }).click(); await dialog.locator('[data-skill-application-receipt]').waitFor();
  assert.equal(JSON.parse((await dialog.locator('[data-skill-application-receipt]').textContent())!).discovery.status, 'discovered-and-read'); await dialog.getByRole('button', { name: '完成', exact: true }).click();

  const layouts: unknown[] = [];
  for (const theme of ['light', 'dark']) for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 }); await visit('resources');
    await page.evaluate(value => localStorage.setItem('carddemo-theme', value), theme); await page.reload(); await search('audit-evidence');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme);
    const measure = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth })); assert.ok(measure.scrollWidth <= width, JSON.stringify(measure)); layouts.push({ theme, ...measure });
    await page.screenshot({ path: output + '/market-' + theme + '-' + width + '.png', fullPage: true, animations: 'disabled' });
  }
  await switchRole('owner'); await visit('projects?tab=content'); await page.getByText('13 项项目 Skill · 5 项用户 Skill', { exact: true }).waitFor();
  await page.getByRole('button', { name: '查看 Skill', exact: true }).click(); await page.getByRole('tab', { name: '用户 Skill · 5', exact: true }).click();
  await page.getByRole('button', { name: '查看 Skill：audit-evidence', exact: true }).waitFor();
  assert.deepEqual(errors, []);
  const stored = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'));
  await writeFile(output + '/result.json', JSON.stringify({ passed: true, fullBodies: 59, originalOwnerPublications: 13, publicationAfterAgent: 14, roleIsolation: true, subscribedRequirementSelection: true, cancelledApplyPosts: 0, applicationPosts, planRequests: plans.length, applicationTransport: 'explicit browser fixture; no native invocation', selectedSkills: stored.workspace.selectedSkills, layouts, pageErrors: errors }, null, 2));
  console.log('PASS resources: 59 full bodies, owner/library publications, actor subscriptions, selected inputs, apply request/receipt contract, 4 layouts');
} catch (error) { await writeFile(output + '/failure.log', String(error) + '\n' + logs); throw error; }
finally { await browser?.close(); if (server.exitCode === null) { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); } await rm(dir, { recursive: true, force: true }); }
