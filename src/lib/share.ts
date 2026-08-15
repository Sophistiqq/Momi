// Reads a deferred share (written by the service worker) and uploads it.
// Mirror of the store schema in static/sw.js.

export interface PendingFile {
  name: string;
  type: string;
  blob: Blob;
}

export interface PendingShare {
  text: string;
  files: PendingFile[];
}

const DB = 'momi-share';
const DB_VERSION = 1;
const STORE = 'pending';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadShare(id: string): Promise<PendingShare | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve((req.result as PendingShare | undefined) || null);
    req.onerror = () => reject(req.error);
  });
}

export async function dropShare(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export interface UploadResult {
  postId: string;
}

// Upload the pending share with caption, location, and mentions to the edge
// function. Mentions are display names; the server re-validates them.
export async function uploadShare(
  share: PendingShare,
  caption: string,
  location: string,
  createdAt?: string,
  lat?: number | null,
  lng?: number | null,
  mentions: string[] = []
): Promise<UploadResult> {
  const form = new FormData();
  form.append('text', caption);
  if (location) form.append('location', location);
  if (createdAt) form.append('created_at', createdAt);
  if (lat != null) form.append('lat', String(lat));
  if (lng != null) form.append('lng', String(lng));
  for (const name of mentions) form.append('mentions', name);
  for (const f of share.files) {
    form.append('photos', f.blob, f.name);
  }
  const res = await fetch('/share-target', {
    method: 'POST',
    headers: { Accept: 'application/json' },
    body: form,
  });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}
