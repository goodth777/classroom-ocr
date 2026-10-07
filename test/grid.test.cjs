const test = require('node:test');
const assert = require('node:assert');
const { buildGrid } = require('../gas/Grid.js');

test('buildGrid maps submissions into student x work cells', () => {
  const g = buildGrid(
    [
      { userId: 's2', profile: { name: { fullName: '홍길동' } } },
      { userId: 's1', profile: { name: { fullName: '김철수' } } },
    ],
    [
      { id: 'w2', title: 'B', creationTime: '2026-10-02T00:00:00Z', associatedWithDeveloper: true, alternateLink: 'W2' },
      { id: 'w1', title: 'A', creationTime: '2026-10-01T00:00:00Z' },
    ],
    [
      {
        userId: 's1', courseWorkId: 'w2', state: 'TURNED_IN', updateTime: '2026-10-03T00:00:00Z',
        assignmentSubmission: { attachments: [
          { driveFile: { id: 'old', alternateLink: 'O' } },
          { link: { url: 'x' } },
          { driveFile: { id: 'd1', alternateLink: 'L' } },
        ] },
      },
      { userId: 's2', courseWorkId: 'w1', state: 'CREATED' },
    ]
  );
  assert.deepStrictEqual(g.students.map(s => s.name), ['김철수', '홍길동']);
  assert.deepStrictEqual(g.works.map(w => [w.id, w.app]), [['w1', false], ['w2', true]]);
  assert.deepStrictEqual(g.works.map(w => w.link), ['', 'W2']);
  assert.deepStrictEqual(g.cells.s1.w2, { state: 'TURNED_IN', late: false, updated: '2026-10-03T00:00:00Z', docId: 'd1', link: 'L' });
  assert.deepStrictEqual(g.cells.s2.w1, { state: 'CREATED', late: false, updated: '', docId: null, link: '' });
});
