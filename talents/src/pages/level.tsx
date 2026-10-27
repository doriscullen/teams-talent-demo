// 团队、项目：两个同级的层级，各自有来源、知识任务和产物审阅，在顶部页签间切换。
// 团队级的来源、任务和知识全团队通用，团队知识在每个项目中都可用；项目来自 iCode Teams。
import type { ReactNode } from 'react';
import { Badge, Button, Tabs, Tag } from 'antd';
import { ExportOutlined } from '@ant-design/icons';
import { PageHeader } from '../vendor/teams/components/page-layout.tsx';
import { useTalents } from '../store.tsx';
import { levelHash, levelTabs, type LevelTab } from '../navigation.ts';
import type { Project, Source, TalentsState } from '../types.ts';
import { levelSources, project } from '../demo/model.ts';
import { CardGrid, EmptyState, Fields, ItemCard, SourceIcon } from '../components/ui.tsx';
import { LevelSources } from './sources.tsx';
import { LevelTasks } from './tasks.tsx';
import { LevelReview, Workbench } from './review.tsx';

/** The tabs of the level, with the current tab's actions on the right. */
export type Toolbar = (actions?: ReactNode) => ReactNode;
const pendingReview = (st: TalentsState, pid: string | null) => st.artifacts.filter(a => a.projectId === pid && a.draft).length;

export function Team() {
  return <Level pid={null} />;
}

export function Projects() {
  const { state: st, route } = useTalents();
  const p = project(st, route.params.project);
  return p ? <Level key={p.id} pid={p.id} /> : <ProjectList />;
}

function Level({ pid }: { pid: string | null }) {
  const { state: st, route, go, teamsLink } = useTalents();
  const tab: LevelTab = levelTabs.find(t => t.key === route.params.tab)?.key ?? 'sources';
  if (tab === 'review' && route.params.id) return <Workbench key={route.params.id} id={route.params.id} />;
  const p = project(st, pid), pending = pendingReview(st, pid);
  const toolbar: Toolbar = actions => <div className="project-toolbar" role="region" aria-label={(p?.name ?? '团队') + '工具栏'}>
    <Tabs activeKey={tab} onChange={key => go(levelHash(pid, key as LevelTab))}
      items={levelTabs.map(t => ({ key: t.key, label: t.key === 'review' && pending ? <>{t.label} <Badge count={pending} size="small" color="var(--ui-color-primary)" /></> : t.label }))} />
    <div className="project-toolbar-actions">{actions}</div>
  </div>;
  const Body = { sources: LevelSources, tasks: LevelTasks, review: LevelReview }[tab];
  return <div className="page-stack">
    {p ? <PageHeader title={p.name} description={p.description} actions={<Button href={teamsLink(p.id)} icon={<ExportOutlined />}>在 iCode Teams 中管理</Button>} />
      : <PageHeader title="团队" description="全团队通用的来源和知识，例如行内规范。团队知识在每个项目中都可用。" />}
    <Body key={tab} pid={pid} toolbar={toolbar} />
  </div>;
}

const names = (list: Source[]) => list.length ? list.map(s => s.name).join('、') : <span className="ui-note">无</span>;
function ProjectList() {
  const { state: st, go, teamsLink } = useTalents();
  const card = (p: Project) => {
    const list = levelSources(st, p.id), pending = pendingReview(st, p.id), open = () => go(levelHash(p.id));
    return <ItemCard key={p.id} icon={<SourceIcon type="project" />} title={p.name} subtitle={p.description} onClick={open}
      extra={pending > 0 && <Tag color="processing">{pending} 个待审阅</Tag>} actions={<Button type="link" size="small" onClick={open}>进入</Button>}>
      <Fields rows={[['代码仓', names(list.filter(s => s.type === 'repo'))], ['文档集', names(list.filter(s => s.type === 'docs'))]]} />
    </ItemCard>;
  };
  return <div className="page-stack">
    <PageHeader title="项目" description="项目来自 iCode Teams。进入项目，管理它的来源、知识任务和产物。"
      actions={<Button href={teamsLink(null)} icon={<ExportOutlined />}>在 iCode Teams 中管理项目</Button>} />
    {st.projects.length ? <CardGrid>{st.projects.map(card)}</CardGrid> : <EmptyState title="还没有项目">在 iCode Teams 中创建项目后，会出现在这里。</EmptyState>}
  </div>;
}
