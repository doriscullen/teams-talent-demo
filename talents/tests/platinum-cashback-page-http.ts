/** Runs the additive registration tool against an isolated Talents process; never resets or contacts live state. */
import assert from 'node:assert/strict';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp,mkdir,readFile,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedState } from '../server/seed.ts';
import { platinumCashbackPage } from '../../shared/platinum-cashback-page.ts';
const dir=await mkdtemp(join(tmpdir(),'platinum-talents-http-')),server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const port=(server.address() as {port:number}).port;await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
const origin='http://127.0.0.1:'+port,statePath=join(dir,'state/state.json'),shared=join(dir,'shared');
const initial=seedState();initial.artifacts=initial.artifacts.filter(item=>item.id!==platinumCashbackPage.artifactId);initial.revision=31;initial.tasks.push({id:'existing-user-run',status:'running'});
await mkdir(join(dir,'state'),{recursive:true});await writeFile(statePath,JSON.stringify(initial));
let process_:ChildProcess|undefined,logs='';
const get=async(path:string)=>{const response=await fetch(origin+path);assert.equal(response.status,200);return response.json();};
const register=async(apply=false)=>{const {stdout}=await promisify(execFile)(process.execPath,['--import','tsx','tools/register-platinum-cashback-page.ts','--endpoint',origin,...apply?['--apply']:[]]);return JSON.parse(stdout);};
try{
 process_=spawn(process.execPath,['--import','tsx','server/index.ts'],{env:{...process.env,DEMO_TALENT_PORT:String(port),DEMO_TALENT_STATE_DIR:join(dir,'state'),DEMO_SHARED_DIR:shared},stdio:['ignore','pipe','pipe']});process_.stdout!.on('data',data=>logs+=data);process_.stderr!.on('data',data=>logs+=data);
 let ready=false;for(let i=0;i<100;i++){try{await get('/api/health');ready=true;break;}catch{await new Promise(resolve=>setTimeout(resolve,50));}}assert.ok(ready,logs);
 const before=await readFile(statePath),dry=await register();assert.equal(dry.wouldAdd,true);assert.equal(dry.added,false);assert.deepEqual(await readFile(statePath),before);
 const result=await register(true);assert.equal(result.added,true);const saved=JSON.parse(await readFile(statePath,'utf8'));assert.equal(saved.revision,initial.revision+1);assert.deepEqual({...saved,revision:initial.revision,artifacts:saved.artifacts.filter((item:any)=>item.id!==platinumCashbackPage.artifactId)},initial);
 const exported=JSON.parse(await readFile(join(shared,'talents/knowledge.json'),'utf8')),artifact=exported.artifacts.find((item:any)=>item.id===platinumCashbackPage.artifactId);assert.ok(artifact);assert.equal(artifact.files.length,5);
 for(const file of artifact.files)assert.ok((await readFile(join(shared,'talents/files',artifact.id,'v1',file.path),'utf8')).length>30);
 const settled=await readFile(statePath),retry=await register(true);assert.equal(retry.added,false);assert.deepEqual(await readFile(statePath),settled);
 await mkdir('test-results/platinum-scenario',{recursive:true});await writeFile('test-results/platinum-scenario/register-http.json',JSON.stringify({passed:true,dryRunZeroWrites:true,oldStatePreserved:true,idempotent:true,artifactId:artifact.id,publishedFiles:artifact.files.length},null,2));
 console.log('PASS additive Talents HTTP registration, exact prior-state preservation, 5 published full files and idempotent replay');
}finally{if(process_?.exitCode===null){process_.kill('SIGTERM');await once(process_,'exit');}await rm(dir,{recursive:true,force:true});}
