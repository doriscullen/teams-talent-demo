import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nativeConfigRoot, nativeSessionsRoot, officialICodePaths, resolveICodeBinary } from '../server/icode-binary.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'icode-binary-'));
  return { root, done: () => rm(root, { recursive: true, force: true }) };
}
async function file(path: string) { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, ''); }

test('explicit DEMO_ICODE_BINARY wins and a missing override does not fall through', async () => {
  const { root, done } = await fixture();
  try {
    const explicit = join(root, 'tools', 'icode.exe');
    await file(explicit);
    const resolved = resolveICodeBinary({ platform: 'win32', env: { DEMO_ICODE_BINARY: explicit, LOCALAPPDATA: join(root, 'local') }, home: root, materialRoot: root });
    assert.equal(resolved.path, explicit);
    assert.equal(resolved.source, 'override');

    const missing = join(root, 'tools', 'missing.exe');
    const failed = resolveICodeBinary({ platform: 'win32', env: { DEMO_ICODE_BINARY: missing, LOCALAPPDATA: join(root, 'local') }, home: root, materialRoot: root });
    assert.equal(failed.path, missing);
    assert.equal(failed.source, 'override');
    assert.ok(failed.notes.some(note => note.includes('不存在或不可用')));
  } finally { await done(); }
});

test('official Windows launcher is found without configuration and chrys.exe remains compatible', async () => {
  const { root, done } = await fixture();
  try {
    const local = join(root, 'local');
    const icode = join(local, 'chrys', 'bin', 'icode.exe');
    await file(icode);
    const resolved = resolveICodeBinary({ platform: 'win32', env: { LOCALAPPDATA: local }, home: root, materialRoot: root });
    assert.equal(resolved.path, icode);
    assert.equal(resolved.source, 'official');
    assert.deepEqual(officialICodePaths({ platform: 'win32', env: { LOCALAPPDATA: local }, home: root }), [icode, join(local, 'chrys', 'bin', 'chrys.exe')]);

    const chrysOnly = join(root, 'other', 'chrys', 'bin', 'chrys.exe');
    await file(chrysOnly);
    const compat = resolveICodeBinary({ platform: 'win32', env: { LOCALAPPDATA: join(root, 'other') }, home: root, materialRoot: root });
    assert.equal(compat.path, chrysOnly);
    assert.equal(compat.source, 'official');
  } finally { await done(); }
});

test('official macOS/Linux launcher and the repository bundle are ordered after it', async () => {
  const { root, done } = await fixture();
  try {
    const official = join(root, '.local', 'bin', 'icode');
    await file(official);
    const resolved = resolveICodeBinary({ platform: 'linux', env: {}, home: root, materialRoot: root });
    assert.equal(resolved.path, official);
    assert.equal(resolved.source, 'official');

    const { root: empty, done: doneEmpty } = await fixture();
    try {
      const bundled = join(empty, 'runtime', 'icode-0.31.0', 'icode');
      await file(bundled);
      const fallback = resolveICodeBinary({ platform: 'linux', env: {}, home: empty, materialRoot: empty });
      assert.equal(fallback.path, bundled);
      assert.equal(fallback.source, 'bundled');
      assert.ok(fallback.notes.some(note => note.includes('开发包')));
    } finally { await doneEmpty(); }
  } finally { await done(); }
});

test('missing launcher is reported with the official candidates instead of throwing', async () => {
  const { root, done } = await fixture();
  try {
    const resolved = resolveICodeBinary({ platform: 'win32', env: { LOCALAPPDATA: join(root, 'local') }, home: root, materialRoot: root });
    assert.equal(resolved.source, 'missing');
    assert.equal(resolved.path, join(root, 'local', 'chrys', 'bin', 'icode.exe'));
    assert.ok(resolved.notes.some(note => note.includes('官方安装位置')));
  } finally { await done(); }
});

test('native configuration and session roots follow the platform contract', async () => {
  const { root, done } = await fixture();
  try {
    const windows = { platform: 'win32' as const, env: { APPDATA: join(root, 'roaming') }, home: root };
    assert.equal(nativeConfigRoot(windows), join(root, 'roaming', 'chrys'));
    assert.equal(nativeSessionsRoot(windows), join(root, 'roaming', 'chrys', 'sessions'));
    const posix = { platform: 'linux' as const, env: {}, home: root };
    assert.equal(nativeConfigRoot(posix), join(root, '.chrys'));
    assert.equal(nativeSessionsRoot(posix), join(root, '.chrys', 'sessions'));
  } finally { await done(); }
});
