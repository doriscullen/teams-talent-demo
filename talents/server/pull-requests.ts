import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import type { Artifact, Submission } from './model.ts';
import { HttpError } from './model.ts';
import { publishedText } from './export.ts';
import { minerIndex, readContent } from './content.ts';

export interface SubmitTarget { repository: string; base: string; note: string; skillDirectory?: string }
export type Github = (method: string, path: string, body?: unknown) => Promise<any>;
export const github: Github = (method, path, body) => new Promise((resolve, reject) => {
  const child = spawn('gh', ['api', '--method', method, path, ...(body ? ['--input', '-'] : [])], { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', error = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { error += chunk; });
  child.on('error', reject);
  child.stdin.on('error', reject);
  child.on('close', code => code === 0 ? resolve(JSON.parse(output)) : reject(new Error(error.trim() || 'gh 请求失败')));
  child.stdin.end(body ? JSON.stringify(body) : undefined);
});

function safePath(path: string) {
  if (!path || path.startsWith('/') || path.split('/').some(p => p === '..' || p === '.git') || path.includes('\\')) throw new HttpError('仓内文件路径无效');
  return path;
}

export function knowledgeFiles(a: Artifact) {
  return (a.files ?? []).map(key => {
    const revision = a.draft?.revisions.filter(r => r.file === key).at(-1);
    const text = !a.draft ? publishedText(a, key) : revision?.text ?? (key === 'miner/index.md' ? minerIndex(a.specs ?? []) : readContent(key));
    if (text == null) throw new HttpError('找不到产物文件：' + key);
    return { path: safePath('docs/knowledge/' + a.id + '/' + key), text };
  });
}

/** Creates a commit on a dedicated branch through gh; the developer's checkout is never modified. */
export async function submitPullRequest(a: Artifact, target: SubmitTarget, suggestionId?: string, gh: Github = github): Promise<Submission> {
  const repository = target.repository.trim().replace(/^https:\/\/github.com\//, '').replace(/\.git$/, '');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !target.base.trim()) throw new HttpError('请填写 GitHub 仓库 owner/repo 和目标分支');
  if (a.kind === 'index') throw new HttpError('远端索引无需提交 PR');
  const root = 'repos/' + repository;
  const base = await gh('GET', root + '/commits/' + encodeURIComponent(target.base));
  const read = async (path: string) => {
    const tree = await gh('GET', root + '/git/trees/' + base.commit.tree.sha + '?recursive=1');
    const entry = tree.tree.find((f: any) => f.path === path);
    if (!entry) return '';
    const blob = await gh('GET', root + '/git/blobs/' + entry.sha);
    return Buffer.from(blob.content, 'base64').toString('utf8').replace(/\r\n/g, '\n');
  };
  let title = a.name;
  let files: { path: string; text: string }[];
  if (suggestionId) {
    const report = JSON.parse(readContent('trajectory/' + a.topic + '/report.json') ?? '{}');
    const suggestion = report.suggestions?.find((s: any) => s.id === suggestionId);
    if (!suggestion) throw new HttpError('建议不存在', 404);
    title = suggestion.title;
    if (suggestion.kind === 'skill') {
      const dir = safePath(target.skillDirectory?.trim() || '.agents/skills/' + suggestion.skill);
      files = [];
      for (const f of suggestion.files) {
        const path = safePath(posix.join(dir, safePath(f.path)));
        const before = await read(path);
        if (before.trim() !== f.before.trim()) throw new HttpError('目标文件与建议依据不同，请更新诊断后重试：' + path);
        files.push({ path, text: f.after });
      }
    } else {
      const rules = JSON.parse(readContent('trajectory/' + a.topic + '/rules.json') ?? '{}');
      if (!rules[suggestionId]) throw new HttpError('建议缺少项目规则');
      const before = await read('AGENTS.md');
      files = [{ path: 'AGENTS.md', text: before.trimEnd() + '\n\n<!-- Talents: ' + a.id + '/' + suggestionId + ' -->\n- ' + rules[suggestionId] + '\n' }];
    }
  } else {
    if (!a.draft && a.submission) throw new HttpError('没有待提交的新版本');
    files = knowledgeFiles(a);
  }
  if (!files.length) throw new HttpError('没有可提交的文件');
  const version = (a.submission?.version ?? a.published?.version ?? 0) + 1;
  const digest = createHash('sha256').update(JSON.stringify([repository, target.base, a.id, suggestionId, files])).digest('hex').slice(0, 16);
  const branch = 'talents/' + digest;
  // A stable branch also lets retries recover a PR created before the local record was saved.
  const existing = await gh('GET', root + '/pulls?state=all&head=' + encodeURIComponent(repository.split('/')[0] + ':' + branch));
  let url = existing[0]?.html_url;
  if (!url) {
    const tree = await gh('POST', root + '/git/trees', { base_tree: base.commit.tree.sha, tree: files.map(f => ({ path: f.path, mode: '100644', type: 'blob', content: f.text })) });
    const commit = await gh('POST', root + '/git/commits', { message: title, tree: tree.sha, parents: [base.sha] });
    const refs = await gh('GET', root + '/git/matching-refs/heads/' + branch);
    if (!refs.length) await gh('POST', root + '/git/refs', { ref: 'refs/heads/' + branch, sha: commit.sha });
    const pr = await gh('POST', root + '/pulls', { title, head: branch, base: target.base, body: [target.note || title, '', '来源：Talents · ' + a.name + (suggestionId ? ' / ' + suggestionId : ''), '', '变更文件：', ...files.map(f => '- `' + f.path + '`'), '', '请审阅内容后合入。'].join('\n') });
    url = pr.html_url;
  }
  return { url, repository, base: target.base, branch, at: new Date().toISOString(), version, ...(suggestionId ? { suggestionId } : {}), files };
}
