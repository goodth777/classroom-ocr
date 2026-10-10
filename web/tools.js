// Classroom tools for teaching classes. The first four run on the teacher's device only (no server calls);
// the live ones (live.js) go through the server so students can answer on their phones.
// Loaded only when the 수업 도구 tab opens. Per-class settings live in localStorage.
import { render, $, toast } from './ui.js';
import { esc } from './lib.js';
import { fa } from './fa.js';
import { sfx } from './sfx.js';
import { qrSvg } from './qr.js';
import { call, quiet } from './api.js';
import { drawVote, drawLight, drawQuiz } from './live.js';

const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

const TOOLS = [
  { id: 'timer', name: '타이머', sub: '3분 · 5분 · 직접', icon: 'stopwatch' },
  { id: 'pick', name: '이름 뽑기', sub: '뽑힌 학생 제외', icon: 'user-check' },
  { id: 'dice', name: '주사위·룰렛', sub: '동전 · 룰렛 항목 직접 입력', icon: 'dice' },
  { id: 'qr', name: 'QR 띄우기', sub: '링크를 큰 QR로', icon: 'qrcode' },
];
// Students answer on their phones (1~3 s behind).
const LIVE = [
  { id: 'vote', name: '실시간 투표', sub: '객관식·단어 구름·의견', icon: 'square-poll-horizontal' },
  { id: 'light', name: '이해도 신호등', sub: '🟢🟡🔴 언제든', icon: 'traffic-light' },
  { id: 'quiz', name: '함께 푸는 퀴즈', sub: '한 문제씩 · 순위 없음', icon: 'graduation-cap' },
];

let ctx = null;
let cleanup = null; // stops the open tool's timers/listeners when leaving it

export function toolsView(c, sub = '') {
  ctx = c;
  if (cleanup) { cleanup(); cleanup = null; }
  const t = [...TOOLS, ...LIVE].find(x => x.id === sub);
  if (!t) return drawHub();
  render(ctx.frame(`<section class="tl-stage" id="tlStage">
      <div class="tl-bar"><a class="btn" href="#/t/${ctx.cls.id}/tools">${fa('chevron-left')}도구 모음</a><b>${t.name}</b><span class="sp"></span>
        <span id="tlActs"></span>
        ${t.id === 'timer' ? '' : `<button type="button" class="btn" id="tlMiniBtn">${fa('stopwatch')}타이머 띄우기</button>`}
        <button type="button" class="btn" id="tlFull">${fa('expand')}전체 화면</button></div>
      <div class="tl-body" id="tlBody"></div>
    </section>`, ''));
  ctx.after();
  $('#tlFull').onclick = () => {
    const st = $('#tlStage');
    if (document.fullscreenElement) document.exitFullscreen(); else if (st.requestFullscreen) st.requestFullscreen().catch(() => {});
  };
  if ($('#tlMiniBtn')) $('#tlMiniBtn').onclick = () => { timer.mini = true; if (!timer.total) setTimer(180); paintMini(); };
  const T = { ctx, acts, body, $, get: lsGet, set: lsSet, sfx, toast, fa, esc, call, quiet };
  cleanup = ({ timer: drawTimer, pick: drawPick, dice: drawDice, qr: drawQr, vote: drawVote, light: drawLight, quiz: drawQuiz })[t.id](T) || null;
}

// ---------- hub ----------

