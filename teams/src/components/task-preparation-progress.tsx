import { useState } from 'react';
import { Alert, Button, Collapse, Space, Tag, Timeline } from 'antd';
import { triggerTaskAutomation } from '../api.js';
import { useDemo } from '../context.js';
import { displayText } from '../display-text.js';
import { taskAutomation, type TaskAutomation, type TaskScope } from '../task-automation.js';
import { taskExecutableBy } from '../task-visibility.js';

type Preparation = NonNullable<TaskAutomation['preparation']>;
export const preparationLabels: Record<Preparation['status'], string> = {
  queued: '等待导入', importing: '知识导入中', 'preparing-session': '准备会话', ready: '会话已准备', 'waiting-directory': '等待工作目录', failed: '准备未完成',
};
export const preparationReady = (preparation?: Preparation) => !!preparation && preparation.status === 'ready' && preparation.session?.status === 'ready' && !!preparation.session.sessionId && preparation.session.readEvidence.length > 0;
export const preparationStatusLabel = (preparation: Preparation) => preparation.status === 'ready' && !preparationReady(preparation) ? '正在核对会话' : preparationLabels[preparation.status];
export const preparationHint = (preparation: Preparation) => preparation.status === 'ready'
  ? preparationReady(preparation) ? '上下文已读取，可以进入已准备的会话。' : '正在核对已准备的会话。'
  : preparation.status === 'waiting-directory' ? '请先配置项目工作目录，再继续准备会话。'
  : preparation.status === 'failed' ? '准备未完成，请查看原因后重试。'
  : preparation.status === 'preparing-session' ? '正在准备 iCode 会话并读取本任务资料，完成后即可进入。'
  : preparation.status === 'importing' ? '正在导入本任务相关知识与 Skill。'
  : preparation.assigneeId ? '任务已分配，等待自动导入相关知识与 Skill。' : '分配交付人后，将自动导入相关知识与 Skill。';

export function TaskPreparationProgress({ scope }: { scope: TaskScope }) {
  const { state, role, receiveState } = useDemo();
  const preparation = taskAutomation(state, scope)?.preparation;
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  if (!preparation) return null;
  const canRetry = preparation.retryable && (role === 'owner' || taskExecutableBy(role, preparation.assigneeId));
  return <div className="task-preparation-progress" data-preparation-task={scope.taskId} aria-live="polite">
    <Space wrap><Tag color={preparationReady(preparation) ? 'green' : preparation.status === 'failed' ? 'orange' : undefined}>{preparationStatusLabel(preparation)}</Tag><span className="muted">{preparationHint(preparation)}</span></Space>
    {preparation.progress.length > 0 && <Timeline items={preparation.progress.map((entry, index) => ({ key: entry.at + ':' + index, color: entry.status === 'failed' ? 'orange' : entry.status === 'completed' ? 'green' : 'blue', content: <div><p>{displayText(entry.summary)}</p><p className="muted">{entry.phase === 'knowledge' ? '知识导入' : '会话准备'} · {new Date(entry.at).toLocaleString('zh-CN')}</p></div> }))} />}
    {preparation.error && <Collapse ghost size="small" items={[{ key: 'failure', label: '查看未完成原因', children: <p>{displayText(preparation.error)}</p> }]} />}
    {error && <Alert type="error" title="重试未提交" description={error} />}
    {canRetry && preparation.status === 'failed' && <Button size="small" loading={busy} onClick={async () => { if (busy) return; setBusy(true); setError(''); try { receiveState(await triggerTaskAutomation(role, scope, 'preparation', true)); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); } }}>重新准备</Button>}
  </div>;
}
