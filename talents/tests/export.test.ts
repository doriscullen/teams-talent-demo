import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildExport, writeExport } from '../server/export.ts';
import { readContent } from '../server/content.ts';
import { seedState } from '../server/seed.ts';

test('exports only published artifacts, at their published version', () => {
  const state = seedState();
  state.artifacts.push({ id: 'a-draft', projectId: 'carddemo', cap: 'traj', name: '草稿', desc: '', sources: ['s-sessions'], kind: 'files', files: ['trajectory/platinum/改进建议.md'], published: null, draft: { created: '2026-10-27 09:00', revisions: [] } });
  const { knowledge } = buildExport(state);
  assert.deepEqual(knowledge.artifacts.map(a => [a.id, a.version]), [['a-platinum-cashback-page', 1],
    ['a-req-2026-001', 1], ['a-req-2026-002', 1], ['a-req-2026-003', 1], ['a-req-2026-004', 1],
    ['a-req-2026-001-v2', 2], ['a-req-2026-002-v2', 2], ['a-req-2026-003-v2', 2], ['a-req-2026-004-v2', 2],
    ['a-cg-java', 3], ['a-docidx', 2], ['a-biz', 1], ['a-std', 1], ['a-miner', 2]]);
  // The coding standards are team-level knowledge; the rest belongs to the project.
  assert.deepEqual(knowledge.artifacts.map(a => a.projectId), [...Array(12).fill('carddemo'), null, 'carddemo']);
  assert.deepEqual(knowledge.artifacts.find(a => a.id === 'a-std')!.agents, ['Code', 'Reviewer']);
  assert.ok(!('agents' in knowledge.artifacts.find(a => a.id === 'a-biz')!), 'knowledge meant for every agent lists none');
  const biz = knowledge.artifacts.find(a => a.id === 'a-biz')!;
  assert.equal(biz.capabilityName, '业务知识提取');
  assert.equal(biz.delivery, 'local');
  assert.deepEqual(knowledge.artifacts.find(a => a.id === 'a-cg-java')!.files, []);
});

test('published files use the published text: v1 overrides and review revisions', () => {
  const state = seedState();
  const { files } = buildExport(state);
  const biz = files.get('a-biz/v1')!;
  const rules = biz.find(f => f.path === 'doc-knowledge/业务规则目录.md');
  if (readContent('doc-knowledge-v1/业务规则目录.md') != null) assert.equal(rules!.text, readContent('doc-knowledge-v1/业务规则目录.md'));
  const terms = biz.find(f => f.path === 'doc-knowledge/统一语言术语表.md');
  if (terms) assert.equal(terms.text, readContent('doc-knowledge/统一语言术语表.md'));

  // A publish from the review page stores revised text in published.over.
  const std = state.artifacts.find(a => a.id === 'a-std')!;
  std.published = { ...std.published!, version: 2, over: { 'doc-knowledge/银行编码规范要点.md': { text: '# 修订后的规范\n' } } };
  assert.equal(buildExport(state).files.get('a-std/v2')![0].text, '# 修订后的规范\n');
});

test('writes knowledge.json and the files, and removes versions no longer published', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'talents-export-'));
  const state = seedState();
  await writeExport(dir, buildExport(state));
  const knowledge = JSON.parse(await readFile(join(dir, 'talents', 'knowledge.json'), 'utf8'));
  assert.equal(knowledge.schemaVersion, 1);
  for (const a of knowledge.artifacts) for (const f of a.files) await access(join(dir, 'talents', 'files', a.id, 'v' + a.version, f.path));
  const miner = knowledge.artifacts.find((a: any) => a.id === 'a-miner');
  const index = await readFile(join(dir, 'talents', 'files', 'a-miner', 'v2', 'miner', 'index.md'), 'utf8');
  assert.match(index, /消费返现与奖励发放/);
  assert.match(index, /统一错误码与异常处理/);
  // PR-mode specs carry their PR records; diff-mode specs carry their mining metadata.
  assert.ok(miner.files.some((f: any) => f.type === 'json' && f.title.startsWith('PR #')));
  assert.ok(miner.files.some((f: any) => f.type === 'json' && /挖掘元数据/.test(f.title)));

  state.artifacts.find(a => a.id === 'a-std')!.published!.version = 2;
  state.artifacts = state.artifacts.filter(a => a.id !== 'a-miner');
  await writeExport(dir, buildExport(state));
  assert.deepEqual(await readdir(join(dir, 'talents', 'files', 'a-std')), ['v2']);
  await assert.rejects(access(join(dir, 'talents', 'files', 'a-miner')));
});

test('exports the AGENTS.md rules as published and the project skill versions Talents wrote', async () => {
  const state = seedState();
  state.artifacts.push({ id: 'a-rules-carddemo', projectId: 'carddemo', cap: 'traj', name: 'AGENTS.md 规则', desc: '', sources: [], kind: 'files', files: ['rules/AGENTS.md'],
    rules: [{ text: '规则一', version: 1 }, { text: '规则二', version: 2 }], published: { version: 1, at: '2026-10-27 21:00', note: '规则一', delivery: 'local', files: ['rules/AGENTS.md'] }, draft: null });
  state.skillVersions.push({ projectId: 'carddemo', skillId: 'arch-adr-writing', version: '1.1.0', basedOn: { version: '1.0.0' }, at: '2026-10-27 21:00', note: '统一章节契约',
    from: { artifact: 'a-traj', suggestion: 'change-02' }, files: [{ path: 'SKILL.md', text: '| version | 1.1.0 |\n' }] });
  const data = buildExport(state);
  assert.ok(!data.knowledge.artifacts.some(a => a.id === 'a-traj'), 'a diagnosis is not exported');
  const rules = data.files.get('a-rules-carddemo/v1')![0].text;
  assert.match(rules, /1\. 规则一/);
  assert.doesNotMatch(rules, /规则二/, 'only the rules of the published version');
  assert.deepEqual(data.knowledge.skills!.map(s => [s.skillId, s.version, s.files.map(f => f.path)]), [['arch-adr-writing', '1.1.0', ['SKILL.md']]]);
  const dir = await mkdtemp(join(tmpdir(), 'talents-export-'));
  await writeExport(dir, data);
  assert.equal(await readFile(join(dir, 'talents', 'skills', 'arch-adr-writing', '1.1.0', 'SKILL.md'), 'utf8'), '| version | 1.1.0 |\n');
  state.skillVersions = [];
  await writeExport(dir, buildExport(state));
  await assert.rejects(access(join(dir, 'talents', 'skills', 'arch-adr-writing')), 'a reset removes the skill versions');
});
