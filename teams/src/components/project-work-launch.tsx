import { taskAutomation, taskNodeKnowledge, type TaskPreparation } from '../task-automation.js';
import { preparationHint, preparationReady } from './task-preparation-progress.js';
import { displayText, displayRequirementId } from '../display-text.js';
import { useEffect, useRef, useState } from 'react';
import { message, Alert, Button, Collapse, Descriptions, Input, Modal, Radio, Space, Spin, Tooltip, Typography } from 'antd';
import { CodeOutlined } from '@ant-design/icons';
import { useDemo } from '../context.js';
import { bindProjectWork, getProjectWork, startProjectWork, triggerTaskAutomation } from '../api.js';
import type { ProjectWorkAction, ProjectWorkPlan, ProjectWorkReceipt, ProjectWorkSelection } from '../project-work.js';
import { ConfirmWork } from '../vendor/teams/work/confirm-work.js';
import { projectDeliveryTasks } from '../project-delivery-tasks.js';
import { projectTasksVisibleTo, taskExecutableBy } from '../task-visibility.js';
import './project-work-launch.css';

const requestPending = (receipt?: ProjectWorkReceipt) => receipt?.status === 'uncertain' || receipt?.status === 'prepared';
const requestTime = (value: string) => {
  const at = new Date(value);
  return Number.isNaN(at.valueOf()) ? '时间待核对' : at.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
};

function WorkResult({ plan, receipt, done, newWork, inspect, check, prepared = false }: {
  prepared?: boolean; plan: ProjectWorkPlan; receipt: ProjectWorkReceipt; done: () => void; newWork: () => void; inspect: () => void; check: () => void;
}) {
  const pending = requestPending(receipt);
  const focused = receipt.status === 'terminal-focused';
  const history = receipt.sessionId && plan.history?.sessionId === receipt.sessionId ? plan.history : undefined;
  const terminal = receipt.terminal ?? (focused ? history?.active?.application : undefined);
  const nextStep = pending ? '请核对终端中的实际状态；原请求已保留，避免重复启动。'
    : prepared ? '当前任务资料已在此会话中读取，请进入 iCode 继续处理。'
    : focused ? '请在原 iCode 会话中读取当前任务上下文。本次仅打开终端，未发送任务。'
      : receipt.executionMode === 'task-file' ? 'iCode 启动后会自动读取任务文件，进度以会话回传为准。'
        : plan.target.taskId ? '进入 iCode 后输入工作指令，当前节点上下文会随首轮输入附带。' : '进入 iCode 后按工作入口读取项目上下文，再开展工作。';
  return <div className="project-work-result">
    <Alert className="project-work-result-status" showIcon type={pending ? 'warning' : 'success'} title={pending ? '启动结果待核对' : focused ? '已打开会话终端' : '已提交启动请求'} />
    <div className="project-work-result-summary">
      <Typography.Text strong>{displayText(plan.title)}</Typography.Text>
      <span className="muted">{plan.projectName} · {plan.location}</span>
      {(history?.title || terminal) && <Descriptions column={1} size="small" items={[
        ...(history?.title ? [{ key: 'session-name', label: '会话', children: history.title }] : []),
        ...(terminal ? [{ key: 'terminal', label: '终端', children: terminal }] : []),
      ]} />}
    </div>
    <p className="project-work-next-step">{nextStep}</p>
    <Collapse className="project-work-details" ghost items={[{ key: 'technical', label: '技术详情', children: <div className="project-work-detail-content">
      <Descriptions column={1} size="small" items={[
        { key: 'request', label: '请求 ID', children: receipt.requestId },
        { key: 'at', label: '记录时间', children: receipt.at },
        { key: 'session', label: '会话 ID', children: receipt.sessionId ?? '等待原生会话记录确认' },
        { key: 'directory', label: '工作目录', children: receipt.directory },
        { key: 'context', label: '上下文文件', children: receipt.contextPath },
        ...(receipt.trace ? [{key:'trace',label:'Trace',children:receipt.trace.diagnostic+' · '+receipt.trace.endpoint}] : []),
      ]} />
      <p className="muted">{displayText(receipt.note)}</p>
      <Typography.Paragraph className="project-work-instruction" copyable={{ text: receipt.instruction, tooltips: ['复制指令', '已复制'] }}>{receipt.instruction}</Typography.Paragraph>
      <Button type="link" onClick={inspect}>查看请求</Button>
    </div> }]} />
    <Space wrap><Button type="primary" aria-label="关闭" onClick={done}>关闭</Button>{pending ? <Button onClick={check}>重新核对请求</Button> : plan.actions.some(item => item.id === 'new' && item.enabled) ? <Button onClick={newWork}>启动新作业</Button> : null}</Space>
  </div>;
}

