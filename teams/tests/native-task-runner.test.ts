import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
const exec=promisify(execFile);
// Transport-only fixture. Real iCode/Ghostty execution is verified separately.
test('native observer pins the prompt, captures native-owned session/exit and refuses duplicate execution', async()=>{
  const temporary=await mkdtemp(join(tmpdir(),'native-run-')),dir=await realpath(temporary), output=join(dir,'output'),task=join(dir,'task.md'),fixture=join(dir,'run'),executable=process.execPath;
  const sessionId=randomUUID(),runId=randomUUID(),prompt='Read the scoped task';
  try {
    await mkdir(output);await writeFile(task,prompt);
    // Node executes the first production argument, "run", as this CommonJS file on every platform.
    await writeFile(fixture,`const{mkdir,writeFile}=require('node:fs/promises');const{join}=require('node:path');(async()=>{const root=process.env.CHRYS_SESSION_ROOT_DIR;await writeFile(join(root,'fixture-invocation.json'),JSON.stringify({entry:process.argv[1],args:process.argv.slice(2),directory:process.cwd(),proxy:Object.fromEntries(['NO_PROXY','no_proxy','HTTP_PROXY','HTTPS_PROXY'].map(key=>[key,process.env[key]]))}));await mkdir(join(root,'sessions','.locks'),{recursive:true});await writeFile(join(root,'sessions','.locks','fixture.active.json'),JSON.stringify({session_id:${JSON.stringify(sessionId)},pid:process.pid,started_at:new Date().toISOString()}));await new Promise(r=>setTimeout(r,300));process.stdout.write(JSON.stringify({session_id:${JSON.stringify(sessionId)},result:'transport complete'}));})().catch(error=>{console.error(error);process.exitCode=1;});`);
    const manifest={version:1,runId,scope:{projectId:'carddemo',taskId:'MKT-E2E-UNIT',nodeId:'prepare'},directory:dir,executable,agent:'unit',model:'unit',taskFile:task,taskSha256:createHash('sha256').update(prompt).digest('hex')},path=join(output,'manifest.json');await writeFile(path,JSON.stringify(manifest));
    await exec(process.execPath,[resolve('scripts/native/run-project-task.mjs'),path],{env:{...process.env,NO_PROXY:'example.internal',no_proxy:'lower.internal',HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1'}});
    const observed=JSON.parse(await readFile(join(output,'native-session.json'),'utf8')),result=JSON.parse(await readFile(join(output,'result.json'),'utf8')),launch=JSON.parse(await readFile(join(output,'process.json'),'utf8'));
    const invocation=JSON.parse(await readFile(join(output,'session-root','fixture-invocation.json'),'utf8'));
    assert.equal(observed.sessionId,sessionId);assert.equal(observed.runId,runId);for(const [key,value] of Object.entries(manifest.scope)){assert.equal(observed[key],value);assert.equal(result[key],value);}assert.equal(result.sessionId,sessionId);assert.equal(result.status,'completed');assert.equal(result.nativeExitCode,0);assert.equal(result.pid,observed.pid);assert.equal(launch.executable,process.execPath);assert.deepEqual(launch.args,['run','--task',task,'--agent','unit','--model','unit','-C',dir,'--json']);
    assert.equal(await realpath(invocation.entry),fixture);assert.equal(await realpath(invocation.directory),dir);assert.deepEqual(invocation.args,launch.args.slice(1));
    assert.deepEqual(invocation.proxy,{NO_PROXY:'example.internal,lower.internal,127.0.0.1,localhost,::1,[::1]',no_proxy:'example.internal,lower.internal,127.0.0.1,localhost,::1,[::1]',HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1'});
    await assert.rejects(exec(process.execPath,[resolve('scripts/native/run-project-task.mjs'),path]),/EEXIST/);
    await writeFile(task,'changed');await assert.rejects(exec(process.execPath,[resolve('scripts/native/run-project-task.mjs'),path]),/prompt changed/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('production CLI runner restores the exact saved UUID, preserves argv/trace scope and records failure without business writes',async()=>{
 const dir=await realpath(await mkdtemp(join(tmpdir(),'native-cli-恢复 & 空格-'))),root=join(dir,'work-contexts'),sourceId=randomUUID(),sessionId=randomUUID(),short=sessionId.replaceAll('-','').slice(0,12),scope={projectId:'carddemo',taskId:'REQ-'+randomUUID(),nodeId:'develop'},at=new Date().toISOString(),source=join(root,sourceId+'.native'),sessionRoot=join(source,'session-root'),original=JSON.stringify({meta:{session_id:sessionId,updated_at:at},state:{messages:[{role:'assistant',contents:[{type:'text',text:'等待开发者'}]}]}});
 const put=async(path:string,value:any)=>{await mkdir(resolve(path,'..'),{recursive:true});await writeFile(path,typeof value==='string'?value:JSON.stringify(value));};
 try{
  await put(join(sessionRoot,'sessions',short,'session.json'),original);await put(join(source,'native-session.json'),{runId:sourceId,...scope,nodeId:'prepare',sessionId,sessionRoot,pid:99999999,startedAt:at});await put(join(source,'result.json'),{runId:sourceId,sessionId,status:'completed'});
  await put(join(dir,'run'),`const{mkdir,writeFile,readFile}=require('node:fs/promises');const{join}=require('node:path');(async()=>{const args=process.argv.slice(2),root=process.env.CHRYS_SESSION_ROOT_DIR,id=args[args.indexOf('--session')+1];if(id!==${JSON.stringify(sessionId)})throw Error('wrong restore');const source=JSON.parse(await readFile(join(root,'sessions',${JSON.stringify(short)},'session.json'),'utf8'));if(source.meta.session_id!==id)throw Error('wrong body');await writeFile(join(root,'invocation.json'),JSON.stringify({args,projectAttrs:process.env.OTEL_RESOURCE_ATTRIBUTES,protocol:process.env.OTEL_EXPORTER_OTLP_PROTOCOL,logs:process.env.OTEL_LOGS_EXPORTER,hook:process.env.TEAMS_TUI_MANIFEST,cwd:process.cwd()}));await mkdir(join(root,'sessions','.locks'),{recursive:true});await writeFile(join(root,'sessions','.locks',${JSON.stringify(short+'.active.json')}),JSON.stringify({session_id:id,pid:process.pid,started_at:new Date().toISOString()}));await new Promise(r=>setTimeout(r,350));if(process.env.FIXTURE_FAIL==='1'){console.error('fixture native failed');process.exitCode=7;}else process.stdout.write(JSON.stringify({session_id:id,result:'fixture only'}));})().catch(e=>{console.error(e);process.exitCode=1;});`);
  for(const fail of [false,true]){
   const runId=randomUUID(),out=join(root,runId+'.native'),taskFile=join(dir,runId+' task.md'),text='Explicit current node only';await put(taskFile,text);
   const manifest={version:1,executionMode:'task-file',runId,scope,directory:dir,executable:process.execPath,agent:'agent " & ; % 中文',model:'model with spaces',taskFile,taskSha256:createHash('sha256').update(text).digest('hex'),preparedSession:{preparationRunId:sourceId,sourceRunId:sourceId,sessionId,sessionSha256:createHash('sha256').update(original).digest('hex')},trace:{enabled:false,sensitiveData:false,endpoint:'http://127.0.0.1:8012/v1/traces',serviceName:'icode-local',resourceAttributes:'fixture=true'}};const path=join(out,'manifest.json');await put(path,manifest);
   const execution=exec(process.execPath,[resolve('scripts/native/run-project-task.mjs'),path],{env:{...process.env,FIXTURE_FAIL:fail?'1':'0',TEAMS_TUI_MANIFEST:'/not-current'}});if(fail)await assert.rejects(execution,(error:any)=>error.code===7);else await execution;
   const receipt=JSON.parse(await readFile(join(out,'result.json'),'utf8')),owner=JSON.parse(await readFile(join(out,'native-session.json'),'utf8')),invocation=JSON.parse(await readFile(join(out,'session-root/invocation.json'),'utf8'));
   assert.equal(receipt.status,fail?'failed':'completed');assert.equal(receipt.nativeExitCode,fail?7:0);assert.equal(owner.sessionId,sessionId);assert.equal(owner.executionMode,'task-file');assert.equal(owner.runId,runId);assert.deepEqual(invocation.args,['--task',taskFile,'--agent',manifest.agent,'--model',manifest.model,'-C',dir,'--session',sessionId,'--json']);assert.equal(invocation.protocol,'http/protobuf');assert.equal(invocation.logs,'none');assert.equal(invocation.hook,'');assert.ok(invocation.projectAttrs.includes('teams.node.id=develop'));assert.ok(invocation.projectAttrs.includes('teams.run.id='+runId));assert.equal(invocation.cwd,dir);
  }
  assert.equal(await readFile(join(sessionRoot,'sessions',short,'session.json'),'utf8'),original);
 }finally{await rm(dir,{recursive:true,force:true});}
});
