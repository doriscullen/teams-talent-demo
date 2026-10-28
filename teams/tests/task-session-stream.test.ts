import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, appendFile, rm, readFile, symlink, realpath, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { initialState } from '../src/domain.js';
import { createDeliveryRequirement } from '../src/delivery-requirements.js';
import { createTaskSessionStream } from '../server/task-session-stream.js';
import type { TaskSessionTurn, TaskSessionStreamQuery } from '../src/task-session-stream.js';
import { nativeSessionMigrationFile } from '../server/native-session-location.js';
import { MAX_NATIVE_SESSION_BYTES, MAX_NATIVE_TRAJECTORY_BYTES } from '../server/session-capacity.js';
const at = (seconds: number) => new Date(Date.UTC(2026, 9, 27, 0, 0, seconds)).toISOString();
const message = (role: string, id: string, seconds: number, text: string): any => ({ role, message_id: id, contents: [{ type: 'text', text }], additional_properties: { _chrys_created_at: at(seconds), _chrys_analytics_item_id: id } });
async function fixture() {
  const runtime = await mkdtemp(join(tmpdir(), 'task-session-stream-')), state = initialState();
  const task = createDeliveryRequirement(state, 'owner', { projectId: 'carddemo', id: 'MKT-STREAM-001', title: '白金卡资格校验', description: '仅验证读取协议，不代表原生执行。', assigneeId: 'member', skillIds: ['dev-frontend'] }, at(0));
  const query: TaskSessionStreamQuery = { projectId: task.projectId, taskId: task.id, nodeId: 'prepare' };
  const runId = randomUUID(), sessionId = randomUUID(), runRoot = join(runtime, 'work-contexts', runId + '.native'), sessionRoot = join(runRoot, 'session-root'), sessionDir = join(sessionRoot, 'sessions', sessionId.replaceAll('-', '').slice(0, 12));
  await mkdir(join(sessionDir, 'trajectory'), { recursive: true });
  const owner = { ...query, runId, sessionId, sessionRoot, source: 'icode-active-session-owner', startedAt: at(0), pid: process.pid };
  await writeFile(join(runRoot, 'native-session.json'), JSON.stringify(owner)); await mkdir(join(sessionRoot, 'sessions', '.locks'));
  await writeFile(join(sessionRoot, 'sessions', '.locks', sessionId.replaceAll('-', '').slice(0, 12) + '.active.json'), JSON.stringify({ session_id: sessionId, pid: owner.pid, started_at: owner.startedAt }));
  await writeFile(join(runRoot, 'manifest.json'), JSON.stringify({ version: 1, runId, scope: query }));
  const user = message('user', 'user-1', 0, '请保留这段真实用户输入，核对三个月与额外 0.5%。 token=bad-secret /Users/private/prompt');
  user.additional_properties._chrys_system_reminders = [{ text: 'INTERNAL_HOOK_SENTINEL' }];
  const reply = message('assistant', 'reply-1', 2, '开始校验 Bearer hidden-token-value password=secret /Users/private/file');
  reply.contents.unshift({ type: 'text_reasoning', text: 'HIDDEN_REASONING_SENTINEL' });
  const document = { meta: { session_id: sessionId, model_base_url: 'secret-url' }, state: { messages: [message('system', 'system', 0, 'SYSTEM_SENTINEL'), user, reply] } };
  const save = async () => writeFile(join(sessionDir, 'session.json'), JSON.stringify(document)); await save();
  const event = (id: string, event_type: string, seconds: number, payload: Record<string, unknown> = {}, turn_id = 'turn-1') => ({ event_id: id, event_type, session_id: sessionId, occurred_at: at(seconds), turn_id, payload });
  const trajectory = join(sessionDir, 'trajectory', 'events.jsonl');
  await writeFile(trajectory, [event('turn-1', 'turn.started', 1, { turn_number: 1, opening_item_id: 'user-1' }), event('cycle-1', 'model.cycle.started', 1, { cycle_index: 0 }), event('call-1', 'tool.operation.started', 3, { tool_name: 'run_command', arguments: 'env SECRET=raw-secret', tool_output: 'secret' })].map(x => JSON.stringify(x)).join('\n') + '\n');
  const complete = async (status = 'completed') => writeFile(join(runRoot, 'result.json'), JSON.stringify({ ...query, runId, sessionId, finishedAt: at(30), status }));
  return { runtime, state, task, query, runId, sessionId, runRoot, sessionDir, trajectory, document, event, save, complete, cleanup: () => rm(runtime, { recursive: true, force: true }) };
}
test('real user and visible replies form one native turn; tool cycles and hidden/internal content are absent', async () => {
  const f = await fixture(); try {
    const observe = createTaskSessionStream(f.runtime, { isAlive: () => true }), before = JSON.stringify(f.state), first = await observe(f.state, 'member', f.query);
    assert.equal(first.reset, true); assert.equal(first.sessions[0].status, 'running'); assert.equal(first.turns.length, 1); assert.equal(first.turns[0].round, 1);
    assert.match(first.turns[0].user!.text, /保留这段真实用户输入/); assert.doesNotMatch(first.turns[0].user!.text, /白金卡资格校验/);
    assert.equal(first.turns[0].user!.id, 'user-1'); assert.equal(first.turns[0].replies[0].id, 'reply-1');
    for (const secret of ['HIDDEN_REASONING_SENTINEL', 'SYSTEM_SENTINEL', 'INTERNAL_HOOK_SENTINEL', 'hidden-token-value', 'bad-secret', 'raw-secret', 'secret-url', '/Users/private', 'run_command', 'cycle_index']) assert.ok(!JSON.stringify(first).includes(secret));
    assert.equal((await observe(f.state, 'member', { ...f.query, cursor: first.cursor! })).turns.length, 0);
    await appendFile(f.trajectory, Array.from({length:12},(_,i)=>JSON.stringify(f.event('cycle-'+(i+2),'model.cycle.started',i+4,{cycle_index:i+1}))).join('\n')+'\n');
    assert.equal((await observe(f.state, 'member', { ...f.query, cursor: first.cursor! })).turns.length, 0);
    f.document.state.messages[2].contents[1].text = '完整回复'.repeat(1000); await f.save();
    const next = await observe(f.state, 'member', { ...f.query, cursor: first.cursor! }); assert.equal(next.turns.length, 1); assert.equal(next.turns[0].id, first.turns[0].id); assert.equal(next.turns[0].replies[0].text, '完整回复'.repeat(1000));
    await f.complete(); assert.equal((await observe(f.state, 'member', f.query)).turns[0].status, 'ended'); assert.equal(JSON.stringify(f.state), before);
    assert.equal(JSON.parse(await readFile(join(f.sessionDir, 'session.json'), 'utf8')).state.messages[2].contents[0].text, 'HIDDEN_REASONING_SENTINEL');
  } finally { await f.cleanup(); }
});
test('one native turn spanning nodes keeps its identity and only exposes messages in the adopted node scope', async () => {
  const f = await fixture(); try {
    const observe = createTaskSessionStream(f.runtime, { isAlive: () => true }), first = await observe(f.state, 'member', f.query);
    await assert.rejects(observe(f.state,'member',{...f.query,taskId:'MKT-OTHER'}),/没有可读取/); await assert.rejects(observe(f.state,'owner',{...f.query,cursor:first.cursor!}),/游标/);
    f.task.assigneeId='su'; assert.equal((await observe(f.state,'member',f.query)).sessions.length,1);
    f.state.workspace.team.members.find(m=>m.id==='member')!.status='invited'; await assert.rejects(observe(f.state,'member',f.query),/无权/); f.state.workspace.team.members.find(m=>m.id==='member')!.status='active';
    f.state.workspace.collaboration={adoptions:[{...f.query,nodeId:'develop',id:'adopt-1',role:'member',runId:f.runId,sessionId:f.sessionId,at:at(5),revision:1,basisDigest:'basis',readReferences:[]}],events:[],operations:[]};
    f.document.state.messages.push(message('assistant','reply-develop',7,'开发节点的真实可见回复'));await f.save();
    const prepare=await observe(f.state,'member',f.query),develop=await observe(f.state,'member',{...f.query,nodeId:'develop'});
    assert.equal(prepare.turns[0].turnId,develop.turns[0].turnId); assert.equal(develop.turns[0].round,1); assert.equal(develop.turns[0].user,null); assert.equal(develop.turns[0].userSourceNode,'prepare');
    assert.deepEqual(prepare.turns[0].replies.map(m=>m.id),['reply-1']);assert.deepEqual(develop.turns[0].replies.map(m=>m.id),['reply-develop']);await assert.rejects(observe(f.state,'member',{...f.query,nodeId:'develop',cursor:first.cursor!}),/游标/);
  } finally { await f.cleanup(); }
});
test('partial active trace append waits; corruption and session identity mismatch remain explicit', async () => {
  const f=await fixture();try{
    const observe=createTaskSessionStream(f.runtime,{isAlive:()=>true}),first=await observe(f.state,'owner',f.query),line=JSON.stringify(f.event('finish','turn.finished',4,{outcome:'success'}));
    await appendFile(f.trajectory,line.slice(0,20));assert.equal((await observe(f.state,'owner',{...f.query,cursor:first.cursor!})).turns.length,0);
    await appendFile(f.trajectory,line.slice(20)+'\n');assert.equal((await observe(f.state,'owner',{...f.query,cursor:first.cursor!})).turns[0].status,'ended');
    await appendFile(f.trajectory,'{bad}\n');await assert.rejects(observe(f.state,'owner',f.query),/轨迹记录损坏/);
    await writeFile(f.trajectory,'');await writeFile(join(f.sessionDir,'session.json'),JSON.stringify({...f.document,meta:{session_id:randomUUID()}}));await assert.rejects(observe(f.state,'owner',f.query),/正文身份/);
  }finally{await f.cleanup();}
});
test('missing text is explicit, tool-only history is not a conversation, failure never advances business progress', async()=>{
 const f=await fixture();try{
  const observe=createTaskSessionStream(f.runtime,{isAlive:()=>false});assert.equal((await observe(f.state,'owner',f.query)).sessions[0].status,'unknown');
  f.document.state.messages=[];await f.save();await f.complete('failed');const failed=await observe(f.state,'owner',f.query);assert.equal(failed.sessions[0].status,'failed');assert.equal(failed.turns[0].user,null);assert.deepEqual(failed.turns[0].replies,[]);assert.equal(f.task.stage,'preparing');
  await writeFile(f.trajectory,JSON.stringify(f.event('tool','tool.operation.started',4,{tool_name:'zsh'}))+'\n');assert.deepEqual((await observe(f.state,'owner',f.query)).turns,[]);
 }finally{await f.cleanup();}
});
test('cursor pages distinct turns, streams updates by message ID, and resets after reconnect or removed history',async()=>{
 const f=await fixture();try{
  const observe=createTaskSessionStream(f.runtime,{isAlive:()=>true});
  for(let i=2;i<=251;i++){f.document.state.messages.push(message('user','user-'+i,i*2,'第'+i+'次真实用户输入'));await appendFile(f.trajectory,JSON.stringify(f.event('turn-'+i,'turn.started',i*2,{turn_number:i,opening_item_id:'user-'+i},'turn-'+i))+'\n');}await f.save();
  const turns=new Map<string,TaskSessionTurn>();let response=await observe(f.state,'owner',f.query);for(;;){for(const turn of response.turns){assert.ok(!turns.has(turn.id));turns.set(turn.id,turn);}if(!response.hasMore)break;response=await observe(f.state,'owner',{...f.query,cursor:response.cursor!});}assert.equal(turns.size,251);
  f.document.state.messages.push(message('assistant','reply-last',503,'流式回复的一部分'));await f.save();const update=await observe(f.state,'owner',{...f.query,cursor:response.cursor!});assert.equal(update.turns.length,1);assert.equal(update.turns[0].round,251);
  f.document.state.messages.at(-1)!.contents[0].text+='，追加完整内容';await f.save();const growth=await observe(f.state,'owner',{...f.query,cursor:update.cursor!});assert.equal(growth.turns[0].id,update.turns[0].id);assert.equal(growth.turns[0].replies.length,1);assert.match(growth.turns[0].replies[0].text,/追加完整内容/);
  assert.equal((await createTaskSessionStream(f.runtime,{isAlive:()=>true})(f.state,'owner',{...f.query,cursor:growth.cursor!})).reset,true);
  f.document.state.messages=[];await f.save();await writeFile(f.trajectory,'');assert.equal((await observe(f.state,'owner',{...f.query,cursor:growth.cursor!})).reset,true);
 }finally{await f.cleanup();}
});
test('sessions have isolated cursors and no client-controlled filesystem access',async()=>{
 const f=await fixture(),second=await fixture();try{
  const observe=createTaskSessionStream(f.runtime,{isAlive:()=>true});f.state.workspace.taskAutomation=[{...f.query,sessions:[{...f.query,nodeId:'prepare' as any,tool:'icode',sessionId:second.sessionId,source:'manual',at:at(1)}]}];
  const first=await observe(f.state,'owner',{...f.query,sessionId:f.sessionId});assert.equal(first.sessions.length,2);
  await assert.rejects(observe(f.state,'owner',{...f.query,sessionId:second.sessionId,cursor:first.cursor!}),/游标/);assert.deepEqual((await observe(f.state,'owner',{...f.query,sessionId:second.sessionId})).turns,[]);
  await assert.rejects(observe(f.state,'owner',{...f.query,sessionId:'../../secret'}),/不属于/);
  const document=join(f.sessionDir,'session.json');
  // Windows 文件符号链接需要额外权限；目录联接无需提权，同样覆盖 realpath 越界防护。
  if(process.platform==='win32'){await rm(f.sessionDir,{recursive:true,force:true});await symlink(second.sessionDir,f.sessionDir,'junction');}
  else{await rm(document);await symlink(join(second.sessionDir,'session.json'),document);}
  await assert.rejects(observe(f.state,'owner',{...f.query,sessionId:f.sessionId}),/路径校验/);
 }finally{await f.cleanup();await second.cleanup();}
});

