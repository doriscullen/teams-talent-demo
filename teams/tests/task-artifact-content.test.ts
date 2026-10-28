import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {initialState} from '../src/domain.js';
import {createDeliveryRequirement} from '../src/delivery-requirements.js';
import type {CollaborationEvent} from '../src/collaboration.js';
import type {TaskArtifactQuery} from '../src/task-artifact-content.js';
import {readTaskArtifactContent} from '../server/task-artifact-content.js';
import {registerTaskArtifactRoot,readTaskArtifactRoots} from '../scripts/lib/task-artifact-roots.mjs';
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
async function fixture(){
 const temp=await realpath(await mkdtemp(join(tmpdir(),'artifact-read-'))),teamsRoot=join(temp,'teams'),runtime=join(temp,'runtime'),directory=join(temp,'task'),reports=join(teamsRoot,'test-results','batch','task-runtime');
 await Promise.all([mkdir(runtime),mkdir(directory),mkdir(reports,{recursive:true})]);
 const state=initialState();createDeliveryRequirement(state,'owner',{projectId:'carddemo',id:'MKT-READ-001',title:'Scoped requirement',description:'Read-only documents',assigneeId:'member'},new Date().toISOString());
 const path=join(directory,'prd.md');await writeFile(path,'# Exact PRD\n\nSafe <script> text.');
 const event={id:'saved-result',projectId:'carddemo',taskId:'MKT-READ-001',nodeId:'prepare',phase:'result',evidence:[{kind:'local-file',value:path,description:'PRD',artifact:'prd',version:'v1.0',source:'actual'}]} as CollaborationEvent;
 state.workspace.collaboration??={events:[],adoptions:[],operations:[]} as any;state.workspace.collaboration!.events.push(event);
 const query:TaskArtifactQuery={projectId:'carddemo',taskId:'MKT-READ-001',nodeId:'prepare',artifactId:'artifact:saved-result:0',version:'v1.0'};
 const options={runtime,teamsRoot,directory:async()=>directory};
 return {temp,state,event,query,options,path,directory,reports,clean:()=>rm(temp,{recursive:true,force:true})};
}
test('saved task/node/version identifies exact text, members can read shared task; no client path',async()=>{
 const f=await fixture();try{
  const before=JSON.stringify(f.state);const result=await readTaskArtifactContent(f.state,'owner',f.query,f.options);assert.equal(result.content,await readFile(f.path,'utf8'));assert.equal(result.sha256,sha(result.content!));assert.equal(result.integrity,'current-file');assert.match(result.note,/未登记/);
  assert.equal((await readTaskArtifactContent(f.state,'member',f.query,f.options)).content,result.content);
  for(const patch of [{taskId:'MKT-FOREIGN'},{nodeId:'verify'},{artifactId:'artifact:another-result:0'},{version:'v2'},{path:f.path}])await assert.rejects(readTaskArtifactContent(f.state,'owner',{...f.query,...patch} as any,f.options));
  assert.equal(JSON.stringify(f.state),before);
  f.state.workspace.team.members=f.state.workspace.team.members.filter(m=>m.id!=='member');await assert.rejects(readTaskArtifactContent(f.state,'member',f.query,f.options),/无权/);
 }finally{await f.clean();}
});
test('declared content hash is enforced; binary, large files and symlinks fail explicitly',async()=>{
 const f=await fixture();try{
  (f.event.evidence[0] as any).sha256=sha(await readFile(f.path,'utf8'));assert.equal((await readTaskArtifactContent(f.state,'owner',f.query,f.options)).integrity,'registered-sha256');
  await writeFile(f.path,'changed');await assert.rejects(readTaskArtifactContent(f.state,'owner',f.query,f.options),/SHA256/);delete (f.event.evidence[0] as any).sha256;
  await writeFile(f.path,Buffer.from([0xff,0xfe]));await assert.rejects(readTaskArtifactContent(f.state,'owner',f.query,f.options),/UTF-8/);
  await writeFile(f.path,'\0');await assert.rejects(readTaskArtifactContent(f.state,'owner',f.query,f.options),/二进制/);
  await writeFile(f.path,Buffer.alloc(1024*1024+1));await assert.rejects(readTaskArtifactContent(f.state,'owner',f.query,f.options),/1 MiB/);
  const outside=join(f.temp,'secret.md');await writeFile(outside,'outside');f.event.evidence[0].value=outside;await assert.rejects(readTaskArtifactContent(f.state,'owner',f.query,f.options),/不在任务/);
  const link=join(f.directory,'link.md');await symlink(outside,link);f.event.evidence[0].value=link;await assert.rejects(readTaskArtifactContent(f.state,'owner',f.query,f.options),/符号链接/);
 }finally{await f.clean();}
});
test('local registry is explicit, atomic/idempotent, scoped and rejects overlap/symlinks/corruption',async()=>{
 const f=await fixture();try{
  const path=join(f.reports,'test.md');await writeFile(path,'actual report');f.event.evidence[0].value=path;
  await assert.rejects(readTaskArtifactContent(f.state,'owner',f.query,f.options),/核验登记/);
  const registration={...f.options,projectId:f.query.projectId,taskId:f.query.taskId,directory:f.reports};const row=await registerTaskArtifactRoot(registration),bytes=await readFile(join(f.options.runtime,'task-artifact-roots.json'));
  assert.deepEqual(await registerTaskArtifactRoot(registration),row);assert.deepEqual(await readFile(join(f.options.runtime,'task-artifact-roots.json')),bytes);
  assert.equal((await readTaskArtifactContent(f.state,'owner',f.query,f.options)).content,'actual report');
  await assert.rejects(registerTaskArtifactRoot({...registration,taskId:'MKT-OTHER'}),/重叠/);
  await assert.rejects(registerTaskArtifactRoot({...registration,directory:f.temp}),/专属子目录/);
  const link=join(f.options.teamsRoot,'test-results','link');await symlink(f.reports,link);await assert.rejects(registerTaskArtifactRoot({...registration,directory:link}),/符号链接/);
  await writeFile(join(f.options.runtime,'task-artifact-roots.json'),'{broken');await assert.rejects(readTaskArtifactRoots({...registration}),/JSON/);
 }finally{await f.clean();}
});
test('historical tracked document reads exact reachable commit, not newer working file or another branch',async()=>{
 const f=await fixture();const git=(...args:string[])=>execFileSync('git',['-C',f.directory,...args],{encoding:'utf8'}).trim();try{
  git('init','-q');git('config','user.name','Artifact Test');git('config','user.email','artifact@example.invalid');git('add','prd.md');git('commit','-qm','version 1');const first=git('rev-parse','HEAD');
  f.event.evidence[0].codeVersion=first;await writeFile(f.path,'new file');git('add','.');git('commit','-qm','version 2');
  const result=await readTaskArtifactContent(f.state,'owner',f.query,f.options);assert.match(result.content!,/Exact PRD/);assert.equal(result.integrity,'git-commit');
  f.event.evidence[0].codeVersion='HEAD';await assert.rejects(readTaskArtifactContent(f.state,'owner',f.query,f.options),/完整提交/);
  git('checkout','--orphan','foreign');git('commit','-qm','unrelated');const foreign=git('rev-parse','HEAD');git('checkout','--detach',first);f.event.evidence[0].codeVersion=foreign;await assert.rejects(readTaskArtifactContent(f.state,'owner',f.query,f.options),/不属于本任务/);
 }finally{await f.clean();}
});
test('PR uses saved GitHub address; script/local/other URLs never become links',async()=>{
 const f=await fixture();try{
  f.event.evidence[0].kind='reference';f.event.evidence[0].value='https://github.com/owner/repo/pull/10';assert.equal((await readTaskArtifactContent(f.state,'owner',f.query,f.options)).url,f.event.evidence[0].value);
  for(const url of ['javascript:alert(1)','file:///etc/passwd','https://evil.example/pull/10','https://github.com@evil.example/o/r/pull/1','https://github.com/o/r/pull/1?redirect=bad']){f.event.evidence[0].value=url;await assert.rejects(readTaskArtifactContent(f.state,'owner',f.query,f.options));}
 }finally{await f.clean();}
});
