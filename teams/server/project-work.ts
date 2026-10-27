import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { DomainError, type DemoState, type Role } from '../src/domain.js';
import { deliveryRequirement, requirementNode, requireDeliveryMember } from '../src/delivery-requirements.js';
import type { Presentation } from '../src/api.js';
import type { ProjectWorkAction, ProjectWorkPlan, ProjectWorkReceipt, ProjectWorkSelection } from '../src/project-work.js';
import { nativeWorkDefaults, startNativeWork } from './native.js';
import { codeRoot, root, runtimeDir, sessionId, workspace, origin } from './config.js';
import { formatShellCommand } from './terminal-launcher.js';
import { collaborationContext, collaborationSkillPath } from './collaboration-service.js';
import { projectModelContext } from './model-context.js';
import { taskWorkDirectory } from './task-work-directory.js';
import { atomicJson, atomicText } from './store.js';
import { prepareNativeSession, type PreparationInput } from './native-session-preparation.js';
import type { NativePreparationResult } from '../src/native-preparation.js';
import { taskAutomation, taskNodeKnowledge, type KnowledgeNode, type TaskScope } from '../src/task-automation.js';
import { projectMembers } from '../src/teams-domain.js';
import { binary } from './config.js';
import { nativeTraceEnvironment } from '../scripts/native/tui-trace.mjs';
import { readNativeTuiEnvelope } from './task-session-documents.js';
import { nativeProcessActive } from '../scripts/native/session-liveness.mjs';
import { focusWorkTerminal } from './terminal-focus.js';

const execute = promisify(execFile);
const nodeNames: Record<string, string> = { prepare: '需求澄清', develop: '开发', verify: '验证', accept: '验收' };
const stageNames: Record<string, string> = { content: '项目内容', management: '任务管理', delivery: '任务交付', release: '发布跟踪', settings: '项目设置' };
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function resolveProjectWork(state: DemoState, data: Presentation, input: ProjectWorkSelection) {
  if (!input || typeof input.projectId !== 'string' || !Object.hasOwn(stageNames, input.tab)) throw new DomainError('项目工作位置无效', 400);
  const target: ProjectWorkSelection = { projectId: input.projectId, tab: input.tab };
  const requirement = deliveryRequirement(state, input.projectId, input.taskId ?? input.requirementId ?? (input.projectId==='carddemo'&&input.tab==='delivery'?'DEMO-MKT-001':undefined));
  if (requirement) {
    if (input.taskId && input.requirementId && input.taskId !== input.requirementId) throw new DomainError('任务与需求标识不一致', 400);
    const nodeId = input.nodeId ?? requirementNode(requirement);
    if (!Object.hasOwn(nodeNames, nodeId)) throw new DomainError('交付节点不存在', 400);
    Object.assign(target, { taskId: requirement.id, requirementId: requirement.id, nodeId });
    const project = input.projectId === 'carddemo' ? state.workspace.project : input.projectId === 'teams' ? {...data.teamsProject.project,assets:[]} : state.workspace.projects?.find(item => item.id === input.projectId);
    if (!project) throw new DomainError('项目不存在', 404);
    return { target, projectName: project.name, title: requirement.title, location: nodeNames[nodeId], source: '独立交付需求与已登记的任务工作目录', repository: requirement.workDirectory ?? '', assets: project.assets ?? [], skills: requirement.skillIds };
  }
  if (input.projectId === 'carddemo') {
    if (input.taskId && input.taskId !== 'DEMO-MKT-001' || input.requirementId && input.requirementId !== 'DEMO-MKT-001') throw new DomainError('需求不属于当前项目', 400);
    target.requirementId = 'DEMO-MKT-001';
    if (input.tab === 'delivery') {
      const node = input.nodeId ?? (['submitted', 'accepted'].includes(state.stage) ? 'accept' : ['failed', 'fixed'].includes(state.stage) ? 'verify' : ['developing', 'returned'].includes(state.stage) ? 'develop' : 'prepare');
      if (!Object.hasOwn(nodeNames, node)) throw new DomainError('交付节点不存在', 400);
      target.taskId = 'DEMO-MKT-001'; target.nodeId = node;
    }
    return { target, projectName: state.workspace.project.name, title: '信用卡消费返现', location: target.nodeId ? nodeNames[target.nodeId] : stageNames[input.tab], source: 'CardDemo 当前源码与项目交付材料', repository: '', assets: state.workspace.project.assets, skills: state.context?.selectedSkills ?? state.workspace.selectedSkills };
  }
  if (input.projectId === 'teams') {
    const snapshot = data.teamsProject;
    let title = snapshot.project.name, location = stageNames[input.tab];
    if (input.tab === 'delivery' || input.taskId) {
      const task = snapshot.tasks.find(task => task.id === (input.taskId ?? snapshot.selection.taskId));
      if (!task) throw new DomainError('iCode Teams 任务不存在', 400);
      const node = task.nodes.find(node => node.id === (input.nodeId ?? (task.id === snapshot.selection.taskId ? snapshot.selection.nodeId : task.nodes[0].id)));
      if (!node) throw new DomainError('任务节点不存在', 400);
      Object.assign(target, { taskId: task.id, requirementId: 'REQ-' + task.id, nodeId: node.id }); title = task.title; location = node.name;
    }
    if (input.discussionId) { const discussion = snapshot.discussions.find(item => item.id === input.discussionId); if (!discussion) throw new DomainError('任务讨论不存在', 400); target.discussionId = discussion.id; title = discussion.title; }
    if (input.releaseId) { if (!snapshot.releases.some(item => item.name === input.releaseId)) throw new DomainError('发布版本不存在', 400); target.releaseId = input.releaseId; }
    return { target, projectName: snapshot.project.name, title, location, source: 'Teams 项目快照；尚无可恢复的本机会话记录', repository: 'github.com/SEAL-iCode/iCode-teams', assets: snapshot.documents.map(item => ({ title: item.path, location: item.path })), skills: snapshot.project.skills.map(skill => typeof skill === 'string' ? skill : String((skill as any).name ?? (skill as any).id)) };
  }
  const project = state.workspace.projects?.find(project => project.id === input.projectId);
  if (!project) throw new DomainError('项目不存在', 404);
  if (input.taskId || input.nodeId || input.requirementId) throw new DomainError('此项目尚未登记可启动的任务节点', 400);
  return { target, projectName: project.name, title: project.name, location: stageNames[input.tab], source: '新建项目；本次是项目阶段作业，不创建任务或推进交付', repository: project.remoteUrl, assets: project.assets ?? [], skills: [] as string[] };
}

