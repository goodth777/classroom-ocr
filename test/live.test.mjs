import test from 'node:test';
import assert from 'node:assert';
import { quizPoints, quizTotal, liveSummary, publicResult, list } from '../web/livecore.js';

const quiz = (keys = {}) => ({ id: 'L', type: 'quiz', quiz: { title: 'T', limit: 20, i: 0, keys,
  qs: [{ title: 'q1', options: ['a', 'b'], answer: 1 }, { title: 'q2', options: ['a', 'b', 'c'], answer: 0 }] } });

test('quiz points: faster is higher, wrong is zero', () => {
  assert.equal(quizPoints(true, 0, 20000), 1000);
  assert.equal(quizPoints(true, 20000, 20000), 500);
  assert.equal(quizPoints(true, 99999, 20000), 500);
  assert.equal(quizPoints(false, 0, 20000), 0);
});

test('quiz totals count only revealed questions; the database may return answers as an array', () => {
  const entry = { qz: [{ c: 1, ms: 2000 }, { c: 0, ms: 0 }] };
  assert.equal(quizTotal({}, 20, entry), 0);
  assert.equal(quizTotal({ 0: 1 }, 20, entry), 950);
  assert.equal(quizTotal([1, 0], 20, entry), 1950);
});

test('quiz summary: counts per question and scores', () => {
  const sum = liveSummary(quiz({ 0: 1 }), { s1: { qz: { 0: { c: 1, ms: 0 } } }, s2: { qz: { 0: { c: 0, ms: 0 } } } });
  assert.deepEqual(sum.per[0].counts, [1, 1]);
  assert.deepEqual(sum.score, { s1: 1000, s2: 0 });
  assert.equal(sum.n, 2);
});

test('vote and light count numbers only; anonymous drops names', () => {
  const v = liveSummary({ type: 'vote', options: ['x', 'y'], anon: true }, { a: { v: 1 }, b: { v: 1 }, c: { t: 'x' } });
  assert.deepEqual(v.counts, [0, 2]);
  assert.deepEqual(v.who, {});
  const l = liveSummary({ type: 'light' }, { a: { v: 2 }, b: { v: 0 } });
  assert.deepEqual(l.counts, [1, 0, 1]);
  assert.deepEqual(l.who, { a: 2, b: 0 });
});

test('words merge case and spaces, skip hidden; words may arrive as array or object', () => {
  const sum = liveSummary({ type: 'word', hidden: ['bad'] }, { a: { w: ['Brave', 'bad'] }, b: { w: { 0: 'brave ' } } });
  assert.deepEqual(sum.words, [{ w: 'Brave', n: 2 }]);
  assert.equal(sum.n, 2);
  assert.deepEqual(publicResult(sum), { words: [{ w: 'Brave', n: 2 }], n: 2 });
});

test('opinions are ordered by time and anonymous ones carry no id', () => {
  const sum = liveSummary({ type: 'text', anon: true }, { a: { t: 'second', at: 2 }, b: { t: 'first', at: 1 } });
  assert.deepEqual(sum.items.map(x => x.t), ['first', 'second']);
  assert.equal(sum.items[0].sid, '');
  assert.deepEqual(list(null), []);
});
