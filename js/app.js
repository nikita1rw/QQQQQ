// Главный файл: состояние, вкладки «График», «Итоги», «Настройки».

import * as db from './db.js';
import {
  MONTHS, WD_SHORT, keyOf, parseKey, todayKey, daysInMonth, weekday, shiftMonth, plural,
  fmtDay, fmtDayLong, fmtDayShort, cap, relDays, diffDays, addDays,
} from './dates.js';
import {
  DEFAULT_SETTINGS, SEED_DAYS, STATUSES, KINDS, dayInfo, baseStatus, baseKind, monthStats, findNext, runLength,
  hoursFor, fmtRange, migrateSettings,
} from './schedule.js';
import { esc, icon, openSheet, confirmSheet, toast, saveFile, money, fmtHours, copyText } from './ui.js';
import { renderDocs, docAlerts, alertText, openDoc } from './docs.js';
import { buildIcs, monthReportText, monthCsv, makeBackup, restoreBackup, backupName, monthFileName } from './exporter.js';

const APP_VERSION = '1.1';

const state = {
  settings: { ...DEFAULT_SETTINGS },
  days: {},
  docs: [],
  tab: 'grafik',
  cal: null, // { y, m } — открытый месяц в календаре
  stat: null, // { y, m } — открытый месяц в итогах
};

const view = document.getElementById('view');

// ---------- данные ----------

async function load() {
  const seeded = await db.get('kv', 'seeded');
  if (!seeded) {
    await db.batch(['kv', 'days'], (st) => {
      st.kv.put({ ...DEFAULT_SETTINGS }, 'settings');
      Object.entries(SEED_DAYS).forEach(([k, v]) => st.days.put(v, k));
      st.kv.put(true, 'seeded');
    });
  }
  const [settings, days, docs] = await Promise.all([db.get('kv', 'settings'), db.entries('days'), db.getAll('docs')]);
  state.settings = migrateSettings(settings);
  if (settings && 'shiftStart' in settings) await db.put('kv', state.settings, 'settings');
  state.days = days || {};
  state.docs = docs || [];
}

async function saveSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  await db.put('kv', state.settings, 'settings');
}

async function saveDay(key, rec) {
  const clean = {};
  if (rec.status) clean.status = rec.status;
  if (rec.kind) clean.kind = rec.kind;
  if (rec.hours != null && rec.hours !== '') clean.hours = rec.hours;
  if (rec.note) clean.note = rec.note;
  if (Object.keys(clean).length) {
    state.days[key] = clean;
    await db.put('days', clean, key);
  } else {
    delete state.days[key];
    await db.del('days', key);
  }
}

const ctx = {
  reload: async () => {
    await load();
    render();
  },
  rerender: () => render(),
};

// ---------- навигация ----------

const TABS = ['grafik', 'docs', 'itogi', 'nastroiki'];

function setTab(tab, push = true) {
  if (!TABS.includes(tab)) tab = 'grafik';
  state.tab = tab;
  if (push && location.hash !== `#${tab}`) history.replaceState(null, '', `#${tab}`);
  render();
  window.scrollTo(0, 0);
}