/** Same repository-root/origin rules as Teams project-management/client/repository.ts. */
export function repositoryIdentity(value: string): string {
  const scp = /^(?:git@)?([A-Za-z0-9.-]+):([^/].*)$/.exec(value);
  const url = new URL(scp && !value.includes('://') ? `ssh://git@${scp[1]}/${scp[2]}` : value);
  if (!['https:', 'ssh:'].includes(url.protocol) || url.password || url.search || url.hash || url.protocol === 'https:' && url.username) throw new DomainError('代码仓地址必须是无凭据的 HTTPS/SSH 地址', 400);
  return url.hostname.toLowerCase() + (url.port && !(url.protocol === 'ssh:' && url.port === '22') ? ':' + url.port : '') + url.pathname.replace(/\/+$/, '').replace(/\.git$/, '');
}
async function inspectDirectory(directory: string, repository: string, sourceRoot: string) {
  if (typeof directory !== 'string' || !isAbsolute(directory) || directory.includes('\0')) throw new DomainError('请输入本机代码仓的绝对路径', 400);
  if (!(await stat(directory)).isDirectory()) throw new DomainError('所选位置不是目录');
  const canonical = await realpath(directory);
  let reference: string | undefined;
  try { reference = await realpath(sourceRoot); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (reference && (canonical === reference || canonical.startsWith(reference + '/'))) throw new DomainError('此目录是只读的 Teams 参考仓；请绑定自己的可工作检出目录');
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_'))), LC_ALL: 'C', LANG: 'C' };
  const git = async (args: string[]) => (await execute('git', ['-C', canonical, ...args], { env, timeout: 5000, maxBuffer: 65536, windowsHide: true })).stdout.trim();
  if (await realpath(await git(['rev-parse', '--show-toplevel'])) !== canonical) throw new DomainError('请选择 Git checkout 或 worktree 根目录');
  if (isAbsolute(repository)) {
    if (await realpath(repository) !== canonical) throw new DomainError('当前目录与项目登记的本机代码仓不一致');
  } else {
    const expected = repository.includes('://') || repository.startsWith('git@') ? repositoryIdentity(repository) : repository;
    if (repositoryIdentity(await git(['config', '--get', 'remote.origin.url'])) !== expected) throw new DomainError('目录 origin 与项目代码仓不一致');
  }
  return canonical;
}
type NativeDefaults = Awaited<ReturnType<typeof nativeWorkDefaults>>;
export interface WorkTransport {
  defaults(): Promise<NativeDefaults>;
  history(): Promise<{ available: boolean; directory: string; title: string; diagnostic?: string; configuration?: NonNullable<ProjectWorkPlan['history']>['configuration']; active: NonNullable<ProjectWorkPlan['history']>['active'] }>;
  start(input: Parameters<typeof startNativeWork>[0]): Promise<unknown>;
  focus(history: NonNullable<ProjectWorkPlan['history']>): Promise<{ status: string; note: string }>;
}
const nativeTransport: WorkTransport = {
  defaults: nativeWorkDefaults,
  async history() { return { available: false, directory: workspace, title: '', active: null }; },
  start: startNativeWork,
  focus: focusWorkTerminal,
};
interface SavedRequest { identity: string; receipt: ProjectWorkReceipt }
export class ProjectWorkService {
  private queue: Promise<unknown> = Promise.resolve();
  private preparations = new Map<string, Promise<NativePreparationResult>>();
  constructor(private current: () => DemoState, private data: Presentation, private directory = runtimeDir, private transport: WorkTransport = nativeTransport, private prepareTransport = prepareNativeSession) {}
  prepare(assigneeId: string, scope: TaskScope, preparationId: string): Promise<NativePreparationResult> {
    const key = JSON.stringify({assigneeId, scope, preparationId});
    const existing = this.preparations.get(key); if (existing) return existing;
    const pending = this.prepareSession(assigneeId, scope, preparationId).finally(() => this.preparations.delete(key));
    this.preparations.set(key, pending); return pending;
  }
  private async prepareSession(assigneeId: string, scope: TaskScope, preparationId: string): Promise<NativePreparationResult> {
    const verify = () => {
      const state = this.current(), task = deliveryRequirement(state, scope.projectId, scope.taskId), scheduled = taskAutomation(state, scope)?.preparation;
      if (!task || task.assigneeId !== assigneeId || !projectMembers(state, scope.projectId).some(member => member.id === assigneeId && member.status === 'active') || scheduled?.id !== preparationId || scheduled.assigneeId !== assigneeId || task.stage !== 'preparing' || task.preparedAt || Object.values(task.nodes).some(node => node.status !== 'pending')) throw new DomainError('会话准备范围或交付人已变化，未启动原生会话',409);
      return task;
    };
    const task = verify(), target: ProjectWorkSelection = { ...scope, tab: 'delivery', nodeId: 'prepare' };
    const plan = await this.plan('owner', target, assigneeId);
    if (!plan.directory.valid || !plan.directory.root) return { status: 'waiting-directory', reason: plan.directory.diagnostic };
    if (!plan.instance.installed || !plan.instance.agent || !plan.instance.model) throw new Error('iCode 或当前 Agent / 模型配置不可用');
    if (plan.instance.trace?.readiness === 'unavailable') throw new Error(plan.instance.trace.diagnostic);
    const contextPath = join(this.directory,'work-contexts',preparationId+'.preparation.json'), taskFile = join(this.directory,'work-contexts',preparationId+'.preparation.md');
    let reads: PreparationInput['reads'];
    try { reads = JSON.parse(await readFile(join(this.directory,'work-contexts',preparationId+'.native','preparation-request.json'),'utf8')).reads; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const context = projectModelContext(await collaborationContext(this.current(),this.data,target));
      await atomicJson(contextPath,context);
      const prompt = `# Teams 会话初始化：${task.title}\n项目 ${scope.projectId}；任务 ${scope.taskId}；节点 prepare（需求澄清）；初始化 ${preparationId}。\n\n本轮仅为开发者准备会话。你必须先用 read_file 完整读取以下两个文件；每次明确指定 line_range=[1,-1] 与 max_tokens=120000，以免长 JSON 行或 Skill 正文被默认截断：\n1. ${collaborationSkillPath}\n2. ${contextPath}\n\n本轮的限制优先于所读 Skill 中的执行步骤：只允许 read_file 工具读取材料，不运行 shell、写文件、修改代码、创建PRD、调用Teams CLI写操作、inputs adopt、progress add、result submit、验收或切换节点。不要创建todo或委派Agent。不要把需求、采用依据、PRD或检查标记为已确认。需求、知识与Skill正文以结构化上下文中的当前节点版本为准（顶层正文完整，contentRef 指向同文档正文）；缺失或待定必须如实列出。\n\n读完后，仅给开发者一段简洁可见回复：概括已读取的需求/知识/Skill及来源版本，列出需要开发者确认的问题，明确“已准备，等待开发者在 TUI 继续需求澄清”。随后结束这一轮并等待，不继续执行任何业务步骤。恢复到TUI后，只有开发者的后续明确指令才允许按当前节点的Teams协作Skill开展工作。\n`;
      await atomicText(taskFile,prompt);
      reads = await Promise.all([contextPath,collaborationSkillPath].map(async path=>({path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')})));
    }
    verify(); // Reassignment or a replaced queue must not start an obsolete model turn.
    const trace = nativeTraceEnvironment(process.env,{...scope,nodeId:'prepare',runId:preparationId});
    return this.prepareTransport({runId:preparationId,scope:{...scope,nodeId:'prepare'},assigneeId,directory:plan.directory.root,executable:binary,runner:join(root,'scripts/native/run-project-task.mjs'),runtime:this.directory,taskFile,contextPath,skillPath:collaborationSkillPath,reads,agent:plan.instance.agent,agentLabel:plan.instance.agentLabel??plan.instance.agent,model:plan.instance.model,modelLabel:plan.instance.modelLabel??plan.instance.model,env:trace.env});
  }
  private async bindings(): Promise<Record<string, string>> {
    try { const value = JSON.parse(await readFile(join(this.directory, 'project-work-bindings.json'), 'utf8')); if (!value || Array.isArray(value) || Object.values(value).some(path => typeof path !== 'string' || !isAbsolute(path))) throw new Error('本机目录绑定记录损坏'); return value; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error; }
  }
  private async previous(target: ProjectWorkSelection) {
    let files: string[];
    try { files = await readdir(join(this.directory, 'project-work')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
    const requests = await Promise.all(files.filter(file => /^[0-9a-f-]+\.json$/.test(file)).map(async file => JSON.parse(await readFile(join(this.directory, 'project-work', file), 'utf8')) as SavedRequest));
    return requests.filter(item => JSON.stringify(item.receipt.target) === JSON.stringify(target)).sort((a, b) => b.receipt.at.localeCompare(a.receipt.at))[0]?.receipt;
  }
  private async preparedHistory(scope: TaskScope): Promise<ProjectWorkPlan['history']> {
    const preparation=taskAutomation(this.current(),scope)?.preparation, ready=preparation?.session;
    if(preparation?.status!=='ready'||!ready)return undefined;
    const base=join(this.directory,'work-contexts'), candidates=[{runId:ready.runId,at:ready.preparedAt}];
    let pendingEntry = false;
    for(const name of await readdir(base)){
      if(!/^[0-9a-f-]{36}\.native$/i.test(name)||name===ready.runId+'.native')continue;
      let manifest:any;try{manifest=JSON.parse(await readFile(join(base,name,'manifest.json'),'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')continue;throw error;}
      if(manifest.preparedSession?.preparationRunId===ready.runId&&manifest.preparedSession.sessionId===ready.sessionId&&manifest.scope?.projectId===scope.projectId&&manifest.scope?.taskId===scope.taskId){
        try{const owner=JSON.parse(await readFile(join(base,name,'native-session.json'),'utf8'));candidates.push({runId:manifest.runId,at:owner.startedAt});}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;pendingEntry=true;}
      }
    }
    const source=candidates.sort((a,b)=>b.at.localeCompare(a.at))[0], runRoot=join(base,source.runId+'.native');
    const owner=JSON.parse(await readFile(join(runRoot,'native-session.json'),'utf8'));
    if(owner.runId!==source.runId||owner.sessionId!==ready.sessionId||owner.projectId!==scope.projectId||owner.taskId!==scope.taskId||owner.sessionRoot!==join(runRoot,'session-root'))throw new Error('已准备会话的运行范围不匹配');
    const optional = async (name: string) => { try { return JSON.parse(await readFile(join(runRoot,name),'utf8')); } catch(error) { if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error; } };
    const result=await optional('result.json'), processRecord=await optional('process.json');
    let active:NonNullable<ProjectWorkPlan['history']>['active']=null;
    if(owner.executionMode==='interactive') {
      if(result&&(result.executionMode!=='interactive'||result.runId!==source.runId||result.sessionId!==ready.sessionId||!['completed','failed'].includes(result.status)))throw new Error('会话退出回执身份不匹配');
      const running=await nativeProcessActive(owner,processRecord);
      const lock=await optional('session-root/sessions/.locks/'+ready.sessionId.replaceAll('-','').slice(0,12)+'.active.json');
      if(lock&&(lock.session_id!==ready.sessionId||lock.pid!==owner.pid||lock.started_at!==owner.startedAt))throw new Error('已准备会话的活动身份不能核验');
      if(running) {
        if(result||!lock)throw new Error('会话进程与退出/活动记录不一致，请核对原终端；未重复启动');
        const terminal=await optional('terminal-receipt.json');
        if(terminal&&(terminal.runId!==source.runId||terminal.projectId!==scope.projectId||terminal.taskId!==scope.taskId||terminal.directory!==ready.directory))throw new Error('会话终端回执范围不匹配');
        const canFocus=process.platform==='darwin'&&terminal?.terminalId&&['ghostty','terminal'].includes(terminal.terminalKind);
        active={pid:owner.pid,application:canFocus?terminal.terminal:null,tty:terminal?.terminalKind==='terminal'?terminal.terminalId:'',...(canFocus?{terminal:{id:terminal.terminalId,kind:terminal.terminalKind,title:terminal.terminal,directory:ready.directory}}:{}),diagnostic:canFocus?'会话仍在运行，将切换到此任务的原终端；不会重复启动。':'此任务会话仍在运行，但没有可核验的终端定位；请在原终端继续，未重复启动。'};
      }
    } else if(!result||result.runId!==source.runId||result.sessionId!==ready.sessionId||result.status!=='completed')throw new Error('初始化会话尚无有效完成回执，未尝试恢复');
    const envelope=await readNativeTuiEnvelope(runRoot,ready.sessionId);
    return {sessionId:ready.sessionId,directory:ready.directory,title:'已准备的需求澄清会话',available:(!active||!!active.terminal)&&!pendingEntry,active,diagnostic:active?.diagnostic??(pendingEntry?'此前进入请求尚未取得原生会话回执，请核对已打开的终端；未重复启动。':result?.status==='failed'?'上次终端异常退出；最新对话已保存，将恢复同一会话。':'将恢复本任务最近保存的原生会话，继续保留对话。'),configuration:{agent:ready.agent,agentLabel:ready.agentLabel,model:ready.model,modelLabel:ready.modelLabel},prepared:{preparationRunId:ready.runId,sourceRunId:source.runId,sessionSha256:createHash('sha256').update(envelope.content).digest('hex')}};
  }

  async plan(role: Role, input: ProjectWorkSelection, directoryActorId: string = role): Promise<ProjectWorkPlan> {
    const state = this.current(), work = resolveProjectWork(state, this.data, input);
    const requirement = deliveryRequirement(state, work.target.projectId, work.target.taskId);
    let directory: ProjectWorkPlan['directory'];
    if (requirement?.projectId==='carddemo'&&requirement.id==='DEMO-MKT-001') {
      await access(join(codeRoot,'docs/design/08-marketing-capability.md'));
      directory={root:await realpath(codeRoot),valid:true,kind:'imported-snapshot',diagnostic:'原主任务使用已核验的导入源码目录；与其他任务使用同一 CLI 交付协议。'};
    } else if (requirement) {
      directory = { root: requirement.workDirectory ?? null, valid: false, kind: 'git-binding', diagnostic: '此需求尚未登记可工作的独立代码目录。' };
      if (requirement.workDirectory) try { const selected = await taskWorkDirectory(this.directory, requirement); directory.root = await inspectDirectory(selected!, selected!, this.data.baseline.sourceRoot); directory.valid = true; directory.diagnostic = '本需求工作目录与 Git 根目录已核验；交互式 iCode 使用此目录。'; } catch (error) { directory.diagnostic = (error as Error).message; }
      else {
        const bindings = await this.bindings();
        const binding = bindings[directoryActorId + ':' + work.target.projectId] ?? bindings['owner:' + work.target.projectId];
        if(binding)try{const repository=work.target.projectId==='teams'?'github.com/SEAL-iCode/iCode-teams':work.target.projectId==='carddemo'?binding:this.current().workspace.projects?.find(project=>project.id===work.target.projectId)?.remoteUrl??'';directory.root=await inspectDirectory(binding,repository,this.data.baseline.sourceRoot);directory.valid=true;directory.diagnostic='使用当前项目已核验的本机目录。';}catch(error){directory.diagnostic=(error as Error).message;}
        else if (work.target.projectId === 'carddemo') {
          try {
            await access(join(codeRoot, 'docs/design/08-marketing-capability.md'));
            directory = { root: await realpath(codeRoot), valid: true, kind: 'imported-snapshot', diagnostic: '使用信用卡项目已核验的默认源码目录；本次会话初始化只读取背景和材料，不修改代码。' };
          } catch (error) { directory.diagnostic = '信用卡项目默认源码目录不可用：' + (error as Error).message; }
        }
      }
    } else if (work.target.projectId === 'carddemo') {
      await access(join(codeRoot, 'docs/design/08-marketing-capability.md'));
      directory = { root: await realpath(codeRoot), valid: true, kind: 'imported-snapshot', diagnostic: '已核验本机导入源码快照；该快照没有 .git，不宣称已完成生产仓库绑定。' };
    } else {
      const binding = (await this.bindings())[role + ':' + work.target.projectId];
      directory = { root: binding ?? null, valid: false, kind: 'git-binding', diagnostic: '尚未绑定本机目录，请先核验并关联一个与项目代码仓一致的 checkout/worktree。' };
      if (binding) try { directory.root = await inspectDirectory(binding, work.repository, this.data.baseline.sourceRoot); directory.valid = true; directory.diagnostic = '本机仓库根目录与项目 origin 已核验。'; } catch (error) { directory.diagnostic = (error as Error).message; }
    }
    const defaults = await this.transport.defaults();
    const frozen = requirement ? !!requirement.preparedAt : work.target.projectId === 'carddemo' && !!work.target.taskId && !!state.context;
    const context = { frozen, summary: requirement ? frozen ? '本需求已确认准备依据；继续核对当前节点和任务采用记录。' : '本需求尚未确认准备依据；iCode 先读取上下文并明确采用。' : frozen ? `已冻结 ${state.context!.id}；保持本次需求、资料与采用版本。` : '尚未冻结：本次只提供当前项目与工作位置的快照，不等同于已采用知识或已读取全部资料。', versions: requirement ? requirement.inputDigest ?? '本需求尚未记录采用摘要' : frozen ? `知识 ${state.context!.knowledgeVersion} · Skill ${state.context!.skillVersion} · Agent ${state.context!.agentVersion}` : '当前资料与选择；采用版本尚未冻结', selectedSkills: requirement ? [] : work.skills, assets: (requirement ? [] : work.assets).map(asset => ({ title: asset.title, location: asset.location })) };
    let taskStartReason: string | undefined=work.target.taskId&&!requirement?'此来源任务未关联当前用户交付身份，只可查看':undefined;
    if (requirement) {
      try { requireDeliveryMember(state, requirement, role); } catch (error) { taskStartReason = (error as Error).message; }
      if (['awaiting-acceptance', 'accepted'].includes(requirement.stage) || work.target.nodeId === 'accept') taskStartReason = '当前需求已进入 Owner 验收，不再启动开发工作';
    }
    const preparation=requirement?taskAutomation(state,{projectId:requirement.projectId,taskId:requirement.id})?.preparation:undefined;
    const nodeKnowledge = requirement && ['prepare','develop','verify'].includes(work.target.nodeId ?? '') ? taskNodeKnowledge(taskAutomation(state,{projectId:requirement.projectId,taskId:requirement.id}),work.target.nodeId as KnowledgeNode) : undefined;
    const knowledgeReason = nodeKnowledge && nodeKnowledge.status !== 'ready' ? (nodeKnowledge.status === 'waiting-upstream' ? '当前节点等待上游交付物确认，知识与 Skill 尚未准备' : nodeKnowledge.error ?? '当前节点的知识与 Skill 尚未准备完成，请稍后进入') : undefined;
    const history=preparation?.status==='ready'?await this.preparedHistory({projectId:requirement!.projectId,taskId:requirement!.id}):undefined;
    const preparationReason=preparation ? history ? history.available?undefined:history.diagnostic : preparation.error??(preparation.status==='waiting-directory'?'请先配置当前任务工作目录，再继续准备会话':preparation.status==='failed'?'会话准备未完成，请先重试准备':'知识与会话正在准备，请稍后进入') : undefined;
    const launchReason = !defaults ? '配套 iCode 未安装' : defaults.terminal.error ?? (requirement && defaults.trace?.readiness === 'unavailable' ? defaults.trace.diagnostic : undefined) ?? (!directory.valid ? directory.diagnostic : undefined);
    const reason = taskStartReason ?? preparationReason ?? (history?.active ? undefined : launchReason ?? knowledgeReason);
    const actions: ProjectWorkPlan['actions'] = [{ id: history?.active ? 'focus' : history ? 'resume' : 'new', label: history?.active ? '进入正在运行的会话' : history ? '进入已准备会话' : requirement ? '打开当前节点的 iCode 交互会话' : '新建当前工作的 iCode 会话', enabled: !reason, ...(reason ? { reason } : {}) }];
    const plan: ProjectWorkPlan = { executionMode: 'interactive', target: work.target, projectName: work.projectName, title: work.title, location: work.location, source: work.source, planToken: '', instance: { installed: !!defaults, name: '本机 iCode', ...defaults, trace: requirement ? defaults?.trace : undefined }, directory, context, actions, defaultAction: 'new' };
    if(history){plan.history=history;plan.defaultAction=history.active?'focus':'resume';}
    plan.planToken = hash({ role, plan, revision: state.revision });
    plan.previous = await this.previous(work.target); return plan;
  }
  bind(role: Role, input: ProjectWorkSelection, directory: string) {
    const next = this.queue.then(() => this.bindDirectory(role, input, directory)); this.queue = next.catch(() => undefined); return next;
  }
  private async bindDirectory(role: Role, input: ProjectWorkSelection, directory: string) {
    const work = resolveProjectWork(this.current(), this.data, input);
    const task=deliveryRequirement(this.current(),input.projectId,input.taskId);
    if (work.target.projectId === 'carddemo' && (!task || task.id==='DEMO-MKT-001')) throw new DomainError('CardDemo 主任务使用已经核验的导入源码位置');
    const repository=task ? task.workDirectory ?? (input.projectId==='teams'?'github.com/SEAL-iCode/iCode-teams':input.projectId==='carddemo'?directory:this.current().workspace.projects?.find(project=>project.id===input.projectId)?.remoteUrl??'') : work.repository;
    const canonical = await inspectDirectory(directory, repository, this.data.baseline.sourceRoot);
    const bindings = await this.bindings(); bindings[role + ':' + input.projectId] = canonical;
    await atomicJson(join(this.directory, 'project-work-bindings.json'), bindings);
    return this.plan(role, input);
  }
  start(role: Role, body: { requestId: string; target: ProjectWorkSelection; action: ProjectWorkAction; planToken: string }) {
    const next = this.queue.then(() => this.run(role, body)); this.queue = next.catch(() => undefined); return next;
  }
  private async run(role: Role, body: { requestId: string; target: ProjectWorkSelection; action: ProjectWorkAction; planToken: string }) {
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(body.requestId) || !['new', 'resume', 'focus'].includes(body.action)) throw new DomainError('作业请求格式无效', 400);
    const identity = hash({ role, ...body }), path = join(this.directory, 'project-work', body.requestId + '.json');
    try { const saved = JSON.parse(await readFile(path, 'utf8')) as SavedRequest; if (saved.identity !== identity) throw new DomainError('此请求标识已用于另一项工作'); return saved.receipt; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const plan = await this.plan(role, body.target);
    if (plan.planToken !== body.planToken) throw new DomainError('启动依据已变化，请重新读取并确认');
    const action = plan.actions.find(action => action.id === body.action);
    if (!action?.enabled) throw new DomainError(action?.reason ?? '当前会话动作不可用');
    const requirement = deliveryRequirement(this.current(), plan.target.projectId, plan.target.taskId);
    if (requirement) {
      requireDeliveryMember(this.current(), requirement, role);
      if (['awaiting-acceptance', 'accepted'].includes(requirement.stage) || plan.target.nodeId === 'accept') throw new DomainError('当前需求已进入 Owner 验收，不再启动开发工作');
    }
    const directory = body.action === 'new' ? plan.directory.root! : plan.history!.directory;
    const contextPath = join(this.directory, 'work-contexts', body.requestId + '.md');
    const context = projectModelContext(await collaborationContext(this.current(), this.data, plan.target));
    const contextJsonPath = join(this.directory, 'work-contexts', body.requestId + '.json');
    await atomicJson(contextJsonPath, context);
    const scopePath = join(this.directory, 'work-contexts', body.requestId + '.scope.json');
    await atomicJson(scopePath, plan.target);
    const command = formatShellCommand([process.execPath, join(root, 'scripts/teams-demo.mjs'), '--endpoint', origin, '--role', role, 'context', 'get', '--input-file', scopePath, '--output', contextJsonPath]);
    const instruction = `首次开展业务时读取 Teams 协作 Skill：${collaborationSkillPath}。当前角色 ${role}，CLI 保留 --role ${role}；获取当前依据：${command}。该命令只打印保存回执，正文读取 ${contextJsonPath}。同版本已读材料不必每轮重读；切换节点按 Skill 获取新节点依据。`;
    const nativeSessionPath = join(this.directory, 'work-contexts', body.requestId + '.native', 'native-session.json');
    const taskInstructions = requirement ? `\n## 本次交互工作范围\n需求正文见结构化上下文 agreement.background。本次进入时所选节点为 ${plan.target.nodeId}；这不是会话整个生命周期的固定节点。先等待开发者的工作指令，仅执行当前节点授权范围，不自动连跑。节点输入、产物与标准以 context.nodeContract 为准；CLI 协作步骤和参数按上述 Skill，不另设一份合同。\n\n实际代码仅可修改本次工作目录 ${directory}，不得修改 Teams 应用工程、原始参考资料、全局 iCode 设置、历史会话或其他任务；不要提交、推送、部署或另行委派 agent。\n\n原生会话身份读取 ${nativeSessionPath}，核对本任务与 runId=${body.requestId}。尚未出现时最多等 15 秒，仍无则报告并停止，不编造或借用历史 ID。开发者明确切节点时保留项目/任务/角色/run/session/tab，使用新 nodeId 获取 ready 输入并独立采用，不复用旧 adoptionId。最终停在待 Owner 验收，不直接改状态文件、绕过 CLI 写 API 或代替 Owner 验收。\n` : '';
    const content = `# ${plan.projectName} · ${plan.title}\n\n工作位置：${plan.location}\n来源：${plan.source}\n\n${plan.context.summary}\n采用版本：${plan.context.versions}\n\n## 工作标识\n${JSON.stringify({ ...plan.target, role, runId: body.requestId, sessionId: body.action === 'new' ? null : plan.history!.sessionId }, null, 2)}\n\n## 项目资料与选择\n${JSON.stringify({...plan.context,selectedSkills:context.skills.map(skill=>skill.id)}, null, 2)}\n\n## 开始工作时读取\n${instruction}\n\n准备时读取的结构化上下文：${contextJsonPath}\n${taskInstructions}\n本文件由 Teams 导出。提供入口不代表 iCode 已读取、采用或完成工作。\n`;
    await atomicText(contextPath, content);
    const receipt: ProjectWorkReceipt = { executionMode: plan.executionMode, requestId: body.requestId, ...(plan.instance.trace ? {trace:plan.instance.trace} : {}), target: plan.target, action: body.action, status: 'prepared', at: new Date().toISOString(), directory, sessionId: body.action === 'new' ? null : plan.history!.sessionId, contextPath, instruction, note: '启动请求已准备；尚未观察到原生会话。' };
    await atomicJson(path, { identity, receipt });
    try {
      if (body.action === 'focus') { const focused = await this.transport.focus(plan.history!); receipt.status = 'terminal-focused'; receipt.note = focused.note; }
      else { const started = await this.transport.start({ directory, terminal: plan.instance.terminal!.id, agent: body.action === 'resume' ? plan.history!.configuration!.agent : plan.instance.agent!, model: body.action === 'resume' ? plan.history!.configuration!.model : plan.instance.model!, ...(receipt.sessionId ? { sessionId: receipt.sessionId } : {}), ...(requirement ? { task: { runId: body.requestId, path: contextPath, scope: { projectId: plan.target.projectId, taskId: requirement.id, nodeId: plan.target.nodeId! },...(plan.history?.prepared?{preparedSession:{...plan.history.prepared,sessionId:plan.history.sessionId}}:{}) } } : {}), instruction }); receipt.status = 'terminal-requested'; if (started && typeof started === 'object' && 'terminal' in started && typeof started.terminal === 'string') receipt.terminal = started.terminal; receipt.note = '已请求 ' + (receipt.terminal ?? '系统终端') + (requirement ? ' 打开交互式 iCode；开发者提交工作指令时附带当前节点上下文入口。终端受理不等于 TUI 已建立、材料已读取或任务已完成。' : ' 打开对应工作目录的 iCode；终端受理不等于模型执行、上下文读取或任务完成。'); }
      await atomicJson(path, { identity, receipt }); return receipt;
    } catch (error) {
      receipt.status = 'uncertain'; receipt.note = '原生请求结果待核对：' + (error as Error).message + '。原请求已保留，不会自动重发或另开会话。'; await atomicJson(path, { identity, receipt }); throw new DomainError(receipt.note);
    }
  }
}