export function ProjectWorkLaunch({ target }: { target: ProjectWorkSelection }) {
  const { role } = useDemo();
  return <ScopedProjectWorkLaunch key={JSON.stringify([role, target])} target={target} />;
}

function ScopedProjectWorkLaunch({ target }: { target: ProjectWorkSelection }) {
  const { state, data, role } = useDemo();
  const [open, setOpen] = useState<'prepare' | 'work' | 'ready' | null>(null), [configuring, setConfiguring] = useState(false);
  const [waitingFor, setWaitingFor] = useState<string>();
  const [feedback, feedbackContext] = message.useMessage();
  const taskId = target.taskId ?? target.requirementId;
  const task = taskId ? projectDeliveryTasks(state, target.projectId, role).find(item => item.id === taskId) : undefined;
  const sourceTask = target.projectId === 'teams' ? data.teamsProject.tasks.find(item => item.id === taskId) : undefined;
  const automation = taskId ? taskAutomation(state, { projectId: target.projectId, taskId }) : undefined;
  const preparation = automation?.preparation;
  const nodeKnowledge = target.nodeId === 'prepare' || target.nodeId === 'develop' || target.nodeId === 'verify' ? taskNodeKnowledge(automation, target.nodeId) : undefined;
  const knowledgeReason = nodeKnowledge && nodeKnowledge.status !== 'ready' ? nodeKnowledge.status === 'waiting-upstream' ? '等待上游成果确认后获取本节点知识' : nodeKnowledge.status === 'failed' ? '本节点知识获取失败，请先重试' : '本节点知识获取完成后可以进入会话' : undefined;
  const preparationReason = preparation && !preparationReady(preparation) ? preparationHint(preparation) : undefined;
  const canConfigure = !!task && taskExecutableBy(role, task.assigneeId) && preparation?.status === 'waiting-directory';
  const permissionReason = !projectTasksVisibleTo(state, target.projectId, role) ? '当前身份不在该项目任务范围内' : !taskId ? undefined : task ? taskExecutableBy(role, task.assigneeId) ? undefined : task.assigneeId ? `由${task.owner}负责，仅交付人可启动` : '任务尚未分配，请先分配交付人' : sourceTask ? `来源任务由${sourceTask.owner}负责，尚未关联本地交付人` : '此项目中不存在该任务';
  const pristine = !!task?.record && task.record.stage === 'preparing' && !task.record.preparedAt && !task.record.nodeInputSnapshots?.prepare && Object.values(task.record.nodes).every(node => node.status === 'pending');
  const needsPreparation = target.nodeId === 'prepare' && (preparation ? !preparationReady(preparation) : pristine && nodeKnowledge?.status !== 'ready');
  const disabledReason = permissionReason ?? (needsPreparation ? undefined : preparationReason ?? knowledgeReason);
  useEffect(() => {
    if (!waitingFor) return;
    if (permissionReason || preparation?.id !== waitingFor) { setWaitingFor(undefined); return; }
    if (preparationReady(preparation)) { setWaitingFor(undefined); setConfiguring(false); setOpen('ready'); }
  }, [waitingFor, permissionReason, preparation]);
  const waitForPreparation = (id: string) => { setWaitingFor(id); setOpen(null); };
  // Each opening owns its asynchronous state. Closing or changing scope unmounts
  // it, so late bind/start callbacks cannot update another task or dialog instance.
  return <>{feedbackContext}<Tooltip title={disabledReason} trigger={['hover', 'focus']}><span className="project-work-entrance" tabIndex={disabledReason ? 0 : undefined} aria-label={disabledReason} title={disabledReason}><Button type="primary" icon={<CodeOutlined />} aria-label="iCode 作业" disabled={!!disabledReason} onClick={() => setOpen(needsPreparation ? 'prepare' : 'work')}>iCode 作业</Button></span></Tooltip>
    {canConfigure && <Button size="small" onClick={() => setConfiguring(true)}>配置工作目录</Button>}
    {waitingFor && <Button type="link" size="small" onClick={() => setWaitingFor(undefined)}>取消就绪提醒</Button>}
    {configuring && !permissionReason && <ProjectWorkDialog target={target} close={() => setConfiguring(false)} configureOnly preparationRequested={waitForPreparation} />}
    {open === 'prepare' && !permissionReason && <PreparationConfirmation target={target} title={task?.title ?? ''} preparation={preparation} alreadyRequested={!!waitingFor && waitingFor === preparation?.id} close={() => setOpen(null)} requested={waitForPreparation} configure={() => { setOpen(null); setConfiguring(true); }} inspect={() => setOpen('work')} />}
    {(open === 'work' || open === 'ready') && !permissionReason && <ProjectWorkDialog target={target} readyPrompt={open === 'ready'} close={() => setOpen(null)} completed={value => { void feedback.success(value.status === 'terminal-focused' ? '已进入会话' : '已提交启动请求'); }} />}
  </>;
}

