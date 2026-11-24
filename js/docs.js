// Вкладка «Документы»: список, просмотр, добавление и редактирование, фото.

import * as db from './db.js';
import { esc, icon, openSheet, confirmSheet, toast, saveFile, copyText } from './ui.js';
import { DOC_TYPES, docTypeLabel, docExpiry } from './schedule.js';
import { fmtNumeric, plural } from './dates.js';

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

// ---------- ссылки на картинки ----------

const urlCache = new Map(); // fileId → { thumb, full }

async function fileUrl(id, kind = 'thumb') {
  const cached = urlCache.get(id) || {};
  if (cached[kind]) return cached[kind];
  const f = await db.get('files', id);
  if (!f) return null;
  const blob = kind === 'thumb' ? f.thumb || (f.type.startsWith('image/') ? f.blob : null) : f.blob;
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urlCache.set(id, { ...cached, [kind]: url });
  return url;
}

function forgetFile(id) {
  const c = urlCache.get(id);
  if (c) Object.values(c).forEach((u) => URL.revokeObjectURL(u));
  urlCache.delete(id);
}

// ---------- обработка фото ----------

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve(img); URL.revokeObjectURL(url); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Не удалось открыть картинку')); };
    img.src = url;
  });
}

function resize(img, max, quality) {
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve({ blob, w, h }), 'image/jpeg', quality));
}

async function processFile(file) {
  const base = { id: uid(), name: file.name || 'файл' };
  if (file.type.startsWith('image/')) {
    try {
      const img = await loadImage(file);
      const main = await resize(img, 2200, 0.86);
      const thumb = await resize(img, 400, 0.8);
      if (main.blob) return { ...base, type: 'image/jpeg', blob: main.blob, thumb: thumb.blob, w: main.w, h: main.h };
    } catch { /* сохраним как есть */ }
  }
  return { ...base, type: file.type || 'application/octet-stream', blob: file, thumb: null };
}

// ---------- список ----------

function expiryChip(doc, s) {
  const e = docExpiry(doc, s);
  if (e.level === 'none') return '';
  if (e.level === 'expired') return `<span class="chip chip-bad">просрочен</span>`;
  if (e.level === 'soon') {
    const text = e.days === 0 ? 'сегодня' : `${e.days} ${plural(e.days, 'день', 'дня', 'дней')}`;
    return `<span class="chip chip-warn">${text}</span>`;
  }
  return `<span class="chip chip-ok">до ${fmtNumeric(doc.expires)}</span>`;
}

const ORDER = { expired: 0, soon: 1, ok: 2, none: 2 };

export function sortedDocs(docs, s) {
  const typeIdx = (t) => {
    const i = DOC_TYPES.findIndex((x) => x.id === t);
    return i < 0 ? 99 : i;
  };
  return [...docs].sort((a, b) => {
    const ea = docExpiry(a, s);
    const eb = docExpiry(b, s);
    if (ORDER[ea.level] !== ORDER[eb.level]) return ORDER[ea.level] - ORDER[eb.level];
    if (ea.level === 'soon' || ea.level === 'expired') return ea.days - eb.days;
    return typeIdx(a.type) - typeIdx(b.type) || (a.title || '').localeCompare(b.title || '', 'ru');
  });
}

export function docAlerts(docs, s) {
  return docs
    .map((d) => ({ doc: d, e: docExpiry(d, s) }))
    .filter((x) => x.e.level === 'expired' || x.e.level === 'soon')
    .sort((a, b) => a.e.days - b.e.days);
}

export function alertText({ doc, e }) {
  const name = doc.title || docTypeLabel(doc.type);
  if (e.level === 'expired') return `${name}: срок истёк ${fmtNumeric(doc.expires)}`;
  if (e.days === 0) return `${name}: последний день сегодня`;
  return `${name}: осталось ${e.days} ${plural(e.days, 'день', 'дня', 'дней')}`;
}

