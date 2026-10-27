import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { locateChrysEngine } from '../server/engine-locate.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'engine-locate-'));
  return { root, done: () => rm(root, { recursive: true, force: true }) };
}
async function file(path: string) { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, ''); }

test('chrys.engine.locate returns the official entry plus native config and session roots', async () => {
  const { root, done } = await fixture();
  try {
    const local = join(root, 'local'), entry = join(local, 'chrys', 'bin', 'icode.exe');
    await file(entry);
    const result = await locateChrysEngine({
      platform: 'win32', env: { LOCALAPPDATA: local }, home: root, materialRoot: root,
      probe: async () => '0.32.0',
      environment: async () => ({ configDirectory: join(root, 'roaming', 'chrys'), sessionRoot: join(root, 'roaming', 'chrys', 'sessions') }),
    });
    assert.deepEqual(result.engine, {
      state: 'ready', entry, version: '0.32.0',
      config: join(root, 'roaming', 'chrys'), sessionRoot: join(root, 'roaming', 'chrys', 'sessions'), notes: [],
    });
  } finally { await done(); }
});

test('missing official launcher is none while a missing explicit override is failed', async () => {
  const { root, done } = await fixture();
  try {
    const missing = await locateChrysEngine({ platform: 'win32', env: { LOCALAPPDATA: join(root, 'local') }, home: root, materialRoot: root });
    assert.equal(missing.engine.state, 'none');
    assert.match(missing.engine.reason ?? '', /未找到可用的 iCode/);

    const override = join(root, 'explicit', 'icode.exe');
    const failed = await locateChrysEngine({ platform: 'win32', env: { DEMO_ICODE_BINARY: override, LOCALAPPDATA: join(root, 'local') }, home: root, materialRoot: root });
    assert.equal(failed.engine.state, 'failed');
    assert.equal(failed.engine.entry, override);
    assert.match(failed.engine.reason ?? '', /显式配置/);
  } finally { await done(); }
});

test('a probe failure is failed and a missing native environment keeps the locate usable', async () => {
  const { root, done } = await fixture();
  try {
    const local = join(root, 'local'), entry = join(local, 'chrys', 'bin', 'icode.exe');
    await file(entry);
    const failed = await locateChrysEngine({ platform: 'win32', env: { LOCALAPPDATA: local }, home: root, materialRoot: root, probe: async () => { throw new Error('broken launcher'); } });
    assert.equal(failed.engine.state, 'failed');
    assert.match(failed.engine.reason ?? '', /版本探测失败/);

    const fallback = await locateChrysEngine({ platform: 'win32', env: { LOCALAPPDATA: local, APPDATA: join(root, 'roaming') }, home: root, materialRoot: root, probe: async () => '0.32.0', environment: async () => { throw new Error('python unavailable'); } });
    assert.equal(fallback.engine.state, 'ready');
    assert.equal(fallback.engine.config, join(root, 'roaming', 'chrys'));
    assert.equal(fallback.engine.sessionRoot, join(root, 'roaming', 'chrys', 'sessions'));
    assert.ok(fallback.engine.notes?.some(note => note.includes('平台默认位置')));
  } finally { await done(); }
});
