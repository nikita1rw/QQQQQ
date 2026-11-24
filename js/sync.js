// Общий график: в облако уходят только смены (статус, дневная/ночная, часы).
// Заметки, деньги и документы остаются на телефоне.

import { SYNC } from './config.js';
import * as db from './db.js';

export const syncConfigured = () => Boolean(SYNC.url && SYNC.key);

const SCHEDULE_KEYS = ['startDate', 'workDays', 'offDays', 'dayStart', 'dayEnd', 'nightStart', 'nightEnd'];
export const isScheduleSetting = (patch) => Object.keys(patch).some((k) => SCHEDULE_KEYS.includes(k));

function b64url(bytes) {
  let s = '';
  bytes.forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const randomToken = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));

async function rpc(fn, args) {
  const headers = { 'Content-Type': 'application/json', apikey: SYNC.key };
  if (SYNC.key.startsWith('eyJ')) headers.Authorization = `Bearer ${SYNC.key}`; // старый anon-ключ
  let res;
  try {
    res = await fetch(`${SYNC.url.replace(/\/+$/, '')}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(args),
      cache: 'no-store',
    });
  } catch {
    const e = new Error('Нет интернета');
    e.offline = true;
    throw e;
  }
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* не JSON */ }
  if (!res.ok) throw new Error((body && body.message) || `Ошибка сервера (${res.status})`);
  return body;
}

/** Что видит второй человек: только график */
export function publicPayload(state, name) {
  const settings = {};
  SCHEDULE_KEYS.forEach((k) => { settings[k] = state.settings[k]; });
  const days = {};
  Object.entries(state.days).forEach(([k, v]) => {
    const o = {};
    if (v.status) o.status = v.status;
    if (v.kind) o.kind = v.kind;
    if (v.hours != null) o.hours = v.hours;
    if (Object.keys(o).length) days[k] = o;
  });
  return { v: 1, name: name || '', settings, days };
}

export const shareLink = (id) => `${location.origin}${location.pathname}#view=${id}`;

export function parseViewId(text) {
  const s = String(text || '').trim();
  const m = s.match(/view=([A-Za-z0-9_-]{16,64})/) || s.match(/^([A-Za-z0-9_-]{16,64})$/);
  return m ? m[1] : null;
}

// ---------- владелец графика ----------

let share = null; // { id, key, name, enabled, dirty, lastSync, error }
let appState = null;
let timer = null;
let chain = Promise.resolve();
const listeners = new Set();

export const currentShare = () => share;
export const onShareChange = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

async function save() {
  if (share) await db.put('kv', share, 'share');
  listeners.forEach((fn) => fn(share));
}

async function doPush() {
  if (!share?.enabled || !syncConfigured()) return;
  try {
    await rpc('put_schedule', { p_id: share.id, p_key: share.key, p_data: publicPayload(appState, share.name) });
    share.dirty = false;
    share.lastSync = Date.now();
    share.error = '';
  } catch (e) {
    share.error = e.offline ? 'offline' : e.message;
  }
  await save();
}

function schedulePush(ms) {
  clearTimeout(timer);
  timer = setTimeout(() => { chain = chain.then(doPush); }, ms);
}

export async function pushNow() {
  clearTimeout(timer);
  chain = chain.then(doPush);
  await chain;
  return share;
}

/** Вызывать при запуске и после восстановления копии */
export async function initShare(state) {
  appState = state;
  share = (await db.get('kv', 'share')) || null;
  if (share?.enabled && share.dirty) schedulePush(500);
}

/** Что-то в графике поменялось */
export function queueSync() {
  if (!share?.enabled) return;
  share.dirty = true;
  save();
  schedulePush(1200);
}

export async function enableShare(name) {
  share = { id: randomToken(16), key: randomToken(24), name: name || '', enabled: true, dirty: true, lastSync: null, error: '' };
  await save();
  return pushNow();
}

export async function setShareName(name) {
  if (!share) return;
  share.name = name;
  queueSync();
}

export async function disableShare() {
  if (!share) return true;
  const old = share;
  try {
    await rpc('delete_schedule', { p_id: old.id, p_key: old.key });
  } catch (e) {
    if (e.offline) throw e; // без интернета ссылка продолжит работать — не делаем вид, что закрыли
  }
  share = null;
  await db.del('kv', 'share');
  listeners.forEach((fn) => fn(null));
  return true;
}

window.addEventListener('online', () => {
  if (share?.enabled && share.dirty) schedulePush(300);
});

// ---------- просмотр чужого графика ----------

/** null — графика нет (доступ закрыт или ссылка неверная) */
export const fetchShared = (id) => rpc('get_schedule', { p_id: id });
