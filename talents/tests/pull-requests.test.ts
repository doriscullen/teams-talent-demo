import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedState } from '../server/seed.ts';
import { readContent } from '../server/content.ts';
import { buildExport } from '../server/export.ts';
import { knowledgeFiles, submitPullRequest, type Github } from '../server/pull-requests.ts';

const target = { repository: 'example/project', base: 'main', note: 'test' };
function fakeGithub(contents: Record<string, string> = {}, existing = false) {
  const calls: { method: string; path: string; body: any }[] = [];
  const gh: Github = async (method, path, body) => {
    calls.push({ method, path, body });
    if (path.includes('/commits/main')) return { sha: 'base', commit: { tree: { sha: 'base-tree' } } };
    if (method === 'GET' && path.includes('/git/trees/')) return { tree: Object.keys(contents).map(path => ({ path, sha: path })) };
    if (path.includes('/git/blobs/')) return { content: Buffer.from(contents[path.split('/git/blobs/')[1]]).toString('base64') };
    if (method === 'GET' && path.includes('/pulls?')) return existing ? [{ html_url: 'https://github.com/example/project/pull/7' }] : [];
    if (path.includes('/matching-refs/')) return [];
    if (method === 'POST' && path.endsWith('/pulls')) return { html_url: 'https://github.com/example/project/pull/7' };
    return { sha: 'generated' };
  };
  return { gh, calls };
}

test('knowledge PR contains revised text, stable branch and a snapshot; never updates published Teams inputs', async () => {
  const state = seedState(), a = state.artifacts.find(a => a.id === 'a-biz')!;
  a.draft!.revisions.push({ file: a.files![0], text: '# reviewed\n' });
  assert.equal(knowledgeFiles(a)[0].text, '# reviewed\n');
  const before = structuredClone(a), fake = fakeGithub();
  const submission = await submitPullRequest(a, target, undefined, fake.gh);
  assert.equal(submission.files[0].path, 'docs/knowledge/a-biz/' + a.files![0]);
  assert.equal(submission.files[0].text, '# reviewed\n');
  assert.deepEqual(a, before);
  assert.equal(fake.calls.filter(c => c.path.endsWith('/pulls') && c.method === 'POST').length, 1);
  assert.ok(fake.calls.some(c => c.path.endsWith('/git/trees') && c.body.base_tree === 'base-tree'));
  a.submission = submission;
  assert.ok(!buildExport(state).knowledge.artifacts.some(a => a.id === 'a-biz'));
  const retry = fakeGithub({}, true);
  const recovered = await submitPullRequest(before, target, undefined, retry.gh);
  assert.equal(recovered.branch, submission.branch);
  assert.equal(retry.calls.filter(c => c.method === 'POST').length, 0);
});

test('rule PR preserves existing AGENTS.md and does not write Skill versions or local rules', async () => {
  const state = seedState(), a = state.artifacts.find(a => a.kind === 'diagnosis')!;
  const fake = fakeGithub({ 'AGENTS.md': '# Existing rules\n' });
  const result = await submitPullRequest(a, target, 'change-03', fake.gh);
  assert.match(result.files[0].text, /^# Existing rules\n/);
  assert.match(result.files[0].text, /最后一次完整验证/);
  assert.equal(result.files[0].path, 'AGENTS.md');
  assert.deepEqual(state.skillVersions, []);
  assert.ok(!state.artifacts.some(a => a.id === 'a-rules-carddemo'));
});

test('Skill PR checks the diagnosis basis and preserves nested file paths', async () => {
  const a = seedState().artifacts.find(a => a.kind === 'diagnosis')!;
  const report = JSON.parse(readContent('trajectory/' + a.topic + '/report.json')!);
  const suggestion = report.suggestions.find((s: any) => s.kind === 'skill');
  const contents = Object.fromEntries(suggestion.files.map((f: any) => ['.agents/skills/' + suggestion.skill + '/' + f.path, f.before]));
  const fake = fakeGithub(contents);
  const result = await submitPullRequest(a, target, suggestion.id, fake.gh);
  assert.equal(result.files.length, suggestion.files.length);
  assert.deepEqual(result.files.map(f => f.text), suggestion.files.map((f: any) => f.after));
  const stale = fakeGithub();
  await assert.rejects(submitPullRequest(a, target, suggestion.id, stale.gh), /建议依据不同/);
  assert.ok(!stale.calls.some(c => c.method === 'POST'));
});

test('gh failures propagate and indexes cannot be submitted', async () => {
  const a = seedState().artifacts.find(a => a.id === 'a-biz')!;
  await assert.rejects(submitPullRequest(a, target, undefined, async () => { throw new Error('mock: gh not authenticated'); }), /not authenticated/);
  await assert.rejects(submitPullRequest(seedState().artifacts[0], target, undefined, fakeGithub().gh), /远端索引/);
});
