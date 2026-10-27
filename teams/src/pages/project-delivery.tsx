import { taskAssigneeName, currentMemberOwnsTask } from '../task-assignment.js';
import { TaskDeliveryFlow } from '../components/task-delivery-flow.js';
import { TaskSessions } from '../components/task-sessions.js';
import { mainTask, taskAutomation, taskNodeWorkStatus } from '../task-automation.js';
import { displayText } from '../display-text.js';
import { CollaborationProgress } from '../components/collaboration-progress.js';
import { useState } from 'react';
import { Alert, Button, Descriptions, Drawer, Input, Select, Space, Tag, Timeline } from 'antd';
import { ArrowRightOutlined, CheckCircleOutlined, CloseOutlined, CodeOutlined, FileTextOutlined, ReloadOutlined } from '@ant-design/icons';
import { useDemo } from '../context.js';
import { FrameworkCard } from '../vendor/teams/components/page-layout.js';
import { ActionButton, Mono, Origin, StatusLine, talentLink } from '../components/common.js';
import { userSkillExamples } from '../project-skill-examples.js';
import { stageLabels } from '../domain.js';
import { RequirementMaterials } from './project-content.js';
import { ProjectAcceptance } from './project-acceptance.js';
import { availableSkillIdsFor, projectSkillIds, resourceSubscriptions } from '../resource-sharing.js';
import { SkillApplication } from '../components/skill-application.js';
import { getResourceContent } from '../api.js';

export type DeliveryNode = 'prepare' | 'develop' | 'verify' | 'accept';
export const nodeLabels: Record<DeliveryNode, string> = { prepare: '需求准备', develop: '功能开发', verify: '测试验证', accept: '需求验收' };
const nodes = Object.keys(nodeLabels) as DeliveryNode[];

function TaskBackground() {
  const { showEvidence, state } = useDemo();
  return <div className="project-task-background"><h3>信用卡消费返现</h3><Tag>MKT-001</Tag><p className="muted">交付人 {taskAssigneeName(state)} · 确认人 林悦</p><h4>任务目标</h4><p>白金卡客户在 3 个月期间消费，额外获得 0.5% 返现。</p><h4>交付标准</h4><p>客户资格、周期边界与返现金额正确，同一交易不重复入账。</p><h4>待确认细则</h4><p>正式活动日期、消费范围、限额及退款规则待业务确认。</p><Button size="small" onClick={() => showEvidence('E1')}>查看需求依据</Button></div>;
}

export function ProjectDelivery({ node }: { node: DeliveryNode }) {
  const { state, navigate } = useDemo();
  const [details, setDetails] = useState(false), [background, setBackground] = useState(false);
  const complete = { prepare: !!state.context, develop: ['fixed', 'submitted', 'accepted'].includes(state.stage), verify: state.checks === 'passed' && state.stage !== 'returned', accept: state.stage === 'accepted' };
  return <div className={'project-delivery-layout' + (!details ? ' without-background' : '')}>
    <aside className="project-task-list"><div className="project-column-title">交付任务 <Tag>1</Tag></div><button className="project-selected-task" onClick={() => navigate('projects?tab=delivery&node=' + node)}><small>MKT-001</small><strong>信用卡消费返现</strong><Tag color={state.stage === 'accepted' ? 'green' : 'purple'}>{stageLabels[state.stage]}</Tag><span>交付人 · {taskAssigneeName(state)}</span></button><p className="muted">需求、开发、检查和确认沿同一任务关联。</p></aside>
    <main className="project-node-main"><div className="project-flow-heading"><div><strong>任务交付流程</strong><p>需求修订 1 · 四节点协作流程</p></div><Button size="small" aria-label={details ? '收起任务资料' : '展开任务资料'} icon={<FileTextOutlined />} onClick={() => window.innerWidth < 1250 ? setBackground(true) : setDetails(!details)}>{details ? '收起任务资料' : '展开任务资料'}</Button></div>
      <TaskDeliveryFlow scope={mainTask} selected={node} onSelect={id=>navigate('projects?tab=delivery&node='+id)} nodes={nodes.map(id=>({ id,label:nodeLabels[id],role:id==='accept'?'项目 Owner':'成员',description:({prepare:'确认需求与上下文',develop:'实现需求并关联会话',verify:'核对检查与复测记录',accept:'确认功能与质量'})[id],complete:complete[id],status:complete[id]?'已完成':taskNodeWorkStatus(state,mainTask,id) ?? (id==='verify'&&state.checks==='failed'?'待修复':'待处理') }))}/>
      <div className="project-node-heading"><h2>{nodeLabels[node]}</h2><Tag>{node === 'accept' ? '确认人 · 林悦' : '交付人 · '+taskAssigneeName(state)}</Tag></div>
      <div className="page-stack project-node-content">{node === 'prepare' ? <PrepareNode /> : node === 'develop' ? <DevelopNode /> : node === 'verify' ? <VerifyNode /> : <ProjectAcceptance />}</div>
    </main>
    {details && <aside className="project-task-context"><div className="project-column-title">任务资料<Button type="text" size="small" aria-label="收起任务资料" icon={<CloseOutlined />} onClick={() => setDetails(false)} /></div><TaskBackground /></aside>}
    <Drawer title="任务资料与交付标准" width={430} open={background} onClose={() => setBackground(false)}><TaskBackground /></Drawer>
  </div>;
}

