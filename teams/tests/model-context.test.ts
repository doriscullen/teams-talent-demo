import test from 'node:test';
import assert from 'node:assert/strict';
import {projectModelContext} from '../server/model-context.js';
import {taskNodeDefinitions} from '../src/task-node-contract.js';
import type {TaskNodeReference} from '../src/task-node-contract.js';
type Full=Parameters<typeof projectModelContext>[0];
const body='业务全文：仅白金卡；未来3个月，额外0.5%。日期起算、消费范围、上限、舍入、到账和退款仍待确认。';
const scope={projectId:'carddemo',taskId:'REQ-context-fixture',nodeId:'develop',tab:'delivery'};
const reference:TaskNodeReference={id:'prd:version-1',title:'已确认 PRD',description:'完整 PRD 目标、范围、验收标准与已确认边界。',kind:'local-file',value:'docs/prd.md',version:'1',source:'actual',sourceNode:'prepare',sourceLabel:'CLI 实际成果回传',artifact:'prd'};
function full():Full{
 const skills=[{id:'design-fixture',name:'设计说明',version:'1.2.3',sha256:'a'.repeat(64),contentSha256:'b'.repeat(64),content:'# 完整 Skill\n禁止编造已确认规则。\n保留全部工作要求与引用。',source:'teams-registered-package' as const}];
 const asset={id:'knowledge-1',title:'业务规则',detail:body,version:'2',contentSha256:'c'.repeat(64),origin:'teams-node-preset' as const};
 const nodeInputs={...scope,nodeId:'develop' as const,generation:'one',origin:'local',requirement:{id:scope.taskId,title:'权益页',description:'原始需求全文'},knowledge:{status:'ready' as const,version:'2',assets:[asset]},skills,selection:{version:'2',source:'teams-node-selection' as const,status:'configured' as const,basis:'recommendation' as const,note:'按当前节点匹配，未采用',missingSkillIds:[],knowledge:[{id:asset.id,slot:'development-knowledge',reason:'规则约束',nodeId:'develop' as const}],skills:[{id:skills[0].id,slot:'development-skills',reason:'设计实现',nodeId:'develop' as const}]}};
 const adoption={...scope,id:'adoption',role:'member' as const,runId:'run',sessionId:'session',basisDigest:'d'.repeat(64),readReferences:['knowledge-1'],at:'now',revision:2};
 const event={...adoption,operationId:'operation',adoptionId:'adoption',phase:'blocked' as const,summary:'缺少资格字段的确认依据',blocker:'需要Owner确认',evidence:[]};
 return {contract:'teams-demo-collaboration-v1',scope,currentNodeId:'develop',rework:{allowed:false,requiresExplicitStart:true,acceptance:'manual-owner-only'},revision:7,basisDigest:'d'.repeat(64),mode:'frozen',contextId:'CTX',frozenAt:'now',agreement:{id:scope.taskId,title:'权益页',background:'原始需求全文',assignee:{id:'member',name:'陈晨'},criteria:[],revision:'requirement-v1'},node:{name:'功能开发',brief:'输入要求',output:'产物要求'},assets:[],materials:[],references:[],skills:skills.map(s=>({...s,scope:'talent',path:null,availability:'talent-node-input',loadedByAgent:false,files:[]})),projectSkills:[],agent:{name:'iCode',configuration:{status:'native-configuration-selected-at-launch'},loadedByAgent:false},knowledge:{status:'available',origin:'local',selectedVersion:'2',assets:[asset]},talentInputs:nodeInputs,nodeInputs,nodeContract:{version:'delivery-node-v2',definition:taskNodeDefinitions.develop,inputs:[{id:'prd',label:'已确认 PRD',status:'ready',references:[reference]},{id:'development-knowledge',label:'开发知识',status:'ready',references:[{id:asset.id,title:asset.title,kind:'record',description:body+'\n关联理由：规则约束',source:'preset',sourceLabel:'节点知识',version:'2'}]}],deliverables:[],criteria:taskNodeDefinitions.develop.completionCriteria.map(item=>({...item,status:'pending' as const,evidenceIds:[]})),artifacts:[reference]},automaticPreparation:{id:'job',nodeId:'develop',status:'ready',attempts:1,startedAt:'then',finishedAt:'now',nodeInputs,upstream:[reference]},inputSources:{knowledge:'shared',skills:'registered',talentSkillLoading:'shared-inputs'},stage:'developing',adoptedBasis:[adoption,{...adoption,id:'adoption-2',revision:3}],events:[event,{...event,id:'event-2',revision:4}],availableActions:['inputs.adopt','progress.add','result.submit'],safety:{security:'unverified',contextReadIsAdoption:false,resultIsAcceptance:false},skillPath:'/fixture/SKILL.md'} as Full;
}
function occurrences(value:unknown,text:string):number{if(typeof value==='string')return value===text?1:0;return value&&typeof value==='object'?Object.values(value).reduce<number>((sum,item)=>sum+occurrences(item,text),0):0;}

