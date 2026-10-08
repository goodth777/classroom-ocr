// Device storage. Every access is guarded: private windows and blocked storage must not break the app.
const get = k => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const del = k => { try { localStorage.removeItem(k); } catch {} };
const json = (k, d) => { try { return JSON.parse(get(k)) ?? d; } catch { return d; } };

// A student can join several classes on one phone: one token per class, one of them current.
// The "me" cache is kept per class so switching shows that class at once.
const scoped = k => (k === 'me' ? 'me:' + (get('studentToken') || '').slice(0, 12) : k);
const sameClass = (a, b) => a.name === b.name && a.section === b.section && a.number === b.number;

export const store = {
  token: () => get('studentToken'),
  setToken: t => put('studentToken', t),
  // [{token, name, section, number, student}] — what the class switcher lists.
  classes: () => json('studentClasses', []),
  // Adds or refreshes a class entry (rejoining the same class replaces the old token) and makes it current.
  saveClass: info => {
    const list = store.classes().filter(c => c.token !== info.token && !sameClass(c, info));
    put('studentClasses', JSON.stringify([...list, info]));
    put('studentToken', info.token);
  },
  // Leaves the current class on this device; switches to another joined class if there is one.
  clearToken: () => {
    const t = get('studentToken');
    del('c:' + scoped('me'));
    const rest = store.classes().filter(c => c.token !== t);
    put('studentClasses', JSON.stringify(rest));
    if (rest.length) put('studentToken', rest[0].token); else del('studentToken');
    return rest.length;
  },
  key: () => get('teacherKey'),
  setKey: k => put('teacherKey', k),
  clearKey: () => del('teacherKey'),
  draft: k => get('draft:' + k) || '',
  setDraft: (k, v) => put('draft:' + k, v),
  clearDraft: k => del('draft:' + k),
  // Last server answer per screen, so screens can draw instantly and refresh in the background.
  cache: k => json('c:' + scoped(k), null),
  setCache: (k, v) => put('c:' + scoped(k), JSON.stringify(v)),
  // Another class's cached "me" (for the switcher's counts).
  cacheFor: token => json('c:me:' + token.slice(0, 12), null),
  setCacheFor: (token, v) => put('c:me:' + token.slice(0, 12), JSON.stringify(v)),
};
