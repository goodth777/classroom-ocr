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
