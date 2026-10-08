// Device storage. Every access is guarded: private windows and blocked storage must not break the app.
const get = k => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const del = k => { try { localStorage.removeItem(k); } catch {} };

export const store = {
  token: () => get('studentToken'),
  setToken: t => put('studentToken', t),
  clearToken: () => { del('studentToken'); del('studentMe'); },
  key: () => get('teacherKey'),
  setKey: k => put('teacherKey', k),
  clearKey: () => del('teacherKey'),
  draft: k => get('draft:' + k) || '',
  setDraft: (k, v) => put('draft:' + k, v),
  clearDraft: k => del('draft:' + k),
};
