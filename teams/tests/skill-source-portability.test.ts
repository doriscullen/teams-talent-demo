import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sourceFiles from '../fixtures/skill-source-files.json';
import { loadSourceSkillPackage, type SkillSourceFiles } from '../server/skill-packages.js';
import { sha256, skillPackageDigest } from '../server/skill-installation.js';

const exec = promisify(execFile), repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const declaration: SkillSourceFiles = sourceFiles;
async function fixture(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'Skill source 字节 '));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
async function copySources(destination: string, ids = Object.keys(declaration.packages)) {
  for (const id of ids) for (const file of declaration.packages[id].files) {
    const path = join(destination, id, file.path); await mkdir(dirname(path), { recursive: true });
    await writeFile(path, await readFile(join(repo, 'workspace/skills', id, file.path)));
    await chmod(path, 0o644);
  }
}
async function files(directory: string, prefix = ''): Promise<string[]> {
  const result: string[] = [];
  for (const item of await readdir(join(directory, prefix), { withFileTypes: true })) {
    const path = prefix ? prefix + '/' + item.name : item.name;
    if (item.isDirectory()) result.push(...await files(directory, path)); else result.push(path);
  }
  return result.sort();
}

test('all 59 source packages retain Git-declared digest after executable bits are removed', () => fixture(async directory => {
  await copySources(directory);
  assert.equal(Object.keys(declaration.packages).length, 59);
  assert.equal(Object.values(declaration.packages).reduce((n, item) => n + item.files.length, 0), 345);
  for (const [id, expected] of Object.entries(declaration.packages)) {
    const actual = await loadSourceSkillPackage(id, directory);
    assert.equal(actual.sha256, skillPackageDigest(expected.files), id);
    assert.deepEqual(actual.files.map(({ bytes, ...file }) => file), expected.files.map(({ path, executable, sha256 }) => ({ path, sha256, executable })), id);
  }
  // The original four-requirement manifests are immutable identities, not regenerated expectations.
  for (const businessId of ['REQ-2026-001', 'REQ-2026-002', 'REQ-2026-003', 'REQ-2026-004']) for (const version of ['', 'v2']) {
    const provenance = JSON.parse(await readFile(join(repo, 'talents/content/four-requirements', businessId, version, 'provenance.json'), 'utf8'));
    assert.equal(provenance.skillPackages.length, 13);
    for (const expected of provenance.skillPackages) {
      const pkg = await loadSourceSkillPackage(expected.id, directory);
      assert.equal(pkg.version, expected.version); assert.equal(pkg.sha256, expected.sha256);
      assert.equal(pkg.files.find(file => file.path === 'SKILL.md')!.sha256, expected.contentSha256);
    }
  }
}));

test('changed bytes, missing/extra files and absent/invalid declarations fail without stat fallback', () => fixture(async directory => {
  const id = 'ba-requirement-analysis'; await copySources(directory, [id]);
  const path = join(directory, id, 'SKILL.md'), bytes = await readFile(path);
  await writeFile(path, Buffer.concat([bytes, Buffer.from('\nchanged')]));
  await assert.rejects(loadSourceSkillPackage(id, directory), /摘要不一致.*generate-skill-source-manifest/s);
  await writeFile(path, bytes); await writeFile(join(directory, id, 'undeclared.txt'), 'extra');
  await assert.rejects(loadSourceSkillPackage(id, directory), /未声明文件/);
  await rm(join(directory, id, 'undeclared.txt')); await rm(path);
  await assert.rejects(loadSourceSkillPackage(id, directory), /缺少已声明文件/);
  await writeFile(path, bytes);
  await assert.rejects(loadSourceSkillPackage(id, directory, { ...declaration, packages: {} }), /声明缺失/);
  const invalid = structuredClone(declaration); invalid.packages[id].files.push({ ...invalid.packages[id].files[0] });
  await assert.rejects(loadSourceSkillPackage(id, directory, invalid), /声明无效/);
  const explicit = { ...declaration, packages: { [id]: { files: declaration.packages[id].files.map(file => ({ ...file, executable: false })) } } };
  const testPackage = await loadSourceSkillPackage(id, directory, explicit);
  assert.ok(testPackage.files.every(file => !file.executable));
  assert.equal(testPackage.sha256, skillPackageDigest(explicit.packages[id].files));
}));

