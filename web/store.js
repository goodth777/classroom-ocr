// Device storage. Every access is guarded: private windows and blocked storage must not break the app.
const get = k => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const del = k => { try { localStorage.removeItem(k); } catch {} };

export const store = {
  token: () => get('studentToken'),
  setToken: t => put('studentToken', t),
  clearToken: () => { del('studentToken'); del('c:me'); },
  key: () => get('teacherKey'),
  setKey: k => put('teacherKey', k),
  clearKey: () => del('teacherKey'),
  draft: k => get('draft:' + k) || '',
  setDraft: (k, v) => put('draft:' + k, v),
  clearDraft: k => del('draft:' + k),
  // Last server answer per screen, so screens can draw instantly and refresh in the background.
  cache: k => { try { return JSON.parse(get('c:' + k) || 'null'); } catch { return null; } },
  setCache: (k, v) => put('c:' + k, JSON.stringify(v)),
};
