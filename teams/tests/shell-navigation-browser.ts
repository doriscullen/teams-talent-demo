import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { initialState } from '../src/domain.js';
import { createDeliveryRequirement } from '../src/delivery-requirements.js';

const root = await mkdtemp(join(tmpdir(), 'shell-navigation-'));
const teams = 'http://127.0.0.1:46224', talent = 'http://127.0.0.1:46225';
const seed = initialState(), taskId = 'MKT-NAV-001';
createDeliveryRequirement(seed, 'owner', { projectId: 'carddemo', id: taskId, title: '导航范围核对', description: '只验证布局操作保留当前工作位置。', assigneeId: 'member', skillIds: ['dev-code-reviewer'] }, '2026-10-27T00:00:00Z');
await writeFile(join(root, 'state.json'), JSON.stringify(seed));
const env = { ...process.env, DEMO_PORT: '46224', DEMO_TALENT_PORT: '46225', DEMO_STATE_DIR: root, DEMO_SHARED_DIR: join(root, 'shared'), DEMO_SHARED_SEED_DIR: join(root, 'no-seed'), DEMO_NATIVE_DISABLED: '1' };
const processes = ['server/index.ts'].map(file => spawn(process.execPath, ['--import', 'tsx', file], { env, stdio: ['ignore', 'pipe', 'pipe'] }));
let logs = '', browser;
for (const process of processes) { process.stdout.on('data', value => logs += value); process.stderr.on('data', value => logs += value); }
try {
  for (const origin of [teams]) {
    let ready = false;
    for (let n = 0; n < 100; n++) { try { if ((await fetch(origin + '/api/health')).ok) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
    assert.ok(ready, logs);
  }
  const stateFiles = [join(root, 'state.json')];
  const before = await Promise.all(stateFiles.map(file => readFile(file)));
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const posts: string[] = [], errors: string[] = [], layouts: unknown[] = [];
  await mkdir('test-results/shell-navigation', { recursive: true });
  for (const role of ['owner', 'member']) for (const theme of ['light', 'dark']) for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    await context.addInitScript(value => { if (!localStorage.getItem('carddemo-theme')) localStorage.setItem('carddemo-theme', value); }, theme);
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    page.on('request', request => { if (request.method() === 'POST') posts.push(request.url()); });
    page.on('pageerror', error => errors.push(error.message));
    const url = teams + '/teams?demo-role=' + role + '#/projects?project=carddemo&tab=delivery&task=' + taskId + '&node=develop';
    await page.goto(url);
    const sidebar = page.locator('.framework-sidebar'), taskSidebar = page.getByRole('complementary', { name: '交付任务列表' });
    const task = page.locator('[data-delivery-task="' + taskId + '"]');
    await task.waitFor(); assert.equal(await task.getAttribute('aria-current'), 'page');
    const expandedWidth = width > 760 ? 200 : 72;
    assert.equal((await sidebar.boundingBox())!.width, expandedWidth);
    const toggle = page.getByRole('button', { name: '收起左侧导航', exact: true });
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    if (width > 760) {
      const label = sidebar.getByRole('link', { name: '工作台', exact: true }).locator('.nav-label');
      const text = await label.evaluate(element => ({ font: getComputedStyle(element).fontSize, height: element.getBoundingClientRect().height, lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight) }));
      assert.equal(text.font, '14px'); assert.ok(text.height <= text.lineHeight + 1);
    }
    const route = page.url(), taskCount = await taskSidebar.getAttribute('data-task-count'), mainWidth = (await page.locator('.framework-main').boundingBox())!.width;
    const scroll = page.locator('.page-scroll'); await scroll.evaluate(element => { element.scrollTop = 60; });
    const top = await scroll.evaluate(element => element.scrollTop);
    await page.screenshot({ path: `test-results/shell-navigation/${role}-${theme}-${width}-expanded.png`, fullPage: true });
    await toggle.focus(); await toggle.press('Enter');
    const expand = page.getByRole('button', { name: '展开左侧导航', exact: true });
    await expand.waitFor(); assert.equal(await expand.getAttribute('aria-expanded'), 'false');
    if (width > 760) assert.equal((await sidebar.boundingBox())!.width, 72); else assert.equal(await sidebar.isVisible(), false);
    assert.equal((await page.locator('.framework-main').boundingBox())!.width - mainWidth, width > 760 ? 128 : 72);
    assert.equal(page.url(), route); assert.equal(await taskSidebar.getAttribute('data-task-count'), taskCount); assert.equal(await task.getAttribute('aria-current'), 'page');
    assert.ok(await taskSidebar.isVisible()); if (top > 0) assert.ok(await scroll.evaluate(element => element.scrollTop) > 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `test-results/shell-navigation/${role}-${theme}-${width}-collapsed.png`, fullPage: true });
    await page.reload(); await expand.waitFor(); assert.equal(await page.evaluate(() => localStorage.getItem('teams-sidebar-collapsed')), 'true'); assert.equal(page.url(), route);
    await expand.focus(); await expand.press('Space'); await toggle.waitFor(); assert.equal((await sidebar.boundingBox())!.width, expandedWidth);
    if (width > 760) {
      const resize = page.getByRole('separator', { name: '调整导航宽度' }); await resize.focus();
      for (let n = 0; n < 4; n++) await resize.press('ArrowRight');
      assert.equal((await sidebar.boundingBox())!.width, 240);
      await toggle.click(); await expand.click(); assert.equal((await sidebar.boundingBox())!.width, 240);
      await page.reload(); await toggle.waitFor(); assert.equal((await sidebar.boundingBox())!.width, 240);
      assert.equal(await page.evaluate(() => localStorage.getItem('teams-sidebar-width')), '240');
    }
    layouts.push({ role, theme, width, expandedWidth, collapsedWidth: width > 760 ? 72 : 0, routePreserved: page.url() === route });
    await context.close();
  }
  const workContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const workPage = await workContext.newPage(); workPage.setDefaultTimeout(10000);
  workPage.on('request', request => { if (request.method() === 'POST') posts.push(request.url()); });
  workPage.on('pageerror', error => errors.push(error.message));
  await workPage.goto(teams + '/teams?demo-role=owner#/trace-monitor');
  await workPage.waitForURL(url => url.hash === '#/team-work?tab=sessions&view=traces');
  await workPage.frameLocator('.trace-monitor-frame').locator('.tm-page').first().waitFor();
  assert.equal(await workPage.getByRole('link', { name: '开发会话轨迹', exact: true }).count(), 0);
  assert.equal(await workPage.getByRole('tab', { name: '会话与轨迹', exact: true }).getAttribute('aria-selected'), 'true');
  await workPage.locator('.ant-segmented').getByText('任务会话', { exact: true }).click();
  await workPage.waitForURL(url => url.hash === '#/team-work?tab=sessions&view=conversations');
  await workPage.locator('.team-work-conversation-view').waitFor({ state: 'visible' });
  await workPage.getByRole('tab', { name: '任务作业', exact: true }).click();
  await workPage.waitForURL(url => url.hash === '#/team-work');
  await workPage.reload(); await workPage.locator('.team-work-page').waitFor();
  assert.equal(await workPage.getByRole('tab', { name: '任务作业', exact: true }).getAttribute('aria-selected'), 'true');
  await workContext.close();
  const talentContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await talentContext.newPage();
  await page.route(talent + '/**', route => route.fulfill({ contentType: 'text/html', body: '<p>Independent app navigation transport fixture</p>' }));
  await page.goto(teams + '/teams?demo-role=owner#/projects?project=carddemo&tab=content');
  await page.locator('.framework-sidebar').getByRole('link', { name: 'Talents', exact: true }).click();
  await page.waitForURL(talent + '/talents?role=owner#/review?project=carddemo');
  assert.equal(await page.locator('.global-navigation-toggle').count(), 0);
  await talentContext.close();
  assert.deepEqual(posts, []); assert.deepEqual(errors, []);
  for (const [index, file] of stateFiles.entries()) assert.deepEqual(await readFile(file), before[index]);
  await writeFile('test-results/shell-navigation/result.json', JSON.stringify({ passed: true, layouts, keyboardToggle: true, resizeAndRefreshPreference: true, independentTalentsNavigation: true, traceRouteMerged: true, posts, errors, stateBytesUnchanged: true, nativeInvocations: 0 }, null, 2));
  console.log('PASS shell collapse/expand: eight layouts, unified team-work trace route, 0 POST');
} finally {
  await browser?.close();
  await Promise.all(processes.map(process => process.exitCode === null ? new Promise<void>(resolve => { process.once('exit', () => resolve()); process.kill('SIGTERM'); }) : undefined));
  await rm(root, { recursive: true, force: true });
}
