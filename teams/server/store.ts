import { validateProjectIssues } from '../src/project-issues.js';
import { validateDeliveryRequirements } from '../src/delivery-requirements.js';
import { migrateMainDelivery } from './delivery-migration.js';
import { validateTeams } from '../src/teams-domain.js';
import { normalizeLegacyTaskAssignment } from '../src/task-assignment.js';
import { validateTaskAutomation } from '../src/task-automation.js';
import { validateGenericTasks } from '../src/generic-tasks.js';
import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateResourceState, type SkillCatalogEntry } from '../src/resource-sharing.js';
import { initialState, transition, DomainError, type DemoState, type Role, type Action } from '../src/domain.js';
import { runtimeDir } from './config.js';
import { initialWorkspace, updateWorkspace, type WorkspaceAction } from '../src/workspace.js';
import type { SourcePluginAsset } from '../src/source-plugins.js';
import { validateCreatedProjects } from '../src/created-projects.js';
import { validateCollaborationState } from '../src/collaboration.js';
export async function atomicText(path: string, value: string) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = path + '.' + randomUUID() + '.tmp';
  const file = await open(tmp, 'wx', 0o600);
  try { await file.writeFile(value); await file.sync(); } finally { await file.close(); }
  await rename(tmp, path);
}
export async function atomicJson(path: string, value: unknown) { await atomicText(path, JSON.stringify(value, null, 2) + '\n'); }
export class Store {
  state!: DemoState;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private path = join(runtimeDir, 'state.json')) {}
  async init() {
    try { this.state = JSON.parse(await readFile(this.path, 'utf8')); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; this.state = initialState(); await atomicJson(this.path, this.state); }
    if (!Number.isInteger(this.state.revision) || !Array.isArray(this.state.audit) || this.state.security !== 'unverified') throw new Error('工作区状态文件损坏；请保留文件后显式重置');
    // Explicit one-time v1 -> v2 migration, preserving the original demo state.
    if (!Object.hasOwn(this.state,'schemaVersion') && !Object.hasOwn(this.state,'workspace')) {
      await atomicJson(this.path+'.pre-v2.json',this.state);
      this.state.workspace=initialWorkspace();this.state.schemaVersion=2;
      if(this.state.context){this.state.context.selectedSkills=[...this.state.workspace.selectedSkills];this.state.context.materials=[];this.state.context.assets=structuredClone(this.state.workspace.project.assets);}
      await atomicJson(this.path,this.state);
    }
    if(this.state.schemaVersion!==2 || !this.state.workspace || !Array.isArray(this.state.workspace.project?.assets) || !Array.isArray(this.state.workspace.selectedSkills) || !Array.isArray(this.state.workspace.acquiredResources) || !Array.isArray(this.state.workspace.materials) || !Array.isArray(this.state.workspace.team?.members) || !Array.isArray(this.state.workspace.connections) || !Array.isArray(this.state.workspace.progress) || !this.state.workspace.foundation || !['idle','analyzed'].includes(this.state.workspace.analysis?.status)) throw new Error('工作区状态无效；未自动覆盖');
    if (Object.hasOwn(this.state.workspace, 'projects')) validateCreatedProjects(this.state.workspace.projects);
    if (Object.hasOwn(this.state.workspace, 'collaboration')) validateCollaborationState(this.state.workspace.collaboration);
    validateResourceState(this.state);
    validateTeams(this.state);
    validateGenericTasks(this.state);
    validateTaskAutomation(this.state);
    validateDeliveryRequirements(this.state);
    validateProjectIssues(this.state);
    normalizeLegacyTaskAssignment(this.state);
    if(!this.state.workspace.deliveryRequirements?.some(task=>task.projectId==='carddemo'&&task.id==='DEMO-MKT-001')){
      const original=await readFile(this.path,'utf8'),backup=this.path+'.pre-unified-delivery.json';
      try{const file=await open(backup,'wx',0o600);try{await file.writeFile(original);await file.sync();}finally{await file.close();}}
      catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;if(await readFile(backup,'utf8')!==original)throw new Error('主需求迁移备份已存在且内容不同；未覆盖状态');}
      migrateMainDelivery(this.state);validateDeliveryRequirements(this.state);await atomicJson(this.path,this.state);
    }
  }
  mutate(revision: number, operation: (state: DemoState) => DemoState) {
    const next = this.queue.then(async () => {
      if (revision !== this.state.revision) throw new DomainError('另一页面已更新数据，请刷新后重试');
      const state = operation(this.state);
      await atomicJson(this.path, state); this.state = state; return state;
    });
    this.queue = next.catch(() => undefined); return next;
  }
  apply(revision: number, action: Action, role: Role, payload: { reason?: string; assigneeId?: string }) { return this.mutate(revision, state => transition(state, action, role, payload)); }
  update(revision:number,kind:WorkspaceAction,role:Role,payload:Record<string,unknown>,sourceAssets:readonly SourcePluginAsset[]=[],catalog:readonly SkillCatalogEntry[]=[]){return this.mutate(revision,state=>updateWorkspace(state,kind,role,payload,sourceAssets,catalog));}
  reset(revision: number) { return this.mutate(revision, () => {const state={ ...initialState(), revision: revision + 1, talentGeneration: randomUUID() };migrateMainDelivery(state);return state;}); }
  /** Runs idempotency and revision checks together under the same persistence queue. */
  transact(operation: (state: DemoState) => DemoState) {
    const next = this.queue.then(async () => {
      const state = operation(this.state);
      if (state !== this.state) { await atomicJson(this.path, state); this.state = state; }
      return state;
    });
    this.queue = next.catch(() => undefined); return next;
  }
}
