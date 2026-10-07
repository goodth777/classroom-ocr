// Public functions are called from the PWA via the Apps Script API (scripts.run)
// and run as the calling user, so Classroom enforces who may see or change what.

function whoami() {
  const pick = c => ({ id: c.id, name: c.name, section: c.section || '' });
  const courses = who => list_(p => Classroom.Courses.list({ [who]: 'me', courseStates: ['ACTIVE'], pageToken: p }), 'courses');
  let name = '';
  try { name = Classroom.UserProfiles.get('me').name.fullName; } catch (e) {}
  return { name: name, teaching: courses('teacherId').map(pick), learning: courses('studentId').map(pick) };
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

const Subs_ = () => Classroom.Courses.CourseWork.StudentSubmissions;

function listMyAssignments() {
  const courses = list_(p => Classroom.Courses.list({ studentId: 'me', courseStates: ['ACTIVE'], pageToken: p }), 'courses');
  const cards = [];
  courses.forEach(c => {
    const works = list_(p => Classroom.Courses.CourseWork.list(c.id, { courseWorkStates: ['PUBLISHED'], pageToken: p }), 'courseWork')
      .filter(w => w.associatedWithDeveloper);
    if (!works.length) return;
    const mine = {};
    list_(p => Subs_().list(c.id, '-', { userId: 'me', pageToken: p }), 'studentSubmissions')
      .forEach(s => { mine[s.courseWorkId] = s; });
    works.forEach(w => {
      const s = mine[w.id] || {};
      cards.push({
        courseId: c.id, courseName: c.name, section: c.section || '', workId: w.id, title: w.title,
        description: w.description || '', due: ymd_(w.dueDate), state: s.state || 'NEW', updated: s.updateTime || '',
      });
    });
  });
  return cards;
}

// Drive converts an image to a Google Doc with OCR; we read the text and drop the temp doc.
function ocr(base64, mimeType) {
  const blob = Utilities.newBlob(Utilities.base64Decode(base64), mimeType, 'ocr-temp');
  const file = Drive.Files.create({ name: 'ocr-temp', mimeType: MimeType.GOOGLE_DOCS }, blob, { ocrLanguage: 'ko' });
  try {
    return DocumentApp.openById(file.id).getBody().getText().trim();
  } finally {
    Drive.Files.remove(file.id);
  }
}

function submit(courseId, workId, title, text, photos) {
  const sub = (Subs_().list(courseId, workId, { userId: 'me' }).studentSubmissions || [])[0];
  if (!sub) throw new Error('제출할 과제를 찾을 수 없어요.');
  const doc = DocumentApp.create(title + ' - 제출');
  const body = doc.getBody();
  body.setText(text);
  (photos || []).forEach(b64 => {
    const img = body.appendImage(Utilities.newBlob(Utilities.base64Decode(b64), 'image/jpeg', 'photo.jpg'));
    const w = 450;
    img.setHeight(Math.round(img.getHeight() * w / img.getWidth())).setWidth(w);
  });
  doc.saveAndClose();
  let reclaimed = false;
  try {
    if (sub.state === 'TURNED_IN') { Subs_().reclaim({}, courseId, workId, sub.id); reclaimed = true; }
    Subs_().modifyAttachments({ addAttachments: [{ driveFile: { id: doc.getId() } }] }, courseId, workId, sub.id);
    Subs_().turnIn({}, courseId, workId, sub.id);
  } catch (err) {
    // Roll back: restore the earlier turned-in state and drop the orphan doc, then surface the real error.
    if (reclaimed) { try { Subs_().turnIn({}, courseId, workId, sub.id); } catch (e) {} }
    try { Drive.Files.remove(doc.getId()); } catch (e) {}
    throw err;
  }
  return { state: 'TURNED_IN', docId: doc.getId() };
}

// Created here (not in Classroom) so students can attach submissions through this app.
// due is 'YYYY-MM-DD'; 23:59 in Korea is 14:59 UTC on the same date.
function createAssignment(courseId, title, description, due) {
  const work = { title: title, description: description || '', workType: 'ASSIGNMENT', state: 'PUBLISHED' };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(due || '');
  if (m) {
    work.dueDate = { year: +m[1], month: +m[2], day: +m[3] };
    work.dueTime = { hours: 14, minutes: 59 };
  }
  return Classroom.Courses.CourseWork.create(work, courseId).id;
}

function getGrid(courseId) {
  return buildGrid(
    list_(p => Classroom.Courses.Students.list(courseId, { pageToken: p }), 'students'),
    list_(p => Classroom.Courses.CourseWork.list(courseId, { pageToken: p }), 'courseWork'),
    list_(p => Subs_().list(courseId, '-', { pageToken: p }), 'studentSubmissions'));
}

function getText(docId) {
  try {
    return DocumentApp.openById(docId).getBody().getText();
  } catch (e) {
    return null;
  }
}

// Text plus the photos embedded by submit(), for the teacher's detail panel.
function getSubmission(docId) {
  try {
    const body = DocumentApp.openById(docId).getBody();
    return { text: body.getText(), photos: body.getImages().map(img => Utilities.base64Encode(img.getBlob().getBytes())) };
  } catch (e) {
    return { text: null, photos: [] };
  }
}

function getTexts(docIds) {
  return docIds.map(id => (id ? getText(id) : null));
}

function devSmoke() {
  const me = whoami();
  const out = { teaching: me.teaching.length, learning: me.learning.length };
  if (me.teaching[0]) {
    const g = getGrid(me.teaching[0].id);
    out.grid = { course: me.teaching[0].name, students: g.students.length, works: g.works.length };
  }
  Logger.log(JSON.stringify(out));
  return JSON.stringify(out);
}