export function renderDocs(root, state, ctx) {
  const s = state.settings;
  const docs = sortedDocs(state.docs, s);
  const alerts = docAlerts(state.docs, s);

  root.innerHTML = `
    <header class="top">
      <div>
        <p class="eyebrow">только на этом телефоне</p>
        <h1>Документы</h1>
      </div>
      <button class="btn btn-primary btn-sm" id="add-doc">${icon('plus')}<span>Добавить</span></button>
    </header>

    ${alerts.length ? `<section class="alerts">${alerts.map((a) => `
      <button class="alert alert-${a.e.level}" data-open="${esc(a.doc.id)}">
        ${icon('alert')}<span>${esc(alertText(a))}</span>${icon('right', 'ico-sm')}
      </button>`).join('')}</section>` : ''}

    ${docs.length ? `<ul class="doc-list">${docs.map((d) => `
      <li>
        <button class="doc-card" data-open="${esc(d.id)}">
          <span class="doc-thumb" ${d.fileIds?.length ? `data-thumb="${esc(d.fileIds[0])}"` : ''}>${icon('doc')}</span>
          <span class="doc-main">
            <span class="doc-title">${esc(d.title || docTypeLabel(d.type))}</span>
            <span class="doc-sub">${esc([d.number ? `№ ${d.number}` : '', d.title && d.title !== docTypeLabel(d.type) ? docTypeLabel(d.type) : ''].filter(Boolean).join(' · ') || docTypeLabel(d.type))}</span>
          </span>
          ${expiryChip(d, s)}
        </button>
      </li>`).join('')}</ul>` : `
      <div class="empty card">
        <div class="empty-ico">${icon('doc')}</div>
        <h2>Здесь будут документы</h2>
        <p>Удостоверение личности, паспорт, медкнижка, допуски, сертификаты — с фото и сроком действия. Приложение заранее напомнит, когда что-то заканчивается.</p>
        <button class="btn btn-primary" id="add-doc-2">${icon('plus')}<span>Добавить первый документ</span></button>
      </div>`}
  `;

  root.querySelectorAll('[data-thumb]').forEach(async (el) => {
    const url = await fileUrl(el.dataset.thumb, 'thumb');
    if (url) el.innerHTML = `<img src="${url}" alt="">`;
  });
  root.querySelectorAll('[data-open]').forEach((b) =>
    b.addEventListener('click', () => {
      const doc = state.docs.find((d) => d.id === b.dataset.open);
      if (doc) openDoc(doc, state, ctx);
    }),
  );
  root.querySelector('#add-doc')?.addEventListener('click', () => openDocForm(null, state, ctx));
  root.querySelector('#add-doc-2')?.addEventListener('click', () => openDocForm(null, state, ctx));
}

// ---------- просмотр ----------

export async function openDoc(doc, state, ctx) {
  const s = state.settings;
  const files = (await Promise.all((doc.fileIds || []).map((id) => db.get('files', id)))).filter(Boolean);
  const field = (label, value, extra = '') =>
    value ? `<div class="kv"><dt>${label}</dt><dd>${value}${extra}</dd></div>` : '';

  openSheet(
    `<div class="sheet-head">
       <button class="icon-btn" data-close aria-label="Закрыть">${icon('x')}</button>
       <h3 class="sheet-title">${esc(doc.title || docTypeLabel(doc.type))}</h3>
       <button class="icon-btn" id="edit" aria-label="Изменить">${icon('edit')}</button>
     </div>
     ${files.length ? `<div class="gallery">${files.map((f, i) => f.type.startsWith('image/')
       ? `<button class="gallery-item" data-i="${i}" aria-label="Открыть фото ${i + 1}"><img data-full="${esc(f.id)}" alt=""></button>`
       : `<button class="gallery-item gallery-file" data-i="${i}">${icon('doc')}<span>${esc(f.name)}</span></button>`).join('')}</div>`
       : `<p class="muted small">Фото нет — можно добавить через «Изменить».</p>`}
     <dl class="kvs">
       ${field('Тип', esc(docTypeLabel(doc.type)))}
       ${field('Номер', `<span class="mono">${esc(doc.number)}</span>`, `<button class="icon-btn icon-btn-sm" id="copy" aria-label="Скопировать номер">${icon('copy')}</button>`)}
       ${field('Выдан', doc.issued ? fmtNumeric(doc.issued) : '')}
       ${field('Действует до', doc.expires ? fmtNumeric(doc.expires) : '', ` ${expiryChip(doc, s)}`)}
       ${field('Заметка', esc(doc.note).replace(/\n/g, '<br>'))}
     </dl>
     <div class="row-btns">
       ${files.length ? `<button class="btn" id="share">${icon('share')}<span>Отправить</span></button>` : ''}
       <button class="btn btn-ghost-danger" id="delete">${icon('trash')}<span>Удалить</span></button>
     </div>`,
    {
      full: true,
      label: doc.title,
      onMount: (dlg, close) => {
        dlg.querySelectorAll('img[data-full]').forEach(async (img) => {
          img.src = (await fileUrl(img.dataset.full, 'thumb')) || '';
        });
        dlg.querySelectorAll('.gallery-item').forEach((b) =>
          b.addEventListener('click', () => {
            const f = files[Number(b.dataset.i)];
            if (f.type.startsWith('image/')) openViewer(files.filter((x) => x.type.startsWith('image/')), f.id);
            else openRaw(f);
          }),
        );
        dlg.querySelector('#copy')?.addEventListener('click', () => copyText(doc.number));
        dlg.querySelector('#edit').addEventListener('click', () => { close(); openDocForm(doc, state, ctx); });
        dlg.querySelector('#share')?.addEventListener('click', () => shareDoc(doc, files));
        dlg.querySelector('#delete').addEventListener('click', async () => {
          const ok = await confirmSheet(`Удалить «${doc.title || docTypeLabel(doc.type)}»?`, { ok: 'Удалить', danger: true, sub: 'Фото этого документа тоже удалятся.' });
          if (!ok) return;
          await deleteDoc(doc);
          close();
          await ctx.reload();
          toast('Документ удалён');
        });
      },
    },
  );
}

