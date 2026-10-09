// Classroom tools bundle 2: groups, scoreboard, noise meter, class clock, QR, presentation order.
// All on the teacher's device. `T` is the helper kit from tools.js (ctx, acts, body, $, store, sfx, toast, fa, esc).
import { makeGroups } from './grouplogic.js';
import { qrSvg } from './qr.js';

const COLORS = ['#2fd39a', '#ffc58a', '#8fb6ff', '#ff8a6b', '#c79bff', '#6fd4e0', '#f7e07a', '#9be37f', '#ff9ccf', '#a0a8ff'];
const rosterOf = T => (T.ctx.v.roster || []).slice().sort((a, b) => String(a.sno || '').localeCompare(String(b.sno || '')) || a.number - b.number);
const nameOf = T => Object.fromEntries(rosterOf(T).map(s => [s.id, s.name]));
export const savedGroups = T => T.get('groups:' + T.ctx.cls.id, null);

// ---------- groups ----------

export function drawGroups(T) {
  const cls = T.ctx.cls.id;
  const roster = rosterOf(T), names = nameOf(T);
  const cfg = T.get('grpCfg:' + cls, { by: 'size', n: 4, lead: true, apart: [], together: [] });
  let cur = savedGroups(T);
  let saved = !!cur;
  const save = () => T.set('grpCfg:' + cls, cfg);
  const paint = () => {
    T.acts(`<div class="seg2" id="gBy"><button type="button" data-by="size" class="${cfg.by === 'size' ? 'on' : ''}">${cfg.n}명씩</button><button type="button" data-by="count" class="${cfg.by === 'count' ? 'on' : ''}">${cfg.n}모둠</button></div>
      <span class="tl-step"><button type="button" data-d="-1" aria-label="줄이기">−</button><b>${cfg.n}</b><button type="button" data-d="1" aria-label="늘리기">＋</button></span>
      <button type="button" class="btn" id="gRules">${T.fa('arrows-left-right')}규칙 ${cfg.apart.length + cfg.together.length}</button>
      <label class="tl-check"><input type="checkbox" id="gLead" ${cfg.lead ? 'checked' : ''}> 모둠장</label>
      ${cur ? `<button type="button" class="btn" id="gPrint">${T.fa('print')}인쇄</button><button type="button" class="btn ${saved ? '' : 'primary'}" id="gSave">${T.fa(saved ? 'check' : 'floppy-disk')}${saved ? '저장됨' : '저장'}</button>` : ''}
      <button type="button" class="btn primary" id="gGo">${T.fa('shuffle')}섞기</button>`);
    if (!cur) return T.body(`<div class="tl-empty">${roster.length ? `학생 ${roster.length}명을 ${cfg.by === 'size' ? `${cfg.n}명씩` : `${cfg.n}모둠으로`} 나눠요.<br>"섞기"를 눌러 주세요.` : '학생 명단을 먼저 넣어 주세요.'}</div>`);
    T.body(`<div class="tl-groups">${cur.groups.map((g, i) => `<div class="tl-gcard" style="--c:${COLORS[i % COLORS.length]}"><h4>${i + 1}모둠 <small>${g.length}명</small></h4>
      <div>${g.map((id, k) => `<span class="${cfg.lead && k === 0 ? 'lead' : ''}">${T.esc(names[id] || '?')}</span>`).join('')}</div></div>`).join('')}</div>`);
  };
  const shuffle = () => {
    if (!roster.length) return T.toast('학생 명단을 먼저 넣어 주세요');
    const groups = makeGroups(roster.map(s => s.id), cfg.by === 'size' ? { size: cfg.n } : { count: cfg.n }, cfg.apart, cfg.together);
    cur = { groups, at: new Date().toISOString() };
    saved = false;
    T.sfx('drumroll');
    paint();
    T.$('#tlBody').querySelectorAll('.tl-gcard').forEach((c, i) => c.animate([{ opacity: 0, transform: 'translateY(24px) scale(.9)' }, { opacity: 1, transform: 'none' }], { duration: 380, delay: 120 * i, easing: 'cubic-bezier(.3,1.4,.5,1)', fill: 'backwards' }));
    setTimeout(() => T.sfx('fanfare'), 120 * groups.length + 300);
  };
  const rules = () => {
    const opts = roster.map(s => `<option value="${s.id}">${T.esc(s.name)}</option>`).join('');
    const d = document.createElement('dialog');
    d.className = 'sheet';
    const draw = () => {
      const row = (kind, p, i) => `<div class="seat-pair">${T.esc(names[p[0]] || '?')} ${T.fa(kind === 'apart' ? 'arrows-left-right' : 'link')} ${T.esc(names[p[1]] || '?')}<button type="button" data-rm="${kind}:${i}" aria-label="지우기">${T.fa('xmark')}</button></div>`;
      d.innerHTML = `<form method="dialog" class="seat-form"><h3>${T.fa('arrows-left-right')} 모둠 규칙</h3>
        <div class="row2"><label>학생 1<select id="r1">${opts}</select></label><label>학생 2<select id="r2">${opts}</select></label></div>
        <div class="acts" style="justify-content:flex-start"><button type="button" class="btn" data-add="apart">${T.fa('arrows-left-right')}떨어뜨리기</button><button type="button" class="btn" data-add="together">${T.fa('link')}함께하기</button></div>
        <div class="seat-pairs">${cfg.apart.map((p, i) => row('apart', p, i)).join('')}${cfg.together.map((p, i) => row('together', p, i)).join('') || ''}</div>
        <div class="acts"><button class="btn primary">닫기</button></div></form>`;
      d.querySelector('#r2').selectedIndex = Math.min(1, roster.length - 1);
    };
    draw();
    document.body.append(d);
    d.showModal();
    d.onclick = e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.add) {
        const a = d.querySelector('#r1').value, c = d.querySelector('#r2').value;
        if (a === c) return T.toast('서로 다른 두 학생을 골라 주세요');
        cfg[b.dataset.add].push([a, c]); save(); draw();
      } else if (b.dataset.rm) { const [k, i] = b.dataset.rm.split(':'); cfg[k].splice(+i, 1); save(); draw(); }
    };
    d.onclose = () => { d.remove(); paint(); };
  };
  paint();
  T.$('#tlActs').onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.by) { cfg.by = b.dataset.by; save(); paint(); }
    else if (b.dataset.d) { cfg.n = Math.max(2, Math.min(cfg.by === 'size' ? 8 : 12, cfg.n + +b.dataset.d)); save(); paint(); }
    else if (b.id === 'gGo') shuffle();
    else if (b.id === 'gRules') rules();
    else if (b.id === 'gSave') { T.set('groups:' + cls, cur); saved = true; T.toast('모둠을 저장했어요. 점수판·발표 순서에서 쓸 수 있어요'); paint(); }
    else if (b.id === 'gPrint') { document.body.classList.add('tl-printing'); print(); setTimeout(() => document.body.classList.remove('tl-printing'), 500); }
  };
  T.$('#tlActs').onchange = e => { if (e.target.id === 'gLead') { cfg.lead = e.target.checked; save(); paint(); } };
}

