import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { initialState } from '../src/domain.js';
import { createDeliveryRequirement } from '../src/delivery-requirements.js';

const runtime = await mkdtemp(join(tmpdir(), 'task-trace-reporting-'));
const origin = 'http://127.0.0.1:46234';
const output = 'test-results/task-trace-reporting';
const seed = initialState();
const at = new Date().toISOString();
const task = createDeliveryRequirement(seed, 'owner', { projectId: 'carddemo', id: 'MKT-TRACE-001', title: '信用卡消费返现', description: '用于验证任务会话上报和可视化路由。', assigneeId: 'member', skillIds: ['dev-code-reviewer'] }, at);
task.stage = 'developing';
task.preparedAt = at;
task.nodes.prepare = { status: 'complete', updatedAt: at, summary: '隔离浏览器回归的准备记录' };
await writeFile(join(runtime, 'state.json'), JSON.stringify(seed));
await mkdir(output, { recursive: true });

const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  env: { ...process.env, DEMO_PORT: '46234', DEMO_TALENT_PORT: '46235', DEMO_STATE_DIR: runtime, DEMO_TALENT_STATE_DIR: join(runtime, 'unused-talent'), DEMO_SHARED_DIR: join(runtime, 'shared'), DEMO_SHARED_SEED_DIR: join(runtime, 'no-seed'), DEMO_NATIVE_DISABLED: '1' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let logs = '', browser: Browser | undefined;
server.stdout.on('data', data => logs += data);
server.stderr.on('data', data => logs += data);

try {
  let ready = false;
  for (let index = 0; index < 100; index++) {
    try { if ((await fetch(origin + '/api/health')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, logs);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const visit = async (role: string, route: string) => {
    await page.goto(origin + '/teams?demo-role=' + role + '#/' + route);
    await page.getByRole('combobox', { name: '切换角色' }).waitFor();
  };

  await visit('owner', 'team-work');
  await page.getByRole('link', { name: '任务追溯', exact: true }).waitFor();
  await page.getByText('陈晨', { exact: true }).first().waitFor();
  assert.doesNotMatch(await page.locator('.team-work-page').innerText(), /成员 [BC]/);
  await page.getByText('显示导入快照', { exact: true }).click();
  await page.getByText('快照责任人 · 成员 B', { exact: true }).first().waitFor();
  await page.getByText('快照责任人 · 成员 C', { exact: true }).first().waitFor();
  await page.screenshot({ path: join(output, 'snapshot-owners.png'), fullPage: true, animations: 'disabled' });

  await visit('owner', 'team-work?tab=sessions&view=conversations');
  assert.equal(await page.getByRole('button', { name: '上报任务会话' }).isDisabled(), true);

  await visit('member', 'team-work?tab=sessions&view=conversations');
  await page.getByRole('link', { name: '任务追溯', exact: true }).waitFor();
  assert.equal(await page.getByText('调用 Trace', { exact: true }).count(), 0);
  assert.equal(await page.getByRole('tab', { name: '成员运行概览', exact: true }).count(), 0);
  const report = page.getByRole('button', { name: '上报任务会话' });
  assert.equal(await report.isEnabled(), true);
  await report.click();
  const modal = page.locator('.ant-modal:visible');
  await modal.getByRole('textbox', { name: '上报会话标识' }).fill('isolated-session-three');
  await page.screenshot({ path: join(output, 'report-form.png'), fullPage: true, animations: 'disabled' });
  const [response] = await Promise.all([
    page.waitForResponse(request => request.url().endsWith('/api/workspace')),
    modal.getByRole('button', { name: '确认上报会话', exact: true }).click()
  ]);
  assert.equal(response.status(), 200, await response.text());
  await page.waitForURL(url => url.hash.includes('session=isolated-session-three'));
  const selected = page.locator('[data-conversation-session="isolated-session-three"]');
  await selected.waitFor();
  assert.equal(await selected.getAttribute('aria-pressed'), 'true');
  const saved = await (await fetch(origin + '/api/state')).json() as typeof seed;
  const record = saved.workspace.taskAutomation?.find(item => item.projectId === 'carddemo' && item.taskId === 'MKT-TRACE-001');
  assert.ok(record?.sessions.some(item => item.sessionId === 'isolated-session-three' && item.nodeId === 'develop' && item.tool === 'icode'));
  await page.screenshot({ path: join(output, 'reported-session.png'), fullPage: true, animations: 'disabled' });
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'result.json'), JSON.stringify({ passed: true, renamed: '任务追溯', snapshotOwnersSeparated: true, memberReporting: true, ownerCannotReportForMember: true, selectedSession: 'isolated-session-three', nativeExecution: false, errors }, null, 2));
  console.log('PASS task trace naming, snapshot owner identity, member session reporting and visualization route');
} catch (error) {
  if (browser) {
    const page = browser.contexts()[0]?.pages()[0];
    if (page) {
      await page.screenshot({ path: join(output, 'failure.png'), fullPage: true });
      await writeFile(join(output, 'failure.txt'), await page.locator('body').innerText());
    }
  }
  console.error(logs);
  throw error;
} finally {
  await browser?.close();
  if (server.exitCode === null) await new Promise<void>(resolve => { server.once('exit', () => resolve()); server.kill('SIGTERM'); });
  await rm(runtime, { recursive: true, force: true });
}
