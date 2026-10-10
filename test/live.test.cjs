const test = require('node:test');
const assert = require('node:assert');
const { quizPoints, liveSummary, livePublic, liveApply } = require('../gas/LiveCore.js');

const quiz = (phase = 'ask', i = 0) => ({ id: 'L', type: 'quiz', quiz: { title: 'T', limit: 20, i, phase, qs: [{ title: 'q1', options: ['a', 'b'], answer: 1 }, { title: 'q2', options: ['a', 'b', 'c'], answer: 0 }] } });

test('quiz points: faster is higher, wrong is zero', () => {
  assert.equal(quizPoints(true, 0, 20000), 1000);
  assert.equal(quizPoints(true, 20000, 20000), 500);
  assert.equal(quizPoints(true, 99999, 20000), 500);
  assert.equal(quizPoints(false, 0, 20000), 0);
});

test('quiz answer only for the open question, once', () => {
  const st = quiz(), me = {};
  assert.equal(liveApply(st, me, 'qz', { i: 1, c: 0, ms: 10 }), '이미 넘어간 문제예요.');
  assert.equal(liveApply(st, me, 'qz', { i: 0, c: 1, ms: 2000 }), '');
  liveApply(st, me, 'qz', { i: 0, c: 0, ms: 1 });
  assert.equal(me.qz[0].c, 1);
  // answer stays hidden while asking, then shows with points
  assert.equal(livePublic(st, null, me).quiz.answer, undefined);
  const rev = livePublic(quiz('reveal'), null, me).quiz;
  assert.equal(rev.answer, 1);
  assert.equal(rev.pts, 950);
  assert.equal(rev.total, 950);
});

test('quiz summary counts and totals', () => {
  const st = quiz('reveal');
  const sum = liveSummary(st, { s1: { qz: { 0: { c: 1, ms: 0 } } }, s2: { qz: { 0: { c: 0, ms: 0 } } } });
  assert.deepEqual(sum.per[0].counts, [1, 1]);
  assert.deepEqual(sum.score, { s1: 1000, s2: 0 });
});

test('vote, words with hidden, anonymous text', () => {
  const v = { type: 'vote', options: ['x', 'y'] };
  const me = {};
  assert.equal(liveApply(v, me, 'v', 5), '다시 골라 주세요.');
  liveApply(v, me, 'v', 1);
  assert.deepEqual(liveSummary(v, { s: me }).counts, [0, 1]);
  const w = { type: 'word', hidden: ['bad'] };
  const sum = liveSummary(w, { a: { w: ['Brave', 'bad'] }, b: { w: ['brave '] } });
  assert.deepEqual(sum.words, [{ w: 'Brave', n: 2 }]);
  const t = { type: 'text', anon: true };
  assert.equal(liveSummary(t, { a: { t: 'hi', at: '1' } }).items[0].sid, '');
});

test('a missing student entry still answers (null from the cache is not an entry)', () => {
  const me = {};
  assert.equal(liveApply({ type: 'light' }, me, 'v', 2), '');
  assert.equal(livePublic({ type: 'light' }, null, null).mine.v, undefined);
});
