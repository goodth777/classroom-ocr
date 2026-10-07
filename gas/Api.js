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
      .forEach(s => { mine[s.courseWorkId] = s.state; });
    works.forEach(w => cards.push({
      courseId: c.id, courseName: c.name, workId: w.id, title: w.title,
      description: w.description || '', state: mine[w.id] || 'NEW',
    }));
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
  if (sub.state === 'TURNED_IN') Subs_().reclaim({}, courseId, workId, sub.id);
  Subs_().modifyAttachments({ addAttachments: [{ driveFile: { id: doc.getId() } }] }, courseId, workId, sub.id);
  Subs_().turnIn({}, courseId, workId, sub.id);
  return { state: 'TURNED_IN', docId: doc.getId() };
}

// Created here (not in Classroom) so students can attach submissions through this app.
function createAssignment(courseId, title, description) {
  return Classroom.Courses.CourseWork.create(
    { title: title, description: description || '', workType: 'ASSIGNMENT', state: 'PUBLISHED' }, courseId).id;
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
