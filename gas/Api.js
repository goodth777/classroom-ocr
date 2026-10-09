// Web app API. Deployed "execute as me (teacher), anyone can access": every call runs with the
// teacher's Drive and Sheet, and is authorised here by a student device token or the teacher key.

// Address of the PWA (GitHub Pages). setup() prints the teacher link with it.
const APP_URL = 'https://goodth777.github.io/classroom-ocr/';

const MAX_PHOTOS_ = 5;
const PIN_TRIES_ = 5;

function err_(message, code) {
  const e = new Error(message);
  e.userMessage = message;
  e.code = code || 'bad';
  return e;
}

const json_ = obj => ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);

function doPost(e) {
  const t0 = Date.now();
  try {
    const req = JSON.parse(e.postData.contents);
    const route = routes_()[req.action];
    if (!route) throw err_('알 수 없는 요청이에요.');
    ensureSchema_();
    let who = null;
    if (route.auth === 'student') who = student_(req.token);
    if (route.auth === 'teacher') teacher_(req.key);
    const data = route.fn(req, who);
    return json_({ ok: true, data: data, ms: Date.now() - t0 });
  } catch (e2) {
    if (!e2.userMessage) console.error(e2.stack || e2);
    return json_({ ok: false, code: e2.code || 'server', error: e2.userMessage || '서버에서 문제가 생겼어요. 잠시 후 다시 시도해 주세요.' });
  }
}

// ---------- auth ----------

const hash_ = s => Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s)
  .map(b => ((b + 256) % 256).toString(16).padStart(2, '0')).join('');
