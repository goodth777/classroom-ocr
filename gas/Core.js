// Pure helpers (no Apps Script services) so node:test can check them.

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I

function makeCode(rand) {
  rand = rand || Math.random;
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(rand() * CODE_CHARS.length)];
  return s;
}

function makePin(rand) {
  rand = rand || Math.random;
  return String(Math.floor(rand() * 10000)).padStart(4, '0');
}

// Pasted rows "번호<tab|comma|spaces>이름" from Excel/NEIS; header and junk rows are skipped, first number wins.
function parseRoster(text) {
  const seen = {};
  const out = [];
  String(text || '').split(/\r?\n/).forEach(line => {
    const m = /^\s*(\d{1,3})\s*[\t,]?\s*(.+?)\s*$/.exec(line);
    if (!m || seen[m[1]]) return;
    seen[m[1]] = true;
    out.push({ number: +m[1], name: m[2] });
  });
  return out;
}

// Late once past 23:59:59 Korea time on the due date.
function isLate(submittedAt, due) {
  if (!due) return false;
  return Date.parse(submittedAt) > Date.parse(due + 'T23:59:59+09:00');
}

// Teacher table: students by number, assignments by creation, one cell per submission.
function buildGrid(students, assignments, submissions) {
  const cells = {};
  submissions.forEach(s => {
    (cells[s.studentId] = cells[s.studentId] || {})[s.assignmentId] = {
      state: 'TURNED_IN',
      late: !!s.late,
      updated: s.submittedAt,
      subId: s.id,
      text: s.text,
      photos: s.photoIds ? String(s.photoIds).split(',').length : 0,
    };
  });
  return {
    students: students.map(s => ({ id: s.id, number: +s.number, name: s.name })).sort((a, b) => a.number - b.number),
    works: assignments.map(a => ({ id: a.id, title: a.title, created: a.created, due: a.due || '', description: a.description || '' }))
      .sort((a, b) => String(a.created).localeCompare(String(b.created))),
    cells,
  };
}

if (typeof module !== 'undefined') module.exports = { makeCode, makePin, parseRoster, isLate, buildGrid };
