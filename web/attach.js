// Teacher attachments: a file goes up once to the teacher's Drive (shared by link) and comes back as
// {id, name, mime, size}; students then load it straight from Google.
import { call } from './api.js';

export const MAX_FILE = 10 * 1024 * 1024;
export const MAX_FILES = 5;

const base64 = file => new Promise((ok, no) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(',')[1] || '');
  r.onerror = () => no(new Error('파일을 읽지 못했어요.'));
  r.readAsDataURL(file);
});

export async function uploadFile(file) {
  if (file.size > MAX_FILE) throw new Error(`"${file.name}"은(는) 10MB를 넘어요.`);
  return call('upload', { name: file.name, mime: file.type || 'application/octet-stream', data: await base64(file) });
}

// Small editable chips for the teacher's editors.
export const chipsHtml = (list, key) => (list || []).map((a, i) =>
  `<span class="att-chip">${a.mime && a.mime.startsWith('image/') ? '🖼️' : '📄'} ${a.name.replace(/[<>&"]/g, '')}<button type="button" data-unattach="${key}:${i}" aria-label="첨부 빼기">✕</button></span>`).join('');
