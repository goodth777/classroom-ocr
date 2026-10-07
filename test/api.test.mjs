import test from 'node:test';
import assert from 'node:assert';
import { makeRunner } from '../web/api.js';

const reply = (status, body) => ({ status, json: async () => body });

test('run posts to scripts.run and returns the result', async () => {
  let seen;
  const run = makeRunner({
    scriptId: 'SID',
    getToken: async () => 'T',
    fetchFn: async (url, opts) => { seen = { url, opts }; return reply(200, { done: true, response: { result: 42 } }); },
  });
  assert.strictEqual(await run('ocr', 'abc', 'image/jpeg'), 42);
  assert.strictEqual(seen.url, 'https://script.googleapis.com/v1/scripts/SID:run');
  assert.strictEqual(seen.opts.headers.Authorization, 'Bearer T');
  assert.deepStrictEqual(JSON.parse(seen.opts.body), { function: 'ocr', parameters: ['abc', 'image/jpeg'] });
});

test('run throws the script error message', async () => {
  const run = makeRunner({
    scriptId: 'SID',
    getToken: async () => 'T',
    fetchFn: async () => reply(200, { done: true, error: { message: 'ScriptError', details: [{ errorMessage: '과제를 찾을 수 없어요.' }] } }),
  });
  await assert.rejects(run('submit'), { message: '과제를 찾을 수 없어요.' });
});

test('run refreshes the token once on 401', async () => {
  const forced = [];
  let calls = 0;
  const run = makeRunner({
    scriptId: 'SID',
    getToken: async force => { forced.push(!!force); return force ? 'NEW' : 'OLD'; },
    fetchFn: async () => (++calls === 1 ? reply(401, {}) : reply(200, { response: { result: 'ok' } })),
  });
  assert.strictEqual(await run('whoami'), 'ok');
  assert.deepStrictEqual(forced, [false, true]);
});
