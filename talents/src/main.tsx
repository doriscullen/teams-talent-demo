// Boot: load state from the Talents service, then render the iCode Teams shell around the Talents pages.
// Teams links here as /talents?role=owner|member#/<page>?project=<id>; the role picks the entry.
import { Fragment, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Alert, App as AntApp, Button, ConfigProvider, Popconfirm, Select, Spin } from 'antd';
import zhCN from 'antd/locale/zh_CN.js';
import { ReloadOutlined } from '@ant-design/icons';
import { FrameworkSidebar } from './vendor/teams/components/framework-sidebar.tsx';
import { teamsTheme, type UiThemeMode } from './vendor/teams/theme.ts';
import { designSystemCss } from './vendor/teams/design-system.ts';
import { frameworkCss } from './vendor/teams/framework-styles.ts';
import { bootstrap, type Boot } from './api.ts';
import { home, levelHash, pages, roleLabel } from './navigation.ts';
import { TalentsProvider, useTalents } from './store.tsx';
import { artifact, member, project } from './demo/model.ts';
import type { Role } from './types.ts';
import { Projects, Team } from './pages/level.tsx';
import { Capabilities } from './pages/capabilities.tsx';
import { DevKnowledge } from './pages/dev-knowledge.tsx';
import { DevLocal } from './pages/dev-local.tsx';
import './shell.css';
import './talents.css';
const css = document.createElement('style'); css.textContent = designSystemCss + frameworkCss; document.head.prepend(css);

const content: Record<string, () => ReactNode> = {
  team: Team, projects: Projects, capabilities: Capabilities, knowledge: DevKnowledge, local: DevLocal,
};

function Shell({ mode, onToggleTheme }: { mode: UiThemeMode; onToggleTheme(): void }) {
  const { state: st, teams, route, role, go, reset, toast, teamsLink } = useTalents();
  const [width, setWidth] = useState(220);
  useEffect(() => { if (teams.from === 'none') toast('还没有读取到 iCode Teams 的数据，请先启动 Teams'); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // 管理员端 is the Teams owner; 开发者端 is a Teams member.
  const person = (r: Role) => member(st, r === 'admin' ? st.team.admin : st.team.me)?.name ?? '未读取到 Teams 成员';
  const page = route.page, Page = content[page.id];
  // The level shown (a project, or the team) and the artifact open in its review tab.
  const focus = page.id === 'projects' ? project(st, route.params.project) : null;
  const level = focus || page.id === 'team' ? focus?.id ?? null : undefined;
  const opened = level !== undefined && route.params.tab === 'review' ? artifact(st, route.params.id) : null;
  const crumbs: { label: string; href?: string }[] = focus ? [{ label: page.title, href: '#/projects' }, { label: focus.name }] : [{ label: page.title }];
  if (opened) { crumbs[crumbs.length - 1].href = levelHash(level!, 'review'); crumbs.push({ label: opened.name }); }
  const resetDemo = () => reset().then(() => { go('#/' + home[role]); toast('已恢复初始数据'); }, e => toast('重置失败：' + (e as Error).message));
  const projects = <div role="group" aria-label="项目列表">{st.projects.map(p => <a key={p.id} className={'child' + (focus?.id === p.id ? ' active' : '')} href={levelHash(p.id)} title={p.name} aria-current={focus?.id === p.id ? 'page' : undefined}>{p.name}</a>)}</div>;

  return <div className="framework-root" style={{ '--ui-shell-sidebar': width + 'px' } as CSSProperties}>
    <div className="framework-shell">
      <FrameworkSidebar pages={pages.filter(p => p.role === role)} navigation={role === 'admin' ? { projects } : {}} selected={page.id} context={{ projectId: focus?.id }}
        collapsed={false} width={width} onResize={setWidth} online themeMode={mode} onToggleTheme={onToggleTheme}
        account={{ nickname: person(role) + ' · ' + (role === 'admin' ? 'Owner' : '成员'), color: role === 'admin' ? 'var(--ui-color-avatar-5)' : 'var(--ui-color-avatar-2)' }} />
      <main className="framework-main">
        <header className="main-topbar compact-topbar">
          <nav className={'breadcrumb' + (crumbs.length > 1 ? ' project-breadcrumb' : '')} aria-label="当前位置">
            <Select className="compact-system-switch" aria-label="切换系统" size="small" variant="borderless" value="talent" popupMatchSelectWidth={180}
              onChange={value => { location.href = value === 'tools' ? new URL('/teams?demo-role=' + (role === 'admin' ? 'owner' : 'member') + '#/agent', teams.origin).toString() : teamsLink(); }}
              options={[{ value: 'teams', label: 'iCode Teams' }, { value: 'talent', label: 'Talents' }, { value: 'tools', label: 'iCode / OpenCode' }]} />
            {crumbs.map(c => <Fragment key={c.label}><span className="breadcrumb-separator">/</span>
              {c.href ? <a className="breadcrumb-parent" href={c.href}>{c.label}</a> : <strong aria-current="page" title={c.label}>{c.label}</strong>}</Fragment>)}
          </nav>
          <div className="topbar-right">
            <Select className="compact-role-switch" aria-label="切换入口" size="small" value={role} popupMatchSelectWidth={210} onChange={(value: Role) => go('#/' + home[value])}
              options={(['admin', 'dev'] as const).map(r => ({ value: r, label: person(r) + ' · ' + roleLabel[r] }))} />
            <Popconfirm title="重置数据？" description="新登记的本地文档来源、任务、修订、发布和应用记录会被清除，恢复到初始状态。团队、成员和项目来自 iCode Teams，不受影响。" okText="重置" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={resetDemo}>
              <Button type="text" size="small" aria-label="重置数据" title="重置数据" icon={<ReloadOutlined />}><span className="compact-action-label">重置数据</span></Button>
            </Popconfirm>
          </div>
        </header>
        <div className={'page-scroll' + (opened ? ' workbench-scroll' : '')} key={page.id + (focus?.id ?? '')}><Page /></div>
      </main>
    </div>
  </div>;
}

function Main() {
  const [mode, setMode] = useState<UiThemeMode>(() => localStorage.getItem('carddemo-theme') === 'dark' ? 'dark' : 'light');
  const [boot, setBoot] = useState<Boot>(), [fatal, setFatal] = useState('');
  useEffect(() => { document.documentElement.dataset.theme = mode; localStorage.setItem('carddemo-theme', mode); }, [mode]);
  useEffect(() => {
    bootstrap().then(b => {
      const role = new URLSearchParams(location.search).get('role');
      const entry: Role | null = role === 'owner' ? 'admin' : role === 'member' ? 'dev' : null;
      if (!location.hash) history.replaceState(null, '', location.pathname + location.search + '#/' + home[entry ?? b.state.role]);
      setBoot(b);
    }, e => setFatal((e as Error).message));
  }, []);
  let body;
  if (fatal) body = <div className="startup"><Alert type="error" title="无法连接 Talents 服务" description={fatal + '。请在 talents 目录运行 npm run dev，然后刷新页面。'} action={<Button onClick={() => location.reload()}>重试</Button>} /></div>;
  else if (!boot) body = <div className="startup"><Spin size="large" /><p>正在连接 Talents 服务…</p></div>;
  else body = <TalentsProvider boot={boot}><Shell mode={mode} onToggleTheme={() => setMode(mode === 'dark' ? 'light' : 'dark')} /></TalentsProvider>;
  return <ConfigProvider locale={zhCN} theme={teamsTheme(mode)}><AntApp>{body}</AntApp></ConfigProvider>;
}
createRoot(document.getElementById('root')!).render(<Main />);
