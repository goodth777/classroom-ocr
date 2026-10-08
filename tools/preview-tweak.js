// Preview-only WYSIWYG tweak tool. Click "✏️ 조정 모드", click an element, adjust it in the panel.
// Every change is kept in localStorage ("tweaks:<page>") so Claude can read it back and apply it to the real code.
(() => {
  const KEY = 'tweaks:' + location.pathname.split('/').pop();
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
  const save = list => { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {} };
  let log = load();
  let on = false;
  let sel = null;

  const css = document.createElement('style');
  css.textContent = `
    .tw-bar{position:fixed;left:10px;bottom:34px;z-index:99999;display:flex;gap:6px;font:600 12.5px/1 "Pretendard Variable",Pretendard,system-ui,sans-serif}
    .tw-bar button{border:0;border-radius:999px;padding:8px 12px;background:#1d1d1f;color:#fff;cursor:pointer;box-shadow:0 4px 14px rgb(0 0 0/.15)}
    .tw-bar button.on{background:#2fd39a;color:#06130e}
    .tw-hover{outline:2px dashed #ffb86b!important;outline-offset:1px!important;cursor:pointer!important}
    .tw-sel{outline:2px solid #ff6b6b!important;outline-offset:2px!important}
    .tw-panel{position:fixed;right:10px;top:54px;width:250px;max-height:calc(100vh - 70px);overflow:auto;z-index:99999;background:#fff;color:#1d1d1f;border-radius:14px;box-shadow:0 10px 40px rgb(0 0 0/.25);padding:12px;font:13px/1.4 "Pretendard Variable",Pretendard,system-ui,sans-serif}
    .tw-panel h4{margin:0 0 8px;font-size:13px}
    .tw-panel .lab{font-size:11px;color:#777;margin:10px 0 4px;font-weight:700}
    .tw-panel .row{display:flex;gap:4px;align-items:center;flex-wrap:wrap}
    .tw-panel button{border:1px solid #ddd;background:#f6f6f3;border-radius:8px;padding:6px 9px;font:inherit;font-size:12px;cursor:pointer}
    .tw-panel button:hover{background:#ecece6}
    .tw-panel input[type=color]{width:34px;height:28px;border:1px solid #ddd;border-radius:6px;padding:0;background:none}
    .tw-panel textarea{width:100%;box-sizing:border-box;border:1px solid #ddd;border-radius:8px;padding:6px;font:inherit;font-size:12px;min-height:54px}
    .tw-panel .what{font-size:11.5px;color:#444;background:#f6f6f3;border-radius:8px;padding:6px 8px;word-break:break-all}
    .tw-panel .log{font-size:11.5px;color:#444;max-height:140px;overflow:auto;border-top:1px solid #eee;margin-top:10px;padding-top:8px}
    .tw-panel .log div{padding:2px 0;border-bottom:1px dotted #eee}
    .tw-note{position:absolute;z-index:99998;background:#ffd84d;color:#1d1d1f;font:600 11px/1.3 system-ui,sans-serif;padding:4px 7px;border-radius:8px;box-shadow:0 2px 8px rgb(0 0 0/.2);max-width:180px;pointer-events:none}`;
  document.head.append(css);

  const bar = document.createElement('div');
  bar.className = 'tw-bar';
  bar.innerHTML = '<button id="twToggle">✏️ 조정 모드</button><button id="twUndo" title="마지막 변경 되돌리기">↶</button><span id="twCount" style="align-self:center;color:#555"></span>';
  document.body.append(bar);
  const panel = document.createElement('div');
  panel.className = 'tw-panel';
  panel.hidden = true;
  document.body.append(panel);

  // Readable path of an element, used both to re-find it and to tell Claude where it is.
  function pathOf(el) {
    const parts = [];
    for (let e = el; e && e !== document.body && parts.length < 6; e = e.parentElement) {
      let p = e.tagName.toLowerCase();
      if (e.id) { parts.unshift(p + '#' + e.id); break; }
      const cls = [...e.classList].filter(c => !c.startsWith('tw-'))[0];
      if (cls) p += '.' + cls;
      const sib = e.parentElement ? [...e.parentElement.children].filter(x => x.tagName === e.tagName) : [];
      if (sib.length > 1) p += `:nth-of-type(${sib.indexOf(e) + 1})`;
      parts.unshift(p);
    }
    return parts.join(' > ');
  }
  const label = el => (el.innerText || el.getAttribute('aria-label') || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 40);
  const ctx = () => { const p = document.querySelector('.picker button.on'); return p ? p.textContent.trim() : ''; };

  function record(el, kind, detail, value) {
    log.push({ screen: ctx(), where: pathOf(el), text: label(el), kind, detail, value, at: Date.now() });
    save(log);
    count();
    paintLog();
  }
  const count = () => { document.getElementById('twCount').textContent = log.length ? `변경 ${log.length}개` : ''; };

  // Re-applies saved style changes after the page (or a screen switch) re-renders.
  function replay() {
    log.forEach(c => {
      const el = document.querySelector(c.where);
      if (!el) return;
      if (c.kind === 'style') el.style[c.detail] = c.value;
      if (c.kind === 'hide') el.style.display = 'none';
      if (c.kind === 'text' && el.innerText !== c.value) el.innerText = c.value;
    });
    drawNotes();
  }
  function drawNotes() {
    document.querySelectorAll('.tw-note').forEach(n => n.remove());
    log.filter(c => c.kind === 'note').forEach(c => {
      const el = document.querySelector(c.where);
      if (!el || !el.getClientRects().length) return;
      const r = el.getBoundingClientRect();
      const n = document.createElement('div');
      n.className = 'tw-note';
      n.textContent = '📝 ' + c.value;
      n.style.left = (r.left + scrollX) + 'px';
      n.style.top = (r.top + scrollY - 22) + 'px';
      document.body.append(n);
    });
  }

  const px = (el, prop) => parseFloat(getComputedStyle(el)[prop]) || 0;
  const toHex = c => { const m = c.match(/\d+/g); return m ? '#' + m.slice(0, 3).map(x => (+x).toString(16).padStart(2, '0')).join('') : '#000000'; };
  function setStyle(prop, value, detailLabel) {
    sel.style[prop] = value;
    record(sel, 'style', prop, value);
  }

  function paintLog() {
    const box = panel.querySelector('.log');
    if (!box) return;
    box.innerHTML = '<b>변경 기록</b>' + log.slice().reverse().map(c => `<div>${c.screen ? `[${c.screen}] ` : ''}${c.kind === 'note' ? '📝' : c.kind === 'text' ? '✎' : c.kind === 'hide' ? '🙈' : c.kind === 'move' ? '↕' : '🎨'} "${c.text}" ${c.kind === 'style' ? `${c.detail}=${c.value}` : c.kind === 'note' || c.kind === 'text' ? '→ ' + c.value : c.detail || ''}</div>`).join('');
  }

  function openPanel(el) {
    if (sel) sel.classList.remove('tw-sel');
    sel = el;
    sel.classList.add('tw-sel');
    const cs = getComputedStyle(el);
    panel.hidden = false;
    panel.innerHTML = `<h4>선택: ${label(el) || el.tagName}</h4><div class="what">${pathOf(el)}</div>
      <div class="lab">글자</div><div class="row">
        <button data-a="fs-">가−</button><button data-a="fs+">가+</button><button data-a="bold">굵게</button><button data-a="edit">✎ 글 고치기</button></div>
      <div class="lab">색</div><div class="row">
        글자 <input type="color" id="twFg" value="${toHex(cs.color)}"> 배경 <input type="color" id="twBg" value="${toHex(cs.backgroundColor)}"></div>
      <div class="lab">여백 · 모서리</div><div class="row">
        <button data-a="pad-">안쪽 −</button><button data-a="pad+">안쪽 +</button><button data-a="mar-">바깥 −</button><button data-a="mar+">바깥 +</button>
        <button data-a="rad-">둥글기 −</button><button data-a="rad+">둥글기 +</button></div>
      <div class="lab">위치 · 표시</div><div class="row">
        <button data-a="up">▲ 앞으로</button><button data-a="down">▼ 뒤로</button><button data-a="hide">숨기기</button><button data-a="parent">↖ 바깥 상자 선택</button></div>
      <div class="lab">📝 메모 (말로 남기기)</div><textarea id="twNote" placeholder="예: 이 버튼을 더 눈에 띄게, 아이콘을 시계로"></textarea>
      <div class="row" style="margin-top:6px"><button data-a="note">메모 붙이기</button><button data-a="close">닫기</button></div>
      <div class="log"></div>`;
    paintLog();
    panel.querySelector('#twFg').oninput = e => setStyle('color', e.target.value);
    panel.querySelector('#twBg').oninput = e => setStyle('backgroundColor', e.target.value);
  }

  panel.addEventListener('click', e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a || !sel) return;
    const step = (prop, d) => setStyle(prop, Math.max(0, px(sel, prop) + d) + 'px');
    if (a === 'fs-') step('fontSize', -1);
    if (a === 'fs+') step('fontSize', 1);
    if (a === 'bold') setStyle('fontWeight', px(sel, 'fontWeight') >= 700 ? '400' : '800');
    if (a === 'pad-') setStyle('padding', Math.max(0, px(sel, 'paddingTop') - 2) + 'px');
    if (a === 'pad+') setStyle('padding', px(sel, 'paddingTop') + 2 + 'px');
    if (a === 'mar-') setStyle('margin', Math.max(0, px(sel, 'marginTop') - 2) + 'px');
    if (a === 'mar+') setStyle('margin', px(sel, 'marginTop') + 2 + 'px');
    if (a === 'rad-') step('borderRadius', -2);
    if (a === 'rad+') step('borderRadius', 2);
    if (a === 'hide') { sel.style.display = 'none'; record(sel, 'hide', '숨기기'); }
    if (a === 'up' && sel.previousElementSibling) { sel.parentElement.insertBefore(sel, sel.previousElementSibling); record(sel, 'move', '앞으로 이동'); }
    if (a === 'down' && sel.nextElementSibling) { sel.parentElement.insertBefore(sel.nextElementSibling, sel); record(sel, 'move', '뒤로 이동'); }
    if (a === 'parent' && sel.parentElement && sel.parentElement !== document.body) openPanel(sel.parentElement);
    if (a === 'edit') editText(sel);
    if (a === 'note') {
      const v = panel.querySelector('#twNote').value.trim();
      if (v) { record(sel, 'note', '', v); panel.querySelector('#twNote').value = ''; drawNotes(); }
    }
    if (a === 'close') { panel.hidden = true; sel.classList.remove('tw-sel'); sel = null; }
  });

  function editText(el) {
    const before = el.innerText;
    el.contentEditable = 'true';
    el.focus();
    const done = () => {
      el.contentEditable = 'false';
      el.removeEventListener('blur', done);
      if (el.innerText !== before) record(el, 'text', '글 수정', el.innerText.trim());
    };
    el.addEventListener('blur', done);
  }

  const inTool = t => t.closest('.tw-bar, .tw-panel, .picker');
  document.addEventListener('mouseover', e => { if (on && !inTool(e.target)) e.target.classList.add('tw-hover'); }, true);
  document.addEventListener('mouseout', e => e.target.classList?.remove('tw-hover'), true);
  document.addEventListener('click', e => {
    if (!on || inTool(e.target) || e.target.isContentEditable) return;
    e.preventDefault();
    e.stopPropagation();
    e.target.classList.remove('tw-hover');
    openPanel(e.target);
  }, true);
  document.addEventListener('dblclick', e => {
    if (!on || inTool(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    editText(e.target);
  }, true);

  document.getElementById('twToggle').onclick = () => {
    on = !on;
    document.getElementById('twToggle').classList.toggle('on', on);
    document.getElementById('twToggle').textContent = on ? '✏️ 조정 중 (끄기)' : '✏️ 조정 모드';
    if (!on) { panel.hidden = true; if (sel) sel.classList.remove('tw-sel'); sel = null; }
  };
  document.getElementById('twUndo').onclick = () => { log.pop(); save(log); location.reload(); };

  // Screens in the previews are re-rendered by their own pickers; re-apply changes after each switch.
  const ours = n => n.nodeType === 1 && n.classList.contains('tw-note');
  new MutationObserver(ms => {
    if (ms.every(m => [...m.addedNodes, ...m.removedNodes].every(ours))) return; // our own notes
    clearTimeout(window.__twT); window.__twT = setTimeout(replay, 60);
  })
    .observe(document.body, { childList: true, subtree: true });
  count();
  setTimeout(replay, 100);
})();
