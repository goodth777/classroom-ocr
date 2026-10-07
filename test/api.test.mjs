import test from 'node:test';
import assert from 'node:assert';
import { makeCall } from '../web/api.js';

const reply = body => ({ json: async () => body });
const noSleep = async () => {};

test('call posts the action with auth as text/plain JSON and returns data', async () => {
  let seen;
  const call = makeCall({
    url: 'U', auth: () => ({ token: 'T' }), sleep: noSleep,
    fetchFn: async (url, opts) => { seen = { url, opts }; return reply({ ok: true, data: 42 }); },
  });
  assert.strictEqual(await call('me', { x: 1 }), 42);
  assert.strictEqual(seen.url, 'U');
  assert.strictEqual(seen.opts.method, 'POST');
  assert.strictEqual(seen.opts.headers['Content-Type'], 'text/plain;charset=utf-8');
  assert.deepStrictEqual(JSON.parse(seen.opts.body), { action: 'me', token: 'T', x: 1 });
});

test('server errors keep their message and code', async () => {
  const call = makeCall({ url: 'U', auth: () => ({}), sleep: noSleep,
    fetchFn: async () => reply({ ok: false, code: 'auth', error: '다시 참여해 주세요.' }) });
  await assert.rejects(call('me'), { message: '다시 참여해 주세요.', code: 'auth' });
});

test('busy and network failures are retried, reporting each retry', async () => {
  const retries = [];
  let n = 0;
  const call = makeCall({ url: 'U', auth: () => ({}), sleep: noSleep,
    fetchFn: async () => {
      n++;
      if (n === 1) throw new TypeError('Failed to fetch');
      if (n === 2) return reply({ ok: false, code: 'busy', error: 'busy' });
      return reply({ ok: true, data: 'done' });
    } });
  assert.strictEqual(await call('ocr', {}, { onRetry: i => retries.push(i) }), 'done');
  assert.deepStrictEqual(retries, [1, 2]);
});

test('gives up with an offline error after the retries', async () => {
  const call = makeCall({ url: 'U', auth: () => ({}), sleep: noSleep, fetchFn: async () => { throw new TypeError('x'); } });
  await assert.rejects(call('me'), { code: 'offline' });
});
