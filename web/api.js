import { CLIENT_ID, SCRIPT_ID, SCOPES } from './config.js';

let token = null;
let expires = 0;
let client = null;
let pending = null;

// Google Identity Services token flow. The first call must come from a click (popup).
export function getToken(force = false) {
  if (!force && token && Date.now() < expires) return Promise.resolve(token);
  if (!window.google?.accounts?.oauth2) return Promise.reject(new Error('로그인 준비 중이에요. 잠시 후 다시 눌러 주세요.'));
  client ??= google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: r => {
      if (r.error) return pending.reject(new Error(r.error));
      token = r.access_token;
      expires = Date.now() + (r.expires_in - 60) * 1000;
      pending.resolve(token);
    },
    error_callback: e => pending.reject(new Error(e.type === 'popup_closed' ? '로그인 창이 닫혔어요.' : e.type)),
  });
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
    client.requestAccessToken(token ? { prompt: '' } : {});
  });
}

export function makeRunner({ scriptId, getToken, fetchFn = (...a) => fetch(...a) }) {
  const url = `https://script.googleapis.com/v1/scripts/${scriptId}:run`;
  const call = async (body, force) => fetchFn(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await getToken(force)}`, 'Content-Type': 'application/json' },
    body,
  });
  return async function run(fn, ...parameters) {
    const body = JSON.stringify({ function: fn, parameters });
    let res = await call(body, false);
    if (res.status === 401) res = await call(body, true);
    const data = await res.json();
    if (data.error) {
      const d = (data.error.details || [])[0];
      throw new Error((d && d.errorMessage) || data.error.message);
    }
    return data.response && data.response.result;
  };
}

export const run = makeRunner({ scriptId: SCRIPT_ID, getToken });