document.querySelectorAll('.tabbar [data-tab]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
window.addEventListener('hashchange', () => setTab(location.hash.slice(1), false));

function render() {
  document.querySelectorAll('.tabbar [data-tab]').forEach((b) => {
    const on = b.dataset.tab === state.tab;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  const alerts = docAlerts(state.docs, state.settings);
  const badge = document.querySelector('.tabbar [data-tab="docs"] .badge');
  badge.hidden = !alerts.length;
  badge.textContent = alerts.length;

  if (state.tab === 'grafik') renderSchedule();
  else if (state.tab === 'docs') renderDocs(view, state, ctx);
  else if (state.tab === 'itogi') renderStats();
  else renderSettings();
}

// ---------- График ----------

function cycleText(s) {
  return `смены ${s.workDays} / ${s.offDays} · с ${fmtDay(s.startDate)}`;
}

function todayCard() {
  const s = state.settings;
  const t = todayKey();
  const info = dayInfo(t, s, state.days);
  let big;
  let line;
  let tone = info.status;

  if (info.status === 'none') {
    const days = diffDays(t, s.startDate);
    big = 'Скоро на работу';
    line = `Первая смена — ${fmtDayShort(s.startDate)}, ${relDays(days)}`;
  } else if (info.isShift) {
    const left = runLength(addDays(t, 1), s, state.days, (d) => d.isShift);
    const night = info.kind === 'night';
    big = info.status === 'extra' ? `Замена${night ? ', ночная' : ''}` : night ? 'Ночная смена' : 'Смена';
    if (night && info.status !== 'extra') tone = 'night';
    const nextOff = findNext(addDays(t, 1), s, state.days, (d) => !d.isShift);
    line = `${fmtRange(info.kind, s)} · ${left ? `ещё ${left} ${plural(left, 'смена', 'смены', 'смен')} подряд` : 'последняя перед выходными'}`;
    if (nextOff && left) line += `, выходные с ${fmtDayShort(nextOff.key)}`;
  } else {
    const next = findNext(addDays(t, 1), s, state.days, (d) => d.isShift);
    big = info.status === 'sick' ? 'Больничный' : info.status === 'vacation' ? 'Отпуск' : 'Выходной';
    if (info.status === 'sick' || info.status === 'vacation') tone = info.status;
    line = next
      ? `Следующая ${next.kind === 'night' ? 'смена (ночная)' : 'смена'} — ${fmtDayShort(next.key)}, ${relDays(diffDays(t, next.key))}`
      : '';
  }

  return `
    <section class="today card tone-${tone}">
      <p class="today-date">Сегодня · ${fmtDayLong(t)}</p>
      <p class="today-big">${esc(big)}</p>
      ${line ? `<p class="today-line">${esc(line)}</p>` : ''}
      ${info.note ? `<p class="today-note">${icon('note', 'ico-sm')}<span>${esc(info.note)}</span></p>` : ''}
    </section>`;
}

function monthCard(y, m) {
  const s = state.settings;
  const st = monthStats(y, m, s, state.days);
  const first = keyOf(y, m, 1);
  const lead = weekday(first);
  const n = daysInMonth(y, m);
  const t = todayKey();
  const isCurrent = parseKey(t).y === y && parseKey(t).m === m;

  let cells = '';
  for (let i = 0; i < lead; i++) cells += '<span class="cell cell-empty" aria-hidden="true"></span>';
  for (let d = 1; d <= n; d++) {
    const key = keyOf(y, m, d);
    const info = dayInfo(key, s, state.days);
    const cls = [
      'cell',
      `st-${info.status}`,
      key === t ? 'is-today' : '',
      info.status === 'off' && info.base === 'work' ? 'was-work' : '',
      info.note ? 'has-note' : '',
    ].filter(Boolean).join(' ');
    const night = info.kind === 'night';
    const label = `${fmtDayLong(key)}: ${STATUSES[info.status].label.toLowerCase()}${night ? ', ночная' : ''}${info.note ? ', есть заметка' : ''}`;
    cells += `<button class="${cls}" data-day="${key}" aria-label="${esc(label)}">${d}${night ? icon('moon', 'moon') : ''}</button>`;
  }

  return `
    <section class="month card" aria-label="${MONTHS[m]} ${y}">
      <div class="month-head">
        <button class="icon-btn" id="prev" aria-label="Предыдущий месяц">${icon('left')}</button>
        <h2>${MONTHS[m]} ${y}</h2>
        <span class="pill">${st.shifts} ${plural(st.shifts, 'смена', 'смены', 'смен')}</span>
        <button class="icon-btn" id="next" aria-label="Следующий месяц">${icon('right')}</button>
      </div>
      <div class="wd">${WD_SHORT.map((w, i) => `<span class="${i > 4 ? 'we' : ''}">${w}</span>`).join('')}</div>
      <div class="grid" id="grid">${cells}</div>
      ${isCurrent ? '' : `<button class="link-btn today-btn" id="to-today">Вернуться к сегодня</button>`}
    </section>
    <div class="month-sum">
      <div><b>${st.work}</b><span>по графику</span></div>
      <div><b>${st.extra}</b><span>${plural(st.extra, 'замена', 'замены', 'замен')}</span></div>
      ${st.night ? `<div><b>${st.night}</b><span>${plural(st.night, 'ночная', 'ночные', 'ночных')}</span></div>` : ''}
      <div><b>${fmtHours(st.hours)}</b><span>часов</span></div>
      ${st.pay ? `<div><b>${money(st.pay)}</b><span>примерно</span></div>` : ''}
    </div>`;
}

function renderSchedule() {
  const s = state.settings;
  if (!state.cal) {
    const t = parseKey(todayKey());
    state.cal = { y: t.y, m: t.m };
  }
  const { y, m } = state.cal;
  const alerts = docAlerts(state.docs, s);

  view.innerHTML = `
    <header class="top">
      <div>
        <p class="eyebrow">${esc(cycleText(s))}</p>
        <h1>График работы</h1>
      </div>
    </header>
    ${todayCard()}
    ${alerts.length ? `<button class="alert alert-${alerts[0].e.level}" id="doc-alert">
        ${icon('alert')}<span>${esc(alertText(alerts[0]))}${alerts.length > 1 ? ` и ещё ${alerts.length - 1}` : ''}</span>${icon('right', 'ico-sm')}
      </button>` : ''}
    <div id="month-wrap">${monthCard(y, m)}</div>
    <div class="legend">
      <span><i class="dot st-work"></i>работа</span>
      <span><i class="dot st-extra"></i>замена</span>
      <span><i class="dot st-off"></i>выходной</span>
      <span>${icon('moon', 'legend-moon')}ночная</span>
      <span><i class="dot st-sick"></i>больничный</span>
      <span><i class="dot st-vacation"></i>отпуск</span>
    </div>
    <p class="tip">Нажми на день, чтобы отметить замену, вызов, больничный или добавить заметку.</p>
  `;

  const go = (d) => {
    state.cal = shiftMonth(state.cal.y, state.cal.m, d);
    document.getElementById('month-wrap').innerHTML = monthCard(state.cal.y, state.cal.m);
    bindMonth();
  };

  function bindMonth() {
    view.querySelector('#prev').addEventListener('click', () => go(-1));
    view.querySelector('#next').addEventListener('click', () => go(1));
    view.querySelector('#to-today')?.addEventListener('click', () => {
      const t = parseKey(todayKey());
      state.cal = { y: t.y, m: t.m };
      go(0);
    });
    const grid = view.querySelector('#grid');
    grid.addEventListener('click', (e) => {
      const b = e.target.closest('[data-day]');
      if (b) openDay(b.dataset.day);
    });
    let x0 = null;
    let y0 = null;
    grid.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
    grid.addEventListener('touchend', (e) => {
      if (x0 == null) return;
      const dx = e.changedTouches[0].clientX - x0;
      const dy = e.changedTouches[0].clientY - y0;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
      x0 = null;
    });
  }

  bindMonth();
  view.querySelector('#doc-alert')?.addEventListener('click', () => {
    const doc = alerts[0].doc;
    if (alerts.length > 1) setTab('docs');
    else openDoc(doc, state, ctx);
  });
}

function openDay(key) {
  const s = state.settings;
  const info = dayInfo(key, s, state.days);
  const rec = { ...(state.days[key] || {}) };
  const base = baseStatus(key, s);
  const baseLabel = base === 'none' ? 'до начала работы' : base === 'work' ? 'смена' : 'выходной';

  const options = [
    { id: '', label: 'По графику', sub: baseLabel, tone: base },
    { id: 'extra', label: 'Замена / вызов', sub: 'вышла в свой выходной', tone: 'extra' },
    { id: 'off', label: 'Выходной', sub: base === 'work' ? 'смену отменили / поменялась' : 'не работала', tone: 'off' },
    { id: 'sick', label: 'Больничный', sub: '', tone: 'sick' },
    { id: 'vacation', label: 'Отпуск', sub: '', tone: 'vacation' },
  ];
  // «Выходной» в выходной день по графику — то же, что «по графику»
  const current = rec.status && rec.status !== base ? rec.status : '';
  const defKind = baseKind(key, s);
  const curKind = rec.kind || defKind;
  let persist = async () => {};

  openSheet(
    `<div class="sheet-grab" aria-hidden="true"></div>
     <h3 class="sheet-title">${cap(fmtDayLong(key))}</h3>
     <p class="muted">По графику: ${baseLabel}</p>
     <fieldset class="opts">
       <legend class="sr-only">Что в этот день</legend>
       ${options.filter((o) => !(o.id === 'off' && base !== 'work') || current === 'off').map((o) => `
         <label class="opt">
           <input type="radio" name="st" value="${o.id}" ${o.id === current ? 'checked' : ''}>
           <i class="dot st-${o.tone}"></i>
           <span class="opt-text"><b>${o.label}</b>${o.sub ? `<small>${o.sub}</small>` : ''}</span>
         </label>`).join('')}
     </fieldset>
     <div class="seg seg-kind" id="kind-field" role="radiogroup" aria-label="Какая смена" ${info.isShift ? '' : 'hidden'}>
       ${['day', 'night'].map((k) => `
         <label><input type="radio" name="kind" value="${k}" ${k === curKind ? 'checked' : ''}>
           <span>${k === 'night' ? icon('moon', 'ico-sm') : icon('sun', 'ico-sm')} ${KINDS[k].label}<small>${fmtRange(k, s)}</small></span>
         </label>`).join('')}
     </div>
     <label class="field" id="hours-field" ${info.isShift ? '' : 'hidden'}>
       <span>Часов в этот день</span>
       <input type="number" name="hours" inputmode="decimal" min="0" max="24" step="0.5" value="${rec.hours ?? ''}" placeholder="${hoursFor(curKind, s)}">
     </label>
     <label class="field">
       <span>Заметка</span>
       <textarea name="note" rows="2" placeholder="Кто сменщик, что взять с собой…">${esc(rec.note || '')}</textarea>
     </label>
     <button class="btn btn-primary btn-block" data-close>Готово</button>`,
    {
      label: fmtDayLong(key),
      onMount: (dlg) => {
        const hoursField = dlg.querySelector('#hours-field');
        const kindField = dlg.querySelector('#kind-field');
        const hoursIn = dlg.querySelector('input[name="hours"]');
        persist = async () => {
          const st = dlg.querySelector('input[name="st"]:checked')?.value || '';
          const kind = dlg.querySelector('input[name="kind"]:checked')?.value || defKind;
          const defHours = hoursFor(kind, s);
          hoursIn.placeholder = defHours;
          const hoursRaw = hoursIn.value;
          const hours = hoursRaw === '' ? null : Math.max(0, Math.min(24, Number(hoursRaw.replace(',', '.'))));
          const effective = st || base;
          const isShift = effective === 'work' || effective === 'extra';
          hoursField.hidden = !isShift;
          kindField.hidden = !isShift;
          await saveDay(key, {
            status: st,
            kind: isShift && kind !== defKind ? kind : null,
            hours: isShift && hours != null && !Number.isNaN(hours) && hours !== defHours ? hours : null,
            note: dlg.querySelector('textarea[name="note"]').value.trim(),
          });
        };
        dlg.querySelectorAll('input[name="st"], input[name="kind"]').forEach((r) => r.addEventListener('change', persist));
        dlg.querySelector('input[name="hours"]').addEventListener('change', persist);
        dlg.querySelector('textarea[name="note"]').addEventListener('input', debounce(() => persist(), 400));
      },
      onClose: async () => {
        await persist();
        render();
      },
    },
  );
}

function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

// ---------- Итоги ----------

function renderStats() {
  const s = state.settings;
  if (!state.stat) {
    const t = parseKey(todayKey());
    state.stat = { y: t.y, m: t.m };
  }
  const { y, m } = state.stat;
  const st = monthStats(y, m, s, state.days);

  // итог за год
  let year = { shifts: 0, extra: 0, hours: 0, pay: 0 };
  const rows = [];
  for (let i = 0; i < 12; i++) {
    const ms = monthStats(y, i, s, state.days);
    year.shifts += ms.shifts;
    year.extra += ms.extra;
    year.hours += ms.hours;
    year.pay += ms.pay;
    if (ms.shifts || ms.sick || ms.vacation) rows.push({ m: i, ms });
  }
  const maxShifts = Math.max(1, ...rows.map((r) => r.ms.shifts));

  view.innerHTML = `
    <header class="top">
      <div>
        <p class="eyebrow">табель и деньги</p>
        <h1>Итоги</h1>
      </div>
    </header>

    <section class="card">
      <div class="month-head month-head-3">
        <button class="icon-btn" id="prev" aria-label="Предыдущий месяц">${icon('left')}</button>
        <h2>${MONTHS[m]} ${y}</h2>
        <button class="icon-btn" id="next" aria-label="Следующий месяц">${icon('right')}</button>
      </div>
      <div class="stats">
        <div class="stat stat-main"><b>${st.shifts}</b><span>${plural(st.shifts, 'смена', 'смены', 'смен')} всего</span></div>
        <div class="stat"><b>${st.work}</b><span>по графику</span></div>
        <div class="stat stat-extra"><b>${st.extra}</b><span>${plural(st.extra, 'замена', 'замены', 'замен')} / вызовов</span></div>
        ${st.night ? `<div class="stat stat-night"><b>${st.night}</b><span>${plural(st.night, 'ночная', 'ночные', 'ночных')}</span></div>` : ''}
        <div class="stat"><b>${fmtHours(st.hours)}</b><span>отработано</span></div>
        ${st.sick ? `<div class="stat"><b>${st.sick}</b><span>${plural(st.sick, 'день', 'дня', 'дней')} больничного</span></div>` : ''}
        ${st.vacation ? `<div class="stat"><b>${st.vacation}</b><span>${plural(st.vacation, 'день', 'дня', 'дней')} отпуска</span></div>` : ''}
        ${s.payRate ? `<div class="stat stat-money"><b>${money(st.pay)}</b><span>примерно, до вычетов</span></div>` : ''}
      </div>
      ${s.payRate ? '' : `<button class="link-btn" id="set-rate">Указать ставку, чтобы считать деньги</button>`}
    </section>

    <section class="card">
      <h2 class="card-title">Табель за месяц</h2>
      ${st.list.length ? `<ul class="tabel">${st.list.map((d) => `
        <li>
          <i class="dot st-${d.status}"></i>
          <span class="tabel-day">${esc(fmtDayShort(d.key))}</span>
          <span class="tabel-st">${esc(STATUSES[d.status].label)}${d.kind === 'night' ? ' · ночь' : ''}${d.note ? `<small>${esc(d.note)}</small>` : ''}</span>
          <span class="tabel-h">${d.isShift ? fmtHours(d.hours) : ''}</span>
        </li>`).join('')}</ul>` : '<p class="muted">В этом месяце смен нет.</p>'}
      <div class="row-btns">
        <button class="btn" id="copy-rep">${icon('share')}<span>Отправить</span></button>
        <button class="btn" id="csv">${icon('download')}<span>Таблица</span></button>
      </div>
    </section>

    ${rows.length ? `<section class="card">
      <h2 class="card-title">${y} год</h2>
      <p class="muted">${year.shifts} ${plural(year.shifts, 'смена', 'смены', 'смен')} · ${year.extra} ${plural(year.extra, 'замена', 'замены', 'замен')} · ${fmtHours(year.hours)}${year.pay ? ` · ${money(year.pay)}` : ''}</p>
      <ul class="bars">${rows.map((r) => `
        <li class="${r.m === m ? 'is-cur' : ''}">
          <span class="bar-label">${MONTHS[r.m].slice(0, 3)}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${(r.ms.work / maxShifts) * 100}%"></span><span class="bar-fill bar-extra" style="width:${(r.ms.extra / maxShifts) * 100}%"></span></span>
          <span class="bar-val">${r.ms.shifts}</span>
        </li>`).join('')}</ul>
    </section>` : ''}
  `;

  const go = (d) => {
    state.stat = shiftMonth(y, m, d);
    renderStats();
  };
  view.querySelector('#prev').addEventListener('click', () => go(-1));
  view.querySelector('#next').addEventListener('click', () => go(1));
  view.querySelector('#set-rate')?.addEventListener('click', () => { setTab('nastroiki'); setTimeout(() => document.getElementById('pay')?.scrollIntoView({ block: 'center' }), 50); });
  view.querySelector('#copy-rep').addEventListener('click', async () => {
    const text = monthReportText(y, m, state);
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      try { await navigator.share({ text }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    copyText(text);
  });
  view.querySelector('#csv').addEventListener('click', () => saveFile(monthCsv(y, m, state), monthFileName(y, m, 'csv')));
}

// ---------- Настройки ----------

function renderSettings() {
  const s = state.settings;
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;

  view.innerHTML = `
    <header class="top">
      <div>
        <p class="eyebrow">версия ${APP_VERSION}</p>
        <h1>Настройки</h1>
      </div>
    </header>

    <section class="card form-card">
      <h2 class="card-title">График</h2>
      <label class="field">
        <span>Первый рабочий день</span>
        <input type="date" id="startDate" value="${esc(s.startDate)}">
      </label>
      <div class="field-row">
        <label class="field">
          <span>Рабочих дней</span>
          <input type="number" id="workDays" min="1" max="14" inputmode="numeric" value="${s.workDays}">
        </label>
        <label class="field">
          <span>Выходных</span>
          <input type="number" id="offDays" min="1" max="14" inputmode="numeric" value="${s.offDays}">
        </label>
      </div>
    </section>

    <section class="card form-card">
      <h2 class="card-title">Смены</h2>
      ${['day', 'night'].map((k) => `
        <p class="sub-title">${icon(k === 'night' ? 'moon' : 'sun', 'ico-sm')}${KINDS[k].label}</p>
        <div class="field-row">
          <label class="field">
            <span>с</span>
            <input type="time" id="${k}Start" value="${esc(s[`${k}Start`])}">
          </label>
          <label class="field">
            <span>до</span>
            <input type="time" id="${k}End" value="${esc(s[`${k}End`])}">
          </label>
        </div>
        <p class="hint" id="${k}-hint"></p>`).join('')}
      <div class="field cyc-field">
        <span>Какие смены в цикле</span>
        <div class="cyc" id="pattern"></div>
      </div>
      <p class="hint">Нажми на рабочий день цикла, чтобы сделать его ночным. Отдельную смену можно поменять прямо в календаре.</p>
    </section>

    <section class="card form-card" id="pay">
      <h2 class="card-title">Оплата</h2>
      <div class="seg" role="radiogroup" aria-label="Как платят">
        <label><input type="radio" name="payType" value="shift" ${s.payType === 'shift' ? 'checked' : ''}><span>за смену</span></label>
        <label><input type="radio" name="payType" value="hour" ${s.payType === 'hour' ? 'checked' : ''}><span>за час</span></label>
      </div>
      <div class="field-row">
        <label class="field">
          <span>Ставка, ₽</span>
          <input type="number" id="payRate" min="0" step="1" inputmode="decimal" value="${s.payRate || ''}" placeholder="0">
        </label>
        <label class="field">
          <span>Замена, ₽</span>
          <input type="number" id="payExtraRate" min="0" step="1" inputmode="decimal" value="${s.payExtraRate || ''}" placeholder="как обычно">
        </label>
      </div>
      <p class="hint">Нужно только для примерного подсчёта в «Итогах».</p>
    </section>

    <section class="card form-card">
      <h2 class="card-title">Напоминания</h2>
      <label class="field">
        <span>Предупреждать о документах за, дней</span>
        <input type="number" id="remindDays" min="1" max="365" inputmode="numeric" value="${s.remindDays}">
      </label>
      <button class="btn btn-block" id="ics">${icon('cal')}<span>Добавить смены в календарь телефона</span></button>
      <p class="hint">Смены на 3 месяца вперёд и сроки документов. Календарь телефона напомнит накануне вечером. Если график поменялся — добавь заново.</p>
    </section>

    <section class="card form-card">
      <h2 class="card-title">Резервная копия</h2>
      <p class="hint">Всё хранится только на этом телефоне и никуда не отправляется. Раз в месяц сохраняй копию — например, в «Файлы», Google Диск или себе в Telegram.</p>
      <div class="row-btns">
        <button class="btn" id="backup">${icon('download')}<span>Сохранить</span></button>
        <button class="btn" id="restore">${icon('upload')}<span>Восстановить</span></button>
      </div>
      <input type="file" id="restore-in" accept="application/json,.json" hidden>
    </section>

    ${standalone ? '' : `<section class="card">
      <h2 class="card-title">Как поставить на телефон</h2>
      ${isIos
        ? '<p>Открой в Safari → кнопка «Поделиться» <span class="kbd">⬆︎</span> → «На экран „Домой“».</p>'
        : '<p>В Chrome: меню <span class="kbd">⋮</span> → «Установить приложение» или «Добавить на главный экран».</p>'}
      <p class="hint">Тогда приложение будет с иконкой, откроется без интернета, и данные будут храниться надёжнее.</p>
    </section>`}

    <section class="card">
      <button class="btn btn-ghost-danger btn-block" id="wipe">${icon('trash')}<span>Стереть все данные</span></button>
    </section>
    <p class="footer-love">${icon('heart', 'ico-sm')} Удачи на новой работе!</p>
  `;

  const num = (id, min, max) => {
    const v = Math.round(Number(view.querySelector(`#${id}`).value));
    return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : null;
  };

  const bind = (id, fn) => view.querySelector(`#${id}`).addEventListener('change', async () => {
    await fn();
    toast('Сохранено');
  });

  bind('startDate', async () => {
    const v = view.querySelector('#startDate').value;
    if (v) await saveSettings({ startDate: v });
  });
  const drawPattern = () => {
    const cur = state.settings;
    view.querySelector('#pattern').innerHTML = cur.pattern.map((k, i) => `
      <button type="button" class="cyc-btn ${k === 'night' ? 'is-night' : ''}" data-i="${i}" aria-pressed="${k === 'night'}"
        aria-label="${i + 1}-й рабочий день: ${KINDS[k].label.toLowerCase()}">
        ${icon(k === 'night' ? 'moon' : 'sun', 'ico-sm')}<small>смена ${i + 1}</small><b>${KINDS[k].label.toLowerCase()}</b>
      </button>`).join('');
  };
  const updLen = () => {
    ['day', 'night'].forEach((k) => {
      const h = hoursFor(k, state.settings);
      view.querySelector(`#${k}-hint`).textContent = `${fmtRange(k, state.settings)} · ${fmtHours(h)}${h === 24 ? ' (сутки)' : ''}`;
    });
  };
  bind('workDays', async () => {
    const v = num('workDays', 1, 14);
    if (!v) return;
    const pattern = Array.from({ length: v }, (_, i) => state.settings.pattern[i] || 'day');
    await saveSettings({ workDays: v, pattern });
    drawPattern();
  });
  bind('offDays', async () => { const v = num('offDays', 1, 14); if (v) await saveSettings({ offDays: v }); });
  ['dayStart', 'dayEnd', 'nightStart', 'nightEnd'].forEach((id) =>
    bind(id, async () => {
      const v = view.querySelector(`#${id}`).value;
      if (v) await saveSettings({ [id]: v });
      updLen();
    }));
  view.querySelector('#pattern').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    const pattern = [...state.settings.pattern];
    const i = Number(b.dataset.i);
    pattern[i] = pattern[i] === 'night' ? 'day' : 'night';
    await saveSettings({ pattern });
    drawPattern();
    toast(`${i + 1}-й день — ${KINDS[pattern[i]].label.toLowerCase()}`);
  });
  drawPattern();
  updLen();
  view.querySelectorAll('input[name="payType"]').forEach((r) => r.addEventListener('change', async () => {
    await saveSettings({ payType: r.value });
    toast('Сохранено');
  }));
  bind('payRate', async () => saveSettings({ payRate: Math.max(0, Number(view.querySelector('#payRate').value) || 0) }));
  bind('payExtraRate', async () => saveSettings({ payExtraRate: Math.max(0, Number(view.querySelector('#payExtraRate').value) || 0) }));
  bind('remindDays', async () => { const v = num('remindDays', 1, 365); if (v) await saveSettings({ remindDays: v }); });

  view.querySelector('#ics').addEventListener('click', () => saveFile(buildIcs(state, 3), 'smeny.ics'));
  view.querySelector('#backup').addEventListener('click', async () => {
    toast('Готовлю копию…');
    try {
      await saveFile(await makeBackup(), backupName());
    } catch {
      toast('Не получилось сохранить копию');
    }
  });
  const restoreIn = view.querySelector('#restore-in');
  view.querySelector('#restore').addEventListener('click', () => restoreIn.click());
  restoreIn.addEventListener('change', async () => {
    const f = restoreIn.files[0];
    restoreIn.value = '';
    if (!f) return;
    const ok = await confirmSheet('Восстановить из копии?', { ok: 'Восстановить', sub: 'Текущие данные на телефоне заменятся данными из файла.' });
    if (!ok) return;
    try {
      await restoreBackup(f);
      await ctx.reload();
      toast('Готово, всё восстановлено');
    } catch (e) {
      toast(e.message || 'Не получилось восстановить');
    }
  });
  view.querySelector('#wipe').addEventListener('click', async () => {
    const ok = await confirmSheet('Стереть все данные?', { ok: 'Стереть', danger: true, sub: 'Удалятся отметки, заметки, документы и фото. Отменить нельзя — сначала сохрани копию.' });
    if (!ok) return;
    await db.clearAll();
    state.cal = null;
    await ctx.reload();
    toast('Всё стёрто');
  });
}

// ---------- запуск ----------

async function start() {
  try {
    await load();
  } catch (e) {
    view.innerHTML = `<div class="empty card"><h2>Не получилось открыть хранилище</h2><p>Похоже, браузер в режиме инкогнито или запретил сохранять данные. Открой приложение в обычном режиме.</p></div>`;
    return;
  }
  const tab = location.hash.slice(1);
  setTab(TABS.includes(tab) ? tab : 'grafik', false);

  // в полночь «сегодня» меняется
  let lastDay = todayKey();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && todayKey() !== lastDay) {
      lastDay = todayKey();
      state.cal = null;
      state.stat = null;
      render();
    }
  });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

start();
