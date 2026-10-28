import { collectTaskSessions, finishTaskCollection, mainTask } from '../src/task-automation.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialState, transition, type DemoState, type Action, type Role } from '../src/domain.js';
import { Store } from '../server/store.js';
import { shellQuote } from '../server/native.js';
import { teamsPages, isOwnerPage } from '../src/navigation.js';
import { teamUsage, usageSummary } from '../src/operations.js';
import { resourcePublications, resourceSubscriptions } from '../src/resource-sharing.js';
import { readSkillCatalog } from '../server/skill-packages.js';
import { updateWorkspace } from '../src/workspace.js';
const step = (s: ReturnType<typeof initialState>, action: Action, role: Role) => transition(s, action, role, action === 'knowledge' ? { knowledgeVersion: '信用卡营销返现业务知识 v2' } : action === 'assign' ? { assigneeId: 'member' } : {});
const flow: [Action, Role][] = [['assign','owner'],['knowledge','owner'],['prepare','member'],['replay','member'],['check-fail','member'],['fix','member'],['submit','member'],['enroll','owner'],['purchase','owner'],['deduplicate','owner'],['uat','owner'],['accept','owner']];
test('two-role delivery records the Talents knowledge version and keeps security status', () => {
  let s = initialState();
  for (const [action, role] of flow) s = transition(s, action, role, action === 'knowledge' ? { knowledgeVersion: '信用卡营销返现业务知识 v2' } : action === 'assign' ? { assigneeId: 'member' } : {});
  assert.equal(s.stage,'accepted');
  assert.equal(s.context?.skillVersion,'1.0.0'); assert.equal(s.context?.agentVersion,'r1');
  assert.equal(s.context?.knowledgeVersion,'信用卡营销返现业务知识 v2');
  assert.equal(s.security,'unverified'); assert.equal(s.balance,2670.15);
  assert.equal(s.transactions.length,1); assert.equal(s.transactions[0].reward,0.6);
  assert.equal(s.published,false); assert.equal(s.audit.length,12); assert.equal(s.audit.find(a=>a.action==='发起项目知识整合')?.detail,'Talents 已发布项目知识：信用卡营销返现业务知识 v2');
  assert.throws(()=>transition(s,'knowledge','owner',{knowledgeVersion:'信用卡营销返现业务知识 v2'}),/尚未发布新的项目知识/);
});
test('permission and prerequisite failures do not mutate state', () => {
  const s=initialState(), before=JSON.stringify(s);
  assert.throws(()=>transition(s,'assign','member'), /无权/);
  assert.throws(()=>transition(s,'publish' as Action,'owner'), /未知操作/);
  assert.throws(()=>transition(s,'knowledge','member'), /无权/);
  assert.throws(()=>transition(s,'prepare','member'),/先分配需求并完成知识/);
  assert.throws(()=>transition(s,'accept','owner'),/未完成/);
  assert.throws(()=>transition(s,'toString' as Action,'owner'),/未知/);
  assert.equal(JSON.stringify(s),before);
});
test('role navigation separates team management while retaining shared tool and project entry points', () => {
  assert.deepEqual(teamsPages('owner').map(p=>p.id).sort(), ['home','projects','team','agent','resources','subscriptions','publications','connections','team-work','talent'].sort());
  assert.deepEqual(teamsPages('member').map(p=>p.id).sort(), ['home','projects','team','agent','resources','subscriptions','publications','team-work','talent'].sort());
  assert.equal(teamsPages('owner').find(page=>page.id==='team-work')?.title,'任务追溯');
  assert.ok(isOwnerPage('connections')); assert.ok(isOwnerPage('organization')); assert.ok(isOwnerPage('trace-monitor'));
  assert.equal(isOwnerPage('team-work'), false, 'members can report their own task sessions');
  assert.equal(isOwnerPage('trace'), false, 'a member must retain access to their project execution record');
});
test('usage counts people rather than instances and separates waiting from running', () => {
  const members=teamUsage(initialState());
  assert.deepEqual(usageSummary(members),{total:6,used:5,today:4,online:4,running:1,tokens:214000});
  const duplicateInstance=structuredClone(members); duplicateInstance[2].instances.push({...duplicateInstance[2].instances[0],id:'another-running-instance'});
  assert.deepEqual(usageSummary(duplicateInstance),usageSummary(members));
  assert.deepEqual(usageSummary([...members,members[0]]),usageSummary(members));
  const developing={...initialState(),stage:'developing' as const};
  assert.equal(usageSummary(teamUsage(developing)).running,2);
});
test('failed tests prevent delivery and duplicate purchase cannot change ledger', () => {
  let s=initialState();
  for(const [a,r] of flow.slice(0,5))s=step(s,a,r);
  assert.throws(()=>transition(s,'submit','member'),/检查未通过/);
  for(const [a,r] of flow.slice(5,9))s=step(s,a,r);
  const serialized=JSON.stringify(s);
  assert.throws(()=>transition(s,'purchase','owner'),/只记账一次/);
  assert.equal(JSON.stringify(s),serialized);
});
test('Owner returns delivery and member must fix, submit and revalidate', () => {
  let s=initialState();
  for(const [a,r] of flow.slice(0,11))s=step(s,a,r);
  s=transition(s,'return','owner',{reason:'补充核验范围'});
  assert.equal(s.uat,false);assert.equal(s.stage,'returned');
  assert.throws(()=>transition(s,'accept','owner'),/未完成/);
  s=transition(s,'fix','member');s=transition(s,'submit','member');s=transition(s,'uat','owner');s=transition(s,'accept','owner');
  assert.equal(s.stage,'accepted');assert.equal(s.transactions.length,1);
});
test('atomic persistence, stale revision rejection and deliberate reset',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'teams-demo-store-'));
  try {
    const path=join(dir,'state.json'),store=new Store(path);await store.init();
    await store.apply(0,'assign','owner',{assigneeId:'member'});
    await assert.rejects(store.apply(0,'assign','owner',{assigneeId:'member'}),/另一页面/);
    const restored=new Store(path);await restored.init();assert.equal(restored.state.workspace.deliveryRequirements?.find(task=>task.id==='DEMO-MKT-001')?.assigneeId,'member');assert.equal(restored.state.assigned,false);assert.equal(restored.state.published,false);
    await restored.reset(1);assert.equal(restored.state.revision,2);assert.equal(restored.state.published,false);
    assert.deepEqual(JSON.parse(await readFile(path,'utf8')),restored.state);
    await writeFile(path,'broken');await assert.rejects(new Store(path).init());
  } finally {await rm(dir,{recursive:true,force:true});}
});
test('native shell arguments quote spaces and apostrophes without interpolation',()=>{
  assert.equal(shellQuote('/tmp/a b'),"'/tmp/a b'");
  assert.equal(shellQuote("a'b"),"'a'\\''b'");
  assert.equal(shellQuote('$(echo private)'),"'$(echo private)'");
});

