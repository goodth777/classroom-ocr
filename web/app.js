import { store } from './store.js';
import { render, fail, toast, nextNav } from './ui.js';
import { joinFlow } from './join.js';
import { studentHome, studentEditor } from './student.js';
import { teacherView } from './teacher.js';
import { studentNotify, studentChat } from './inbox.js';
import * as outbox from './outbox.js';

// The teacher link (#/teacher?key=…) is opened once; the key then stays on this device.
const link = /^#\/teacher\?key=([\w-]+)/.exec(location.hash);
if (link) {
  store.setKey(link[1]);
  history.replaceState(null, '', location.pathname + location.search + '#/t');
}

// Routes — teacher: #/t/{classId}/{grid|roster|msg}; student: #/a/{id}, #/notify/{tab}, #/chat[/ann|/a/{id}], anything else = home.
async function route() {
  nextNav();
  const [, view, a, b, c] = location.hash.split('/');
  try {
    if (store.key()) return await teacherView(view === 't' ? a : '', b, c);
    if (!store.token()) return joinFlow();
    if (view === 'a') return await studentEditor(a);
    if (view === 'notify') return await studentNotify(a);
    if (view === 'chat') return await studentChat(a, b);
    return await studentHome();
  } catch (e) {
    if (e.code !== 'auth') return fail(e);
    if (store.key()) {
      store.clearKey();
      return render(`<section class="center"><div class="hero-card"><div class="logo"></div><h1>교사 링크를 다시 열어 주세요</h1>
        <p class="muted">이 기기에 저장된 교사 키가 맞지 않아요. 설정 때 받은 교사 접속 링크를 다시 열면 돼요.</p></div></section>`);
    }
    store.clearToken();
    toast(e.message);
    joinFlow();
  }
}

addEventListener('hashchange', route);
// Load queued submissions first so screens can show "보내는 중", then resume sending them.
outbox.init().then(() => {
  route();
  if (store.token()) outbox.flush();
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
