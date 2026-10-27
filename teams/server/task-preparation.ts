import { enterpriseTestCaseReferences } from '../src/task-node-contract.js';
import { DomainError, type DemoState, type Role } from '../src/domain.js';
import { deliveryRequirement } from '../src/delivery-requirements.js';
import { projectMembers } from '../src/teams-domain.js';
import { taskAutomation, queueTaskPreparation, taskPreparationBasis, type TaskScope, type TaskPreparation, type ImportedTaskInputs, taskNodeKnowledge, nodeKnowledgeBasis, type KnowledgeNode } from '../src/task-automation.js';
import type { TalentNodeInputs } from '../src/talent-node-inputs.js';
import type { NativePreparationResult } from '../src/native-preparation.js';
import type { Presentation } from '../src/api.js';
import type { Store } from './store.js';
import { readTalentNodeInputs } from './talent-node-client.js';

interface PreparationDependencies {
  prepareSession(assigneeId:string,scope:TaskScope,preparationId:string):Promise<NativePreparationResult>;
  loadInputs?(state:DemoState,scope:TaskScope&{nodeId?:KnowledgeNode}):Promise<TalentNodeInputs>;
  delay?(milliseconds:number):Promise<void>;
  delayMs?:number;
}
class SupersededPreparation extends Error {}
const wait = (milliseconds:number) => new Promise<void>(resolve => { const timer=setTimeout(resolve,milliseconds);timer.unref(); });