function drawHub() {
  const stars = lsGet('toolStars', ['timer', 'pick']);
  const card = (t, big) => `<a class="tl-card ${big ? 'big' : ''}" href="#/t/${ctx.cls.id}/tools/${t.id}"><span class="tl-ic">${fa(t.icon)}</span><b>${t.name}</b><small>${t.sub}</small>
    <button type="button" class="tl-star ${stars.includes(t.id) ? 'on' : ''}" data-star="${t.id}" aria-label="자주 쓰는 도구로 고정">${fa('star')}</button></a>`;
  const fav = [...TOOLS, ...LIVE].filter(t => stars.includes(t.id));
  render(ctx.frame(`<section class="tl-hub">
      ${fav.length ? `<div class="tl-grp">${fa('star')} 자주 쓰는 도구</div><div class="tl-bento">${fav.map(t => card(t, true)).join('')}</div>` : ''}
      <div class="tl-grp">기본 도구 <small>☆을 누르면 위에 고정돼요</small></div><div class="tl-bento">${TOOLS.map(t => card(t)).join('')}</div>
      <div class="tl-grp">${fa('mobile-screen')} 학생 휴대폰과 함께 <small>학생 앱에 바로 떠요 · 1~3초 늦게 반영</small></div><div class="tl-bento">${LIVE.map(t => card(t)).join('')}</div>
    </section>`, ''));
  ctx.after();
  $('.tl-hub').onclick = e => {
    const b = e.target.closest('[data-star]');
    if (!b) return;
    e.preventDefault();
    const id = b.dataset.star;
    lsSet('toolStars', stars.includes(id) ? stars.filter(x => x !== id) : [...stars, id]);
    drawHub();
  };
}

const acts = html => { $('#tlActs').innerHTML = html; };
const body = html => { $('#tlBody').innerHTML = html; };

// ---------- timer (shared with the floating mini timer) ----------

const timer = { mode: 'timer', total: 0, left: 0, endAt: 0, running: false, startedAt: 0, elapsed: 0, mini: false, done: false };
let tick = null;
const fmt = s => { s = Math.max(0, Math.ceil(s)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const nowLeft = () => (timer.running ? (timer.endAt - Date.now()) / 1000 : timer.left);
const nowElapsed = () => timer.elapsed + (timer.running ? (Date.now() - timer.startedAt) / 1000 : 0);

function setTimer(sec) { Object.assign(timer, { mode: 'timer', total: sec, left: sec, running: false, done: false }); }
function startStop() {
  if (timer.mode === 'timer') {
    if (timer.running) { timer.left = nowLeft(); timer.running = false; }
    else { if (timer.left <= 0) timer.left = timer.total; timer.endAt = Date.now() + timer.left * 1000; timer.running = true; timer.done = false; }
  } else if (timer.running) { timer.elapsed = nowElapsed(); timer.running = false; }
  else { timer.startedAt = Date.now(); timer.running = true; }
  ensureTick();
}
function reset() { timer.running = false; timer.done = false; timer.left = timer.total; timer.elapsed = 0; paintAll(); }
function ensureTick() {
  if (tick) return;
  tick = setInterval(() => {
    if (timer.mode === 'timer' && timer.running && nowLeft() <= 0) {
      timer.running = false; timer.left = 0; timer.done = true;
      sfx('chime');
      document.body.classList.add('tl-flash');
      setTimeout(() => document.body.classList.remove('tl-flash'), 2400);
    }
    paintAll();
    if (!timer.running) { clearInterval(tick); tick = null; }
  }, 200);
  paintAll();
}
function paintAll() { paintBig(); paintMini(); }

function paintMini() {
  let m = document.getElementById('tlMini');
  const show = timer.mini && (timer.total || timer.mode === 'watch') && !document.getElementById('tlRing');
  if (!show) { if (m) m.remove(); return; }
  if (!m) {
    m = document.createElement('div');
    m.id = 'tlMini';
    m.className = 'tl-mini';
    document.body.append(m);
    m.onclick = e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.m === 'go') startStop();
      if (b.dataset.m === 'x') { timer.mini = false; paintMini(); }
    };
  }
  const t = timer.mode === 'timer' ? fmt(nowLeft()) : fmt(nowElapsed());
  m.classList.toggle('done', timer.done);
  m.innerHTML = `${fa('stopwatch')}<b>${t}</b><button type="button" data-m="go" aria-label="${timer.running ? '멈춤' : '시작'}">${fa(timer.running ? 'pause' : 'play')}</button><button type="button" data-m="x" aria-label="닫기">${fa('xmark')}</button>`;
}

