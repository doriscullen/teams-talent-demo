import { preferredDeliveryTask, projectDeliveryTasks } from '../project-delivery-tasks.js';
import { requirementStageLabels } from '../delivery-requirements.js';
import { displayRequirementId } from '../display-text.js';
import { TaskSessions } from '../components/task-sessions.js';
import { displayText } from '../display-text.js';
import { TeamsPageIntro } from '../components/teams-reuse.js';
import { useState } from 'react';
import { Alert, Button, Descriptions, Empty, Space, Tabs, Tag, Timeline } from 'antd';
import { ArrowRightOutlined } from '@ant-design/icons';
import { useDemo } from '../context.js';
import { FrameworkCard } from '../vendor/teams/components/page-layout.js';
import { Origin, talentLink } from '../components/common.js';
import { collectTaskSessions, mainTask, taskAutomation } from '../task-automation.js';
import { stageLabels } from '../domain.js';
import '../operations.css';

const knowledgeLabels = { 'waiting-upstream': '等待上游', queued: '待导入', running: '导入中', ready: '导入完成', waiting: '等待输入就绪', failed: '导入未完成' } as const;
const collectionLabels = { queued: '等待归集', running: '正在归集', collected: '已归集', empty: '暂无关联会话', failed: '归集未完成' } as const;
const phaseLabels = { started: '已开始', progress: '进度回传', blocked: '报告阻塞', result: '成果待确认' } as const;
const evidenceNotes: Record<string, string> = { E3: '首次检查', E4: '修复说明', E5: '复测结果' };

