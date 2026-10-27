import { createProjectIssue, type ProjectIssue } from './project-issues.js';
import { deliveryRequirement, type DeliveryRequirement } from './delivery-requirements.js';
import { userSkillExamples } from './project-skill-examples.js';
import { selectedSkillBindings } from './resource-sharing.js';
import { updateTeam, requireTeamOwner, defaultTeamId, type TeamRecord, type TeamMember } from './teams-domain.js';
import { requireCurrentTaskMember } from './task-assignment.js';
import { linkTaskSession, type TaskAutomation } from './task-automation.js';
import { updateGenericTask, type GenericTask } from './generic-tasks.js';
import { campaign } from './cashback.js';
import { availableSkillIdsFor, projectSkillIds, resourcePublications, resourcePublicationHistory, resourceSubscriptions, resourceVersion, shareableResourceIds, type ResourcePublication, type ResourceSubscription, type SkillCatalogEntry } from './resource-sharing.js';
import { externalPlatformDefault } from './external-platforms.js';
import { DomainError, type DemoState, type Role } from './domain.js';
import { createdProjectFields, createdProjectId, type CreatedProject } from './created-projects.js';
import type { SourcePluginAsset } from './source-plugins.js';
import { legacyAssetSourceIds } from './project-asset-links.js';
import type { CollaborationState } from './collaboration.js';