function paintBig() {
  const ring = document.getElementById('tlRing');
  if (!ring) return;
  const isT = timer.mode === 'timer';
  const left = nowLeft();
  const p = isT ? (timer.total ? Math.max(0, left) / timer.total : 0) : (nowElapsed() % 60) / 60;
  ring.style.setProperty('--p', p);
  ring.classList.toggle('done', timer.done);
  $('#tlTime').textContent = isT ? fmt(left) : fmt(nowElapsed());
  $('#tlSub').textContent = isT ? (timer.done ? '끝! 🔔' : `${fmt(timer.total)} 타이머 · 끝나면 종소리`) : '스톱워치';
  $('#tlGo').innerHTML = `${fa(timer.running ? 'pause' : 'play')} ${timer.running ? '일시정지' : '시작'}`;
}

function drawTimer() {
  if (!timer.total && timer.mode === 'timer') setTimer(lsGet('timerLast', 180));
  acts(`<div class="seg2" id="tlMode"><button type="button" data-mode="timer" class="${timer.mode === 'timer' ? 'on' : ''}">타이머</button><button type="button" data-mode="watch" class="${timer.mode === 'watch' ? 'on' : ''}">스톱워치</button></div>`);
  body(`<div class="tl-timer"><div class="tl-ring" id="tlRing"><div><b id="tlTime"></b><small id="tlSub"></small></div></div>
    <div class="tl-chips">${timer.mode === 'timer' ? [60, 180, 300, 600].map(s => `<button type="button" data-set="${s}" class="${timer.total === s ? 'on' : ''}">${s / 60}분</button>`).join('')
      + `<label class="tl-custom"><input type="number" min="1" max="180" id="tlMin" placeholder="분" aria-label="분 직접 입력"><button type="button" id="tlSetMin">설정</button></label>` : ''}
      <button type="button" class="go" id="tlGo"></button><button type="button" id="tlReset">${fa('rotate')} 처음으로</button>
      <button type="button" id="tlMiniOn">${fa('compress')} 작게 띄우기</button></div></div>`);
  paintAll();
  const root = $('#tlBody');
  root.onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.set) { setTimer(+b.dataset.set); lsSet('timerLast', +b.dataset.set); drawTimer(); }
    else if (b.id === 'tlSetMin') { const m = +$('#tlMin').value; if (m > 0) { setTimer(Math.round(m * 60)); lsSet('timerLast', Math.round(m * 60)); drawTimer(); } }
    else if (b.id === 'tlGo') startStop();
    else if (b.id === 'tlReset') reset();
    else if (b.id === 'tlMiniOn') { timer.mini = true; location.hash = `#/t/${ctx.cls.id}/tools`; }
  };
  $('#tlMode').onclick = e => {
    const b = e.target.closest('[data-mode]');
    if (!b || b.dataset.mode === timer.mode) return;
    Object.assign(timer, { mode: b.dataset.mode, running: false, elapsed: 0, done: false });
    if (timer.mode === 'timer') setTimer(lsGet('timerLast', 180));
    drawTimer();
  };
  const key = e => { if (e.key === ' ' && !e.target.closest('input')) { e.preventDefault(); startStop(); } };
  addEventListener('keydown', key);
  return () => { removeEventListener('keydown', key); setTimeout(paintMini, 0); };
}

// ---------- name picker: slot-machine reels (fixed size, so nothing on the screen moves while they spin) ----------

