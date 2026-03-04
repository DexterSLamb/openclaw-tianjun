import fs from "node:fs";
import path from "node:path";
import { indexedDB as fakeIndexedDB } from "fake-indexeddb";
import { LogService } from "./logger.js";

type IdbStoreSnapshot = {
  name: string;
  keyPath: IDBObjectStoreParameters["keyPath"];
  autoIncrement: boolean;
  indexes: { name: string; keyPath: string | string[]; multiEntry: boolean; unique: boolean }[];
  records: { key: IDBValidKey; value: unknown }[];
};

type IdbDatabaseSnapshot = {
  name: string;
  version: number;
  stores: IdbStoreSnapshot[];
};

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dumpIndexedDatabases(databasePrefix?: string): Promise<IdbDatabaseSnapshot[]> {
  const idb = fakeIndexedDB;
  const dbList = await idb.databases();
  const snapshot: IdbDatabaseSnapshot[] = [];
  const expectedPrefix = databasePrefix ? `${databasePrefix}::` : null;

  for (const { name, version } of dbList) {
    if (!name || !version) continue;
    if (expectedPrefix && !name.startsWith(expectedPrefix)) continue;
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const r = idb.open(name, version);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });

    const stores: IdbStoreSnapshot[] = [];
    for (const storeName of db.objectStoreNames) {
      const tx = db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const storeInfo: IdbStoreSnapshot = {
        name: storeName,
        keyPath: store.keyPath as IDBObjectStoreParameters["keyPath"],
        autoIncrement: store.autoIncrement,
        indexes: [],
        records: [],
      };
      for (const idxName of store.indexNames) {
        const idx = store.index(idxName);
        storeInfo.indexes.push({
          name: idxName,
          keyPath: idx.keyPath as string | string[],
          multiEntry: idx.multiEntry,
          unique: idx.unique,
        });
      }
      const keys = await idbReq(store.getAllKeys());
      const values = await idbReq(store.getAll());
      storeInfo.records = keys.map((k, i) => ({ key: k, value: values[i] }));
      stores.push(storeInfo);
    }
    snapshot.push({ name, version, stores });
    db.close();
  }
  return snapshot;
}

async function restoreIndexedDatabases(snapshot: IdbDatabaseSnapshot[]): Promise<void> {
  const idb = fakeIndexedDB;
  for (const dbSnap of snapshot) {
    await new Promise<void>((resolve, reject) => {
      const r = idb.open(dbSnap.name, dbSnap.version);
      r.onupgradeneeded = () => {
        const db = r.result;
        for (const storeSnap of dbSnap.stores) {
          const opts: IDBObjectStoreParameters = {};
          if (storeSnap.keyPath !== null) opts.keyPath = storeSnap.keyPath;
          if (storeSnap.autoIncrement) opts.autoIncrement = true;
          const store = db.createObjectStore(storeSnap.name, opts);
          for (const idx of storeSnap.indexes) {
            store.createIndex(idx.name, idx.keyPath, {
              unique: idx.unique,
              multiEntry: idx.multiEntry,
            });
          }
        }
      };
      r.onsuccess = async () => {
        try {
          const db = r.result;
          for (const storeSnap of dbSnap.stores) {
            if (storeSnap.records.length === 0) continue;
            const tx = db.transaction(storeSnap.name, "readwrite");
            const store = tx.objectStore(storeSnap.name);
            for (const rec of storeSnap.records) {
              if (storeSnap.keyPath !== null) {
                store.put(rec.value);
              } else {
                store.put(rec.value, rec.key);
              }
            }
            await new Promise<void>((res) => {
              tx.oncomplete = () => res();
            });
          }
          db.close();
          resolve();
        } catch (err) {
          reject(err);
        }
      };
      r.onerror = () => reject(r.error);
    });
  }
}

function resolveDefaultIdbSnapshotPath(): string {
  const stateDir =
    process.env.OPENCLAW_STATE_DIR ||
    process.env.MOLTBOT_STATE_DIR ||
    path.join(process.env.HOME || "/tmp", ".openclaw");
  return path.join(stateDir, "credentials", "matrix-js", "crypto-idb-snapshot.json");
}

export async function restoreIdbFromDisk(snapshotPath?: string): Promise<boolean> {
  const resolvedPath = snapshotPath ?? resolveDefaultIdbSnapshotPath();
  try {
    const data = fs.readFileSync(resolvedPath, "utf8");
    const snapshot: IdbDatabaseSnapshot[] = JSON.parse(data);
    if (!Array.isArray(snapshot) || snapshot.length === 0) return false;
    await restoreIndexedDatabases(snapshot);
    LogService.info(
      "IdbPersistence",
      `Restored ${snapshot.length} IndexedDB database(s) from ${resolvedPath}`,
    );
    return true;
  } catch {
    return false;
  }
}

export async function persistIdbToDisk(params?: {
  snapshotPath?: string;
  databasePrefix?: string;
}): Promise<void> {
  const snapshotPath = params?.snapshotPath ?? resolveDefaultIdbSnapshotPath();
  try {
    const snapshot = await dumpIndexedDatabases(params?.databasePrefix);
    if (snapshot.length === 0) return;
    fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot));
    LogService.debug(
      "IdbPersistence",
      `Persisted ${snapshot.length} IndexedDB database(s) to ${snapshotPath}`,
    );
  } catch (err) {
    LogService.warn("IdbPersistence", "Failed to persist IndexedDB snapshot:", err);
  }
}
