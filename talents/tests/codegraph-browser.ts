import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const port = 45988, origin = `http://127.0.0.1:${port}`;
const directory = await mkdtemp(join(tmpdir(), 'codegraph-browser-'));
const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  env: { ...process.env, DEMO_TALENT_PORT: String(port), DEMO_PORT: '45979', DEMO_TALENT_STATE_DIR: join(directory, 'state'), DEMO_SHARED_DIR: join(directory, 'shared') },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
const stopped = new Promise(resolve => server.once('close', resolve));
server.stdout.on('data', b => { logs += b; }); server.stderr.on('data', b => { logs += b; });
let browser;
try {
  for (let i = 0; ; i++) {
    if (server.exitCode !== null) throw new Error('Service exited: ' + logs);
    try { if ((await fetch(origin + '/api/health')).ok) break; } catch { /* Server is starting. */ }
    if (i === 60) throw new Error('Service did not start: ' + logs);
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  const graph = await (await fetch(origin + '/api/codegraph/carddemo')).json();
  assert.equal(graph.nodes.length, graph.metadata.nodes);
  assert.ok(!('sources' in graph));
  const sourceURL = origin + '/api/codegraph/carddemo/source';
  assert.equal((await fetch(sourceURL + '?snapshot=stale&id=' + graph.nodes[0].id)).status, 409);
  assert.equal((await fetch(sourceURL + '?snapshot=' + graph.metadata.snapshotId + '&id=../../etc/passwd')).status, 404);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(origin + '/talents/#/projects?project=carddemo&tab=review&id=a-cg-java');
  await page.locator('.cg-canvas canvas').waitFor();
  await page.getByRole('searchbox', { name: '搜索图谱' }).fill('CampaignApplicationService');
  await page.locator('.cg-results button').first().click();
  await page.locator('.cg-source').waitFor();
  assert.match(await page.locator('.cg-source').innerText(), /CampaignApplicationService/);
  await page.locator('.cg-detail h3', { hasText: /^CampaignApplicationService$/ }).waitFor();
  await page.getByRole('button', { name: '显示服务全部符号' }).click();
  await page.getByRole('searchbox', { name: '搜索图谱' }).fill('activate');
  await page.locator('.cg-results button', { hasText: 'activate' }).first().click();
  await page.locator('.cg-detail h3', { hasText: /^activate$/ }).waitFor();
  await page.getByRole('button', { name: '聚焦邻域' }).click();
  assert.ok(await page.locator('.cg-connections button').count());
  await page.screenshot({ path: '/tmp/codegraph-desktop.png', fullPage: true });
  await page.getByText('服务概览', { exact: true }).click();
  assert.match(await page.getByTestId('graph-counts').innerText(), /^9 节点/);
  await page.getByRole('checkbox', { name: '包含跨服务调用' }).check();
  await page.getByRole('checkbox', { name: '包含测试', exact: true }).check();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/codegraph-mobile.png', fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'mobile page overflows horizontally');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(origin + '/talents?role=member#/dev-knowledge?project=carddemo');
  const card = page.locator('.item-card', { hasText: 'carddemo-java-1025 CodeGraph' });
  await card.getByRole('button', { name: /预览|查看/ }).first().click();
  await page.getByRole('dialog').locator('.cg-canvas canvas').waitFor();
  await page.keyboard.press('Escape');
  assert.deepEqual(errors, []);
  console.log('CodeGraph API, graph navigation, archived source, mobile layout and developer preview passed');
} finally {
  await browser?.close(); server.kill('SIGTERM');
  await stopped;
  await rm(directory, { recursive: true, force: true });
}
