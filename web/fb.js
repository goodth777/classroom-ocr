// Firebase Realtime Database over plain REST + a Server-Sent Events stream (no SDK to download).
// Sign-in: the server hands this device a Firebase custom token once; the refresh token then keeps it signed in,
// so after the first time a live screen opens without waiting for the (slow) web app server.
import { call, ApiError } from './api.js';
import { store } from './store.js';
import { FIREBASE, LIVE_DB } from './config.js';

const KEY = FIREBASE && FIREBASE.apiKey;
const get = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
// one sign-in per identity: the teacher, or each class a phone has joined
const who = () => (store.key() ? 'fb:t' : 'fb:' + (store.token() || '').slice(0, 12));
const pending = {};

async function signIn(k, old) {
  if (old && old.refresh) {
    const r = await fetch(`https://securetoken.googleapis.com/v1/token?key=${KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(old.refresh),
    }).catch(() => null);
    if (r && r.ok) {
      const j = await r.json();
      const s = { ...old, idToken: j.id_token, refresh: j.refresh_token, exp: Date.now() + j.expires_in * 1000 };
      put(k, s);
      return s;
    }
  }
  const a = await call(store.key() ? 'tLiveAuth' : 'liveAuth');
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: a.token, returnSecureToken: true }),
  }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : {};
  if (!j.idToken) throw new ApiError('실시간 연결에 로그인하지 못했어요. 잠시 후 다시 시도해 주세요.', r ? 'server' : 'offline');
  const s = { idToken: j.idToken, refresh: j.refreshToken, exp: Date.now() + j.expiresIn * 1000, uid: a.uid, c: a.c };
  put(k, s);
  return s;
}

// { idToken, uid, c } — c is the student's class id (the teacher has none).
export function session(force = false) {
  const k = who(), s = get(k);
  if (s && !force && s.exp - 60000 > Date.now()) return Promise.resolve(s);
  return pending[k] || (pending[k] = signIn(k, s).finally(() => { delete pending[k]; }));
}

// One REST call; an expired token is refreshed and the call retried once.
export async function db(method, path, body) {
  for (let retry = 0; ; retry++) {
    const s = await session(retry > 0);
    let r;
    try {
      r = await fetch(`${LIVE_DB}/${path}.json?auth=${s.idToken}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new ApiError('연결이 잠시 끊겼어요.', 'offline');
    }
    if (r.ok) return r.json();
    const text = await r.text();
    if (r.status === 401 && /expired|invalid/i.test(text) && !retry) continue;
    throw new ApiError(r.status === 401 ? '지금은 할 수 없어요.' : '실시간 연결에 문제가 생겼어요.', r.status === 401 ? 'denied' : 'server');
  }
}

// Calls onValue(value) with the whole value at `path` now and after every change. onStatus('ok' | 'offline').
// Reconnects by itself (the browser retries a dropped stream; an expired token is refreshed). Returns stop().
export function listen(path, onValue, onStatus = () => {}) {
  let es = null, stopped = false, data = null, timer = 0;
  const segs = p => p.split('/').filter(Boolean);
  const setAt = (keys, v) => {
    if (!keys.length) { data = v; return; }
    if (data === null || typeof data !== 'object') data = {};
    let o = data;
    for (const k of keys.slice(0, -1)) { if (o[k] === null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }
    const k = keys[keys.length - 1];
    if (v === null) delete o[k]; else o[k] = v;
  };
  const reopen = (force, wait = 0) => { if (es) es.close(); es = null; clearTimeout(timer); timer = setTimeout(() => open(force), wait); };
  const open = async force => {
    if (stopped) return;
    let s;
    try { s = await session(force); } catch (e) { onStatus('offline', e); return reopen(false, 4000); }
    if (stopped) return;
    es = new EventSource(`${LIVE_DB}/${path}.json?auth=${s.idToken}`);
    es.addEventListener('put', e => { const m = JSON.parse(e.data); setAt(segs(m.path), m.data); onStatus('ok'); onValue(data); });
    es.addEventListener('patch', e => { const m = JSON.parse(e.data); Object.keys(m.data || {}).forEach(k => setAt([...segs(m.path), ...segs(k)], m.data[k])); onValue(data); });
    es.addEventListener('auth_revoked', () => reopen(true));
    es.addEventListener('cancel', () => { onStatus('offline'); reopen(true, 4000); });
    // a dropped stream is retried by the browser; a refused one (e.g. token just expired) is closed for good
    es.onerror = () => { onStatus('offline'); if (es && es.readyState === EventSource.CLOSED) reopen(true, 3000); };
  };
  open(false);
  return () => { stopped = true; clearTimeout(timer); if (es) es.close(); };
}
