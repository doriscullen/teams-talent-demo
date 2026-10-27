import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { StoredGraphSnapshot } from '../../shared/codegraph.ts';
import type { TalentsState } from './model.ts';
import { root } from './config.ts';

const directory = join(root, 'data/codegraph');
let cached: StoredGraphSnapshot | undefined, stamp = '';
export function codegraphSnapshot(): StoredGraphSnapshot {
  const current = JSON.parse(readFileSync(join(directory, 'current.json'), 'utf8'));
  if (current.schemaVersion !== 1 || !/^[a-f0-9]{16}$/.test(current.snapshotId)) throw new Error('CodeGraph 归档指针无效');
  const path = join(directory, 'snapshots', current.snapshotId, 'graph.json');
  const stat = statSync(path), next = `${current.snapshotId}:${stat.mtimeMs}:${stat.size}`;
  if (stamp !== next || !cached) {
    const data = JSON.parse(readFileSync(path, 'utf8')) as StoredGraphSnapshot;
    if (data.schemaVersion !== 1 || data.metadata.project !== 'carddemo' || data.metadata.snapshotId !== current.snapshotId) throw new Error('CodeGraph 快照格式无效');
    cached = data; stamp = next;
  }
  return cached;
}

/** Snapshot metadata is authoritative even when a saved demo state still contains simulated counts. */
export function withCodegraph(state: TalentsState): TalentsState {
  const m = codegraphSnapshot().metadata;
  return { ...state, artifacts: state.artifacts.map(a => a.id !== 'a-cg-java' ? a : {
    ...a, stats: [['文件', m.files.toLocaleString('en-US')], ['节点', m.nodes.toLocaleString('en-US')], ['关系', m.edges.toLocaleString('en-US')]],
    ...(a.published ? { published: { ...a.published, at: m.indexedAt, note: `远端图谱快照 · ${m.snapshotId}`, basis: { commit: m.revision } } } : {}),
  }) };
}
/** Undoes withCodegraph on a state the page saves back: the snapshot values are only shown, never stored. */
export function withoutCodegraph(saved: TalentsState, previous: TalentsState): TalentsState {
  const before = previous.artifacts.find(a => a.id === 'a-cg-java');
  if (!before) return saved;
  const shown = withCodegraph({ ...previous, artifacts: [before] }).artifacts[0];
  return { ...saved, artifacts: saved.artifacts.map(a => {
    if (a.id !== 'a-cg-java') return a;
    const next = { ...a };
    if (isDeepStrictEqual(next.stats, shown.stats)) next.stats = before.stats;
    const p = next.published, q = shown.published;
    if (p && q && before.published && p.version === q.version && p.at === q.at && p.note === q.note && isDeepStrictEqual(p.basis, q.basis))
      next.published = { ...p, at: before.published.at, note: before.published.note, basis: before.published.basis };
    return next;
  }) };
}
