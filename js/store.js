// この端末の中の保存場所（IndexedDB）。
// 電波がなくても使えるように、教材・記録・ダウンロードしたファイルをここに置きます。

const DB_NAME = "fp3-study";
const DB_VERSION = 1;
let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
        if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function run(storeName, mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        const result = fn(store);
        tx.oncomplete = () => resolve(result && "result" in result ? result.result : undefined);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

export const kv = {
  get: (key) => run("kv", "readonly", (s) => s.get(key)),
  set: (key, value) => run("kv", "readwrite", (s) => s.put(value, key)),
  del: (key) => run("kv", "readwrite", (s) => s.delete(key)),
};

export const blobs = {
  get: (key) => run("blobs", "readonly", (s) => s.get(key)),
  set: (key, value) => run("blobs", "readwrite", (s) => s.put(value, key)),
  del: (key) => run("blobs", "readwrite", (s) => s.delete(key)),
  keys: () => run("blobs", "readonly", (s) => s.getAllKeys()),
  clear: () => run("blobs", "readwrite", (s) => s.clear()),
};

export async function clearAll() {
  await run("kv", "readwrite", (s) => s.clear());
  await blobs.clear();
}