function drawPick() {
  const roster = (ctx.v.roster || []).slice().sort((a, b) => String(a.sno || '').localeCompare(String(b.sno || '')) || a.number - b.number);
  const key = 'pickUsed:' + ctx.cls.id;
  let used = new Set(lsGet(key, []));
  let excl = lsGet('pickExcl', true);
  let count = 1;
  let last = [];
  let busy = false;
  const timers = [];
  const pool = () => roster.filter(s => !excl || !used.has(s.id));
  const strip = names => names.map(n => `<b>${esc(n)}</b>`).join('');
  // font size so `count` reels of ~4 characters fit the stage width and a third of its height
  const fit = () => {
    const box = $('#tlBody'), reels = $('#tlReels');
    if (!box || !reels) return;
    const fs = Math.max(36, Math.min(130, (box.clientWidth - 60 - 32 * (count - 1)) / (count * 4.4), box.clientHeight / 5.2));
    reels.style.setProperty('--fs', fs + 'px');
  };
  const sub = () => (roster.length ? `${excl ? `남은 학생 ${pool().length}명` : `전체 ${roster.length}명`}${last.length ? ` · 방금: ${last.map(s => s.sno || `${s.number}번`).join(', ')}` : ''}` : '학생 명단이 비어 있어요');
  const chips = () => roster.map(s => `<button type="button" data-u="${s.id}" class="${used.has(s.id) ? 'out' : ''}" title="눌러서 제외/복귀">${esc(s.name)}</button>`).join('');
  const paint = () => {
    acts(`<div class="seg2" id="tlCount">${[1, 2, 3].map(n => `<button type="button" data-n="${n}" class="${count === n ? 'on' : ''}">${n}명</button>`).join('')}</div>
      <label class="tl-check"><input type="checkbox" id="tlExcl" ${excl ? 'checked' : ''}> 뽑힌 학생 제외</label>
      <button type="button" class="btn primary" id="tlPick">${fa('shuffle')}뽑기</button>`);
    body(`<div class="tl-pick">
      <div class="tl-reels" id="tlReels">${Array.from({ length: count }, (_, i) => `<div class="tl-reel ${last[i] ? 'hit' : ''}"><div class="tl-strip">${strip(['', last[i] ? last[i].name : '?', ''])}</div></div>`).join('')}</div>
      <div class="tl-psub" id="tlPsub">${sub()}</div>
      <div class="tl-used" id="tlUsed">${chips()}</div>
      <button type="button" class="tl-link" id="tlClear" style="visibility:${used.size ? 'visible' : 'hidden'}">${fa('rotate')} 처음부터 다시 (제외 ${used.size}명 풀기)</button></div>`);
    fit();
  };
  const go = () => {
    if (busy) return;
    let p = pool();
    if (!p.length && excl) { used = new Set(); lsSet(key, []); p = pool(); toast('모두 뽑혀서 처음부터 다시 뽑아요'); }
    if (!p.length) return toast('학생 명단을 먼저 넣어 주세요');
    const n = Math.min(count, p.length);
    const left = p.slice(), pick = [];
    for (let i = 0; i < n; i++) pick.push(left.splice(Math.floor(Math.random() * left.length), 1)[0]);
    busy = true;
    sfx('drumroll');
    const reels = [...$('#tlReels').children];
    reels.forEach((reel, i) => {
      reel.classList.remove('hit');
      const s = reel.querySelector('.tl-strip');
      if (!pick[i]) { s.innerHTML = strip(['', '', '']); return; }
      // random names (no name twice in a row), then the pick in the middle row, then one more below it
      const names = [];
      for (let k = 0; k < 22 + i * 7; k++) {
        let nm;
        do nm = p[Math.floor(Math.random() * p.length)].name; while (p.length > 1 && nm === names[names.length - 1]);
        names.push(nm);
      }
      names.push(pick[i].name, p[Math.floor(Math.random() * p.length)].name);
      s.innerHTML = strip(names);
      const row = reel.clientHeight / 3;
      const a = s.animate([{ transform: 'translateY(0)' }, { transform: `translateY(${-(names.length - 3) * row}px)` }],
        { duration: 1700 + i * 650, easing: 'cubic-bezier(.12,.8,.2,1)', fill: 'forwards' });
      // settle on a timer, not onfinish: a hidden tab pauses animations but timers still run
      timers.push(setTimeout(() => {
        a.cancel();
        s.innerHTML = strip(['', pick[i].name, '']);
        reel.classList.add('hit');
        if (i < n - 1) sfx('ding');
      }, 1700 + i * 650));
    });
    timers.push(setTimeout(() => {
      busy = false;
      last = pick;
      if (excl) { pick.forEach(s => used.add(s.id)); lsSet(key, [...used]); }
      sfx('fanfare');
      $('#tlPsub').textContent = sub();
      $('#tlUsed').innerHTML = chips();
      $('#tlClear').style.visibility = used.size ? 'visible' : 'hidden';
      $('#tlClear').innerHTML = `${fa('rotate')} 처음부터 다시 (제외 ${used.size}명 풀기)`;
    }, 1700 + (n - 1) * 650 + 60));
  };
  paint();
  $('#tlActs').onclick = e => {
    const b = e.target.closest('button');
    if (!b || busy) return;
    if (b.dataset.n) { count = +b.dataset.n; last = []; paint(); }
    else if (b.id === 'tlPick') go();
  };
  $('#tlActs').onchange = e => { if (e.target.id === 'tlExcl') { excl = e.target.checked; lsSet('pickExcl', excl); paint(); } };
  $('#tlBody').onclick = e => {
    if (busy) return;
    const u = e.target.closest('[data-u]');
    if (u) { used.has(u.dataset.u) ? used.delete(u.dataset.u) : used.add(u.dataset.u); lsSet(key, [...used]); paint(); }
    if (e.target.closest('#tlClear')) { used = new Set(); lsSet(key, []); last = []; paint(); }
  };
  const k = e => { if ((e.key === ' ' || e.key === 'Enter') && !e.target.closest('input, button')) { e.preventDefault(); go(); } };
  addEventListener('keydown', k);
  addEventListener('resize', fit);
  document.addEventListener('fullscreenchange', fit);
  return () => { removeEventListener('keydown', k); removeEventListener('resize', fit); document.removeEventListener('fullscreenchange', fit); timers.forEach(clearTimeout); };
}

