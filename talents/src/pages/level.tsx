// 团队、项目：两个同级的层级，各自有产物管理、知识任务和来源，在顶部页签间切换。
// 团队级的来源、任务和知识全团队通用，团队知识在每个项目中都可用；项目来自 iCode Teams。
import type { ReactNode } from 'react';
import { Badge, Button, Tabs, Tag } from 'antd';
import { ArrowLeftOutlined, ExportOutlined } from '@ant-design/icons';
import { PageHeader } from '../vendor/teams/components/page-layout.tsx';
import { useTalents } from '../store.tsx';
import { levelHash, levelTabs, type LevelTab } from '../navigation.ts';
import type { Project, Source, TalentsState } from '../types.ts';
import { artifact, levelSources, project } from '../demo/model.ts';
import { CardGrid, EmptyState, Fields, ItemCard, SourceIcon } from '../components/ui.tsx';
import { LevelSources } from './sources.tsx';
import { LevelTasks } from './tasks.tsx';
import { LevelReview, Workbench } from './review.tsx';
import { DiagnosisWorkbench } from './trajectory.tsx';
import { isDiagnosis, pendingCount } from '../demo/suggestions.ts';

/** The tabs of the level, with the current tab's actions on the right. */
export type Toolbar = (actions?: ReactNode) => ReactNode;
/** What waits for the admin in a level: artifacts to review, and diagnosis suggestions to apply. */
function waiting(st: TalentsState, pid: string | null) {
  const mine = st.artifacts.filter(a => a.projectId === pid);
  return { review: mine.filter(a => a.draft && !isDiagnosis(a)).length, suggestions: mine.reduce((n, a) => n + pendingCount(a), 0) };
}

export function Team() {
  return <Level pid={null} />;
}

export function Projects() {
  const { state: st, route } = useTalents();
  const p = project(st, route.params.project);
  return p ? <Level key={p.id} pid={p.id} /> : <ProjectList />;
}

function Level({ pid }: { pid: string | null }) {
  const { state: st, route, go } = useTalents();
  const tab: LevelTab = levelTabs.find(t => t.key === route.params.tab)?.key ?? 'review';
  const opened = tab === 'review' && route.params.id ? artifact(st, route.params.id) : null;
  if (tab === 'review' && route.params.id) return <div className="page-stack opened-page">
    <div><Button icon={<ArrowLeftOutlined />} onClick={() => go(levelHash(pid, 'review'))}>返回产物管理</Button></div>
    {opened?.kind === 'diagnosis' ? <DiagnosisWorkbench key={opened.id} id={opened.id} /> : <Workbench key={route.params.id} id={route.params.id} />}
  </div>;
  const p = project(st, pid), w = waiting(st, pid), pending = w.review + w.suggestions;
  const toolbar: Toolbar = actions => <div className="project-toolbar" role="region" aria-label={(p?.name ?? '团队') + '工具栏'}>
    <Tabs activeKey={tab} onChange={key => go(levelHash(pid, key as LevelTab))}
      items={levelTabs.map(t => ({ key: t.key, label: t.key === 'review' && pending ? <>{t.label} <Badge count={pending} size="small" color="var(--ui-color-primary)" /></> : t.label }))} />
    <div className="project-toolbar-actions">{actions}</div>
  </div>;
  const Body = { sources: LevelSources, tasks: LevelTasks, review: LevelReview }[tab];
  return <div className="page-stack level-page">
    {p ? <PageHeader title={p.name} />
      : <PageHeader title="团队" description="全团队通用的来源和知识，例如行内规范。团队知识在每个项目中都可用。" />}
    <Body key={tab} pid={pid} toolbar={toolbar} />
  </div>;
}

const names = (list: Source[]) => list.length ? list.map(s => s.name).join('、') : <span className="ui-note">无</span>;
function ProjectList() {
  const { state: st, go, teamsLink } = useTalents();
  const card = (p: Project) => {
    const list = levelSources(st, p.id), w = waiting(st, p.id), open = () => go(levelHash(p.id));
    return <ItemCard key={p.id} icon={<SourceIcon type="project" />} title={p.name} onClick={open}
      extra={<>{w.review > 0 && <Tag color="processing">{w.review} 个待审阅</Tag>}{w.suggestions > 0 && <Tag color="warning">{w.suggestions} 条建议待应用</Tag>}</>}
      actions={<Button type="link" size="small" onClick={open}>进入</Button>}>
      <Fields rows={[['代码仓', names(list.filter(s => s.type === 'repo'))], ['文档集', names(list.filter(s => s.type === 'docs'))]]} />
    </ItemCard>;
  };
  return <div className="page-stack">
    <PageHeader title="项目" description="项目来自 iCode Teams。进入项目，管理它的来源、知识任务和产物。"
      actions={<Button href={teamsLink(null)} icon={<ExportOutlined />}>在 iCode Teams 中管理项目</Button>} />
    {st.projects.length ? <CardGrid>{st.projects.map(card)}</CardGrid> : <EmptyState title="还没有项目">在 iCode Teams 中创建项目后，会出现在这里。</EmptyState>}
  </div>;
}
