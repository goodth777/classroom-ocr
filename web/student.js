import { run } from './api.js';
import { render, loading, $ } from './ui.js';
import { esc, stateLabel, DONE } from './lib.js';

let cards = [];

const loadDraft = k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const saveDraft = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const clearDraft = k => { try { localStorage.removeItem(k); } catch {} };

export async function studentHome() {
  loading();
  cards = await run('listMyAssignments');
  if (!cards.length) {
    return render('<section class="center"><div class="card hero"><p class="muted">아직 받은 과제가 없어요.</p></div></section>');
  }
  render(`<header class="bar"><h1>내 과제</h1></header>
    <section class="cards">${cards.map(c => `
      <a class="card task ${DONE.has(c.state) ? 'done' : ''}" href="#/a/${c.courseId}/${c.workId}">
        <span class="chip">${esc(c.courseName)}</span>
        <h2>${esc(c.title)}</h2>
        <span class="state">${stateLabel(c)}</span>
      </a>`).join('')}
    </section>`);
}

// Shrinks the photo so the upload stays small; 2000px matched the OCR test images.
async function resizeImage(file, max = 2000) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * k);
  cv.height = Math.round(bmp.height * k);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  const url = cv.toDataURL('image/jpeg', 0.85);
  return { url, base64: url.split(',')[1] };
}

export async function studentEditor(courseId, workId) {
  if (!cards.length) { loading(); cards = await run('listMyAssignments'); }
  const c = cards.find(x => x.courseId === courseId && x.workId === workId);
  if (!c) throw new Error('과제를 찾을 수 없어요.');
  const key = `draft:${courseId}:${workId}`;
  const photos = [];

  render(`<header class="bar"><a href="#/" class="back" aria-label="뒤로">‹</a><h1>${esc(c.title)}</h1></header>
    ${c.description ? `<p class="card muted">${esc(c.description)}</p>` : ''}
    <label class="card capture">
      <input type="file" accept="image/*" capture="environment" id="photo" hidden>
      <img id="preview" alt="촬영한 사진" hidden>
      <span id="capLabel">📷 손글씨 촬영</span>
    </label>
    <textarea id="text" class="editor" placeholder="직접 입력하거나 촬영하세요" aria-label="제출할 내용">${esc(loadDraft(key))}</textarea>
    <button id="submit" class="primary wide">${DONE.has(c.state) ? '다시 제출' : '제출'}</button>`);

  const text = $('#text');
  text.oninput = () => saveDraft(key, text.value);

  $('#photo').onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    const label = $('#capLabel');
    try {
      const { url, base64 } = await resizeImage(file);
      $('#preview').src = url;
      $('#preview').hidden = false;
      photos.push(base64);
      label.textContent = '글자 읽는 중…';
      try {
        const t = await run('ocr', base64, 'image/jpeg');
        text.value = text.value.trim() ? `${text.value}\n\n${t}` : t;
        saveDraft(key, text.value);
        label.textContent = '📷 한 장 더 촬영';
      } catch {
        label.textContent = '읽지 못했어요. 다시 촬영하거나 직접 입력하세요';
      }
    } catch {
      label.textContent = '읽지 못했어요. 다시 촬영하거나 직접 입력하세요';
    } finally {
      e.target.value = '';
    }
  };

  $('#submit').onclick = async () => {
    const body = text.value.trim();
    if (!body) return text.focus();
    const btn = $('#submit');
    btn.disabled = true;
    btn.textContent = '제출 중…';
    try {
      await run('submit', courseId, workId, c.title, body, photos);
      clearDraft(key);
      location.hash = '#/';
    } catch (err) {
      btn.disabled = false;
      btn.textContent = '제출';
      alert(err.message);
    }
  };
}
