// Read one consistent SQLite transaction; no CodeGraph internals or native addons required.
import { DatabaseSync, backup } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync, renameSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const project = resolve(root, 'workspace/carddemo-java-1025');
const output = resolve(root, 'talents/data/codegraph');
const temp = mkdtempSync(resolve(tmpdir(), 'carddemo-codegraph-'));
const databasePath = resolve(temp, 'codegraph.db');
const live = new DatabaseSync(resolve(project, '.codegraph/codegraph.db'), { readOnly: true });
let db;
try {
  // SQLite backup includes committed WAL pages and produces a standalone, consistent database.
  await backup(live, databasePath);
  live.close();
  db = new DatabaseSync(databasePath, { readOnly: true });
  db.exec('BEGIN');
  for (const [table, fields] of Object.entries({ nodes: ['id', 'kind', 'file_path', 'start_line'], edges: ['id', 'source', 'target', 'kind', 'provenance'], files: ['path', 'content_hash', 'errors'] })) {
    const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
    if (fields.some(f => !columns.has(f))) throw new Error(`Unsupported CodeGraph schema: ${table}`);
  }
  const meta = Object.fromEntries(db.prepare('SELECT key, value FROM project_metadata').all().map(r => [r.key, r.value]));
  if (meta.index_state !== 'complete') throw new Error('CodeGraph index is incomplete; finish indexing before exporting');
  const nodes = db.prepare(`SELECT id, kind, name, language, qualified_name AS qualifiedName, file_path AS filePath,
    start_line AS startLine, end_line AS endLine, signature FROM nodes ORDER BY id`).all().map(n => {
    const parts = n.filePath.split('/');
    return { ...n, service: parts[0] === 'services' ? parts[1] : 'project',
      layer: ['interfaces', 'application', 'domain', 'infrastructure'].find(p => parts.includes(p)) ?? 'other', test: parts.includes('test') };
  });
  const byId = new Map(nodes.map(n => [n.id, n]));
  const edges = db.prepare('SELECT id, source, target, kind, line, provenance FROM edges ORDER BY id').all().map(e => {
    if (!byId.has(e.source) || !byId.has(e.target)) throw new Error(`Dangling edge ${e.id}`);
    return { ...e, crossService: byId.get(e.source).service !== byId.get(e.target).service };
  });
  const files = db.prepare('SELECT path, content_hash, errors FROM files ORDER BY path').all();
  const sources = {};
  const digest = createHash('sha256');
  for (const f of files) {
    const path = resolve(project, f.path);
    if (!path.startsWith(project + sep)) throw new Error(`Invalid source path ${f.path}`);
    // An old demo index remains exportable after the workspace changes. Only attach matching source.
    try {
      const bytes = readFileSync(path);
      if (createHash('sha256').update(bytes).digest('hex') === f.content_hash) sources[f.path] = bytes.toString('utf8');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    digest.update(f.path).update('\0').update(f.content_hash).update('\0');
  }
  const count = list => list.reduce((a, n) => ({ ...a, [n.kind]: (a[n.kind] ?? 0) + 1 }), {});
  const sourceDigest = digest.digest('hex');
  const indexedAt = new Date(Number(db.prepare('SELECT max(indexed_at) AS t FROM files').get().t)).toISOString();
  const metadata = { project: 'carddemo', root: relative(root, project).split(sep).join('/'), toolVersion: meta.indexed_with_version,
    indexedAt, exportedAt: new Date().toISOString(), revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: project, encoding: 'utf8' }).trim(),
    sourceDigest, snapshotId: createHash('sha256').update(JSON.stringify([meta.indexed_with_version, meta.indexed_with_extraction_version, indexedAt, sourceDigest, nodes, edges])).digest('hex').slice(0, 16),
    files: files.length, nodes: nodes.length, edges: edges.length,
    parseErrors: files.filter(f => f.errors && JSON.parse(f.errors).length).length,
    unresolved: Number(db.prepare('SELECT count(*) AS n FROM unresolved_refs').get().n),
    crossServiceCalls: edges.filter(e => e.kind === 'calls' && e.crossService).length,
    nodeKinds: count(nodes), edgeKinds: count(edges) };
  db.exec('COMMIT');
  const destination = resolve(output, 'snapshots', metadata.snapshotId);
  const checksum = bytes => createHash('sha256').update(bytes).digest('hex');
  if (!existsSync(destination)) {
    const staging = resolve(output, 'snapshots', '.' + metadata.snapshotId + '.tmp');
    mkdirSync(staging, { recursive: true });
    const graph = Buffer.from(JSON.stringify({ schemaVersion: 1, metadata, nodes, edges, sources }) + '\n');
    const database = readFileSync(databasePath), compressed = gzipSync(database, { level: 9 });
    writeFileSync(resolve(staging, 'graph.json'), graph);
    writeFileSync(resolve(staging, 'codegraph.db.gz'), compressed);
    writeFileSync(resolve(staging, 'manifest.json'), JSON.stringify({ schemaVersion: 1, snapshotId: metadata.snapshotId,
      metadata, databaseSchema: db.prepare('SELECT * FROM schema_versions ORDER BY version').all(),
      checksums: { 'graph.json': checksum(graph), 'codegraph.db.gz': checksum(compressed), 'codegraph.db': checksum(database) },
      sizes: { 'graph.json': graph.length, 'codegraph.db.gz': compressed.length, 'codegraph.db': database.length } }, null, 2) + '\n');
    renameSync(staging, destination);
  } else {
    const manifest = JSON.parse(readFileSync(resolve(destination, 'manifest.json'), 'utf8'));
    for (const file of ['graph.json', 'codegraph.db.gz']) {
      if (checksum(readFileSync(resolve(destination, file))) !== manifest.checksums[file]) throw new Error(`Archive checksum mismatch: ${file}`);
    }
  }
  writeFileSync(resolve(output, 'current.json.tmp'), JSON.stringify({ schemaVersion: 1, snapshotId: metadata.snapshotId }, null, 2) + '\n');
  renameSync(resolve(output, 'current.json.tmp'), resolve(output, 'current.json'));
  console.log(JSON.stringify(metadata, null, 2));
} finally { db?.close(); if (live.isOpen) live.close(); rmSync(temp, { recursive: true, force: true }); }
