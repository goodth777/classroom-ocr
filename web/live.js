// Live activities on the teacher's big screen. The activity lives in Firebase Realtime Database: this screen
// writes it and sees every answer the moment a phone sends it (fb.js). The slow web app server is only used to
// sign in once, send push and save the record. Loaded with tools.js. `T` is the helper kit from tools.js.
import { listen, db } from './fb.js';
import { liveSummary, publicResult, list } from './livecore.js';

export const SHAPES = ['▲', '◆', '●', '■', '★', '♥'];
export const QCOLORS = ['#e2574c', '#3f7fe0', '#d9a520', '#2aa772', '#9b6ad6', '#e0679e'];
const LIGHTS = [['🟢', '이해했어요', '#2fd39a'], ['🟡', '조금 헷갈려요', '#f7e07a'], ['🔴', '모르겠어요', '#ff8a6b']];
const NAMES = { vote: '투표', word: '단어 구름', text: '한 줄 의견', light: '이해도 신호등', quiz: '함께 푸는 퀴즈' };
const when = iso => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

// ---------- result painters (live screen and saved records share them) ----------

function paintVote(T, st, sum, o = {}) {
  const max = Math.max(1, sum.n);
  return `<div class="lv-wrap"><div class="lv-q">${T.esc(st.q || '질문')}<small>${st.anon ? '이름 없이' : '이름 받음'} · ${sum.n}명 응답</small></div>
    ${o.hide ? '<div class="tl-empty">결과를 가려 두었어요. "결과 보기"를 누르면 보여요.</div>' : st.options.map((t, i) => `<div class="lv-bar"><span class="k" style="background:${QCOLORS[i % 6]}">${i + 1}</span>
      <span class="t"><i style="width:${sum.counts[i] / max * 100}%;background:${QCOLORS[i % 6]}"></i><span>${T.esc(t)}</span></span><em>${sum.counts[i]}</em></div>`).join('')}</div>`;
}

function paintWord(T, st, sum, o = {}) {
  const top = Math.max(1, ...sum.words.map(w => w.n));
  const COLS = ['#2fd39a', '#ffc58a', '#8fb6ff', '#c79bff', '#6fd4e0', '#ff8a6b', '#f7e07a', '#9be37f', '#ff9ccf'];
  return `<div class="lv-wrap"><div class="lv-q">${T.esc(st.q || '질문')}<small>${sum.n}명 응답${o.live ? ' · 단어를 누르면 숨겨요' : ''}</small></div>
    <div class="lv-cloud">${sum.words.map((w, i) => `<button type="button" data-hide="${T.esc(w.w)}" style="font-size:${Math.round(18 + 62 * w.n / top)}px;color:${COLS[i % COLS.length]}" ${o.live ? '' : 'disabled'}>${T.esc(w.w)}${w.n > 1 ? `<sup>${w.n}</sup>` : ''}</button>`).join('') || '<span class="tl-empty">아직 보낸 단어가 없어요</span>'}</div></div>`;
}

function paintText(T, st, sum, o = {}) {
  const names = o.names || {};
  return `<div class="lv-wrap"><div class="lv-q">${T.esc(st.q || '질문')}<small>${sum.n}명 응답${o.live ? ' · 카드를 누르면 숨겨요' : ''}</small></div>
    <div class="lv-cards">${sum.items.map(x => `<button type="button" class="lv-card" data-hide="${T.esc(x.t)}" ${o.live ? '' : 'disabled'}>${T.esc(x.t)}${x.sid && names[x.sid] ? `<small>${T.esc(names[x.sid])}</small>` : ''}</button>`).join('') || '<span class="tl-empty">아직 보낸 의견이 없어요</span>'}</div></div>`;
}

