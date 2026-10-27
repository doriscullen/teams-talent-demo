import { projectDeliveryTasks } from '../project-delivery-tasks.js';
import { taskExecutableBy } from '../task-visibility.js';
import { type RequirementNode } from '../delivery-requirements.js';
import { deliveryNodeLabels } from '../components/task-delivery-layout.js';
import { DeliveryTaskSidebar, type DeliveryTaskListItem } from '../components/delivery-task-sidebar.js';
import { LiveTaskDelivery } from '../components/live-task-delivery.js';
import { TaskExecutionRecords } from '../components/task-execution-records.js';
import { ImportedTaskDelivery } from '../components/imported-task-delivery.js';
import { importedSelectedStage, importedStage } from '../imported-delivery.js';
import { ProjectTaskManagement } from '../components/project-task-management.js';
import { displayText } from '../display-text.js';
import { useEffect, useState } from 'react';
import { Alert, Button, Descriptions, Drawer, Empty, Space, Table, Tag } from 'antd';
import { ArrowRightOutlined, FileTextOutlined } from '@ant-design/icons';
import { useDemo } from '../context.js';
import { FrameworkCard } from '../vendor/teams/components/page-layout.js';
import { Mono } from '../components/common.js';
import { ProjectToolbar, projectPages as tabs } from '../components/project-toolbar.js';
import { ProjectContentTemplate } from '../components/project-content-template.js';
import { ProjectAssets } from '../components/project-assets.js';
import { ProjectKnowledge } from '../components/project-knowledge.js';
import { ProjectWorkLaunch } from '../components/project-work-launch.js';
import '../teams-project.css';

const sourceTag = <Tag color="blue">Teams 项目记录</Tag>;
const teamRoute = (tab:string, extra:Record<string,string>={}) => 'projects?'+new URLSearchParams({project:'teams',tab,...extra}).toString();
const memberName = (id:string) => id==='U'?'待分配':'成员 '+id;

export function TeamsProjectCard() {
  const {state,data,role,navigate}=useDemo(),s=data.teamsProject,p=s.project;
  return <FrameworkCard title={p.name} action={sourceTag}><p>{displayText(p.description)}</p><Descriptions size="small" column={2} items={[{key:'team',label:'所属团队',children:'Teams 开发团队'},{key:'owner',label:'项目 Owner',children:memberName(p.owner)},{key:'repo',label:'主仓',children:p.repos[0].name},{key:'scope',label:'项目数据',children:(s.tasks.length + projectDeliveryTasks(state, 'teams', role).length)+' 个任务 · '+s.releases.length+' 个版本'}]} /><Space wrap><Button type="primary" data-project-primary="teams" aria-label={(role==='owner'?'进入任务管理：':'进入任务交付：')+p.name} onClick={()=>navigate(teamRoute(role==='owner'?'management':'delivery'))}>{role==='owner'?'进入任务管理':'进入任务交付'}</Button><Button onClick={()=>navigate(teamRoute('content'))}>项目资料</Button>{role==='owner'&&<Button onClick={()=>navigate(teamRoute('delivery'))}>交付与验收</Button>}</Space></FrameworkCard>;
}

