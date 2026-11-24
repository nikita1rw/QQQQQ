import { dayNum, daysInMonth, keyOf, addDays, diffDays, shiftLength, todayKey } from './dates.js';

export const DEFAULT_SETTINGS = {
  startDate: '2026-10-22', // первый рабочий день
  workDays: 3,
  offDays: 3,
  dayStart: '09:00', // дневная смена
  dayEnd: '00:00', // 00:00 — до полуночи
  nightStart: '23:00', // ночная смена
  nightEnd: '08:00',
  pattern: ['day', 'day', 'day'], // какая смена в каждый рабочий день цикла
  payType: 'shift', // 'shift' — за смену, 'hour' — за час
  payRate: 0,
  payExtraRate: 0, // 0 — как обычная смена
  remindDays: 30, // за сколько дней предупреждать об окончании документов
};

// Замены, которые уже были в исходном графике
export const SEED_DAYS = {
  '2026-10-25': { status: 'extra' },
  '2026-10-27': { status: 'extra' },
};

export const STATUSES = {
  work: { label: 'Смена', legend: 'работа' },
  extra: { label: 'Замена / вызов', legend: 'замена' },
  off: { label: 'Выходной', legend: 'выходной' },
  sick: { label: 'Больничный', legend: 'больничный' },
  vacation: { label: 'Отпуск', legend: 'отпуск' },
  none: { label: 'До начала работы', legend: '' },
};

export const KINDS = {
  day: { label: 'Дневная', short: 'день' },
  night: { label: 'Ночная', short: 'ночь' },
};

/** Время смены: { start, end } */
export const shiftTimes = (kind, s) =>
  kind === 'night' ? { start: s.nightStart, end: s.nightEnd } : { start: s.dayStart, end: s.dayEnd };

export const hoursFor = (kind, s) => {
  const t = shiftTimes(kind, s);
  return shiftLength(t.start, t.end);
};

/** '09:00' → '9:00'; конец смены '00:00' → '24:00' */
export function fmtTime(hhmm, isEnd = false) {
  const [h, m] = String(hhmm || '0:00').split(':');
  const hour = Number(h);
  return `${isEnd && hour === 0 && Number(m) === 0 ? 24 : hour}:${m}`;
}

export const fmtRange = (kind, s) => {
  const t = shiftTimes(kind, s);
  return `${fmtTime(t.start)}–${fmtTime(t.end, true)}`;
};

function cyclePos(key, s) {
  const diff = dayNum(key) - dayNum(s.startDate);
  if (diff < 0) return -1;
  const cycle = Math.max(1, s.workDays + s.offDays);
  return diff % cycle;
}

export function baseStatus(key, s) {
  const pos = cyclePos(key, s);
  if (pos < 0) return 'none';
  return pos < s.workDays ? 'work' : 'off';
}

/** Какая смена по графику в этот день (для замен — дневная) */
export function baseKind(key, s) {
  const pos = cyclePos(key, s);
  if (pos >= 0 && pos < s.workDays) return (s.pattern || [])[pos] === 'night' ? 'night' : 'day';
  return 'day';
}

export function dayInfo(key, s, days) {
  const base = baseStatus(key, s);
  const rec = days[key] || {};
  const status = rec.status || base;
  const isShift = status === 'work' || status === 'extra';
  const kind = isShift ? rec.kind || baseKind(key, s) : null;
  const hours = isShift ? (rec.hours ?? hoursFor(kind, s)) : 0;
  return {
    key,
    base,
    status,
    isShift,
    kind,
    hours,
    note: rec.note || '',
    changed: !!rec.status && rec.status !== base,
  };
}

/** Старые настройки (одно время смены) → новые */
export function migrateSettings(saved) {
  const s = { ...DEFAULT_SETTINGS, ...(saved || {}) };
  if (saved && saved.shiftStart && !saved.dayStart) {
    const oldDefault = saved.shiftStart === '08:00' && saved.shiftEnd === '20:00';
    if (!oldDefault) {
      s.dayStart = saved.shiftStart;
      s.dayEnd = saved.shiftEnd;
    }
  }
  delete s.shiftStart;
  delete s.shiftEnd;
  const pattern = Array.isArray(s.pattern) ? s.pattern : [];
  s.pattern = Array.from({ length: s.workDays }, (_, i) => (pattern[i] === 'night' ? 'night' : 'day'));
  return s;
}

export function payFor(info, s) {
  if (!info.isShift) return 0;
  const rate = info.status === 'extra' && s.payExtraRate ? s.payExtraRate : s.payRate;
  if (!rate) return 0;
  return s.payType === 'hour' ? rate * info.hours : rate;
}

export function monthStats(y, m, s, days) {
  const st = { work: 0, extra: 0, shifts: 0, night: 0, hours: 0, sick: 0, vacation: 0, pay: 0, list: [] };
  const n = daysInMonth(y, m);
  for (let d = 1; d <= n; d++) {
    const info = dayInfo(keyOf(y, m, d), s, days);
    if (info.status === 'work') st.work++;
    if (info.status === 'extra') st.extra++;
    if (info.status === 'sick') st.sick++;
    if (info.status === 'vacation') st.vacation++;
    if (info.isShift) {
      st.shifts++;
      if (info.kind === 'night') st.night++;
      st.hours += info.hours;
      st.pay += payFor(info, s);
    }
    if (info.isShift || info.changed || info.note) st.list.push(info);
  }
  return st;
}

/** Ближайший день, где выполняется условие, начиная с from (включительно) */
export function findNext(from, s, days, pred, limit = 400) {
  for (let i = 0; i <= limit; i++) {
    const key = addDays(from, i);
    const info = dayInfo(key, s, days);
    if (pred(info)) return info;
  }
  return null;
}

/** Сколько смен подряд начиная с key */
export function runLength(key, s, days, pred) {
  let n = 0;
  while (n < 60 && pred(dayInfo(addDays(key, n), s, days))) n++;
  return n;
}

// ---------- документы ----------

export const DOC_TYPES = [
  { id: 'passport', label: 'Паспорт' },
  { id: 'snils', label: 'СНИЛС' },
  { id: 'inn', label: 'ИНН' },
  { id: 'oms', label: 'Полис ОМС' },
  { id: 'medbook', label: 'Медкнижка', expires: true },
  { id: 'license', label: 'Удостоверение', expires: true },
  { id: 'permit', label: 'Допуск', expires: true },
  { id: 'cert', label: 'Сертификат', expires: true },
  { id: 'contract', label: 'Трудовой договор' },
  { id: 'other', label: 'Другое' },
];

export const docTypeLabel = (id) => (DOC_TYPES.find((t) => t.id === id) || DOC_TYPES[DOC_TYPES.length - 1]).label;

/** { level: 'expired' | 'soon' | 'ok' | 'none', days } */
export function docExpiry(doc, s, today = todayKey()) {
  if (!doc.expires) return { level: 'none', days: null };
  const days = diffDays(today, doc.expires);
  if (days < 0) return { level: 'expired', days };
  if (days <= s.remindDays) return { level: 'soon', days };
  return { level: 'ok', days };
}
