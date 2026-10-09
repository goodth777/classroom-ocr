import test from 'node:test';
import assert from 'node:assert';
import { summarize, missing } from '../web/formlogic.js';

const form = { kind: 'quiz', settings: {}, studentIds: '', questions: [
  { id: 'a', type: 'mc', title: 'A', options: ['x', 'y'], answer: 1, points: 1 },
  { id: 'b', type: 'cb', title: 'B', options: ['p', 'q'] },
  { id: 'c', type: 'scale', title: 'C' },
  { id: 'd', type: 'short', title: 'D' },
] };
const rs = [
  { studentId: 's1', answers: { a: 1, b: [0, 1], c: 4, d: 'Hi ' }, score: 1, max: 1, per: { a: { ok: true } } },
  { studentId: 's2', answers: { a: 0, b: [1], c: 2, d: 'hi' }, score: 0, max: 1, per: { a: { ok: false } } },
];

test('summarize counts choices, averages scales, groups same text', () => {
  const s = summarize(form, rs);
  assert.strictEqual(s.n, 2);
  assert.deepStrictEqual(s.items[0].counts, [1, 1]);
  assert.deepStrictEqual(s.items[1].counts, [1, 2]);
  assert.strictEqual(s.items[2].avg, 3);
  assert.deepStrictEqual(s.items[2].counts, [0, 1, 0, 1, 0]);
  assert.deepStrictEqual(s.items[3].groups, [{ text: 'Hi', n: 2 }]);
  assert.strictEqual(s.quiz.avg, 0.5);
  assert.strictEqual(s.quiz.rate.a, 0.5);
});

test('missing lists target students without a response', () => {
  const roster = [{ id: 's1' }, { id: 's2' }, { id: 's3' }];
  assert.deepStrictEqual(missing({ ...form, studentIds: 's1,s3' }, roster, rs).map(s => s.id), ['s3']);
  assert.deepStrictEqual(missing(form, roster, rs).map(s => s.id), ['s3']);
});
