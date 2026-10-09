const test = require('node:test');
const assert = require('node:assert');
const { makeCode, makePin, parseRoster, isLate, buildGrid } = require('../gas/Core.js');

test('makeCode gives 6 unambiguous characters', () => {
  let i = 0;
  const seq = [0, 0.1, 0.5, 0.99, 0.3, 0.7];
  const code = makeCode(() => seq[i++]);
  assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.strictEqual(code.length, 6);
});

test('makePin gives 4 digits', () => {
  assert.strictEqual(makePin(() => 0), '0000');
  assert.strictEqual(makePin(() => 0.99995), '9999');
});

test('parseRoster reads pasted number/name rows from Excel or NEIS', () => {
  const text = '번호\t이름\n1\t강수아\n2, 김민준\n\n 3  박지호 \n3\t중복\nabc\t무시\n12\tJohn Kim';
  assert.deepStrictEqual(parseRoster(text), [
    { number: 1, name: '강수아' },
    { number: 2, name: '김민준' },
    { number: 3, name: '박지호' },
    { number: 12, name: 'John Kim' },
  ]);
});

test('isLate compares against 23:59:59 Korea time on the due date', () => {
  assert.strictEqual(isLate('2026-10-09T14:59:59.000Z', '2026-10-09'), false); // 23:59:59 KST
  assert.strictEqual(isLate('2026-10-09T15:00:00.000Z', '2026-10-09'), true); // 10/10 00:00 KST
  assert.strictEqual(isLate('2026-12-01T00:00:00.000Z', ''), false);
});

test('buildGrid shapes rows for the teacher table', () => {
  const g = buildGrid(
    [{ id: 's2', number: 2, name: '김민준' }, { id: 's1', number: 1, name: '강수아' }],
    [{ id: 'a2', title: 'B', created: '2026-10-02T00:00:00Z', due: '2026-10-09' }, { id: 'a1', title: 'A', created: '2026-10-01T00:00:00Z', due: '' }],
    [{ id: 'x', assignmentId: 'a2', studentId: 's1', text: '글', photoIds: 'p1,p2', submittedAt: '2026-10-10T01:00:00Z', late: true }]
  );
  assert.deepStrictEqual(g.students.map(s => s.name), ['강수아', '김민준']);
  assert.deepStrictEqual(g.works.map(w => [w.id, w.due]), [['a1', ''], ['a2', '2026-10-09']]);
  assert.deepStrictEqual(g.cells.s1.a2, { state: 'TURNED_IN', late: true, updated: '2026-10-10T01:00:00Z', subId: 'x', preview: '글', photos: 2 });
  assert.strictEqual(g.cells.s2, undefined);
});

test('buildGrid keeps per-assignment targets (null = whole class)', () => {
  const g = buildGrid(
    [{ id: 's1', number: 1, name: 'A' }],
    [{ id: 'a1', title: 'A', created: '1', due: '', studentIds: '' }, { id: 'a2', title: 'B', created: '2', due: '', studentIds: 's1,s9' }],
    []
  );
  assert.deepStrictEqual(g.works.map(w => w.targets), [null, ['s1', 's9']]);
});

test('isTarget treats an empty list as the whole class', () => {
  const { isTarget } = require('../gas/Core.js');
  assert.strictEqual(isTarget({ studentIds: '' }, 's1'), true);
  assert.strictEqual(isTarget({ studentIds: 's2,s3' }, 's1'), false);
  assert.strictEqual(isTarget({ studentIds: 's2,s1' }, 's1'), true);
});

const { normShort, grade } = require('../gas/Core.js');

test('normShort ignores case, spaces and edge punctuation', () => {
  assert.strictEqual(normShort('  Mirror  Neuron. '), 'mirrorneuron');
  assert.strictEqual(normShort('"거울 신경세포"!'), '거울신경세포');
});

test('grade: mc, exact-set cb, short variants, long manual, scale ignored', () => {
  const qs = [
    { id: 'a', type: 'mc', options: ['x', 'y'], answer: 1, points: 2 },
    { id: 'b', type: 'cb', options: ['p', 'q', 'r'], answer: [0, 2], points: 3 },
    { id: 'c', type: 'short', answer: ['거울 신경세포', '거울 뉴런'], points: 5 },
    { id: 'd', type: 'long', points: 4 },
    { id: 'e', type: 'scale' },
  ];
  const r = grade(qs, { a: 1, b: [2, 0], c: ' 거울뉴런 ', d: 'essay', e: 4 });
  assert.deepStrictEqual(r.per.a, { got: 2, max: 2, ok: true });
  assert.deepStrictEqual(r.per.b, { got: 3, max: 3, ok: true });
  assert.deepStrictEqual(r.per.c, { got: 5, max: 5, ok: true });
  assert.deepStrictEqual(r.per.d, { got: 0, max: 4, ok: null });
  assert.strictEqual(r.per.e, undefined);
  assert.deepStrictEqual([r.score, r.max, r.pending], [10, 14, true]);
  const partial = grade(qs, { a: 0, b: [0], c: '거울', d: 'x' }, { d: 3 });
  assert.deepStrictEqual([partial.score, partial.pending, partial.per.b.ok, partial.per.d.ok], [3, false, false, false]); // 3 of 4 on the essay: scored, but not fully right
});

test('grade: a blank essay scores 0 instead of waiting for the teacher', () => {
  const r = grade([{ id: 'd', type: 'long', points: 4 }], {});
  assert.deepStrictEqual([r.per.d.ok, r.pending, r.score], [false, false, 0]);
});

const { planRoster } = require('../gas/Core.js');

test('parseRoster reads 5-digit student ids (학번) and keeps old number rows', () => {
  assert.deepStrictEqual(parseRoster('학번 이름\n20812 김민준\n20812 중복\n10101\t강수아\n3 박지호'), [
    { sno: '20812', number: 12, name: '김민준' },
    { sno: '10101', number: 1, name: '강수아' },
    { number: 3, name: '박지호' },
  ]);
});

test('planRoster fills ids by unique name, asks on same names, adds the rest', () => {
  const existing = [
    { id: 'a', number: 1, name: '강수아', sno: '' },
    { id: 'b', number: 2, name: '김민준', sno: '' },
    { id: 'c', number: 3, name: '김민준', sno: '' },
    { id: 'd', number: 4, name: '박지호', sno: '20804' },
  ];
  const plan = planRoster(parseRoster('20801 강수아\n20802 김민준\n20804 박지호\n20805 윤도윤\n6 최하은'), existing);
  assert.deepStrictEqual(plan.fill, [{ id: 'a', sno: '20801' }]);
  assert.deepStrictEqual(plan.ask, [{ sno: '20802', name: '김민준', candidates: ['b', 'c'] }]);
  assert.deepStrictEqual(plan.add, [{ sno: '20805', number: 5, name: '윤도윤' }, { number: 6, name: '최하은' }]);
  assert.strictEqual(plan.skip, 1);
  // a teacher's choice settles the same-name case
  const again = planRoster(parseRoster('20802 김민준'), existing, { 20802: 'c' });
  assert.deepStrictEqual([again.fill, again.ask, again.add], [[{ id: 'c', sno: '20802' }], [], []]);
  assert.deepStrictEqual(planRoster(parseRoster('20802 김민준'), existing, { 20802: 'new' }).add, [{ sno: '20802', number: 2, name: '김민준' }]);
});