export function TeamsProject({params}:{params:URLSearchParams}) {
  const {state,data,role,navigate,showText}=useDemo(),s=data.teamsProject,p=s.project;
  const tab=params.get('tab')??'content';
  const [sessions,setSessions]=useState(false);
  const localTasks = projectDeliveryTasks(state, 'teams', role);
  const selectedId = params.get('task') ?? localTasks.find(task => taskExecutableBy(role, task.assigneeId))?.id ?? s.selection.taskId;
  const localTask = localTasks.find(task => task.id === selectedId);
  const localNode = params.get('node') ?? localTask?.node ?? 'prepare';
  const validLocalNode = Object.hasOwn(deliveryNodeLabels, localNode);
  const selectedTask = s.tasks.find(task => task.id === selectedId);
  const sidebarItems: DeliveryTaskListItem[] = [
    ...localTasks,
    ...s.tasks.map(task => ({ id: task.id, title: task.title, owner: memberName(task.owner), status: task.status, accepted: task.status === '已验收', route: teamRoute('delivery', { task: task.id, node: importedSelectedStage(task, null, task.id === s.selection.taskId ? s.selection.nodeId : undefined)! }) })),
  ];
  const selectedStage = selectedTask ? importedSelectedStage(selectedTask, params.get('node'), selectedTask.id === s.selection.taskId ? s.selection.nodeId : undefined) : undefined;
  const sourceStage = selectedTask && selectedStage ? importedStage(selectedTask, selectedStage) : undefined;
  const sourceWorkNode = selectedTask?.nodes.find(node => node.id === params.get('node')) ?? sourceStage?.primary;
  const visibleSessions = tab === 'delivery' ? s.sessions.filter(session => session.target.task === selectedTask?.id && sourceStage?.nodes.some(node => node.id === session.target.node)) : s.sessions;
  useEffect(() => setSessions(false), [tab, selectedId, selectedStage, localNode, role]);
  const document=(path:string)=>{const doc=s.documents.find(d=>d.path===path);showText(path,doc?.content??'本次导入未包含该文件。');};
  const jump=(tab:string,extra:Record<string,string>={})=>navigate(teamRoute(tab,extra));
  if(!tabs.some(t=>t.key===tab))return <Alert type="error" title="iCode Teams 项目页面不存在" action={<Button onClick={()=>jump('content')}>进入项目概览</Button>}/>;
  return <div className="page-stack teams-imported-project project-detail">
    <ProjectToolbar activeKey={tab} onChange={value=>jump(value)} actions={<>
      {localTask && tab === 'delivery' ? <Tag>Teams 需求</Tag> : sourceTag}
      <Button type="text" icon={<FileTextOutlined/>} aria-label="数据来源" title="数据来源" onClick={()=>showText('导入来源与文件清单','原 Teams 项目数据\n保留原项目的成员 A / B / C、任务与版本关系。当前浏览项目导入记录。\n\n'+JSON.stringify({commit:s.sourceCommit,importedAt:s.importedAt,files:s.sourceFiles},null,2))}><span className="project-secondary-action-label">数据来源</span></Button>
      {localTask?.record ? <TaskExecutionRecords key={selectedId + ':' + role} task={localTask.record} /> : selectedTask || tab !== 'delivery' ? <Button type="text" icon={<FileTextOutlined/>} aria-label="查看需求执行记录" onClick={()=>setSessions(true)}><span className="project-secondary-action-label">执行记录</span></Button> : null}
      {(tab !== 'delivery' || localTask && validLocalNode || sourceWorkNode) && <ProjectWorkLaunch target={{projectId:'teams',tab,...(tab === 'delivery' ? localTask ? {taskId: localTask.id, nodeId: localNode} : selectedTask && sourceWorkNode ? {taskId: selectedTask.id, nodeId: sourceWorkNode.id} : {} : {}),...(params.get('discussion')?{discussionId:params.get('discussion')!}:{}),...(params.get('release')?{releaseId:params.get('release')!}:{})}} />}
    </>}/>
    {tab==='content'?<ProjectContentTemplate projectId="teams" name={p.name} description={displayText(p.description)} origin={sourceTag}
      information={[{key:'team',label:'所属团队',children:'Teams 开发团队'},{key:'owner',label:'项目 Owner',children:memberName(p.owner)},
        {key:'repository',label:'主仓',span:2,children:<>{p.repos.map(repo=><div key={repo.name}><strong>{repo.name}</strong> <Tag>{repo.branch}</Tag><Mono>{repo.path}</Mono><p className="muted">{displayText(repo.note)}</p></div>)}</>},
        {key:'directory',label:'本机目录',span:2,children:'导入快照未核验本机工作目录 · '+p.repoNote},
        {key:'scope',label:'项目数据',span:2,children:`${s.tasks.length + localTasks.length} 个任务 · ${s.inputs.length} 条输入 · ${s.discussions.length} 条讨论 · ${s.releases.length} 个版本`},
      ]}
      members={<><Table size="small" pagination={false} rowKey="id" dataSource={s.members} columns={[{title:'成员',dataIndex:'name'},{title:'职责',dataIndex:'role'}]}/><p className="muted">成员 A、B、C 为项目协作成员。{displayText(p.phase)}</p></>}
      assets={<ProjectAssets projectId="teams" extra={<><p>{displayText(p.agentsNote)}</p><Button onClick={()=>document('AGENTS.md')}>查看 AGENTS.md</Button></>} />}
      knowledge={<ProjectKnowledge projectId="teams" />}
      requirements={<><div className="talent-rule-grid">{p.sources.map(source=><div key={source.name}><h3>{source.name}</h3><p>{displayText(source.description)}</p><Tag>{source.status}</Tag></div>)}</div><p className="muted">{displayText(p.runtime)}</p><Button onClick={()=>jump('management')}>进入任务管理 <ArrowRightOutlined/></Button></>}
      skills={p.skills.map(skill=>{const path='.agents/skills/'+skill.name+'/SKILL.md';return {...skill,version:'源码快照 '+s.sourceCommit.slice(0,7),source:'原 Teams 仓库快照',path,content:s.documents.find(doc=>doc.path===path)?.content};})}
      skillFooter={<div className="project-skill-context"><p>本项目保留原任务流程，任务输入与节点记录可在交付页面查看。</p><Button onClick={()=>jump('delivery',{task:s.selection.taskId,node:'prepare'})}>查看需求澄清与输入</Button></div>}
    />:tab==='management'?<ProjectTaskManagement projectId="teams"/>:tab==='delivery'?localTask?.record ? validLocalNode ? <LiveTaskDelivery key={localTask.id + ':' + role} task={localTask.record} node={localNode as RequirementNode} sidebarItems={sidebarItems} /> : <Alert type="error" title="交付节点不存在" action={<Button onClick={() => jump('delivery', { task: localTask.id })}>返回任务</Button>} /> : selectedTask ? <ImportedTaskDelivery snapshot={s} params={new URLSearchParams({ ...Object.fromEntries(params), task: selectedTask.id })} jump={jump} sidebarItems={sidebarItems} /> : <div className="project-delivery-layout without-background"><DeliveryTaskSidebar projectId="teams" selectedTaskId="" items={sidebarItems} /><Alert type="info" title="此项目中不存在该需求任务" action={<Button onClick={() => jump('delivery')}>查看本项目任务</Button>} /></div>:null}
    <Drawer title={tab === 'delivery' ? selectedTask?.id + ' · 来源执行记录' : 'iCode Teams · 项目作业记录'} open={sessions && !localTask} onClose={()=>setSessions(false)} width={650}><div className="page-stack"><Alert type="info" title="项目作业上下文" description="以下内容来自 Teams 预置会话快照，关联需求讨论、交付节点和版本观察。"/>{visibleSessions.length === 0 && <Empty description="此任务阶段未提供关联作业快照"/>}{visibleSessions.map(session=><FrameworkCard key={session.key} title={displayText(session.title)} action={<Tag>{displayText(session.status)}</Tag>}><p>{displayText(session.location)} · {memberName(session.owner)}</p><h3>{displayText(session.resultTitle)}</h3><p>{displayText(session.resultText)}</p>{session.target.page!=='release'&&<Button onClick={()=>{setSessions(false);const target=session.target;jump(target.page,{...(target.item?{discussion:target.item}:{}),...(target.task?{task:target.task}:{}),...(target.node?{node:target.node}:{}),...(target.version?{release:target.version}:{})});}}>查看关联事项</Button>}<Button type="link" onClick={()=>showText(session.short+' · 作业上下文',JSON.stringify(session,null,2))}>查看完整上下文</Button></FrameworkCard>)}</div></Drawer>
  </div>;
}
