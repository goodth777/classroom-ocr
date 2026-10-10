// Live activities on the student's phone (#/live) and the "지금 수업 활동" banner on home.
// Both follow the class's activity in Firebase Realtime Database over a stream, so a change on the teacher's
// screen shows here in well under a second. Taps change the screen at once and are written in the background.
import { toast, render, currentNav, isCurrent } from './ui.js';
import { esc } from './lib.js';
import { store } from './store.js';
import { session, listen, db } from './fb.js';
import { quizPoints, quizTotal, list } from './livecore.js';

const SHAPES = ['▲', '◆', '●', '■', '★', '♥'];
const QCOLORS = ['#e2574c', '#3f7fe0', '#d9a520', '#2aa772', '#9b6ad6', '#e0679e'];
const LIGHTS = [['🟢', '이해했어요'], ['🟡', '조금 헷갈려요'], ['🔴', '모르겠어요']];
const TITLE = { vote: ['📊', '투표'], word: ['☁️', '단어'], text: ['💬', '한 줄 의견'], light: ['🚦', '이해도'], quiz: ['🎯', '퀴즈'] };
// an ended activity, or one the teacher forgot to end (3 hours), no longer shows
const fresh = st => !!(st && st.id && TITLE[st.type] && !st.ended && Date.now() - (+st.started || 0) < 3 * 36e5);

// Follows this class's activity: starts after the one-time sign-in (retried until it works), returns stop().
function followClass(onValue, onStatus = () => {}, onSession = () => {}) {
  let stop = null, stopped = false, timer = 0;
  const go = () => session().then(s => { if (stopped) return; onSession(s); stop = listen(`live/${s.c}`, onValue, onStatus); })
    .catch(e => { if (stopped) return; onStatus('offline', e); if (e.code !== 'auth') timer = setTimeout(go, 5000); });
  go();
  return () => { stopped = true; clearTimeout(timer); if (stop) stop(); };
}

// ---------- home banner ----------

const banner = { slot: '', tok: '', last: null, stop: null, timer: 0 };
const paintBanner = () => {
  const el = document.getElementById(banner.slot), d = banner.last;
  if (el) el.innerHTML = fresh(d) ? `<a class="lv-banner" href="#/live"><span class="e">${TITLE[d.type][0]}</span><span><b>지금 수업 활동</b><small>${esc(TITLE[d.type][1])}${d.q ? ' · ' + esc(d.q) : ''}</small></span><span class="go">참여</span></a>` : '';
};
// the stream stays open only while home is on screen (and is switched with the class)
const checkBanner = () => {
  const on = !!document.getElementById(banner.slot) && document.visibilityState === 'visible';
  const tok = store.token();
  if (banner.stop && (!on || banner.tok !== tok)) { banner.stop(); banner.stop = null; }
  if (banner.tok !== tok) { banner.tok = tok; banner.last = null; paintBanner(); }
  if (on && !banner.stop) banner.stop = followClass(v => { banner.last = v; paintBanner(); });
  if (!document.getElementById(banner.slot)) { clearInterval(banner.timer); banner.timer = 0; }
};
export function watchLive(slot) {
  banner.slot = slot;
  paintBanner();
  checkBanner();
  if (!banner.timer) banner.timer = setInterval(checkBanner, 1500);
}
document.addEventListener('visibilitychange', () => { if (banner.timer) checkBanner(); });

// ---------- live screen ----------

// What the screen draws: the activity plus this student's own answers (and own quiz points).
function toView(st, m) {
  const v = { id: st.id, type: st.type, q: st.q, options: list(st.options), show: !!st.show, anon: !!st.anon,
    mine: { v: m.v, w: list(m.w), t: m.t || '' }, result: st.show ? st.result || null : null };
  if (st.type === 'quiz') {
    const z = st.quiz, a = m.qz && m.qz[z.i];
    v.quiz = { title: z.title, i: z.i, n: z.n, phase: z.phase, limit: z.limit, q: z.q, options: list(z.options), mine: a ? { c: +a.c } : null };
    if (z.phase !== 'ask') {
      v.quiz.answer = +z.answer;
      v.quiz.pts = a ? quizPoints(+a.c === +z.answer, a.ms, z.limit * 1000) : 0;
      v.quiz.total = quizTotal(z.keys, z.limit, m);
    }
  }
  return v;
}

