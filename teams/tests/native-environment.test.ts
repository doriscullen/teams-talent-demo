import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loopbackProxyEnvironment } from '../scripts/native/native-environment.mjs';

test('native children bypass loopback without modifying inherited proxy settings', () => {
  const base = Object.freeze({ HTTP_PROXY: 'http://proxy.example:7897', HTTPS_PROXY: 'http://proxy.example:7897', ALL_PROXY: 'socks5://proxy.example:7898', http_proxy: 'http://lower.example:7897', NO_PROXY: ' .internal.example,127.0.0.1 ', no_proxy: 'localhost,service.internal,::1', PATH: '/tools', NO_COLOR: '1' });
  const result = loopbackProxyEnvironment(base);
  assert.equal(result.NO_PROXY, '.internal.example,127.0.0.1,localhost,service.internal,::1,[::1]');
  assert.equal(result.no_proxy, result.NO_PROXY);
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'PATH', 'NO_COLOR'] as const) assert.equal(result[key], base[key]);
  assert.equal(base.NO_PROXY, ' .internal.example,127.0.0.1 ');
  assert.deepEqual(loopbackProxyEnvironment(result), result);
});

test('missing or empty bypass values receive loopback defaults; existing wildcard remains explicit', () => {
  for (const base of [{}, { NO_PROXY: '', no_proxy: ' , ' }]) {
    assert.deepEqual(loopbackProxyEnvironment(base), { ...base, NO_PROXY: '127.0.0.1,localhost,::1,[::1]', no_proxy: '127.0.0.1,localhost,::1,[::1]' });
  }
  assert.equal(loopbackProxyEnvironment({ NO_PROXY: '*' }).no_proxy, '*,127.0.0.1,localhost,::1,[::1]');
});
