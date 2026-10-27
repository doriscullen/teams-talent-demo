/** Adapted from team-collaboration/src/client/ui/project-real-work.tsx ConfirmWork.
 * Source revision: d3deae7ea4e47026925ccbd06ab6eec03f4648c7.
 * Keeps one request identity, pending guard, retry semantics and confirmation wording;
 * replaces host invocation with the demo's explicit project/native adapter.
 */
import { useRef, useState, type ReactNode } from 'react';
import { Button } from 'antd';
import type { ProjectWorkReceipt } from '../../../project-work.js';
export function ConfirmWork({ title, instance, roleLabel, modelLabel, disabled, children, startWork, saved, busyChanged, confirmLabel = '开始工作', pendingLabel = '正在启动…' }: {
  title: string; instance: string; roleLabel?: string; modelLabel?: string; disabled: boolean; children?: ReactNode;
  startWork(requestId: string): Promise<ProjectWorkReceipt>; saved(receipt: ProjectWorkReceipt): void; busyChanged(busy: boolean): void;
  confirmLabel?: string; pendingLabel?: string;
}) {
  const [requestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false), [attempted, setAttempted] = useState(false), [message, setMessage] = useState('');
  const pending = useRef(false), original = useRef(startWork);
  const start = async () => {
    if (pending.current) return;
    if (!attempted) original.current = startWork;
    pending.current = true; setBusy(true); busyChanged(true); setAttempted(true); setMessage('');
    try { saved(await original.current(requestId)); }
    catch (cause) { setMessage(`启动结果待核对：${cause instanceof Error ? cause.message : String(cause)}。重试会保留同一启动请求。`); }
    finally { pending.current = false; setBusy(false); busyChanged(false); }
  };
  return <div className="page-stack"><p>将开始「{title}」工作，并带入当前业务范围和操作指引。</p><p className="muted">使用 {instance}，以及项目当前工作目录。角色：{roleLabel ?? '未配置'} · 模型：{modelLabel ?? '未配置'}</p><fieldset disabled={attempted} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>{children}</fieldset><Button type="primary" aria-label={attempted ? '重试原启动请求' : confirmLabel} disabled={disabled || busy} loading={busy} onClick={() => void start()}>{busy ? pendingLabel : attempted ? '重试原启动请求' : confirmLabel}</Button>{message && <p role="alert">{message}</p>}</div>;
}