// ---------- scoreboard ----------

export function drawScore(T) {
  const key = 'score:' + T.ctx.cls.id;
  const fromGroups = () => { const g = savedGroups(T); return (g ? g.groups.map((_, i) => `${i + 1}모둠`) : ['1모둠', '2모둠', '3모둠', '4모둠', '5모둠', '6모둠']).map(name => ({ name, score: 0 })); };
  let teams = T.get(key, null) || fromGroups();
  const save = () => T.set(key, teams);
  const paint = () => {
    T.acts(`<button type="button" class="btn" id="sGroups">${T.fa('people-group')}모둠 불러오기</button><button type="button" class="btn" id="sReset">${T.fa('rotate')}새 판 시작</button>`);
    const order = teams.map((t, i) => ({ ...t, i })).sort((a, b) => b.score - a.score || a.i - b.i);
    const top = Math.max(1, ...teams.map(t => t.score));
    T.body(`<div class="tl-score">${order.map((t, r) => `<div class="tl-srow ${r === 0 && t.score > 0 ? 'first' : ''}" data-i="${t.i}">
      <span class="rk">${r === 0 && t.score > 0 ? '👑' : r + 1}</span><b>${T.esc(t.name)}</b><span class="t"><i style="width:${Math.max(0, t.score) / top * 100}%;background:${COLORS[t.i % COLORS.length]}"></i></span>
      <span class="pt">${t.score}</span><span class="pm"><button type="button" data-p="-1" aria-label="${T.esc(t.name)} 1점 빼기">−</button><button type="button" class="p" data-p="1" aria-label="${T.esc(t.name)} 1점 더하기">+1</button></span>
      <small class="key">${t.i < 9 ? t.i + 1 : ''}</small></div>`).join('')}</div>`);
  };
  const add = (i, d) => { teams[i].score += d; save(); if (d > 0) T.sfx('ding'); paint(); const row = T.$(`.tl-srow[data-i="${i}"] .pt`); if (row) row.animate([{ transform: 'scale(1.4)' }, { transform: 'scale(1)' }], { duration: 300 }); };
  paint();
  T.$('#tlBody').onclick = e => { const b = e.target.closest('[data-p]'); if (b) add(+b.closest('[data-i]').dataset.i, +b.dataset.p); };
  T.$('#tlActs').onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'sReset' && confirm('점수를 모두 0으로 할까요?')) { teams = teams.map(t => ({ ...t, score: 0 })); save(); paint(); }
    if (b.id === 'sGroups') { if (!savedGroups(T)) return T.toast('모둠 편성에서 모둠을 먼저 저장해 주세요'); teams = fromGroups(); save(); paint(); }
  };
  const k = e => { const i = +e.key - 1; if (i >= 0 && i < teams.length && !e.target.closest('input, textarea')) add(i, e.shiftKey ? -1 : 1); };
  addEventListener('keydown', k);
  return () => removeEventListener('keydown', k);
}

