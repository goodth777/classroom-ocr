// Live classroom activities run on Firebase Realtime Database: the teacher's screen writes the activity to
// /live/{classId}, phones get every change at once over a stream, and each student writes only their own
// answers under /ans/{classId}/{activityId}/{studentId}. A round trip there is ~0.3 s; one through this
// web app is ~3 s, so this server only signs devices in (once), installs the rules, sends push and keeps records.

const LIVE_DB_ = 'https://classroom-ocr-51580-default-rtdb.asia-southeast1.firebasedatabase.app';
const FB_API_KEY_ = 'AIzaSyAVLklRFp756kFvnkseK6UbTGPf8gt5_jY'; // public web key, same as web/config.js
const DB_SCOPES_ = 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email';
const LIVE_TYPES_ = { vote: '📊 투표', word: '☁️ 단어 구름', text: '💬 한 줄 의견', light: '🚦 이해도 신호등', quiz: '🎯 함께 푸는 퀴즈' };

// Who may read and write what. Students: only their own class's activity, only their own answers,
// a quiz answer once and only while that question is open. The teacher (claim t) may do everything.
const LIVE_RULES_V_ = '1';
const LIVE_RULES_ = { rules: {
  live: { $c: {
    '.read': 'auth != null && (auth.token.t === true || auth.token.c === $c)',
    '.write': 'auth != null && auth.token.t === true',
  } },
  ans: { $c: {
    '.write': 'auth != null && auth.token.t === true',
    $a: {
      '.read': 'auth != null && auth.token.t === true',
      $uid: {
        '.read': 'auth != null && auth.uid === $uid',
        '.write': "auth != null && auth.uid === $uid && auth.token.c === $c && root.child('live/' + $c + '/id').val() === $a",
        v: { '.validate': 'newData.isNumber() && newData.val() >= 0 && newData.val() < 6' },
        t: { '.validate': 'newData.isString() && newData.val().length <= 100' },
        at: { '.validate': 'newData.isNumber()' },
        w: { $k: { '.validate': '$k.matches(/^[0-2]$/) && newData.isString() && newData.val().length <= 20' } },
        qz: { $i: { '.validate': "!data.exists() && root.child('live/' + $c + '/quiz/key').val() === $i && root.child('live/' + $c + '/quiz/phase').val() === 'ask' && newData.child('c').isNumber() && newData.child('ms').isNumber()" } },
        $other: { '.validate': false },
      },
    },
  } },
} };

const b64url_ = s => Utilities.base64EncodeWebSafe(s).replace(/=+$/, '');

