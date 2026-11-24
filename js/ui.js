// Общие кусочки интерфейса: экранирование, иконки, всплывашки, нижние листы.

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const icon = (name, cls = '') =>
  `<svg class="ico ${cls}" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;

export const money = (n) => `${Math.round(n).toLocaleString('ru-RU')} ₽`;

export const fmtHours = (h) => `${Number.isInteger(h) ? h : h.toFixed(1).replace('.', ',')} ч`;

let toastTimer;
export function toast(text) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

/**
 * Нижний лист на базе <dialog>.
 * html — содержимое; onMount(dlg, close) — навесить обработчики; onClose() — после закрытия.
 */
export function openSheet(html, { onMount, onClose, full = false, label = '' } = {}) {
  const dlg = document.createElement('dialog');
  dlg.className = `sheet${full ? ' sheet-full' : ''}`;
  if (label) dlg.setAttribute('aria-label', label);
  dlg.innerHTML = `<div class="sheet-body">${html}</div>`;
  document.body.appendChild(dlg);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    dlg.classList.add('closing');
    const done = () => {
      if (dlg.open) dlg.close();
      dlg.remove();
      onClose?.();
    };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) done();
    else setTimeout(done, 180);
  };

  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) close();
    if (e.target.closest('[data-close]')) close();
  });

  dlg.showModal();
  // не фокусируем первое поле сразу — на телефоне иначе выскакивает клавиатура
  dlg.querySelector('.sheet-body').setAttribute('tabindex', '-1');
  dlg.querySelector('.sheet-body').focus();
  onMount?.(dlg, close);
  return { dlg, close };
}

export function confirmSheet(text, { ok = 'Да', danger = false, sub = '' } = {}) {
  return new Promise((resolve) => {
    let answer = false;
    openSheet(
      `<h3 class="sheet-title">${esc(text)}</h3>
       ${sub ? `<p class="muted">${esc(sub)}</p>` : ''}
       <div class="row-btns">
         <button class="btn" data-close>Отмена</button>
         <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(ok)}</button>
       </div>`,
      {
        onMount: (dlg, close) => {
          dlg.querySelector('[data-ok]').addEventListener('click', () => { answer = true; close(); });
        },
        onClose: () => resolve(answer),
      },
    );
  });
}

/** Отдать файл: «Поделиться» на телефоне, иначе скачать */
export async function saveFile(blob, filename, { preferShare = true } = {}) {
  const file = new File([blob], filename, { type: blob.type });
  if (preferShare && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return true;
    } catch (e) {
      if (e.name === 'AbortError') return false;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Скопировано');
  } catch {
    toast('Не получилось скопировать');
  }
}
