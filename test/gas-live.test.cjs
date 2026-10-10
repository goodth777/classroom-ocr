// End-to-end through the real server code: teacher starts an activity, students open and answer it.
const test = require('node:test');
const assert = require('node:assert');
const { sandbox } = require('./gas-sandbox.cjs');

function classroom() {
  const box0 = sandbox();
  const h = box0.tokenHash;
  const box = sandbox({
    Classes: [{ id: 'c1', name: '영어', section: '2-3', code: 'ABC123', kind: '' }],
    Students: [{ id: 's1', classId: 'c1', number: 1, name: '강수아', sno: '20301' }, { id: 's2', classId: 'c1', number: 2, name: '김민준', sno: '20302' }],
    Devices: [{ tokenHash: h('tok1'), studentId: 's1' }, { tokenHash: h('tok2'), studentId: 's2' }],
    Forms: [{ id: 'f1', classId: 'c1', kind: 'quiz', title: '어휘', status: 'draft', settings: '{}',
      questions: JSON.stringify([{ id: 'q1', type: 'mc', title: 'brave?', options: ['용감한', '친절한'], answer: 0 }, { id: 'q2', type: 'short', title: 'x', answer: ['a'] }]) }],
  });
  const T = (action, p = {}) => box.post({ action, key: 'teacher-key', classId: 'c1', ...p });
  const S = (tok, action, p = {}) => box.post({ action, token: tok, ...p });
  return { box, T, S };
}
const ok = r => { assert.equal(r.ok, true, r.error); return r.data; };

test('vote: start, students see it and answer, teacher counts, end saves a record', () => {
  const { T, S } = classroom();
  assert.equal(ok(S('tok1', 'live')), null);
  ok(T('liveStart', { type: 'vote', q: '주제는?', options: ['A', 'B'], anon: true }));
  const pub = ok(S('tok1', 'live'));
  assert.equal(pub.type, 'vote');
  assert.deepEqual(pub.options, ['A', 'B']);
  ok(S('tok1', 'liveAns', { id: pub.id, op: 'v', v: 1 }));
  ok(S('tok2', 'liveAns', { id: pub.id, op: 'v', v: 1 }));
  assert.deepEqual(ok(T('liveView')).sum.counts, [0, 2]);
  ok(T('liveEnd'));
  assert.equal(ok(S('tok1', 'live')), null);
  const recs = ok(T('lives'));
  assert.equal(recs.length, 1);
  assert.deepEqual(ok(T('liveRec', { id: recs[0].id })).sum.counts, [0, 2]);
});

test('quiz: only the open question, answer hidden until reveal, then points', () => {
  const { T, S } = classroom();
  const v = ok(T('liveStart', { type: 'quiz', formId: 'f1', limit: 20 }));
  assert.equal(v.st.quiz.qs.length, 1); // the short-answer question is left out
  const pub = ok(S('tok1', 'live'));
  assert.equal(pub.quiz.answer, undefined);
  ok(S('tok1', 'liveAns', { id: pub.id, op: 'qz', v: { i: 0, c: 0, ms: 0 } }));
  ok(S('tok2', 'liveAns', { id: pub.id, op: 'qz', v: { i: 0, c: 1, ms: 0 } }));
  ok(T('liveCtl', { op: 'reveal' }));
  const r1 = ok(S('tok1', 'live')).quiz, r2 = ok(S('tok2', 'live')).quiz;
  assert.equal(r1.answer, 0);
  assert.equal(r1.pts, 1000);
  assert.equal(r2.pts, 0);
  ok(T('liveCtl', { op: 'next' }));
  assert.equal(ok(S('tok1', 'live')).quiz.phase, 'end');
});

test('light: change any time, teacher reset clears', () => {
  const { T, S } = classroom();
  ok(T('liveStart', { type: 'light', q: '어땠나요?' }));
  const pub = ok(S('tok1', 'live'));
  ok(S('tok1', 'liveAns', { id: pub.id, op: 'v', v: 2 }));
  ok(S('tok1', 'liveAns', { id: pub.id, op: 'v', v: 0 }));
  assert.deepEqual(ok(T('liveView')).sum.counts, [1, 0, 0]);
  ok(T('liveCtl', { op: 'reset' }));
  assert.deepEqual(ok(T('liveView')).sum.counts, [0, 0, 0]);
});
