import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import type { Artifact, Submission } from './model.ts';
import { HttpError } from './model.ts';
import { publishedText } from './export.ts';
import { minerIndex, readContent } from './content.ts';
import { repositoryRoot } from './config.ts';

export interface SubmitTarget {
  repository: string; base: string; note: string; skillDirectory?: string;
  /** The project's directory inside the repository; every submitted path is under it. */
  directory?: string;
}
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

const pathOf = (path: string) => path.split('/').map(encodeURIComponent).join('/');
/** gh reports the HTTP status of a failed request as "(HTTP 404)". */
const status = (error: unknown, code: number) => (error as Error).message?.includes('(HTTP ' + code + ')');

function safePath(path: string) {
  if (!path || path.startsWith('/') || path.split('/').some(p => p === '..' || p === '.git') || path.includes('\\')) throw new HttpError('仓内文件路径无效');
  return path;
}

/** The GitHub repository each project's code lives in, the project's directory inside it, and the branch its data is on.
 *  Assumed for the demo: 信用卡营销交付 is the workspace/ directory of teams-talent-demo, maintained on develop. */
export const projectRepositories: Record<string, { upstream: string; directory: string; base: string }> = {
  carddemo: { upstream: 'zhuyuloveai/teams-talent-demo', directory: 'workspace', base: 'develop' },
};
/** The local clone whose remotes decide between the upstream repository and a fork of it. */
const checkout = process.env.DEMO_PR_CHECKOUT ?? repositoryRoot;
const gitRemotes = () => new Promise<string[]>(resolve => execFile('git', ['-C', checkout, 'remote', '-v'], (error, stdout) =>
  resolve(error ? [] : stdout.split('\n').map(line => line.split(/\s+/)[1]).filter(Boolean))));
const githubRepository = (url: string) => /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(url)?.[1] ?? null;

export interface DefaultTarget { repository: string; base: string; fork: boolean; directory: string }
/** Where a project's PRs go by default: a fork of its repository among the local git remotes, else the repository itself; always the project's branch. */
export async function defaultTarget(projectId: string | null, gh: Github = github, remotes = gitRemotes): Promise<DefaultTarget> {
  const project = projectId ? projectRepositories[projectId] : undefined;
  if (!project) throw new HttpError('这个项目还没有关联 GitHub 仓库，请手动填写', 404);
  const upstream = project.upstream.toLowerCase();
  const candidates = [...new Set((await remotes()).map(githubRepository).filter((r): r is string => !!r && r.toLowerCase() !== upstream))];
  for (const candidate of candidates) {
    const info = await gh('GET', 'repos/' + candidate).catch(() => null);
    if (info?.fork && [info.parent?.full_name, info.source?.full_name].some(name => name?.toLowerCase() === upstream)) return { repository: info.full_name, base: project.base, fork: true, directory: project.directory };
  }
  return { repository: project.upstream, base: project.base, fork: false, directory: project.directory };
}

export function knowledgeFiles(a: Artifact) {
  return (a.files ?? []).map(key => {
    const revision = a.draft?.revisions.filter(r => r.file === key).at(-1);
    const text = !a.draft ? publishedText(a, key) : revision?.text ?? (key === 'miner/index.md' ? minerIndex(a.specs ?? []) : readContent(key));
    if (text == null) throw new HttpError('找不到产物文件：' + key);
    return { path: safePath('docs/knowledge/' + a.id + '/' + key), text };
  });
}

/** Creates a commit on a dedicated branch through gh; the developer's checkout is never modified.
 *  onStep is called as each step starts: 0 read the base branch, 1 check the files, 2 commit, 3 branch, 4 PR (src/components/submit-pr.tsx). */
