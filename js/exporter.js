// Экспорт: календарь телефона (.ics), табель (CSV/текст), резервная копия (JSON).

import * as db from './db.js';
import { addDays, keyOf, MONTHS, fmtDayShort, todayKey, pad, daysInMonth, minutesOf, shiftLength } from './dates.js';
import { dayInfo, docTypeLabel, STATUSES, monthStats, DEFAULT_SETTINGS } from './schedule.js';
import { fmtHours, money } from './ui.js';

// ---------- .ics ----------

const icsEscape = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
const icsDate = (key) => key.replace(/-/g, '');
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

function icsDateTime(key, hhmm) {
  const mins = minutesOf(hhmm);
  return `${icsDate(key)}T${pad(Math.floor(mins / 60))}${pad(mins % 60)}00`;
}

export function buildIcs(state, months = 3) {
  const { settings: s, days, docs } = state;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//smeny//RU',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Смены',
  ];
  const now = stamp();
  const start = todayKey();
  const total = months * 31;
  const len = shiftLength(s.shiftStart, s.shiftEnd);
  const overnight = minutesOf(s.shiftEnd) <= minutesOf(s.shiftStart);

  for (let i = 0; i < total; i++) {
    const key = addDays(start, i);
    const info = dayInfo(key, s, days);
    if (!info.isShift) continue;
    const title = info.status === 'extra' ? 'Замена' : 'Смена';
    const endKey = overnight ? addDays(key, 1) : key;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${key}-shift@smeny`,
      `DTSTAMP:${now}`,
      `DTSTART:${icsDateTime(key, s.shiftStart)}`,
      `DTEND:${icsDateTime(endKey, s.shiftEnd)}`,
      `SUMMARY:${icsEscape(title)}`,
      `DESCRIPTION:${icsEscape(`${title} ${s.shiftStart}–${s.shiftEnd}, ${fmtHours(info.hours ?? len)}${info.note ? `\n${info.note}` : ''}`)}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${icsEscape(`Завтра ${title.toLowerCase()} в ${s.shiftStart}`)}`,
      'TRIGGER:-PT12H',
      'END:VALARM',
      'END:VEVENT',
    );
  }

  for (const doc of docs) {
    if (!doc.expires || doc.expires < start) continue;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${doc.id}-expires@smeny`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${icsDate(doc.expires)}`,
      `DTEND;VALUE=DATE:${icsDate(addDays(doc.expires, 1))}`,
      `SUMMARY:${icsEscape(`Заканчивается: ${doc.title || docTypeLabel(doc.type)}`)}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${icsEscape(`Скоро заканчивается: ${doc.title || docTypeLabel(doc.type)}`)}`,
      `TRIGGER:-P${Math.max(1, s.remindDays)}D`,
      'END:VALARM',
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  return new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/calendar;charset=utf-8' });
}

// ---------- табель ----------

export function monthReportText(y, m, state) {
  const { settings: s, days } = state;
  const st = monthStats(y, m, s, days);
  const out = [`${MONTHS[m]} ${y}`, ''];
  for (const info of st.list) {
    const parts = [fmtDayShort(info.key), '—', STATUSES[info.status].label.toLowerCase()];
    if (info.isShift) parts.push(`(${fmtHours(info.hours)})`);
    if (info.note) parts.push(`· ${info.note}`);
    out.push(parts.join(' '));
  }
  out.push('', `Смен: ${st.shifts} (по графику ${st.work}, замен ${st.extra})`, `Часов: ${fmtHours(st.hours)}`);
  if (st.sick) out.push(`Больничный: ${st.sick} дн.`);
  if (st.vacation) out.push(`Отпуск: ${st.vacation} дн.`);
  if (st.pay) out.push(`Примерно: ${money(st.pay)}`);
  return out.join('\n');
}

export function monthCsv(y, m, state) {
  const { settings: s, days } = state;
  const rows = [['Дата', 'День', 'Статус', 'Часы', 'Заметка']];
  const n = daysInMonth(y, m);
  for (let d = 1; d <= n; d++) {
    const key = keyOf(y, m, d);
    const info = dayInfo(key, s, days);
    if (info.status === 'none') continue;
    rows.push([
      `${pad(d)}.${pad(m + 1)}.${y}`,
      fmtDayShort(key).split(',')[0],
      STATUSES[info.status].label,
      info.isShift ? String(info.hours).replace('.', ',') : '',
      info.note,
    ]);
  }
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  // BOM — чтобы Excel правильно открыл кириллицу
  return new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
}

// ---------- резервная копия ----------

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function dataUrlToBlob(url) {
  const [head, data] = url.split(',');
  const type = (head.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

export async function makeBackup() {
  const [kv, days, docs, files] = await Promise.all([db.entries('kv'), db.entries('days'), db.getAll('docs'), db.getAll('files')]);
  const outFiles = [];
  for (const f of files) {
    outFiles.push({
      ...f,
      blob: undefined,
      thumb: undefined,
      data: await blobToDataUrl(f.blob),
      thumbData: f.thumb ? await blobToDataUrl(f.thumb) : null,
    });
  }
  const payload = { app: 'smeny', version: 1, exportedAt: new Date().toISOString(), settings: kv.settings, days, docs, files: outFiles };
  return new Blob([JSON.stringify(payload)], { type: 'application/json' });
}

export async function restoreBackup(file) {
  const text = await file.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Это не файл резервной копии');
  }
  if (data?.app !== 'smeny') throw new Error('Это не файл резервной копии');
  const files = (data.files || []).map((f) => {
    const { data: d, thumbData, ...rest } = f;
    return { ...rest, blob: dataUrlToBlob(d), thumb: thumbData ? dataUrlToBlob(thumbData) : null };
  });
  await db.clearAll();
  await db.batch(['kv', 'days', 'docs', 'files'], (st) => {
    st.kv.put({ ...DEFAULT_SETTINGS, ...(data.settings || {}) }, 'settings');
    st.kv.put(true, 'seeded');
    Object.entries(data.days || {}).forEach(([k, v]) => st.days.put(v, k));
    (data.docs || []).forEach((d) => st.docs.put(d));
    files.forEach((f) => st.files.put(f));
  });
}

export const backupName = () => {
  const t = todayKey();
  return `smeny-backup-${t}.json`;
};

export const monthFileName = (y, m, ext) => `tabel-${y}-${pad(m + 1)}.${ext}`;
