import { displayText } from './display-text.js';
import { campaign } from './cashback.js';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Alert, Button, ConfigProvider, Descriptions, Drawer, Popconfirm, Select, Space, Spin, Tag, Tooltip, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN.js';
import { ApartmentOutlined, ArrowLeftOutlined, ArrowRightOutlined, BookOutlined, CodeOutlined, ExperimentOutlined, FileTextOutlined, MenuFoldOutlined, MenuUnfoldOutlined, QuestionCircleOutlined, ReloadOutlined, RobotOutlined } from '@ant-design/icons';
import { bootstrap, act, updateWorkspace, getState, reset, type Presentation } from './api.js';
import type { WorkspaceAction } from './workspace.js';
import { Context } from './context.js';
import { actionLabels, type Action, type DemoState, type Role } from './domain.js';
import { FrameworkSidebar } from './vendor/teams/components/framework-sidebar.js';
import { FrameworkCard } from './vendor/teams/components/page-layout.js';
import { teamsTheme, type UiThemeMode } from './vendor/teams/theme.js';
import { designSystemCss } from './vendor/teams/design-system.js';
import { frameworkCss } from './vendor/teams/framework-styles.js';
import { isOwnerPage, teamsPages } from './navigation.js';
import { Home } from './pages/home.js';
import { Project } from './pages/project.js';
import { TeamsProject } from './pages/teams-project.js';
import { CreatedProjectPage } from './pages/created-project.js';
import { Resources } from './pages/resources.js';
import { Tools } from './pages/tools.js';
import { Trace } from './pages/trace.js';
import { TeamWork } from './pages/team-work.js';
import { Organization } from './pages/organization.js';
import { Team } from './pages/team.js';
import { Heading, Origin } from './components/common.js';
import { currentSystemContext, systemRuntime, talentLink, teamsLink } from './system-links.js';
import './style.css';
import './shell-navigation.css';
const css = document.createElement('style'); css.textContent = designSystemCss + frameworkCss; document.head.prepend(css);
const titles: Record<string, string> = { home: '工作台', projects: '项目', team:'团队', resources: '资源市场', subscriptions: '我的订阅', publications: '我的发布', agent: 'Agent 管理', connections: '企业连接', organization: '企业连接', 'team-work': '任务追溯', 'trace-monitor': '任务追溯', trace: '需求执行记录', knowledge: '项目知识', sessions: '轨迹分析与知识挖掘', evolution: '能力演进', account: '个人设置', settings: '个人设置' };
const route = () => { const raw = location.hash.replace(/^#\/?/, '') || 'home'; const [path, query] = raw.split('?'); return { path, params: new URLSearchParams(query) }; };
const channel = new BroadcastChannel('teams-talent-carddemo');
function App() {
  const [boot, setBoot] = useState<{ state: DemoState; data: Presentation }>();
  const [fatal, setFatal] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [role, setRole] = useState<Role>(currentSystemContext().role);
  const [mode, setMode] = useState<UiThemeMode>(localStorage.getItem('carddemo-theme') === 'dark' ? 'dark' : 'light');
  const [current, setCurrent] = useState(route), [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem('teams-sidebar-width'));
    return Number.isFinite(saved) && saved >= 200 && saved <= 480 ? saved : 200;
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('teams-sidebar-collapsed') === 'true');
  const [detail, setDetail] = useState<{ title: string; content: string } | null>(null);
  const resetting = useRef(false);
  useEffect(() => {
    bootstrap().then(b => setBoot(b)).catch(e => setFatal(e.message));
    const change = () => { setCurrent(route()); }; window.addEventListener('hashchange', change);
    let live = true;
    const refresh = () => { getState().then(state => { if (live) setBoot(b => b && state.revision > b.state.revision ? { ...b, state } : b); }).catch(e => { if (live) setError(e.message); }); };
    const sync = (e: MessageEvent) => { if (e.data === 'state') refresh(); };
    channel.addEventListener('message', sync); window.addEventListener('focus', refresh);
    const timer = window.setInterval(() => { if (!document.hidden) refresh(); }, 2000);
    return () => { live = false; clearInterval(timer); window.removeEventListener('hashchange', change); channel.removeEventListener('message', sync); window.removeEventListener('focus', refresh); };
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = mode; localStorage.setItem('carddemo-theme', mode); }, [mode]);
  useEffect(() => { localStorage.setItem('teams-sidebar-collapsed', String(sidebarCollapsed)); }, [sidebarCollapsed]);
  const resizeSidebar = (value: number) => { setWidth(value); localStorage.setItem('teams-sidebar-width', String(value)); };
  useEffect(() => { localStorage.setItem('carddemo-role', role); const url = new URL(location.href); url.searchParams.set('demo-role', role); history.replaceState(null, '', url); }, [role]);
  useEffect(() => { document.title = 'iCode Teams · ' + (titles[current.path] ?? '项目'); if (current.path === 'talent' && role === 'owner') location.href = talentLink('knowledge'); }, [current.path]);
  useEffect(() => {
    if (current.path !== 'trace-monitor') return;
    const params = new URLSearchParams(current.params); params.set('tab', 'sessions'); params.set('view', 'traces');
    location.replace('#/team-work?' + params.toString());
  }, [current.path, current.params]);
  const run = useCallback(async <T,>(work: () => Promise<T>, success?: string): Promise<T | undefined> => {
    setBusy(true); setError(''); setNotice('');
    try { const result = await work(); if (success) setNotice(success); return result; }
    catch (e) { setError((e as Error).message); return undefined; }
    finally { setBusy(false); }
  }, []);
  const receiveState = useCallback((state: DemoState) => { setBoot(current => current && state.revision >= current.state.revision ? { ...current, state } : current); }, []);
  const navigate = useCallback((target: string) => { location.hash = '/' + target; }, []);
  if (fatal) return <div className="startup"><Alert type="error" title="无法连接服务" description={displayText(fatal)} action={<Button onClick={() => location.reload()}>重试</Button>} /></div>;
  if (!boot) return <div className="startup"><Spin size="large" /><p>正在连接工作区…</p></div>;
  const { state, data } = boot;
  const perform = async (action: Action, reason?: string, assigneeId?: string) => {
    const result = await run(() => act(state, role, action, reason, assigneeId), actionLabels[action] + '已完成');
    if (result) { setBoot({ ...boot, state: result }); channel.postMessage('state'); }
    return !!result;
  };
  const update=async(kind:WorkspaceAction,payload:Record<string,unknown>)=>{
    const result=await run(()=>updateWorkspace(state,role,kind,payload),'数据已更新');
    if(result){setBoot({ ...boot,state:result});channel.postMessage('state');}
    return result;
  };
  const showText = (title: string, content: string) => setDetail({ title, content });
  const showEvidence = (id: string) => { const e = data.evidence.find(e => e.id === id); if (e) showText(id + ' · ' + e.title, e.body); };
  const resetDemo = async () => {
    if (role !== 'owner' || busy || resetting.current) return;
    resetting.current = true;
    try {
      const result = await run(() => reset(state, role), '本地工作区已恢复初始状态，源码和本机工具保持不变');
      if (result) { setBoot({ ...boot, state: result }); channel.postMessage('state'); navigate('home'); }
    } finally { resetting.current = false; }
  };
  const selected = current.path === 'organization' ? 'connections' : current.path === 'trace-monitor' ? 'team-work' : current.path === 'trace' ? (role === 'owner' ? 'team-work' : 'projects') : current.path;
  const projectId = currentSystemContext().projectId;
  const projectTab = current.params.get('tab') ?? (current.params.has('project') ? 'content' : 'list');
  const createdProject = current.path === 'projects' ? state.workspace.projects?.find(project => project.id === projectId) : undefined;
  const importedProject = current.path === 'projects' && projectId === 'teams';
  const projectSelected = current.path === 'projects' && projectTab !== 'list' || current.path === 'trace' && role === 'member';
  const projectName = current.path === 'projects' && projectSelected
    ? importedProject ? data.teamsProject.project.name : projectId === 'carddemo' ? state.workspace.project.name : createdProject?.name
    : undefined;
  const switchRole = (value: Role) => {
    const url = new URL(location.href);
    url.searchParams.set('demo-role', value);
    // Task selection is shared within the project and survives role changes.
    setDetail(null); setError(''); setNotice('');
    history.replaceState(null, '', url); setCurrent(route());
    localStorage.setItem('carddemo-role', value); setRole(value);
  };
  let content: React.ReactNode;
  if (role !== 'owner' && isOwnerPage(current.path)) content = <Alert type="info" title="此页面面向项目 Owner" description="成员可在项目任务中查看自己的执行记录与检查报告。" action={<Button href="#/projects">进入我的项目</Button>} />;
  else if (current.path === 'home') content = <Home />;
  else if (current.path === 'projects') content = projectTab === 'list' ? <Project tab="list" /> : importedProject ? <TeamsProject params={current.params} /> : projectId === 'carddemo' ? <Project tab={projectTab} node={current.params.get('node') ?? undefined} /> : createdProject ? <CreatedProjectPage key={createdProject.id} project={createdProject} tab={projectTab} /> : <Alert type="error" title="项目不存在" action={<Button onClick={()=>navigate('projects?tab=list')}>查看项目列表</Button>}/>;
  else if (current.path === 'team') content = <Team />;
  else if (['resources', 'subscriptions', 'publications'].includes(current.path)) content = <Resources page={current.path as 'resources' | 'subscriptions' | 'publications'} />;
  else if (current.path === 'agent') content = <Tools />;
  else if (['connections', 'organization'].includes(current.path)) content = <Organization key={current.path + current.params.toString()} />;
  else if (current.path === 'team-work') content = <TeamWork />;
  else if (current.path === 'trace-monitor') content = <Spin />;
  else if (current.path === 'trace') content = <Trace initial={current.params.get('evidence') ?? undefined} />;
  else if (['account', 'settings'].includes(current.path)) content = <div className="page-stack"><Heading title={titles[current.path]} description="查看当前角色与项目权限，维护本地工作区。" /><FrameworkCard title="项目权限"><Descriptions bordered column={1} items={[{ key: 'owner', label: '林悦 · 项目 Owner', children: '团队运营、组织能力、项目知识准备、共享发布、需求分配、业务验收、能力演进' }, { key: 'member', label: '陈晨 · 项目成员', children: '需求材料与上下文准备、能力采用、开发检查、成果提交' }, { key: 'demo', label: '当前角色', children: '可切换当前工作角色；身份认证尚未接入。' }]} /><Button href="#/projects?tab=settings">项目成员与角色</Button></FrameworkCard>
    <FrameworkCard title="工作区维护"><p>重置会将本地项目及资产关联、需求材料、团队与成员配置、连接设置、资源发布与订阅、任务交付状态恢复为初始值；新建项目和后续记录会被清除。</p><p className="muted">源码、原始资料和本机工具不受影响；重置后需重新构建项目知识与演进结果。</p>{role === 'owner' ? <Popconfirm title="重置整个工作区？" description="将清除新建项目、补充材料、成员配置、发布订阅及交付记录，并恢复初始工作区。此操作无法撤销。" okText="确认重置" cancelText="取消" onConfirm={resetDemo} disabled={busy} okButtonProps={{ danger: true, loading: busy, disabled: busy, 'aria-label': '确认重置工作区' }} cancelButtonProps={{ disabled: busy, 'aria-label': '取消重置' }}><Button danger aria-label="重置工作区" icon={<ReloadOutlined />} loading={busy} disabled={busy}>重置工作区</Button></Popconfirm> : <p className="muted">仅项目 Owner 可重置工作区；当前成员没有执行权限。</p>}</FrameworkCard>
  </div>;
  else content = <Alert type="warning" title="页面不存在" action={<Button href="#/home">返回工作台</Button>} />;
  return <ConfigProvider locale={zhCN} theme={teamsTheme(mode)}><Context.Provider value={{ state, data, role, busy, perform, update, run, showText, showEvidence, navigate, receiveState }}>
    <div onClickCapture={event=>{const link=(event.target as HTMLElement).closest('a');if(role === 'owner' && link?.getAttribute('href')==='#/talent'){event.preventDefault();location.href=talentLink('knowledge');}}} className="framework-root" style={{ '--ui-shell-sidebar': width + 'px' } as React.CSSProperties}>

      <div className={'framework-shell' + (sidebarCollapsed ? ' teams-navigation-collapsed' : '')}>{
        <FrameworkSidebar pages={teamsPages(role)} navigation={{ projects: <div role="group" aria-label="项目列表">{[{id:'carddemo',name:state.workspace.project.name},{id:'teams',name:data.teamsProject.project.name},...(state.workspace.projects??[])].map(project=><a key={project.id} className={'child'+(projectSelected&&projectId===project.id?' active':'')} href={'#/projects?project='+project.id+'&tab=content'} title={project.name} aria-current={projectSelected&&projectId===project.id?'page':undefined}>{project.name}</a>)}</div> }} selected={selected} context={{ teamId: importedProject ? 'teams' : 'carddemo', projectId: projectSelected ? projectId : undefined }} collapsed={sidebarCollapsed} width={width} onResize={resizeSidebar} online={true} themeMode={mode} onToggleTheme={() => setMode(mode === 'dark' ? 'light' : 'dark')} account={{ nickname: role === 'owner' ? '林悦 · Owner' : '陈晨 · 成员', color: role === 'owner' ? 'var(--ui-color-avatar-5)' : 'var(--ui-color-avatar-2)' }} />}
        <main className="framework-main"><header className="main-topbar compact-topbar">
          {<Tooltip title={sidebarCollapsed ? '展开左侧导航' : '收起左侧导航'}><Button className="global-navigation-toggle" type="text" aria-label={sidebarCollapsed ? '展开左侧导航' : '收起左侧导航'} aria-expanded={!sidebarCollapsed} icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => setSidebarCollapsed(value => !value)} /></Tooltip>}
          <nav className={'breadcrumb' + (projectName ? ' project-breadcrumb' : '')} aria-label="当前位置">
            <Select className="compact-system-switch" aria-label="切换系统" size="small" variant="borderless" value={current.path === 'agent' ? 'tools' : 'teams'} popupMatchSelectWidth={180} onChange={value=>{location.href=value==='talent'?talentLink('knowledge'):value==='tools'?teamsLink('agent'):teamsLink('home');}} options={[{value:'teams',label:'iCode Teams'},...(role === 'owner' ? [{value:'talent',label:'Talents'}] : []),{value:'tools',label:'iCode / OpenCode'}]}/>
            <span className="breadcrumb-separator">/</span>{projectName ? <><a className="breadcrumb-parent" href="#/projects?tab=list">项目</a><span className="breadcrumb-separator">/</span><strong aria-current="page" title={projectName}>{projectName}</strong></> : <strong aria-current="page" title={titles[current.path] ?? '项目'}>{titles[current.path] ?? '项目'}</strong>}
          </nav>
          <div className="topbar-right">

            <Select className="compact-role-switch" aria-label="切换角色" size="small" value={role} onChange={switchRole} popupMatchSelectWidth={210} options={[{value:'owner',label:'林悦 · 项目 Owner'},{value:'member',label:'陈晨 · 项目成员'}]}/>
          </div>
        </header>
          <div className={'page-scroll' + (projectName ? ' project-page-scroll' : '')} key={current.path + role}>{error && <Alert className="global-alert" type="error" showIcon title={displayText(error)} closable onClose={() => setError('')} />}{notice && <Alert className="global-alert" type="success" showIcon title={displayText(notice)} closable onClose={() => setNotice('')} />}{state.campaignId !== campaign.id && <Alert type="warning" title="工作区规则版本已更新" description="当前保存记录属于旧规则，请由 Owner 在个人设置中重置工作区后继续。" action={<Button href="#/account">前往个人设置</Button>} />}{content}<footer className="page-foot"><span>{createdProject ? createdProject.name+' · 项目' : importedProject ? 'iCode Teams · 项目' : 'MKT-001 · Teams × iCode × Talents'}</span></footer></div>
        </main></div>
    </div>
    <Drawer width={880} open={!!detail} onClose={() => setDetail(null)} title={detail?.title}><pre className="evidence-console drawer-console">{detail?.content}</pre></Drawer>

  </Context.Provider></ConfigProvider>;
}
createRoot(document.getElementById('root')!).render(<App />);
