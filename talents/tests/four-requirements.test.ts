import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {seedState,SEED_VERSION} from '../server/seed.ts';
import {Store} from '../server/store.ts';
import {appendFourRequirements} from '../server/four-requirements.ts';
import {buildExport,writeExport} from '../server/export.ts';
import {sharedPaths} from '../../shared/contracts.ts';
import {contentDir,repositoryRoot} from '../server/config.ts';
import {fourRequirementScenarios,fourRequirementScenariosV2} from '../../shared/four-requirement-scenarios.ts';
const hash=(text:Buffer|string)=>createHash('sha256').update(text).digest('hex');
const scenarioIds=new Set([...fourRequirementScenarios,...fourRequirementScenariosV2].map(s=>s.artifactId));
const legacySeed=()=>{const state=seedState();state.artifacts=state.artifacts.filter(a=>!scenarioIds.has(a.id));return state;};
test('four source artifacts append atomically without replacing user data or claiming execution',()=>{
 const state=legacySeed();state.tasks.push({id:'user-run',status:'running'});state.skillVersions.push({projectId:'carddemo',skillId:'existing',version:'2.0.0',basedOn:{version:'1.0.0'},at:'2026-10-28',note:'user skill',from:{artifact:'user-artifact',suggestion:'user-suggestion'},files:[]});
 const before=structuredClone(state),added=appendFourRequirements(state);
 assert.equal(added.added.length,4);assert.deepEqual(state,before);assert.deepEqual({...added.state,artifacts:added.state.artifacts.filter(a=>!added.added.includes(a.id))},before);
 assert.equal(appendFourRequirements(added.state).state,added.state);
 added.state.artifacts.at(-1)!.desc='user change';assert.throws(()=>appendFourRequirements(added.state),/内容不同/);
});
test('all raw documents, profile and provenance survive export unchanged with fixed source commit',async()=>{
 const {state}=appendFourRequirements(seedState()),output=buildExport(state);
 for(const s of fourRequirementScenarios){
  const files=output.files.get(s.artifactId+'/v1')!;assert.equal(files.length,7);
  const manifest=JSON.parse(await readFile(join(contentDir,s.manifest),'utf8'));
  assert.equal(manifest.sourceSha256,s.sourceSha256);assert.equal(manifest.businessId,s.businessId);assert.equal(manifest.testProfile.version,'test-profile-v1');
  for(const file of manifest.knowledgeFiles){const raw=await readFile(join(contentDir,file.path));assert.equal(hash(raw),file.sha256);assert.equal(files.find(f=>f.path===file.path)!.text,raw.toString('utf8'));}
  const original=await readFile(join(contentDir,s.files.requirement),'utf8');assert.equal(hash(original),s.sourceSha256);assert.match(original,/## 13\. 合规标注/);assert.match(original,/### 12\.3 待确认事项/);
  for(const file of manifest.sourceFiles)assert.equal(hash(execFileSync('git',['show',file.commit+':'+file.path],{cwd:repositoryRoot})),file.sha256);
  const profile=await readFile(join(contentDir,s.files.profile),'utf8');assert.match(profile,/19\.25/);assert.match(profile,/审批来源：用户 2026-10-28/);assert.equal(hash(profile),manifest.testProfile.sha256);
 }
});

test('explicit v2 registration retains every v1 artifact and exported full text',async()=>{
 const {fourRequirementScenariosV2,fourRequirementProfileV2Sha256}=await import('../../shared/four-requirement-scenarios.ts');
 const v1=appendFourRequirements(legacySeed()).state,before=structuredClone(v1),old=buildExport(v1);
 const next=appendFourRequirements(v1,2);assert.equal(next.added.length,4);assert.deepEqual(v1,before);
 assert.deepEqual(next.state.artifacts.filter(a=>!next.added.includes(a.id)),before.artifacts);
 const current=buildExport(next.state);for(const [key,files] of old.files)assert.deepEqual(current.files.get(key),files);
 const target=await mkdtemp(join(tmpdir(),'four-input-versions-'));
 try{await writeExport(target,old);await writeExport(target,current);for(const [key,files] of old.files){const [id,version]=key.split('/');for(const file of files)assert.equal(await readFile(join(target,sharedPaths.talentsFile(id,Number(version.slice(1)),file.path)),'utf8'),file.text);}}finally{await rm(target,{recursive:true,force:true});}
 assert.equal(appendFourRequirements(next.state,2).state,next.state);
 for(const s of fourRequirementScenariosV2){
  const files=current.files.get(s.artifactId+'/v2')!;assert.equal(files.length,7);
  const manifest=JSON.parse(await readFile(join(contentDir,s.manifest),'utf8'));
  assert.equal(manifest.version,2);assert.equal(manifest.previousVersion.version,1);assert.equal(manifest.testProfile.version,'test-profile-v2');assert.equal(manifest.testProfile.sha256,fourRequirementProfileV2Sha256);
  for(const file of manifest.knowledgeFiles){const raw=await readFile(join(contentDir,file.path));assert.equal(hash(raw),file.sha256);assert.equal(files.find(f=>f.path===file.path)!.text,raw.toString('utf8'));}
  assert.equal(hash(files.find(f=>f.path===s.files.requirement)!.text),s.sourceSha256);
  const profile=files.find(f=>f.path===s.files.profile)!.text;assert.equal(hash(profile),fourRequirementProfileV2Sha256);assert.match(profile,/协调会话制定的测试口径，非用户\/业务正式政策签字/);assert.match(profile,/900\.00.*3.*600\.00/);assert.match(profile,/606\.00/);assert.match(profile,/FEE_PENDING 停止补收/);assert.match(profile,/四个主体相互独立/);assert.match(profile,/复核前不执行最终资金结算/);assert.match(profile,/Asia\/Shanghai/);
 }
});

test('fresh initialization and explicit reset publish both versions without migrating existing state',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'four-input-seed-')),path=join(directory,'state.json');
 try{
  assert.equal(SEED_VERSION,12,'source registration keeps the Owner-only schema version');
  const fresh=new Store(path);await fresh.init();
  const expected=[...scenarioIds].sort();
  assert.deepEqual(fresh.state.artifacts.filter(a=>scenarioIds.has(a.id)).map(a=>a.id).sort(),expected);
  assert.deepEqual(fresh.state.tasks,legacySeed().tasks,'source registration does not create execution tasks');
  const legacy=legacySeed();legacy.revision=37;legacy.tasks.push({id:'user-task',status:'running'});legacy.skillVersions.push({projectId:'carddemo',skillId:'user-skill',version:'9.0.0',basedOn:{version:'8.0.0'},at:'2026-10-28',note:'user skill',from:{artifact:'user-artifact',suggestion:'user-suggestion'},files:[]});
  const bytes=JSON.stringify(legacy,null,2)+'\n';await writeFile(path,bytes);
  const existing=new Store(path);await existing.init();
  assert.deepEqual(existing.state,legacy);assert.equal(await readFile(path,'utf8'),bytes);
  await existing.reset();assert.equal(existing.state.revision,38);
  assert.deepEqual(existing.state.artifacts.filter(a=>scenarioIds.has(a.id)).map(a=>a.id).sort(),expected);
  const output=buildExport(existing.state);
  for(const s of [...fourRequirementScenarios,...fourRequirementScenariosV2])assert.equal(output.files.get(s.artifactId+'/v'+s.version)?.length,7);
 }finally{await rm(directory,{recursive:true,force:true});}
});
