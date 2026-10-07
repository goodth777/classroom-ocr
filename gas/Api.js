// Public functions are called from the PWA via the Apps Script API (scripts.run)
// and run as the calling user, so Classroom enforces who may see or change what.

function whoami() {
  const pick = c => ({ id: c.id, name: c.name, section: c.section || '' });
  const courses = who => list_(p => Classroom.Courses.list({ [who]: 'me', courseStates: ['ACTIVE'], pageToken: p }), 'courses');
  return { teaching: courses('teacherId').map(pick), learning: courses('studentId').map(pick) };
}

function list_(fetchPage, key) {
  const out = [];
  let token;
  do {
    const res = fetchPage(token);
    (res[key] || []).forEach(x => out.push(x));
    token = res.nextPageToken;
  } while (token);
  return out;
}
