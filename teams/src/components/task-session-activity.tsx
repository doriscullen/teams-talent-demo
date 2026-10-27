import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Empty, Select, Space, Tag } from 'antd';
import { useDemo } from '../context.js';
import { getTaskSessionStream } from '../api.js';
import type { RequirementNode } from '../delivery-requirements.js';
import './task-session-activity.css';

type Stream = Awaited<ReturnType<typeof getTaskSessionStream>>;
type Turn = Stream['turns'][number];
const statusLabels = { running: '活动中', completed: '已结束', failed: '执行失败', unavailable: '无法读取', unknown: '状态待核实' };
const turnStatus = { running: '进行中', ended: '本轮结束', failed: '本轮中断', unknown: '状态未记录' };
const nodeLabels = { prepare: '需求澄清', develop: '功能开发', verify: '测试验证', accept: '需求验收' };
const time = (value?: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN') : '时间未提供';

/** Read-only conversation polling never advances business task progress. */
export function TaskSessionActivity({ projectId, taskId, nodeId, sessionId, showSessionSelector = true, readonlySource = false }: { projectId: string; taskId: string; nodeId: RequirementNode; sessionId?: string; showSessionSelector?: boolean; readonlySource?: boolean }) {
  const { role } = useDemo(), scopeKey = [role, projectId, taskId, nodeId].join(':');
  const [chosen, setChosen] = useState<{ scope: string; id: string }>();
  const selection = chosen?.scope === scopeKey ? chosen.id : sessionId;
  useEffect(() => { setChosen(sessionId ? { scope: scopeKey, id: sessionId } : undefined); }, [sessionId, scopeKey]);
  const [stream, setStream] = useState<Stream>();
  const [turns, setTurns] = useState<Turn[]>([]), [error, setError] = useState(''), [pending, setPending] = useState(true), [hasNew, setHasNew] = useState(false);
  const viewport = useRef<HTMLDivElement>(null), following = useRef(true), [retry, setRetry] = useState(0);
  useEffect(() => {
    if (readonlySource) return;
    let live = true, timer: ReturnType<typeof setTimeout> | undefined, cursor: string | undefined, currentSession: string | null = null;
    const observed = new Map<string, Turn>();
    setStream(undefined); setTurns([]); setError(''); setPending(true); setHasNew(false); following.current = true;
    const poll = async () => {
      if (document.hidden) { timer = setTimeout(poll, 2000); return; }
      let delay = 2000;
      try {
        const value = await getTaskSessionStream(role, { projectId, taskId, nodeId, ...((selection ?? currentSession) ? { sessionId: (selection ?? currentSession)! } : {}), ...(cursor ? { cursor } : {}) });
        if (!live) return;
        const reset = value.reset || value.selectedSessionId !== currentSession;
        const previous = new Map(observed);
        if (reset) observed.clear();
        let changed = false;
        for (const turn of value.turns) { if (JSON.stringify(previous.get(turn.id)) !== JSON.stringify(turn)) changed = true; observed.set(turn.id, turn); }
        currentSession = value.selectedSessionId; cursor = value.cursor ?? undefined;
        setStream(value); setTurns([...observed.values()].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))); setError(''); setPending(false);
        if (!following.current && changed) setHasNew(true);
        if (following.current) requestAnimationFrame(() => { if (live && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight; });
        delay = value.hasMore ? 100 : Math.max(1000, value.pollAfterMs);
      } catch (cause) { if (!live) return; setError((cause as Error).message); setPending(false); }
      if (live) timer = setTimeout(poll, delay);
    };
    void poll();
    return () => { live = false; if (timer) clearTimeout(timer); };
  }, [projectId, taskId, nodeId, role, selection, retry, readonlySource]);
  if (readonlySource) return <section className="task-session-activity" aria-label="会话过程"><div className="task-session-activity-heading"><h3>会话过程</h3><Tag>原项目记录</Tag></div><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="来源记录未提供完整用户输入与模型回复" /></section>;
  const selected = stream?.sessions.find(item => item.id === stream.selectedSessionId);
  const bottom = () => { following.current = true; setHasNew(false); if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight; };
  return <section className="task-session-activity" aria-label="会话过程" data-stream-task={taskId} data-stream-node={nodeId}>
    <div className="task-session-activity-heading"><h3>会话过程</h3><Space size={6} wrap><Tag>{error ? '连接中断' : pending ? '连接中' : '已连接'}</Tag>{selected && <Tag>{statusLabels[selected.status]}</Tag>}</Space></div>
    {showSessionSelector && stream?.sessions.length ? <Select className="task-session-selector" aria-label="选择任务会话" value={stream.selectedSessionId ?? undefined} options={stream.sessions.map(item => ({ value: item.id, label: item.title + ' · ' + statusLabels[item.status] }))} onChange={id => { setStream(undefined); setTurns([]); setPending(true); setHasNew(false); setChosen({ scope: scopeKey, id }); }} /> : null}
    {error && <Alert type="warning" showIcon title="会话过程读取未完成" description={error} action={<Button size="small" onClick={() => setRetry(value => value + 1)}>重试</Button>} />}
    {stream?.note && <p className="muted task-session-note">{stream.note}</p>}
    {selected?.note && <p className="muted task-session-note">{selected.note}</p>}
    <div className="task-session-events" ref={viewport} onScroll={() => { const element = viewport.current; if (element) { following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48; if (following.current) setHasNew(false); } }}>
      {turns.length ? turns.map(turn => <article className="task-session-turn" key={turn.id} data-session-turn={turn.id} data-event-session={turn.sessionId}>
        <header><strong>{turn.round === null ? '轮次编号未记录' : `第 ${turn.round} 轮`}</strong><span>{turnStatus[turn.status]} · <time>{time(turn.startedAt)}</time></span></header>
        <div className="task-turn-user"><h4>用户输入</h4>{turn.user ? <p data-session-message={turn.user.id} data-message-role="user">{turn.user.text}</p> : <p className="muted">{turn.userSourceNode && turn.userSourceNode !== nodeId ? `本轮输入发生在${nodeLabels[turn.userSourceNode]}，当前节点未记录新的用户输入。` : '原记录未提供完整用户输入。'}</p>}</div>
        <div className="task-turn-replies"><h4>模型回复</h4>{turn.replies.length ? turn.replies.map(reply => <div key={reply.id} data-session-message={reply.id} data-message-role="assistant"><time>{time(reply.at)}</time><p>{reply.text}</p></div>) : <p className="muted">{turn.status === 'running' ? '等待模型回复…' : '本节点未记录模型可见回复。'}</p>}</div>
        {turn.note && <p className="muted task-session-note">{turn.note}</p>}
      </article>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={pending ? '正在读取本节点对话' : selected ? selected.status === 'running' ? '等待用户输入或原生会话保存对话正文' : '此节点未记录完整用户输入与模型回复' : '尚无本节点关联的 iCode 会话'} />}
    </div>
    {hasNew && <Button size="small" className="task-session-new-events" onClick={bottom}>有新对话内容 · 查看最新</Button>}
    <p className="muted task-session-refresh">{stream ? '最近读取 ' + time(stream.observedAt) + ' · 自动刷新' : '只读取本任务、本节点关联会话'} · 对话内容不改变任务进度</p>
  </section>;
}
