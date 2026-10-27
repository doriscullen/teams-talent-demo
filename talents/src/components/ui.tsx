// Building blocks shared by the pages: cards, labelled fields, sections and status tags.
import type { ReactNode } from 'react';
import { Card, Empty, Tag } from 'antd';
import { BranchesOutlined, CodeOutlined, ExperimentOutlined, FileSearchOutlined, FileTextOutlined, FolderOpenOutlined, MessageOutlined, ProjectOutlined, ToolOutlined } from '@ant-design/icons';
import type { Artifact, Capability, Source } from '../types.ts';
import { status } from '../demo/knowledge.ts';
import { isDiagnosis, pendingCount } from '../demo/suggestions.ts';

const capIcons: Record<string, ReactNode> = { index: <FileSearchOutlined />, doc: <FileTextOutlined />, code: <CodeOutlined />, traj: <ExperimentOutlined /> };
export const CapIcon = ({ cap }: { cap: Capability }) => <>{capIcons[cap.cat] ?? <FileTextOutlined />}</>;
const sourceIcons: Record<string, ReactNode> = { repo: <BranchesOutlined />, docs: <FolderOpenOutlined />, sessions: <MessageOutlined />, skills: <ToolOutlined /> };
export const SourceIcon = ({ type }: { type: Source['type'] | 'skills' | 'project' }) => <>{type === 'project' ? <ProjectOutlined /> : sourceIcons[type]}</>;

/** Labelled values, one per row: [label, value]; falsy rows are skipped. */
export function Fields({ rows }: { rows: ([ReactNode, ReactNode] | false | null | undefined | '')[] }) {
  return <dl className="fields">{rows.filter((r): r is [ReactNode, ReactNode] => !!r).map(([label, value], i) => <div key={i}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

export function ItemCard({ icon, title, subtitle, extra, children, caption, actions, onClick, className }: {
  icon: ReactNode; title: ReactNode; subtitle?: ReactNode; extra?: ReactNode; children?: ReactNode;
  caption?: ReactNode; actions?: ReactNode; onClick?: () => void; className?: string;
}) {
  return <Card size="small" hoverable={!!onClick} onClick={onClick} className={'item-card' + (className ? ' ' + className : '')}>
    <div className="item-card-head"><span className="item-icon">{icon}</span><div className="grow"><h3>{title}</h3>{subtitle && <div className="item-subtitle">{subtitle}</div>}</div>{extra}</div>
    {children}
    {(caption || actions) && <div className="item-card-foot"><span className="caption">{caption}</span>{actions && <div className="actions" onClick={e => e.stopPropagation()}>{actions}</div>}</div>}
  </Card>;
}

export function Section({ title, note, children }: { title: ReactNode; note?: ReactNode; children: ReactNode }) {
  return <section className="talents-section"><div className="section-head"><h2>{title}</h2>{note && <span className="ui-note">{note}</span>}</div>{children}</section>;
}
export const CardGrid = ({ children }: { children: ReactNode }) => <div className="card-grid">{children}</div>;
export const EmptyState = ({ title, children }: { title?: ReactNode; children?: ReactNode }) =>
  <Empty className="talents-empty" image={Empty.PRESENTED_IMAGE_SIMPLE} description={<>{title && <b>{title}</b>}{children && <span>{children}</span>}</>} />;

export function ArtifactStatus({ a }: { a: Artifact }) {
  if (isDiagnosis(a)) return pendingCount(a) ? <Tag color="warning">待应用</Tag> : <Tag color="success">建议已处理</Tag>;
  const st = status(a);
  if (st === 'draft') return <Tag color="warning">待审阅</Tag>;
  if (st === 'update') return <Tag color="warning">新版本待审阅</Tag>;
  return <Tag color="success">已发布 v{a.published!.version}</Tag>;
}
/** 新 / 改 / 删 markers next to file names. */
export const FileMark = ({ kind }: { kind: 'new' | 'mod' | 'del' }) =>
  <Tag className="file-mark" bordered={false} color={kind === 'new' ? 'success' : kind === 'del' ? 'error' : 'warning'}>{{ new: '新', mod: '改', del: '删' }[kind]}</Tag>;