// ---------- dice (3D cubes) / coin (two-sided) / wheel (SVG, items edited beside it) ----------

const PIPS = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
// cube faces: front 1, back 6, right 3, left 4, top 5, bottom 2 (opposite faces add up to 7)
const FACES = [[1, 'rotateY(0deg)'], [6, 'rotateY(180deg)'], [3, 'rotateY(90deg)'], [4, 'rotateY(-90deg)'], [5, 'rotateX(90deg)'], [2, 'rotateX(-90deg)']];
// cube rotation [x, y] that brings each value to the front
const SHOW = { 1: [0, 0], 6: [0, 180], 3: [0, -90], 4: [0, 90], 5: [-90, 0], 2: [90, 0] };
const face = n => `<div class="tl-pips">${Array.from({ length: 9 }, (_, i) => `<i class="${PIPS[n].includes(i + 1) ? 'on' : ''}"></i>`).join('')}</div>`;
const cube = () => `<div class="tl-die3"><div class="tl-cube">${FACES.map(([n, t]) => `<div class="tl-face" style="transform:${t} translateZ(calc(var(--s) / 2))">${face(n)}</div>`).join('')}</div></div>`;
const WHEEL_COLORS = ['#2fd39a', '#3f7fe0', '#ffc58a', '#e2574c', '#9b6ad6', '#6fd4e0', '#f7e07a', '#e0679e'];
const DARK_TEXT = new Set(['#2fd39a', '#ffc58a', '#6fd4e0', '#f7e07a']);
const DEFAULT_ITEMS = ['1모둠', '2모둠', '3모둠', '4모둠', '5모둠', '6모둠'];

// SVG wheel: slice i is centred at i*seg degrees clockwise from the top; labels run from the centre outwards.
function wheelSvg(items, win = -1) {
  const n = items.length, seg = 360 / n, R = 100;
  const pt = a => `${(Math.sin(a * Math.PI / 180) * R).toFixed(2)},${(-Math.cos(a * Math.PI / 180) * R).toFixed(2)}`;
  const fs = Math.max(6, Math.min(13, 110 / n + 3));
  const label = t => (t.length > 14 ? t.slice(0, 13) + '…' : t);
  return `<svg viewBox="-104 -104 208 208" aria-hidden="true">${items.map((t, i) => {
    const a0 = (i - 0.5) * seg, a1 = (i + 0.5) * seg, c = WHEEL_COLORS[(n % 2 && i === n - 1 && n > 1 ? i + 3 : i) % WHEEL_COLORS.length];
    return `<g class="${win >= 0 && i !== win ? 'dim' : ''}"><path d="M0,0 L${pt(a0)} A${R},${R} 0 ${seg > 180 ? 1 : 0} 1 ${pt(a1)} Z" fill="${c}"/>
      <text transform="rotate(${i * seg - 90})" x="${R * 0.9}" y="0" text-anchor="end" dominant-baseline="central" font-size="${fs}" fill="${DARK_TEXT.has(c) ? '#10201a' : '#fff'}">${esc(label(t))}</text></g>`;
  }).join('')}<circle r="104" fill="none" stroke="#141816" stroke-width="8"/><circle r="12" fill="#141816"/><circle r="5" fill="#eef3f0"/></svg>`;
}

