// Browser smoke test: every page opens in both entries without errors, the addresses Teams links to land on
// the right page, and the demo script runs end to end (diagnose sessions, revise, publish, apply as developer).
// Starts its own Talents service with throwaway state. Usage: npm run test:e2e (needs Google Chrome).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
  const activeTab = (p: Page) => p.locator('.project-toolbar .ant-tabs-tab-active');

  // Entries Teams links to.
  await page.goto(origin + '/talents?role=member#/dev-knowledge?project=carddemo');
  await assert.doesNotReject(heading(page).filter({ hasText: '项目知识' }).waitFor());
  assert.equal(await page.locator('.compact-role-switch').innerText(), '陈晨 · 开发者端');
  for (const tab of ['review', 'tasks']) {
    await page.goto(origin + '/talents?role=owner#/' + tab + '?project=carddemo');
    await heading(page).filter({ hasText: '信用卡营销交付' }).waitFor();
    await activeTab(page).filter({ hasText: tab === 'review' ? '产物管理' : '知识任务' }).waitFor();
  }

  // Every page of both entries, and the tabs of the team and a project.
  for (const [hash, title] of [['projects', '项目'], ['projects?project=carddemo', '信用卡营销交付'], ['team', '团队'], ['capabilities', '知识能力'], ['knowledge', '项目知识'], ['local', '本地索引']]) {
    await page.goto(origin + '/talents/#/' + hash);
    await heading(page).filter({ hasText: title }).waitFor();
  }
  for (const level of ['team?', 'projects?project=carddemo&']) for (const [tab, label] of [['sources', '来源'], ['tasks', '知识任务'], ['review', '产物管理']]) {
    await page.goto(origin + '/talents/#/' + level + 'tab=' + tab);
    await activeTab(page).filter({ hasText: label }).waitFor();
  }
  // Team-level knowledge is reviewed at team level, not in the project.
  await page.goto(origin + '/talents/#/team?tab=review');
  await page.locator('.item-card', { hasText: '银行编码规范要点' }).waitFor();
  await page.goto(origin + '/talents/#/projects?project=carddemo&tab=review');
  await page.locator('.item-card', { hasText: '信用卡营销返现业务知识' }).waitFor();
  assert.equal(await page.locator('.item-card', { hasText: '银行编码规范要点' }).count(), 0);
  // Unknown pages (e.g. the sidebar's account link) fall back to the entry's home.
  await page.goto(origin + '/talents/#account');
  await heading(page).filter({ hasText: /^项目$/ }).waitFor();

  // 管理员端: publish the new version of the business knowledge as it is (no revising).
  await page.goto(origin + '/talents/#/projects?project=carddemo&tab=review');
  await page.locator('.item-card', { hasText: '信用卡营销返现业务知识' }).getByRole('button', { name: /^审\s?阅$/ }).click();
  await page.locator('.wb').waitFor();
  assert.equal(await page.getByText('和 iCode 对话').count(), 0);
  await page.locator('.wb .page-header').getByRole('button', { name: /^发\s?布$/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^发\s?布$/ }).click();
  await page.getByText(/已发布 v2 到信用卡营销交付/).waitFor();

  // 管理员端: the finished diagnosis shows its suggestions; apply two and decline one.
  await page.goto(origin + '/talents/#/projects?project=carddemo&tab=review');
  const diagnosis = page.locator('.item-card', { hasText: '会话轨迹诊断' });
  await diagnosis.getByText('3 条优化建议待应用').waitFor();
  await diagnosis.getByRole('button', { name: '查看建议' }).click();
  await page.locator('.wb iframe').waitFor();
  assert.equal((await fetch(origin + '/api/content?key=' + encodeURIComponent('trajectory/carddemo-19/轨迹诊断报告.html'))).status, 200);
  const apply = async (title: string, result: string) => {
    await page.locator('.file-item', { hasText: title }).click();
    await page.getByRole('button', { name: '应用优化' }).click();
    await page.locator('.ant-modal-confirm').getByRole('button', { name: /^应\s?用$/ }).click();
    await page.getByText('已应用：' + result).first().waitFor();
  };
  await apply('统一 ADR Skill', 'arch-adr-writing 1.1.0');
  await apply('为完成声明补充', 'AGENTS.md 规则 v1');
  await page.locator('.file-item', { hasText: '现有 zsh 调用' }).click();
  await page.getByRole('button', { name: '暂不采纳' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /暂不采纳/ }).click();
  await page.getByText('已标记为暂不采纳').waitFor();
  await page.goto(origin + '/talents/#/projects?project=carddemo&tab=review');
  await diagnosis.getByText('建议已处理').waitFor();
  // The project skill now shows the version Talents wrote.
  await page.goto(origin + '/talents/#/projects?project=carddemo&tab=sources');
  await page.locator('.item-card', { hasText: '项目 Skill' }).click();
  await page.locator('.ant-drawer tr', { hasText: 'arch-adr-writing' }).getByText('Talents 改进').waitFor();
  await page.keyboard.press('Escape');
  // Only the session with a transcript can be picked for a new diagnosis.
  await page.goto(origin + '/talents/#/projects?project=carddemo&tab=tasks');
  await page.getByRole('button', { name: '新建任务' }).click();
  // 会话轨迹诊断 is the capability a new task starts with.
  await page.getByRole('button', { name: '选择会话…' }).click();
  assert.equal(await page.locator('.picker-modal tr[data-row-key] .ant-checkbox-input:not([disabled])').count(), 1);
  await page.locator('.picker-modal').getByRole('button', { name: /^取\s?消$/ }).click();
  await page.locator('.ant-drawer').getByRole('button', { name: /^取\s?消$/ }).click();

  // 开发者端: the AGENTS.md rules are there to apply to the repository.
  await page.locator('.compact-role-switch').click();
  await page.getByTitle('陈晨 · 开发者端').click();
  await heading(page).filter({ hasText: '项目知识' }).waitFor();
  assert.equal(await page.locator('.item-card', { hasText: '会话轨迹诊断：' }).count(), 0, 'a diagnosis is not published to developers');
  const card = page.locator('.item-card', { hasText: 'AGENTS.md 规则' });
  await card.getByRole('button', { name: /^应\s?用$/ }).click();
  await card.getByText('已应用').waitFor();
  await card.getByText('查看改动').click();
  await page.getByText('应用到本机 iCode 的改动').waitFor();
  await page.getByText(/AGENTS\.md/).first().waitFor();
  await page.keyboard.press('Escape');
  // Team knowledge is listed in the project; knowledge meant for some agents is applied to those agents.
  await page.locator('.talents-section', { hasText: '团队知识' }).locator('.item-card', { hasText: '银行编码规范要点' }).waitFor();
  const rag = page.locator('.item-card', { hasText: '信用卡营销交付文档 RAG 检索' });
  await rag.getByRole('button', { name: /^应\s?用$/ }).click();
  await rag.getByText('范围：Code Agent').waitFor();

  // Saved on the service, and published to the shared directory for Teams.
  const boot = await (await fetch(origin + '/api/bootstrap')).json();
  assert.ok(boot.state.artifacts.some((a: { id: string; published: unknown }) => a.id === 'a-rules-carddemo' && a.published));
  assert.deepEqual(boot.state.skillVersions.map((v: { skillId: string; version: string }) => v.skillId + ' ' + v.version), ['arch-adr-writing 1.1.0']);
  const knowledge = JSON.parse(await readFile(join(dir, 'shared', 'talents', 'knowledge.json'), 'utf8'));
  assert.equal(knowledge.skills[0].version, '1.1.0');
  assert.match(await readFile(join(dir, 'shared', 'talents', 'skills', 'arch-adr-writing', '1.1.0', 'SKILL.md'), 'utf8'), /\| version \| 1\.1\.0 \|/);
  assert.deepEqual(errors, []);
  console.log('Talents 浏览器冒烟测试通过');
} finally {
  await browser.close();
  server.kill();
  await rm(dir, { recursive: true, force: true });
}
