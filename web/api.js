import { API_URL } from './config.js';
import { store } from './store.js';

export class ApiError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

// POSTs {action, auth..., payload} as text/plain (no CORS preflight for the GAS web app).
// Network failures and "busy" answers are retried; onRetry(n) lets the UI say so.
export function makeCall({ url, auth, fetchFn = (...a) => fetch(...a), sleep = ms => new Promise(r => setTimeout(r, ms)), retries = 2 }) {
  return async function call(action, payload = {}, { onRetry } = {}) {
    const body = JSON.stringify({ action, ...auth(), ...payload });
    for (let attempt = 0; ; attempt++) {
      let data = null;
      try {
        const res = await fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body });
        data = await res.json();
      } catch {
        data = null;
      }
      if (data && data.ok) return data.data;
      const retryable = !data || data.code === 'busy';
      if (retryable && attempt < retries) {
        if (onRetry) onRetry(attempt + 1);
        await sleep(1500 * (attempt + 1));
        continue;
      }
      if (!data) throw new ApiError('연결이 잠시 끊겼어요. 인터넷을 확인한 뒤 다시 시도해 주세요.', 'offline');
      throw new ApiError(data.error, data.code);
    }
  };
}

const auth = () => (store.key() ? { key: store.key() } : store.token() ? { token: store.token() } : {});
const raw = makeCall({ url: API_URL, auth });

// While any request is in flight (after a short grace period) the page shows a top progress bar
// and a "동기화 중" chip, so a slow server never looks like a frozen screen.
let pending = 0;
let timer;
function busy(d) {
  pending += d;
  clearTimeout(timer);
  if (pending > 0) timer = setTimeout(() => document.body.classList.add('syncing'), 150);
  else document.body.classList.remove('syncing');
}
export async function call(...args) {
  busy(1);
  try { return await raw(...args); } finally { busy(-1); }
}