export function Trace({ initial }: { initial?: string }) {
  const { data, state, role } = useDemo();
  const [selected, setSelected] = useState(initial === 'security' ? 'security' : data.evidence.some(item => item.id === initial) ? initial! : 'E1');
  const [tab, setTab] = useState<'collaboration' | 'history'>(initial ? 'history' : 'collaboration');
  const params = new URLSearchParams(location.hash.split('?')[1] ?? ''), projectId = params.get('project') ?? 'carddemo';
  const tasks = projectDeliveryTasks(state, projectId, role), requested = params.get('task');
  const entry = requested ? tasks.find(item => item.id === requested) : preferredDeliveryTask(tasks, role), task = entry?.record;
  if (!task) return <Empty description="当前范围没有可查看的任务执行记录" />;
  const scope = { projectId: task.projectId, taskId: task.id }, isMain = scope.projectId === 'carddemo' && scope.taskId === 'DEMO-MKT-001';
  const automation = taskAutomation(state, scope), collection = automation?.collection;
  const sessions = collectTaskSessions(state, scope);
  const collectionStatus = collection ? collectionLabels[collection.status] : task.stage === 'accepted' ? '待归集' : '待验收';
  const reporting = collection?.reporting;
  const talentStatus = reporting?.status === 'reported' ? '已共享' : reporting?.status === 'failed' ? '共享未完成' : reporting?.status === 'uploading' ? '正在共享' : '尚未共享';
  const activity = [
    ...(state.workspace.collaboration?.events ?? []).filter(item => item.projectId === scope.projectId && item.taskId === scope.taskId).map(item => ({ id: 'event-' + item.id, text: item.summary, at: item.at, source: 'Teams CLI · ' + phaseLabels[item.phase], color: 'green', actor: item.role === 'owner' ? '林悦' : '陈晨' })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const evidence = data.evidence.find(item => item.id === selected);
  const selectEvidence = (id: string) => { setSelected(id); setTab('history'); };
  return <div className="page-stack trace-page" data-trace-task={task.id}>
    <TeamsPageIntro actions={role === 'owner' ? <Space wrap><Button href="#/team-work">返回任务追溯</Button><Button href={talentLink('sessions')}>分析交付记录 <ArrowRightOutlined /></Button></Space> : <Button href={'#/' + entry!.route}>返回我的交付</Button>}>{displayRequirementId(task.id)} · {task.title}</TeamsPageIntro>
    <FrameworkCard title="本次交付关联" action={<Tag color={requirementStageLabels[task.stage].includes('待') ? 'gold' : 'green'}>{requirementStageLabels[task.stage]}</Tag>}>
      <Descriptions size="small" column={2} items={[
        { key: 'project', label: '项目', children: projectId === 'carddemo' ? state.workspace.project.name : state.workspace.projects?.find(project => project.id === projectId)?.name ?? projectId }, { key: 'task', label: '需求 / 交付', children: displayRequirementId(task.id) },
        { key: 'context', label: '采用上下文', children: task.preparedAt ? '已采用 · ' + new Date(task.preparedAt).toLocaleString('zh-CN') : '待澄清采用' }, { key: 'sessions', label: '关联会话', children: sessions.length + ' 个' },
        { key: 'collection', label: '验收后归集', children: collectionStatus }, { key: 'talent', label: 'Talents 共享', children: talentStatus },
      ]} />
      <Space wrap><Button href={'#/' + entry!.route}>打开需求交付</Button></Space>
      <p className="muted">本次关联以任务会话、Teams CLI 回传和自动化回执为准；历史材料在独立页签中展示。</p>
    </FrameworkCard>
    <Tabs activeKey={isMain ? tab : 'collaboration'} onChange={value => setTab(value as 'collaboration' | 'history')} items={[
      { key: 'collaboration', label: '本次协作', children: <div className="page-stack">
        <div className="trace-current-grid"><TaskSessions readonly scope={scope} /><FrameworkCard title="自动化与归集" action={<Tag>任务自动化</Tag>}>
          <Descriptions column={1} size="small" items={[
            { key: 'knowledge', label: '知识导入', children: automation?.knowledge ? knowledgeLabels[automation.knowledge.status] : '未触发' },
            { key: 'collection', label: '验收后归集', children: collectionStatus },
            { key: 'talent', label: 'Talents 共享', children: reporting?.status === 'reported' ? '已共享 · ' + reporting.receipt?.id : talentStatus },
            { key: 'sessions', label: '归集会话', children: (collection?.sessions ?? sessions).length + ' 个' },
          ]} />
          {automation?.knowledge?.error && <Alert type="error" title="知识导入未完成" description={automation.knowledge.error} />}
          {collection?.error && <Alert type="error" title="会话归集未完成" description={collection.error} />}
          {reporting?.status === 'failed' && <Alert type="error" title="Talents 会话共享未完成" description={reporting.reason} />}
          <p className="muted">仅以共享目录写入回执确认已共享，不代表 Talents 已完成读取；归集失败不改变验收结论。</p>
        </FrameworkCard></div>
        <FrameworkCard title="本次协作记录" action={<Tag>{activity.length} 条记录</Tag>}>
          {activity.length ? <Timeline items={activity.map(item => ({ key: item.id, color: item.color, title: <Space wrap><Tag color={item.color}>{item.source}</Tag><strong>{displayText(item.text)}</strong></Space>, content: <small className="muted">{item.actor} · {new Date(item.at).toLocaleString('zh-CN', { hour12: false })}</small> }))} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚无本次手工进度或 CLI 回传" />}
        </FrameworkCard>
      </div> },
      ...(isMain ? [{ key: 'history', label: '历史材料', children: <div className="page-stack">
        <section className="trace-material-summary"><div><span className="trace-section-label">历史材料</span><h3>资格校验 → 修复 → 复测</h3><p>普通卡客户不应获得白金卡专属返现，修复后核对全部规则。材料用于回看问题与处理，不代表本次需求已执行。</p></div><Space wrap><Button onClick={() => selectEvidence('E3')}>首次检查</Button><Button onClick={() => selectEvidence('E4')}>修复说明</Button><Button onClick={() => selectEvidence('E5')}>复测结果</Button></Space><Tag color="gold">安全验证待完成</Tag></section>
        <div className="trace-layout"><FrameworkCard title="材料目录" action={<Origin kind="historical" />}><p className="muted">既有交付材料与静态分析，和本次协作分开阅读。</p><div className="evidence-nav">{data.evidence.map(item => <button key={item.id} aria-pressed={selected === item.id} className={selected === item.id ? 'selected' : ''} onClick={() => selectEvidence(item.id)}><span>{item.id}</span><strong>{item.title}</strong><small>{evidenceNotes[item.id] ?? '交付材料'}</small></button>)}<button aria-pressed={selected === 'security'} className={selected === 'security' ? 'selected' : ''} onClick={() => selectEvidence('security')}><span>安全</span><strong>未完成事项</strong><small>静态分析</small></button></div></FrameworkCard><FrameworkCard title={evidence?.title ?? '待验证事项'} action={<Origin kind={selected === 'security' ? 'static' : 'historical'} />}>{evidence ? <pre className="evidence-console">{evidence.body}</pre> : <div className="page-stack">{data.blueprint.gaps.slice(0, 2).map(gap => <div className="finding" key={gap.name}><Tag color="gold">待验证</Tag><h3>{gap.name}</h3><p>{gap.fact}</p><p className="muted">{gap.limit}</p></div>)}</div>}</FrameworkCard></div>
      </div> }] : []),
    ]} />
  </div>;
}