async function openRaw(f) {
  const url = URL.createObjectURL(f.blob);
  const w = window.open(url, '_blank');
  if (!w) await saveFile(f.blob, f.name, { preferShare: false });
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function shareDoc(doc, files) {
  const list = files.map((f, i) => new File([f.blob], f.type === 'image/jpeg' ? `${doc.title || 'документ'}-${i + 1}.jpg` : f.name, { type: f.type }));
  if (navigator.canShare?.({ files: list })) {
    try {
      await navigator.share({ files: list, title: doc.title });
    } catch { /* отменила */ }
    return;
  }
  for (const f of list) await saveFile(f, f.name, { preferShare: false });
}

function openViewer(images, startId) {
  let i = Math.max(0, images.findIndex((f) => f.id === startId));
  openSheet(
    `<div class="viewer">
       <button class="icon-btn viewer-close" data-close aria-label="Закрыть">${icon('x')}</button>
       <img class="viewer-img" alt="">
       ${images.length > 1 ? `
         <button class="icon-btn viewer-prev" aria-label="Предыдущее фото">${icon('left')}</button>
         <button class="icon-btn viewer-next" aria-label="Следующее фото">${icon('right')}</button>
         <span class="viewer-count"></span>` : ''}
     </div>`,
    {
      full: true,
      label: 'Фото документа',
      onMount: (dlg) => {
        dlg.classList.add('sheet-viewer');
        const img = dlg.querySelector('.viewer-img');
        const count = dlg.querySelector('.viewer-count');
        const show = async () => {
          img.src = (await fileUrl(images[i].id, 'full')) || '';
          if (count) count.textContent = `${i + 1} / ${images.length}`;
        };
        const go = (d) => { i = (i + d + images.length) % images.length; show(); };
        dlg.querySelector('.viewer-prev')?.addEventListener('click', () => go(-1));
        dlg.querySelector('.viewer-next')?.addEventListener('click', () => go(1));
        let x0 = null;
        img.addEventListener('touchstart', (e) => { x0 = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
        img.addEventListener('touchend', (e) => {
          if (x0 == null || images.length < 2) return;
          const dx = e.changedTouches[0].clientX - x0;
          if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
          x0 = null;
        });
        show();
      },
    },
  );
}

async function deleteDoc(doc) {
  await db.batch(['docs', 'files'], (st) => {
    st.docs.delete(doc.id);
    (doc.fileIds || []).forEach((id) => st.files.delete(id));
  });
  (doc.fileIds || []).forEach(forgetFile);
}

// ---------- форма ----------

export function openDocForm(existing, state, ctx) {
  const doc = existing
    ? { ...existing, fileIds: [...(existing.fileIds || [])] }
    : { id: uid(), type: 'idcard', title: 'Удостоверение личности', number: '', issued: '', expires: '', note: '', fileIds: [] };
  const added = []; // новые файлы, ещё не сохранённые
  const removed = new Set(); // id файлов, которые убрали
  let busy = false;

  const typeChips = DOC_TYPES.map((t) => `
    <label class="pick">
      <input type="radio" name="type" value="${t.id}" ${t.id === doc.type ? 'checked' : ''}>
      <span>${t.label}</span>
    </label>`).join('');

  openSheet(
    `<form class="doc-form" novalidate>
       <div class="sheet-head">
         <button type="button" class="link-btn" data-close>Отмена</button>
         <h3 class="sheet-title">${existing ? 'Изменить' : 'Новый документ'}</h3>
         <button type="submit" class="link-btn link-btn-strong">Готово</button>
       </div>

       <fieldset class="field">
         <legend>Что это</legend>
         <div class="picks">${typeChips}</div>
       </fieldset>

       <label class="field">
         <span>Название</span>
         <input name="title" value="${esc(doc.title)}" placeholder="Например, медкнижка" autocomplete="off" required>
       </label>

       <label class="field">
         <span>Номер / серия</span>
         <input name="number" value="${esc(doc.number)}" placeholder="Необязательно" autocomplete="off" autocapitalize="characters">
       </label>

       <div class="field-row">
         <label class="field">
           <span>Выдан</span>
           <input type="date" name="issued" value="${esc(doc.issued)}">
         </label>
         <label class="field">
           <span>Действует до</span>
           <input type="date" name="expires" value="${esc(doc.expires)}">
         </label>
       </div>
       <p class="hint" id="exp-hint"></p>

       <div class="field">
         <span>Фото и сканы</span>
         <div class="photo-edit" id="photos"></div>
         <input type="file" id="file-in" accept="image/*,application/pdf" multiple hidden>
       </div>

       <label class="field">
         <span>Заметка</span>
         <textarea name="note" rows="3" placeholder="Где лежит оригинал, кем выдан, что продлить…">${esc(doc.note)}</textarea>
       </label>

       <button type="submit" class="btn btn-primary btn-block">Сохранить</button>
     </form>`,
    {
      full: true,
      label: existing ? 'Изменить документ' : 'Новый документ',
      onMount: (dlg, close) => {
        const form = dlg.querySelector('form');
        const photos = dlg.querySelector('#photos');
        const fileIn = dlg.querySelector('#file-in');
        const hint = dlg.querySelector('#exp-hint');

        const updateHint = () => {
          const type = DOC_TYPES.find((t) => t.id === form.type.value);
          hint.textContent = type?.expires && !form.expires.value
            ? 'У этого документа обычно есть срок — укажи его, и приложение напомнит заранее.'
            : '';
        };

        const drawPhotos = async () => {
          const current = doc.fileIds.filter((id) => !removed.has(id));
          const items = [
            ...current.map((id) => ({ id, saved: true })),
            ...added.map((f) => ({ id: f.id, saved: false, f })),
          ];
          photos.innerHTML = `${items.map((it) => `
            <div class="photo-tile" data-id="${esc(it.id)}">
              <span class="photo-img">${icon('doc')}</span>
              <button type="button" class="photo-x" aria-label="Убрать">${icon('x')}</button>
            </div>`).join('')}
            <button type="button" class="photo-add" id="add-photo">${icon('camera')}<span>Добавить</span></button>`;
          for (const it of items) {
            const tile = photos.querySelector(`[data-id="${CSS.escape(it.id)}"]`);
            let url = null;
            if (it.saved) url = await fileUrl(it.id, 'thumb');
            else if (it.f.thumb || it.f.type.startsWith('image/')) url = URL.createObjectURL(it.f.thumb || it.f.blob);
            if (url) tile.querySelector('.photo-img').innerHTML = `<img src="${url}" alt="">`;
            tile.querySelector('.photo-x').addEventListener('click', () => {
              if (it.saved) removed.add(it.id);
              else added.splice(added.findIndex((x) => x.id === it.id), 1);
              drawPhotos();
            });
          }
          photos.querySelector('#add-photo').addEventListener('click', () => fileIn.click());
        };

        fileIn.addEventListener('change', async () => {
          const list = [...fileIn.files];
          fileIn.value = '';
          if (!list.length) return;
          toast(list.length > 1 ? 'Обрабатываю фото…' : 'Обрабатываю…');
          for (const f of list) added.push(await processFile(f));
          drawPhotos();
        });

        let prevLabel = DOC_TYPES.find((t) => t.id === doc.type)?.label;
        form.querySelectorAll('input[name="type"]').forEach((r) =>
          r.addEventListener('change', () => {
            const label = DOC_TYPES.find((t) => t.id === r.value).label;
            if (!form.title.value.trim() || form.title.value === prevLabel) form.title.value = r.value === 'other' ? '' : label;
            prevLabel = label;
            updateHint();
          }),
        );
        form.expires.addEventListener('change', updateHint);

        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          if (busy) return;
          const title = form.title.value.trim();
          if (!title) {
            form.title.focus();
            toast('Напиши название');
            return;
          }
          busy = true;
          const next = {
            ...doc,
            type: form.type.value,
            title,
            number: form.number.value.trim(),
            issued: form.issued.value,
            expires: form.expires.value,
            note: form.note.value.trim(),
            fileIds: [...doc.fileIds.filter((id) => !removed.has(id)), ...added.map((f) => f.id)],
            createdAt: doc.createdAt || Date.now(),
            updatedAt: Date.now(),
          };
          try {
            await db.batch(['docs', 'files'], (st) => {
              st.docs.put(next);
              added.forEach((f) => st.files.put({ ...f, docId: next.id }));
              removed.forEach((id) => st.files.delete(id));
            });
            removed.forEach(forgetFile);
            navigator.storage?.persist?.();
            close();
            await ctx.reload();
            toast(existing ? 'Сохранено' : 'Документ добавлен');
          } catch (err) {
            busy = false;
            toast(err?.name === 'QuotaExceededError' ? 'На телефоне не хватает места' : 'Не получилось сохранить');
          }
        });

        updateHint();
        drawPhotos();
      },
    },
  );
}
