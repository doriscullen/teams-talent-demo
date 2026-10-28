import { terminalPreferences } from './terminal-preferences.js';
import { createTerminalLauncher, findExecutable, formatShellCommand, posixQuote } from './terminal-launcher.js';
import { userSkillExamples } from '../src/project-skill-examples.js';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { access, readFile, mkdir, writeFile, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { binary, workspace, runtimeDir, codeRoot, root, origin, traceDataDir, icodeBinarySource, icodeBinaryNotes } from './config.js';
import { atomicJson, atomicText } from './store.js';
import { nativeSkillEnvironment } from './native-skill-reader.js';
import { nativeTraceRuntime } from './native-trace-runtime.js';
import { ensureNativeTuiHooks } from './native-tui-hooks.js';
import { nativeTraceEnvironment, checkNativeTraceReceiver, traceLaunchSettings } from '../scripts/native/tui-trace.mjs';
import type { ProjectWorkPlan } from '../src/project-work.js';
import type { DemoState } from '../src/domain.js';
const execute = promisify(execFile);
let launchBusy = false;
const launched = new Map<string, { identity: string; result: Promise<unknown> }>();
const terminalLauncher = createTerminalLauncher();
const expectedTraceReceiver = () => process.env.DEMO_TRACE_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ? {} : {app:'teams-trace-server',workspaceRoot:root,stateRoot:traceDataDir};
export const shellQuote = posixQuote;
export async function installed(path: string) { try { await access(path, constants.X_OK); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; } }
async function openCodePath() {
  return findExecutable(process.env.DEMO_OPENCODE_BINARY ?? 'opencode');
}
export async function toolsStatus() {
  let installedICode = false, installError: string | undefined;
  try { installedICode = await installed(binary); }
  catch (error) { installError = 'iCode 探测失败：' + (error as Error).message; }
  let version: string | null = null, versionError: string | undefined;
  if (installedICode) {
    try { version = (await execute(binary, ['--version'], { timeout: 15000, windowsHide: true })).stdout.trim(); }
    catch (error) { versionError = 'iCode 版本探测失败：' + (error as Error).message; }
  }
  let opencode: string | null = null, openError: string | undefined;
  try { opencode = await openCodePath(); }
  catch (error) { openError = 'OpenCode 探测失败：' + (error as Error).message; }
  const unsupportedReason = openError ?? (process.platform === 'win32' && opencode && !/\.exe$/i.test(opencode) ? '检测到 OpenCode .cmd/.bat；自动启动需设置 DEMO_OPENCODE_BINARY 为 opencode.exe 的绝对路径。' : undefined);
  let openVersion: string | null = null;
  if (opencode && !unsupportedReason) {
    try { openVersion = (await execute(opencode, ['--version'], { timeout: 15000, windowsHide: true })).stdout.trim(); }
    catch (error) { openError = 'OpenCode 版本探测失败：' + (error as Error).message; }
  }
  const notes = [...icodeBinaryNotes, ...(installError ? [installError] : []), ...(versionError ? [versionError] : [])];
  return {
    ...await terminalPreferences.context(),
    icode: { installed: installedICode, path: binary, version, workspace, sessionId: '', sessionAvailable: false, active: null, source: icodeBinarySource, notes },
    opencode: { installed: !!opencode && !unsupportedReason, path: opencode, version: openVersion, unsupportedReason, notes: openError ? [openError] : [] },
    verification: null,
  };
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
    '## 本机资料', '项目：' + codeRoot, '当前规则：' + join(root, 'src/cashback.ts'), '需求设计：' + join(root, 'docs/cashback-contract.md'), 'Skill：' + join(workspace, 'skills'), '',
    chosen.some(name=>userSkillExamples.some(skill=>skill.id===name)) ? '## 本次选用 Skill（项目与用户）' : '## 本次项目选用 Skill', ...chosen.map(name => { const example=userSkillExamples.find(skill=>skill.id===name);return example ? '- '+example.name+'（'+name+' · 用户 Skill，未核验本机安装）：'+example.content : '- ' + name + '：' + join(workspace, 'skills', name, 'SKILL.md'); }), '',
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
export async function nativeWorkDefaults(): Promise<(Omit<ProjectWorkPlan['instance'], 'installed' | 'name'> & {agent:string;agentLabel:string;model:string;modelLabel:string;terminal:{id:string;name:string;error?:string}}) | null> {
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
  const trace = nativeTraceEnvironment(process.env, { projectId: 'pending' });
  const traceStatus: NonNullable<ProjectWorkPlan['instance']['trace']> = { endpoint:trace.endpoint,enabled:trace.enabled,sensitiveData:trace.sensitiveData, readiness: trace.enabled && process.env.DEMO_NATIVE_DISABLED !== '1' ? 'unavailable' : 'disabled', diagnostic: process.env.DEMO_NATIVE_DISABLED === '1' ? '此验证实例未开放原生启动' : trace.enabled ? '' : '按本机显式配置关闭 trace' };
  if (trace.enabled && process.env.DEMO_NATIVE_DISABLED !== '1') try { await nativeTraceRuntime(); await checkNativeTraceReceiver(trace.endpoint, expectedTraceReceiver()); traceStatus.readiness = 'ready'; traceStatus.diagnostic = '接收端已就绪；实际轨迹以接收记录为准'; } catch (error) { traceStatus.diagnostic = '本机 trace 接收端未就绪：' + (error as Error).message; }
  return { trace: traceStatus, agent: role.id, agentLabel: role.displayName, model: matches[0].id, modelLabel: matches[0].name, terminal: { id: preference.selectedTerminal, name: preference.terminalName, error: preference.terminalError } };
}
export async function startNativeWork(input: { directory: string; agent: string; model: string; sessionId?: string; instruction: string; terminal: string; task?: { runId: string; path: string; scope: { projectId: string; taskId: string; nodeId: string }; preparedSession?: { preparationRunId: string; sourceRunId: string; sessionSha256: string; sessionId: string } } }) {
  if (process.env.DEMO_NATIVE_DISABLED === '1') throw new Error('此验证实例未开放真实原生启动');
  if (input.task) {
    if (!/^[0-9a-f-]{36}$/i.test(input.task.runId) || input.sessionId && input.task.preparedSession?.sessionId !== input.sessionId) throw new Error('当前任务只允许新会话或已核验的同任务准备会话');
    const output = join(runtimeDir, 'work-contexts', input.task.runId + '.native');
    const trace = nativeTraceEnvironment(process.env, { ...input.task.scope, runId: input.task.runId });
    const traceRuntime = trace.enabled ? await nativeTraceRuntime() : undefined;
    if (trace.enabled) await checkNativeTraceReceiver(trace.endpoint, expectedTraceReceiver());
    await mkdir(output, { recursive: true });
    const manifest = join(output, 'manifest.json');
    await atomicJson(manifest, { version: 1, executionMode: 'interactive', runId: input.task.runId, scope: input.task.scope, executable: binary, directory: input.directory, agent: input.agent, model: input.model, ...(input.task.preparedSession?{preparedSession:input.task.preparedSession}:{}), trace: {...traceLaunchSettings(trace),...expectedTraceReceiver(),runtime:traceRuntime}, taskFile: input.task.path, taskSha256: createHash('sha256').update(await readFile(input.task.path)).digest('hex') });
    const nativeEnvironment = traceRuntime ?? await nativeSkillEnvironment();
    await ensureNativeTuiHooks(join(root, 'scripts/native/tui-work-hook.mjs'), join(runtimeDir, 'native-hook-backups'), nativeEnvironment.configDirectory, join(root, '..', 'demo', 'scripts/native/tui-work-hook.mjs'));
    const terminal = await terminalPreferences.selected(input.terminal);
    const receipt = await terminalLauncher.launch({ executable: process.execPath, directory: input.directory, args: [join(root, 'scripts/native/run-project-tui.mjs'), manifest], instruction: input.sessionId ? '恢复当前任务已准备的 iCode 会话；保留阅读背景与待确认问题，等待你继续交互。' : '进入 iCode 交互界面；输入工作指令后，当前任务节点上下文将通过原生 Hook 附带。', terminal: terminal.id });
    await atomicJson(join(output, 'terminal-receipt.json'), { runId: input.task.runId, ...input.task.scope, directory: input.directory, terminalKind: terminal.id, at: new Date().toISOString(), ...receipt });
    return receipt;
  }
  const args = ['-C', input.directory, '--agent', input.agent, '--model', input.model, ...(input.sessionId ? ['--session', input.sessionId] : [])];
  const terminal = await terminalPreferences.selected(input.terminal);
  return terminalLauncher.launch({ executable: binary, directory: input.directory, args, instruction: input.instruction, terminal: terminal.id });
}

/** Explicit non-interactive work: no terminal and no implicit task advancement. */
export async function startNativeCliWork(input: Omit<Parameters<typeof startNativeWork>[0], 'terminal'>) {
  if(process.env.DEMO_NATIVE_DISABLED==='1')throw new Error('此验证实例未开放真实原生启动');
  if(!input.task||!/^[0-9a-f-]{36}$/i.test(input.task.runId)||!input.task.preparedSession||input.sessionId!==input.task.preparedSession.sessionId)throw new Error('CLI 工作必须恢复当前任务已核验的准备会话');
  const output=join(runtimeDir,'work-contexts',input.task.runId+'.native');
  const trace=nativeTraceEnvironment(process.env,{...input.task.scope,runId:input.task.runId});
  const traceRuntime=trace.enabled?await nativeTraceRuntime():undefined;
  if(trace.enabled)await checkNativeTraceReceiver(trace.endpoint,expectedTraceReceiver());
  await mkdir(output,{recursive:true});
  const manifest=join(output,'manifest.json');
  await atomicJson(manifest,{version:1,executionMode:'task-file',runId:input.task.runId,scope:input.task.scope,executable:binary,directory:input.directory,agent:input.agent,model:input.model,preparedSession:input.task.preparedSession,trace:{...traceLaunchSettings(trace),...expectedTraceReceiver(),runtime:traceRuntime},taskFile:input.task.path,taskSha256:createHash('sha256').update(await readFile(input.task.path)).digest('hex')});
  const out=await open(join(output,'observer-output.log'),'wx',0o600);let err:Awaited<ReturnType<typeof open>>|undefined;
  try {
    err=await open(join(output,'observer-error.log'),'wx',0o600);
    const child=spawn(process.execPath,[join(root,'scripts/native/run-project-task.mjs'),manifest],{cwd:input.directory,env:trace.env,detached:true,windowsHide:true,stdio:['ignore',out.fd,err.fd]});
    await new Promise<void>((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
    await atomicJson(join(output,'cli-launch.json'),{runId:input.task.runId,...input.task.scope,pid:child.pid,startedAt:new Date().toISOString()});child.unref();
    return {status:'cli-requested',pid:child.pid};
  } finally {await out.close();await err?.close();}
}