export interface Asset { id: string; title: string; kind: string; location: string; sourceAssetId?: string }
export interface Material { id: string; title: string; body: string }
export interface WorkspaceState {
  projectIssues?: ProjectIssue[];
  deliveryRequirements?: DeliveryRequirement[];
  teams?: TeamRecord[];
  projectTeamId?: string;
  genericTasks?: GenericTask[];
  taskAutomation?: TaskAutomation[];
  collaboration?: CollaborationState;
  acquiredResources: string[];
  resourcePublications?: ResourcePublication[];
  resourceSubscriptions?: ResourceSubscription[];
  projects?: CreatedProject[];
  project: { name: string; description: string; repository: string; assets: Asset[] };
  materials: Material[]; selectedSkills: string[];
  progress: { id: string; text: string; at: string; node: string }[];
  sessionReported: boolean; reportAt: string | null;
  analysis: { scope: 'single' | 'project'; status: 'idle' | 'analyzed' };
  team: { name: string; members: TeamMember[] };
  connections: { id: string; name: string; kind: string; enabled: boolean; description: string }[];
  foundation: { progressEnabled: boolean; uploadEnabled: boolean };
}
export const defaultSkills = projectSkillIds;
export function initialWorkspace(): WorkspaceState {
  return {
    acquiredResources:[],project: { name: 'Credit Card', description: '针对白金卡客户未来 3 个月的消费，额外增加 0.5% 的消费返现。', repository: 'carddemo-java-1025', assets: [
      { id:'code',title:'白金卡返现规则',kind:'repository',location:'teams/src/cashback.ts',sourceAssetId:'repository:carddemo:carddemo-java-1025' },
      { id:'design',title:'消费返现规则',kind:'document',location:'teams/docs/cashback-contract.md',sourceAssetId:'design-library:carddemo:marketing-capability' },

      { id:'history',title:'白金卡消费返现需求',kind:'requirement',location:'requirements:carddemo:DEMO-MKT-001' },
      { id:'adr',title:'交易处理边界',kind:'document',location:'workspace/carddemo-java-1025/docs/design/adr/ADR-009-marketing-integration.md',sourceAssetId:'design-library:carddemo:ADR-009' },
      { id:'security',title:'权限与安全范围',kind:'document',location:'workspace/carddemo-java-1025/docs/design/adr/ADR-007-authentication-scope.md',sourceAssetId:'design-library:carddemo:ADR-007' },
    ] }, materials: [], selectedSkills: [...defaultSkills], progress: [], sessionReported:false, reportAt:null,
    analysis:{scope:'single',status:'idle'}, foundation:{progressEnabled:true,uploadEnabled:true},
    team:{ name:'信用卡研发团队',members:[['owner','林悦'],['member','陈晨'],['su','苏晴'],['yang','杨帆'],['zhao','赵宁'],['wang','王晓']].map(([id,name])=>({id,name,role:id==='owner'?'owner':'member',status:'active'})) },
    connections: [
      ['repository','代码仓与项目资产','asset','关联当前返现规则与项目代码。'],['requirements','需求与文档','asset','关联项目需求和设计资料。'],
      ['review','代码 Review','quality','检查业务状态、变更影响与事务边界，保留问题与修复依据。'],['test','测试与复测','quality','保留真实退出码、测试范围及结构化报告。'],
      ['security','安全扫描','quality','尚未提供安全扫描报告，需接入报告后核验。'],['model','组织模型服务','model','展示团队模型使用要求，真实凭据由原生工具管理。'],
      ['mcp','工具与 MCP','tool','按工具声明能力和权限，成员通过 iCode 调用。'],
    ].map(([id,name,kind,description])=>({id,name,kind,description,enabled:true})),
  };
}
export const workspaceActions = ['issue.create','session.link','task.create','task.assign','task.start','task.complete','project.create','project.metadata.update','project.update','asset.link','asset.add','material.add','skills.select','resource.publish','resource.publish-all','resource.acquire','team.create','team.project.assign','team.update','member.invite','member.approve','member.role','member.remove','progress.sync','session.report','analysis.run','connection.update','foundation.update'] as const;
export type WorkspaceAction = typeof workspaceActions[number];
const ownerActions: WorkspaceAction[] = ['issue.create','task.create','task.assign','project.create','project.metadata.update','resource.publish','resource.publish-all','project.update','asset.link','asset.add','team.create','team.project.assign','team.update','member.invite','member.approve','member.role','member.remove','analysis.run','connection.update'];
const memberActions: WorkspaceAction[] = ['material.add','skills.select','progress.sync','session.report'];
function need(ok:unknown,message:string):asserts ok { if(!ok)throw new DomainError(message); }
function text(p:Record<string,unknown>,key:string,max=1000){ const value=p[key];need(typeof value==='string'&&value.trim().length>0&&value.length<=max,`${key} 不能为空或超出长度`);return value.trim(); }
export function updateWorkspace(previous:DemoState,kind:WorkspaceAction,role:Role,p:Record<string,unknown>,sourceAssets:readonly SourcePluginAsset[]=[],catalog:readonly SkillCatalogEntry[]=[]):DemoState {
  need(workspaceActions.includes(kind),'未知工作区操作');
  need(previous.campaignId === campaign.id, '当前工作区使用旧活动规则，请由 Owner 在个人设置中重置工作区后继续');
  if(ownerActions.includes(kind)&&role!=='owner'||memberActions.includes(kind)&&role!=='member')throw new DomainError('当前角色无权执行此操作',403);
  if (previous.assigned && role === 'member' && ['progress.sync','skills.select','material.add'].includes(kind)) requireCurrentTaskMember(previous);
  const s=structuredClone(previous),w=s.workspace,at=new Date().toISOString(),id='demo-'+(s.revision+1);
  const writableAssets = () => {
    const projectId = p.projectId ?? 'carddemo';
    need(projectId !== 'teams', '导入项目快照为只读');
    if (projectId === 'carddemo') return w.project.assets;
    const project = w.projects?.find(item => item.id === projectId); need(project, '项目不存在');
    return project.assets ??= [];
  };
  let label='';
  switch(kind){
    case 'issue.create': {const before=w.projectIssues?.length??0;createProjectIssue(s,role,p,at);if(w.projectIssues!.length===before)return previous;label='新建问题';break;}
    case 'session.link': linkTaskSession(s,role,p,at);label='关联任务工作会话';break;
    case 'task.create': case 'task.assign': case 'task.start': case 'task.complete': label=updateGenericTask(s,role,kind,p,at);break;
    case 'project.create': {const projectId=createdProjectId(p.id),fields=createdProjectFields(p);need(!w.projects?.some(project=>project.id===projectId),'项目标识已存在');w.projects=[...(w.projects??[]),{id:projectId,...fields,teamId:requireTeamOwner(s,role,p.teamId===undefined?defaultTeamId:text(p,'teamId',100)).id,owner:'owner',createdAt:at,updatedAt:at}];label='添加项目';break;}
    case 'project.metadata.update': {const projectId=createdProjectId(p.id),fields=createdProjectFields(p),project=w.projects?.find(item=>item.id===projectId);need(project,'自建项目不存在');Object.assign(project,fields,{updatedAt:at});label='更新自建项目信息';break;}
    case 'project.update': w.project.name=text(p,'name',80);w.project.description=text(p,'description',1500);w.project.repository=text(p,'repository',200);label='更新项目信息';break;
    case 'asset.link': {
      const assets=writableAssets(),source=sourceAssets.find(asset=>asset.id===p.sourceAssetId);
      need(source,'来源资产不存在'); need((p.projectId??'carddemo')!=='carddemo'||source.sourceProjectId==='carddemo','请选择本项目的来源资产');
      need(!w.connections.some(connection=>connection.id===source.pluginId&&!connection.enabled),'请先启用该来源插件');
      need(assets.length<50,'项目资产数量已达上限'); need(!assets.some(asset=>legacyAssetSourceIds(asset).includes(source.id)),'该来源资产已关联');
      assets.push({id,title:source.title,kind:source.kind,location:source.references.map(reference=>reference.path).join(' · ')||source.sourceRecordId,sourceAssetId:source.id});label='关联插件来源资产';break;
    }
    case 'asset.add': {const assets=writableAssets();need(assets.length<50,'项目资产数量已达上限');assets.push({id,title:text(p,'title',120),kind:text(p,'kind',40),location:text(p,'location',500)});label='关联项目资产';break;}
    case 'material.add': need(!s.context,'上下文已冻结，请在下一次任务中采用新增材料');need(w.materials.length<20,'材料数量已达上限');w.materials.push({id,title:text(p,'title',120),body:text(p,'body',5000)});label='补充需求材料';break;
    case 'skills.select': {const allowed=availableSkillIdsFor(s,role),task=deliveryRequirement(s,'carddemo','DEMO-MKT-001');need(task?!task.preparedAt:!s.context,'本次上下文已冻结');need(Array.isArray(p.skills)&&p.skills.length>0&&p.skills.length<=allowed.length&&p.skills.every(x=>typeof x==='string'&&allowed.includes(x)),'请选择有效的项目或用户 Skill；外部 Skill 需由当前用户订阅');w.selectedSkills=[...new Set(p.skills as string[])];if(task){task.userSkillIds=w.selectedSkills.filter(id=>userSkillExamples.some(skill=>skill.id===id));task.skillIds=w.selectedSkills.filter(id=>!task.userSkillIds!.includes(id));task.skillBindings=selectedSkillBindings(s,role);const preparation=w.taskAutomation?.find(item=>item.projectId==='carddemo'&&item.taskId===task.id)?.knowledge;if(preparation){preparation.status='waiting';preparation.error='选用 Skill 已改变，请重新检查任务输入';}}label='选择需求业务 Skill';break;}
    case 'resource.publish':
    case 'resource.publish-all': {
      const ids=kind==='resource.publish-all'?catalog.map(item=>item.id):[text(p,'id',120)];
      need(kind!=='resource.publish-all'||ids.length===shareableResourceIds.length-1&&new Set(ids).size===ids.length,'完整 Skill 发布目录尚未就绪');
      let added=0;
      for(const resourceId of ids){
        need(shareableResourceIds.includes(resourceId),'该资源不在可共享范围');
        const entry=catalog.find(item=>item.id===resourceId);
        need(resourceId==='code-agent'||entry&&/^[a-f0-9]{64}$/.test(entry.sha256)&&/^[a-f0-9]{64}$/.test(entry.contentSha256),'资源内容包尚未就绪');
        const version=entry?.version??resourceVersion(s,resourceId);
        need(p.version===undefined||p.version===version,'请求的资源版本没有对应内容包');
        const existing=resourcePublicationHistory(s).filter(item=>item.id===resourceId&&item.version===version);
        need(!existing.some(item=>item.sha256&&item.sha256!==entry?.sha256),'相同版本的内容已变化，请使用新的真实版本');
        if(existing.some(item=>resourceId==='code-agent'||item.sha256===entry?.sha256)){need(kind==='resource.publish-all','该资源版本已发布');continue;}
        const publication:ResourcePublication={id:resourceId,version,publishedAt:at,scope:'team',publisher:entry?.publisher??'owner',publisherName:entry?.publisherName??'林悦',source:entry?.source??'project-agent-configuration',...(entry?{sha256:entry.sha256,contentSha256:entry.contentSha256}:{})};
        w.resourcePublications=[...(w.resourcePublications??[]),publication];added++;
      }
      if(!added)return previous;
      label=kind==='resource.publish-all'?'发布全部 Skill':'发布共享资源';break;
    }
    case 'resource.acquire': {
      const name=text(p,'name',120),existing=resourceSubscriptions(s,role).find(item=>item.id===name);
      const publication=p.version===undefined?resourcePublications(s).find(item=>item.id===name):[...resourcePublicationHistory(s)].reverse().find(item=>item.id===name&&item.version===p.version);
      need(publication,'请获取已发布的共享资源');need(name==='code-agent'||publication.sha256&&publication.contentSha256,'历史订阅尚未核实内容包，请先发布对应真实版本');
      need(p.sha256===undefined||p.sha256===(publication.sha256??''),'请求的资源内容哈希不匹配');
      if(existing?.source==='subscription'){need(existing.version===publication.version&&existing.sha256===(publication.sha256??''),'当前订阅已固定旧版本；发布新版不会自动替换');return previous;}
      w.resourceSubscriptions=[...(w.resourceSubscriptions??[]),{id:name,version:publication.version,sha256:publication.sha256??'',contentSha256:publication.contentSha256,actor:role,subscribedAt:at,source:'subscription'}];label='订阅共享资源';break;
    }
    case 'team.create': case 'team.project.assign': case 'team.update': case 'member.invite': case 'member.approve': case 'member.role': case 'member.remove': label=updateTeam(s,role,kind,p,at);break;
    case 'progress.sync': need(!deliveryRequirement(s,'carddemo','DEMO-MKT-001'),'开发与验证进度请通过当前任务 Teams CLI 回传');need(w.foundation.progressEnabled,'请先启用团队协作进度同步能力');need(s.context&&['developing','failed','fixed','returned'].includes(s.stage),'请先开始 iCode 开发作业');w.progress.push({id,text:text(p,'text',2000),at,node:'develop'});label='iCode 进度同步';break;
    case 'session.report': throw new DomainError('会话在开发或验证期间关联；验收通过后自动归集，无需成员再次上报');
    case 'analysis.run': need(w.sessionReported,'请先上报并关联交付会话');need(p.scope==='single'||p.scope==='project','分析范围无效');need(s.evolution==='none','已有改进候选，请保留本次分析依据');w.analysis={scope:p.scope,status:'analyzed'};label=p.scope==='project'?'项目多需求分析':'单需求轨迹分析';break;
    case 'connection.update': {let c=w.connections.find(c=>c.id===p.id);if(!c&&typeof p.id==='string'){const seeded=externalPlatformDefault(p.id);if(seeded){c=w.connections.find(connection=>connection.id===seeded.id);if(!c){c=seeded;w.connections.push(c);}}}need(c,'连接不存在');need(typeof p.enabled==='boolean','启用状态无效');c.enabled=p.enabled;c.description=text(p,'description',1500);label=externalPlatformDefault(c.id)?'更新企业连接配置':'更新能力配置';break;}
    case 'foundation.update': need(typeof p.progressEnabled==='boolean'&&typeof p.uploadEnabled==='boolean','基础能力配置无效');w.foundation={progressEnabled:p.progressEnabled,uploadEnabled:p.uploadEnabled};label='更新基础协作配置';break;
  }
  s.revision++;s.audit.push({id:s.revision,at,role,system:kind==='analysis.run'?'Talent':'Teams',action:label,detail:kind==='progress.sync'?String(p.text):kind==='resource.publish'?String(p.id)+' · '+resourceVersion(s,String(p.id)):kind==='resource.acquire'?String(p.name):label,origin:'simulated'});return s;
}