test('autocrlf checkout preserves mixed original Skill bytes and every pinned four-requirement document', () => fixture(async directory => {
  const source = join(directory, 'source'), checkout = join(directory, 'checkout'); await mkdir(source);
  await cp(join(repo, '.gitattributes'), join(source, '.gitattributes'));
  await copySources(join(source, 'workspace/skills'));
  await cp(join(repo, 'talents/content/four-requirements'), join(source, 'talents/content/four-requirements'), { recursive: true });
  const seedPath = 'shared/seed/talents/files';
  const artifacts = (await readdir(join(repo, seedPath))).filter(id => /^a-req-2026-00[1-4](?:-v2)?$/.test(id)).sort();
  assert.equal(artifacts.length, 8, 'both published versions of all four requirements must be committed');
  for (const id of artifacts) await cp(join(repo, seedPath, id), join(source, seedPath, id), { recursive: true });
  // This control file proves autocrlf is active rather than accidentally bypassed.
  await writeFile(join(source, 'control.txt'), 'one\ntwo\n');
  const git = (args: string[]) => exec('git', ['-C', source, ...args], { maxBuffer: 2 * 1024 * 1024 });
  await git(['init', '-q']); await git(['config', 'core.autocrlf', 'true']); await git(['add', '--', '.gitattributes', 'workspace/skills', 'talents/content/four-requirements', seedPath, 'control.txt']);
  await git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'portable source fixture']);
  await exec('git', ['clone', '--quiet', '--no-local', '-c', 'core.autocrlf=true', '-c', 'core.filemode=false', source, checkout]);
  assert.equal(await readFile(join(checkout, 'control.txt'), 'utf8'), 'one\r\ntwo\r\n');
  let crlf = 0, lf = 0;
  for (const [id, expected] of Object.entries(declaration.packages)) {
    for (const file of expected.files) {
      const path = join(checkout, 'workspace/skills', id, file.path), bytes = await readFile(path);
      assert.equal(sha256(bytes), file.sha256, id + '/' + file.path);
      if (bytes.includes(Buffer.from('\r\n'))) crlf++; else if (bytes.includes(10)) lf++;
      await chmod(path, 0o644);
    }
    assert.equal((await loadSourceSkillPackage(id, join(checkout, 'workspace/skills'))).sha256, skillPackageDigest(expected.files));
  }
  assert.ok(crlf > 0 && lf > 0, 'both original CRLF and LF source bytes are exercised');
  const documents = join(source, 'talents/content/four-requirements');
  for (const path of await files(documents)) assert.deepEqual(await readFile(join(checkout, 'talents/content/four-requirements', path)), await readFile(join(documents, path)), path);
  let sharedFiles = 0;
  for (const id of artifacts) for (const path of await files(join(source, seedPath, id))) {
    const checked = await readFile(join(checkout, seedPath, id, path)), original = await readFile(join(source, seedPath, id, path));
    assert.equal(sha256(checked), sha256(original), id + '/' + path); sharedFiles++;
    if (path.endsWith('/provenance.json')) {
      const provenance = JSON.parse(checked.toString('utf8'));
      for (const knowledge of provenance.knowledgeFiles) {
        const content = await readFile(join(checkout, seedPath, id, dirname(path).split('/')[0], knowledge.path));
        assert.equal(sha256(content), knowledge.sha256, 'shared seed ' + knowledge.path);
      }
    }
  }
  assert.equal(sharedFiles, 56, 'all eight published source manifests and full texts are checked');
}));
