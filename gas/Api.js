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
function peek_(req) {
  const cls = classByCode_(req.code);
  if (!cls) throw err_('수업 코드를 다시 확인해 주세요.', 'notfound');
  const out = { className: cls.name, section: cls.section };
  if (req.number != null) {
    const st = rows_('Students').find(s => s.classId === cls.id && +s.number === +req.number);
    if (!st) throw err_('명단에 없는 번호예요. 선생님께 확인해 주세요.', 'notfound');
    out.name = st.name;
  }
  return out;
}

function join_(req) {
  const cls = classByCode_(req.code);
  if (!cls) throw err_('수업 코드를 다시 확인해 주세요.', 'notfound');
  const st = rows_('Students').find(s => s.classId === cls.id && +s.number === +req.number);
  if (!st) throw err_('명단에 없는 번호예요.', 'notfound');
  const cache = CacheService.getScriptCache();
  const k = 'pin:' + st.id;
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
  return { student: { name: who.student.name, number: +who.student.number }, cls: { name: who.cls.name, section: who.cls.section }, assignments: assignments, inbox: studentInbox_(who) };
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
  withLock_(() => deleteRows_('Devices', rows_('Devices').filter(d => d.tokenHash === h)));
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
    return { id: c.id, name: c.name, section: c.section, subject: c.subject, code: c.code,
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
  if (!name) throw err_('반 이름을 입력해 주세요.');
  return withLock_(() => {
    const c = { id: newId_(), name: name, section: String(req.section || '').trim(), subject: String(req.subject || '').trim(), code: uniqueCode_(), created: now_() };
    append_('Classes', c);
    bump_(c.id);
    return c;
  });
}

function newCode_(req) {
  return withLock_(() => {
    const c = rows_('Classes').find(x => x.id === req.classId);
    if (!c) throw err_('반을 찾을 수 없어요.', 'notfound');
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
  return rows_('Students').filter(s => s.classId === req.classId)
    .map(s => ({ id: s.id, number: +s.number, name: s.name, pin: s.pin, joined: devices.some(d => d.studentId === s.id), lastSubmit: last[s.id] || '' }))
    .sort((a, b) => a.number - b.number);
}

function addStudents_(req) {
  const list = parseRoster(req.text);
  if (!list.length) throw err_('번호와 이름을 읽지 못했어요. "1  홍길동"처럼 한 줄에 한 명씩 붙여 넣어 주세요.');
  const added = withLock_(() => {
    const have = new Set(rows_('Students').filter(s => s.classId === req.classId).map(s => +s.number));
    const fresh = list.filter(s => !have.has(s.number));
    fresh.forEach(s => append_('Students', { id: newId_(), classId: req.classId, number: s.number, name: s.name, pin: makePin(), created: now_() }));
    return fresh.length;
  });
  bump_(req.classId);
  return { added: added, skipped: list.length - added, roster: roster_(req) };
}

function reissuePin_(req) {
  return withLock_(() => {
    const s = rows_('Students').find(x => x.id === req.studentId);
    if (!s) throw err_('학생을 찾을 수 없어요.', 'notfound');
    s.pin = makePin();
    update_('Students', s._row, s);
    const gone = rows_('Devices').filter(d => d.studentId === s.id);
    deleteRows_('Devices', gone); // old devices must join again
    gone.forEach(d => CacheService.getScriptCache().remove('tok:' + d.tokenHash));
    bump_(s.classId);
    return s.pin;
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
  if (!rows_('Classes').some(c => c.id === req.classId)) throw err_('반을 찾을 수 없어요.', 'notfound');
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
  pushSub: { auth: 'student', fn: pushSub_ },
  tPushSub: { auth: 'teacher', fn: tPushSub_ },
  pushUnsub: { auth: 'none', fn: pushUnsub_ },
  sheetUrl: { auth: 'teacher', fn: sheetUrl_ },
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