test('native in-flight checkpoints use the newest persisted envelope without masking invalid primary or recovery',async()=>{
 const f=await fixture();try{
  const observe=createTaskSessionStream(f.runtime,{isAlive:()=>true}),primary=join(f.sessionDir,'session.json'),recovery=join(f.sessionDir,'session.recovery.json');
  const envelope=(seconds:number,text:string)=>({...f.document,meta:{...f.document.meta,updated_at:at(seconds)},state:{messages:[f.document.state.messages[1],message('assistant','reply-1',2,text)]}});
  await rm(primary);await writeFile(recovery,JSON.stringify(envelope(5,'运行中已保存回复')));
  const first=await observe(f.state,'owner',f.query);assert.equal(first.turns[0].replies[0].text,'运行中已保存回复');
  await writeFile(primary,JSON.stringify(envelope(3,'较早正式正文')));assert.equal((await observe(f.state,'owner',{...f.query,cursor:first.cursor!})).turns.length,0);
  await writeFile(primary,JSON.stringify(envelope(8,'较新结束正文')));const next=await observe(f.state,'owner',{...f.query,cursor:first.cursor!});assert.equal(next.turns[0].id,first.turns[0].id);assert.equal(next.turns[0].replies[0].text,'较新结束正文');
  await writeFile(recovery,JSON.stringify(envelope(9,'下一次保存的追加回复')));assert.equal((await observe(f.state,'owner',{...f.query,cursor:next.cursor!})).turns[0].replies[0].text,'下一次保存的追加回复');
  await writeFile(primary,'{broken');await assert.rejects(observe(f.state,'owner',f.query),/格式无效/);await writeFile(primary,JSON.stringify(envelope(8,'有效主正文')));
  await writeFile(recovery,'{broken');await assert.rejects(observe(f.state,'owner',f.query),/格式无效/);await writeFile(recovery,JSON.stringify({...envelope(9,'无效时间'),meta:{session_id:f.sessionId,updated_at:'not-a-time'}}));await assert.rejects(observe(f.state,'owner',f.query),/持久化时间无效/);
  await writeFile(recovery,JSON.stringify({...envelope(9,'错误身份'),meta:{session_id:randomUUID(),updated_at:at(9)}}));await assert.rejects(observe(f.state,'owner',f.query),/身份/);
 }finally{await f.cleanup();}
});

