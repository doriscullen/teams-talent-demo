import { TaskSessions } from '../components/task-sessions.js';
import { useEffect, useState } from 'react';
import { Alert, Button, Descriptions, Space, Tag } from 'antd';
import { CheckCircleOutlined, CodeOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { useDemo } from '../context.js';
import { getEngineLocation, getTools, native, type NativeStatus } from '../api.js';
import { FrameworkCard } from '../vendor/teams/components/page-layout.js';
import { Origin, Mono } from '../components/common.js';
import { AgentManagement } from '../components/agent-management.js';

export function NativeControls({ compact = false }: { compact?: boolean }) {
  const { role, run, state, showText } = useDemo();
  const [status, setStatus] = useState<NativeStatus>(), [pending, setPending] = useState(''), [error, setError] = useState(''), [receipt, setReceipt] = useState<any>(null);
  useEffect(() => { let live = true; getTools().then(s => { if (live) setStatus(s); }).catch(e => { if (live) setError(e.message); }); return () => { live = false; }; }, []);
  const launch = async () => {
    setPending('start'); setError('');
    try { setReceipt(await native(role, 'launch', { tool: 'icode', restore: false, requestId: crypto.randomUUID() })); }
    catch (e) { setError((e as Error).message); } finally { setPending(''); }
  };
  const context = async () => { await run(async () => { const value = await native(role, 'context'); showText('iCode 作业上下文 · 已导出文件', value.path + '\n\n建议在 iCode 输入：\n' + value.prompt + '\n\n' + value.content); }); };
  const copyContext = async () => { await run(async () => { const value = await native(role, 'context'); await navigator.clipboard.writeText(value.prompt); }, 'iCode 上下文读取指令已复制'); };
  return <div className="native-controls">
    {!compact && <Descriptions column={1} size="small" items={[
      { key: 'version', label: '配套实例', children: status?.icode.version ?? '正在探测…' },
      { key: 'source', label: '发现方式', children: status?.icode.source === 'official' ? '官方安装位置自动发现' : status?.icode.source === 'override' ? 'DEMO_ICODE_BINARY 显式配置' : status?.icode.source === 'bundled' ? '仓库内开发包' : status?.icode.source === 'missing' ? '未发现可用安装' : '正在探测…' },
      { key: 'directory', label: '项目工作目录', children: <Mono>{status?.icode.workspace ?? '正在读取…'}</Mono> },
    ]} />}
    {!!status?.icode.notes?.length && <Alert type="warning" title="iCode 探测说明" description={status.icode.notes.join('；')} />}
    <Space wrap><Button type="primary" icon={<CodeOutlined />} loading={pending === 'start'} disabled={!status?.icode.installed || !!pending} onClick={() => void launch()}>启动 iCode</Button><Button onClick={() => { setError(''); void getEngineLocation().then(value => showText('chrys.engine.locate', JSON.stringify(value, null, 2))).catch(e => setError((e as Error).message)); }}>引擎定位</Button>{state.context && <><Button onClick={() => void context()}>导出作业上下文</Button><Button onClick={() => void copyContext()}>复制上下文指令</Button></>}</Space>
    {error && <Alert type="error" title="本机操作未完成" description={error} showIcon />}
    {receipt && <Alert type="success" showIcon title={'已请求 ' + (receipt.terminal ?? '本机终端') + ' 打开工具'} description={receipt.note} />}
    <p className="muted native-note">启动前请确认本机已安装 iCode。作业上下文需在工具中显式读取，不会自动发送模型请求。</p>
  </div>;
}

export function Tools() {
  return <AgentManagement nativeControls={<NativeControls />} />;
}

export function SessionReporting(){ return <div className="page-stack"><TaskSessions readonly/><FrameworkCard title="开发工具" action={<Origin kind="native"/>}><NativeControls compact/></FrameworkCard></div>; }
