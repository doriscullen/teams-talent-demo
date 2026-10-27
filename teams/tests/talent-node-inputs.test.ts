import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState} from '../src/domain.js';
import {createDeliveryRequirement,requireDeliveryMember} from '../src/delivery-requirements.js';
import {talentNodeInputs} from '../server/talent-node-inputs.js';
import {readFixtures} from '../server/http-shared.js';
import {loadSourceSkillPackage} from '../server/skill-packages.js';
import {taskNodeView} from '../src/task-node-contract.js';
import type {NodeInputContext} from '../server/talent-node-inputs.js';
import type {RequirementNode} from '../src/delivery-requirements.js';
const data=await readFixtures(),at='2026-10-27T00:00:00Z';
const load=async(id:string)=>{const p=await loadSourceSkillPackage(id),m=p.files.find(f=>f.path==='SKILL.md')!;return{id:p.id,name:p.name,version:p.version,sha256:p.sha256,contentSha256:m.sha256,content:m.bytes.toString('utf8'),source:'teams-registered-package' as const};};
function fixture(){const state=initialState(),task=createDeliveryRequirement(state,'owner',{projectId:'carddemo',id:'MKT-E2E-001',title:'白金卡需求',description:'白金卡、未来3个月、额外0.5%；其他政策待确认',assigneeId:'member',skillIds:['dev-code-reviewer']},at),project={id:'carddemo',name:'Credit Card',assets:state.workspace.project.assets,generation:'initial'};return{task,ctx:{token:'test-only',state,project,projects:[project]} as NodeInputContext};}
test('node-scoped Talent presets use distinct actual package hashes and do not mutate or adopt',async()=>{
 const {ctx,task}=fixture(),before=structuredClone(ctx.state),ids=[];
 for(const node of ['prepare','develop','verify','accept'] as RequirementNode[]){const input=await talentNodeInputs(ctx,data,task.id,node,'http://talent.test',load);assert.equal(input.nodeId,node);assert.equal(input.selection.source,'teams-node-selection');assert.ok(input.knowledge.assets.length);assert.ok(input.skills.length<=4);ids.push(input.skills.map(s=>s.id).join(','));for(const skill of input.skills)assert.deepEqual(skill,await load(skill.id));assert.ok(input.knowledge.assets.every(a=>a.sourceProjectId==='carddemo'&&a.detail.includes('')&&a.version));const view=taskNodeView(ctx.state,task,node,data,input);assert.ok(!view.inputs.some(i=>i.id==='other-skills'));assert.deepEqual(view.inputs.flatMap(i=>i.references).filter(r=>input.skills.some(s=>s.id===r.id)).map(r=>r.id),input.skills.map(s=>s.id));}
 assert.equal(new Set(ids).size,4);assert.deepEqual(ctx.state,before);
});
test('all imported task scopes remain separate and unknown tasks return no recommendation',async()=>{
 const {ctx}=fixture();ctx.project={id:'teams',name:'iCode Teams',generation:'initial'};
 for(const task of data.teamsProject.tasks)for(const node of ['prepare','develop','verify','accept'] as RequirementNode[]){const input=await talentNodeInputs(ctx,data,task.id,node,'http://talent.test',load);assert.equal(input.requirement.title,task.title);assert.ok(input.knowledge.assets.every(a=>a.sourceProjectId==='teams'&&!/白金卡|0\.5%|返现/.test(a.detail)));}
 const f=fixture();const unknown=createDeliveryRequirement(f.ctx.state,'owner',{projectId:'carddemo',id:'MKT-UNCONFIGURED',title:'未配置任务',description:'不能套用其他需求',assigneeId:'member',skillIds:['dev-code-reviewer']},at);const result=await talentNodeInputs(f.ctx,data,unknown.id,'prepare','http://talent.test',load);assert.equal(result.selection.status,'not-configured');assert.deepEqual(result.skills,[]);assert.deepEqual(result.knowledge.assets,[]);await assert.rejects(talentNodeInputs(f.ctx,data,'T104','prepare','http://talent.test',load),/不存在/);
});
test('old adopted package/knowledge subsets stay exact; new recommendations do not rewrite history',async()=>{
 const {ctx,task}=fixture(),review=await load('dev-code-reviewer');
 task.talentInputsSnapshot={projectId:'carddemo',taskId:task.id,generation:'initial',origin:'http://old.talent',requirement:{id:task.id,title:task.title,description:task.description},knowledge:{status:'ready',assets:[{id:'historic-requirement',pluginId:'business-knowledge',kind:'knowledge',sourceRecordId:task.id,title:'旧采用需求',summary:'原记录',detail:task.description,sourceProjectId:'carddemo',sourceProjectName:'旧项目名',origin:'teams-task',version:'historical-v1',references:[],relatedRequirementIds:[]}]},skills:[review,await load('dev-frontend-ui')]};task.stage='accepted';const before=structuredClone(task);
 const result=await talentNodeInputs(ctx,data,task.id,'verify','http://talent.test',load);assert.equal(result.selection.basis,'historical-subset');assert.deepEqual(result.skills,[review]);assert.equal(result.knowledge.assets[0].version,'historical-v1');assert.equal(result.selection.missingSkillIds.length,3);assert.deepEqual(task,before);
});
test('node adoption freezes exact selection while owner/member execution depends on assignee, not job title',async()=>{
 const {ctx,task}=fixture();const owner=createDeliveryRequirement(ctx.state,'owner',{projectId:'carddemo',id:'MKT-OWNER-001',title:'白金卡返现规则说明页',description:'仅展示确认事实和待确认项',assigneeId:'owner',skillIds:['dev-frontend-ui']},at);
 assert.doesNotThrow(()=>requireDeliveryMember(ctx.state,owner,'owner'));assert.throws(()=>requireDeliveryMember(ctx.state,owner,'member'),/交付人/);assert.throws(()=>requireDeliveryMember(ctx.state,task,'owner'),/交付人/);
 const input=await talentNodeInputs(ctx,data,owner.id,'develop','http://talent.test',load);owner.nodeInputSnapshots={develop:structuredClone(input)};const original=structuredClone(owner);const same=await talentNodeInputs(ctx,data,owner.id,'develop','http://talent.test',async()=>{throw new Error('must use saved snapshot');});assert.equal(same.selection.basis,'adopted-node');assert.deepEqual(same.skills,input.skills);assert.deepEqual(same.knowledge,input.knowledge);assert.deepEqual(owner,original);
});