function paintLight(T, st, sum, o = {}) {
  const names = o.names || {}, total = Math.max(sum.n, o.total || 0, 1);
  const who = Object.keys(sum.who || {});
  return `<div class="lv-wrap"><div class="lv-q">${T.esc(st.q || '지금 설명, 어땠나요?')}<small>${sum.n}명 응답</small></div>
    <div class="lv-lights">${LIGHTS.map(([e, t, c], i) => `<div class="lv-light" style="--c:${c}"><div class="e">${e}</div><b>${sum.counts[i]}</b><small>${t}</small></div>`).join('')}</div>
    <div class="lv-stack">${sum.counts.map((n, i) => `<i style="width:${n / total * 100}%;background:${LIGHTS[i][2]}"></i>`).join('')}</div>
    ${o.showNames && who.length ? `<div class="lv-who">${who.sort((a, b) => sum.who[b] - sum.who[a]).map(id => `<span style="--c:${LIGHTS[sum.who[id]][2]}">${T.esc(names[id] || '?')}</span>`).join('')}</div>` : ''}</div>`;
}

function paintQuizEnd(T, st, sum, o = {}) {
  const z = st.quiz, names = o.names || {};
  const scores = Object.entries(sum.score || {});
  const avg = scores.length ? Math.round(scores.reduce((a, [, s]) => a + s, 0) / scores.length) : 0;
  return `<div class="lv-wrap"><div class="lv-q">${T.esc(z.title)} · 결과<small>${scores.length}명 참여 · 평균 ${avg}점 (순위는 보여 주지 않아요)</small></div>
    <div class="lv-qend">${z.qs.map((q, i) => { const p = sum.per[i]; const rate = p.n ? Math.round(p.counts[p.answer] / p.n * 100) : 0;
      return `<div class="lv-qrow"><span>${i + 1}</span><b>${T.esc(q.title)}</b><span class="t"><i style="width:${rate}%"></i></span><em>${p.n ? rate + '%' : '–'}</em></div>`; }).join('')}</div>
    ${o.record && scores.length ? `<details class="lv-scores"><summary>학생별 점수 (교사만)</summary><div>${scores.sort((a, b) => String(names[a[0]] || '').localeCompare(String(names[b[0]] || ''))).map(([id, s]) => `<span>${T.esc(names[id] || '?')} <b>${s}</b></span>`).join('')}</div></details>` : ''}</div>`;
}

function paintQuiz(T, st, sum, o = {}) {
  const z = st.quiz;
  if (z.phase === 'end') return paintQuizEnd(T, st, sum, o);
  const q = z.qs[z.i], p = sum.per[z.i], rev = z.phase === 'reveal';
  return `<div class="lv-wrap"><div class="lv-qhead"><div><div class="no">${z.i + 1} / ${z.qs.length}${rev && p.n ? ` · 정답률 ${Math.round(p.counts[p.answer] / p.n * 100)}%` : ''}</div><div class="qq">${T.esc(q.title)}</div></div>
      ${rev ? '' : `<div class="lv-tring" id="lvRing"><b id="lvSec">${z.limit}</b></div>`}</div>
    <div class="lv-qopts">${q.options.map((t, i) => `<div class="lv-qo ${rev ? (i === p.answer ? 'ok' : 'dim') : ''}" style="background:${QCOLORS[i]}"><i>${rev && i === p.answer ? '✓' : SHAPES[i]}</i>${T.esc(t)}${rev ? `<em>${p.counts[i]}</em>` : ''}</div>`).join('')}</div>
    <div class="lv-foot">낸 학생 <b>${p.n}</b>/${o.total || '?'}</div></div>`;
}

const PAINT = { vote: paintVote, word: paintWord, text: paintText, light: paintLight, quiz: paintQuiz };

// ---------- shared runner ----------

// a quiz question can be played live when it is multiple choice with a marked answer
const usable = q => q.type === 'mc' && (q.options || []).length >= 2 && q.answer !== undefined && q.answer !== null && q.answer !== '';
const playable = f => f.questions.filter(usable).map(q => ({ title: q.title, options: q.options.slice(0, 6), answer: +q.answer }));

