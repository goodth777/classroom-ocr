// Google Sheet as a tiny database: one sheet per table, header row = column names, every cell stored as text.

const HEADERS_ = {
  Classes: ['id', 'name', 'section', 'subject', 'code', 'created'],
  Students: ['id', 'classId', 'number', 'name', 'pin', 'created'],
  Devices: ['tokenHash', 'studentId', 'created', 'lastSeen'],
  Assignments: ['id', 'classId', 'title', 'description', 'due', 'created', 'studentIds'],
  Submissions: ['id', 'assignmentId', 'studentId', 'text', 'photoIds', 'submittedAt', 'late'],
  Messages: ['id', 'classId', 'studentId', 'from', 'text', 'assignmentId', 'created', 'readAt'],
  Announcements: ['id', 'classId', 'title', 'body', 'pinned', 'created'],
  AnnReads: ['annId', 'studentId', 'readAt'],
};

let db_cache_ = null;
const prop_ = k => PropertiesService.getScriptProperties().getProperty(k);
const db_ = () => db_cache_ || (db_cache_ = SpreadsheetApp.openById(prop_('DB_ID')));
const sheet_ = name => db_().getSheetByName(name);

// Small tables are cached for a minute in CacheService (a sheet read costs ~0.3s); every read is also
// memoised for the rest of the request. Writes drop both. Inside withLock_ reads always go to the sheet.
const CACHED_ = { Classes: true, Students: true, Devices: true, Assignments: true, Announcements: true, AnnReads: true };
let memo_ = {};
let fresh_ = false;

function rows_(name) {
  if (memo_[name]) return memo_[name];
  const cache = CacheService.getScriptCache();
  let values = null;
  if (CACHED_[name] && !fresh_) {
    const hit = cache.get('t:' + name);
    if (hit) values = JSON.parse(hit);
  }
  if (!values) {
    values = sheet_(name).getDataRange().getDisplayValues();
    const json = JSON.stringify(values);
    if (CACHED_[name] && json.length < 95000) cache.put('t:' + name, json, 60);
  }
  const head = values[0];
  const out = values.slice(1).map((r, i) => {
    const o = { _row: i + 2 };
    head.forEach((k, j) => { o[k] = r[j]; });
    return o;
  });
  memo_[name] = out;
  return out;
}

function dirty_(name) {
  delete memo_[name];
  CacheService.getScriptCache().remove('t:' + name);
}

// Adds sheets and columns introduced after setup() (e.g. Messages, Assignments.studentIds), once.
function ensureSchema_() {
  const cache = CacheService.getScriptCache();
  if (cache.get('schema:3')) return;
  Object.keys(HEADERS_).forEach(name => {
    let sh = sheet_(name);
    if (!sh) {
      sh = db_().insertSheet(name);
      sh.getRange('A:Z').setNumberFormat('@');
      sh.appendRow(HEADERS_[name]);
      sh.setFrozenRows(1);
      return;
    }
    const head = sh.getRange(1, 1, 1, HEADERS_[name].length).getDisplayValues()[0];
    HEADERS_[name].forEach((k, i) => { if (head[i] !== k) sh.getRange(1, i + 1).setNumberFormat('@').setValue(k); });
  });
  cache.put('schema:3', '1', 21600);
}

const cells_ = (name, obj) => HEADERS_[name].map(k => (obj[k] == null ? '' : String(obj[k])));
const append_ = (name, obj) => { sheet_(name).appendRow(cells_(name, obj)); dirty_(name); };
const update_ = (name, row, obj) => { sheet_(name).getRange(row, 1, 1, HEADERS_[name].length).setValues([cells_(name, obj)]); dirty_(name); };

// Deletes bottom-up so earlier row numbers stay valid.
function deleteRows_(name, rows) {
  rows.map(r => r._row).sort((a, b) => b - a).forEach(n => sheet_(name).deleteRow(n));
  if (rows.length) dirty_(name);
}

// One writer at a time; a busy lock surfaces as a retryable error.
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw err_('지금 사용하는 친구들이 많아요. 잠시 후 다시 시도해 주세요.', 'busy');
  fresh_ = true;
  memo_ = {};
  try { return fn(); } finally { fresh_ = false; memo_ = {}; lock.releaseLock(); }
}

const newId_ = () => Utilities.getUuid().replace(/-/g, '').slice(0, 12);
const now_ = () => new Date().toISOString();

// ---------- result cache ----------
// Whole computed answers (a student's "me", a class view) are cached under a version key.
// Any write that can change them bumps the class version (and the global one for teacher views),
// so stale answers are simply never looked up again.
const RESULT_TTL_ = 21600; // 6h, CacheService maximum

function verOf_(scope) {
  const cache = CacheService.getScriptCache();
  let v = cache.get('ver:' + scope);
  if (!v) { v = Utilities.getUuid().slice(0, 8); cache.put('ver:' + scope, v, RESULT_TTL_); }
  return v;
}

function bump_(classId) {
  const v = Utilities.getUuid().slice(0, 8);
  const keys = { 'ver:all': v };
  if (classId) keys['ver:' + classId] = v;
  CacheService.getScriptCache().putAll(keys, RESULT_TTL_);
}

// CacheService values max out at 100KB, so big JSON is split across numbered keys.
function getBig_(key) {
  const cache = CacheService.getScriptCache();
  const n = +(cache.get(key + '#n') || 0);
  if (!n) return null;
  const parts = cache.getAll(Array.from({ length: n }, (_, i) => key + '#' + i));
  let s = '';
  for (let i = 0; i < n; i++) { const p = parts[key + '#' + i]; if (p == null) return null; s += p; }
  return JSON.parse(s);
}

function putBig_(key, value) {
  const s = JSON.stringify(value);
  const size = 90000;
  const n = Math.ceil(s.length / size) || 1;
  if (n > 30) return; // ponytail: too big to be worth caching; compute every time
  const out = { [key + '#n']: String(n) };
  for (let i = 0; i < n; i++) out[key + '#' + i] = s.slice(i * size, (i + 1) * size);
  CacheService.getScriptCache().putAll(out, RESULT_TTL_);
}

function cached_(key, fn) {
  const hit = getBig_(key);
  if (hit) return hit;
  const v = fn();
  putBig_(key, v);
  return v;
}