function PrepareNode() {
  const { state, data, role, update, busy, showText, navigate } = useDemo();
  const frozen = !!state.context;
  const imported = taskAutomation(state,mainTask)?.knowledge;
  const [skillReadError, setSkillReadError] = useState('');
  const available = new Set(availableSkillIdsFor(state, role));
  const subscriptions = new Map(resourceSubscriptions(state, role).map(item => [item.id, item]));
  const subscribedSkills = data.skills.filter(skill => !projectSkillIds.includes(skill.name) && available.has(skill.name));
  const readSelectedSkill = async (name: string) => {
    setSkillReadError('');
    try {
      const binding = frozen ? state.context?.skillBindings?.find(item => item.id === name) : subscriptions.get(name);
      if (binding?.sha256) {
        const result = await getResourceContent(role, { resourceId: name, version: binding.version, sha256: binding.sha256 });
        showText(name + ' · ' + result.version, result.content);
      } else {
        const content = data.skillContents[name] ?? userSkillExamples.find(skill => skill.id === name)?.content;
        if (!content) throw new Error('此 Skill 正文暂不可用，请重新读取资源数据。');
        showText(name + (frozen && data.skillContents[name] ? ' · 项目来源正文（冻结记录未保存内容包哈希）' : ''), content);
      }
    } catch (cause) { setSkillReadError((cause as Error).message); }
  };
  return <>
    <FrameworkCard title="输入与采用依据" action={<Origin kind="simulated" />}><Descriptions size="small" column={1} items={[{ key: 'requirement', label: '需求', children: 'MKT-001 · 修订 1' }, { key: 'description', label: '需求描述', children: '针对白金卡客户未来 3 个月的消费，额外增加 0.5% 的消费返现。' }, { key: 'pending', label: '待确认细则', children: '活动日期、周期起算、消费范围、是否报名、消费门槛、返现上限及结算方式均待确认。' }, { key: 'knowledge', label: '项目知识', children: imported?.inputs?.knowledge.length ? <Tag color="green">{imported.inputs.knowledge.length} 项知识版本已读取</Tag> : <Tag>等待知识输入就绪</Tag> }, { key: 'skill-source', label: 'Skill 来源', children: '项目与我的订阅；Talents Skill 加载尚未接入' }, { key: 'agent', label: 'Agent', children: 'Code Agent ' + (state.context?.agentVersion ?? state.adoptedAgent) }, { key: 'scope', label: '业务范围', children: '仅白金卡客户 · 未来 3 个月 · 额外 0.5% 消费返现' }]} /><Space wrap><Button onClick={() => navigate('projects?tab=content')}>查看项目知识</Button><Button onClick={() => navigate('projects?tab=content')}>查看项目资产</Button></Space></FrameworkCard>
    <FrameworkCard title="需求补充材料"><RequirementMaterials /></FrameworkCard>
    <FrameworkCard title="本次采用的 Skill" action={<Tag>{state.workspace.selectedSkills.length} 项{frozen ? '已冻结' : '已选'}</Tag>}><p>按本需求选择项目 Skill 或用户 Skill，查看内容后与上下文一起采用。</p><Select aria-label="选择业务 Skill" mode="multiple" className="project-skill-select" value={state.workspace.selectedSkills} disabled={role !== 'member' || !currentMemberOwnsTask(state) || frozen || busy} options={[{ label: '项目 Skill', options: data.skills.filter(skill => projectSkillIds.includes(skill.name)).map(skill => ({ label: skill.name, value: skill.name })) }, { label: '我的订阅', options: subscribedSkills.map(skill => ({ label: skill.name + ' · ' + subscriptions.get(skill.name)!.version, value: skill.name })) }, { label: '用户 Skill', options: userSkillExamples.map(skill => ({ label: skill.name, value: skill.id })) }]} onChange={skills => void update('skills.select', { skills })} placeholder="选择本需求需要的业务 Skill" optionFilterProp="label" /><div className="skill-pills">{state.workspace.selectedSkills.map(name => <Space wrap key={name}><button onClick={() => void readSelectedSkill(name)}>{name}</button>{!!subscriptions.get(name)?.sha256 && <SkillApplication projectId="carddemo" resourceId={name} version={subscriptions.get(name)!.version} sha256={subscriptions.get(name)!.sha256} />}</Space>)}</div>{skillReadError && <Alert type="error" title="Skill 正文读取失败" description={skillReadError} />}<p className="muted">原有项目与用户 Skill 可直接选用；其余市场 Skill 只列出当前用户已订阅的版本。订阅与本机应用不改变本次冻结记录，加载状态以应用核验及工具会话为准。</p><Space wrap><Button size="small" onClick={()=>navigate('projects?tab=content')}>查看项目与用户 Skill</Button><Button size="small" onClick={()=>navigate('resources')}>前往资源市场订阅</Button></Space></FrameworkCard>
    <FrameworkCard title="确认采用并进入开发" action={<Tag color={frozen ? 'green' : 'default'}>{frozen ? '已冻结' : '待采用'}</Tag>}><StatusLine complete={state.assigned}>需求已分配给 {taskAssigneeName(state)}</StatusLine><StatusLine complete={state.workspace.selectedSkills.length > 0}>已选择可用 Skill · Code Agent 已就绪</StatusLine><StatusLine complete={imported?.status === 'ready'}>知识与 Skill 输入已核对</StatusLine><StatusLine complete={frozen}>需求材料与业务 Skill 已冻结</StatusLine>{state.context && <p><Mono>{state.context.id}</Mono> · Skill {state.context.skillVersion} / Agent {state.context.agentVersion}</p>}<Space wrap><ActionButton action="prepare" role="member" disabled={!state.assigned || !state.workspace.selectedSkills.length || frozen || !!imported && imported.status !== 'ready'}>{frozen ? '上下文已冻结' : '采用能力并冻结上下文'}</ActionButton><Button disabled={!frozen} onClick={() => navigate('projects?tab=delivery&node=develop')}>进入开发节点</Button></Space><p className="muted">顶部「iCode 作业」用于启动或继续原生会话，并导出上下文供 iCode 显式读取。</p></FrameworkCard>
  </>;
}

