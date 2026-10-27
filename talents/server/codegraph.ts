import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
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
