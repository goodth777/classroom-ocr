// Live activities on the student's phone (#/live) and the "지금 수업 활동" banner on home.
// Taps update the screen at once and are sent in the background; the screen polls every 2.5 s.
import { call, quiet } from './api.js';
import { render, toast, currentNav, isCurrent } from './ui.js';
import { esc } from './lib.js';

const SHAPES = ['▲', '◆', '●', '■', '★', '♥'];
const QCOLORS = ['#e2574c', '#3f7fe0', '#d9a520', '#2aa772', '#9b6ad6', '#e0679e'];
const LIGHTS = [['🟢', '이해했어요'], ['🟡', '조금 헷갈려요'], ['🔴', '모르겠어요']];
const TITLE = { vote: ['📊', '투표'], word: ['☁️', '단어'], text: ['💬', '한 줄 의견'], light: ['🚦', '이해도'], hand: ['✋', '손들기·질문'], quiz: ['🎯', '퀴즈'] };

// ---------- home banner ----------

let bannerTimer = 0;
let lastLive = null; // repainted at once when home redraws, so the banner does not blink
export function watchLive(slot) {
  clearInterval(bannerTimer);
  const paint = d => {
    lastLive = d;
    const el = document.getElementById(slot);
    if (!el) return clearInterval(bannerTimer);
    el.innerHTML = d ? `<a class="lv-banner" href="#/live"><span class="e">${TITLE[d.type][0]}</span><span><b>지금 수업 활동</b><small>${esc(TITLE[d.type][1])}${d.q ? ' · ' + esc(d.q) : ''}</small></span><span class="go">참여</span></a>` : '';
  };
  const check = () => {
    if (!document.getElementById(slot)) return clearInterval(bannerTimer);
    if (document.visibilityState === 'visible') quiet('live').then(paint).catch(() => {});
  };
  paint(lastLive);
  check();
  bannerTimer = setInterval(check, 5000);
}

// ---------- live screen ----------