export async function submitPullRequest(a: Artifact, target: SubmitTarget, suggestionId?: string, gh: Github = github, onStep: (step: number) => void = () => undefined): Promise<Submission> {
  const repository = target.repository.trim().replace(/^https:\/\/github.com\//, '').replace(/\.git$/, '');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !target.base.trim()) throw new HttpError('请填写 GitHub 仓库 owner/repo 和目标分支');
  if (a.kind === 'index') throw new HttpError('远端索引无需提交 PR');
  const root = 'repos/' + repository, directory = target.directory ?? '';
  // Each gh call is a round trip to GitHub, so only small responses are read and independent ones run together.
  onStep(0);
  const head = await gh('GET', root + '/git/ref/heads/' + pathOf(target.base)).catch(error => {
    throw status(error, 404) ? new HttpError('目标分支不存在：' + target.base) : error;
  });
  const baseSha: string = head.object.sha;
  const baseTree: Promise<string> = gh('GET', root + '/git/commits/' + baseSha).then(c => c.tree.sha);
  baseTree.catch(() => undefined); // awaited below; reading the files may fail first
  /** The file as stored, line endings included; empty when it does not exist. */
  const read = (path: string): Promise<string> => gh('GET', root + '/contents/' + pathOf(path) + '?ref=' + baseSha)
    .then(file => Buffer.from(file.content, 'base64').toString('utf8'), error => { if (status(error, 404)) return ''; throw error; });
  const lf = (text: string) => text.replace(/\r\n/g, '\n');
  // Keep a file's CRLF line endings so the PR shows only the suggested change.
  const like = (stored: string, text: string) => stored.includes('\r\n') ? lf(text).replace(/\n/g, '\r\n') : text;
  onStep(1);
  let title = a.name;
  let files: { path: string; text: string }[];
  if (suggestionId) {
    const report = JSON.parse(readContent('trajectory/' + a.topic + '/report.json') ?? '{}');
    const suggestion = report.suggestions?.find((s: any) => s.id === suggestionId);
    if (!suggestion) throw new HttpError('建议不存在', 404);
    title = suggestion.title;
    if (suggestion.kind === 'skill') {
      const dir = safePath(target.skillDirectory?.trim() || posix.join(directory, '.agents/skills', suggestion.skill));
      files = await Promise.all(suggestion.files.map(async (f: any) => {
        const path = safePath(posix.join(dir, safePath(f.path)));
        const before = await read(path);
        if (lf(before).trim() !== lf(f.before).trim()) throw new HttpError('目标文件与建议依据不同，请更新诊断后重试：' + path);
        return { path, text: like(before, f.after) };
      }));
    } else {
      const rules = JSON.parse(readContent('trajectory/' + a.topic + '/rules.json') ?? '{}');
      if (!rules[suggestionId]) throw new HttpError('建议缺少项目规则');
      const path = safePath(posix.join(directory, 'AGENTS.md')), before = await read(path);
      files = [{ path, text: like(before, before.trimEnd() + '\n\n<!-- Talents: ' + a.id + '/' + suggestionId + ' -->\n- ' + rules[suggestionId] + '\n') }];
    }
  } else {
    if (!a.draft && a.submission) throw new HttpError('没有待提交的新版本');
    files = knowledgeFiles(a).map(f => ({ ...f, path: safePath(posix.join(directory, f.path)) }));
  }
  if (!files.length) throw new HttpError('没有可提交的文件');
  const version = (a.submission?.version ?? a.published?.version ?? 0) + 1;
  const digest = createHash('sha256').update(JSON.stringify([repository, target.base, a.id, suggestionId, files])).digest('hex').slice(0, 16);
  const branch = 'talents/' + digest;
  onStep(2);
  const tree = await gh('POST', root + '/git/trees', { base_tree: await baseTree, tree: files.map(f => ({ path: f.path, mode: '100644', type: 'blob', content: f.text })) });
  const commit = await gh('POST', root + '/git/commits', { message: title, tree: tree.sha, parents: [baseSha] });
  onStep(3);
  // The branch name is stable, so an existing branch means an earlier attempt got this far: reuse its PR if it has one.
  const created = await gh('POST', root + '/git/refs', { ref: 'refs/heads/' + branch, sha: commit.sha }).then(() => true, error => { if (status(error, 422)) return false; throw error; });
  onStep(4);
  const existing = created ? [] : await gh('GET', root + '/pulls?state=all&head=' + encodeURIComponent(repository.split('/')[0] + ':' + branch));
  const url: string = existing[0]?.html_url ?? (await gh('POST', root + '/pulls', { title, head: branch, base: target.base,
    body: [target.note || title, '', '来源：Talents · ' + a.name + (suggestionId ? ' / ' + suggestionId : ''), '', '变更文件：', ...files.map(f => '- `' + f.path + '`')].join('\n') })).html_url;
  return { url, repository, base: target.base, branch, at: new Date().toISOString(), version, ...(suggestionId ? { suggestionId } : {}), files };
}