function drawDice() {
  let mode = lsGet('diceMode', 'dice');
  let n = lsGet('diceCount', 2);
  const wkey = 'wheel:' + ctx.cls.id;
  let items = lsGet(wkey, DEFAULT_ITEMS);
  let editOpen = lsGet('wheelEdit', true);
  let rot = 0, coinRot = 0, busy = false, raf = 0;
  const turns = []; // per die: current [x, y] so each roll keeps spinning forward
  const timers = [];
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  const paint = () => {
    acts(`<div class="seg2" id="tlDM">${[['dice', '주사위'], ['coin', '동전'], ['wheel', '룰렛']].map(([k, t]) => `<button type="button" data-m="${k}" class="${mode === k ? 'on' : ''}">${t}</button>`).join('')}</div>
      ${mode === 'dice' ? `<div class="seg2" id="tlDN">${[1, 2, 3].map(k => `<button type="button" data-k="${k}" class="${n === k ? 'on' : ''}">${k}개</button>`).join('')}</div>` : ''}
      ${mode === 'wheel' ? `<button type="button" class="btn" id="tlWEdit">${fa('pen')}${editOpen ? '항목 편집 닫기' : '항목 편집'}</button>` : ''}
      <button type="button" class="btn primary" id="tlRoll">${fa(mode === 'wheel' ? 'dharmachakra' : mode === 'coin' ? 'coins' : 'dice')}${mode === 'wheel' ? '돌리기' : mode === 'coin' ? '던지기' : '굴리기'}</button>`);
    if (mode === 'dice') {
      body(`<div class="tl-dice3" id="tlDice">${Array.from({ length: n }, cube).join('')}</div><div class="tl-res" id="tlRes"></div>`);
      turns.length = 0;
      $('#tlDice').querySelectorAll('.tl-cube').forEach((c, i) => { turns[i] = [-20, 25]; c.style.transform = 'rotateX(-20deg) rotateY(25deg)'; });
    } else if (mode === 'coin') {
      coinRot = 0;
      body(`<div class="tl-coin3"><div class="tl-coinbody" id="tlCoin"><div class="tl-side tl-head">앞</div><div class="tl-side tl-tail">뒤</div></div></div><div class="tl-res" id="tlRes"></div>`);
    } else {
      body(`<div class="tl-wheelbox"><div class="tl-wheelwrap"><div class="tl-needle" id="tlNeedle"></div><div class="tl-wheel" id="tlWheel" style="transform:rotate(${rot}deg)">${wheelSvg(items)}</div></div>
        ${editOpen ? `<div class="tl-wedit"><h4>룰렛 항목 <small>한 줄에 하나 · 2~24개</small></h4>
          <textarea id="tlWItems" rows="10" spellcheck="false">${esc(items.join('\n'))}</textarea>
          <div class="tl-wfill"><button type="button" data-fill="names">학생 이름</button><button type="button" data-fill="groups">1~6모둠</button><button type="button" data-fill="num">1~10</button><button type="button" data-fill="ox">O / X</button></div>
          <p class="muted small" id="tlWNote">${items.length}개 · 고치면 바로 룰렛에 반영돼요</p></div>` : ''}</div>
        <div class="tl-res" id="tlRes"></div>`);
    }
  };
  const setItems = list => {
    items = list;
    lsSet(wkey, items);
    rot %= 360;
    const w = $('#tlWheel');
    if (w) { w.style.transition = 'none'; w.style.transform = `rotate(${rot}deg)`; w.innerHTML = wheelSvg(items); }
    const note = $('#tlWNote');
    if (note) note.textContent = `${items.length}개 · 고치면 바로 룰렛에 반영돼요`;
    $('#tlRes').textContent = '';
  };
  const roll = () => {
    if (busy) return;
    $('#tlRes').textContent = '';
    if (mode === 'dice') {
      busy = true;
      const final = Array.from({ length: n }, () => 1 + Math.floor(Math.random() * 6));
      sfx('roll');
      $('#tlDice').querySelectorAll('.tl-die3').forEach((d, i) => {
        const c = d.querySelector('.tl-cube'), [sx, sy] = SHOW[final[i]], [cx, cy] = turns[i];
        // whole extra turns (multiples of 360) keep the landing face; a small tilt keeps it looking 3D
        const x = cx - (cx % 360) + 360 * (2 + i) + sx - 12, y = cy - (cy % 360) + 360 * (3 + i) + sy + 14;
        turns[i] = [x, y];
        c.style.transition = `transform ${1.1 + i * 0.15}s cubic-bezier(.2,.75,.25,1)`;
        c.style.transform = `rotateX(${x}deg) rotateY(${y}deg)`;
        d.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-90px)', offset: .35 }, { transform: 'translateY(0)', offset: .7 }, { transform: 'translateY(-14px)', offset: .85 }, { transform: 'translateY(0)' }],
          { duration: 1100 + i * 150, easing: 'ease-out' });
      });
      later(() => { busy = false; $('#tlRes').textContent = n > 1 ? `${final.join(' + ')} = ${final.reduce((a, b) => a + b, 0)}` : String(final[0]); sfx('ding'); }, 1150 + (n - 1) * 150);
    } else if (mode === 'coin') {
      busy = true;
      const head = Math.random() < .5;
      coinRot = coinRot - (coinRot % 360) + 360 * 5 + (head ? 0 : 180);
      const c = $('#tlCoin');
      sfx('roll');
      c.style.transition = 'transform 1.3s cubic-bezier(.3,.7,.3,1)';
      c.style.transform = `rotateY(${coinRot}deg)`;
      c.parentElement.animate([{ transform: 'translateY(0) scale(1)' }, { transform: 'translateY(-150px) scale(1.12)', offset: .45 }, { transform: 'translateY(0) scale(1)', offset: .85 }, { transform: 'translateY(-10px)', offset: .93 }, { transform: 'translateY(0)' }],
        { duration: 1300, easing: 'ease-in-out' });
      later(() => { busy = false; $('#tlRes').textContent = head ? '앞면' : '뒷면'; sfx('ding'); }, 1350);
    } else {
      if (items.length < 2) return toast('항목을 두 개 이상 넣어 주세요');
      busy = true;
      const seg = 360 / items.length;
      const win = Math.floor(Math.random() * items.length);
      const w = $('#tlWheel');
      w.innerHTML = wheelSvg(items);
      const base = rot + 360 * 6 - ((rot + 360 * 6) % 360);
      rot = base + ((360 - win * seg) % 360) + (Math.random() - .5) * seg * .7;
      w.style.transition = 'transform 5s cubic-bezier(.12,.7,.08,1)';
      w.style.transform = `rotate(${rot}deg)`;
      // tick + needle kick each time a slice boundary passes the needle
      let lastSlice = -1;
      const needle = $('#tlNeedle');
      const tick = () => {
        const m = getComputedStyle(w).transform;
        if (m && m !== 'none') {
          const [a, b] = m.slice(7, -1).split(',').map(Number);
          const ang = ((Math.atan2(b, a) * 180 / Math.PI) + 360) % 360;
          const slice = Math.floor((((360 - ang) % 360) + seg / 2) / seg) % items.length;
          if (lastSlice >= 0 && slice !== lastSlice) { sfx('tick'); needle.classList.remove('kick'); void needle.offsetWidth; needle.classList.add('kick'); }
          lastSlice = slice;
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      later(() => {
        cancelAnimationFrame(raf);
        busy = false;
        w.innerHTML = wheelSvg(items, win);
        $('#tlRes').textContent = items[win];
        sfx('fanfare');
      }, 5050);
    }
  };
  paint();
  $('#tlActs').onclick = e => {
    const b = e.target.closest('button');
    if (!b || busy) return;
    if (b.dataset.m) { mode = b.dataset.m; lsSet('diceMode', mode); paint(); }
    else if (b.dataset.k) { n = +b.dataset.k; lsSet('diceCount', n); paint(); }
    else if (b.id === 'tlRoll') roll();
    else if (b.id === 'tlWEdit') { editOpen = !editOpen; lsSet('wheelEdit', editOpen); paint(); }
  };
  $('#tlBody').oninput = e => {
    if (e.target.id !== 'tlWItems' || busy) return;
    const list = e.target.value.split('\n').map(x => x.trim()).filter(Boolean).slice(0, 24);
    if (list.length >= 2) setItems(list);
  };
  $('#tlBody').onclick = e => {
    const b = e.target.closest('[data-fill]');
    if (!b || busy) return;
    const names = (ctx.v.roster || []).map(s => s.name);
    const list = { names: names.slice(0, 24), groups: DEFAULT_ITEMS, num: Array.from({ length: 10 }, (_, i) => String(i + 1)), ox: ['O', 'X'] }[b.dataset.fill];
    if (list.length < 2) return toast('학생 명단을 먼저 넣어 주세요');
    $('#tlWItems').value = list.join('\n');
    setItems(list);
  };
  const k = e => { if ((e.key === ' ' || e.key === 'Enter') && !e.target.closest('input, button, textarea, dialog')) { e.preventDefault(); roll(); } };
  addEventListener('keydown', k);
  return () => { removeEventListener('keydown', k); cancelAnimationFrame(raf); timers.forEach(clearTimeout); };
}