const randomToken_ = () => (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');

function teacher_(key) {
  const real = prop_('TEACHER_KEY');
  if (!key || !real || hash_(String(key)) !== hash_(real)) throw err_('교사 접속 링크를 다시 열어 주세요.', 'auth');
}

function student_(token) {
  if (!token) throw err_('다시 참여해 주세요.', 'auth');
  const h = hash_(String(token));
  const cache = CacheService.getScriptCache();
  const hit = cache.get('tok:' + h);
  if (hit) return JSON.parse(hit);
  const find = () => {
    const dev = rows_('Devices').find(d => d.tokenHash === h);
    const st = dev && rows_('Students').find(s => s.id === dev.studentId);
    const cls = st && rows_('Classes').find(c => c.id === st.classId);
    return cls ? { student: st, cls: cls } : null;
  };
  let who = find();
  if (!who) { // the minute-long cache may predate a fresh join: check the sheet itself before refusing
    ['Devices', 'Students', 'Classes'].forEach(dirty_);
    who = find();
  }
  if (!who) throw err_('다시 참여해 주세요. 선생님이 PIN을 새로 발급했을 수 있어요.', 'auth');
  cache.put('tok:' + h, JSON.stringify(who), RESULT_TTL_);
  return who;
}

const classByCode_ = code => rows_('Classes').find(c => c.code === String(code || '').trim().toUpperCase());

// ---------- public ----------

// Step 2 of joining: the class name, and the student's name once a number is chosen.
// A student is found by 학번 (5 digits) or, for rows added before 학번, by number.
function findInClass_(cls, id) {
  const v = String(id == null ? '' : id).trim();
  if (/^\d{5}$/.test(v)) return rows_('Students').find(s => s.classId === cls.id && s.sno === v);
  return rows_('Students').find(s => s.classId === cls.id && +s.number === +v && !s.sno);
}

function peek_(req) {
  const cls = classByCode_(req.code);
  if (!cls) throw err_('수업 코드를 다시 확인해 주세요.', 'notfound');
  const out = { className: cls.name, section: cls.section };
  const id = req.sno != null ? req.sno : req.number;
  if (id != null) {
    const st = findInClass_(cls, id);
    if (!st) throw err_('명단에 없는 학번이에요. 선생님께 확인해 주세요.', 'notfound');
    out.name = maskName(st.name); // full name only after the PIN (join)
  }
  return out;
}

function join_(req) {
  const cls = classByCode_(req.code);
  if (!cls) throw err_('수업 코드를 다시 확인해 주세요.', 'notfound');
  const st = findInClass_(cls, req.sno != null ? req.sno : req.number);
  if (!st) throw err_('명단에 없는 학번이에요.', 'notfound');
  const cache = CacheService.getScriptCache();
  const k = 'pin:' + (st.sno || st.id); // one lock per student across classes
  const tries = +(cache.get(k) || 0);
  if (tries >= PIN_TRIES_) throw err_('PIN을 여러 번 틀렸어요. 10분 뒤에 다시 해 주세요.', 'locked');
  if (String(req.pin) !== st.pin) {
    cache.put(k, String(tries + 1), 600);
    throw err_(`PIN이 맞지 않아요. (${tries + 1}/${PIN_TRIES_})`, 'pin');
  }
  cache.remove(k);
  const token = randomToken_();
  withLock_(() => append_('Devices', { tokenHash: hash_(token), studentId: st.id, created: now_(), lastSeen: now_() }));
  bump_(cls.id);
  return { token: token, student: { name: st.name, number: +st.number }, cls: { name: cls.name, section: cls.section } };
}

// ---------- student ----------

function me_(req, who) {
  return cached_(`me:${who.student.id}:${verOf_(who.cls.id)}`, () => computeMe_(who));
}

function computeMe_(who) {
  const mine = {};
  rows_('Submissions').filter(s => s.studentId === who.student.id).forEach(s => { mine[s.assignmentId] = s; });
  const assignments = rows_('Assignments').filter(a => a.classId === who.cls.id && isTarget(a, who.student.id)).map(a => {
    const s = mine[a.id];
    return { id: a.id, title: a.title, description: a.description, due: a.due, created: a.created,
      state: s ? 'TURNED_IN' : 'NEW', updated: s ? s.submittedAt : '', late: !!(s && s.late), text: s ? s.text : '' };
  });
  return { student: { name: who.student.name, number: +who.student.number }, cls: { name: who.cls.name, section: who.cls.section }, assignments: assignments, inbox: studentInbox_(who), forms: studentForms_(who) };
}

function ocrAction_(req) {
  return { text: ocr_(req.image) };
}

// The one place OCR happens: swap this body to change engines (CLOVA, Cloud Vision, ...).
// Drive turns the image into a Google Doc with OCR; we read the text and drop the temp doc.
function ocr_(base64) {
  const blob = Utilities.newBlob(Utilities.base64Decode(base64), 'image/jpeg', 'ocr.jpg');
  const file = Drive.Files.create({ name: 'ocr-temp', mimeType: MimeType.GOOGLE_DOCS }, blob, { ocrLanguage: 'ko' });
  try {
    return DocumentApp.openById(file.id).getBody().getText().trim();
  } finally {
    Drive.Files.remove(file.id);
  }
}

// Teacher attachment (photo/file) for forms and announcements: saved in Drive '과제 제출/첨부' and shared by link,
// so students load it straight from Google, not through this script.
const MAX_UPLOAD_ = 10 * 1024 * 1024;
function upload_(req) {
  const bytes = Utilities.base64Decode(String(req.data || ''));
  if (!bytes.length || bytes.length > MAX_UPLOAD_) throw err_('파일은 10MB까지 올릴 수 있어요.');
  const name = String(req.name || '첨부').slice(0, 120);
  const file = folder_(DriveApp.getFolderById(prop_('FOLDER_ID')), '첨부').createFile(Utilities.newBlob(bytes, String(req.mime || 'application/octet-stream'), name));
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { id: file.getId(), name: name, mime: file.getMimeType(), size: bytes.length };
}

// Attachments arrive as [{id, name, mime, size}]; anything else is dropped.
function cleanAttach_(list) {
  return (Array.isArray(list) ? list : []).slice(0, 5)
    .filter(a => a && /^[\w-]{10,}$/.test(String(a.id)))
    .map(a => ({ id: String(a.id), name: String(a.name || '첨부').slice(0, 120), mime: String(a.mime || ''), size: +a.size || 0 }));
}

function folder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function submit_(req, who) {
  const a = rows_('Assignments').find(x => x.id === req.assignmentId && x.classId === who.cls.id && isTarget(x, who.student.id));
  if (!a) throw err_('과제를 찾을 수 없어요.', 'notfound');
  const text = String(req.text || '').trim();
  const photos = (req.photos || []).slice(0, MAX_PHOTOS_);
  if (!text) throw err_('제출할 내용을 입력해 주세요.');
  // Photos go to Drive before the lock: uploads are the slow part and need no coordination.
  const dir = folder_(folder_(DriveApp.getFolderById(prop_('FOLDER_ID')), who.cls.name), a.title);
  const tag = `${who.student.number}_${who.student.name}`;
  const ids = photos.map((b64, i) => dir.createFile(Utilities.newBlob(Utilities.base64Decode(b64), 'image/jpeg', `${tag}_${i + 1}.jpg`)).getId());
  const at = now_();
  const late = isLate(at, a.due);
  const old = withLock_(() => {
    const prev = rows_('Submissions').find(s => s.assignmentId === a.id && s.studentId === who.student.id);
    const row = { id: prev ? prev.id : newId_(), assignmentId: a.id, studentId: who.student.id, text: text, photoIds: ids.join(','), submittedAt: at, late: late ? 'Y' : '' };
    if (prev) update_('Submissions', prev._row, row); else append_('Submissions', row);
    return prev;
  });
  bump_(who.cls.id);
  if (old && old.photoIds) old.photoIds.split(',').forEach(id => { try { DriveApp.getFileById(id).setTrashed(true); } catch (e) {} });
  return { submittedAt: at, late: late };
}

function leave_(req, who) {
  const h = hash_(String(req.token));
  withLock_(() => {
    deleteRows_('Devices', rows_('Devices').filter(d => d.tokenHash === h));
    if (req.pushToken) deleteRows_('PushSubs', rows_('PushSubs').filter(s => s.token === String(req.pushToken) && s.studentId === who.student.id));
  });
  CacheService.getScriptCache().remove('tok:' + h);
  bump_(who.cls.id);
  return true;
}

// ---------- teacher ----------

function classes_() {
  const unread = unreadByClass_();
  const students = rows_('Students');
  const joined = new Set(rows_('Devices').map(d => d.studentId));
  return rows_('Classes').map(c => {
    const mine = students.filter(s => s.classId === c.id);
    return { id: c.id, name: c.name, section: c.section, subject: c.subject, code: c.code, kind: c.kind || '',
      students: mine.length, joined: mine.filter(s => joined.has(s.id)).length, unread: unread[c.id] || 0 };
  });
}

function uniqueCode_() {
  const used = new Set(rows_('Classes').map(c => c.code));
  let code;
  do { code = makeCode(); } while (used.has(code));
  return code;
}

function createClass_(req) {
  const name = String(req.name || '').trim();
  if (!name) throw err_('클래스 이름을 입력해 주세요.');
  return withLock_(() => {
    const c = { id: newId_(), name: name, section: String(req.section || '').trim(), subject: String(req.subject || '').trim(), code: uniqueCode_(), created: now_(), kind: req.kind === 'homeroom' ? 'homeroom' : '' };
    append_('Classes', c);
    bump_(c.id);
    return c;
  });
}

function newCode_(req) {
  return withLock_(() => {
    const c = rows_('Classes').find(x => x.id === req.classId);
    if (!c) throw err_('클래스를 찾을 수 없어요.', 'notfound');
    c.code = uniqueCode_();
    update_('Classes', c._row, c);
    bump_(c.id);
    return c.code;
  });
}

function roster_(req) {
  const devices = rows_('Devices');
  const last = {};
  rows_('Submissions').forEach(s => { if (!last[s.studentId] || s.submittedAt > last[s.studentId]) last[s.studentId] = s.submittedAt; });
  // the same 학번 in this teacher's other classes = the same student
  const classes = rows_('Classes');
  const others = sno => (sno ? rows_('Students').filter(x => x.sno === sno && x.classId !== req.classId)
    .map(x => (classes.find(c => c.id === x.classId) || {}).name).filter(Boolean) : []);
  return rows_('Students').filter(s => s.classId === req.classId)
    .map(s => ({ id: s.id, number: +s.number, name: s.name, sno: s.sno || '', pin: s.pin, joined: devices.some(d => d.studentId === s.id), lastSubmit: last[s.id] || '', others: others(s.sno) }))
    .sort(bySno);
}

// Paste "학번 이름" rows: fills 학번 on existing students with a unique name, adds the rest.
// Same-name cases come back as `ask` (nothing written for them) until the teacher answers via `resolve`.
// A 학번 already used in another class keeps that PIN, so one PIN card works everywhere.
function addStudents_(req) {
  const list = parseRoster(req.text);
  if (!list.length) throw err_('학번과 이름을 읽지 못했어요. "20812  홍길동"처럼 한 줄에 한 명씩 붙여 넣어 주세요.');
  const res = withLock_(() => {
    const all = rows_('Students');
    const mine = all.filter(s => s.classId === req.classId);
    const plan = planRoster(list, mine, req.resolve || {});
    const pinOf = sno => { const o = sno && all.find(s => s.sno === sno && s.pin); return o ? o.pin : makePin(); };
    plan.fill.forEach(f => {
      const s = mine.find(x => x.id === f.id);
      if (!s) return;
      s.sno = f.sno;
      const shared = all.find(x => x.sno === f.sno && x.id !== s.id && x.pin);
      if (shared) s.pin = shared.pin; // devices stay joined; only the next join uses the shared PIN
      update_('Students', s._row, s);
    });
    plan.add.forEach(r => append_('Students', { id: newId_(), classId: req.classId, number: r.number, name: r.name, sno: r.sno || '', pin: pinOf(r.sno), created: now_() }));
    return plan;
  });
  bump_(req.classId);
  const names = Object.fromEntries(rows_('Students').filter(s => s.classId === req.classId).map(s => [s.id, { number: +s.number, name: s.name }]));
  return { added: res.add.length, filled: res.fill.length, skipped: res.skip,
    ask: res.ask.map(a => ({ sno: a.sno, name: a.name, candidates: a.candidates.map(id => Object.assign({ id: id }, names[id])) })), roster: roster_(req) };
}

// Fix a student's 학번/name. Joining, submissions and PIN stay; a 학번 used in another class brings that PIN.
function updateStudent_(req) {
  const name = String(req.name || '').trim();
  const sno = String(req.sno || '').trim();
  if (!name) throw err_('이름을 입력해 주세요.');
  if (sno && !/^\d{5}$/.test(sno)) throw err_('학번은 숫자 다섯 자리예요. 예: 20812');
  return withLock_(() => {
    const all = rows_('Students');
    const s = all.find(x => x.id === req.studentId);
    if (!s) throw err_('학생을 찾을 수 없어요.', 'notfound');
    if (sno && all.some(x => x.classId === s.classId && x.id !== s.id && x.sno === sno)) throw err_('이 클래스에 같은 학번의 학생이 이미 있어요.');
    s.name = name;
    if (sno !== s.sno) {
      s.sno = sno;
      if (sno) s.number = +sno.slice(3);
      const shared = sno && all.find(x => x.sno === sno && x.id !== s.id && x.pin);
      if (shared) s.pin = shared.pin;
    }
    update_('Students', s._row, s);
    bump_(s.classId);
    return roster_({ classId: s.classId });
  });
}

// Take students out of a class (transfer, course change): their devices stop working here.
// Submissions, answers and messages stay in the sheet; the app's tables no longer list them.
function removeStudents_(req) {
  const ids = new Set((req.ids || []).map(String));
  return withLock_(() => {
    const gone = rows_('Students').filter(s => s.classId === req.classId && ids.has(s.id));
    const devs = rows_('Devices').filter(d => ids.has(d.studentId));
    deleteRows_('Devices', devs);
    devs.forEach(d => CacheService.getScriptCache().remove('tok:' + d.tokenHash));
    deleteRows_('Students', gone);
    bump_(req.classId);
    return { removed: gone.length, roster: roster_({ classId: req.classId }) };
  });
}

function reissuePin_(req) {
  return withLock_(() => {
    const s = rows_('Students').find(x => x.id === req.studentId);
    if (!s) throw err_('학생을 찾을 수 없어요.', 'notfound');
    // one PIN per 학번: every class row of this student gets the new PIN and must join again
    const same = s.sno ? rows_('Students').filter(x => x.sno === s.sno) : [s];
    const pin = makePin();
    same.forEach(x => { x.pin = pin; update_('Students', x._row, x); });
    const ids = new Set(same.map(x => x.id));
    const gone = rows_('Devices').filter(d => ids.has(d.studentId));
    deleteRows_('Devices', gone); // old devices must join again
    gone.forEach(d => CacheService.getScriptCache().remove('tok:' + d.tokenHash));
    same.forEach(x => bump_(x.classId));
    return pin;
  });
}

function grid_(req) {
  const students = rows_('Students').filter(s => s.classId === req.classId);
  const assignments = rows_('Assignments').filter(a => a.classId === req.classId);
  const ids = new Set(assignments.map(a => a.id));
  const subs = rows_('Submissions').filter(s => ids.has(s.assignmentId)).map(s => Object.assign({}, s, { late: s.late === 'Y' }));
  return buildGrid(students, assignments, subs);
}

// Full submission texts by submission id, for one student or a whole class (drawer, CSV).
function texts_(req) {
  const ids = new Set(rows_('Assignments').filter(a => a.classId === req.classId).map(a => a.id));
  const out = {};
  rows_('Submissions').forEach(s => {
    if (ids.has(s.assignmentId) && (!req.studentId || s.studentId === req.studentId)) out[s.id] = s.text;
  });
  return out;
}

function photos_(req) {
  const s = rows_('Submissions').find(x => x.id === req.subId);
  if (!s || !s.photoIds) return [];
  return s.photoIds.split(',').map(id => {
    try {
      const b = DriveApp.getFileById(id).getBlob();
      return 'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes());
    } catch (e) { return null; }
  }).filter(Boolean);
}

function createAssignment_(req) {
  const title = String(req.title || '').trim();
  if (!title) throw err_('과제 제목을 입력해 주세요.');
  if (!rows_('Classes').some(c => c.id === req.classId)) throw err_('클래스를 찾을 수 없어요.', 'notfound');
  const due = /^\d{4}-\d{2}-\d{2}$/.test(req.due || '') ? req.due : '';
  const studentIds = targetIds_(req.classId, req.studentIds);
  const a = withLock_(() => {
    const a = { id: newId_(), classId: req.classId, title: title, description: String(req.description || '').trim(), due: due, created: now_(), studentIds: studentIds };
    append_('Assignments', a);
    bump_(a.classId);
    return a;
  });
  notifyStudents_(targetStudents_(a), 'ann', { title: '📝 새 과제 · ' + a.title, body: a.due ? Utilities.formatDate(new Date(a.due + 'T00:00:00+09:00'), 'Asia/Seoul', 'M월 d일') + ' 마감' : '', url: '#/a/' + a.id, tag: 'a-' + a.id });
  return a.id;
}

// null/empty = whole class; otherwise only ids that really belong to the class are kept.
function targetIds_(classId, ids) {
  if (!ids || !ids.length) return '';
  const mine = new Set(rows_('Students').filter(s => s.classId === classId).map(s => s.id));
  const keep = ids.filter(id => mine.has(id));
  if (!keep.length) throw err_('과제를 받을 학생을 한 명 이상 골라 주세요.');
  return keep.join(',');
}

function updateTargets_(req) {
  return withLock_(() => {
    const a = rows_('Assignments').find(x => x.id === req.assignmentId);
    if (!a) throw err_('과제를 찾을 수 없어요.', 'notfound');
    a.studentIds = targetIds_(a.classId, req.studentIds);
    update_('Assignments', a._row, a);
    bump_(a.classId);
    return targetsOf(a);
  });
}

// Everything the teacher screen needs for one class, in a single round trip.
function view_(req) {
  return cached_(`view2:${req.classId || ''}:${verOf_('all')}`, () => computeView_(req));
}

function computeView_(req) {
  const classes = classes_();
  const cls = classes.find(c => c.id === req.classId) || classes[0];
  if (!cls) return { classes: classes, classId: null };
  return { classes: classes, classId: cls.id, grid: grid_({ classId: cls.id }), roster: roster_({ classId: cls.id }) };
}

const sheetUrl_ = () => db_().getUrl();

function routes_() { return {
  peek: { auth: 'none', fn: peek_ },
  join: { auth: 'none', fn: join_ },
  me: { auth: 'student', fn: me_ },
  ocr: { auth: 'student', fn: ocrAction_ },
  submit: { auth: 'student', fn: submit_ },
  leave: { auth: 'student', fn: leave_ },
  classes: { auth: 'teacher', fn: classes_ },
  createClass: { auth: 'teacher', fn: createClass_ },
  newCode: { auth: 'teacher', fn: newCode_ },
  roster: { auth: 'teacher', fn: roster_ },
  addStudents: { auth: 'teacher', fn: addStudents_ },
  reissuePin: { auth: 'teacher', fn: reissuePin_ },
  grid: { auth: 'teacher', fn: grid_ },
  photos: { auth: 'teacher', fn: photos_ },
  texts: { auth: 'teacher', fn: texts_ },
  createAssignment: { auth: 'teacher', fn: createAssignment_ },
  updateTargets: { auth: 'teacher', fn: updateTargets_ },
  view: { auth: 'teacher', fn: view_ },
  chat: { auth: 'student', fn: chat_ },
  send: { auth: 'student', fn: send_ },
  readMsgs: { auth: 'student', fn: readMsgs_ },
  readAnn: { auth: 'student', fn: readAnn_ },
  tInbox: { auth: 'teacher', fn: tInbox_ },
  tThread: { auth: 'teacher', fn: tThread_ },
  tSend: { auth: 'teacher', fn: tSend_ },
  postAnn: { auth: 'teacher', fn: postAnn_ },
  pinAnn: { auth: 'teacher', fn: pinAnn_ },
  delAnn: { auth: 'teacher', fn: delAnn_ },
  seats: { auth: 'teacher', fn: seats_ },
  seatPut: { auth: 'teacher', fn: seatPut_ },
  seatDel: { auth: 'teacher', fn: seatDel_ },
  form: { auth: 'student', fn: form_ },
  answer: { auth: 'student', fn: answer_ },
  forms: { auth: 'teacher', fn: forms_ },
  formPut: { auth: 'teacher', fn: formPut_ },
  formSend: { auth: 'teacher', fn: formSend_ },
  formClose: { auth: 'teacher', fn: formClose_ },
  formDel: { auth: 'teacher', fn: formDel_ },
  responses: { auth: 'teacher', fn: responses_ },
  grade: { auth: 'teacher', fn: grade_ },
  formNudge: { auth: 'teacher', fn: formNudge_ },
  upload: { auth: 'teacher', fn: upload_ },
  updateStudent: { auth: 'teacher', fn: updateStudent_ },
  removeStudents: { auth: 'teacher', fn: removeStudents_ },
  pushSub: { auth: 'student', fn: pushSub_ },
  tPushSub: { auth: 'teacher', fn: tPushSub_ },
  pushUnsub: { auth: 'none', fn: pushUnsub_ },
  sheetUrl: { auth: 'teacher', fn: sheetUrl_ },
  live: { auth: 'student', fn: live_ },
  liveAns: { auth: 'student', fn: liveAns_ },
  liveStart: { auth: 'teacher', fn: liveStart_ },
  liveView: { auth: 'teacher', fn: liveView_ },
  liveCtl: { auth: 'teacher', fn: liveCtl_ },
  liveEnd: { auth: 'teacher', fn: liveEnd_ },
  lives: { auth: 'teacher', fn: lives_ },
  liveRec: { auth: 'teacher', fn: liveRec_ },
  liveRecDel: { auth: 'teacher', fn: liveRecDel_ },
}; }

// ---------- one-time setup (run from the Apps Script editor) ----------

function setup() {
  const p = PropertiesService.getScriptProperties();
  if (!p.getProperty('DB_ID')) {
    const ss = SpreadsheetApp.create('과제 제출 DB');
    Object.keys(HEADERS_).forEach((name, i) => {
      const sh = i === 0 ? ss.getSheets()[0].setName(name) : ss.insertSheet(name);
      sh.getRange('A:Z').setNumberFormat('@'); // keep PINs like 0123 and dates as plain text
      sh.appendRow(HEADERS_[name]);
      sh.setFrozenRows(1);
    });
    p.setProperty('DB_ID', ss.getId());
  }
  if (!p.getProperty('FOLDER_ID')) p.setProperty('FOLDER_ID', DriveApp.createFolder('과제 제출').getId());
  if (!p.getProperty('TEACHER_KEY')) p.setProperty('TEACHER_KEY', randomToken_());
  Logger.log('데이터 시트: ' + db_().getUrl());
  Logger.log('교사 접속 링크 (다른 사람에게 보여 주지 마세요): ' + APP_URL + '#/teacher?key=' + p.getProperty('TEACHER_KEY'));
}