// Firebase custom token (signed with the service account in FCM_KEY); the phone trades it for an ID token.
function customToken_(key, uid, claims) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url_(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64url_(JSON.stringify({ iss: key.client_email, sub: key.client_email, uid, claims, iat: now, exp: now + 3600,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit' }));
  return head + '.' + body + '.' + b64url_(Utilities.computeRsaSha256Signature(head + '.' + body, key.private_key));
}

function liveKey_() {
  const key = fcmKey_();
  if (!key) throw err_('실시간 도구를 쓰려면 Firebase 서비스 계정 키(FCM_KEY)가 필요해요.');
  return key;
}

// Installs the rules once per version, then checks them against the real database with test sign-ins.
// The result is kept so anyone can read it (liveHealth); a failing check is retried at most once a minute.
function ensureLive_() {
  const p = PropertiesService.getScriptProperties();
  const done = () => parse_(p.getProperty('LIVE_CHECK'), null);
  if (p.getProperty('LIVE_RULES_V') === LIVE_RULES_V_) return done();
  const cache = CacheService.getScriptCache();
  if (cache.get('live:retry')) return done();
  return withLock_(() => {
    if (p.getProperty('LIVE_RULES_V') === LIVE_RULES_V_) return done();
    cache.put('live:retry', '1', 60);
    let check;
    try {
      const key = liveKey_();
      const res = UrlFetchApp.fetch(LIVE_DB_ + '/.settings/rules.json', { method: 'put', contentType: 'application/json', muteHttpExceptions: true,
        headers: { Authorization: 'Bearer ' + saToken_(key, DB_SCOPES_) }, payload: JSON.stringify(LIVE_RULES_) });
      check = res.getResponseCode() === 200 ? liveSelfTest_(key) : { ok: false, at: now_(), out: [['규칙 설치 ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 160), false]] };
    } catch (e) {
      check = { ok: false, at: now_(), out: [[String(e.userMessage || e.message).slice(0, 200), false]] };
    }
    p.setProperty('LIVE_CHECK', JSON.stringify(check));
    if (check.ok) { p.setProperty('LIVE_RULES_V', LIVE_RULES_V_); cache.remove('live:retry'); }
    return check;
  });
}

// Real requests with test identities in a throwaway class: what must work works, what must not is refused.
function liveSelfTest_(key) {
  const out = [];
  let ok = true;
  try {
    const signIn = (uid, claims) => {
      const r = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=' + FB_API_KEY_, { method: 'post', contentType: 'application/json',
        muteHttpExceptions: true, payload: JSON.stringify({ token: customToken_(key, uid, claims), returnSecureToken: true }) });
      const j = parse_(r.getContentText(), {});
      if (!j.idToken) throw new Error('로그인 ' + r.getResponseCode() + ' ' + r.getContentText().slice(0, 160));
      return j.idToken;
    };
    const T = signIn('__teacher', { t: true }), S = signIn('__s1', { c: '__selftest' }), O = signIn('__s2', { c: '__other' });
    const req = (tok, method, path, body) => UrlFetchApp.fetch(LIVE_DB_ + '/' + path + '.json?auth=' + tok,
      Object.assign({ method, muteHttpExceptions: true }, body === undefined ? {} : { contentType: 'application/json', payload: JSON.stringify(body) })).getResponseCode();
    const expect = (name, code, allowed) => { const pass = allowed ? code === 200 : code === 401; out.push([name, pass]); if (!pass) ok = false; };
    expect('선생님이 활동을 씀', req(T, 'put', 'live/__selftest', { id: 'A', type: 'quiz', quiz: { key: '0', phase: 'ask' } }), true);
    expect('학생이 자기 클래스 활동을 읽음', req(S, 'get', 'live/__selftest'), true);
    expect('다른 클래스 학생은 못 읽음', req(O, 'get', 'live/__selftest'), false);
    expect('학생이 퀴즈 답을 냄', req(S, 'put', 'ans/__selftest/A/__s1/qz/0', { c: 1, ms: 100 }), true);
    expect('퀴즈 답은 한 번만', req(S, 'put', 'ans/__selftest/A/__s1/qz/0', { c: 0, ms: 50 }), false);
    expect('학생이 투표함', req(S, 'patch', 'ans/__selftest/A/__s1', { v: 1, at: 1 }), true);
    expect('친구 답은 못 씀', req(S, 'patch', 'ans/__selftest/A/__s2', { v: 1 }), false);
    expect('학생은 다른 답을 못 읽음', req(S, 'get', 'ans/__selftest/A'), false);
    expect('선생님이 답을 읽음', req(T, 'get', 'ans/__selftest/A'), true);
    req(T, 'patch', 'live/__selftest/quiz', { key: '1', phase: 'reveal' });
    expect('정답 공개 뒤에는 못 냄', req(S, 'put', 'ans/__selftest/A/__s1/qz/1', { c: 0, ms: 1 }), false);
    req(T, 'delete', 'ans/__selftest');
    req(T, 'delete', 'live/__selftest');
  } catch (e) {
    ok = false;
    out.push([String(e.message).slice(0, 200), false]);
  }
  return { ok, at: now_(), out };
}

// ---------- routes ----------

function liveAuth_(req, who) {
  const check = ensureLive_();
  if (!check || !check.ok) throw err_('실시간 연결을 준비하고 있어요. 잠시 후 다시 시도해 주세요.');
  return { token: customToken_(liveKey_(), who.student.id, { c: who.cls.id }), uid: who.student.id, c: who.cls.id };
}

function tLiveAuth_() {
  const check = ensureLive_();
  if (!check || !check.ok) throw err_('실시간 연결 설정에 실패했어요: ' + (check ? check.out.filter(x => !x[1]).map(x => x[0]).join(' / ') : '잠시 후 다시 시도해 주세요.'));
  return { token: customToken_(liveKey_(), 'teacher', { t: true }), uid: 'teacher' };
}

// Pass/fail list only (no secrets); also installs the rules the first time it is asked.
function liveHealth_() {
  try { return ensureLive_(); } catch (e) { return { ok: false, out: [[e.userMessage || String(e.message), false]] }; }
}

const classSids_ = classId => rows_('Students').filter(s => s.classId === classId).map(s => s.id);

function livePush_(req) {
  if (!LIVE_TYPES_[req.type]) return false;
  notifyStudents_(classSids_(req.classId), 'ann', { title: '지금 수업 활동 · ' + LIVE_TYPES_[req.type], body: String(req.q || '').slice(0, 120), url: '#/live', tag: 'live' });
  return true;
}

// The teacher's screen sends the finished activity; names are added here (none when anonymous).
function liveSave_(req) {
  const r = req.rec || {};
  if (!r.id || !LIVE_TYPES_[r.type] || !r.st) throw err_('기록을 저장하지 못했어요.');
  const names = {};
  if (!r.st.anon || r.type === 'quiz') rows_('Students').filter(s => s.classId === req.classId).forEach(s => { names[s.id] = s.name; });
  let data = JSON.stringify({ st: r.st, sum: r.sum, names });
  if (data.length > 45000) data = JSON.stringify({ st: r.st, sum: Object.assign({}, r.sum, { items: (r.sum.items || []).slice(0, 150), words: (r.sum.words || []).slice(0, 150) }), names }).slice(0, 49000);
  return withLock_(() => {
    if (!rows_('Lives').some(l => l.id === String(r.id))) {
      append_('Lives', { id: r.id, classId: req.classId, type: r.type, title: String(r.st.q || '').slice(0, 200), data, started: new Date(+r.st.started || Date.now()).toISOString(), ended: now_() });
    }
    return true;
  });
}

const lives_ = req => rows_('Lives').filter(l => l.classId === req.classId).map(l => ({ id: l.id, type: l.type, title: l.title, started: l.started, ended: l.ended })).reverse();
function liveRec_(req) {
  const l = rows_('Lives').find(x => x.id === req.id && x.classId === req.classId);
  if (!l) throw err_('기록을 찾을 수 없어요.', 'notfound');
  return parse_(l.data, null);
}
function liveRecDel_(req) {
  return withLock_(() => { deleteRows_('Lives', rows_('Lives').filter(x => x.id === req.id && x.classId === req.classId)); return lives_(req); });
}