function DevelopNode() {
  const { state, role, update, busy, navigate, showEvidence } = useDemo();
  const [progress, setProgress] = useState('正在梳理白金卡客户未来 3 个月额外 0.5% 消费返现的需求细则，日期、周期起算、消费范围与结算方式待确认。');
  const started = !!state.context && !['draft', 'assigned'].includes(state.stage);
  const canSync = currentMemberOwnsTask(state) && !!state.context && ['developing', 'failed', 'fixed', 'returned'].includes(state.stage) && state.workspace.foundation.progressEnabled;
  return <>
    {!state.context && <Alert type="info" title="先确认采用需求上下文" action={<Button onClick={() => navigate('projects?tab=delivery&node=prepare')}>进入需求准备</Button>} />}
    {state.stage === 'returned' && <Alert type="warning" title="Owner 要求补充" description={state.returnReason} />}
    <FrameworkCard title="关联 iCode 作业" action={<Origin kind="simulated" />}><p>白金卡消费返现 · 当前交付作业</p><p>关联本次上下文，登记开发状态并同步进度。需要原生执行时，可从顶部进入 iCode 作业。</p><Space wrap><ActionButton action="replay" role="member" disabled={!state.context || state.stage !== 'assigned'}>开始开发</ActionButton><Button onClick={() => navigate('trace')}>查看关联会话</Button></Space></FrameworkCard>
    <TaskSessions node="develop" /><CollaborationProgress projectId="carddemo" taskId="DEMO-MKT-001" /><FrameworkCard title="工作进展与协作问题" action={<Origin kind="simulated" />}>{state.workspace.progress.length ? <Timeline items={state.workspace.progress.map(item => ({ key: item.id, content: <><p>{displayText(item.text)}</p><small className="muted">iCode 同步 · {new Date(item.at).toLocaleString('zh-CN')} · {item.node}</small></> }))} /> : <p className="muted">尚无进度同步记录。开始开发后，可以向 Teams 回传 iCode 工作进度。</p>}{role === 'member' && <><Input.TextArea aria-label="同步开发进度" rows={3} value={progress} onChange={event => setProgress(event.target.value)} maxLength={1000} disabled={!canSync} /><div className="card-actions"><Button loading={busy} disabled={!canSync || !progress.trim()} onClick={() => void update('progress.sync', { text: progress, node: 'develop' })}>同步开发进度</Button></div></>}{!state.workspace.foundation.progressEnabled && <Alert type="info" title="进度同步尚未启用" description="团队协作进度同步开关已关闭。" />}<p className="muted">此处按钮保存手工进度记录；上方展示 Teams CLI 实际 HTTP 回传。</p></FrameworkCard>
    <FrameworkCard title="成果与附件"><div className="project-artifact"><CodeOutlined /><div><strong>返现资格与金额计算</strong><p>核对白金卡资格、活动周期与额外返现金额，保留修复和复测依据。</p></div><Button size="small" onClick={() => showEvidence('E4')}>查看变更说明</Button></div><Space wrap><Button type="primary" disabled={!started} onClick={() => navigate('projects?tab=delivery&node=verify')}>进入验证节点</Button><Button onClick={() => navigate('trace')}>查看执行证据</Button></Space></FrameworkCard>
  </>;
}

