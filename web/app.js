import { store } from './store.js';
import { render, fail, toast, nextNav } from './ui.js';
import { joinFlow } from './join.js';
import { studentHome, studentEditor } from './student.js';
import { teacherView } from './teacher.js';

// The teacher link (#/teacher?key=…) is opened once; the key then stays on this device.
const link = /^#\/teacher\?key=([\w-]+)/.exec(location.hash);
if (link) {
  store.setKey(link[1]);
  history.replaceState(null, '', location.pathname + location.search + '#/t');
}

// Routes — teacher: #/t/{classId}/{grid|roster}; student: #/a/{assignmentId}, anything else = home.
async function route() {
  nextNav();
  const [, view, a, b] = location.hash.split('/');
  try {
    if (store.key()) return await teacherView(view === 't' ? a : '', b);
    if (!store.token()) return joinFlow();
    if (view === 'a') return await studentEditor(a);
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
route();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