// ---------- QR ----------

const readable = u => { try { return decodeURI(u); } catch { return u; } };

function drawQr() {
  let hist = lsGet('qrHist', []);
  let cur = hist[0] || null;
  const paint = () => {
    acts(`<button type="button" class="btn primary" id="qNew">${fa('link')}링크 붙여넣기</button>`);
    if (!cur) return body(`<div class="tl-empty">학생에게 보여 줄 링크를 붙여 넣으면 큰 QR로 띄워요.</div>`);
    body(`<div class="tl-qr"><div class="qrbig">${qrSvg(cur.url, 10, 4)}</div><div class="tx"><b>${esc(cur.title || '링크')}</b><p>${esc(readable(cur.url))}</p>
      <a class="btn" href="${esc(cur.url)}" target="_blank" rel="noopener">${fa('arrow-right')}링크 열어 확인</a>
      ${hist.length > 1 ? `<div class="hist">${hist.map((h, i) => `<button type="button" data-h="${i}" class="${h.url === cur.url ? 'on' : ''}">${esc(h.title || readable(h.url))}</button>`).join('')}</div>` : ''}</div></div>`);
  };
  const ask = () => {
    const d = document.createElement('dialog');
    d.className = 'sheet';
    d.innerHTML = `<form method="dialog" class="seat-form"><h3>${fa('qrcode')} QR 띄우기</h3><label>링크<input id="qUrl" placeholder="https://" required></label><label>제목 (선택)<input id="qTitle" maxlength="40" placeholder="예: 3과 활동지"></label>
      <div class="acts"><button type="button" class="btn" data-x>취소</button><button class="btn primary">띄우기</button></div></form>`;
    document.body.append(d);
    d.showModal();
    d.querySelector('[data-x]').onclick = () => d.close();
    d.querySelector('form').onsubmit = ev => {
      ev.preventDefault();
      let url = d.querySelector('#qUrl').value.trim();
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      // percent-encoded (plain ASCII) links are read the same way by every phone camera
      try { url = new URL(url).href; } catch { return toast('주소를 다시 확인해 주세요'); }
      cur = { url, title: d.querySelector('#qTitle').value.trim() };
      hist = [cur, ...hist.filter(h => h.url !== url)].slice(0, 8);
      lsSet('qrHist', hist);
      d.close(); paint();
    };
    d.onclose = () => d.remove();
  };
  paint();
  $('#tlActs').onclick = e => { if (e.target.closest('#qNew')) ask(); };
  $('#tlBody').onclick = e => { const b = e.target.closest('[data-h]'); if (b) { cur = hist[+b.dataset.h]; paint(); } };
  if (!cur) ask();
}