function VerifyNode() {
  const { state, navigate, showEvidence } = useDemo();
  const passed = state.checks === 'passed';
  return <>
    <FrameworkCard title="检查结果" action={<Tag color={passed ? 'green' : state.checks === 'failed' ? 'red' : 'default'}>{passed ? '检查通过' : state.checks === 'failed' ? '需要修复' : '待检查'}</Tag>}>
      <p>{passed ? '资格、周期、金额精度及重复处理符合当前验收规则。' : state.checks === 'failed' ? '普通卡客户被错误纳入返现范围，需要补充资格判断。' : '查看当前检查记录，并关联处理结果。'}</p>
      <Space wrap><ActionButton action="check-fail" role="member" disabled={state.stage !== 'developing'}>查看首次检查</ActionButton><ActionButton action="fix" role="member" disabled={!['failed','returned'].includes(state.stage)}>关联修复与复测</ActionButton><Button disabled={state.checks === 'none'} onClick={() => showEvidence(passed ? 'E5' : 'E3')}>查看报告</Button></Space>
    </FrameworkCard>
    <FrameworkCard title="变更与复测依据"><div className="project-evidence-sequence"><Button onClick={() => showEvidence('E3')}>首次检查</Button><ArrowRightOutlined /><Button onClick={() => showEvidence('E4')}>修复说明</Button><ArrowRightOutlined /><Button onClick={() => showEvidence('E5')}>复测结果</Button></div><p className="muted">结果按关联记录展示；生产安全扫描尚未验证。</p></FrameworkCard>
    <FrameworkCard title="提交交付"><StatusLine complete={!!state.context}>采用上下文已冻结</StatusLine><StatusLine complete={passed}>功能检查已通过</StatusLine><StatusLine complete={['submitted','accepted'].includes(state.stage)}>交付包已提交</StatusLine><Space wrap><ActionButton action="submit" role="member" disabled={state.stage !== 'fixed' || !passed}>{['submitted','accepted'].includes(state.stage) ? '交付包已提交' : '提交交付包'}</ActionButton><Button disabled={!['submitted','accepted'].includes(state.stage)} onClick={() => navigate('projects?tab=delivery&node=accept')}>查看验收</Button></Space></FrameworkCard>
    <TaskSessions node="verify" />
  </>;
}
