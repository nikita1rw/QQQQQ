// Маленькая обёртка над IndexedDB. Все данные живут только на этом устройстве.

const DB_NAME = 'smeny';
const DB_VERSION = 1;
let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('days')) db.createObjectStore('days');
        if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function run(stores, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result;
    const out = fn(tx);
    if (out && 'onsuccess' in out) out.onsuccess = () => { result = out.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Транзакция отменена'));
  });
}

export const get = (store, key) => run(store, 'readonly', (tx) => tx.objectStore(store).get(key));

export const put = (store, value, key) =>
  run(store, 'readwrite', (tx) => (key === undefined ? tx.objectStore(store).put(value) : tx.objectStore(store).put(value, key)));

export const del = (store, key) => run(store, 'readwrite', (tx) => tx.objectStore(store).delete(key));

export const getAll = (store) => run(store, 'readonly', (tx) => tx.objectStore(store).getAll());

/** Все пары ключ → значение (для хранилищ без keyPath) */
export async function entries(store) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const st = tx.objectStore(store);
    const kReq = st.getAllKeys();
    const vReq = st.getAll();
    tx.oncomplete = () => {
      const obj = {};
      kReq.result.forEach((k, i) => { obj[k] = vReq.result[i]; });
      resolve(obj);
    };
    tx.onerror = () => reject(tx.error);
  });
}

/** Несколько операций в одной транзакции: fn получает объект с хранилищами */
export function batch(stores, fn) {
  return run(stores, 'readwrite', (tx) => {
    const s = {};
    stores.forEach((name) => { s[name] = tx.objectStore(name); });
    fn(s);
  });
}

export function clearAll() {
  return batch(['kv', 'days', 'docs', 'files'], (s) => {
    Object.values(s).forEach((st) => st.clear());
  });
}