test('an explicit hashed relocation preserves native evidence and rejects foreign scope or changed records', async () => {
 const f=await fixture();try{
  const ownerPath=join(f.runRoot,'native-session.json'),manifestPath=join(f.runRoot,'manifest.json'),owner=JSON.parse(await readFile(ownerPath,'utf8'));
  owner.sessionRoot=join(f.runtime,'previous-runtime','work-contexts',f.runId+'.native','session-root');await writeFile(ownerPath,JSON.stringify(owner));
  const ownerBytes=await readFile(ownerPath),manifestBytes=await readFile(manifestPath),stateBefore=JSON.stringify(f.state),digest=(value:Buffer)=>createHash('sha256').update(value).digest('hex');
  const observe=createTaskSessionStream(f.runtime,{isAlive:()=>false});await assert.rejects(observe(f.state,'owner',f.query),/绑定校验/);
  const entry={runId:f.runId,...f.query,sessionId:f.sessionId,previousSessionRoot:owner.sessionRoot,sessionRoot:await realpath(join(f.runRoot,'session-root')),ownerSha256:digest(ownerBytes),manifestSha256:digest(manifestBytes)};
  const save=(value:typeof entry)=>writeFile(join(f.runtime,nativeSessionMigrationFile),JSON.stringify({version:1,entries:[value]}));await save(entry);
  const result=await observe(f.state,'owner',f.query);assert.equal(result.turns.length,1);assert.equal(result.sessions[0].status,'unknown');assert.equal(JSON.stringify(f.state),stateBefore);assert.deepEqual(await readFile(ownerPath),ownerBytes);assert.deepEqual(await readFile(manifestPath),manifestBytes);
  await save({...entry,taskId:'FOREIGN'});await assert.rejects(observe(f.state,'owner',f.query),/迁移凭据/);await save(entry);
  await writeFile(manifestPath,Buffer.concat([manifestBytes,Buffer.from(' ')]));await assert.rejects(observe(f.state,'owner',f.query),/迁移凭据/);
  await writeFile(manifestPath,manifestBytes);await save({...entry,sessionRoot:join(f.runtime,'foreign','session-root')});await assert.rejects(observe(f.state,'owner',f.query),/迁移凭据/);
  await writeFile(join(f.runtime,nativeSessionMigrationFile),'{broken');await assert.rejects(observe(f.state,'owner',f.query),/迁移凭据/);
 }finally{await f.cleanup();}
});

