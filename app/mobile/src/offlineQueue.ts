// Offline message queue with IndexedDB persistence.
// Queues messages when offline, flushes them when connectivity returns.
// Mirrors Telegram/WhatsApp offline-first design.

const DB_NAME = "agenthub-offline-queue";
const DB_VERSION = 1;
const STORE_NAME = "pending-messages";

export interface QueuedMessage {
  id: string;
  threadId: string;
  content: string;
  createdAt: number;
  retryCount: number;
  status: "queued" | "sending" | "failed";
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function withStore(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest | void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    openDB().then((db) => {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
      try {
        fn(store);
      } catch (err) {
        reject(err);
        return;
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }).catch(reject);
  });
}

function generateId(): string {
  return `q_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export async function enqueueMessage(
  threadId: string,
  content: string,
): Promise<QueuedMessage> {
  const message: QueuedMessage = {
    id: generateId(),
    threadId,
    content,
    createdAt: Date.now(),
    retryCount: 0,
    status: "queued",
  };

  await withStore("readwrite", (store) => {
    store.add(message);
  });

  return message;
}

export async function dequeueMessage(id: string): Promise<void> {
  await withStore("readwrite", (store) => {
    store.delete(id);
  });
}

export async function updateMessageStatus(
  id: string,
  status: QueuedMessage["status"],
  retryCount?: number,
): Promise<void> {
  await withStore("readwrite", (store) => {
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const existing = getReq.result as QueuedMessage | undefined;
      if (existing) {
        store.put({
          ...existing,
          status,
          retryCount: retryCount ?? existing.retryCount,
        });
      }
    };
  });
}

export async function getQueueForThread(
  threadId: string,
): Promise<QueuedMessage[]> {
  return new Promise((resolve, reject) => {
    openDB().then((db) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => {
        const all = request.result as QueuedMessage[];
        resolve(
          all
            .filter((m) => m.threadId === threadId)
            .sort((a, b) => a.createdAt - b.createdAt),
        );
      };
      request.onerror = () => reject(request.error);
    }).catch(reject);
  });
}

export async function getAllQueuedMessages(): Promise<QueuedMessage[]> {
  return new Promise((resolve, reject) => {
    openDB().then((db) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => {
        resolve(
          (request.result as QueuedMessage[]).sort(
            (a, b) => a.createdAt - b.createdAt,
          ),
        );
      };
      request.onerror = () => reject(request.error);
    }).catch(reject);
  });
}

export async function clearQueueForThread(threadId: string): Promise<void> {
  const messages = await getQueueForThread(threadId);
  await Promise.all(messages.map((m) => dequeueMessage(m.id)));
}

export type QueueChangeCallback = (messages: QueuedMessage[]) => void;

const listeners = new Set<QueueChangeCallback>();

export function onQueueChange(callback: QueueChangeCallback): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

export async function notifyQueueChange(): Promise<void> {
  const messages = await getAllQueuedMessages();
  listeners.forEach((cb) => cb(messages));
}