// ---------- noise meter (microphone level only; nothing is recorded or sent) ----------

export function drawNoise(T) {
  const cfg = T.get('noiseCfg', { sens: 50, limit: 70, sound: true });
  let stream = null, ac = null, raf = 0, level = 0, over = 0, lastShh = 0;
  const paint = () => {
    T.acts(`<label class="tl-range">민감도 <input type="range" min="10" max="100" id="nSens" value="${cfg.sens}"></label>
      <label class="tl-range">기준 <input type="range" min="30" max="95" id="nLimit" value="${cfg.limit}"></label>
      <label class="tl-check"><input type="checkbox" id="nSound" ${cfg.sound ? 'checked' : ''}> 넘으면 소리</label>`);
    T.body(`<div class="tl-meter"><div class="face" id="nFace">🎤</div><div class="mwrap"><div class="mbar"></div><div class="mbar fill" id="nFill"></div><div class="mline" id="nLine"></div></div>
      <div class="mlab" id="nLab">마이크를 켜는 중… (처음이면 허용을 눌러 주세요)</div></div>`);
    T.$('#nLine').style.left = cfg.limit + '%';
  };
  const loop = an => {
    const data = new Uint8Array(an.fftSize);
    const step = () => {
      an.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / data.length);
      const target = Math.min(100, rms * cfg.sens * 9);
      level += (target - level) * (target > level ? .35 : .08); // rise fast, fall slowly
      const fill = T.$('#nFill');
      if (!fill) return;
      fill.style.clipPath = `inset(0 ${100 - level}% 0 0)`;
      const loud = level > cfg.limit, mid = level > cfg.limit * .7;
      T.$('#nFace').textContent = loud ? '😵' : mid ? '🙂' : '😊';
      T.$('#nLab').textContent = loud ? '조금만 조용히!' : mid ? '적당해요' : '아주 조용해요';
      T.$('#nLab').className = 'mlab ' + (loud ? 'w' : mid ? 'y' : '');
      over = loud ? over + 1 : 0;
      if (cfg.sound && over > 45 && Date.now() - lastShh > 6000) { lastShh = Date.now(); T.sfx('shh'); }
      raf = requestAnimationFrame(step);
    };
    step();
  };
  paint();
  T.$('#tlActs').oninput = e => {
    if (e.target.id === 'nSens') cfg.sens = +e.target.value;
    if (e.target.id === 'nLimit') { cfg.limit = +e.target.value; T.$('#nLine').style.left = cfg.limit + '%'; }
    T.set('noiseCfg', cfg);
  };
  T.$('#tlActs').onchange = e => { if (e.target.id === 'nSound') { cfg.sound = e.target.checked; T.set('noiseCfg', cfg); } };
  navigator.mediaDevices?.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false } }).then(s => {
    stream = s;
    ac = new (window.AudioContext || window.webkitAudioContext)();
    const an = ac.createAnalyser();
    an.fftSize = 1024;
    ac.createMediaStreamSource(s).connect(an);
    loop(an);
  }).catch(() => { const l = T.$('#nLab'); if (l) l.textContent = '마이크를 쓸 수 없어요. 주소창 왼쪽 자물쇠 → 마이크 허용을 확인해 주세요.'; });
  return () => { cancelAnimationFrame(raf); if (stream) stream.getTracks().forEach(t => t.stop()); if (ac) ac.close(); };
}