test('large session and trajectory preserve paged visible turns; either over-limit candidate fails explicitly', async () => {
 const f=await fixture();try{
  const observe=createTaskSessionStream(f.runtime,{isAlive:()=>true});
  for(let i=2;i<=141;i++){f.document.state.messages.push(message('user','large-user-'+i,i*2,'当前轮次 '+i));await appendFile(f.trajectory,JSON.stringify(f.event('large-turn-'+i,'turn.started',i*2,{turn_number:i,opening_item_id:'large-user-'+i},'large-turn-'+i))+'\n');}
  const content=JSON.stringify({...f.document,meta:{...f.document.meta,updated_at:at(400)},state:{...f.document.state,compressed_msgs:'x'.repeat(9*1024*1024)}});
  const primary=join(f.sessionDir,'session.json'),recovery=join(f.sessionDir,'session.recovery.json');
  await writeFile(primary,content);await writeFile(recovery,content);
  await appendFile(f.trajectory,JSON.stringify(f.event('large-tool','tool.operation.finished',300,{tool_output:'z'.repeat(17*1024*1024)}))+'\n');
  const digest=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex'),before=digest(await readFile(primary)),trajectoryBefore=digest(await readFile(f.trajectory));
  const first=await observe(f.state,'owner',f.query);assert.equal(first.turns.length,120);assert.equal(first.hasMore,true);assert.ok(Buffer.byteLength(JSON.stringify(first))<128*1024);
  const second=await observe(f.state,'owner',{...f.query,cursor:first.cursor!});assert.equal(second.turns.length,21);assert.equal(second.hasMore,false);assert.equal((await observe(f.state,'owner',{...f.query,cursor:second.cursor!})).turns.length,0);
  assert.equal(digest(await readFile(primary)),before);assert.equal(digest(await readFile(f.trajectory)),trajectoryBefore);
  // Recovery must not be silently skipped in favour of the valid primary.
  const oversized=await open(recovery,'r+');try{await oversized.truncate(MAX_NATIVE_SESSION_BYTES+1);}finally{await oversized.close();}
  await assert.rejects(observe(f.state,'owner',f.query),{status:413,message:/32 MiB/});await rm(recovery);
  const trajectory=await open(f.trajectory,'r+');try{await trajectory.truncate(MAX_NATIVE_TRAJECTORY_BYTES+1);}finally{await trajectory.close();}
  await assert.rejects(observe(f.state,'owner',f.query),{status:413,message:/64 MiB/});assert.equal(digest(await readFile(primary)),before);
 }finally{await f.cleanup();}
});
