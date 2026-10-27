import { projectModelContext } from './model-context.js';
import { readTalentNodeInputs } from './talent-node-client.js';
import { checkedNode } from './talent-node-inputs.js';
import { projectMembers } from '../src/teams-domain.js';
import { createTaskSessionStream } from './task-session-stream.js';
import type { TaskSessionStreamQuery } from '../src/task-session-stream.js';
import { assignDeliveryRequirement, createDeliveryRequirement, deliveryRequirement, acceptDeliveryRequirement, returnDeliveryRequirement, requireDeliveryMember } from '../src/delivery-requirements.js';
import { queueTaskCollection, queueTaskPreparation, taskAutomation } from '../src/task-automation.js';
import { TaskAutomationService } from './task-automation.js';
import { TaskPreparationService } from './task-preparation.js';
import { resourcePublicationHistory } from '../src/resource-sharing.js';
import { SkillApplicationService } from './skill-application.js';
import { nativeSkillEnvironment, readInstalledNativeSkill } from './native-skill-reader.js';
import { getPublishedSkillPackage, publicationCatalog, loadNativeSkillPackage } from './skill-packages.js';
import { resolveProjectWork } from './project-work.js';
import { join } from 'node:path';
import { terminalPreferences } from './terminal-preferences.js';
import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { root, runtimeDir, port, origin, talentOrigin, materialRoot } from './config.js';
import { Store } from './store.js';
import { DomainError, type Action, type Role } from '../src/domain.js';
import { toolsStatus, writeContext, foundationSkill, launch } from './native.js';
import { locateChrysEngine } from './engine-locate.js';
import { createSourcePluginCatalog } from '../src/source-plugins.js';
import { updateWorkspace, type WorkspaceAction } from '../src/workspace.js';
import { headers, bodyJson, staticFile, readFixtures } from './http-shared.js';
import { exportTeamsSnapshot, knowledgeVersion, projectKnowledge, projectSkillVersions, readTalentsFile } from './shared-data.js';
import { transition } from '../src/domain.js';
import { isTraceApi, proxyTrace, startTraceService, stopTraceService } from './trace-service.js';
import { ProjectWorkService } from './project-work.js';
import { collaborationContext, collaborationOperation, collaborationWrite } from './collaboration-service.js';
const store = new Store(); await store.init();
const token = randomBytes(24).toString('hex');
const fixtures = await readFixtures();
const work = new ProjectWorkService(() => store.state, fixtures);
const taskSessionStream = createTaskSessionStream(runtimeDir);
const sourceCatalog = createSourcePluginCatalog(fixtures);
let exporting: Promise<unknown> = Promise.resolve();
/** Exports run one after another so an older snapshot never overwrites a newer one. */
const exportSnapshot = () => (exporting = exporting.catch(() => undefined).then(() => exportTeamsSnapshot(store.state, fixtures, sourceCatalog)));
/** Talents publishing knowledge for the card project counts as "project knowledge built" in the delivery flow. */
async function syncKnowledge() {
  try {
    const version = knowledgeVersion(await projectKnowledge('carddemo'));
    if (version && version !== store.state.knowledgeVersion) await store.transact(state => version === state.knowledgeVersion ? state : transition(state, 'knowledge', 'owner', { knowledgeVersion: version }));
  } catch (error) { console.error('同步 Talents 项目知识失败：' + (error as Error).message); }
}
await exportSnapshot();
const taskAutomationService = new TaskAutomationService(store, fixtures, undefined, exportSnapshot);
const taskPreparationService=new TaskPreparationService(store,fixtures,{prepareSession:(assigneeId,scope,id)=>work.prepare(assigneeId,scope,id)},exportSnapshot);
const skillApplications = new SkillApplicationService({
  package: (role,scope) => getPublishedSkillPackage(store.state,role,scope.resourceId,scope.version,scope.sha256),
  async directory(role,projectId) {
    const project=resolveProjectWork(store.state,fixtures,{projectId,tab:'content'});
    const native=await nativeSkillEnvironment();
    return {name:project.projectName,root:native.skillsDirectory,valid:true,diagnostic:''};
  },
  discover: readInstalledNativeSkill,
},join(runtimeDir,'skill-applications'));
const server = createServer(async (request, response) => {
  headers(request, response);
  const json = (code: number, value: unknown) => {
    if (request.method === 'POST' && code === 200) exportSnapshot().catch(error => console.error('Teams 共享数据导出失败：' + error.message));
    response.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value));
  };
  try {
    if (request.headers.host !== '127.0.0.1:' + port) { json(403, { error: '请使用本机 127.0.0.1 地址' }); return; }
    const url = new URL(request.url ?? '/', origin), path = url.pathname;
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    if (request.method === 'GET' && ['/talent', '/talents'].includes(path)) { response.writeHead(302, { Location: talentOrigin + '/talents' + url.search }); response.end(); return; }
    if (request.method === 'GET' && path === '/api/session') { json(200, { token }); return; }
    if (request.method === 'GET' && path === '/api/health') { json(200, { app: 'teams-talent-carddemo', service: 'teams', workspaceRoot: root, stateRoot: runtimeDir, version: '0.2.0', pid: process.pid, origin, talentOrigin }); return; }
    if (request.method === 'GET' && path === '/api/bootstrap') { await syncKnowledge(); json(200, { token, state: store.state, data: fixtures }); return; }
    if (request.method === 'GET' && path === '/api/state') { await syncKnowledge(); json(200, store.state); return; }
    if (request.method === 'GET' && path === '/api/task-node-inputs') {
      const projectId=url.searchParams.get('projectId')??'',taskId=url.searchParams.get('taskId')??'',role=url.searchParams.get('role');
      if(!['owner','member'].includes(role??''))throw new DomainError('请选择角色',400);
      if(projectId!=='teams'&&!projectMembers(store.state,projectId).some(member=>member.id===role&&member.status==='active'))throw new DomainError('无权读取此项目',403);
      json(200,await readTalentNodeInputs(store.state,fixtures,{projectId,taskId,nodeId:checkedNode(url.searchParams.get('nodeId')??'')}));return;
    }
    if (request.method === 'GET' && path === '/api/task-session-stream') {
      const {role,...query}=Object.fromEntries(url.searchParams);
      if(role!=='owner'&&role!=='member')throw new DomainError('请选择角色',400);
      json(200,await taskSessionStream(store.state,role,query as unknown as TaskSessionStreamQuery));return;
    }
    if (request.method === 'GET' && path === '/api/talents/knowledge') { const project = url.searchParams.get('project') ?? 'carddemo'; json(200, { talentsOrigin: talentOrigin, artifacts: await projectKnowledge(project), skills: await projectSkillVersions(project) }); return; }
    if (request.method === 'GET' && path === '/api/talents/file') { json(200, await readTalentsFile(url.searchParams.get('artifact') ?? '', Number(url.searchParams.get('version')), url.searchParams.get('path') ?? '')); return; }
    if (request.method === 'GET' && path === '/api/project-work') {
      const { role, ...target } = Object.fromEntries(url.searchParams);
      if (role !== 'owner' && role !== 'member') throw new DomainError('请选择角色', 400);
      json(200, await work.plan(role, target as any)); return;
    }
    if (request.method === 'GET' && path === '/api/collaboration/context') {
      const role=url.searchParams.get('role')??'member',projectId=url.searchParams.get('projectId')??'';
      if(!['owner','member'].includes(role))throw new DomainError('请选择角色',400);
      if(projectId!=='teams'&&!projectMembers(store.state,projectId).some(member=>member.id===role&&member.status==='active'))throw new DomainError('无权读取此项目',403);
      const view=url.searchParams.get('view')??'full';if(!['full','model'].includes(view))throw new DomainError('上下文视图无效',400);
      const context=await collaborationContext(store.state, fixtures, Object.fromEntries(url.searchParams));json(200,view==='model'?projectModelContext(context):context); return;
    }
    if (request.method === 'GET' && path === '/api/collaboration/operation') { json(200, collaborationOperation(store.state, url.searchParams.get('operationId') ?? '')); return; }
    if (request.method === 'GET' && path === '/api/resource-content') {
      const {role,resourceId,version,sha256}=Object.fromEntries(url.searchParams);
      if(!['owner','member'].includes(role))throw new DomainError('请选择角色',400);
      if(!resourcePublicationHistory(store.state).some(record=>record.id===resourceId&&record.version===version&&record.sha256===sha256))throw new DomainError('固定发布版本不存在',404);
      const pkg=await loadNativeSkillPackage(resourceId,version,sha256),primary=pkg.files.find(file=>file.path==='SKILL.md')!;
      json(200,{version:pkg.version,sha256:pkg.sha256,contentSha256:primary.sha256,content:primary.bytes.toString('utf8')});return;
    }
    if (request.method === 'GET' && path === '/api/skill-application') {
      const {role,...scope}=Object.fromEntries(url.searchParams);
      if(role!=='owner'&&role!=='member')throw new DomainError('请选择角色',400);
      json(200,await skillApplications.plan(role,scope as any));return;
    }
    if (request.method === 'GET' && path === '/api/tools') { json(200, await toolsStatus()); return; }
    if (request.method === 'GET' && path === '/api/engine/locate') { json(200, await locateChrysEngine({ materialRoot })); return; }
    if (request.method === 'POST' && path.startsWith('/api/')) {
      if (request.headers.origin !== origin || request.headers['x-demo-token'] !== token || !request.headers['content-type']?.startsWith('application/json')) {
        json(403, { error: '请求来源或访问令牌不匹配，请重新打开页面' }); return;
      }
      const body = await bodyJson(request);
      if (!body || !['owner', 'member'].includes(body.role)) throw new DomainError('请选择角色', 400);
      if (path === '/api/action' && body.action === 'knowledge') throw new DomainError('项目知识由 Talents 发布后自动同步', 400);
      if (path === '/api/action' && ['candidate', 'evaluate', 'release', 'adopt'].includes(body.action)) throw new DomainError('能力演进已迁移到 Talents', 400);
      if (path === '/api/action') {
        const state = await store.apply(body.revision, body.action as Action, body.role as Role, { reason: body.reason, assigneeId: body.assigneeId });
        json(200, state);
        if (body.action === 'accept') void taskAutomationService.collect().catch(error => console.error('验收已保存，自动归集未完成：' + error.message));
        return;
      }
      if(path==='/api/delivery-requirements') {
        const at=new Date().toISOString();
        const saved=await store.transact(current=>{
          const next=structuredClone(current);let detail='';
          if(body.action==='create'&&deliveryRequirement(current,body.input?.projectId,body.input?.id)){createDeliveryRequirement(next,body.role,body.input,at);return current;}
          if(body.revision!==current.revision)throw new DomainError('另一页面已更新数据，请刷新后重试',409);
          if(body.action==='create'){const task=createDeliveryRequirement(next,body.role,body.input,at);if(task.skillIds.some(id=>!fixtures.skillCatalog.some((item:{id:string})=>item.id===id)))throw new DomainError('所选Skill未登记');queueTaskPreparation(next,{projectId:task.projectId,taskId:task.id},at);detail=task.id+' · '+task.title;}
          else if(body.action==='assign'){const task=assignDeliveryRequirement(next,body.role,body.input,at);queueTaskPreparation(next,{projectId:task.projectId,taskId:task.id},at);detail=task.id+' · '+(task.assigneeId||'待分配');}
          else {const task=deliveryRequirement(next,body.projectId,body.taskId);if(!task)throw new DomainError('交付需求不存在',404);
            if(body.action==='accept'){acceptDeliveryRequirement(next,body.role,task,at);queueTaskCollection(next,{projectId:task.projectId,taskId:task.id},at);}
            else if(body.action==='return')returnDeliveryRequirement(body.role,task,body.reason,at);
            else throw new DomainError('未知需求操作');detail=task.id+' · '+body.action;}
          next.revision++;next.audit.push({id:next.revision,at,role:body.role,system:'Teams',action:body.action==='create'?'创建交付需求':body.action==='assign'?'分配交付需求':body.action==='accept'?'Owner验收通过':'Owner退回补充',detail,origin:'simulated'});return next;
        });json(200,saved);
        if(['create','assign'].includes(body.action))void taskPreparationService.schedule({projectId:body.input.projectId,taskId:body.action==='create'?body.input.id:body.input.taskId}).catch(error=>console.error('自动准备未完成：'+error.message));
        if(body.action==='accept')void taskAutomationService.collect({projectId:body.projectId,taskId:body.taskId}).catch(error=>console.error('需求验收已保存，自动收集未完成：'+error.message));return;
      }
      if (path === '/api/task-automation') {
        const scope = { projectId: body.projectId, taskId: body.taskId };
        if(body.step==='node-knowledge'){if(!['prepare','develop','verify'].includes(body.nodeId))throw new DomainError('知识获取节点无效',400);json(200,await taskPreparationService.retryNode(body.role,scope,body.nodeId));}
        else if(body.step==='preparation')json(200,await taskPreparationService.retry(body.role,scope));
        else if(body.step==='knowledge'&&taskAutomation(store.state,scope)?.preparation){if(body.retry===true)json(200,await taskPreparationService.retry(body.role,scope));else{const task=deliveryRequirement(store.state,scope.projectId,scope.taskId);if(!task)throw new DomainError('需求不存在',404);requireDeliveryMember(store.state,task,body.role);json(200,store.state);}}
        else if (body.step === 'knowledge') json(200, await taskAutomationService.prepare(body.role, scope, body.retry === true));
        else if (body.step === 'collection' && body.role === 'owner') json(200, await taskAutomationService.collect(scope, body.retry === true));
        else throw new DomainError('自动步骤或角色无效',403);
        return;
      }
      if(path==='/api/workspace'){
        if (body.kind === 'analysis.run') throw new DomainError('轨迹分析已迁移到 Talents', 400);
        if(!body.payload || typeof body.payload!=='object' || Array.isArray(body.payload))throw new DomainError('工作区请求格式无效',400);
        if(['resource.publish','resource.publish-all'].includes(body.kind)){
          if(body.role!=='owner')throw new DomainError('仅 Owner 可以发布资源',403);
          if(body.revision!==store.state.revision)throw new DomainError('状态已变化，请刷新后重试',409);
        }
        if(body.kind==='issue.create'){const saved=await store.transact(current=>{const next=updateWorkspace(current,'issue.create',body.role,body.payload);if(next===current)return current;if(body.revision!==current.revision)throw new DomainError('另一页面已更新数据，请刷新后重试',409);return next;});json(200,saved);return;}
        json(200,await store.update(body.revision,body.kind as WorkspaceAction,body.role as Role,body.payload,sourceCatalog.list(),['resource.publish','resource.publish-all'].includes(body.kind)?await publicationCatalog():[]));return;
      }
      if (path === '/api/reset') {
        if (body.role !== 'owner') throw new DomainError('仅 Owner 可以重置工作区', 403);
        json(200, await store.reset(body.revision)); return;
      }
      if (path === '/api/collaboration') { json(200, await collaborationWrite(store, fixtures, body)); if(body.kind==='result.submit'){const node=body.input?.nodeId==='prepare'?'develop':body.input?.nodeId==='develop'?'verify':null;if(node)void taskPreparationService.scheduleNode({projectId:body.input.projectId,taskId:body.input.taskId},node).catch(error=>console.error('后续节点知识获取未完成：'+error.message));}return; }
      if (path === '/api/native/skill-apply') { if(process.env.DEMO_NATIVE_DISABLED==='1')throw new DomainError('此验证实例未开放原生用户目录写入',403); json(200,await skillApplications.apply(body.role,{projectId:body.projectId,resourceId:body.resourceId,version:body.version,sha256:body.sha256,requestId:body.requestId,planToken:body.planToken}));return; }
      if (path === '/api/native/terminal') { json(200, await terminalPreferences.select(body.terminal)); return; }
      if (path === '/api/native/work-bind') { json(200, await work.bind(body.role, body.target, body.directory)); return; }
      if (path === '/api/native/work-start') { json(200, await work.start(body.role, { requestId: body.requestId, target: body.target, action: body.action, planToken: body.planToken })); return; }
      if (path === '/api/native/context') { json(200, await writeContext(store.state)); return; }
      if(path==='/api/native/foundation'){json(200,await foundationSkill());return;}
      if (path === '/api/native/launch') {
        if (process.env.DEMO_NATIVE_DISABLED === '1') throw new DomainError('此验证实例未开放本机启动', 403);
        if (!['icode', 'opencode'].includes(body.tool) || typeof body.restore !== 'boolean' || typeof body.requestId !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(body.requestId)) throw new DomainError('启动请求无效', 400);
        json(200, await launch(body.tool, body.restore, body.requestId, body.terminal)); return;
      }
      throw new DomainError('接口不存在', 404);
    }
    if (request.method === 'GET' && await staticFile(path, 'teams', response)) return;
    if (request.method === 'GET' && isTraceApi(path)) { await proxyTrace(path, url.search, response); return; }
    json(404, { error: '页面不存在' });
  } catch (error) {
    const status = error instanceof DomainError ? error.status : 500;
    json(status, { error: error instanceof Error ? error.message : '请求失败' });
  }
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; stopTraceService(); });
server.listen(port, '127.0.0.1', async () => {
  await mkdir(runtimeDir, { recursive: true });
  taskPreparationService.resumeQueued();
  console.log('Teams: ' + origin + '/teams');
  console.log('Talents: ' + talentOrigin + '/talents（独立启动）');
  if(process.env.DEMO_NATIVE_DISABLED!=='1')startTraceService().then(
    () => console.log('Trace 查询服务: /trace-monitor/'),
    error => console.error('Trace 查询服务未启动：' + (error instanceof Error ? error.message : String(error))),
  );
});
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => { stopTraceService(); server.close(() => process.exit(0)); });
