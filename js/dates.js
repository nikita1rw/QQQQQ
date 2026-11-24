// Даты храним строками 'YYYY-MM-DD' в местном времени — так нет сдвигов из-за часовых поясов.

export const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
export const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
export const WD_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
export const WD_LONG = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];

const DAY = 86400000;

export const pad = (n) => String(n).padStart(2, '0');
export const keyOf = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;

export function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return { y, m: m - 1, d };
}

export function todayKey() {
  const t = new Date();
  return keyOf(t.getFullYear(), t.getMonth(), t.getDate());
}

export function dayNum(key) {
  const { y, m, d } = parseKey(key);
  return Date.UTC(y, m, d) / DAY;
}

export function fromDayNum(n) {
  const dt = new Date(n * DAY);
  return keyOf(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
}

export const addDays = (key, n) => fromDayNum(dayNum(key) + n);
export const diffDays = (a, b) => dayNum(b) - dayNum(a);
export const daysInMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/** День недели, понедельник = 0 */
export function weekday(key) {
  return (new Date(dayNum(key) * DAY).getUTCDay() + 6) % 7;
}

export function shiftMonth(y, m, delta) {
  const t = y * 12 + m + delta;
  return { y: Math.floor(t / 12), m: ((t % 12) + 12) % 12 };
}

export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

/** «27 ноября» (+ год, если не текущий) */
export function fmtDay(key, withYear = false) {
  const { y, m, d } = parseKey(key);
  const showYear = withYear || y !== new Date().getFullYear();
  return `${d} ${MONTHS_GEN[m]}${showYear ? ` ${y}` : ''}`;
}

/** «пятница, 27 ноября» */
export function fmtDayLong(key) {
  return `${WD_LONG[weekday(key)]}, ${fmtDay(key)}`;
}

/** «пт, 27 ноября» */
export function fmtDayShort(key) {
  return `${WD_SHORT[weekday(key)].toLowerCase()}, ${fmtDay(key)}`;
}

/** «27.11.2026» */
export function fmtNumeric(key) {
  const { y, m, d } = parseKey(key);
  return `${pad(d)}.${pad(m + 1)}.${y}`;
}

export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** «сегодня», «завтра», «через 3 дня» */
export function relDays(n) {
  if (n === 0) return 'сегодня';
  if (n === 1) return 'завтра';
  if (n === 2) return 'послезавтра';
  if (n > 0) return `через ${n} ${plural(n, 'день', 'дня', 'дней')}`;
  const a = -n;
  if (a === 1) return 'вчера';
  return `${a} ${plural(a, 'день', 'дня', 'дней')} назад`;
}

/** Минуты от полуночи из 'HH:MM' */
export function minutesOf(hhmm) {
  const [h, m] = String(hhmm || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Длительность смены в часах; если конец раньше начала — смена через полночь; равны — сутки. */
export function shiftLength(start, end) {
  const diff = (minutesOf(end) - minutesOf(start) + 1440) % 1440;
  return diff === 0 ? 24 : diff / 60;
}
