import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, cp, mkdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialState, transition } from '../src/domain.js';
import { updateWorkspace } from '../src/workspace.js';
import { availableSkillIdsFor, projectSkillIds, resourcePublications, resourcePublicationHistory, resourceSubscriptions, resourceVersion, validateResourceState } from '../src/resource-sharing.js';
const dir=await mkdtemp(join(tmpdir(),'teams-resources-'));process.env.DEMO_STATE_DIR=dir;
const {readSkillCatalog,publicationCatalog,loadNativeSkillPackage,getPublishedSkillPackage,loadSourceSkillPackage}=await import('../server/skill-packages.js');
const {sha256,skillPackageDigest}=await import('../server/skill-installation.js');
const {workspace}=await import('../server/config.js');
const {skillCatalog,skillContents}=await readSkillCatalog();
after(()=>rm(dir,{recursive:true,force:true}));
function published(){return updateWorkspace(initialState(),'resource.publish-all','owner',{},[],skillCatalog);}
test('all 59 source files and full package manifests use their real metadata versions',async()=>{
  assert.equal(skillCatalog.length,59);assert.equal(Object.keys(skillContents).length,59);
  assert.equal(new Set(skillCatalog.map(item=>item.id)).size,59);
  assert.equal(skillCatalog.filter(item=>item.publisher==='owner').length,13);assert.equal(skillCatalog.filter(item=>item.publisher==='library').length,46);
  const catalog=await publicationCatalog();assert.deepEqual(catalog,skillCatalog);
  let attachments=0;
  for(const item of catalog){
    assert.equal(skillContents[item.id],await readFile(join(workspace,'.agents','skills',item.id,'SKILL.md'),'utf8'));
    assert.equal(sha256(skillContents[item.id]),item.contentSha256);
    const pkg=await loadNativeSkillPackage(item.id,item.version,item.sha256);assert.equal(skillPackageDigest(pkg.files),item.sha256);
    for(const file of pkg.files)assert.deepEqual(file.bytes,await readFile(join(workspace,'.agents','skills',item.id,file.path)));
    attachments+=pkg.files.length-1;
  }
  assert.equal(attachments,286);assert.equal(resourceVersion(initialState(),'audit-evidence'),'2.0.0');
  const frontend=catalog.find(item=>item.id==='dev-frontend-ui')!;
  await assert.rejects(loadNativeSkillPackage(frontend.id,'1.1.0',frontend.sha256),/版本.*不匹配/);
  await assert.rejects(loadNativeSkillPackage(frontend.id,frontend.version,'0'.repeat(64)),/不存在/);
});
test('publishing is explicit, preserves selected skills, and separates Owner and resource-library shares',()=>{
  const initial=initialState();assert.equal(resourcePublications(initial).length,0);
  assert.throws(()=>updateWorkspace(initial,'resource.publish-all','member',{},[],skillCatalog),/无权/);
  assert.throws(()=>updateWorkspace(initial,'resource.publish-all','owner',{},[],skillCatalog.slice(1)),/未就绪/);
  const s=published();assert.equal(resourcePublications(s).length,59);assert.equal(resourcePublications(s).filter(item=>item.publisher==='owner').length,13);
  assert.deepEqual(s.workspace.selectedSkills,projectSkillIds);assert.equal(s.context,null);assert.equal(s.published,false);
  assert.equal(updateWorkspace(s,'resource.publish-all','owner',{},[],skillCatalog),s);validateResourceState(s);
  assert.throws(()=>updateWorkspace(s,'resource.publish','owner',{id:'dev-frontend-ui',version:'1.1.0'},[],skillCatalog),/没有对应内容包/);
});
test('subscriptions are actor-scoped, fixed and idempotent; additional skills require the selecting actor subscription',async()=>{
  let s=published();const item=skillCatalog.find(item=>item.id==='audit-evidence')!;
  assert.throws(()=>updateWorkspace(s,'skills.select','member',{skills:[item.id]}),/当前用户订阅/);
  await assert.rejects(getPublishedSkillPackage(s,'member',item.id,item.version,item.sha256),/尚未订阅/);
  s=updateWorkspace(s,'resource.acquire','owner',{name:item.id});assert.ok(availableSkillIdsFor(s,'owner').includes(item.id));assert.ok(!availableSkillIdsFor(s,'member').includes(item.id));
  s=updateWorkspace(s,'resource.acquire','member',{name:item.id,version:item.version,sha256:item.sha256});
  const pinned=structuredClone(resourceSubscriptions(s,'member'));assert.equal(pinned[0].version,'2.0.0');assert.equal(pinned[0].sha256,item.sha256);
  assert.equal(updateWorkspace(s,'resource.acquire','member',{name:item.id}),s);
  s=updateWorkspace(s,'skills.select','member',{skills:[item.id,'office-word']});s=transition(s,'assign','owner',{assigneeId:'member'});s=transition(s,'knowledge','owner');s=transition(s,'prepare','member');
  const frozen=structuredClone(s.context);assert.equal(frozen!.skillBindings!.find(binding=>binding.id===item.id)?.sha256,item.sha256);
  // A future publication has a distinct, fixed identity; it cannot upgrade an existing subscription.
  const future={...item,version:'2.1.0',sha256:sha256('future package'),contentSha256:sha256('future SKILL body')};
  s=updateWorkspace(s,'resource.publish','owner',{id:item.id},[],[future]);assert.equal(resourcePublications(s).find(record=>record.id===item.id)?.version,'2.1.0');
  assert.equal(resourcePublicationHistory(s).filter(record=>record.id===item.id).length,2);
  assert.throws(()=>updateWorkspace(s,'resource.acquire','member',{name:item.id}),/固定旧版本/);
  assert.deepEqual(resourceSubscriptions(s,'member'),pinned);assert.deepEqual(s.context,frozen);
  assert.equal((await getPublishedSkillPackage(s,'member',item.id,item.version,item.sha256)).version,item.version);
  assert.equal(s.security,'unverified');assert.equal(s.stage,'assigned');validateResourceState(s);
});
test('unattributed legacy acquisitions grant neither actor and can be explicitly subscribed without erasing history',()=>{
  let s=published();s.workspace.acquiredResources=['audit-evidence','dev-frontend-ui'];const history=structuredClone(s.workspace.acquiredResources);
  for(const actor of ['owner','member'] as const){assert.deepEqual(resourceSubscriptions(s,actor),[]);assert.ok(!availableSkillIdsFor(s,actor).includes('audit-evidence'));}
  s=updateWorkspace(s,'resource.acquire','member',{name:'audit-evidence'});assert.equal(resourceSubscriptions(s,'member').length,1);assert.equal(resourceSubscriptions(s,'owner').length,0);
  s=updateWorkspace(s,'resource.acquire','owner',{name:'audit-evidence'});assert.equal(resourceSubscriptions(s,'owner').length,1);assert.deepEqual(s.workspace.acquiredResources,history);validateResourceState(s);
  const corrupt=structuredClone(s);corrupt.workspace.resourceSubscriptions![0].sha256='0'.repeat(64);assert.throws(()=>validateResourceState(corrupt),/订阅记录无效/);
});

