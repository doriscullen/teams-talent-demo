#!/usr/bin/env node
// Demo adaptation of Teams collaboration CLI. All writes stay on the explicit local demo endpoint.
import { readFile, mkdir, open, rename } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { runtimeDir, origin as configuredOrigin } from '../server/config.ts';
import { createHash, randomUUID } from 'node:crypto';
const help = `Teams CLI · 本机接入
context get | inputs adopt | progress add | result submit | operation get
--endpoint http://127.0.0.1:45970 (或 DEMO_ORIGIN)
--input '{"projectId":"…","taskId":"…","nodeId":"…"}' 或 --input-file FILE
context get 可用 --project / --task / --node；默认 --view model 去重上下文，--view full 查看完整响应。
context.currentNodeId 是任务当前阶段；切换业务环节须显式改 nodeId，重新读取并采用该节点输入。
--output FILE 保存所选上下文，stdout 只返回保存回执；不带 --output 才打印上下文。
写操作：--operation-id ID；input 包含 expectedRevision、runId、sessionId（未知时 null）。
inputs adopt：basisDigest、readReferences（实际阅读的引用 ID）。
progress add：adoptionId、phase=started|progress|blocked、summary、blocker（阻塞时）、evidence[]。
明确返工：context.rework.allowed 为 true 时，在对应节点的 started 载荷中指定 reopen=true；普通进度不重开已完成节点。
需求澄清在开发采用前、开发在验证待开始/阻塞时可重开；阻塞验证可显式开启新一轮。待验收/已验收不能由CLI修改，须Owner页面手工处理。
result submit：adoptionId、summary、completedCriteria[]、evidence[{kind:reference|local-file,value,description,artifact,version,codeVersion?,source:actual|preset}]。
context.nodeContract 返回本节点输入、交付物类型与标准ID；上游引用ID/版本原样采用。prepare采用不代表澄清完成，需提交PRD。verify checks按artifact关联功能/Review/安全报告，同批失败不能放行。
成果报告只记录交付人的贡献；Owner 本人交付也必须经过人工验收和质量门槛。
operation get：--operation-id ID。--receipt-dir DIR 指定本地请求和回执目录。
开发/验证进度携带 sessionId 会自动关联任务；Owner 验收通过后自动归集，无需再次上报。
读取上下文不会冻结或采用；写失败保留原请求并返回非零退出码。`;
let requestPath;
async function atomic(path, text) { await mkdir(dirname(path), { recursive: true }); const temp = path + '.' + randomUUID() + '.tmp'; const f = await open(temp, 'wx', 0o600); try { await f.writeFile(text); await f.sync(); } finally { await f.close(); } await rename(temp, path); }
try {
  const tokens = process.argv.slice(2), options = {}, positional = [];
  const allowed = new Set(['endpoint','input','input-file','project','task','node','tab','operation-id','output','receipt-dir','role','view']);
  for (let i = 0; i < tokens.length; i++) { const token = tokens[i]; if (token === '--help' || token === '-h') { console.log(help); process.exit(0); } if (!token.startsWith('--')) { positional.push(token); continue; } const name = token.slice(2); if (!allowed.has(name) || Object.hasOwn(options,name) || tokens[i+1] === undefined || tokens[i+1].startsWith('--')) throw new Error('未知、重复或缺少值的参数：' + token); options[name] = tokens[++i]; }
  const command = positional.join(' '), base = options.endpoint ?? process.env.DEMO_ORIGIN ?? configuredOrigin;
  const contextCommand = command === 'context get' || command === 'status';
  if (options.view && (!contextCommand || !['model','full'].includes(options.view))) throw new Error('--view 仅供 context get/status 使用，值为 model 或 full');
  const parsed = new URL(base); if (parsed.hostname !== '127.0.0.1' || parsed.protocol !== 'http:' || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) throw new Error('Teams CLI 仅允许明确的本机 HTTP origin');
  const origin = parsed.origin;
  async function request(path, body, token) { const response = await fetch(origin + path, { redirect: 'error', signal: AbortSignal.timeout(15000), ...(body ? { method: 'POST', headers: { 'content-type':'application/json', origin, 'x-demo-token':token }, body:JSON.stringify(body) } : {}) }); const value = await response.json(); if (!response.ok) throw new Error(`HTTP ${response.status}: ${value.error ?? '请求失败'}`); return value; }
  const health = await request('/api/health'); if (health.app !== 'teams-talent-carddemo' || health.service !== 'teams') throw new Error('目标不是 Teams 服务；未执行协作调用');
  if (options.input && options['input-file']) throw new Error('--input 和 --input-file 只能选一项');
  const input = JSON.parse(options.input ?? (options['input-file'] ? await readFile(options['input-file'],'utf8') : '{}'));
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('input 必须为 JSON 对象');
  for (const [flag,key] of [['project','projectId'],['task','taskId'],['node','nodeId'],['tab','tab']]) if (options[flag]) { if (input[key] !== undefined) throw new Error(key + ' 重复'); input[key] = options[flag]; }
  let result;
  if (contextCommand) {
    const query = new URLSearchParams({role:options.role??'member',view:options.view??'model'}); for (const key of ['projectId','taskId','nodeId','tab']) if (input[key] !== undefined) query.set(key,input[key]);
    if (!input.projectId) throw new Error('读取上下文必须指定 projectId，任务上下文同时指定 taskId 和 nodeId');
    result = await request('/api/collaboration/context?' + query);
  } else if (command === 'operation get') {
    if (!options['operation-id']) throw new Error('operation get 需要原 operation-id');
    result = await request('/api/collaboration/operation?operationId=' + encodeURIComponent(options['operation-id']));
  } else {
    const kind = ({ 'inputs adopt':'inputs.adopt', 'progress add':'progress.add', 'result submit':'result.submit' })[command];
    if (!kind) throw new Error(help);
    if (!options['operation-id']) throw new Error('每个逻辑写操作需要稳定 --operation-id；重试保留原 ID 与载荷');
    const payload = { role: options.role ?? 'member', kind, input, operationId: options['operation-id'] };
    const envelope = JSON.stringify({ endpoint:origin, payload },null,2) + '\n';
    const name = createHash('sha256').update(origin + ':' + payload.operationId).digest('hex');
    requestPath = join(resolve(options['receipt-dir'] ?? process.env.DEMO_CLI_RECEIPTS ?? join(runtimeDir,'cli-receipts')),name + '.request.json');
    await mkdir(dirname(requestPath),{recursive:true});
    try { const f = await open(requestPath,'wx',0o600); try { await f.writeFile(envelope); await f.sync(); } finally { await f.close(); } }
    catch (error) { if (error.code !== 'EEXIST') throw error; if (await readFile(requestPath,'utf8') !== envelope) throw new Error('本地已有相同操作 ID 的不同请求；拒绝覆盖。'); }
    const session = await request('/api/session'); result = await request('/api/collaboration',payload,session.token);
    const receiptPath = requestPath.replace('.request.json','.receipt.json'); await atomic(receiptPath,JSON.stringify(result,null,2)+'\n'); result = { ...result, requestPath, receiptPath };
  }
  if (options.output) {
    const path=resolve(options.output), content=JSON.stringify(result,null,2)+'\n';
    await atomic(path,content);
    result=contextCommand ? {ok:true,kind:'context.saved',view:options.view??'model',outputPath:path,scope:result.scope,revision:result.revision,basisDigest:result.basisDigest,resources:{skills:result.skills.length,knowledge:result.knowledge.assets.length,references:result.references.length},bytes:Buffer.byteLength(content)} : {...result,outputPath:path};
  }
  console.log(JSON.stringify(result,null,2));
} catch (error) { console.error(JSON.stringify({ok:false,error:error.message,...(requestPath?{requestPath,retry:'先 operation get 核对原 operation-id；结果未知时保留相同 ID 和原载荷，不自动重试。'}:{})},null,2)); process.exitCode=1; }
