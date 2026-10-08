// Teacher ↔ student messages (1:1) and class announcements.
// Messages are not cached (they change often); every write bumps the class version so
// cached "me" and teacher views pick up new badges.

const MAX_MSG_ = 2000;

const msgOut_ = m => ({ id: m.id, from: m.from, text: m.text, assignmentId: m.assignmentId, created: m.created, readAt: m.readAt });
const byCreated_ = (a, b) => String(a.created).localeCompare(String(b.created));

function cleanText_(t) {
  const s = String(t || '').trim();
  if (!s) throw err_('메시지를 입력해 주세요.');
  if (s.length > MAX_MSG_) throw err_(`메시지는 ${MAX_MSG_}자까지 보낼 수 있어요.`);
  return s;
}

// ---------- student ----------

// Part of "me": announcements with read state, the 1:1 thread, and unread counts for the home badges.
function studentInbox_(who) {
  const sid = who.student.id;
  const reads = new Set(rows_('AnnReads').filter(r => r.studentId === sid).map(r => r.annId));
  const anns = rows_('Announcements').filter(a => a.classId === who.cls.id)
    .map(a => ({ id: a.id, title: a.title, body: a.body, pinned: a.pinned === 'Y', created: a.created, read: reads.has(a.id) }))
    .sort((a, b) => (b.pinned - a.pinned) || String(b.created).localeCompare(String(a.created)));
  const msgs = rows_('Messages').filter(m => m.studentId === sid).map(msgOut_).sort(byCreated_);
  return { anns: anns, msgs: msgs, unread: { ann: anns.filter(a => !a.read).length, msg: msgs.filter(m => m.from === 't' && !m.readAt).length } };
}

// Polled while the chat is open: just this student's thread, straight from the sheet.
function chat_(req, who) {
  return rows_('Messages').filter(m => m.studentId === who.student.id).map(msgOut_).sort(byCreated_);
}

function send_(req, who) {
  const m = { id: newId_(), classId: who.cls.id, studentId: who.student.id, from: 's', text: cleanText_(req.text),
    assignmentId: String(req.assignmentId || ''), created: now_(), readAt: '' };
  withLock_(() => append_('Messages', m));
  bump_(who.cls.id);
  return msgOut_(m);
}

function markRead_(filter) {
  const at = now_();
  let n = 0;
  withLock_(() => rows_('Messages').filter(filter).forEach(m => { m.readAt = at; update_('Messages', m._row, m); n++; }));
  return n;
}

function readMsgs_(req, who) {
  const n = markRead_(m => m.studentId === who.student.id && m.from === 't' && !m.readAt);
  if (n) bump_(who.cls.id);
  return n;
}

function readAnn_(req, who) {
  const ids = (req.ids || []).map(String);
  const added = withLock_(() => {
    const have = new Set(rows_('AnnReads').filter(r => r.studentId === who.student.id).map(r => r.annId));
    const anns = new Set(rows_('Announcements').filter(a => a.classId === who.cls.id).map(a => a.id));
    const fresh = ids.filter(id => anns.has(id) && !have.has(id));
    fresh.forEach(id => append_('AnnReads', { annId: id, studentId: who.student.id, readAt: now_() }));
    return fresh.length;
  });
  if (added) bump_(who.cls.id);
  return added;
}

// ---------- teacher ----------

// Unread student messages per class, for the sidebar and tab badges.
function unreadByClass_() {
  const out = {};
  rows_('Messages').forEach(m => { if (m.from === 's' && !m.readAt) out[m.classId] = (out[m.classId] || 0) + 1; });
  return out;
}

function tInbox_(req) {
  const students = rows_('Students').filter(s => s.classId === req.classId);
  const msgs = rows_('Messages').filter(m => m.classId === req.classId);
  const threads = students.map(s => {
    const mine = msgs.filter(m => m.studentId === s.id).sort(byCreated_);
    const last = mine[mine.length - 1];
    return { studentId: s.id, number: +s.number, name: s.name,
      last: last ? { text: last.text, from: last.from, created: last.created, assignmentId: last.assignmentId } : null,
      unread: mine.filter(m => m.from === 's' && !m.readAt).length };
  }).sort((a, b) => (b.unread > 0) - (a.unread > 0) || String(b.last ? b.last.created : '').localeCompare(String(a.last ? a.last.created : '')) || a.number - b.number);
  const reads = rows_('AnnReads');
  const anns = rows_('Announcements').filter(a => a.classId === req.classId).map(a => {
    const who = new Set(reads.filter(r => r.annId === a.id).map(r => r.studentId));
    return { id: a.id, title: a.title, body: a.body, pinned: a.pinned === 'Y', created: a.created,
      read: students.filter(s => who.has(s.id)).length, total: students.length,
      unreadNames: students.filter(s => !who.has(s.id)).sort((x, y) => x.number - y.number).map(s => s.name) };
  }).sort((a, b) => (b.pinned - a.pinned) || String(b.created).localeCompare(String(a.created)));
  return { threads: threads, anns: anns };
}

function tThread_(req) {
  const st = rows_('Students').find(s => s.id === req.studentId);
  if (!st) throw err_('학생을 찾을 수 없어요.', 'notfound');
  const n = markRead_(m => m.studentId === st.id && m.from === 's' && !m.readAt);
  if (n) bump_(st.classId);
  return rows_('Messages').filter(m => m.studentId === st.id).map(msgOut_).sort(byCreated_);
}

function tSend_(req) {
  const st = rows_('Students').find(s => s.id === req.studentId);
  if (!st) throw err_('학생을 찾을 수 없어요.', 'notfound');
  const m = { id: newId_(), classId: st.classId, studentId: st.id, from: 't', text: cleanText_(req.text),
    assignmentId: String(req.assignmentId || ''), created: now_(), readAt: '' };
  withLock_(() => append_('Messages', m));
  bump_(st.classId);
  return msgOut_(m);
}

function postAnn_(req) {
  const title = String(req.title || '').trim();
  if (!title) throw err_('공지 제목을 입력해 주세요.');
  if (!rows_('Classes').some(c => c.id === req.classId)) throw err_('반을 찾을 수 없어요.', 'notfound');
  const a = { id: newId_(), classId: req.classId, title: title, body: String(req.body || '').trim(), pinned: req.pinned ? 'Y' : '', created: now_() };
  withLock_(() => append_('Announcements', a));
  bump_(req.classId);
  return a.id;
}

function pinAnn_(req) {
  return withLock_(() => {
    const a = rows_('Announcements').find(x => x.id === req.id);
    if (!a) throw err_('공지를 찾을 수 없어요.', 'notfound');
    a.pinned = req.pinned ? 'Y' : '';
    update_('Announcements', a._row, a);
    bump_(a.classId);
    return a.pinned === 'Y';
  });
}

function delAnn_(req) {
  return withLock_(() => {
    const a = rows_('Announcements').find(x => x.id === req.id);
    if (!a) return false;
    deleteRows_('Announcements', [a]);
    deleteRows_('AnnReads', rows_('AnnReads').filter(r => r.annId === a.id));
    bump_(a.classId);
    return true;
  });
}
