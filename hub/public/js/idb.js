// Kho trên máy riêng (IndexedDB). Chỉ chứa ciphertext; không có mật khẩu thì vô dụng.

const DB_NAME = 'for-me-hub';
const STORES = ['meta', 'records', 'outbox'];

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      if (!db.objectStoreNames.contains('records')) db.createObjectStore('records', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function result(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const local = {
  async getMeta(key) {
    const db = await open();
    try {
      return await result(db.transaction('meta').objectStore('meta').get(key));
    } finally {
      db.close();
    }
  },
  async setMeta(key, value) {
    const db = await open();
    try {
      const tx = db.transaction('meta', 'readwrite');
      tx.objectStore('meta').put(value, key);
      await done(tx);
    } finally {
      db.close();
    }
  },
  async all(store) {
    const db = await open();
    try {
      return await result(db.transaction(store).objectStore(store).getAll());
    } finally {
      db.close();
    }
  },
  // puts/deletes: { records: [...], outbox: [...] } và { outbox: [ids] }
  async write({ puts = {}, deletes = {}, meta = {} }) {
    const db = await open();
    try {
      const tx = db.transaction(STORES, 'readwrite');
      for (const [store, rows] of Object.entries(puts)) for (const row of rows) tx.objectStore(store).put(row);
      for (const [store, ids] of Object.entries(deletes)) for (const id of ids) tx.objectStore(store).delete(id);
      for (const [key, value] of Object.entries(meta)) tx.objectStore('meta').put(value, key);
      await done(tx);
    } finally {
      db.close();
    }
  },
  async wipe() {
    await new Promise((resolve) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
  },
  async exists() {
    if (indexedDB.databases) {
      const dbs = await indexedDB.databases();
      if (!dbs.some((d) => d.name === DB_NAME)) return false;
    }
    return !!(await this.getMeta('vault'));
  },
};