function liveTool(T, kinds, startForm) {
  const cls = T.ctx.cls.id;
  const roster = T.ctx.v.roster || [];
  const names = Object.fromEntries(roster.map(s => [s.id, s.name]));
  const qkey = 'liveQuiz:' + cls;
  let st = null, ans = {}, qs = null, mode = '', gone = false, busy = false, shown = '', lastResult = '', online = true;
  let stopLive = null, stopAns = null, ansFor = '', pt = 0, rt = 0;
  const local = { hide: false, showNames: false, askAt: 0, askKey: '' };
  const fail = e => T.toast(e.message || '연결이 잠시 끊겼어요');

  // The quiz with its answers stays on this device; another device rebuilds it from 퀴즈·회신.
  const full = s => (s.type === 'quiz' ? { ...s, quiz: { ...s.quiz, keys: { ...(s.quiz.keys || {}) }, qs: qs || [] } } : s);
  const loadQs = async s => {
    const saved = T.get(qkey, null);
    if (saved && saved.id === s.id) { qs = saved.qs; return; }
    const f = (await T.quiet('forms', { classId: cls })).find(x => x.id === s.quiz.formId);
    qs = f ? playable(f) : [];
    T.set(qkey, { id: s.id, qs });
  };
  const summary = () => liveSummary(full(st), ans);

  const paintLive = sum => {
    const s = full(st);
    const right = st.type === 'quiz'
      ? (st.quiz.phase === 'ask' ? `<button type="button" class="btn primary" data-ctl="reveal">정답 공개</button>`
        : st.quiz.phase === 'reveal' ? `<button type="button" class="btn primary" data-ctl="next">${st.quiz.i < st.quiz.n - 1 ? '다음 문제 →' : '결과 보기'}</button>` : '')
      : st.type === 'vote' ? `<button type="button" class="btn" id="lvHide">${T.fa('eye')}${local.hide ? '결과 보기' : '결과 숨기기'}</button>`
      : st.type === 'light' ? `<button type="button" class="btn" id="lvNames">${T.fa('eye')}${local.showNames ? '이름 숨기기' : '이름 보기'}</button><button type="button" class="btn" data-ctl="reset">${T.fa('rotate')}모두 초기화</button>` : '';
    const showBtn = ['vote', 'word', 'text'].includes(st.type) ? `<button type="button" class="btn" data-ctl="show">${st.show ? '학생 화면 결과 끄기' : '학생 화면에 결과'}</button>` : '';
    T.acts(`<span class="lv-pill ${online ? '' : 'off'}"><i></i>${online ? '진행 중' : '다시 연결 중'}</span><span class="lv-cnt">참여 <b>${sum.n}</b>/${roster.length}</span>${showBtn}${right}<button type="button" class="btn" id="lvEnd">${T.fa('check')}끝내기</button>`);
    T.body(PAINT[st.type](T, s, sum, { live: true, names, hide: local.hide, showNames: local.showNames, total: roster.length }));
    tickRing();
  };

  const render = () => {
    if (gone || !st || mode !== 'live') return;
    if (st.type === 'quiz' && !qs) return T.body('<div class="tl-empty">퀴즈를 불러오는 중…</div>');
    const sum = summary();
    const sig = JSON.stringify([st, sum, local.hide, local.showNames, online]);
    if (sig !== shown) { shown = sig; paintLive(sum); }
    shareResult();
  };
  const repaint = () => { if (!pt) pt = setTimeout(() => { pt = 0; render(); }, 50); };

  // results reach phones only when the teacher turns them on; written at most once a second
  const shareResult = () => {
    if (rt || !st.show || !['vote', 'word', 'text'].includes(st.type)) return;
    rt = setTimeout(() => {
      rt = 0;
      if (!st || !st.show) return;
      const r = JSON.stringify(publicResult(summary()));
      if (r !== lastResult) { lastResult = r; db('PUT', `live/${cls}/result`, JSON.parse(r)).catch(() => {}); }
    }, lastResult ? 1000 : 0);
  };

  // quiz countdown runs on this screen; when time is up (or everyone answered) it reveals by itself
  const tickRing = () => {
    if (!st || st.type !== 'quiz' || st.quiz.phase !== 'ask' || !qs || mode !== 'live') return;
    const z = st.quiz, key = st.id + ':' + z.i;
    if (local.askKey !== key) { local.askKey = key; local.askAt = Date.now(); }
    const left = Math.max(0, z.limit - (Date.now() - local.askAt) / 1000);
    const ring = T.$('#lvRing');
    if (ring) { ring.style.setProperty('--p', left / z.limit); T.$('#lvSec').textContent = Math.ceil(left); }
    const all = roster.length && summary().per[z.i].n >= roster.length;
    if ((left <= 0 || all) && !busy) ctl('reveal');
  };

  const closeAns = () => { if (stopAns) stopAns(); stopAns = null; ansFor = ''; ans = {}; };
  const onLive = v => {
    if (gone) return;
    if (!v || !v.id) { st = null; closeAns(); if (mode !== 'start') drawStart(); return; }
    if (!kinds.includes(v.type)) { st = v; closeAns(); if (mode !== 'other') drawOther(v); return; }
    st = v;
    if (mode !== 'live') { mode = 'live'; shown = ''; }
    if (ansFor !== v.id) {
      closeAns();
      ansFor = v.id;
      stopAns = listen(`ans/${cls}/${v.id}`, a => { ans = a || {}; repaint(); });
      if (v.type === 'quiz') { qs = null; loadQs(v).then(repaint).catch(fail); }
    }
    repaint();
  };

  // every change shows here at once and goes to the phones through the database (~0.3 s)
  const ctl = async (op, arg) => {
    if (!st || busy) return;
    busy = true;
    try {
      const z = st.quiz;
      if (op === 'reveal') {
        T.sfx('ding');
        const answer = qs[z.i].answer;
        Object.assign(z, { phase: 'reveal', answer, keys: { ...(z.keys || {}), [z.i]: answer } });
        repaint();
        await db('PATCH', `live/${cls}/quiz`, { phase: 'reveal', answer, [`keys/${z.i}`]: answer });
      } else if (op === 'next') {
        T.sfx('roll');
        const i = z.i + 1;
        const patch = i < qs.length ? { i, key: String(i), phase: 'ask', q: qs[i].title, options: qs[i].options, answer: null } : { phase: 'end' };
        Object.assign(z, patch);
        repaint();
        await db('PATCH', `live/${cls}/quiz`, patch);
      } else if (op === 'hide') {
        st.hidden = [...list(st.hidden), arg];
        repaint();
        await db('PUT', `live/${cls}/hidden`, st.hidden);
      } else if (op === 'show') {
        st.show = !st.show;
        lastResult = '';
        repaint();
        await db('PATCH', `live/${cls}`, { show: st.show, result: null });
      } else if (op === 'reset') {
        ans = {};
        repaint();
        await db('DELETE', `ans/${cls}/${st.id}`);
        await db('PATCH', `live/${cls}`, { resetAt: Date.now() });
      }
    } catch (e) { fail(e); } finally { busy = false; }
  };

  // phones see the end at once (ended flag); results come from the answers in the database, and the answers are
  // deleted only after the record is safely in the sheet (a failed save can simply be retried with 끝내기)
  const finish = async s => {
    await db('PATCH', `live/${cls}`, { ended: Date.now() });
    const a = (await db('GET', `ans/${cls}/${s.id}`)) || {};
    if (s.type === 'quiz' && (!qs || ansFor !== s.id)) await loadQs(s);
    const fs = full(s);
    delete fs.result;
    await T.call('liveSave', { classId: cls, rec: { id: s.id, type: s.type, st: fs, sum: liveSummary(fs, a) } });
    await db('DELETE', `ans/${cls}/${s.id}`);
    await db('DELETE', `live/${cls}`);
    T.set(qkey, null);
  };

  const drawOther = s => {
    mode = 'other';
    T.acts('');
    T.body(`<div class="tl-empty">지금 다른 활동(<b>${NAMES[s.type] || s.type}</b>)이 진행 중이에요.<br><button type="button" class="btn primary" id="lvEndOther" style="margin-top:18px">그 활동 끝내고 여기서 시작</button></div>`);
  };

  const drawStart = () => {
    mode = 'start';
    T.acts('');
    T.body(`<div class="lv-start"><div class="lv-form" id="lvForm"></div><div class="lv-hist"><h4>${T.fa('clock-rotate-left')} 지난 기록</h4><div id="lvHist"><p class="muted small">불러오는 중…</p></div></div></div>`);
    startForm(T.$('#lvForm'), start);
    T.quiet('lives', { classId: cls }).then(rows => {
      const box = T.$('#lvHist');
      if (!box) return;
      const mine = rows.filter(l => kinds.includes(l.type));
      box.innerHTML = mine.map(l => `<button type="button" class="lv-rec" data-rec="${l.id}"><b>${T.esc(l.title || NAMES[l.type])}</b><small>${NAMES[l.type]} · ${when(l.started)}</small></button>`).join('') || '<p class="muted small">아직 기록이 없어요</p>';
    }).catch(() => {});
  };

  const start = async p => {
    if (busy) return;
    busy = true;
    try {
      const s = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), type: p.type, q: p.q || '', anon: !!p.anon, show: !!p.show, started: Date.now() };
      if (p.type === 'vote') s.options = p.options;
      if (p.type === 'quiz') {
        qs = p.qs;
        T.set(qkey, { id: s.id, qs });
        s.q = p.title;
        s.quiz = { formId: p.formId, title: p.title, n: qs.length, i: 0, key: '0', phase: 'ask', limit: p.limit, q: qs[0].title, options: qs[0].options };
      }
      await db('PUT', `live/${cls}`, s);
      T.sfx('chime');
      busy = false;
      onLive(s);
      // push for phones that are closed; the teacher does not wait for it
      if (p.push) T.quiet('livePush', { classId: cls, type: s.type, q: s.q }).catch(() => {});
    } catch (e) { fail(e); } finally { busy = false; }
  };

  const openRec = id => T.call('liveRec', { classId: cls, id }).then(r => {
    if (!r) return;
    const d = document.createElement('dialog');
    d.className = 'sheet lv-recdlg';
    d.innerHTML = `<div class="lv-rechead"><b>${T.esc(r.st.q || NAMES[r.st.type])}</b><small>${NAMES[r.st.type]} · ${when(r.st.started)}</small><span class="sp"></span>
      <button type="button" class="btn" data-del>${T.fa('trash-can')}지우기</button><button type="button" class="btn primary" data-x>닫기</button></div>
      <div class="lv-recbody">${r.st.type === 'quiz' ? paintQuizEnd(T, r.st, r.sum, { names: r.names, record: true }) : PAINT[r.st.type](T, r.st, r.sum, { names: r.names, showNames: true })}</div>`;
    document.body.append(d);
    d.showModal();
    d.onclick = e => {
      if (e.target.closest('[data-x]')) d.close();
      if (e.target.closest('[data-del]') && confirm('이 기록을 지울까요?')) T.call('liveRecDel', { classId: cls, id }).then(() => { d.close(); drawStart(); }).catch(fail);
    };
    d.onclose = () => d.remove();
  }).catch(fail);

  const endNow = async s => {
    busy = true;
    try { await finish(s); T.toast('끝냈어요. 결과를 기록에 저장했어요'); st = null; closeAns(); drawStart(); }
    catch (e) { fail(e); } finally { busy = false; }
  };

  T.$('#tlActs').onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.ctl) ctl(b.dataset.ctl, b.dataset.arg);
    else if (b.id === 'lvHide') { local.hide = !local.hide; repaint(); }
    else if (b.id === 'lvNames') { local.showNames = !local.showNames; repaint(); }
    else if (b.id === 'lvEnd' && !busy && confirm('활동을 끝낼까요? 결과는 기록에 저장돼요.')) endNow(st);
  };
  T.$('#tlBody').onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.ctl) ctl(b.dataset.ctl, b.dataset.arg);
    else if (b.dataset.hide !== undefined && st && confirm(`"${b.dataset.hide}"을(를) 화면에서 숨길까요?`)) ctl('hide', b.dataset.hide);
    else if (b.dataset.rec) openRec(b.dataset.rec);
    else if (b.id === 'lvEndOther' && st && !busy) endNow(st);
  };
  const ring = setInterval(tickRing, 250);

  T.body('<div class="tl-empty">실시간 연결 중…</div>');
  stopLive = listen(`live/${cls}`, onLive, (status, err) => {
    online = status === 'ok';
    if (!mode && err) T.body(`<div class="tl-empty">${T.esc(err.message || '실시간 연결에 실패했어요')}<br><small>자동으로 다시 시도하고 있어요.</small></div>`);
    else repaint();
  });
  return () => { gone = true; if (stopLive) stopLive(); closeAns(); clearInterval(ring); clearTimeout(pt); clearTimeout(rt); };
}