// ---------- class clock ----------

const DEFAULT_PERIODS = '1 08:40 09:30\n2 09:40 10:30\n3 10:40 11:30\n4 11:40 12:30\n5 13:20 14:10\n6 14:20 15:10\n7 15:20 16:10';
const parsePeriods = txt => String(txt).split('\n').map(l => /^\s*(\S+)\s+(\d{1,2}):(\d{2})\s+(\d{1,2}):(\d{2})/.exec(l)).filter(Boolean)
  .map(m => ({ name: m[1], start: +m[2] * 60 + +m[3], end: +m[4] * 60 + +m[5] }));

export function drawClock(T) {
  let txt = T.get('periods', DEFAULT_PERIODS);
  let warn = T.get('clockWarn', true);
  let warned = '';
  let t = 0;
  const paint = () => {
    T.acts(`<label class="tl-check"><input type="checkbox" id="cWarn" ${warn ? 'checked' : ''}> 끝나기 5분 전 알림</label><button type="button" class="btn" id="cEdit">${T.fa('pen')}교시 시간표</button>`);
    T.body(`<div class="tl-clock"><div class="now" id="cNow"></div><div class="per" id="cPer"></div><div class="pb"><i id="cBar"></i></div><div class="pm2"><span id="cS"></span><span id="cE"></span></div></div>`);
    update();
  };
  const update = () => {
    const d = new Date(), mins = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
    const now = T.$('#cNow');
    if (!now) return;
    now.textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const ps = parsePeriods(txt);
    const cur = ps.find(p => mins >= p.start && mins < p.end);
    const next = ps.find(p => p.start > mins);
    const hm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;
    if (cur) {
      const left = Math.ceil(cur.end - mins);
      T.$('#cPer').textContent = `${cur.name}교시 · 끝까지 ${left}분`;
      T.$('#cBar').style.width = ((mins - cur.start) / (cur.end - cur.start) * 100) + '%';
      T.$('#cS').textContent = `${hm(cur.start)} 시작`;
      T.$('#cE').textContent = `${hm(cur.end)} 끝`;
      if (warn && left === 5 && warned !== cur.name) { warned = cur.name; T.sfx('chime'); T.toast('수업이 5분 남았어요'); }
    } else {
      T.$('#cPer').textContent = next ? `쉬는 시간 · ${next.name}교시까지 ${Math.ceil(next.start - mins)}분` : '오늘 수업이 끝났어요';
      T.$('#cBar').style.width = '0%';
      T.$('#cS').textContent = ''; T.$('#cE').textContent = '';
    }
  };
  paint();
  t = setInterval(update, 1000);
  T.$('#tlActs').onchange = e => { if (e.target.id === 'cWarn') { warn = e.target.checked; T.set('clockWarn', warn); } };
  T.$('#tlActs').onclick = e => {
    if (!e.target.closest('#cEdit')) return;
    const d = document.createElement('dialog');
    d.className = 'sheet';
    d.innerHTML = `<form method="dialog" class="seat-form"><h3>${T.fa('clock')} 교시 시간표</h3><p class="muted small">한 줄에 "교시 시작 끝" (예: 3 10:40 11:30)</p>
      <textarea rows="9" id="cTxt">${T.esc(txt)}</textarea><div class="acts"><button type="button" class="btn" data-x>취소</button><button class="btn primary">저장</button></div></form>`;
    document.body.append(d);
    d.showModal();
    d.querySelector('[data-x]').onclick = () => d.close();
    d.querySelector('form').onsubmit = ev => {
      ev.preventDefault();
      const v = d.querySelector('#cTxt').value;
      if (!parsePeriods(v).length) return T.toast('"3 10:40 11:30"처럼 써 주세요');
      txt = v; T.set('periods', txt); d.close(); update();
    };
    d.onclose = () => d.remove();
  };
  return () => clearInterval(t);
}

// ---------- QR ----------

