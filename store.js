// Lokale Speicherung in IndexedDB (bleibt auf dem Gerät)

const DB_NAME = 'handschrift';
let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('glyphs', { keyPath: 'key' });
        db.createObjectStore('kv');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    const r = fn(s);
    if (r && 'onsuccess' in r) r.onsuccess = () => { result = r.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const store = {
  allGlyphs: () => tx('glyphs', 'readonly', s => s.getAll()),
  putGlyph: rec => tx('glyphs', 'readwrite', s => s.put(rec)),
  deleteGlyph: key => tx('glyphs', 'readwrite', s => s.delete(key)),
  clearGlyphs: () => tx('glyphs', 'readwrite', s => s.clear()),
  get: key => tx('kv', 'readonly', s => s.get(key)),
  set: (key, value) => tx('kv', 'readwrite', s => s.put(value, key)),
  del: key => tx('kv', 'readwrite', s => s.delete(key)),
};

/** Bittet den Browser, die Daten nicht automatisch zu löschen. */
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch { /* nicht unterstützt */ }
}
