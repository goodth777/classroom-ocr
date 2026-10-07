// Google Sheet as a tiny database: one sheet per table, header row = column names, every cell stored as text.

const HEADERS_ = {
  Classes: ['id', 'name', 'section', 'subject', 'code', 'created'],
  Students: ['id', 'classId', 'number', 'name', 'pin', 'created'],
  Devices: ['tokenHash', 'studentId', 'created', 'lastSeen'],
  Assignments: ['id', 'classId', 'title', 'description', 'due', 'created'],
  Submissions: ['id', 'assignmentId', 'studentId', 'text', 'photoIds', 'submittedAt', 'late'],
};

let db_cache_ = null;
const prop_ = k => PropertiesService.getScriptProperties().getProperty(k);
const db_ = () => db_cache_ || (db_cache_ = SpreadsheetApp.openById(prop_('DB_ID')));
const sheet_ = name => db_().getSheetByName(name);

function rows_(name) {
  const values = sheet_(name).getDataRange().getDisplayValues();
  const head = values.shift();
  return values.map((r, i) => {
    const o = { _row: i + 2 };
    head.forEach((k, j) => { o[k] = r[j]; });
    return o;
  });
}

const cells_ = (name, obj) => HEADERS_[name].map(k => (obj[k] == null ? '' : String(obj[k])));
const append_ = (name, obj) => sheet_(name).appendRow(cells_(name, obj));
const update_ = (name, row, obj) => sheet_(name).getRange(row, 1, 1, HEADERS_[name].length).setValues([cells_(name, obj)]);

// Deletes bottom-up so earlier row numbers stay valid.
function deleteRows_(name, rows) {
  rows.map(r => r._row).sort((a, b) => b - a).forEach(n => sheet_(name).deleteRow(n));
}

// One writer at a time; a busy lock surfaces as a retryable error.
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw err_('지금 사용하는 친구들이 많아요. 잠시 후 다시 시도해 주세요.', 'busy');
  try { return fn(); } finally { lock.releaseLock(); }
}

const newId_ = () => Utilities.getUuid().replace(/-/g, '').slice(0, 12);
const now_ = () => new Date().toISOString();
