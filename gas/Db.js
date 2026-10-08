// Google Sheet as a tiny database: one sheet per table, header row = column names, every cell stored as text.

const HEADERS_ = {
  Classes: ['id', 'name', 'section', 'subject', 'code', 'created'],
  Students: ['id', 'classId', 'number', 'name', 'pin', 'created'],
  Devices: ['tokenHash', 'studentId', 'created', 'lastSeen'],
  Assignments: ['id', 'classId', 'title', 'description', 'due', 'created', 'studentIds'],
  Submissions: ['id', 'assignmentId', 'studentId', 'text', 'photoIds', 'submittedAt', 'late'],
};

let db_cache_ = null;
const prop_ = k => PropertiesService.getScriptProperties().getProperty(k);
const db_ = () => db_cache_ || (db_cache_ = SpreadsheetApp.openById(prop_('DB_ID')));
const sheet_ = name => db_().getSheetByName(name);

// Small tables are cached for a minute in CacheService (a sheet read costs ~0.3s); every read is also
// memoised for the rest of the request. Writes drop both. Inside withLock_ reads always go to the sheet.
const CACHED_ = { Classes: true, Students: true, Devices: true, Assignments: true };
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

// Adds columns introduced after setup() (e.g. Assignments.studentIds) to older sheets, once.
function ensureSchema_() {
  const cache = CacheService.getScriptCache();
  if (cache.get('schema:2')) return;
  Object.keys(HEADERS_).forEach(name => {
    const sh = sheet_(name);
    const head = sh.getRange(1, 1, 1, HEADERS_[name].length).getDisplayValues()[0];
    HEADERS_[name].forEach((k, i) => { if (head[i] !== k) sh.getRange(1, i + 1).setNumberFormat('@').setValue(k); });
  });
  cache.put('schema:2', '1', 21600);
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
