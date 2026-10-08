// Web push on/off for this device. Firebase is only loaded when the user turns push on.
import { call } from './api.js';
import { store } from './store.js';
import { FIREBASE, VAPID_KEY } from './config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
const get = k => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };

const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

// 'on' | 'off' | 'denied' | 'ios' (iPhone browser tab: needs "홈 화면에 추가" first) | 'unsupported'
export function pushState() {
  if (!FIREBASE) return 'unsupported';
  if (isIOS && !standalone) return 'ios';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return get('pushToken') && Notification.permission === 'granted' ? 'on' : 'off';
}

export const prefs = () => { try { return JSON.parse(get('pushPrefs')) || { msg: true, ann: true, due: true }; } catch { return { msg: true, ann: true, due: true }; } };

async function messaging() {
  const [{ initializeApp }, m] = await Promise.all([import(SDK + 'firebase-app.js'), import(SDK + 'firebase-messaging.js')]);
  return { m, msg: m.getMessaging(initializeApp(FIREBASE)) };
}

// role: 'student' | 'teacher'. Must run from a tap (the browser asks for permission).
export async function enablePush(role, p = prefs()) {
  if (await Notification.requestPermission() !== 'granted') throw new Error('알림이 허용되지 않았어요. 휴대폰 설정에서 이 앱의 알림을 허용해 주세요.');
  const { m, msg } = await messaging();
  const token = await m.getToken(msg, { vapidKey: VAPID_KEY, serviceWorkerRegistration: await navigator.serviceWorker.ready });
  if (role === 'teacher') await call('tPushSub', { pushToken: token, prefs: p });
  else await Promise.all(store.classes().map(c => call('pushSub', { token: c.token, pushToken: token, prefs: p })));
  put('pushToken', token);
  put('pushPrefs', JSON.stringify(p));
}

export async function setPrefs(p) {
  put('pushPrefs', JSON.stringify(p));
  if (get('pushToken')) await Promise.all(store.classes().map(c => call('pushSub', { token: c.token, pushToken: get('pushToken'), prefs: p })));
}

// A class joined while push is on gets notifications too.
export async function registerClass(classToken) {
  if (pushState() !== 'on') return;
  try { await call('pushSub', { token: classToken, pushToken: get('pushToken'), prefs: prefs() }); } catch {}
}
export const pushToken = () => get('pushToken');

export async function disablePush() {
  const token = get('pushToken');
  put('pushToken', null);
  if (!token) return;
  try { await call('pushUnsub', { pushToken: token }); } catch {}
  try { const { m, msg } = await messaging(); await m.deleteToken(msg); } catch {}
}
