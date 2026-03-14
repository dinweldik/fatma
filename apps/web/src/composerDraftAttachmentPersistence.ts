import { ThreadId } from "@fatma/contracts";

import {
  legacyDataUrlToPayload,
  type ComposerImageAttachmentPayload,
} from "./composerImageSnapshots";

export interface PersistedComposerImageAttachmentMetadata {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
}

export type PersistedComposerImageAttachment = ComposerImageAttachmentPayload;

export interface LegacyPersistedComposerImageAttachment extends PersistedComposerImageAttachmentMetadata {
  dataUrl: string;
}

interface ComposerDraftAttachmentRecord extends PersistedComposerImageAttachment {
  key: string;
  threadId: ThreadId;
}

interface LegacyComposerDraftAttachmentRecord extends LegacyPersistedComposerImageAttachment {
  key: string;
  threadId: ThreadId;
}

const COMPOSER_DRAFT_ATTACHMENT_DB_NAME = "fatma:composer-draft-attachments:v1";
const COMPOSER_DRAFT_ATTACHMENT_DB_VERSION = 1;
const COMPOSER_DRAFT_ATTACHMENT_STORE_NAME = "attachments";
const COMPOSER_DRAFT_ATTACHMENT_THREAD_INDEX = "threadId";

let composerDraftAttachmentDbPromise: Promise<IDBDatabase | null> | null = null;

function attachmentStorageKey(threadId: ThreadId, attachmentId: string): string {
  return `${threadId}\u0000${attachmentId}`;
}

function createComposerDraftAttachmentRecord(
  threadId: ThreadId,
  attachment: PersistedComposerImageAttachment,
): ComposerDraftAttachmentRecord {
  return {
    key: attachmentStorageKey(threadId, attachment.id),
    threadId,
    ...attachment,
  };
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => {
      resolve(request.result);
    });
    request.addEventListener("error", () => {
      reject(request.error ?? new Error("IndexedDB request failed."));
    });
  });
}

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => {
      resolve();
    });
    transaction.addEventListener("error", () => {
      reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    });
    transaction.addEventListener("abort", () => {
      reject(transaction.error ?? new Error("IndexedDB transaction was aborted."));
    });
  });
}

async function openComposerDraftAttachmentDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") {
    return null;
  }
  if (!composerDraftAttachmentDbPromise) {
    composerDraftAttachmentDbPromise = new Promise((resolve) => {
      const request = indexedDB.open(
        COMPOSER_DRAFT_ATTACHMENT_DB_NAME,
        COMPOSER_DRAFT_ATTACHMENT_DB_VERSION,
      );
      request.addEventListener("upgradeneeded", () => {
        const database = request.result;
        const store = database.objectStoreNames.contains(COMPOSER_DRAFT_ATTACHMENT_STORE_NAME)
          ? (request.transaction?.objectStore(COMPOSER_DRAFT_ATTACHMENT_STORE_NAME) ?? null)
          : database.createObjectStore(COMPOSER_DRAFT_ATTACHMENT_STORE_NAME, {
              keyPath: "key",
            });
        if (store && !store.indexNames.contains(COMPOSER_DRAFT_ATTACHMENT_THREAD_INDEX)) {
          store.createIndex(COMPOSER_DRAFT_ATTACHMENT_THREAD_INDEX, "threadId");
        }
      });
      request.addEventListener("success", () => {
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          composerDraftAttachmentDbPromise = null;
        };
        resolve(database);
      });
      request.addEventListener("error", () => {
        composerDraftAttachmentDbPromise = null;
        resolve(null);
      });
      request.addEventListener("blocked", () => {
        composerDraftAttachmentDbPromise = null;
        resolve(null);
      });
    });
  }
  return composerDraftAttachmentDbPromise;
}

async function readComposerDraftAttachmentRecords(
  threadId: ThreadId,
): Promise<Array<ComposerDraftAttachmentRecord | LegacyComposerDraftAttachmentRecord>> {
  const database = await openComposerDraftAttachmentDatabase();
  if (!database) {
    return [];
  }
  try {
    const transaction = database.transaction(COMPOSER_DRAFT_ATTACHMENT_STORE_NAME, "readonly");
    const store = transaction.objectStore(COMPOSER_DRAFT_ATTACHMENT_STORE_NAME);
    const index = store.index(COMPOSER_DRAFT_ATTACHMENT_THREAD_INDEX);
    const records = await requestToPromise(index.getAll(threadId));
    await transactionToPromise(transaction);
    return records as Array<ComposerDraftAttachmentRecord | LegacyComposerDraftAttachmentRecord>;
  } catch {
    return [];
  }
}

async function putComposerDraftAttachment(
  threadId: ThreadId,
  attachment: PersistedComposerImageAttachment,
): Promise<void> {
  const database = await openComposerDraftAttachmentDatabase();
  if (!database) {
    throw new Error("IndexedDB unavailable.");
  }
  const transaction = database.transaction(COMPOSER_DRAFT_ATTACHMENT_STORE_NAME, "readwrite");
  const store = transaction.objectStore(COMPOSER_DRAFT_ATTACHMENT_STORE_NAME);
  store.put(createComposerDraftAttachmentRecord(threadId, attachment));
  await transactionToPromise(transaction);
}

