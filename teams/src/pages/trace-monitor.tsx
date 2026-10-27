import { useEffect, useRef } from 'react';

export interface TraceMonitorRoute { projectId?: string; sessionId?: string | null; traceId?: string | null }

// 同源内嵌真实 trace_monitor_vue，只通过明确 scope 和同源路由消息与宿主联动。
export function TraceMonitor({ projectId, sessionId, traceId, onRouteChange }: TraceMonitorRoute & { onRouteChange?: (route: TraceMonitorRoute) => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    if (!onRouteChange) return;
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow) return;
      const data = event.data;
      if (!data || data.type !== 'teams-trace-route') return;
      onRouteChange({
        projectId: typeof data.projectId === 'string' && data.projectId ? data.projectId : undefined,
        sessionId: typeof data.sessionId === 'string' && data.sessionId ? data.sessionId : null,
        traceId: typeof data.traceId === 'string' && data.traceId ? data.traceId : null,
      });
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [onRouteChange]);
  const query = new URLSearchParams();
  if (projectId) query.set('project', projectId);
  if (sessionId) query.set('session', sessionId);
  const detail = traceId && projectId ? 'traces/' + encodeURIComponent(projectId) + '/' + (sessionId ? encodeURIComponent(sessionId) + '/' : '') + encodeURIComponent(traceId) : '';
  const suffix = query.toString(), src = '/trace-monitor/' + detail + (suffix ? '?' + suffix : '');
  return <div className="trace-monitor-page"><iframe ref={frame} key={src} className="trace-monitor-frame" src={src} title="调用 Trace 列表与详情" /></div>;
}