// ---------- start forms ----------

const check = (id, label, on) => `<label class="lv-chk"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}> ${label}</label>`;
const go = label => `<button type="submit" class="btn primary lv-go">${label}</button>`;

export function drawVote(T) {
  const cfg = T.get('voteCfg', { mode: 'vote', anon: true, show: false, push: true });
  return liveTool(T, ['vote', 'word', 'text'], (box, start) => {
    const paint = () => {
      box.innerHTML = `<form id="lvF"><h3>${T.fa('square-poll-horizontal')} 실시간 투표 시작하기</h3>
        <div class="seg2" id="lvMode">${[['vote', '객관식'], ['word', '단어 (단어 구름)'], ['text', '한 줄 의견']].map(([k, t]) => `<button type="button" data-m="${k}" class="${cfg.mode === k ? 'on' : ''}">${t}</button>`).join('')}</div>
        <label>질문<input id="lvQ" maxlength="200" required placeholder="${cfg.mode === 'vote' ? '오늘 글의 주제로 알맞은 것은?' : cfg.mode === 'word' ? '주인공을 한 단어로 표현하면?' : '오늘 배운 것 중 가장 기억에 남는 것은?'}"></label>
        ${cfg.mode === 'vote' ? `<label>보기 <small class="muted">한 줄에 하나씩 (2~6개)</small><textarea id="lvO" rows="4">${T.esc((cfg.opts || ['', '']).join('\n'))}</textarea></label>
          <div class="lv-quick"><button type="button" data-o="O\nX">O / X</button><button type="button" data-o="1\n2\n3\n4">1~4</button><button type="button" data-o="찬성\n반대">찬성 / 반대</button><button type="button" data-o="네\n아니요\n잘 모르겠어요">네 / 아니요</button></div>` : ''}
        ${check('lvAnon', '이름 없이 받기 (교사도 누가 냈는지 몰라요)', cfg.anon)}${check('lvShow', '학생 화면에도 결과 보여 주기', cfg.show)}${check('lvPush', '학생 휴대폰에 알림도 보내기', cfg.push)}
        ${go(`${T.fa('play')}시작`)}</form>`;
    };
    paint();
    box.onclick = e => {
      const b = e.target.closest('button');
      if (b && b.dataset.m) { cfg.mode = b.dataset.m; T.set('voteCfg', cfg); paint(); }
      if (b && b.dataset.o) box.querySelector('#lvO').value = b.dataset.o;
    };
    box.onsubmit = e => {
      e.preventDefault();
      Object.assign(cfg, { anon: box.querySelector('#lvAnon').checked, show: box.querySelector('#lvShow').checked, push: box.querySelector('#lvPush').checked });
      const options = cfg.mode === 'vote' ? box.querySelector('#lvO').value.split('\n').map(x => x.trim()).filter(Boolean) : [];
      if (cfg.mode === 'vote' && (options.length < 2 || options.length > 6)) return T.toast('보기를 2~6개 넣어 주세요');
      if (cfg.mode === 'vote') cfg.opts = options;
      T.set('voteCfg', cfg);
      start({ type: cfg.mode, q: box.querySelector('#lvQ').value.trim(), options, anon: cfg.anon, show: cfg.show, push: cfg.push });
    };
  });
}