function PreparationConfirmation({ target, title, preparation, alreadyRequested, close, requested, configure, inspect }: {
  target: ProjectWorkSelection; title: string; preparation?: TaskPreparation; alreadyRequested: boolean; close: () => void;
  requested: (id: string) => void; configure: () => void; inspect: () => void;
}) {
  const { role, receiveState, navigate } = useDemo();
  const [plan, setPlan] = useState<ProjectWorkPlan>(), [error, setError] = useState(''), [busy, setBusy] = useState(false), [reload, setReload] = useState(0);
  const mounted = useRef(true), pending = useRef(false);
  const targetKey = JSON.stringify(target);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { let active = true; setPlan(undefined); setError(''); void getProjectWork(role, JSON.parse(targetKey)).then(value => { if (active) setPlan(value); }).catch(cause => { if (active) setError(cause.message); }); return () => { active = false; }; }, [role, targetKey, reload]);
  const ongoing = !!preparation && ['importing', 'preparing-session'].includes(preparation.status);
  const pendingWork = requestPending(plan?.previous);
  const configReason = !plan ? undefined : !plan.instance.installed ? '尚未安装 iCode，请先检查工具配置。' : !plan.instance.agent || !plan.instance.model ? '请先配置 iCode 的 Agent 与模型。' : plan.instance.terminal?.error ?? (plan.instance.trace?.readiness === 'unavailable' ? plan.instance.trace.diagnostic : undefined);
  const cannotRetry = !!preparation && ['failed', 'waiting-directory'].includes(preparation.status) && !preparation.retryable;
  const start = async () => {
    if (pending.current || !plan || configReason || !plan.directory.valid || pendingWork || cannotRetry) return;
    pending.current = true; setBusy(true); setError('');
    try {
      // An already running job only needs a local notification intent, not another request.
      if (ongoing || alreadyRequested && preparation?.status === 'queued') { requested(preparation!.id); return; }
      const scope = { projectId: target.projectId, taskId: (target.taskId ?? target.requirementId)! };
      const next = await triggerTaskAutomation(role, scope, 'preparation', true);
      if (!mounted.current) return;
      const saved = taskAutomation(next, scope)?.preparation;
      if (!saved?.id) throw new Error('服务未返回准备记录，请核对后重试。');
      receiveState(next); requested(saved.id);
    } catch (cause) { if (mounted.current) setError((cause as Error).message); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  return <Modal open centered className="project-work-modal" title="准备 iCode 会话" footer={null} maskClosable={false} onCancel={close} width={560}>
    <div className="page-stack"><Typography.Text strong>{displayText(title)}</Typography.Text>
      <p>先获取本需求的知识与 Skill，再准备 iCode 会话。知识获取约需 20 秒，会话准备以实际完成为准。</p>
      <p className="muted">确认后返回页面查看进度。准备完成会再询问是否进入会话，不会自动打开终端或开始开发。</p>
      {preparation && <Alert showIcon type={preparation.status === 'failed' || preparation.status === 'waiting-directory' ? 'warning' : 'info'} title={preparationHint(preparation)} description={preparation.error && displayText(preparation.error)} />}
      {error && <Alert type="error" title="准备未提交" description={displayText(error)} />}
      {!plan && !error && <Spin />}
      {plan && !plan.directory.valid && <Alert type="warning" title="需要配置工作目录" description={displayText(plan.directory.diagnostic)} action={<Button disabled={busy} onClick={configure}>配置工作目录</Button>} />}
      {configReason && <Alert type="warning" title="需要检查 iCode 配置" description={displayText(configReason)} action={<Button onClick={() => { close(); navigate('agent'); }}>工具配置</Button>} />}
      {pendingWork && <Alert type="warning" title="原启动请求待核对" description="请先核对原请求，不会另建会话。" action={<Button onClick={inspect}>核对启动请求</Button>} />}
      {cannotRetry && <Alert type="warning" title="需先核对原生准备记录" description="尚不能安全重试，请查看页面中的未完成原因。" />}
      <Space><Button type="primary" aria-label="开始准备" loading={busy} disabled={!plan || !!configReason || !plan.directory.valid || pendingWork || cannotRetry} onClick={() => void start()}>开始准备</Button><Button onClick={close}>取消</Button>{error && <Button disabled={busy} onClick={() => setReload(value => value + 1)}>重新读取</Button>}</Space>
    </div>
  </Modal>;
}

function ProjectWorkDialog({ target, close, configureOnly = false, completed, readyPrompt = false, preparationRequested }: { target: ProjectWorkSelection; close: () => void; configureOnly?: boolean; completed?: (receipt: ProjectWorkReceipt) => void; readyPrompt?: boolean; preparationRequested?: (id: string) => void }) {
  const { state, role, navigate, showText, receiveState } = useDemo();
  const [busy, setBusy] = useState(false), [plan, setPlan] = useState<ProjectWorkPlan>(), [error, setError] = useState('');
  const [action, setAction] = useState<ProjectWorkAction>('new'), [directory, setDirectory] = useState(''), [receipt, setReceipt] = useState<ProjectWorkReceipt>();
  const [reload, setReload] = useState(0), [binding, setBinding] = useState(false);
  const key = JSON.stringify(target);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const saved = (value: ProjectWorkReceipt) => {
    // A late response belongs to the original dialog, even when the same scope
    // has since been reopened. It must not close or notify the new instance.
    if (!mounted.current) return;
    if (value.status === 'terminal-requested' || value.status === 'terminal-focused') { completed?.(value); close(); }
    else setReceipt(value);
  };
  useEffect(() => {
    let active = true; setPlan(undefined); setError(''); setReceipt(undefined);
    void getProjectWork(role, JSON.parse(key)).then(value => { if (active) { setPlan(value); setAction(value.defaultAction); setDirectory(value.directory.root ?? ''); } }).catch(cause => { if (active) setError(cause.message); });
    return () => { active = false; };
  }, [role, key, reload]);
  const bind = async () => { setBinding(true); setError(''); try { const value = await bindProjectWork(role, target, directory); if (!mounted.current) return; setPlan(value); setAction(value.defaultAction); if (configureOnly && value.directory.valid && target.taskId) { const next = await triggerTaskAutomation(role, { projectId: target.projectId, taskId: target.taskId }, 'preparation', true); if (!mounted.current) return; receiveState(next); const id = taskAutomation(next, { projectId: target.projectId, taskId: target.taskId })?.preparation?.id; if (id) preparationRequested?.(id); close(); } } catch (cause) { if (mounted.current) setError((cause as Error).message); } finally { if (mounted.current) setBinding(false); } };
  const preparedSession = target.taskId ? taskAutomation(state, { projectId: target.projectId, taskId: target.taskId })?.preparation?.session : undefined;
  const prepared = !!preparedSession?.sessionId && preparedSession.sessionId === plan?.history?.sessionId;
  const directoryForm = plan && <div className="page-stack"><p>{plan.directory.valid ? '核验工作目录后继续准备当前任务会话。' : '请选择用于处理本任务的项目工作目录。'}</p><Input aria-label="本机工作目录" placeholder="项目 Git 工作目录的绝对路径" value={directory} disabled={busy || binding} onChange={event => setDirectory(event.target.value)} /><Button loading={binding} disabled={busy || !directory.trim()} onClick={() => void bind()}>核验并绑定目录</Button>{!plan.directory.valid && <Collapse ghost size="small" items={[{ key: 'directory-reason', label: '查看目录要求', children: <p>{displayText(plan.directory.diagnostic)}</p> }]} />}</div>;
  const chosen = plan?.actions.find(item => item.id === action);
  const pendingPrevious = requestPending(plan?.previous) && !(action === 'focus' && chosen?.enabled);
  const check = () => { setReceipt(undefined); setReload(value => value + 1); };
  return <Modal className="project-work-modal" open centered zIndex={1100} title={configureOnly ? '配置工作目录' : receipt ? 'iCode 启动结果' : readyPrompt ? '会话已准备好，是否进入 iCode？' : action === 'focus' && plan?.history?.active ? '进入会话' : prepared ? '进入已准备会话' : '启动 iCode'} footer={null} maskClosable={false} closable={!busy && !binding} onCancel={close} width={640} destroyOnHidden>
      {error && <Alert type="error" title="工作入口未准备完成" description={displayText(error)} action={<Button onClick={() => setReload(value => value + 1)}>重新读取</Button>} />}
      {!plan && !error && <Spin tip="读取项目目录与 iCode 配置"><div style={{ minHeight: 100 }} /></Spin>}
      {plan && configureOnly ? <>{directoryForm}<Button type="link" onClick={close}>取消</Button></> : plan && receipt ? <WorkResult prepared={prepared} plan={plan} receipt={receipt} done={close} inspect={() => showText('本次工作入口', JSON.stringify(receipt, null, 2))} check={check} newWork={() => { setReceipt(undefined); setAction('new'); }} /> : plan && <ConfirmWork key={plan.planToken} confirmLabel={readyPrompt ? '进入会话' : action === 'focus' ? '进入会话' : action === 'resume' ? '恢复会话' : '开始工作'} pendingLabel={action === 'focus' ? '正在切换…' : '正在启动…'} title={plan.title + ' · ' + plan.location} instance={plan.instance.name} roleLabel={action === 'new' ? plan.instance.agentLabel : plan.history?.configuration?.agentLabel} modelLabel={action === 'new' ? plan.instance.modelLabel : plan.history?.configuration?.modelLabel} disabled={!chosen?.enabled || binding || pendingPrevious} busyChanged={value => { if (mounted.current) setBusy(value); }} saved={saved} startWork={requestId => startProjectWork(role, { requestId, target: plan.target, action, planToken: plan.planToken })}>
        {pendingPrevious && <Alert type="warning" title="上次启动请求待核对" description="请先核对原终端与请求记录，避免重复启动。重新核对只读取已有结果。" action={<Button onClick={check}>重新核对请求</Button>} />}
        <Descriptions size="small" column={1} items={[{ key: 'project', label: '项目', children: plan.projectName }, { key: 'task', label: '当前工作', children: displayRequirementId([plan.target.taskId ?? plan.target.requirementId, plan.location].filter(Boolean).join(' · ')) }, { key: 'dir', label: '使用目录', children: action === 'new' ? plan.directory.root ?? '尚未绑定' : plan.history?.directory }, { key: 'terminal', label: '使用终端', children: action === 'focus' ? plan.history?.active?.application ?? '原会话终端' : plan.instance.terminal?.name ?? '未配置' }, { key: 'context', label: '上下文', children: prepared ? '本任务上下文已读取，将进入同一会话' : plan.context.frozen ? '使用已冻结的输入版本' : '尚未冻结，将读取当前准备资料' }]} />
        {!plan.directory.valid && directoryForm}
        <Radio.Group aria-label="会话动作" value={action} disabled={busy} onChange={event => setAction(event.target.value)}><Space orientation="vertical">{plan.actions.map(item => <Radio key={item.id} value={item.id} disabled={!item.enabled}>{displayText(item.label)}{!item.enabled && <span className="muted"> · {item.reason && displayText(item.reason)}</span>}</Radio>)}</Space></Radio.Group>
        {plan.history?.diagnostic && <Alert type={chosen?.enabled ? 'info' : 'warning'} title={plan.history.active ? '会话正在运行' : '会话状态'} description={displayText(plan.history.diagnostic)} />}
        {action !== 'new' && plan.history && <p className="muted">会话：{plan.history.title}</p>}
        <p className="muted">{prepared ? '确认后进入已准备的 iCode 会话，继续本任务。' : action === 'focus' ? '确认后打开原会话终端，请在 iCode 中读取当前任务上下文。' : plan.executionMode === 'task-file' ? '确认后在新终端自动下发任务，执行进度以会话回传为准。' : plan.target.taskId ? '确认后进入可交互的 iCode。提交工作指令时附带当前节点上下文，由你决定后续操作。' : '确认后进入可交互的 iCode；项目上下文入口保留在技术详情中。'}</p>
        <Collapse className="project-work-details" ghost items={[{ key: 'technical', label: '技术详情', children: <><Descriptions size="small" column={1} items={[
          { key: 'source', label: '资料来源', children: displayText(plan.source) },
          { key: 'context', label: '上下文说明', children: displayText(plan.context.summary) },
          { key: 'version', label: '采用版本', children: displayText(plan.context.versions) },
          ...(plan.instance.trace ? [{key:'trace',label:'Trace',children:plan.instance.trace.diagnostic+' · '+plan.instance.trace.endpoint}] : []),
          ...(action !== 'new' && plan.history ? [{ key: 'session', label: '会话 ID', children: plan.history.sessionId }] : []),
          ...(plan.previous ? [{ key: 'previous', label: '上次请求', children: requestTime(plan.previous.at) + ' · ' + (requestPending(plan.previous) ? '结果待核对' : plan.previous.status === 'terminal-focused' ? '已打开终端' : '请求已提交') }] : []),
        ]} />{plan.previous && <><p className="muted">{displayText(plan.previous.note)}</p><Button type="link" onClick={() => showText('上次工作入口', JSON.stringify(plan.previous, null, 2))}>查看上次请求</Button></>}</> }]} />
        <Button type="link" onClick={() => { close(); navigate('agent'); }}>工具配置与诊断</Button>
        {readyPrompt && <Button type="link" disabled={busy} onClick={close}>稍后进入</Button>}
      </ConfirmWork>}
    </Modal>;
}
