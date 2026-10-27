// Browser smoke test: every page opens in both entries without errors, the addresses Teams links to land on
// the right page, and the demo script runs end to end (diagnose sessions, revise, publish, apply as developer).
// Starts its own Talents service with throwaway state. Usage: npm run test:e2e (needs Google Chrome).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';

const port = 45989, origin = 'http://127.0.0.1:' + port;
const dir = await mkdtemp(join('.runtime', 'browser-'));
const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  env: { ...process.env, DEMO_TALENT_PORT: String(port), DEMO_PORT: '45979', DEMO_TALENT_STATE_DIR: join(dir, 'state'), DEMO_SHARED_DIR: join(dir, 'shared') }, stdio: 'ignore',
});
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (let n = 0; ; n++) {
    try { if ((await fetch(origin + '/api/health')).ok) break; } catch { /* not up yet */ }
    if (n > 80) throw new Error('Talents 服务没有启动');
    await new Promise(done => setTimeout(done, 250));
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const heading = (p: Page) => p.locator('.page-header h1').first();

  // Entries Teams links to.
  await page.goto(origin + '/talents?role=member#/dev-knowledge?project=carddemo');
  await assert.doesNotReject(heading(page).filter({ hasText: '项目知识' }).waitFor());
  assert.equal(await page.locator('.compact-role-switch').innerText(), '陈晨 · 开发者端');
  await page.goto(origin + '/talents?role=owner#/review?project=carddemo');
  await heading(page).filter({ hasText: '产物审阅' }).waitFor();
  await page.goto(origin + '/talents?role=owner#/tasks?project=carddemo');
  await heading(page).filter({ hasText: '知识任务' }).waitFor();

  // Every page of both entries.
  for (const [hash, title] of [['sources', '来源管理'], ['sources?project=carddemo', '信用卡营销交付'], ['capabilities', '知识能力'], ['tasks', '知识任务'], ['review', '产物审阅'], ['knowledge', '项目知识'], ['local', '本地索引']]) {
    await page.goto(origin + '/talents/#/' + hash);
    await heading(page).filter({ hasText: title }).waitFor();
  }
  // Unknown pages (e.g. the sidebar's account link) fall back to the entry's home.
  await page.goto(origin + '/talents/#account');
  await heading(page).filter({ hasText: '项目知识' }).waitFor();

  // 管理员端: diagnose sessions picked by iCode, then revise and publish the result.
  await page.goto(origin + '/talents/#/tasks');
  await page.getByRole('button', { name: '新建任务' }).click();
  await page.getByRole('button', { name: '选择会话…' }).click();
  await page.getByRole('button', { name: '对话轮次超过 50 的会话' }).click();
  await page.getByText(/^iCode：/).waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: '全部选中' }).click();
  // antd spaces out two-character button labels (确 定).
  await page.locator('.picker-modal').getByRole('button', { name: /^确\s?定$/ }).click();
  await page.getByRole('button', { name: '创建并运行' }).click();
  await page.getByText('可以关闭此面板，任务会继续运行。').waitFor();
  await page.getByRole('button', { name: '去审阅' }).waitFor({ timeout: 40000 });
  await page.getByRole('button', { name: '去审阅' }).click();
  await page.locator('.wb').waitFor();
  await page.locator('.file-item', { hasText: '改进建议' }).click();
  await page.getByRole('button', { name: /^第 3 条规则太绝对/ }).click();
  await page.locator('.diff-line.add').first().waitFor({ timeout: 5000 });
  await page.locator('.wb .page-header').getByRole('button', { name: /^发\s?布$/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^发\s?布$/ }).click();
  await page.getByText(/已发布 v1 到信用卡营销交付/).waitFor();

  // 开发者端: the new knowledge is there to apply.
  await page.locator('.compact-role-switch').click();
  await page.getByTitle('陈晨 · 开发者端').click();
  await heading(page).filter({ hasText: '项目知识' }).waitFor();
  const card = page.locator('.item-card', { hasText: '会话轨迹诊断' });
  await card.getByRole('button', { name: /^应\s?用$/ }).click();
  await card.getByText('已应用').waitFor();
  await card.getByText('查看改动').click();
  await page.getByText('应用到本机 iCode 的改动').waitFor();

  // Saved on the service, and published to the shared directory for Teams.
  const boot = await (await fetch(origin + '/api/bootstrap')).json();
  assert.ok(boot.state.artifacts.some((a: { cap: string; published: unknown }) => a.cap === 'traj' && a.published));
  assert.deepEqual(errors, []);
  console.log('Talents 浏览器冒烟测试通过');
} finally {
  await browser.close();
  server.kill();
  await rm(dir, { recursive: true, force: true });
}