export function drawQr(T) {
  let hist = T.get('qrHist', []);
  let cur = hist[0] || null;
  const paint = () => {
    T.acts(`<button type="button" class="btn primary" id="qNew">${T.fa('link')}링크 붙여넣기</button>`);
    if (!cur) return T.body(`<div class="tl-empty">학생에게 보여 줄 링크를 붙여 넣으면 큰 QR로 띄워요.</div>`);
    T.body(`<div class="tl-qr"><div class="qrbig">${qrSvg(cur.url, 10)}</div><div class="tx"><b>${T.esc(cur.title || '링크')}</b><p>${T.esc(cur.url)}</p>
      ${hist.length > 1 ? `<div class="hist">${hist.map((h, i) => `<button type="button" data-h="${i}" class="${h.url === cur.url ? 'on' : ''}">${T.esc(h.title || h.url)}</button>`).join('')}</div>` : ''}</div></div>`);
  };
  const ask = () => {
    const d = document.createElement('dialog');
    d.className = 'sheet';
    d.innerHTML = `<form method="dialog" class="seat-form"><h3>${T.fa('qrcode')} QR 띄우기</h3><label>링크<input id="qUrl" placeholder="https://" required></label><label>제목 (선택)<input id="qTitle" maxlength="40" placeholder="예: 3과 활동지"></label>
      <div class="acts"><button type="button" class="btn" data-x>취소</button><button class="btn primary">띄우기</button></div></form>`;
    document.body.append(d);
    d.showModal();
    d.querySelector('[data-x]').onclick = () => d.close();
    d.querySelector('form').onsubmit = ev => {
      ev.preventDefault();
      const url = d.querySelector('#qUrl').value.trim();
      if (!/^https?:\/\/\S+$/.test(url)) return T.toast('http:// 또는 https://로 시작하는 주소를 넣어 주세요');
      cur = { url, title: d.querySelector('#qTitle').value.trim() };
      hist = [cur, ...hist.filter(h => h.url !== url)].slice(0, 8);
      T.set('qrHist', hist);
      d.close(); paint();
    };
    d.onclose = () => d.remove();
  };
  paint();
  T.$('#tlActs').onclick = e => { if (e.target.closest('#qNew')) ask(); };
  T.$('#tlBody').onclick = e => { const b = e.target.closest('[data-h]'); if (b) { cur = hist[+b.dataset.h]; paint(); } };
  if (!cur) ask();
}

// ---------- presentation order ----------

export function drawOrder(T) {
  const key = 'order:' + T.ctx.cls.id;
  const names = nameOf(T);
  let st = T.get(key, null);
  const build = by => {
    const g = savedGroups(T);
    let items = by === 'groups' && g ? g.groups.map((_, i) => `${i + 1}모둠`) : rosterOf(T).map(s => s.name);
    for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; }
    st = { by, items, at: 0 };
    T.set(key, st);
  };
  if (!st) build(savedGroups(T) ? 'groups' : 'students');
  const paint = () => {
    T.acts(`<div class="seg2" id="oBy"><button type="button" data-by="students" class="${st.by === 'students' ? 'on' : ''}">학생</button><button type="button" data-by="groups" class="${st.by === 'groups' ? 'on' : ''}">모둠</button></div>
      <button type="button" class="btn" id="oShuffle">${T.fa('shuffle')}다시 섞기</button><button type="button" class="btn" id="oPrev" ${st.at ? '' : 'disabled'}>${T.fa('chevron-left')}</button>
      <button type="button" class="btn primary" id="oNext" ${st.at < st.items.length ? '' : 'disabled'}>다음 차례 ${T.fa('chevron-right')}</button>`);
    T.body(`<div class="tl-order">${st.items.map((n, i) => `<div class="ord ${i < st.at ? 'done' : i === st.at ? 'now' : ''}"><i>${i + 1}</i>${T.esc(n)}</div>`).join('')}</div>
      ${st.at >= st.items.length ? '<div class="tl-res">모두 끝났어요 👏</div>' : ''}`);
    const now = T.$('.ord.now');
    if (now) now.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  paint();
  T.$('#tlActs').onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.by) { if (b.dataset.by === 'groups' && !savedGroups(T)) return T.toast('모둠 편성에서 모둠을 먼저 저장해 주세요'); build(b.dataset.by); }
    else if (b.id === 'oShuffle') build(st.by);
    else if (b.id === 'oNext' && st.at < st.items.length) { st.at++; T.sfx(st.at >= st.items.length ? 'fanfare' : 'ding'); }
    else if (b.id === 'oPrev' && st.at) st.at--;
    T.set(key, st);
    paint();
  };
  const k = e => { if ((e.key === 'ArrowRight' || e.key === ' ') && !e.target.closest('input, button') && st.at < st.items.length) { e.preventDefault(); st.at++; T.set(key, st); paint(); } };
  addEventListener('keydown', k);
  void names;
  return () => removeEventListener('keydown', k);
}
