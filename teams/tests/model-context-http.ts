/** Isolated HTTP evidence: projection is a view, never an alternative adoption basis. */
import assert from 'node:assert/strict';
import {spawn,type ChildProcess} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {mkdtemp,readFile,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
const dir=await mkdtemp(join(tmpdir(),'model-context-http-')),socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=(socket.address() as {port:number}).port;await new Promise<void>((resolve,reject)=>socket.close(error=>error?reject(error):resolve()));
const origin='http://127.0.0.1:'+port,env={...process.env,DEMO_PORT:String(port),DEMO_STATE_DIR:join(dir,'state'),DEMO_SHARED_DIR:join(dir,'shared'),DEMO_SHARED_SEED_DIR:join(dir,'empty-seed'),DEMO_NATIVE_DISABLED:'1'};
let logs='';const child:ChildProcess=spawn(process.execPath,['--import','tsx','server/index.ts'],{env,stdio:['ignore','pipe','pipe']});child.stdout!.on('data',data=>logs+=data);child.stderr!.on('data',data=>logs+=data);
const get=async(path:string,expected=200)=>{const response=await fetch(origin+path),value=await response.json();assert.equal(response.status,expected,JSON.stringify(value));return value;};
const post=async(path:string,body:object,expected=200)=>{const {token}=await get('/api/session'),state=await get('/api/state'),response=await fetch(origin+path,{method:'POST',headers:{origin,'content-type':'application/json','x-demo-token':token},body:JSON.stringify({role:'owner',revision:state.revision,...body})}),value=await response.json();assert.equal(response.status,expected,JSON.stringify(value));return value;};
const scope={projectId:'carddemo',taskId:'DEMO-MKT-001',nodeId:'prepare'},query=new URLSearchParams({...scope,role:'member'});
try{
 const deadline=Date.now()+10000;while(true){try{if((await fetch(origin+'/api/health')).ok)break;}catch{}assert.ok(Date.now()<deadline,logs);await new Promise(resolve=>setTimeout(resolve,50));}
 await post('/api/action',{action:'assign',assigneeId:'member'});
 const before=await readFile(join(dir,'state/state.json'));
 const full=await get('/api/collaboration/context?'+query+'&view=full'),model=await get('/api/collaboration/context?'+query+'&view=model'),defaultView=await get('/api/collaboration/context?'+query);
 assert.deepEqual(defaultView,full);assert.equal(model.view,'model');assert.equal(model.revision,full.revision);assert.equal(model.basisDigest,full.basisDigest);assert.deepEqual(model.skills,full.skills);assert.deepEqual(model.knowledge,full.knowledge);assert.deepEqual(model.agreement,full.agreement);assert.deepEqual(model.nodeContract.definition,full.nodeContract.definition);assert.equal('talentInputs' in model,false);assert.equal('events' in model,false);assert.ok(model.skills.length>0&&model.skills.every((skill:any)=>skill.content&&skill.sha256&&skill.contentSha256));
 await get('/api/collaboration/context?'+query+'&view=unexpected',400);assert.deepEqual(await readFile(join(dir,'state/state.json')),before);
 const input={...scope,runId:'isolated-model-context-run',sessionId:'isolated-model-context-session',expectedRevision:model.revision,basisDigest:model.basisDigest,readReferences:[...model.skills.map((skill:any)=>skill.id),...model.knowledge.assets.map((asset:any)=>asset.id)]};
 const adopted=await post('/api/collaboration',{role:'member',kind:'inputs.adopt',operationId:randomUUID(),input});assert.ok(adopted.receipt.adoptionId);const persisted=await get('/api/state');assert.equal(persisted.workspace.collaboration.adoptions.at(-1).basisDigest,full.basisDigest);assert.deepEqual(persisted.workspace.deliveryRequirements.find((task:any)=>task.id===scope.taskId).nodeInputSnapshots.prepare,full.nodeInputs);
 const current=await get('/api/collaboration/context?'+query+'&view=model');await post('/api/collaboration',{role:'member',kind:'inputs.adopt',operationId:randomUUID(),input:{...input,expectedRevision:current.revision,basisDigest:'0'.repeat(64)}},409);
 const id='REQ-'+randomUUID();await post('/api/delivery-requirements',{action:'create',input:{projectId:'carddemo',id,title:'未分配输入门禁',description:'尚未获取本节点知识'}});const waiting=await get('/api/collaboration/context?'+new URLSearchParams({projectId:'carddemo',taskId:id,nodeId:'develop',role:'owner',view:'model'}));assert.equal(waiting.automaticPreparation.status,'waiting-upstream');assert.deepEqual(waiting.skills,[]);assert.deepEqual(waiting.knowledge.assets,[]);assert.deepEqual(waiting.availableActions,['context.get']);
 const records=await get('/api/state');assert.ok(!records.workspace.deliveryRequirements.find((task:any)=>task.id===id).preparedAt);assert.equal(records.workspace.collaboration.events.length,0);
 await mkdir('test-results/model-context',{recursive:true});await writeFile('test-results/model-context/http-result.json',JSON.stringify({passed:true,fullBytes:Buffer.byteLength(JSON.stringify(full)),modelBytes:Buffer.byteLength(JSON.stringify(model)),scope,checks:['explicit full/model and invalid view','read-only state bytes unchanged','full body/SHA/version preservation','model basis accepted by authoritative write path','tampered basis rejected','waiting downstream node reveals no cached bodies','no native/model process started']},null,2));console.log('PASS full/model context views, authoritative adoption, exact bodies and waiting-node gate');
}finally{if(child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}await rm(dir,{recursive:true,force:true});}