async function deleteComposerDraftAttachment(
  threadId: ThreadId,
  attachmentId: string,
): Promise<void> {
  const database = await openComposerDraftAttachmentDatabase();
  if (!database) {
    return;
  }
  try {
    const transaction = database.transaction(COMPOSER_DRAFT_ATTACHMENT_STORE_NAME, "readwrite");
    const store = transaction.objectStore(COMPOSER_DRAFT_ATTACHMENT_STORE_NAME);
    store.delete(attachmentStorageKey(threadId, attachmentId));
    await transactionToPromise(transaction);
  } catch {
    // Best-effort cleanup only.
  }
}

export function isQuotaExceededError(error: unknown): boolean {
  if (!(error instanceof DOMException)) {
    return false;
  }
  return (
    error.name === "QuotaExceededError" ||
    error.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    error.code === 22 ||
    error.code === 1014
  );
}

export function normalizePersistedComposerImageAttachmentMetadata(
  value: unknown,
): PersistedComposerImageAttachmentMetadata | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const id = candidate.id;
  const name = candidate.name;
  const mimeType = candidate.mimeType;
  const sizeBytes = candidate.sizeBytes;
  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    typeof mimeType !== "string" ||
    typeof sizeBytes !== "number" ||
    !Number.isFinite(sizeBytes) ||
    id.length === 0
  ) {
    return null;
  }
  return {
    id,
    name,
    mimeType,
    sizeBytes,
  };
}

export function normalizePersistedComposerImageAttachment(
  value: unknown,
): PersistedComposerImageAttachment | null {
  const metadata = normalizePersistedComposerImageAttachmentMetadata(value);
  if (!metadata) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const blob = candidate.blob;
  if (!(blob instanceof Blob)) {
    return null;
  }
  return {
    ...metadata,
    blob,
  };
}

export function normalizeLegacyPersistedComposerImageAttachment(
  value: unknown,
): LegacyPersistedComposerImageAttachment | null {
  const metadata = normalizePersistedComposerImageAttachmentMetadata(value);
  if (!metadata) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const dataUrl = candidate.dataUrl;
  if (typeof dataUrl !== "string" || dataUrl.length === 0) {
    return null;
  }
  return {
    ...metadata,
    dataUrl,
  };
}

export function toPersistedComposerImageAttachmentMetadata(
  attachment: PersistedComposerImageAttachment | PersistedComposerImageAttachmentMetadata,
): PersistedComposerImageAttachmentMetadata {
  return {
    id: attachment.id,
    name: attachment.name,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
  };
}

export async function loadPersistedComposerDraftAttachments(
  threadId: ThreadId,
  attachmentMetadata: PersistedComposerImageAttachmentMetadata[],
): Promise<PersistedComposerImageAttachment[]> {
  if (threadId.length === 0 || attachmentMetadata.length === 0) {
    return [];
  }
  const records = await readComposerDraftAttachmentRecords(threadId);
  if (records.length === 0) {
    return [];
  }
  const recordById = new Map(records.map((record) => [record.id, record]));
  return attachmentMetadata.flatMap((metadata) => {
    const record = recordById.get(metadata.id);
    if (!record) {
      return [];
    }
    const persistedRecord = normalizePersistedComposerImageAttachment(record);
    if (persistedRecord) {
      return [persistedRecord];
    }
    const legacyRecord = normalizeLegacyPersistedComposerImageAttachment(record);
    if (!legacyRecord) {
      return [];
    }
    const payload = legacyDataUrlToPayload(legacyRecord);
    if (!payload) {
      return [];
    }
    void putComposerDraftAttachment(threadId, payload).catch(() => undefined);
    return [payload];
  });
}

export async function persistComposerDraftAttachments(
  threadId: ThreadId,
  attachments: PersistedComposerImageAttachment[],
): Promise<Set<string>> {
  if (threadId.length === 0) {
    return new Set();
  }
  const existingAttachments = await readComposerDraftAttachmentRecords(threadId);
  const nextAttachmentIdSet = new Set(attachments.map((attachment) => attachment.id));

  await Promise.all(
    existingAttachments
      .filter((attachment) => !nextAttachmentIdSet.has(attachment.id))
      .map((attachment) => deleteComposerDraftAttachment(threadId, attachment.id)),
  );

  const persistedAttachmentIds = new Set<string>();
  for (const attachment of attachments) {
    try {
      await putComposerDraftAttachment(threadId, attachment);
      persistedAttachmentIds.add(attachment.id);
    } catch (error) {
      if (!isQuotaExceededError(error)) {
        continue;
      }
    }
  }
  return persistedAttachmentIds;
}

export async function removePersistedComposerDraftAttachment(
  threadId: ThreadId,
  attachmentId: string,
): Promise<void> {
  if (threadId.length === 0 || attachmentId.length === 0) {
    return;
  }
  await deleteComposerDraftAttachment(threadId, attachmentId);
}

export async function clearPersistedComposerDraftAttachments(threadId: ThreadId): Promise<void> {
  if (threadId.length === 0) {
    return;
  }
  const existingAttachments = await readComposerDraftAttachmentRecords(threadId);
  await Promise.all(
    existingAttachments.map((attachment) => deleteComposerDraftAttachment(threadId, attachment.id)),
  );
}
