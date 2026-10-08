import { call } from './api.js';
import { store } from './store.js';

// Submissions are queued on the device and sent in the background, so students never wait for the
// server. Items survive app restarts (IndexedDB) and are resumed on the next launch or when back online.
// item: {id, assignmentId, title, text, photos[base64], token (class it belongs to), createdAt, status: 'sending'|'fail', tries}

const MAX_TRIES = 3;
let items = [];
let db = null;
let running = false;

function idb() {
  return new Promise(resolve => {
    try {
      const req = indexedDB.open('outbox', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('items', { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); } // private mode etc.: queue still works, just not across restarts
  });
}

function tx(mode, fn) {
  if (!db) return Promise.resolve();
  return new Promise(resolve => {
    try {
      const t = db.transaction('items', mode);
      fn(t.objectStore('items'));
      t.oncomplete = t.onerror = t.onabort = () => resolve();
    } catch { resolve(); }
  });
}

const save = item => tx('readwrite', s => s.put(item));
const drop = id => tx('readwrite', s => s.delete(id));
const emit = (item, state, extra = {}) => dispatchEvent(new CustomEvent('outbox', { detail: { item, state, ...extra } }));

export async function init() {
  db = await idb();
  if (db) {
    items = await new Promise(resolve => {
      try {
        const r = db.transaction('items').objectStore('items').getAll();
        r.onsuccess = () => resolve(r.result || []);
        r.onerror = () => resolve([]);
      } catch { resolve([]); }
    });
  }
  items.forEach(i => { if (i.status === 'fail') return; i.status = 'sending'; i.resumed = true; });
  addEventListener('online', flush);
}

export const list = () => items.slice();
export const forAssignment = id => items.find(i => i.assignmentId === id) || null;

// A newer submission for the same assignment replaces one that has not been sent yet.
export async function enqueue({ assignmentId, title, text, photos }) {
  const replaced = items.filter(i => i.assignmentId === assignmentId && i !== sendingNow);
  items = items.filter(i => !replaced.includes(i));
  await Promise.all(replaced.map(i => drop(i.id)));
  const item = { id: `${assignmentId}:${Date.now()}`, assignmentId, title, text, photos, token: store.token(), createdAt: new Date().toISOString(), status: 'sending', tries: 0 };
  items.push(item);
  await save(item);
  flush();
  return item;
}

export function retry(id) {
  const item = items.find(i => i.id === id);
  if (!item) return;
  item.status = 'sending';
  item.tries = 0;
  save(item);
  emit(item, 'sending');
  flush();
}

let sendingNow = null;

// Sends queued items one at a time; each gets MAX_TRIES attempts (each attempt already retries network blips).
export async function flush() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const item = items.find(i => i.status === 'sending');
      if (!item) break;
      sendingNow = item;
      emit(item, 'sending');
      try {
        const r = await call('submit', { assignmentId: item.assignmentId, text: item.text, photos: item.photos, ...(item.token ? { token: item.token } : {}) });
        items = items.filter(i => i !== item);
        await drop(item.id);
        emit(item, 'ok', { result: r });
      } catch (e) {
        item.tries++;
        if (e.code === 'auth' || e.code === 'notfound' || e.code === 'bad' || item.tries >= MAX_TRIES) {
          item.status = 'fail';
          item.error = e.message;
          await save(item);
          emit(item, 'fail', { error: e.message });
        } else {
          await new Promise(r => setTimeout(r, 2000 * item.tries));
        }
      } finally {
        sendingNow = null;
      }
    }
  } finally {
    running = false;
  }
}
