// Runs the real gas/*.js files in one Node sandbox with small fakes of the Google services,
// so a request can go through doPost exactly as on the server (same global scope, same routes).
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

function makeSheet(rows) {
  const sh = {
    rows,
    getDataRange: () => ({ getDisplayValues: () => sh.rows.map(r => r.map(String)) }),
    appendRow: r => { sh.rows.push(r.map(String)); },
    getRange: (r, c, nr = 1, nc = 1) => ({
      getDisplayValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => String((sh.rows[r - 1 + i] || [])[c - 1 + j] ?? ''))),
      setValues: v => v.forEach((row, i) => { sh.rows[r - 1 + i] = sh.rows[r - 1 + i] || []; row.forEach((x, j) => { sh.rows[r - 1 + i][c - 1 + j] = String(x); }); }),
      setValue: x => { sh.rows[r - 1] = sh.rows[r - 1] || []; sh.rows[r - 1][c - 1] = String(x); },
      setNumberFormat: () => sh.getRange(r, c, nr, nc),
    }),
    deleteRow: n => { sh.rows.splice(n - 1, 1); },
    setFrozenRows: () => {},
  };
  return sh;
}

function sandbox(seed = {}) {
  const store = new Map();
  const cache = {
    get: k => (store.has(k) ? store.get(k) : null),
    put: (k, v) => { if (String(v).length > 100000) throw new Error('cache value too big: ' + k); store.set(k, String(v)); },
    getAll: ks => Object.fromEntries(ks.filter(k => store.has(k)).map(k => [k, store.get(k)])),
    putAll: o => Object.entries(o).forEach(([k, v]) => cache.put(k, v)),
    remove: k => store.delete(k),
    removeAll: ks => ks.forEach(k => store.delete(k)),
  };
  const sheets = {};
  const ss = {
    getSheetByName: n => sheets[n] || null,
    insertSheet: n => (sheets[n] = makeSheet([])),
    getUrl: () => 'https://sheet',
  };
  const props = { DB_ID: 'db', TEACHER_KEY: 'teacher-key', FOLDER_ID: 'f' };
  const ctx = {
    console, JSON, Math, Date, Object, Array, String, Number, Set, Map, Error, RegExp, Boolean, parseInt, isNaN,
    CacheService: { getScriptCache: () => cache },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    SpreadsheetApp: { openById: () => ss },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      computeDigest: (_, s) => [...crypto.createHash('sha256').update(String(s)).digest()].map(b => (b > 127 ? b - 256 : b)),
      getUuid: () => crypto.randomUUID(),
      formatDate: (d, _tz, fmt) => new Date(d.getTime() + 9 * 36e5).toISOString().slice(0, fmt.includes('HH') ? 16 : 10),
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ setMimeType: () => ({ text: s }) }) },
    UrlFetchApp: { fetchAll: () => [] },
  };
  vm.createContext(ctx);
  const dir = path.join(__dirname, '..', 'gas');
  // like Apps Script: every file is its own script in one shared global scope
  fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort().forEach(f => vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f }));
  vm.runInContext('ensureSchema_()', ctx);
  Object.entries(seed).forEach(([name, objs]) => {
    const head = vm.runInContext(`HEADERS_[${JSON.stringify(name)}]`, ctx);
    objs.forEach(o => sheets[name].appendRow(head.map(k => (o[k] == null ? '' : String(o[k])))));
  });
  const post = req => {
    vm.runInContext('memo_ = {}', ctx); // a new request starts with an empty per-request memo
    return JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(req) } }).text);
  };
  const tokenHash = t => crypto.createHash('sha256').update(t).digest('hex');
  return { post, sheets, cache: store, ctx, tokenHash };
}

module.exports = { sandbox };
