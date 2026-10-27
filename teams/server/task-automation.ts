import { exportTaskSessions } from './talent-intake.js';
import { nativeTaskSessionDocuments } from './task-session-documents.js';
import { createHash } from 'node:crypto';
import { runtimeDir } from './config.js';
import { deliveryRequirement,requireDeliveryMember } from '../src/delivery-requirements.js';
import type { TalentTaskSessionReceipt } from '../src/talent-contract.js';
import { requireCurrentTaskMember } from '../src/task-assignment.js';
import type { Presentation } from '../src/api.js';
import { DomainError, type DemoState, type Role } from '../src/domain.js';
import { finishTaskCollection, collectTaskSessions, mainTask, mutableTaskAutomation, requireWritableTask, taskAutomation, type TaskScope, type ImportedTaskInputs, type CollectedSession } from '../src/task-automation.js';
import { collaborationContext } from './collaboration-service.js';
import type { Store } from './store.js';

type Dependencies = { inputs(state: DemoState, scope: TaskScope): Promise<ImportedTaskInputs>; collect(state: DemoState, scope: TaskScope): Promise<CollectedSession[]>; report?(state:DemoState,scope:TaskScope):Promise<TalentTaskSessionReceipt> };
export class TaskAutomationService {
  private active = new Map<string, Promise<DemoState>>();
  constructor(private store: Store, data: Presentation, private dependencies: Dependencies = {
    async inputs(state, scope) {
      const context = await collaborationContext(state, data, { ...scope, nodeId: 'prepare' });
      if (context.knowledge.status === 'unavailable') throw new Error(context.knowledge.error ?? '项目知识暂不可读取');
      return { mode: context.mode as ImportedTaskInputs['mode'], contextId: context.contextId, requirement: context.agreement.title,
        knowledgeStatus: context.knowledge.status,
        knowledge: context.knowledge.assets.map((item: any) => ({ id: item.id, title: item.title ?? item.name, version: String(item.version ?? '未标注') })),
        skills: context.skills.map(item => ({ id: item.id, version: item.version, available: !!item.content && !item.availability.includes('unavailable') && item.availability !== 'example-only' })),
        references: context.references.map(item => ({ id: item.id, title: item.title, version: item.version })), materials: context.materials.map(item => ({ id: item.id, title: item.title })),
        notes: ['这里只读取现有知识、需求和 Skill；尚未替成员确认采用或冻结上下文。', ...context.skills.filter(item => !item.content).map(item => item.id + ' 正文不可用')],
      };
    },
    async collect(state, scope) { return collectTaskSessions(state, scope); },
    async report(state,scope){
      const task=deliveryRequirement(state,scope.projectId,scope.taskId),record=taskAutomation(state,scope)!.collection!;
      const acceptedAt=task?.acceptedAt??[...state.audit].reverse().find(item=>item.action==='通过功能验收')?.at;
      if(!acceptedAt)throw new Error('缺少验收时间，未发送会话');
      const inputDigest=task?.inputDigest??createHash('sha256').update(JSON.stringify(state.context)).digest('hex');
      const sessionDocuments=task&&(task.workDirectory||task.id==='DEMO-MKT-001')?await nativeTaskSessionDocuments(runtimeDir,scope,record.sessions,{id:record.id,acceptedAt}):undefined;
      return exportTaskSessions(state,{...scope,deliveryId:record.id,idempotencyKey:record.id,acceptedAt,inputDigest,sessions:record.sessions,...(sessionDocuments?{sessionDocuments}:{})});
    },
  }, private changed: () => Promise<unknown> = async () => {}) {}
  private run(key: string, operation: () => Promise<DemoState>) {
    const existing = this.active.get(key); if (existing) return existing;
    const pending = operation().finally(() => this.active.delete(key)); this.active.set(key, pending); return pending;
  }
  private async save(scope: TaskScope, work: (state: DemoState) => void, action: string, role: Role) {
    const saved = await this.store.transact(current => { const next = structuredClone(current); work(next); next.revision++; next.audit.push({ id: next.revision, at: new Date().toISOString(), role, system: 'Teams', action, detail: scope.projectId + '/' + scope.taskId, origin: 'simulated' }); return next; });
    await this.changed();
    return saved;
  }
  prepare(role: Role, scope: TaskScope, retry = false) {
    requireWritableTask(scope,this.store.state);

    const task=deliveryRequirement(this.store.state,scope.projectId,scope.taskId);
    if (!task && !this.store.state.assigned) throw new DomainError('需求尚未分配，知识导入等待任务开始');
    if(task)requireDeliveryMember(this.store.state,task,role);else {if(role!=='member')throw new DomainError('仅当前交付人可以读取任务输入',403);requireCurrentTaskMember(this.store.state);}
    const key = 'knowledge:' + scope.projectId + '/' + scope.taskId;
    return this.run(key, async () => {
      const existing = taskAutomation(this.store.state, scope)?.knowledge;
      if (existing && (!retry || existing.status === 'ready')) return this.store.state;
      const id = existing?.id ?? crypto.randomUUID();
      await this.save(scope, state => { mutableTaskAutomation(state, scope).knowledge = { id, attempts: (existing?.attempts ?? 0) + 1, status: 'running', startedAt: new Date().toISOString(), finishedAt: null }; }, '自动导入任务知识 · 开始', role);
      try {
        const inputs = await this.dependencies.inputs(this.store.state, scope);
        return await this.save(scope, state => {
          const record = taskAutomation(state, scope)?.knowledge; if (record?.id !== id) throw new DomainError('工作区已变化，本次知识导入结果未写入');
          record.status = inputs.skills.some(skill => skill.available) ? 'ready' : 'waiting'; record.inputs = inputs; record.finishedAt = new Date().toISOString();
        }, '自动导入任务知识 · 已核对输入', role);
      } catch (error) {
        if (taskAutomation(this.store.state, scope)?.knowledge?.id !== id) throw error;
        return this.save(scope, state => { const record = taskAutomation(state, scope)!.knowledge!; record.status = 'failed'; record.error = (error as Error).message; record.finishedAt = new Date().toISOString(); }, '自动导入任务知识 · 未完成', role);
      }
    });
  }
  collect(scope: TaskScope = mainTask, retry = false) {
    requireWritableTask(scope,this.store.state);
    if ((deliveryRequirement(this.store.state,scope.projectId,scope.taskId)?.stage??this.store.state.stage) !== 'accepted') throw new DomainError('验收尚未通过，不能归集会话数据');
    const key = 'collection:' + scope.projectId + '/' + scope.taskId;
    return this.run(key, async () => {
      const existing = taskAutomation(this.store.state, scope)?.collection;
      if (!existing) throw new DomainError('此验收没有自动归集任务；原有历史记录保持不变');
      if(existing.status==='collected'){if(existing.reporting?.status==='reported'||!retry)return this.store.state;return this.upload(scope);}
      if (existing.status !== 'queued' && !retry || existing.status==='empty') return this.store.state;
      const id = existing.id;
      await this.save(scope, state => { const record = taskAutomation(state, scope)!.collection!; record.status = 'running'; record.attempts++; record.error = undefined; record.startedAt = new Date().toISOString(); record.finishedAt = null; }, '验收后数据归集 · 开始', 'owner');
      try {
        const sessions = await this.dependencies.collect(this.store.state, scope);
        await this.save(scope, state => {
          const record = taskAutomation(state, scope)?.collection; if (record?.id !== id || (deliveryRequirement(state,scope.projectId,scope.taskId)?.stage??state.stage) !== 'accepted') throw new DomainError('验收范围已变化，本次归集结果未写入');
          finishTaskCollection(state,scope,sessions,new Date().toISOString());
        }, '验收后数据归集 · 已完成', 'owner');
        return sessions.length?this.upload(scope):this.store.state;
      } catch (error) {
        if (taskAutomation(this.store.state, scope)?.collection?.id !== id) throw error;
        return this.save(scope, state => { const record = taskAutomation(state, scope)!.collection!; record.status = 'failed'; record.error = (error as Error).message; record.finishedAt = new Date().toISOString(); }, '验收后数据归集 · 未完成', 'owner');
      }
    });
  }
  private async upload(scope:TaskScope){
    if(!this.dependencies.report)return this.store.state;
    await this.save(scope,state=>{taskAutomation(state,scope)!.collection!.reporting={status:'uploading',reason:'正在共享本任务会话至 Talents'};},'验收后会话共享 · 开始','owner');
    try{const receipt=await this.dependencies.report(this.store.state,scope);return this.save(scope,state=>{taskAutomation(state,scope)!.collection!.reporting={status:'reported',reason:'会话已写入共享目录，Talents 可读取',receipt};},'验收后会话共享 · 已写入','owner');}
    catch(error){return this.save(scope,state=>{taskAutomation(state,scope)!.collection!.reporting={status:'failed',reason:(error as Error).message};},'验收后会话共享 · 未完成','owner');}
  }

}