export function drawLight(T) {
  const cfg = T.get('lightCfg', { anon: false, push: true });
  return liveTool(T, ['light'], (box, start) => {
    box.innerHTML = `<form><h3>${T.fa('traffic-light')} 이해도 신호등 시작하기</h3><p class="muted small">학생은 수업 중 아무 때나 🟢🟡🔴를 눌러 바꿀 수 있어요. 친구들 것은 안 보여요.</p>
      <label>질문<input id="lvQ" maxlength="200" value="지금 설명, 어땠나요?"></label>
      ${check('lvAnon', '이름 없이 받기 (교사도 누가 눌렀는지 몰라요)', cfg.anon)}${check('lvPush', '학생 휴대폰에 알림도 보내기', cfg.push)}${go(`${T.fa('play')}시작`)}</form>`;
    box.onsubmit = e => {
      e.preventDefault();
      Object.assign(cfg, { anon: box.querySelector('#lvAnon').checked, push: box.querySelector('#lvPush').checked });
      T.set('lightCfg', cfg);
      start({ type: 'light', q: box.querySelector('#lvQ').value.trim(), anon: cfg.anon, push: cfg.push });
    };
  });
}

export function drawQuiz(T) {
  const cfg = T.get('quizCfg', { limit: 20, push: true });
  return liveTool(T, ['quiz'], (box, start) => {
    box.innerHTML = `<p class="muted">퀴즈 목록을 불러오는 중…</p>`;
    T.quiet('forms', { classId: T.ctx.cls.id }).then(forms => {
      const quizzes = forms.filter(f => f.kind === 'quiz').map(f => ({ f, n: f.questions.filter(usable).length })).filter(x => x.n);
      if (!quizzes.length) { box.innerHTML = `<div class="tl-empty">정답이 있는 객관식 문항으로 된 퀴즈가 없어요.<br><small>퀴즈·회신 탭에서 퀴즈를 먼저 만들어 주세요.</small></div>`; return; }
      box.innerHTML = `<form><h3>${T.fa('graduation-cap')} 함께 푸는 퀴즈 시작하기</h3><p class="muted small">퀴즈·회신 탭의 퀴즈 중 정답이 있는 객관식 문항만 한 문제씩 띄워요. 순위는 보여 주지 않아요.</p>
        <div class="lv-quizzes">${quizzes.map(({ f, n }, i) => `<label class="lv-qpick"><input type="radio" name="lvQz" value="${f.id}" ${i === 0 ? 'checked' : ''}><b>${T.esc(f.title || '제목 없는 퀴즈')}</b><small>객관식 ${n}문항${n < f.questions.length ? ` (나머지 ${f.questions.length - n}개는 빼요)` : ''}</small></label>`).join('')}</div>
        <div class="lv-row">문제당 시간 <div class="seg2" id="lvLim">${[10, 20, 30, 60].map(s => `<button type="button" data-l="${s}" class="${cfg.limit === s ? 'on' : ''}">${s}초</button>`).join('')}</div></div>
        ${check('lvPush', '학생 휴대폰에 알림도 보내기', cfg.push)}${go(`${T.fa('play')}시작`)}</form>`;
      box.onclick = e => { const b = e.target.closest('[data-l]'); if (b) { cfg.limit = +b.dataset.l; T.set('quizCfg', cfg); box.querySelectorAll('[data-l]').forEach(x => x.classList.toggle('on', x === b)); } };
      box.onsubmit = e => {
        e.preventDefault();
        cfg.push = box.querySelector('#lvPush').checked;
        T.set('quizCfg', cfg);
        const f = forms.find(x => x.id === box.querySelector('[name=lvQz]:checked').value);
        start({ type: 'quiz', formId: f.id, title: f.title || '퀴즈', qs: playable(f), limit: cfg.limit, push: cfg.push });
      };
    }).catch(e => { box.innerHTML = `<p class="muted">${T.esc(e.message)}</p>`; });
  });
}
