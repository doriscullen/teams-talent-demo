import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { NativePreparationReceipt } from '../src/native-preparation.js';
import { atomicJson } from './store.js';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
interface Reading { path: string; sha256: string }
export interface PreparationInput {
  runId: string; scope: { projectId: string; taskId: string; nodeId: 'prepare' }; assigneeId: string;
  directory: string; executable: string; runner: string; runtime: string; taskFile: string;
  contextPath: string; skillPath: string; reads: Reading[];
  agent: string; agentLabel: string; model: string; modelLabel: string;
  env: NodeJS.ProcessEnv;
}
async function optional(path: string) { try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; } }
/** Validate native-visible tool calls and matching successful tool results. Never read reasoning text. */
export function preparationReadingEvidence(envelope: any, reads: Array<Reading & { content?: string }>) {
  const contents = (envelope.state?.messages ?? []).flatMap((message: any) => message.contents ?? []);
  const calls = contents.filter((part: any) => part.type === 'function_call');
  if (calls.some((call: any) => call.name !== 'read_file')) throw new Error('初始化使用了只读材料读取以外的工具，未标记会话已准备');
  const results = new Map<string, any>(contents.filter((part: any) => part.type === 'function_result').map((part: any) => [part.call_id, part]));
  return reads.map(read => {
    const call = calls.find((call: any) => {
      const arguments_ = typeof call.arguments === 'string' ? JSON.parse(call.arguments) : call.arguments;
      return arguments_?.path && resolve(arguments_.path) === resolve(read.path) && arguments_.start_line === undefined && arguments_.end_line === undefined;
    });
    const result = call && results.get(call.call_id);
    if (!call || !result || result.is_error || result.error || typeof result.result !== 'string' || !result.result.startsWith('File: ')) throw new Error('缺少完整材料的真实读取回执：' + read.path);
    if(read.content!==undefined){
      const rows=result.result.split('\n').slice(1);if(rows.at(-1)==='')rows.pop();
      const lines=rows.map((row:string,index:number)=>{const match=/^(\d+)\|(.*)$/.exec(row);if(!match||Number(match[1])!==index+1)throw new Error('材料读取被截断或缺行：'+read.path);return match[2];});
      if(lines.join('\n')!==read.content.replaceAll('\r\n','\n').replace(/\n$/,''))throw new Error('材料读取结果与实际版本不一致：'+read.path);
    }
    return { path:read.path,sha256:read.sha256,callId: String(call.call_id) };
  });
}
export async function verifiedPreparation(input: PreparationInput): Promise<NativePreparationReceipt | null> {
  const directory = join(input.runtime, 'work-contexts', input.runId + '.native');
  const result = await optional(join(directory, 'result.json'));
  if (!result) return null;
  if (result.status !== 'completed') throw new Error('iCode 初始化未完成：' + (result.error ?? result.status));
  const owner = await optional(join(directory, 'native-session.json'));
  if (!owner || owner.runId !== input.runId || owner.projectId !== input.scope.projectId || owner.taskId !== input.scope.taskId || owner.nodeId !== 'prepare' || !uuid.test(owner.sessionId) || result.sessionId !== owner.sessionId || owner.sessionRoot !== join(directory, 'session-root')) throw new Error('初始化原生会话身份不匹配');
  const bytes = await readFile(join(owner.sessionRoot, 'sessions', owner.sessionId.replaceAll('-', '').slice(0, 12), 'session.json'));
  const envelope = JSON.parse(bytes.toString('utf8'));
  if (envelope.meta?.session_id !== owner.sessionId) throw new Error('初始化原生会话正文身份不匹配');
  const readContents=await Promise.all(input.reads.map(async read=>{const bytes=await readFile(read.path);if(hash(bytes)!==read.sha256)throw new Error('初始化期间材料版本发生变化，未标记已准备');return{...read,content:bytes.toString('utf8')};}));
  const readEvidence = preparationReadingEvidence(envelope, readContents);
  const replies = (envelope.state?.messages ?? []).filter((message: any) => message.role === 'assistant').flatMap((message: any) => (message.contents ?? []).filter((part: any) => part.type === 'text').map((part: any) => part.text)).filter((text: unknown): text is string => typeof text === 'string' && !!text.trim());
  if (!replies.length) throw new Error('初始化会话尚无模型可见回复，未标记已准备');
  return { status: 'ready', runId: input.runId, sessionId: owner.sessionId, directory: input.directory, preparedAt: result.finishedAt, contextPath: input.contextPath, contextSha256: input.reads.find(read => read.path === input.contextPath)!.sha256, skillPath: input.skillPath, sessionSha256: hash(bytes), agent: input.agent, agentLabel: input.agentLabel, model: input.model, modelLabel: input.modelLabel, readEvidence, summary: replies.at(-1)!.slice(0, 6000) };
}
/** One real CLI turn. A persisted start identity is never silently retried after process loss. */
export async function prepareNativeSession(input: PreparationInput): Promise<NativePreparationReceipt> {
  if (process.env.DEMO_NATIVE_DISABLED === '1') throw new Error('此验证实例未开放真实原生会话准备');
  if (!uuid.test(input.runId)) throw new Error('初始化请求标识无效');
  const output = join(input.runtime, 'work-contexts', input.runId + '.native');
  await mkdir(output, { recursive: true });
  const taskSha256 = hash(await readFile(input.taskFile));
  const request = { version: 1, runId: input.runId, scope: input.scope, assigneeId: input.assigneeId, directory: await realpath(input.directory), taskSha256, reads: input.reads, agent: input.agent, model: input.model };
  const requestPath = join(output, 'preparation-request.json');
  let start = false;
  try { const file = await open(requestPath, 'wx', 0o600); try { await file.writeFile(JSON.stringify(request)); await file.sync(); } finally { await file.close(); } start = true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; if (JSON.stringify(await optional(requestPath)) !== JSON.stringify(request)) throw new Error('同一初始化请求不能改变任务、交付人或材料'); }
  if (start) {
    const manifest = join(output, 'manifest.json');
    await atomicJson(manifest, { ...request, executionMode: 'preparation', executable: input.executable, taskFile: input.taskFile });
    const out = await open(join(output, 'observer-output.log'), 'wx', 0o600), err = await open(join(output, 'observer-error.log'), 'wx', 0o600);
    try {
      const child = spawn(process.execPath, [input.runner, manifest], { cwd: input.directory, env: input.env, detached: true, windowsHide: true, stdio: ['ignore', out.fd, err.fd] });
      await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      await atomicJson(join(output, 'preparation-launch.json'), { runId: input.runId, pid: child.pid, at: new Date().toISOString() });
      child.unref();
    } catch (error) { await atomicJson(join(output, 'preparation-launch-error.json'), { error: (error as Error).message }); throw error; }
    finally { await out.close(); await err.close(); }
  }
  for (let attempt = 0; attempt < 600; attempt++) {
    const failed = await optional(join(output, 'preparation-launch-error.json'));
    if (failed) throw new Error('初始化启动失败：' + failed.error);
    const receipt = await verifiedPreparation(input);
    if (receipt) { await atomicJson(join(output, 'preparation-receipt.json'), receipt); return receipt; }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('初始化会话仍未取得可核验结果；原请求已保留，不会重复启动，请核对当前进程后重试查询');
}
