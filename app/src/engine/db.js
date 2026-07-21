/**
 * IndexedDB wrapper — hand-written, no dependency.
 *
 * This is the only module in the engine that performs IO. Everything else takes plain
 * objects, which is what lets the queue, replay and scheduling logic run headless under
 * vitest (§8).
 *
 * Stores (§5.6): cards, events, customWords, dict, meta.
 */
import { config } from '../../../config/app.config.js';

export const DB_NAME = config.identity.projectName;
export const DB_VERSION = 1;

export const STORES = Object.freeze({
  cards: 'cards',
  events: 'events',
  customWords: 'customWords',
  dict: 'dict',
  meta: 'meta',
});

/** Promise wrapper for an IDBRequest. */
function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Open (and if needed create) the database. */
export function openDb(indexedDbImpl = globalThis.indexedDB) {
  if (!indexedDbImpl) throw new Error('IndexedDB is unavailable');
  return new Promise((resolve, reject) => {
    const req = indexedDbImpl.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.cards)) {
        db.createObjectStore(STORES.cards, { keyPath: 'cardId' });
      }
      if (!db.objectStoreNames.contains(STORES.events)) {
        const events = db.createObjectStore(STORES.events, { keyPath: 'id' });
        // Unsynced events are pushed in ts order; both queries are hot paths.
        events.createIndex('synced', 'synced');
        events.createIndex('ts', 'ts');
      }
      if (!db.objectStoreNames.contains(STORES.customWords)) {
        db.createObjectStore(STORES.customWords, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.dict)) {
        db.createObjectStore(STORES.dict, { keyPath: 'simp' });
      }
      if (!db.objectStoreNames.contains(STORES.meta)) {
        db.createObjectStore(STORES.meta, { keyPath: 'k' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another tab'));
  });
}

/**
 * Run `fn` inside one transaction and resolve when it commits — not merely when the
 * last request succeeds, so callers can trust that data is durable.
 * @param {IDBDatabase} db
 * @param {string|string[]} storeNames
 * @param {'readonly'|'readwrite'} mode
 * @param {(tx: IDBTransaction) => any} fn
 */
export function tx(db, storeNames, mode, fn) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeNames, mode);
    let result;
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('transaction aborted'));
    try {
      result = fn(transaction);
    } catch (err) {
      transaction.abort();
      reject(err);
    }
  });
}

/** Read one record. */
export async function getOne(db, store, key) {
  const transaction = db.transaction(store, 'readonly');
  return request(transaction.objectStore(store).get(key));
}

/** Read every record in a store. */
export async function getAll(db, store) {
  const transaction = db.transaction(store, 'readonly');
  return request(transaction.objectStore(store).getAll());
}

/** Read every record matching an index value, e.g. all unsynced events. */
export async function getAllByIndex(db, store, indexName, query) {
  const transaction = db.transaction(store, 'readonly');
  return request(transaction.objectStore(store).index(indexName).getAll(query));
}

/** Write one record. */
export function put(db, store, value) {
  return tx(db, store, 'readwrite', (t) => t.objectStore(store).put(value));
}

/** Write many records in a single transaction. */
export function putAll(db, store, values) {
  return tx(db, store, 'readwrite', (t) => {
    const objectStore = t.objectStore(store);
    for (const value of values) objectStore.put(value);
  });
}

/** Delete one record. */
export function remove(db, store, key) {
  return tx(db, store, 'readwrite', (t) => t.objectStore(store).delete(key));
}

/** Empty the named stores — the Danger Zone wipe (§9). */
export function clearStores(db, storeNames) {
  const names = Array.isArray(storeNames) ? storeNames : [storeNames];
  return tx(db, names, 'readwrite', (t) => {
    for (const name of names) t.objectStore(name).clear();
  });
}

/** Read a `meta` value by key. */
export async function getMeta(db, key, fallback = undefined) {
  const row = await getOne(db, STORES.meta, key);
  return row === undefined ? fallback : row.v;
}

/** Write a `meta` value. */
export function setMeta(db, key, value) {
  return put(db, STORES.meta, { k: key, v: value });
}
