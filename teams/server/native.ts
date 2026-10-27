import { terminalPreferences } from './terminal-preferences.js';
import { createTerminalLauncher, findExecutable, formatShellCommand, posixQuote } from './terminal-launcher.js';
import { userSkillExamples } from '../src/project-skill-examples.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, readFile, mkdir, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { binary, workspace, runtimeDir, codeRoot, root, origin } from './config.js';
import { atomicJson, atomicText } from './store.js';
import type { DemoState } from '../src/domain.js';
const execute = promisify(execFile);
let launchBusy = false;
const launched = new Map<string, { identity: string; result: Promise<unknown> }>();
const terminalLauncher = createTerminalLauncher();
export const shellQuote = posixQuote;
export async function installed(path: string) { try { await access(path, constants.X_OK); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; } }
async function openCodePath() {
  return findExecutable(process.env.DEMO_OPENCODE_BINARY ?? 'opencode');
}
export async function toolsStatus() {
  const iCodeInstalled = await installed(binary), opencode = await openCodePath();
  const version = iCodeInstalled ? (await execute(binary, ['--version'], { timeout: 15000 })).stdout.trim() : null;
  const unsupportedReason = process.platform === 'win32' && opencode && !/\.exe$/i.test(opencode) ? '检测到 OpenCode .cmd/.bat；自动启动需设置 DEMO_OPENCODE_BINARY 为 opencode.exe 的绝对路径。' : undefined;
  const openVersion = opencode && !unsupportedReason ? (await execute(opencode, ['--version'], { timeout: 15000 })).stdout.trim() : null;
  return { ...await terminalPreferences.context(), icode: { installed: iCodeInstalled, path: binary, version, workspace, sessionId: '', sessionAvailable: false, active: null }, opencode: { installed: !!opencode && !unsupportedReason, path: opencode, version: openVersion, unsupportedReason }, verification: null };
}
export async function foundationSkill() {
  const path = join(root, 'skills/teams-demo-collaboration/SKILL.md');
  const content = await readFile(path, 'utf8');
  const cli = formatShellCommand([process.execPath, join(root, 'scripts/teams-demo.mjs'), '--endpoint', origin]);
  return { path, content, cli, origin: 'demo-local-cli' };
}
export async function writeContext(state: DemoState) {
  if (!state.context) throw new Error('请先冻结项目上下文');
  const chosen=state.context.selectedSkills;
  const foundation=await foundationSkill();
  const path = join(runtimeDir, 'contexts', state.context.id + '-' + createHash('sha256').update(state.context.createdAt).digest('hex').slice(0, 12) + '-v3.md');
  const content = [
    '# 信用卡消费返现 · DEMO-MKT-001', '',
    '这是当前需求的上下文材料。当前规则实现位于 teams/src/cashback.ts；请先阅读与核对，不要执行部署、发送消息或修改全局配置。', '',
    '## 需求描述', '针对白金卡客户未来 3 个月的消费，额外增加 0.5% 的消费返现。', '',
    '## 已确认范围与待定事项', '已确认：白金卡客户、3 个月、额外返现 0.5%。具体日期、周期起算、消费范围、报名要求、门槛、上限及结算等其他规则待定。当前本地参数不替代正式业务政策。', '',
    '## 采用依据', JSON.stringify(state.context, null, 2), '',
    '## 本机资料', '项目：' + codeRoot, '当前规则：' + join(root, 'src/cashback.ts'), '需求设计：' + join(root, 'docs/cashback-contract.md'), 'Skill：' + join(workspace, '.agents', 'skills'), '',
    chosen.some(name=>userSkillExamples.some(skill=>skill.id===name)) ? '## 本次选用 Skill（项目与用户）' : '## 本次项目选用 Skill', ...chosen.map(name => { const example=userSkillExamples.find(skill=>skill.id===name);return example ? '- '+example.name+'（'+name+' · 用户 Skill，未核验本机安装）：'+example.content : '- ' + name + '：' + join(workspace, '.agents', 'skills', name, 'SKILL.md'); }), '',
    '## 需求补充材料', ...state.context.materials.flatMap(m=>['### '+m.title,m.body,'']),
    '## Agent 基础协作', 'Teams 进度同步 Skill：'+foundation.path,'通过 Teams CLI 回传进度。业务 Skill 与该基础能力分别管理。','',
    '## 验证范围', '卡片资格、期间与金额规则可本地验证；真实服务与生产安全仍未验证。功能验收不代表生产放行。', '',
    '上下文由 Teams 导出；提供文件不等于 iCode 已读取或已采用。'
  ].join('\n');
  await mkdir(join(runtimeDir, 'contexts'), { recursive: true });
  let previous: string | undefined;
  try { previous = await readFile(path, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  if (previous !== undefined && previous !== content) throw new Error('已冻结上下文文件不同，请重置工作区后重新准备');
  if (previous === undefined) await atomicText(path, content);
  return { path, sha256: createHash('sha256').update(content).digest('hex'), content, prompt: '请读取并核对这份项目上下文，先不要修改代码：' + path };
}
export function launch(tool: 'icode' | 'opencode', restore: boolean, requestId: string, expectedTerminal?: string) {
  const identity = JSON.stringify({ tool, restore, expectedTerminal }), previous = launched.get(requestId);
  if (previous) { if (previous.identity !== identity) return Promise.reject(new Error('原启动请求标识已用于另一动作')); return previous.result; }
  if (launchBusy) return Promise.reject(new Error('启动请求正在执行'));
  launchBusy = true;
  const result = (async () => {
    const entry = tool === 'icode' ? binary : await openCodePath();
    if (!entry || !await installed(entry)) throw new Error(tool + ' 尚未安装');
    if (restore) throw new Error('历史恢复入口已移除，请新建当前工作的会话');
    const args = tool === 'icode' ? ['-C', workspace] : [workspace];
    const terminal = await terminalPreferences.selected(expectedTerminal);
    const launchedTerminal = await terminalLauncher.launch({ executable: entry, directory: workspace, args, terminal: terminal.id });
    const receipt = { requestId, tool, restore, at: new Date().toISOString(), ...launchedTerminal, sessionId: null };
    await atomicJson(join(runtimeDir, 'last-launch.json'), receipt); return receipt;
  })().finally(() => { launchBusy = false; });
  // Retain failures too: an uncertain original request must never silently launch again.
  launched.set(requestId, { identity, result }); return result;
}

/** Native work entry: caller has validated and pinned the project directory/configuration. */
export async function nativeWorkDefaults() {
  if (!await installed(binary)) return null;
  const [agentReply, modelReply] = await Promise.all([
    execute(binary, ['agent', '--json'], { timeout: 10000, maxBuffer: 262144 }),
    execute(binary, ['model', '--json'], { timeout: 10000, maxBuffer: 262144 }),
  ]);
  const agents = JSON.parse(agentReply.stdout), models = JSON.parse(modelReply.stdout);
  if (!Array.isArray(agents.agents) || !Array.isArray(models.models)) throw new Error('iCode 默认配置响应无效');
  const role = agents.agents.find((agent: any) => agent.name === agents.default && agent.default === true);
  if (!role || role.launchableAsMain !== true || role.subAgentOnly) throw new Error('iCode 默认角色不能作为主会话启动');
  const selector = role.model === 'active' ? models.active : role.model;
  const matches = models.models.filter((model: any) => model.id === selector || model.name === selector);
  if (matches.length !== 1) throw new Error('iCode 默认角色的模型配置无效');
  const preference = await terminalPreferences.context();
  return { agent: role.id, agentLabel: role.displayName, model: matches[0].id, modelLabel: matches[0].name, terminal: { id: preference.selectedTerminal, name: preference.terminalName, error: preference.terminalError } };
}
export async function startNativeWork(input: { directory: string; agent: string; model: string; sessionId?: string; instruction: string; terminal: string; task?: { runId: string; path: string; scope: { projectId: string; taskId: string; nodeId: string } } }) {
  if (input.task) {
    if (input.sessionId || !/^[0-9a-f-]{36}$/i.test(input.task.runId)) throw new Error('自动任务仅支持明确的新会话请求');
    const output = join(runtimeDir, 'work-contexts', input.task.runId + '.native');
    await mkdir(output, { recursive: true });
    const manifest = join(output, 'manifest.json');
    await atomicJson(manifest, { version: 1, runId: input.task.runId, scope: input.task.scope, executable: binary, directory: input.directory, agent: input.agent, model: input.model, taskFile: input.task.path, taskSha256: createHash('sha256').update(await readFile(input.task.path)).digest('hex') });
    const terminal = await terminalPreferences.selected(input.terminal);
    return terminalLauncher.launch({ executable: process.execPath, directory: input.directory, args: [join(root, 'scripts/native/run-project-task.mjs'), manifest], instruction: 'iCode 将读取本次任务文件并执行；运行记录：' + output, terminal: terminal.id });
  }
  const args = ['-C', input.directory, '--agent', input.agent, '--model', input.model, ...(input.sessionId ? ['--session', input.sessionId] : [])];
  const terminal = await terminalPreferences.selected(input.terminal);
  return terminalLauncher.launch({ executable: binary, directory: input.directory, args, instruction: input.instruction, terminal: terminal.id });
}