export async function liveView() {
  clearInterval(bannerTimer);
  const nav = currentNav();
  let cur = null, shape = '', sending = 0, timer = 0;
  const seen = {}; // quiz question index → when this phone first showed it (answer speed is measured here)

  const head = d => `<header class="lv-top"><a href="#/home" class="lv-back" aria-label="홈으로">‹</a><b>${d ? TITLE[d.type][0] + ' ' + esc(TITLE[d.type][1]) : '수업 활동'}</b>${d ? '<span class="lv-dot"><i></i>진행 중</span>' : ''}</header>`;
  const ended = () => {
    clearInterval(timer);
    render(`${head(null)}<section class="lv-done"><div class="big">👋</div><b>활동이 끝났어요</b><small>홈으로 돌아가요</small></section>`);
    setTimeout(() => { if (isCurrent(nav) && location.hash === '#/live') location.hash = '#/home'; }, 1800);
  };

  // structure is drawn once per activity / quiz step; the dynamic part redraws without touching inputs
  const draw = () => {
    if (!isCurrent(nav)) return clearInterval(timer);
    if (!cur) return ended();
    const z = cur.quiz;
    const s = cur.id + cur.type + (z ? z.i + z.phase + !!z.mine : '') + cur.show;
    if (s !== shape) {
      shape = s;
      render(`${head(cur)}<section class="lv-phone">${cur.q && cur.type !== 'quiz' && cur.type !== 'hand' ? `<div class="lv-pq">${esc(cur.q)}</div>` : ''}${fixed()}<div id="lvDyn"></div></section>`);
      bind();
    }
    const dyn = document.getElementById('lvDyn');
    if (dyn) dyn.innerHTML = dynamic();
  };

  const fixed = () => {
    if (cur.type === 'word') return `<form class="lv-send" id="lvSend"><input id="lvIn" maxlength="20" placeholder="한 단어" autocomplete="off" enterkeyhint="send"><button>보내기</button></form>`;
    if (cur.type === 'text') return `<form class="lv-send col" id="lvSend"><textarea id="lvIn" maxlength="100" rows="3" placeholder="한 줄로 써 주세요">${esc(cur.mine.t)}</textarea><button>${cur.mine.t ? '고쳐서 보내기' : '보내기'}</button></form>`;
    if (cur.type === 'hand') return `<div id="lvHandBox"></div><form class="lv-send" id="lvSend"><input id="lvIn" maxlength="200" placeholder="질문을 써 주세요 (이름 없이 보내져요)" autocomplete="off" enterkeyhint="send"><button>보내기</button></form>`;
    return '';
  };

  const dynamic = () => {
    const m = cur.mine;
    if (cur.type === 'vote') {
      return cur.options.map((o, i) => `<button type="button" class="lv-opt ${m.v === i ? 'on' : ''}" data-v="${i}"><span>${i + 1}</span>${esc(o)}${cur.result ? `<em>${cur.result.counts[i]}</em>` : ''}</button>`).join('')
        + `<p class="lv-note">${m.v !== undefined && m.v !== null ? '보냈어요 ✓ 다른 보기를 누르면 바꿀 수 있어요' : '누르면 바로 보내져요'}${cur.anon ? ' · 이름 없이' : ''}</p>`;
    }
    if (cur.type === 'light') {
      return `<p class="lv-note">언제든 바꿀 수 있어요 · 친구들은 못 봐요</p><div class="lv-lightbtns">${LIGHTS.map(([e, t], i) => `<button type="button" data-v="${i}" class="${m.v === i ? 'on' : ''}"><i>${e}</i>${t}</button>`).join('')}</div>`;
    }
    if (cur.type === 'word') {
      return `<p class="lv-note">${m.w.length}/3 보냄${m.w.length ? ' · ' + m.w.map(esc).join(', ') : ''}</p>`
        + (cur.result ? `<div class="lv-pcloud">${cur.result.words.map(w => `<span style="font-size:${14 + Math.min(20, w.n * 4)}px">${esc(w.w)}</span>`).join('')}</div>` : '');
    }
    if (cur.type === 'text') {
      return `<p class="lv-note">${m.t ? '보냈어요 ✓' : ''}${cur.anon ? ' 이름 없이 보내져요' : ''}</p>`
        + (cur.result ? `<div class="lv-pcards">${cur.result.items.map(x => `<div>${esc(x.t)}</div>`).join('')}</div>` : '');
    }
    if (cur.type === 'hand') {
      const hb = document.getElementById('lvHandBox');
      if (hb) hb.innerHTML = `<button type="button" class="lv-handbtn ${m.hand ? 'on' : ''}" data-hand><i>✋</i>${m.hand ? '손 들었어요' : '손들기'}<small>${m.hand ? '다시 누르면 내려요' : '선생님 화면에 순서대로 떠요'}</small></button>`;
      return cur.qs.map(q => `<div class="lv-pq2 ${q.done ? 'done' : ''}"><p>${esc(q.text)}${q.own ? ' <small>내 질문</small>' : ''}</p><button type="button" data-like="${q.id}" class="${q.liked ? 'on' : ''}" aria-label="공감">👍 ${q.likes}</button></div>`).join('');
    }
    if (cur.type === 'quiz') {
      const z = cur.quiz;
      if (z.phase === 'end') return `<div class="lv-res"><div class="big">🏁</div><b>퀴즈 끝!</b><small>내 점수 ${z.total}점</small></div>`;
      if (z.phase === 'reveal') {
        const ok = z.mine && z.mine.c === z.answer;
        return `<div class="lv-res"><div class="big">${ok ? '🎉' : z.mine ? '😅' : '⏰'}</div><b class="${ok ? '' : 'no'}">${ok ? '정답!' : z.mine ? '아쉬워요' : '시간이 끝났어요'}</b>
          <small>${ok ? `+${z.pts}점 · ` : `정답은 ${SHAPES[z.answer]} ${esc(z.options[z.answer] || '')} · `}지금까지 ${z.total}점</small></div><p class="lv-note">다음 문제를 기다리는 중…</p>`;
      }
      if (z.mine) return `<div class="lv-res"><div class="big" style="color:${QCOLORS[z.mine.c]}">${SHAPES[z.mine.c]}</div><b>냈어요!</b><small>정답 공개를 기다리는 중…</small></div>`;
      if (!seen[z.i]) seen[z.i] = Date.now();
      return `<p class="lv-note">${z.i + 1} / ${z.n} · 큰 화면의 문제를 보고 눌러요</p><div class="lv-q4 n${z.options.length}">${z.options.map((o, i) => `<button type="button" data-qz="${i}" style="background:${QCOLORS[i]}"><i>${SHAPES[i]}</i><span>${esc(o)}</span></button>`).join('')}</div>`;
    }
    return '';
  };

  // optimistic: change `cur` and redraw now, then let the server answer replace it
  const send = (op, v, optimistic) => {
    if (optimistic) { optimistic(cur); draw(); }
    if (navigator.vibrate) navigator.vibrate(30);
    sending++;
    return call('liveAns', { id: cur.id, op, v }).then(d => { sending--; if (sending === 0) { cur = d; draw(); } })
      .catch(e => { sending--; if (e.code === 'gone') { cur = null; draw(); } else { toast(e.message); refresh(); } });
  };

  const bind = () => {
    const main = document.querySelector('.lv-phone');
    main.onclick = e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.v !== undefined) send('v', +b.dataset.v, c => { c.mine.v = +b.dataset.v; });
      else if (b.dataset.hand !== undefined) send('hand', !cur.mine.hand, c => { c.mine.hand = !c.mine.hand; });
      else if (b.dataset.like) send('like', b.dataset.like, c => { const q = c.qs.find(x => x.id === b.dataset.like); if (q) { q.liked = !q.liked; q.likes += q.liked ? 1 : -1; } });
      else if (b.dataset.qz !== undefined) {
        const i = cur.quiz.i, c = +b.dataset.qz;
        send('qz', { i, c, ms: Date.now() - (seen[i] || Date.now()) }, x => { x.quiz.mine = { c }; });
      }
    };
    const f = document.getElementById('lvSend');
    if (f) f.onsubmit = e => {
      e.preventDefault();
      const inp = document.getElementById('lvIn'), v = inp.value.trim();
      if (!v) return;
      if (cur.type === 'word') { if (cur.mine.w.length >= 3) return toast('단어는 3번까지 보낼 수 있어요'); inp.value = ''; send('w', v, c => { c.mine.w = [...c.mine.w, v]; }); }
      else if (cur.type === 'text') send('t', v, c => { c.mine.t = v; });
      else { inp.value = ''; send('q', v, c => { c.qs = [...c.qs, { id: 'tmp', text: v, likes: 0, own: true }]; }); }
      toast('보냈어요');
    };
  };

  const refresh = () => {
    if (!isCurrent(nav)) return clearInterval(timer);
    if (sending || document.visibilityState !== 'visible') return;
    quiet('live').then(d => { if (!sending && isCurrent(nav)) { cur = d; draw(); } }).catch(() => {});
  };

  render(`${head(null)}<section class="lv-done"><div class="spin"></div></section>`);
  cur = await call('live');
  draw();
  timer = setInterval(refresh, 2500);
}