test('project knowledge can precede assignment and frozen inputs retain selected skills and materials',()=>{
  let s=initialState();s=step(s,'knowledge','owner');assert.equal(s.assigned,false);
  s=transition(s,'assign','owner',{assigneeId:'member'});
  s=updateWorkspace(s,'material.add','member',{title:'新增边界',body:'检查普通卡资格边界'});
  s=updateWorkspace(s,'skills.select','member',{skills:['dev-frontend-ui','office-word']});
  s=transition(s,'prepare','member');assert.equal(s.context!.materials.length,1);assert.deepEqual(s.context!.selectedSkills,['dev-frontend-ui','office-word']);assert.equal(s.context!.agentVersion,'r1');assert.equal(s.published,false);
  const snapshot=JSON.stringify(s.context);
  s=updateWorkspace(s,'asset.add','owner',{title:'新增规范',kind:'document',location:'demo/spec'});
  assert.equal(JSON.stringify(s.context),snapshot);
  assert.throws(()=>updateWorkspace(s,'skills.select','member',{skills:['dev-backend-service']}),/冻结/);
  assert.throws(()=>updateWorkspace(s,'material.add','member',{title:'晚到资料',body:'内容'}),/冻结/);
});
test('team and connection management enforce roles and protect fixed demonstration identities',()=>{
  let s=initialState();assert.throws(()=>updateWorkspace(s,'member.invite','member',{name:'新成员'}),/无权/);
  s=updateWorkspace(s,'member.invite','owner',{teamId:'carddemo',name:'李明'});const id=s.workspace.team.members.at(-1)!.id;
  assert.equal(s.workspace.team.members.at(-1)!.status,'invited');
  s=updateWorkspace(s,'member.approve','owner',{teamId:'carddemo',id});assert.equal(s.workspace.team.members.at(-1)!.status,'active');
  assert.throws(()=>updateWorkspace(s,'member.remove','owner',{teamId:'carddemo',id:'member'}),/固定/);
  s=updateWorkspace(s,'member.remove','owner',{teamId:'carddemo',id});assert.equal(s.workspace.team.members.length,6);
});
test('manual post-delivery reporting is rejected and acceptance queues an independent collection',()=>{
  let s=initialState();assert.throws(()=>updateWorkspace(s,'session.report','member',{}),/自动归集/);
  assert.throws(()=>updateWorkspace(s,'analysis.run','owner',{scope:'single'}),/上报/);
  for(const [a,r] of flow.slice(0,12))s=step(s,a,r);
  assert.equal(s.workspace.taskAutomation?.[0].collection?.status,'queued');
  assert.equal(s.workspace.sessionReported,false);
  finishTaskCollection(s,mainTask,collectTaskSessions(s,mainTask),new Date().toISOString());
  assert.equal(s.workspace.taskAutomation?.[0].collection?.status,'empty');
  assert.equal(s.stage,'accepted');assert.equal(s.workspace.sessionReported,false);
  assert.throws(()=>updateWorkspace(s,'session.report','member',{}),/自动归集/);
});
test('base collaboration settings govern progress and session report independently of business skills',()=>{
  let s=initialState();for(const [a,r] of flow.slice(0,4))s=step(s,a,r);
  s=updateWorkspace(s,'progress.sync','member',{text:'已确认需求影响范围'});assert.equal(s.workspace.progress.length,1);
  s=updateWorkspace(s,'foundation.update','member',{progressEnabled:false,uploadEnabled:true});
  assert.throws(()=>updateWorkspace(s,'progress.sync','member',{text:'测试'}),/启用/);
  assert.equal(s.workspace.selectedSkills.length,13);
});
test('v1 migration preserves existing data and backup while broken v2 is rejected',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'teams-demo-migrate-'));try{
    const path=join(dir,'state.json'),old:any=initialState();delete old.workspace;delete old.schemaVersion;old.published=true;
    await writeFile(path,JSON.stringify(old));const store=new Store(path);await store.init();
    assert.equal(store.state.published,true);assert.equal(store.state.schemaVersion,2);
    assert.deepEqual(JSON.parse(await readFile(path+'.pre-v2.json','utf8')),old);
    const bad:any=structuredClone(store.state);delete bad.workspace;await writeFile(path,JSON.stringify(bad));
    await assert.rejects(new Store(path).init(),/工作区状态无效/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('new external demo sources save only their own scope and preserve existing workflow switches',()=>{
  const initial=initialState();
  assert.throws(()=>updateWorkspace(initial,'connection.update','member',{id:'test-assets',enabled:false,description:'测试用例'}),/无权/);
  assert.throws(()=>updateWorkspace(initial,'connection.update','owner',{id:'unknown-platform',enabled:true,description:'未知'}),/连接不存在/);
  const saved=updateWorkspace(initial,'connection.update','owner',{id:'test-assets',enabled:false,description:'白金卡返现测试用例'});
  assert.deepEqual(saved.workspace.connections.filter(c=>c.id!=='test-assets'),initial.workspace.connections);
  assert.deepEqual(saved.workspace.connections.find(c=>c.id==='test-assets'),{id:'test-assets',name:'测试资产平台',kind:'asset',enabled:false,description:'白金卡返现测试用例'});
  assert.deepEqual(saved.workspace.foundation,initial.workspace.foundation);assert.equal(saved.knowledge,false);
});

test('requirements and defects retain independent connection settings without migrating existing user values',()=>{
  let current=initialState();
  current=updateWorkspace(current,'connection.update','owner',{id:'requirements',enabled:false,description:'用户已保存的需求平台范围'});
  const requirements=structuredClone(current.workspace.connections.find(item=>item.id==='requirements'));
  current=updateWorkspace(current,'connection.update','owner',{id:'defects',enabled:true,description:'独立缺陷平台范围'});
  assert.deepEqual(current.workspace.connections.find(item=>item.id==='requirements'),requirements);
  assert.deepEqual(current.workspace.connections.find(item=>item.id==='defects'),{id:'defects',name:'缺陷平台',kind:'asset',enabled:true,description:'独立缺陷平台范围'});
  current=updateWorkspace(current,'connection.update','owner',{id:'requirements',enabled:true,description:'更新需求范围'});
  assert.equal(current.workspace.connections.find(item=>item.id==='defects')?.description,'独立缺陷平台范围');
});

test('resource publishing and subscriptions stay separate from unpublished project delivery',async()=>{
  const {skillCatalog}=await readSkillCatalog();
  let s=initialState();
  assert.throws(()=>updateWorkspace(s,'resource.acquire','member',{name:'dev-frontend-ui'}),/已发布的共享资源/);
  assert.throws(()=>updateWorkspace(s,'resource.publish','member',{id:'dev-frontend-ui'}),/无权/);
  assert.throws(()=>updateWorkspace(s,'resource.publish','owner',{id:'office-word'}),/共享范围/);
  assert.throws(()=>updateWorkspace(s,'skills.select','member',{skills:['not-owned']}),/有效的项目或用户/);
  assert.throws(()=>updateWorkspace(s,'skills.select','member',{skills:[]}),/有效的项目或用户/);
  s=transition(s,'assign','owner',{assigneeId:'member'});s=step(s,'knowledge','owner');
  assert.throws(()=>transition({...s,workspace:{...s.workspace,selectedSkills:[]}},'prepare','member'),/请选择/);
  s=updateWorkspace(s,'skills.select','member',{skills:['dev-frontend-ui','office-excel']});s=transition(s,'prepare','member');
  const context=structuredClone(s.context);
  s=updateWorkspace(s,'resource.publish','owner',{id:'dev-frontend-ui'},[],skillCatalog);
  assert.equal(s.published,false);assert.deepEqual(resourcePublications(s).map(item=>item.id),['dev-frontend-ui']);
  assert.throws(()=>updateWorkspace(s,'resource.publish','owner',{id:'dev-frontend-ui'},[],skillCatalog),/已发布/);
  assert.throws(()=>updateWorkspace(s,'resource.acquire','member',{name:'dev-code-reviewer'}),/已发布的共享资源/);
  s=updateWorkspace(s,'resource.acquire','member',{name:'dev-frontend-ui'});
  s=updateWorkspace(s,'resource.publish','owner',{id:'code-agent'});
  s=updateWorkspace(s,'resource.acquire','member',{name:'code-agent'});
  assert.deepEqual(s.workspace.acquiredResources,[]);
  assert.deepEqual(resourceSubscriptions(s,'member').map(item=>item.id),['dev-frontend-ui','code-agent']);
  assert.deepEqual(resourceSubscriptions(s,'owner'),[]);
  s=updateWorkspace(s,'resource.acquire','owner',{name:'code-agent'});
  assert.deepEqual(resourceSubscriptions(s,'owner').map(item=>item.id),['code-agent']);
  assert.deepEqual(s.context,context);assert.equal(s.checks,'none');assert.equal(s.security,'unverified');
  s=transition(s,'replay','member');assert.equal(s.stage,'developing');
});

test('legacy shared records and frozen inputs remain unchanged through explicit main-task migration',async()=>{
  const {skillCatalog}=await readSkillCatalog();
  const dir=await mkdtemp(join(tmpdir(),'teams-demo-legacy-resources-'));
  try{
    const path=join(dir,'state.json');let old=initialState();old=transition(old,'assign','owner',{assigneeId:'member'});old=transition(old,'knowledge','owner');old=transition(old,'prepare','member');old.published=true;
    old.audit=[{id:1,at:'2026-10-25T10:00:00.000Z',role:'owner',system:'Teams',action:'发布共享能力包',detail:'原演示共享记录',origin:'simulated'}];old.revision=1;
    old.workspace.acquiredResources=['dev-frontend-ui'];
    await writeFile(path,JSON.stringify(old));const bytes=await readFile(path,'utf8');
    const store=new Store(path);await store.init();const preserved=structuredClone(store.state);delete preserved.workspace.deliveryRequirements;assert.deepEqual(preserved,old);
    assert.equal(resourcePublications(store.state).length,14);assert.equal(await readFile(path+'.pre-unified-delivery.json','utf8'),bytes);
    let s=store.state;
    assert.equal(s.context?.agentVersion,'r1');assert.deepEqual(s.workspace.acquiredResources,['dev-frontend-ui']);
    s.adoptedSkill='1.1.0';s=updateWorkspace(s,'resource.publish','owner',{id:'dev-frontend-ui'},[],skillCatalog);
    assert.equal(resourcePublications(s).length,14);assert.equal(resourcePublications(s).find(item=>item.id==='dev-frontend-ui')?.version,'1.0.0');
    assert.throws(()=>updateWorkspace(s,'resource.publish','owner',{id:'dev-frontend-ui',version:'1.1.0'},[],skillCatalog),/没有对应内容包/);
    assert.deepEqual(resourceSubscriptions(s,'member'),[]);assert.deepEqual(resourceSubscriptions(s,'owner'),[]);
    s=updateWorkspace(s,'resource.acquire','member',{name:'dev-frontend-ui'});
    assert.equal(resourceSubscriptions(s,'member')[0].sha256,skillCatalog.find(item=>item.id==='dev-frontend-ui')!.sha256);
    assert.deepEqual(s.workspace.acquiredResources,['dev-frontend-ui']);
    assert.equal(resourcePublications(s).find(item=>item.id==='dev-code-reviewer')?.version,'1.0.0');
    assert.equal(s.context?.skillVersion,'1.0.0');assert.equal(s.audit[0].detail,'原演示共享记录');
    const bad:any=structuredClone(old);bad.workspace.resourcePublications=null;await writeFile(path,JSON.stringify(bad));
    await assert.rejects(new Store(path).init(),/资源发布记录无效/);
  }finally{await rm(dir,{recursive:true,force:true});}
});


test('old campaign state remains readable but cannot execute current rules until explicit reset', () => {
  const old = initialState(); delete old.campaignId;
  assert.throws(() => transition(old, 'assign', 'owner'), /旧活动规则/);
  assert.throws(() => updateWorkspace(old, 'project.update', 'owner', {}), /旧活动规则/);
  assert.equal(old.transactions.length, 0);
});
test('purchase needs no enrollment and uses current extra cashback amount', () => {
  let s = initialState();
  for (const [action, role] of flow.slice(0, 7)) s = step(s, action, role);
  assert.equal(s.enrolled, false);
  s = transition(s, 'purchase', 'owner');
  assert.equal(s.transactions[0].reward, 0.6); assert.equal(s.balance, 2670.15);
});
