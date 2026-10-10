// Web push through Firebase Cloud Messaging (HTTP v1).
// The service-account JSON lives in Script Properties as FCM_KEY (Apps Script editor → 프로젝트 설정 → 스크립트 속성).
// Without it every push quietly does nothing, so the rest of the app keeps working.
// Push failures never fail the request that caused them.

const FCM_SCOPE_ = 'https://www.googleapis.com/auth/firebase.messaging';
const PUSH_KINDS_ = ['msg', 'ann', 'due'];

function fcmKey_() {
  const raw = PropertiesService.getScriptProperties().getProperty('FCM_KEY');
  return raw ? JSON.parse(raw) : null;
}

// OAuth access token for the service account (signed JWT → token) for the given scopes, cached for 50 minutes.
const fcmAccess_ = key => saToken_(key, FCM_SCOPE_);
function saToken_(key, scope) {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('sa:' + scope);
  if (hit) return hit;
  const b64 = s => Utilities.base64EncodeWebSafe(s).replace(/=+$/, '');
  const now = Math.floor(Date.now() / 1000);
  const head = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64(JSON.stringify({ iss: key.client_email, scope, aud: key.token_uri, iat: now, exp: now + 3600 }));
  const sig = b64(Utilities.computeRsaSha256Signature(head + '.' + claim, key.private_key));
  const res = UrlFetchApp.fetch(key.token_uri, {
    method: 'post', muteHttpExceptions: true,
    payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: head + '.' + claim + '.' + sig },
  });
  const at = JSON.parse(res.getContentText()).access_token;
  if (!at) throw new Error('service account token: ' + res.getContentText());
  cache.put('sa:' + scope, at, 3000);
  return at;
}

// Sends {title, body, url, tag} to each subscription row; drops tokens FCM says are gone.
function pushTo_(subs, msg) {
  if (!subs.length) return;
  try {
    const key = fcmKey_();
    if (!key) return;
    const at = fcmAccess_(key);
    const url = 'https://fcm.googleapis.com/v1/projects/' + key.project_id + '/messages:send';
    const data = { title: String(msg.title), body: String(msg.body || '').slice(0, 300), url: msg.url || '#/', tag: msg.tag || '' };
    const res = UrlFetchApp.fetchAll(subs.map(s => ({
      url: url, method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + at },
      payload: JSON.stringify({ message: { token: s.token, data: data, webpush: { headers: { Urgency: 'high', TTL: '86400' } } } }),
    })));
    const gone = subs.filter((s, i) => res[i].getResponseCode() === 404 || /UNREGISTERED/.test(res[i].getContentText()));
    if (gone.length) withLock_(() => deleteRows_('PushSubs', rows_('PushSubs').filter(r => gone.some(g => g.token === r.token))));
  } catch (e) {
    console.error('push failed', e);
  }
}

const wants_ = (sub, kind) => { try { return JSON.parse(sub.prefs || '{}')[kind] !== false; } catch (e) { return true; } };

function notifyStudents_(studentIds, kind, msg) {
  const ids = new Set(studentIds);
  pushTo_(rows_('PushSubs').filter(s => s.role === 's' && ids.has(s.studentId) && wants_(s, kind)), msg);
}
function notifyTeacher_(msg) {
  pushTo_(rows_('PushSubs').filter(s => s.role === 't'), msg);
}
// Students an assignment was given to (all of the class when it has no target list).
function targetStudents_(a) {
  const t = a.studentIds ? new Set(String(a.studentIds).split(',')) : null;
  return rows_('Students').filter(s => s.classId === a.classId && (!t || t.has(s.id))).map(s => s.id);
}

// ---------- routes ----------

function cleanPrefs_(p) {
  const out = {};
  PUSH_KINDS_.forEach(k => { out[k] = !p || p[k] !== false; });
  return JSON.stringify(out);
}
function savePushSub_(req, row) {
  const token = String(req.pushToken || '');
  if (!token || token.length > 4096) throw err_('알림을 켜지 못했어요. 다시 시도해 주세요.');
  withLock_(() => {
    // one phone may follow several classes: one row per (phone, student)
    deleteRows_('PushSubs', rows_('PushSubs').filter(s => s.token === token && s.role === row.role && s.studentId === row.studentId));
    append_('PushSubs', Object.assign({ token: token, prefs: cleanPrefs_(req.prefs), created: now_() }, row));
  });
  return true;
}
const pushSub_ = (req, who) => savePushSub_(req, { role: 's', studentId: who.student.id, classId: who.cls.id });
const tPushSub_ = req => savePushSub_(req, { role: 't', studentId: '', classId: '' });
function pushUnsub_(req) {
  const token = String(req.pushToken || '');
  withLock_(() => deleteRows_('PushSubs', rows_('PushSubs').filter(s => s.token === token)));
  return true;
}

// ---------- daily reminder ----------

// Time trigger (18:00 KST): assignments due tomorrow, to target students who have not submitted.
function dueReminder() {
  const tomorrow = Utilities.formatDate(new Date(Date.now() + 864e5), 'Asia/Seoul', 'yyyy-MM-dd');
  const subs = rows_('Submissions');
  rows_('Assignments').filter(a => a.due === tomorrow).forEach(a => {
    const done = new Set(subs.filter(x => x.assignmentId === a.id).map(x => x.studentId));
    notifyStudents_(targetStudents_(a).filter(id => !done.has(id)), 'due',
      { title: '⏰ 내일 마감 · ' + a.title, body: '아직 제출하지 않았어요. 오늘 안에 내 보세요!', url: '#/a/' + a.id, tag: 'due-' + a.id });
  });
}

// Run once from the editor: installs the daily reminder and grants the push permissions (external requests, triggers).
function installTriggers() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'dueReminder').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('dueReminder').timeBased().everyDays(1).atHour(18).inTimezone('Asia/Seoul').create();
  const key = fcmKey_();
  console.log(key ? 'FCM_KEY 확인됨: ' + key.project_id : '⚠️ 스크립트 속성 FCM_KEY가 아직 없어요.');
  if (key) fcmAccess_(key);
  console.log('매일 18시 마감 알림을 켰어요.');
}
