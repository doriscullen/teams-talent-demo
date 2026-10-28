// Owner workflow with a local fake gh executable; never submits to GitHub.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const port = 45989, origin = 'http://127.0.0.1:' + port;
const dir = await mkdtemp(join(tmpdir(), 'talents-browser-'));
await mkdir(join(dir, 'bin'));
await copyFile('tests/fixtures/fake-gh.mjs', join(dir, 'bin', 'gh'));
await chmod(join(dir, 'bin', 'gh'), 0o755);
await writeFile(join(dir, 'fail-once'), '');
// A clone with the project repository and a fork of it as remotes: PRs default to the fork.
const checkout = join(dir, 'checkout');
await mkdir(checkout);
execFileSync('git', ['init', '-q', checkout]);
execFileSync('git', ['-C', checkout, 'remote', 'add', 'origin', 'https://github.com/zhuyuloveai/teams-talent-demo.git']);
execFileSync('git', ['-C', checkout, 'remote', 'add', 'fork', 'git@github.com:tester/teams-talent-demo.git']);
const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  env: { ...process.env, PATH: join(dir, 'bin') + ':' + process.env.PATH, TEST_GH_LOG: join(dir, 'gh.log'), TEST_GH_FAIL: join(dir, 'fail-once'), DEMO_TALENT_PORT: String(port), DEMO_PORT: '45979', DEMO_TALENT_STATE_DIR: join(dir, 'state'), DEMO_SHARED_DIR: join(dir, 'shared'), DEMO_PR_CHECKOUT: checkout }, stdio: 'pipe',
});
const stopped = new Promise(resolve => server.once('close', resolve));
let logs = ''; server.stdout.on('data', b => { logs += b; }); server.stderr.on('data', b => { logs += b; });
let browser;
try {
  for (let n = 0; ; n++) {
    if (server.exitCode !== null) throw new Error(logs);
    try { if ((await fetch(origin + '/api/health')).ok) break; } catch { /* starting */ }
    if (n > 80) throw new Error('服务未启动：' + logs);
    await new Promise(done => setTimeout(done, 200));
  }
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/talents?role=member#/dev-knowledge?project=carddemo');
  await page.locator('.item-card', { hasText: '信用卡营销返现业务知识' }).waitFor();
  assert.equal(await page.locator('.compact-role-switch').count(), 0);
  assert.equal(await page.getByRole('link', { name: '本地索引', exact: true }).count(), 0);
  for (const hash of ['team', 'capabilities', 'projects?project=carddemo&tab=sources', 'projects?project=carddemo&tab=tasks']) {
    await page.goto(origin + '/talents/#/' + hash);
    await page.locator('.page-header h1').first().waitFor();
  }
  await page.goto(origin + '/talents/#/projects?project=carddemo&id=a-biz');
  await page.getByRole('button', { name: '提交 PR', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.locator('input[value="tester/teams-talent-demo"]').waitFor();
  assert.equal(await dialog.getByLabel('GitHub 仓库').inputValue(), 'tester/teams-talent-demo');
  assert.equal(await dialog.getByLabel('目标分支').inputValue(), 'develop');
  await dialog.getByRole('button', { name: '提交 PR', exact: true }).click();
  await dialog.getByText('提交失败', { exact: true }).waitFor();
  assert.equal(await dialog.locator('.submit-steps .ant-steps-item-error').innerText(), '创建 PR');
  assert.equal(await dialog.locator('.submit-steps .ant-steps-item-finish').count(), 4);
  await dialog.getByRole('button', { name: '提交 PR', exact: true }).click();
  await page.locator('.wb-side').getByRole('link', { name: '查看 PR' }).waitFor();
  await page.reload();
  await page.locator('.wb-side').getByRole('link', { name: '查看 PR' }).waitFor();
  await page.goto(origin + '/talents/#/projects?project=carddemo&id=a-traj');
  for (const title of ['统一 ADR Skill', '为完成声明补充']) {
    await page.locator('.file-item', { hasText: title }).click();
    await page.getByRole('button', { name: '提交改进 PR', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.locator('input[value="tester/teams-talent-demo"]').waitFor();
    if (title === '统一 ADR Skill') assert.equal(await dialog.getByLabel('仓内 Skill 目录').inputValue(), 'workspace/.agents/skills/arch-adr-writing');
    await dialog.getByRole('button', { name: '提交 PR', exact: true }).click();
    await page.locator('.wb-side').getByRole('link', { name: '查看 PR' }).waitFor();
  }
  const boot = await (await fetch(origin + '/api/bootstrap')).json();
  const a = boot.state.artifacts.find((a: any) => a.id === 'a-biz');
  assert.ok(a.submission.url);
  assert.equal(a.draft, null);
  assert.deepEqual(boot.state.skillVersions, []);
  assert.ok(!boot.state.artifacts.some((a: any) => a.id === 'a-rules-carddemo'));
  const calls = (await readFile(join(dir, 'gh.log'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(calls.filter(c => c.method === 'POST' && c.path.endsWith('/pulls')).length, 4);
  assert.ok(!calls.some(c => c.path.includes('/merge')));
  const pulls = calls.filter(c => c.method === 'POST' && c.path.endsWith('/pulls'));
  assert.ok(pulls.every(c => c.path === 'repos/tester/teams-talent-demo/pulls' && c.body.base === 'develop'));
  const trees = calls.filter(c => c.method === 'POST' && c.path.endsWith('/git/trees')).flatMap(c => c.body.tree);
  assert.ok(trees.length && trees.every(f => f.path.startsWith('workspace/')));
  assert.ok(trees.some(f => f.path === 'workspace/AGENTS.md'));
  assert.ok(trees.filter(f => f.path.startsWith('workspace/.agents/skills/arch-adr-writing/')).every(f => f.content.includes('\r\n')));
  await page.screenshot({ path: '/tmp/talents-pr-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/talents-pr-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('管理者入口、知识 PR、建议 PR、失败重试与持久化通过；gh 全部使用本地模拟。');
} finally {
  await browser?.close(); server.kill();
  await stopped;
  await rm(dir, { recursive: true, force: true });
}