export async function liveView() {
  const nav = currentNav();
  let st, cur, mine = {}, mineFor = '', resetAt = 0, shape = '', sending = 0, seenAny = false, online = true;
  let me = null, stop = null;
  const seen = {}; // quiz question index → when this phone first showed it (answer speed is measured here)

  const head = d => `<header class="lv-top"><a href="#/home" class="lv-back" aria-label="홈으로">‹</a><b>${d ? TITLE[d.type][0] + ' ' + esc(TITLE[d.type][1]) : '수업 활동'}</b>${d ? `<span class="lv-dot ${online ? '' : 'off'}"><i></i>${online ? '진행 중' : '다시 연결 중'}</span>` : ''}</header>`;
  const close = () => { if (stop) stop(); stop = null; document.removeEventListener('visibilitychange', wake); };
  const ended = () => {
    close();
    render(`${head(null)}<section class="lv-done"><div class="big">👋</div><b>${seenAny ? '활동이 끝났어요' : '지금 진행 중인 활동이 없어요'}</b><small>홈으로 돌아가요</small></section>`);
    setTimeout(() => { if (isCurrent(nav) && location.hash === '#/live') location.hash = '#/home'; }, 1800);
  };
  const offline = err => {
    shape = '';
    render(`${head(null)}<section class="lv-done"><div class="spin"></div><b class="no">다시 연결하는 중…</b><small>${esc(err && err.code !== 'offline' && err.message ? err.message : '인터넷이 느리거나 잠시 끊겼어요.')} 자동으로 다시 시도해요.</small></section>`);
  };

  // structure is drawn once per activity / quiz step; the dynamic part redraws without touching inputs
  const draw = () => {
    if (!isCurrent(nav)) return close();
    if (!cur) return ended();
    seenAny = true;
    const z = cur.quiz;
    const s = cur.id + cur.type + (z ? z.i + z.phase + !!z.mine : '') + cur.show + online;
    if (s !== shape) {
      shape = s;
      render(`${head(cur)}<section class="lv-phone">${cur.q && cur.type !== 'quiz' ? `<div class="lv-pq">${esc(cur.q)}</div>` : ''}${fixed()}<div id="lvDyn"></div></section>`);
      bind();
    }
    const dyn = document.getElementById('lvDyn');
    if (dyn) dyn.innerHTML = dynamic();
  };
  const update = () => { cur = fresh(st) ? toView(st, mine) : null; draw(); };

  const fixed = () => {
    if (cur.type === 'word') return `<form class="lv-send" id="lvSend"><input id="lvIn" maxlength="20" placeholder="한 단어" autocomplete="off" enterkeyhint="send"><button>보내기</button></form>`;
    if (cur.type === 'text') return `<form class="lv-send col" id="lvSend"><textarea id="lvIn" maxlength="100" rows="3" placeholder="한 줄로 써 주세요">${esc(cur.mine.t)}</textarea><button>${cur.mine.t ? '고쳐서 보내기' : '보내기'}</button></form>`;
    return '';
  };

  const dynamic = () => {
    const m = cur.mine;
    const wait = sending ? '<p class="lv-note">보내는 중…</p>' : '';
    if (cur.type === 'vote') {
      return cur.options.map((o, i) => `<button type="button" class="lv-opt ${m.v === i ? 'on' : ''}" data-v="${i}"><span>${i + 1}</span>${esc(o)}${cur.result ? `<em>${list(cur.result.counts)[i] || 0}</em>` : ''}</button>`).join('')
        + (wait || `<p class="lv-note">${typeof m.v === 'number' ? '보냈어요 ✓ 다른 보기를 누르면 바꿀 수 있어요' : '누르면 바로 보내져요'}${cur.anon ? ' · 이름 없이' : ''}</p>`);
    }
    if (cur.type === 'light') {
      return `<p class="lv-note">언제든 바꿀 수 있어요 · 친구들은 못 봐요</p><div class="lv-lightbtns">${LIGHTS.map(([e, t], i) => `<button type="button" data-v="${i}" class="${m.v === i ? 'on' : ''}"><i>${e}</i>${t}</button>`).join('')}</div>${wait}`;
    }
    if (cur.type === 'word') {
      return (wait || `<p class="lv-note">${m.w.length}/3 보냄${m.w.length ? ' · ' + m.w.map(esc).join(', ') : ''}</p>`)
        + (cur.result ? `<div class="lv-pcloud">${list(cur.result.words).map(w => `<span style="font-size:${14 + Math.min(20, w.n * 4)}px">${esc(w.w)}</span>`).join('')}</div>` : '');
    }
    if (cur.type === 'text') {
      return (wait || `<p class="lv-note">${m.t ? '보냈어요 ✓' : ''}${cur.anon ? ' 이름 없이 보내져요' : ''}</p>`)
        + (cur.result ? `<div class="lv-pcards">${list(cur.result.items).map(x => `<div>${esc(x.t)}</div>`).join('')}</div>` : '');
    }
    if (cur.type === 'quiz') {
      const z = cur.quiz;
      if (z.phase === 'end') return `<div class="lv-res"><div class="big">🏁</div><b>퀴즈 끝!</b><small>내 점수 ${z.total}점</small></div>`;
      if (z.phase === 'reveal') {
        const ok = z.mine && z.mine.c === z.answer;
        return `<div class="lv-res"><div class="big">${ok ? '🎉' : z.mine ? '😅' : '⏰'}</div><b class="${ok ? '' : 'no'}">${ok ? '정답!' : z.mine ? '아쉬워요' : '시간이 끝났어요'}</b>
          <small>${ok ? `+${z.pts}점 · ` : `정답은 ${SHAPES[z.answer]} ${esc(z.options[z.answer] || '')} · `}지금까지 ${z.total}점</small></div><p class="lv-note">다음 문제를 기다리는 중…</p>`;
      }
      if (z.mine) return `<div class="lv-res"><div class="big" style="color:${QCOLORS[z.mine.c]}">${SHAPES[z.mine.c]}</div><b>${sending ? '보내는 중…' : '냈어요!'}</b><small>정답 공개를 기다리는 중…</small></div>`;
      if (!seen[z.i]) seen[z.i] = Date.now();
      return `<p class="lv-note">${z.i + 1} / ${z.n} · 큰 화면의 문제를 보고 눌러요</p><div class="lv-q4 n${z.options.length}">${z.options.map((o, i) => `<button type="button" data-qz="${i}" style="background:${QCOLORS[i]}"><i>${SHAPES[i]}</i><span>${esc(o)}</span></button>`).join('')}</div>`;
    }
    return '';
  };

  const reloadMine = () => db('GET', `ans/${me.c}/${st.id}/${me.uid}`).then(m => { if (!sending && st && mineFor === st.id) { mine = m || {}; update(); } }).catch(() => {});
  // optimistic: change this student's answers and redraw now, then write them (~0.3 s)
  const send = (apply, method, sub, body) => {
    if (!me || !st) return;
    sending++;
    apply(mine);
    update();
    if (navigator.vibrate) navigator.vibrate(30);
    db(method, `ans/${me.c}/${st.id}/${me.uid}${sub}`, body).then(() => { sending--; update(); })
      .catch(e => {
        sending--;
        toast(e.code === 'denied' ? (st.type === 'quiz' ? '이미 넘어간 문제예요' : '끝난 활동이에요') : e.code === 'offline' ? '보내지 못했어요. 인터넷을 확인하고 다시 눌러 주세요' : e.message);
        reloadMine();
      });
  };

  const bind = () => {
    const main = document.querySelector('.lv-phone');
    main.onclick = e => {
      const b = e.target.closest('button');
      if (!b || b.form) return;
      if (b.dataset.v !== undefined) { const v = +b.dataset.v, at = Date.now(); send(m => { m.v = v; m.at = at; }, 'PATCH', '', { v, at }); }
      else if (b.dataset.qz !== undefined) {
        const i = cur.quiz.i, c = +b.dataset.qz, ms = Date.now() - (seen[i] || Date.now());
        send(m => { m.qz = { ...(m.qz || {}), [i]: { c, ms } }; }, 'PUT', `/qz/${i}`, { c, ms });
      }
    };
    const f = document.getElementById('lvSend');
    if (f) f.onsubmit = e => {
      e.preventDefault();
      const inp = document.getElementById('lvIn'), v = inp.value.trim();
      if (!v) return;
      if (cur.type === 'word') {
        const k = list(mine.w).length;
        if (k >= 3) return toast('단어는 3번까지 보낼 수 있어요');
        inp.value = '';
        send(m => { m.w = [...list(m.w), v]; }, 'PUT', `/w/${k}`, v);
      } else {
        const at = Date.now();
        send(m => { m.t = v; m.at = at; }, 'PATCH', '', { t: v, at });
      }
    };
  };

  const onLive = v => {
    if (!isCurrent(nav)) return close();
    st = v;
    if (fresh(v)) {
      if (mineFor !== v.id) { mineFor = v.id; mine = {}; resetAt = v.resetAt || 0; reloadMine(); }
      else if (v.resetAt && v.resetAt !== resetAt) { resetAt = v.resetAt; delete mine.v; }
    }
    update();
  };
  const onStatus = (status, err) => {
    online = status === 'ok';
    if (!online && cur === undefined) offline(err);
    else if (cur) draw();
  };
  const open = () => {
    if (stop) stop();
    stop = followClass(onLive, onStatus, s => { me = s; });
  };
  // a phone that was locked or switched away reconnects at once to catch up
  const wake = () => { if (document.visibilityState === 'visible' && isCurrent(nav)) open(); };
  document.addEventListener('visibilitychange', wake);

  render(`${head(null)}<section class="lv-done"><div class="spin"></div></section>`);
  open();
}
