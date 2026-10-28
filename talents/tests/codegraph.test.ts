import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { graphView, type GraphOptions } from '../src/codegraph-model.ts';
import { codegraphSnapshot, withCodegraph, withoutCodegraph } from '../server/codegraph.ts';
import { seedState } from '../server/seed.ts';

const graph = codegraphSnapshot();
const options: GraphOptions = { level: 'symbol', service: '', tests: true, crossCalls: true, kinds: [], relation: '', focus: '', hops: 1 };

test('archived snapshot has valid endpoints and source locations without reading the current workspace', () => {
  const ids = new Set(graph.nodes.map(n => n.id));
  assert.equal(ids.size, graph.metadata.nodes);
  assert.equal(graph.edges.length, graph.metadata.edges);
  for (const edge of graph.edges) { assert.ok(ids.has(edge.source)); assert.ok(ids.has(edge.target)); }
  const digest = createHash('sha256');
  for (const [path, source] of Object.entries(graph.sources).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    digest.update(path).update('\0').update(createHash('sha256').update(source).digest('hex')).update('\0');
  }
  assert.equal(digest.digest('hex'), graph.metadata.sourceDigest);
  const method = graph.nodes.find(n => n.name === 'activate' && n.filePath.endsWith('application/CampaignApplicationService.java'))!;
  assert.ok(graph.sources[method.filePath].split('\n')[method.startLine - 1].includes('activate'));
  assert.ok(graph.edges.some(e => e.source === method.id && e.kind === 'calls'));
});

test('archived JSON and compressed CodeGraph database match their manifest checksums', () => {
  const directory = resolve('data/codegraph/snapshots', graph.metadata.snapshotId);
  const manifest = JSON.parse(readFileSync(resolve(directory, 'manifest.json'), 'utf8'));
  for (const name of ['graph.json', 'codegraph.db.gz']) {
    assert.equal(createHash('sha256').update(readFileSync(resolve(directory, name))).digest('hex'), manifest.checksums[name]);
  }
  const database = gunzipSync(readFileSync(resolve(directory, 'codegraph.db.gz')));
  assert.equal(database.subarray(0, 15).toString(), 'SQLite format 3');
  assert.equal(createHash('sha256').update(database).digest('hex'), manifest.checksums['codegraph.db']);
});

test('filters hide cross-service calls and tests; aggregate weights preserve original edge counts', () => {
  const before = JSON.stringify(graph);
  const view = graphView(graph, { ...options, level: 'service', tests: false, crossCalls: false });
  assert.ok(view.links.every(e => e.kind !== 'calls'));
  const filtered = new Set(graph.nodes.filter(n => !n.test).map(n => n.id));
  const expected = graph.edges.filter(e => filtered.has(e.source) && filtered.has(e.target) && e.crossService && e.kind !== 'calls').length;
  assert.equal(view.links.reduce((n, e) => n + e.count, 0), expected);
  assert.equal(JSON.stringify(graph), before, 'view projection must not mutate the stored snapshot');
  const files = graphView(graph, { ...options, level: 'file', service: 'marketing-service', tests: false });
  assert.ok(files.nodes.every(n => n.service === 'marketing-service' && !n.id.includes('/test/')));
});

test('one-hop symbol view is an induced neighborhood of the selected relation', () => {
  const center = graph.nodes.find(n => n.name === 'activate' && n.filePath.endsWith('application/CampaignApplicationService.java'))!;
  const view = graphView(graph, { ...options, relation: 'calls', focus: center.id });
  assert.ok(view.nodes.some(n => n.id === center.id));
  assert.ok(view.nodes.length > 1);
  for (const node of view.nodes) assert.ok(node.id === center.id || graph.edges.some(e => e.kind === 'calls'
    && ((e.source === center.id && e.target === node.id) || (e.target === center.id && e.source === node.id))));
  assert.ok(view.links.every(e => e.kind === 'calls'));
});

test('saved simulated statistics cannot replace the authoritative index metadata', () => {
  const state = seedState(), original = structuredClone(state);
  const artifact = withCodegraph(state).artifacts.find(a => a.id === 'a-cg-java')!;
  assert.deepEqual(artifact.stats?.map(([, value]) => Number(value.replaceAll(',', ''))), [graph.metadata.files, graph.metadata.nodes, graph.metadata.edges]);
  assert.equal(artifact.published?.basis?.commit, graph.metadata.revision);
  assert.deepEqual(state, original);
});

test('saving the shown state back does not store the snapshot values', () => {
  const stored = seedState(), shown = withCodegraph(stored);
  assert.notDeepEqual(shown, stored);
  assert.deepEqual(withoutCodegraph(structuredClone(shown), stored), stored);
  // A real change to the artifact is kept.
  const changed = structuredClone(shown), a = changed.artifacts.find(a => a.id === 'a-cg-java')!;
  a.published!.version += 1; a.published!.note = '远端索引已就绪';
  assert.equal(withoutCodegraph(changed, stored).artifacts.find(a => a.id === 'a-cg-java')!.published!.note, '远端索引已就绪');
});