test('generated Python cache is excluded while source attachments and invalid files remain checked',async()=>{
  const source=join(dir,'source'),id='audit-evidence';await mkdir(source);await cp(join(workspace,'.agents','skills',id),join(source,id),{recursive:true});
  const expected=await loadSourceSkillPackage(id,source);await mkdir(join(source,id,'__pycache__'));await writeFile(join(source,id,'__pycache__','local.pyc'),'cache');await writeFile(join(source,id,'scripts','local.pyc'),'cache');
  assert.equal((await loadSourceSkillPackage(id,source)).sha256,expected.sha256);
  const link = process.platform === 'win32' ? join(source, id, 'linked-dir') : join(source, id, 'linked.md');
  const target = process.platform === 'win32' ? join(source, id) : join(source, id, 'SKILL.md');
  await symlink(target, link, process.platform === 'win32' ? 'junction' : 'file');
  await assert.rejects(loadSourceSkillPackage(id, source), /符号链接/);
});

test('CLI context retains the frozen package after a new publication and explicitly rejects unavailable legacy versions',async t=>{
  const {collaborationContext}=await import('../server/collaboration-service.js');
  const {readFixtures}=await import('../server/http-shared.js');
  t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({assets:[]}),{status:200,headers:{'Content-Type':'application/json'}}));
  let s=published();const id='audit-evidence',item=skillCatalog.find(entry=>entry.id===id)!;
  s=updateWorkspace(s,'resource.acquire','member',{name:id});s=updateWorkspace(s,'skills.select','member',{skills:[id]});s=transition(s,'assign','owner',{assigneeId:'member'});s=transition(s,'knowledge','owner');s=transition(s,'prepare','member');
  s=updateWorkspace(s,'resource.publish','owner',{id},[],[{...item,version:'2.1.0',sha256:sha256('new package'),contentSha256:sha256('new body')}]);
  const data=await readFixtures();data.skillContents[id]='Current catalog text must not replace the frozen package';
  const context=await collaborationContext(s,data,{projectId:'carddemo',taskId:'DEMO-MKT-001',nodeId:'develop'}),skill=context.skills.find(value=>value.id===id)!;
  assert.equal(skill.version,item.version);assert.equal(skill.content,skillContents[id]);assert.equal('sha256' in skill?skill.sha256:null,item.sha256);
  const legacy=structuredClone(s);delete legacy.context!.skillBindings;legacy.context!.selectedSkills=['dev-frontend-ui'];legacy.context!.skillVersion='1.1.0';
  const unavailable=(await collaborationContext(legacy,data,{projectId:'carddemo',taskId:'DEMO-MKT-001',nodeId:'develop'})).skills[0];
  assert.equal(unavailable.version,'1.1.0');assert.equal(unavailable.content,null);assert.equal(unavailable.availability,'frozen-version-unavailable');assert.equal(unavailable.loadedByAgent,false);
});