/** A persisted preparation job, independent of adoption, development and acceptance. */
export class TaskPreparationService {
  private active=new Map<string,Promise<DemoState>>();
  constructor(private store:Store,private data:Presentation,private dependencies:PreparationDependencies,private changed:()=>Promise<unknown>=async()=>{}){}
  private current(scope:TaskScope,id:string,state=this.store.state){
    const task=deliveryRequirement(state,scope.projectId,scope.taskId),preparation=taskAutomation(state,scope)?.preparation;
    if(!task||!preparation||preparation.id!==id||preparation.basisKey!==taskPreparationBasis(state,scope)||task.assigneeId!==preparation.assigneeId||task.stage!=='preparing'||task.preparedAt)throw new SupersededPreparation('任务或准备依据已经变化');
    return {task,preparation};
  }
  private async update(scope:TaskScope,id:string,action:string,operation:(state:DemoState,preparation:TaskPreparation)=>void){
    const saved=await this.store.transact(current=>{this.current(scope,id,current);const next=structuredClone(current),preparation=taskAutomation(next,scope)!.preparation!;operation(next,preparation);preparation.updatedAt=new Date().toISOString();next.revision++;next.audit.push({id:next.revision,at:preparation.updatedAt,role:'owner',system:'Teams',action,detail:scope.projectId+'/'+scope.taskId,origin:'simulated'});return next;});
    await this.changed();return saved;
  }
  resumeQueued(){
    for(const record of this.store.state.workspace.taskAutomation??[])for(const node of ['develop','verify'] as const)if(['queued','running'].includes(record.nodeKnowledge?.[node]?.status??''))void this.scheduleNode(record,node).catch(error=>console.error('节点知识获取未完成：'+(error as Error).message));
    for(const record of this.store.state.workspace.taskAutomation??[])if(record.preparation&&['queued','importing','preparing-session'].includes(record.preparation.status)&&record.preparation.assigneeId)void this.schedule(record).catch(error=>console.error('自动准备未完成：'+(error as Error).message));
  }
  async retry(role:Role,scope:TaskScope){
    const task=deliveryRequirement(this.store.state,scope.projectId,scope.taskId);
    if(!task||!projectMembers(this.store.state,scope.projectId).some(member=>member.id===role&&member.status==='active')||role!=='owner'&&task.assigneeId!==role)throw new DomainError('仅交付本人或项目 Owner 可以重试准备',403);
    if(!task.assigneeId)throw new DomainError('请先分配交付人',409);
    // Only an explicit preparation request may initialize an untouched historical task.
    // Page reads/startup never manufacture a new job or replace an adopted/ready cache.
    if(!taskAutomation(this.store.state,scope)?.preparation){
      await this.store.transact(current=>{
        const selected=deliveryRequirement(current,scope.projectId,scope.taskId),record=taskAutomation(current,scope);
        if(!selected||selected.assigneeId!==role||!projectMembers(current,scope.projectId).some(member=>member.id===role&&member.status==='active'))throw new DomainError('仅当前交付人可以开始会话准备',403);
        if(record?.preparation)return current;
        if(selected.stage!=='preparing'||selected.preparedAt||Object.keys(selected.nodeInputSnapshots??{}).length||Object.values(selected.nodes).some(node=>node.status!=='pending')||['running','ready'].includes(record?.knowledge?.status??''))throw new DomainError('当前任务已有执行或输入记录，请沿现有工作入口继续；未重新创建准备',409);
        const next=structuredClone(current),at=new Date().toISOString();queueTaskPreparation(next,scope,at);
        next.revision++;next.audit.push({id:next.revision,at,role,system:'Teams',action:'确认准备 iCode 会话',detail:scope.projectId+'/'+scope.taskId,origin:'simulated'});return next;
      });await this.changed();
    }
    const preparation=taskAutomation(this.store.state,scope)!.preparation!;
    if(preparation.status==='ready')return this.store.state;
    if(['failed','waiting-directory'].includes(preparation.status)&&!preparation.retryable)throw new DomainError('当前准备需要核对原生记录，不能重复启动',409);
    void this.schedule(scope,true).catch(error=>console.error('重试自动准备未完成：'+(error as Error).message));return this.store.state;
  }
  schedule(scope:TaskScope,retry=false):Promise<DemoState>{
    const preparation=taskAutomation(this.store.state,scope)?.preparation;
    if(!preparation||!preparation.assigneeId||preparation.status==='ready'||!retry&&['failed','waiting-directory'].includes(preparation.status))return Promise.resolve(this.store.state);
    const running=this.active.get(preparation.id);if(running)return running;
    const pending=this.execute({...scope},preparation.id).finally(()=>this.active.delete(preparation.id));this.active.set(preparation.id,pending);return pending;
  }
  async retryNode(role:Role,scope:TaskScope,node:KnowledgeNode){
    if(node==='prepare')return this.retry(role,scope);
    const task=deliveryRequirement(this.store.state,scope.projectId,scope.taskId);
    if(!task||!projectMembers(this.store.state,scope.projectId).some(member=>member.id===role&&member.status==='active')||role!=='owner'&&task.assigneeId!==role)throw new DomainError('仅交付本人或项目 Owner 可以重试知识获取',403);
    const job=taskNodeKnowledge(taskAutomation(this.store.state,scope),node);if(!job||job.status==='waiting-upstream')throw new DomainError('当前节点正在等待上游交付物，不能提前获取知识',409);
    void this.scheduleNode(scope,node,true).catch(error=>console.error('重试节点知识未完成：'+(error as Error).message));return this.store.state;
  }
  scheduleNode(scope:TaskScope,node:'develop'|'verify',retry=false):Promise<DemoState>{
    const job=taskNodeKnowledge(taskAutomation(this.store.state,scope),node);
    if(!job||['waiting-upstream','ready'].includes(job.status)||job.status==='failed'&&!retry)return Promise.resolve(this.store.state);
    const running=this.active.get(job.id);if(running)return running;
    const pending=this.executeNode({...scope},node,job.id).finally(()=>this.active.delete(job.id));this.active.set(job.id,pending);return pending;
  }
  private async executeNode(scope:TaskScope,node:'develop'|'verify',id:string){
    const current=(state=this.store.state)=>{const task=deliveryRequirement(state,scope.projectId,scope.taskId),job=taskNodeKnowledge(taskAutomation(state,scope),node);if(!task||!job||job.id!==id||task.nodeInputSnapshots?.[node])throw new SupersededPreparation('节点知识获取已被替换或已有冻结输入');return{task,job};};
    const save=async(action:string,operation:(job:NonNullable<ReturnType<typeof taskNodeKnowledge>>)=>void)=>{const saved=await this.store.transact(state=>{current(state);const next=structuredClone(state),job=current(next).job;operation(job);next.revision++;next.audit.push({id:next.revision,at:new Date().toISOString(),role:'owner',system:'Teams',action,detail:scope.projectId+'/'+scope.taskId+'/'+node,origin:'simulated'});return next;});await this.changed();return saved;};
    try{
      const before=current();if(!projectMembers(this.store.state,scope.projectId).some(member=>member.id===before.task.assigneeId&&member.status==='active'))throw new Error('交付人不在当前项目有效成员范围');
      if(before.job.basisKey!==nodeKnowledgeBasis(this.store.state,scope,node))throw new Error('上游产物版本已变化，请先核对当前节点输入依据；未替换原获取记录');
      if(before.job.status!=='running')await save('自动获取节点知识 · 开始',job=>{job.status='running';job.attempts++;job.startedAt=new Date().toISOString();job.finishedAt=null;delete job.error;});
      const job=current().job,remaining=Math.max(0,(this.dependencies.delayMs??job.delayMs??20000)-(Date.now()-Date.parse(job.startedAt)));
      if(remaining)await(this.dependencies.delay??wait)(remaining);
      current();
      const inputs=await(this.dependencies.loadInputs?.(this.store.state,{...scope,nodeId:node})??readTalentNodeInputs(this.store.state,this.data,{...scope,nodeId:node},{forImport:true}));
      const latest=current();if(latest.job.basisKey!==nodeKnowledgeBasis(this.store.state,scope,node))throw new Error('获取期间上游产物版本已变化，未写入不一致的节点输入');
      if(inputs.projectId!==scope.projectId||inputs.taskId!==scope.taskId||inputs.nodeId!==node||inputs.selection.status!=='configured'||!inputs.knowledge.assets.length||!inputs.skills.length||inputs.skills.some(skill=>!skill.content||!skill.sha256))throw new Error('当前节点相关知识与 Skill 尚未配置完成');
      return await save('自动获取节点知识 · 完成',record=>{record.status='ready';record.finishedAt=new Date().toISOString();record.nodeInputs=structuredClone(inputs);record.externalInputs=node==='verify'?enterpriseTestCaseReferences(this.data,latest.task):[];record.inputs={mode:'preparation',contextId:null,requirement:inputs.requirement.title,knowledgeStatus:'available',knowledge:inputs.knowledge.assets.map(item=>({id:item.id,title:item.title,version:item.version})),skills:inputs.skills.map(item=>({id:item.id,version:item.version,available:true})),references:(record.upstream??[]).map(item=>({id:item.id,title:item.title,version:item.version??'未登记'})),materials:[],notes:['仅获取本节点输入，未替代 iCode 采用或执行。']};});
    }catch(error){if(error instanceof SupersededPreparation)return this.store.state;try{return await save('自动获取节点知识 · 未完成',job=>{job.status='failed';job.finishedAt=new Date().toISOString();job.error=(error as Error).message;});}catch(stale){if(stale instanceof SupersededPreparation)return this.store.state;throw stale;}}
  }
  private async execute(scope:TaskScope,id:string){
    try{
      const first=this.current(scope,id),knowledge=taskAutomation(this.store.state,scope)!.knowledge;
      if(!projectMembers(this.store.state,scope.projectId).some(member=>member.id===first.task.assigneeId&&member.status==='active'))throw new Error('交付人不在当前项目的有效成员范围');
      if(knowledge?.status!=='ready'){
        if(first.preparation.status!=='importing')await this.update(scope,id,'自动准备 · 导入知识开始',(state,preparation)=>{
          const at=new Date().toISOString();preparation.status='importing';preparation.startedAt=at;preparation.finishedAt=null;preparation.error=undefined;preparation.retryable=false;preparation.attempts++;
          preparation.progress.push({at,phase:'knowledge',status:'started',summary:'正在导入当前需求的知识与 Skill',source:'teams-import'});
          const record=taskAutomation(state,scope)!;record.knowledge={...record.knowledge,id:record.knowledge?.id??crypto.randomUUID(),attempts:(record.knowledge?.attempts??0)+1,status:'running',startedAt:at,finishedAt:null};
        });
        const startedAt=this.current(scope,id).preparation.startedAt!;
        const remaining=Math.max(0,(this.dependencies.delayMs??taskAutomation(this.store.state,scope)?.knowledge?.delayMs??10000)-(Date.now()-Date.parse(startedAt)));
        if(remaining)await(this.dependencies.delay??wait)(remaining);
        this.current(scope,id);
        const inputs=await(this.dependencies.loadInputs?.(this.store.state,scope)??readTalentNodeInputs(this.store.state,this.data,{...scope,nodeId:'prepare'},{forImport:true}));
        this.current(scope,id);
        if(inputs.projectId!==scope.projectId||inputs.taskId!==scope.taskId||inputs.nodeId!=='prepare'||inputs.selection.status!=='configured'||!inputs.knowledge.assets.length||!inputs.skills.length||inputs.skills.some(skill=>!skill.content||!skill.sha256))throw new Error('当前需求的知识或 Skill 尚未就绪，未准备原生会话');
        await this.update(scope,id,'自动准备 · 知识导入完成',(state,preparation)=>{
          const at=new Date().toISOString(),record=taskAutomation(state,scope)!;
          const summary:ImportedTaskInputs={mode:'preparation',contextId:null,requirement:inputs.requirement.title,knowledgeStatus:'available',knowledge:inputs.knowledge.assets.map(item=>({id:item.id,title:item.title,version:item.version})),skills:inputs.skills.map(item=>({id:item.id,version:item.version,available:true})),references:[],materials:[],notes:['当前需求节点知识与登记 Skill 已导入；尚未确认采用或执行。']};
          record.knowledge={...record.knowledge!,status:'ready',finishedAt:at,inputs:summary,nodeInputs:structuredClone(inputs)};
          preparation.status='preparing-session';preparation.progress.push({at,phase:'knowledge',status:'completed',summary:'当前需求知识与 Skill 导入完成',source:'teams-import'});
        });
      }
      await this.update(scope,id,'自动准备 · 创建原生会话',(state,preparation)=>{
        preparation.status='preparing-session';preparation.error=undefined;preparation.finishedAt=null;preparation.retryable=false;
        preparation.progress.push({at:new Date().toISOString(),phase:'session',status:'started',summary:'调用原生 iCode 创建会话并读取任务与节点上下文',source:'native-cli'});
      });
      const {task}=this.current(scope,id);
      const result=await this.dependencies.prepareSession(task.assigneeId,scope,id);
      this.current(scope,id);
      if(result.status==='waiting-directory')return await this.update(scope,id,'自动准备 · 等待工作目录',(_state,preparation)=>{preparation.status='waiting-directory';preparation.retryable=true;preparation.error=result.reason;preparation.finishedAt=new Date().toISOString();preparation.progress.push({at:preparation.finishedAt,phase:'session',status:'waiting',summary:result.reason,source:'native-cli'});});
      if(result.runId!==id||!/^[a-f0-9-]{36}$/i.test(result.sessionId)||!/^[a-f0-9]{64}$/.test(result.contextSha256)||!/^[a-f0-9]{64}$/.test(result.sessionSha256)||!result.readEvidence.length)throw new Error('原生准备回执缺少可核验的会话或上下文读取证据');
      return await this.update(scope,id,'自动准备 · 会话就绪',(_state,preparation)=>{preparation.status='ready';preparation.session=result;preparation.retryable=false;preparation.finishedAt=new Date().toISOString();preparation.progress.push({at:preparation.finishedAt,phase:'session',status:'completed',summary:result.summary,source:'native-cli'});});
    }catch(error){
      if(error instanceof SupersededPreparation)return this.store.state;
      try{return await this.update(scope,id,'自动准备 · 未完成',(state,preparation)=>{const knowledge=taskAutomation(state,scope)!.knowledge;const phase=knowledge?.status==='ready'?'session':'knowledge';if(knowledge&&phase==='knowledge'){knowledge.status='failed';knowledge.error=(error as Error).message;knowledge.finishedAt=new Date().toISOString();}preparation.status='failed';preparation.retryable=true;preparation.error=(error as Error).message;preparation.finishedAt=new Date().toISOString();preparation.progress.push({at:preparation.finishedAt,phase,status:'failed',summary:(error as Error).message,source:phase==='knowledge'?'teams-import':'native-cli'});});}
      catch(stale){if(stale instanceof SupersededPreparation)return this.store.state;throw stale;}
    }
  }
}
