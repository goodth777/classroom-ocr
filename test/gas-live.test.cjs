// Live activities through the real server code (gas/*.js via doPost): sign-in tokens, rules install, records.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { sandbox } = require('./gas-sandbox.cjs');

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const FCM_KEY = JSON.stringify({ client_email: 'sa@test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: 'https://oauth2.googleapis.com/token', project_id: 'p' });

function classroom(props = {}) {
  const h = t => crypto.createHash('sha256').update(t).digest('hex');
  const box = sandbox({
    _props: { FCM_KEY, ...props },
    Classes: [{ id: 'c1', name: '영어', section: '2-3', code: 'ABC123', kind: '' }],
    Students: [{ id: 's1', classId: 'c1', number: 1, name: '강수아', sno: '20301' }, { id: 's2', classId: 'c1', number: 2, name: '김민준', sno: '20302' }],
    Devices: [{ tokenHash: h('tok1'), studentId: 's1' }],
  });
  const T = (action, p = {}) => box.post({ action, key: 'teacher-key', classId: 'c1', ...p });
  const S = (action, p = {}) => box.post({ action, token: 'tok1', ...p });
  return { box, T, S };
}
const ok = r => { assert.equal(r.ok, true, r.error); return r.data; };
const READY = { LIVE_RULES_V: '1', LIVE_CHECK: JSON.stringify({ ok: true, out: [] }) };

test('a student gets a Firebase custom token for their own class, signed by the service account', () => {
  const { S } = classroom(READY);
  const a = ok(S('liveAuth'));
  assert.equal(a.uid, 's1');
  assert.equal(a.c, 'c1');
  const [head, body, sig] = a.token.split('.');
  assert.ok(crypto.verify('RSA-SHA256', Buffer.from(head + '.' + body), publicKey, Buffer.from(sig, 'base64url')));
  const claims = JSON.parse(Buffer.from(body, 'base64url'));
  assert.equal(claims.iss, 'sa@test.iam.gserviceaccount.com');
  assert.equal(claims.aud, 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit');
  assert.deepEqual(claims.claims, { c: 'c1' });
  assert.ok(claims.exp - claims.iat <= 3600);
});

test('the teacher token carries the teacher claim; a wrong key gets nothing', () => {
  const { T, box } = classroom(READY);
  const a = ok(T('tLiveAuth'));
  assert.deepEqual(JSON.parse(Buffer.from(a.token.split('.')[1], 'base64url')).claims, { t: true });
  assert.equal(box.post({ action: 'tLiveAuth', key: 'nope' }).code, 'auth');
});

test('the first sign-in installs the database rules once', () => {
  const { S, box } = classroom();
  S('liveAuth'); // the fake network answers 200 with no ID token, so the self-check fails, but the rules went out
  const put = box.fetched.find(f => f.url.endsWith('/.settings/rules.json'));
  assert.ok(put, 'rules were sent');
  assert.equal(put.opt.method, 'put');
  assert.match(put.opt.headers.Authorization, /^Bearer /);
  const rules = JSON.parse(put.opt.payload).rules;
  assert.ok(rules.live.$c['.read'].includes('auth.token.c === $c'));
  assert.ok(rules.ans.$c.$a.$uid.qz.$i['.validate'].includes('!data.exists()'));
  // a failed check is not retried on every request (at most once a minute)
  const n = box.fetched.length;
  S('liveAuth');
  assert.equal(box.fetched.length, n);
  assert.equal(ok(box.post({ action: 'liveHealth' })).ok, false);
});

test('the teacher saves a finished activity once; names only when not anonymous', () => {
  const { T } = classroom(READY);
  const rec = { id: 'a1', type: 'vote', st: { id: 'a1', type: 'vote', q: '주제는?', options: ['A', 'B'], anon: false, started: Date.now() }, sum: { type: 'vote', counts: [0, 2], n: 2 } };
  ok(T('liveSave', { rec }));
  ok(T('liveSave', { rec })); // a retry does not make a second row
  const rows = ok(T('lives'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, '주제는?');
  const r = ok(T('liveRec', { id: 'a1' }));
  assert.deepEqual(r.sum.counts, [0, 2]);
  assert.equal(r.names.s1, '강수아');
  ok(T('liveSave', { rec: { ...rec, id: 'a2', st: { ...rec.st, id: 'a2', anon: true } } }));
  assert.deepEqual(ok(T('liveRec', { id: 'a2' })).names, {});
  assert.equal(ok(T('liveRecDel', { id: 'a1' })).length, 1);
});