test('model projection retains full business bodies once, exact digest/versions and genuine upstream facts without mutating authoritative input',()=>{
 const input=full(),before=JSON.stringify(input),model=projectModelContext(input);
 assert.equal(model.currentNodeId,'develop');
 assert.equal(JSON.stringify(input),before);assert.equal(model.revision,input.revision);assert.equal(model.basisDigest,input.basisDigest);assert.deepEqual(model.agreement,input.agreement);assert.deepEqual(model.node,input.node);assert.deepEqual(model.nodeContract!.definition,input.nodeContract!.definition);assert.deepEqual(model.nodeContract!.criteria,input.nodeContract!.criteria);
 assert.equal(occurrences(input,input.skills[0].content!),4);assert.equal(occurrences(model,input.skills[0].content!),1);assert.deepEqual(model.skills,input.skills);assert.deepEqual(model.knowledge,input.knowledge);assert.deepEqual(model.nodeContract!.inputs[0].references[0],reference);
 const knowledge=model.nodeContract!.inputs[1].references[0];assert.equal(knowledge.contentRef,'#/knowledge/assets/0/detail');assert.equal(knowledge.description,'关联理由：规则约束');assert.equal((model.knowledge.assets[0] as any).detail,body);
 assert.equal(model.nodeContract!.artifacts.length,0);assert.equal('talentInputs' in model,false);assert.equal('events' in model,false);assert.equal('adoptedBasis' in model,false);assert.equal('nodeInputs' in model.automaticPreparation!,false);
 assert.equal(model.history.eventCount,2);assert.equal(model.history.adoptionCount,2);assert.equal(model.history.latestEvent!.id,'event-2');assert.equal(model.history.latestAdoption!.id,'adoption-2');assert.equal(model.history.latestEvent!.blocker,'需要Owner确认');
});

test('waiting node output remains empty even if an old preparation record contains a different node body',()=>{
 const input=full();input.skills=[];input.knowledge.assets=[];input.nodeInputs!.skills=[];input.nodeInputs!.knowledge.assets=[];input.nodeInputs!.selection.status='not-configured';input.nodeContract!.inputs=[];input.automaticPreparation!.status='waiting-upstream';input.automaticPreparation!.nodeInputs=full().nodeInputs!;input.availableActions=['context.get'];
 const model=projectModelContext(input);assert.deepEqual(model.skills,[]);assert.deepEqual(model.knowledge.assets,[]);assert.deepEqual(model.availableActions,['context.get']);assert.doesNotMatch(JSON.stringify(model),/完整 Skill/);assert.equal(model.automaticPreparation!.status,'waiting-upstream');
});

test('same-ID distinct prose and unrepresented artifact evidence remain verbatim rather than being replaced or truncated',()=>{
 const input=full(),ref=input.nodeContract!.inputs[1].references[0];ref.description=body+'\n另一份不可丢失的实际补充';input.nodeContract!.artifacts.push({...reference,id:'old-prd',version:'prior',description:'历史真实产物引用',value:'docs/prd-prior.md'});
 const model=projectModelContext(input);assert.deepEqual(model.nodeContract!.inputs[1].references[0],ref);assert.equal(model.nodeContract!.artifacts.length,1);assert.equal(model.nodeContract!.artifacts[0].description,'历史真实产物引用');assert.equal(model.nodeContract!.artifacts[0].version,'prior');
});
