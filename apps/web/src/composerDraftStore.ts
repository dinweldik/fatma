import {
  DEFAULT_REASONING_EFFORT_BY_PROVIDER,
  ProjectId,
  REASONING_EFFORT_OPTIONS_BY_PROVIDER,
  ThreadId,
  type ProviderKind,
  type ProviderInteractionMode,
  type ProviderModelOptions,
  type ProviderReasoningEffort,
  type RuntimeMode,
} from "@fatma/contracts";
import { normalizeModelSlug } from "@fatma/shared/model";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE } from "./types";
import { create } from "zustand";
import { type PersistStorage, type StorageValue, persist } from "zustand/middleware";
import {
  clearPersistedComposerDraftAttachments,
  isQuotaExceededError,
  loadPersistedComposerDraftAttachments,
  normalizeLegacyPersistedComposerImageAttachment,
  normalizePersistedComposerImageAttachmentMetadata,
  persistComposerDraftAttachments,
  removePersistedComposerDraftAttachment,
  toPersistedComposerImageAttachmentMetadata,
  type PersistedComposerImageAttachment,
  type PersistedComposerImageAttachmentMetadata,
} from "./composerDraftAttachmentPersistence";
import {
  legacyDataUrlToPayload,
  payloadToComposerImageAttachment,
  type ComposerImageAttachment,
  type ComposerImageAttachmentPayload,
  type ComposerImageSnapshot,
} from "./composerImageSnapshots";

export const COMPOSER_DRAFT_STORAGE_KEY = "fatma:composer-drafts:v1";
export type DraftThreadEnvMode = "local" | "worktree";
export type {
  PersistedComposerImageAttachment,
  PersistedComposerImageAttachmentMetadata,
} from "./composerDraftAttachmentPersistence";
export type {
  ComposerImageAttachment,
  ComposerImageAttachmentPayload,
  ComposerImageSnapshot,
} from "./composerImageSnapshots";

interface PersistedComposerThreadDraftState {
  prompt: string;
  attachments: PersistedComposerImageAttachmentMetadata[];
  provider?: ProviderKind | null;
  model?: string | null;
  runtimeMode?: RuntimeMode | null;
  interactionMode?: ProviderInteractionMode | null;
  effort?: ProviderReasoningEffort | null;
  codexFastMode?: boolean | null;
  serviceTier?: string | null;
  modelOptions?: ProviderModelOptions | null;
}

interface PersistedDraftThreadState {
  projectId: ProjectId;
  createdAt: string;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  branch: string | null;
  worktreePath: string | null;
  envMode: DraftThreadEnvMode;
}

interface PersistedComposerDraftStoreState {
  draftsByThreadId: Record<ThreadId, PersistedComposerThreadDraftState>;
  draftThreadsByThreadId: Record<ThreadId, PersistedDraftThreadState>;
  projectDraftThreadIdByProjectId: Record<ProjectId, ThreadId>;
}

interface ComposerThreadDraftState {
  prompt: string;
  images: ComposerImageAttachment[];
  attachmentPayloads: ComposerImageAttachmentPayload[];
  nonPersistedImageIds: string[];
  persistedAttachmentMetadata: PersistedComposerImageAttachmentMetadata[];
  provider: ProviderKind | null;
  model: string | null;
  runtimeMode: RuntimeMode | null;
  interactionMode: ProviderInteractionMode | null;
  effort: ProviderReasoningEffort | null;
  codexFastMode: boolean;
  modelOptions: ProviderModelOptions | null;
}

export interface DraftThreadState {
  projectId: ProjectId;
  createdAt: string;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  branch: string | null;
  worktreePath: string | null;
  envMode: DraftThreadEnvMode;
}

interface ProjectDraftThread extends DraftThreadState {
  threadId: ThreadId;
}

interface ComposerDraftStoreState {
  draftsByThreadId: Record<ThreadId, ComposerThreadDraftState>;
  draftThreadsByThreadId: Record<ThreadId, DraftThreadState>;
  projectDraftThreadIdByProjectId: Record<ProjectId, ThreadId>;
  getDraftThreadByProjectId: (projectId: ProjectId) => ProjectDraftThread | null;
  getDraftThread: (threadId: ThreadId) => DraftThreadState | null;
  setProjectDraftThreadId: (
    projectId: ProjectId,
    threadId: ThreadId,
    options?: {
      branch?: string | null;
      worktreePath?: string | null;
      createdAt?: string;
      envMode?: DraftThreadEnvMode;
      runtimeMode?: RuntimeMode;
      interactionMode?: ProviderInteractionMode;
    },
  ) => void;
  setDraftThreadContext: (
    threadId: ThreadId,
    options: {
      branch?: string | null;
      worktreePath?: string | null;
      projectId?: ProjectId;
      createdAt?: string;
      envMode?: DraftThreadEnvMode;
      runtimeMode?: RuntimeMode;
      interactionMode?: ProviderInteractionMode;
    },
  ) => void;
  clearProjectDraftThreadId: (projectId: ProjectId) => void;
  clearProjectDraftThreadById: (projectId: ProjectId, threadId: ThreadId) => void;
  clearDraftThread: (threadId: ThreadId) => void;
  setPrompt: (threadId: ThreadId, prompt: string) => void;
  setProvider: (threadId: ThreadId, provider: ProviderKind | null | undefined) => void;
  setModel: (threadId: ThreadId, model: string | null | undefined) => void;
  setRuntimeMode: (threadId: ThreadId, runtimeMode: RuntimeMode | null | undefined) => void;
  setInteractionMode: (
    threadId: ThreadId,
    interactionMode: ProviderInteractionMode | null | undefined,
  ) => void;
  setEffort: (threadId: ThreadId, effort: ProviderReasoningEffort | null | undefined) => void;
  setCodexFastMode: (threadId: ThreadId, enabled: boolean | null | undefined) => void;
  setProviderModelOptions: (
    threadId: ThreadId,
    provider: ProviderKind,
    options: ProviderModelOptions[ProviderKind] | null | undefined,
    opts?: { persistSticky?: boolean },
  ) => void;
  addImageSnapshots: (threadId: ThreadId, snapshots: ComposerImageSnapshot[]) => void;
  removeImage: (threadId: ThreadId, imageId: string) => void;
  clearComposerContent: (threadId: ThreadId) => void;
  clearThreadDraft: (threadId: ThreadId) => void;
}

const EMPTY_PERSISTED_DRAFT_STORE_STATE: PersistedComposerDraftStoreState = {
  draftsByThreadId: {},
  draftThreadsByThreadId: {},
  projectDraftThreadIdByProjectId: {},
};

const EMPTY_IMAGES: ComposerImageAttachment[] = [];
const EMPTY_ATTACHMENT_PAYLOADS: ComposerImageAttachmentPayload[] = [];
const EMPTY_IDS: string[] = [];
const EMPTY_PERSISTED_ATTACHMENT_METADATA: PersistedComposerImageAttachmentMetadata[] = [];
Object.freeze(EMPTY_IMAGES);
Object.freeze(EMPTY_ATTACHMENT_PAYLOADS);
Object.freeze(EMPTY_IDS);
Object.freeze(EMPTY_PERSISTED_ATTACHMENT_METADATA);
const EMPTY_THREAD_DRAFT = Object.freeze({
  prompt: "",
  images: EMPTY_IMAGES,
  attachmentPayloads: EMPTY_ATTACHMENT_PAYLOADS,
  nonPersistedImageIds: EMPTY_IDS,
  persistedAttachmentMetadata: EMPTY_PERSISTED_ATTACHMENT_METADATA,
  provider: null,
  model: null,
  runtimeMode: null,
  interactionMode: null,
  effort: null,
  codexFastMode: false,
  modelOptions: null,
}) as ComposerThreadDraftState;

const REASONING_EFFORT_VALUES = new Set<ProviderReasoningEffort>(
  Object.values(REASONING_EFFORT_OPTIONS_BY_PROVIDER).flat(),
);
const composerDraftAttachmentSyncVersionByThreadId = new Map<ThreadId, number>();
let legacyPersistedAttachmentsByThreadId: Record<ThreadId, PersistedComposerImageAttachment[]> = {};

interface ParsedPersistedComposerDraftStoreState {
  state: PersistedComposerDraftStoreState;
  legacyAttachmentsByThreadId: Record<ThreadId, PersistedComposerImageAttachment[]>;
}

function createEmptyThreadDraft(): ComposerThreadDraftState {
  return {
    prompt: "",
    images: [],
    attachmentPayloads: [],
    nonPersistedImageIds: [],
    persistedAttachmentMetadata: [],
    provider: null,
    model: null,
    runtimeMode: null,
    interactionMode: null,
    effort: null,
    codexFastMode: false,
    modelOptions: null,
  };
}

function composerImageDedupKey(image: ComposerImageAttachment): string {
  return `${image.mimeType}\u0000${image.sizeBytes}\u0000${image.name}`;
}

function shouldRemoveDraft(draft: ComposerThreadDraftState): boolean {
  return (
    draft.prompt.length === 0 &&
    draft.images.length === 0 &&
    draft.persistedAttachmentMetadata.length === 0 &&
    draft.provider === null &&
    draft.model === null &&
    draft.runtimeMode === null &&
    draft.interactionMode === null &&
    draft.effort === null &&
    draft.codexFastMode === false &&
    draft.modelOptions === null
  );
}

function normalizeProviderKind(value: unknown): ProviderKind | null {
  return value === "codex" || value === "claudeAgent" ? value : null;
}

function revokeObjectPreviewUrl(previewUrl: string): void {
  if (typeof URL === "undefined") {
    return;
  }
  if (!previewUrl.startsWith("blob:")) {
    return;
  }
  URL.revokeObjectURL(previewUrl);
}

function nextComposerDraftAttachmentSyncVersion(threadId: ThreadId): number {
  const nextVersion = (composerDraftAttachmentSyncVersionByThreadId.get(threadId) ?? 0) + 1;
  composerDraftAttachmentSyncVersionByThreadId.set(threadId, nextVersion);
  return nextVersion;
}

function isLatestComposerDraftAttachmentSyncVersion(threadId: ThreadId, version: number): boolean {
  return composerDraftAttachmentSyncVersionByThreadId.get(threadId) === version;
}

function clearComposerDraftAttachmentSyncVersion(threadId: ThreadId): void {
  composerDraftAttachmentSyncVersionByThreadId.delete(threadId);
}

function scheduleComposerDraftAttachmentClear(threadId: ThreadId): void {
  delete legacyPersistedAttachmentsByThreadId[threadId];
  clearComposerDraftAttachmentSyncVersion(threadId);
  void clearPersistedComposerDraftAttachments(threadId);
}

function mergeComposerImages(
  currentImages: ComposerImageAttachment[],
  incomingImages: ComposerImageAttachment[],
): ComposerImageAttachment[] {
  if (incomingImages.length === 0) {
    return currentImages;
  }
  const nextImages = [...currentImages];
  const seenImageIds = new Set(currentImages.map((image) => image.id));
  const seenDedupKeys = new Set(currentImages.map((image) => composerImageDedupKey(image)));
  for (const image of incomingImages) {
    const dedupKey = composerImageDedupKey(image);
    if (seenImageIds.has(image.id) || seenDedupKeys.has(dedupKey)) {
      continue;
    }
    nextImages.push(image);
    seenImageIds.add(image.id);
    seenDedupKeys.add(dedupKey);
  }
  return nextImages;
}

function mergeComposerAttachmentPayloads(
  currentPayloads: ComposerImageAttachmentPayload[],
  incomingPayloads: ComposerImageAttachmentPayload[],
): ComposerImageAttachmentPayload[] {
  return Array.from(
    new Map(
      [...currentPayloads, ...incomingPayloads].map((payload) => [payload.id, payload]),
    ).values(),
  );
}

function filterAttachmentPayloadsForImages(
  images: ComposerImageAttachment[],
  payloads: ComposerImageAttachmentPayload[],
): ComposerImageAttachmentPayload[] {
  const imageIdSet = new Set(images.map((image) => image.id));
  return payloads.filter((payload) => imageIdSet.has(payload.id));
}

function normalizeDraftThreadEnvMode(
  value: unknown,
  fallbackWorktreePath: string | null,
): DraftThreadEnvMode {
  if (value === "local" || value === "worktree") {
    return value;
  }
  return fallbackWorktreePath ? "worktree" : "local";
}

function normalizePersistedComposerDraftState(
  value: unknown,
): ParsedPersistedComposerDraftStoreState {
  if (!value || typeof value !== "object") {
    return {
      state: EMPTY_PERSISTED_DRAFT_STORE_STATE,
      legacyAttachmentsByThreadId: {},
    };
  }
  const candidate = value as Record<string, unknown>;
  const rawDraftMap = candidate.draftsByThreadId;
  const rawDraftThreadsByThreadId = candidate.draftThreadsByThreadId;
  const rawProjectDraftThreadIdByProjectId = candidate.projectDraftThreadIdByProjectId;
  const legacyAttachmentsByThreadId: Record<ThreadId, PersistedComposerImageAttachment[]> = {};
  const draftThreadsByThreadId: PersistedComposerDraftStoreState["draftThreadsByThreadId"] = {};
  if (rawDraftThreadsByThreadId && typeof rawDraftThreadsByThreadId === "object") {
    for (const [threadId, rawDraftThread] of Object.entries(
      rawDraftThreadsByThreadId as Record<string, unknown>,
    )) {
      if (typeof threadId !== "string" || threadId.length === 0) {
        continue;
      }
      if (!rawDraftThread || typeof rawDraftThread !== "object") {
        continue;
      }
      const candidateDraftThread = rawDraftThread as Record<string, unknown>;
      const projectId = candidateDraftThread.projectId;
      const createdAt = candidateDraftThread.createdAt;
      const branch = candidateDraftThread.branch;
      const worktreePath = candidateDraftThread.worktreePath;
      const normalizedWorktreePath = typeof worktreePath === "string" ? worktreePath : null;
      if (typeof projectId !== "string" || projectId.length === 0) {
        continue;
      }
      draftThreadsByThreadId[threadId as ThreadId] = {
        projectId: projectId as ProjectId,
        createdAt:
          typeof createdAt === "string" && createdAt.length > 0
            ? createdAt
            : new Date().toISOString(),
        runtimeMode:
          candidateDraftThread.runtimeMode === "approval-required" ||
          candidateDraftThread.runtimeMode === "full-access"
            ? candidateDraftThread.runtimeMode
            : DEFAULT_RUNTIME_MODE,
        interactionMode:
          candidateDraftThread.interactionMode === "plan" ||
          candidateDraftThread.interactionMode === "default"
            ? candidateDraftThread.interactionMode
            : DEFAULT_INTERACTION_MODE,
        branch: typeof branch === "string" ? branch : null,
        worktreePath: normalizedWorktreePath,
        envMode: normalizeDraftThreadEnvMode(candidateDraftThread.envMode, normalizedWorktreePath),
      };
    }
  }
  const projectDraftThreadIdByProjectId: PersistedComposerDraftStoreState["projectDraftThreadIdByProjectId"] =
    {};
  if (
    rawProjectDraftThreadIdByProjectId &&
    typeof rawProjectDraftThreadIdByProjectId === "object"
  ) {
    for (const [projectId, threadId] of Object.entries(
      rawProjectDraftThreadIdByProjectId as Record<string, unknown>,
    )) {
      if (
        typeof projectId === "string" &&
        projectId.length > 0 &&
        typeof threadId === "string" &&
        threadId.length > 0
      ) {
        projectDraftThreadIdByProjectId[projectId as ProjectId] = threadId as ThreadId;
        if (!draftThreadsByThreadId[threadId as ThreadId]) {
          draftThreadsByThreadId[threadId as ThreadId] = {
            projectId: projectId as ProjectId,
            createdAt: new Date().toISOString(),
            runtimeMode: DEFAULT_RUNTIME_MODE,
            interactionMode: DEFAULT_INTERACTION_MODE,
            branch: null,
            worktreePath: null,
            envMode: "local",
          };
        } else if (draftThreadsByThreadId[threadId as ThreadId]?.projectId !== projectId) {
          draftThreadsByThreadId[threadId as ThreadId] = {
            ...draftThreadsByThreadId[threadId as ThreadId]!,
            projectId: projectId as ProjectId,
          };
        }
      }
    }
  }
  if (!rawDraftMap || typeof rawDraftMap !== "object") {
    return {
      state: {
        draftsByThreadId: {},
        draftThreadsByThreadId,
        projectDraftThreadIdByProjectId,
      },
      legacyAttachmentsByThreadId,
    };
  }
  const nextDraftsByThreadId: PersistedComposerDraftStoreState["draftsByThreadId"] = {};
  for (const [threadId, draftValue] of Object.entries(rawDraftMap as Record<string, unknown>)) {
    if (typeof threadId !== "string" || threadId.length === 0) {
      continue;
    }
    if (!draftValue || typeof draftValue !== "object") {
      continue;
    }
    const draftCandidate = draftValue as Record<string, unknown>;
    const prompt = typeof draftCandidate.prompt === "string" ? draftCandidate.prompt : "";
    const attachments = Array.isArray(draftCandidate.attachments)
      ? draftCandidate.attachments.flatMap((entry) => {
          const normalized = normalizePersistedComposerImageAttachmentMetadata(entry);
          return normalized ? [normalized] : [];
        })
      : [];
    const legacyAttachments = Array.isArray(draftCandidate.attachments)
      ? draftCandidate.attachments.flatMap((entry) => {
          const normalized = normalizeLegacyPersistedComposerImageAttachment(entry);
          if (!normalized) {
            return [];
          }
          const payload = legacyDataUrlToPayload(normalized);
          return payload ? [payload] : [];
        })
      : [];
    const provider = normalizeProviderKind(draftCandidate.provider);
    const model =
      typeof draftCandidate.model === "string"
        ? normalizeModelSlug(draftCandidate.model, provider ?? "codex")
        : null;
    const runtimeMode =
      draftCandidate.runtimeMode === "approval-required" ||
      draftCandidate.runtimeMode === "full-access"
        ? draftCandidate.runtimeMode
        : null;
    const interactionMode =
      draftCandidate.interactionMode === "plan" || draftCandidate.interactionMode === "default"
        ? draftCandidate.interactionMode
        : null;
    const effortCandidate =
      typeof draftCandidate.effort === "string" ? draftCandidate.effort : null;
    const effort =
      effortCandidate && REASONING_EFFORT_VALUES.has(effortCandidate as ProviderReasoningEffort)
        ? (effortCandidate as ProviderReasoningEffort)
        : null;
    const codexFastMode =
      draftCandidate.codexFastMode === true ||
      (typeof draftCandidate.serviceTier === "string" && draftCandidate.serviceTier === "fast");
    const modelOptions =
      draftCandidate.modelOptions &&
      typeof draftCandidate.modelOptions === "object" &&
      !Array.isArray(draftCandidate.modelOptions)
        ? (draftCandidate.modelOptions as ProviderModelOptions)
        : null;
    if (
      prompt.length === 0 &&
      attachments.length === 0 &&
      !provider &&
      !model &&
      !runtimeMode &&
      !interactionMode &&
      !effort &&
      !codexFastMode &&
      !modelOptions
    ) {
      continue;
    }
    if (legacyAttachments.length > 0) {
      legacyAttachmentsByThreadId[threadId as ThreadId] = legacyAttachments;
    }
    nextDraftsByThreadId[threadId as ThreadId] = {
      prompt,
      attachments,
      ...(provider ? { provider } : {}),
      ...(model ? { model } : {}),
      ...(runtimeMode ? { runtimeMode } : {}),
      ...(interactionMode ? { interactionMode } : {}),
      ...(effort ? { effort } : {}),
      ...(codexFastMode ? { codexFastMode } : {}),
      ...(modelOptions ? { modelOptions } : {}),
    };
  }
  return {
    state: {
      draftsByThreadId: nextDraftsByThreadId,
      draftThreadsByThreadId,
      projectDraftThreadIdByProjectId,
    },
    legacyAttachmentsByThreadId,
  };
}

function parsePersistedDraftStateRaw(raw: string | null): ParsedPersistedComposerDraftStoreState {
  if (!raw) {
    return {
      state: EMPTY_PERSISTED_DRAFT_STORE_STATE,
      legacyAttachmentsByThreadId: {},
    };
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && "state" in parsed) {
      return normalizePersistedComposerDraftState((parsed as { state?: unknown }).state);
    }
    return normalizePersistedComposerDraftState(parsed);
  } catch {
    return {
      state: EMPTY_PERSISTED_DRAFT_STORE_STATE,
      legacyAttachmentsByThreadId: {},
    };
  }
}

function hydrateImagesFromPersisted(
  attachments: PersistedComposerImageAttachment[],
): ComposerImageAttachment[] {
  return attachments.map((attachment) => payloadToComposerImageAttachment(attachment));
}

function toHydratedThreadDraft(
  persistedDraft: PersistedComposerThreadDraftState,
): ComposerThreadDraftState {
  return {
    prompt: persistedDraft.prompt,
    images: [],
    attachmentPayloads: [],
    nonPersistedImageIds: [],
    persistedAttachmentMetadata: persistedDraft.attachments,
    provider: persistedDraft.provider ?? null,
    model: persistedDraft.model ?? null,
    runtimeMode: persistedDraft.runtimeMode ?? null,
    interactionMode: persistedDraft.interactionMode ?? null,
    effort: persistedDraft.effort ?? null,
    codexFastMode: persistedDraft.codexFastMode === true,
    modelOptions: persistedDraft.modelOptions ?? null,
  };
}

export function createComposerDraftPersistStorage():
  | PersistStorage<PersistedComposerDraftStoreState>
  | undefined {
  if (typeof localStorage === "undefined") {
    return undefined;
  }
  return {
    getItem: (name) => {
      try {
        const parsed = parsePersistedDraftStateRaw(localStorage.getItem(name));
        legacyPersistedAttachmentsByThreadId = parsed.legacyAttachmentsByThreadId;
        return {
          state: parsed.state,
          version: 2,
        } satisfies StorageValue<PersistedComposerDraftStoreState>;
      } catch {
        legacyPersistedAttachmentsByThreadId = {};
        return null;
      }
    },
    setItem: (name, value) => {
      try {
        localStorage.setItem(name, JSON.stringify(value));
      } catch (error) {
        if (isQuotaExceededError(error)) {
          return;
        }
      }
    },
    removeItem: (name) => {
      try {
        localStorage.removeItem(name);
      } catch {
        // Best-effort persistence only.
      }
    },
  };
}

async function hydrateComposerDraftAttachmentsAfterRehydrate(
  state: ComposerDraftStoreState,
): Promise<void> {
  const threadIds = Object.keys(state.draftsByThreadId) as ThreadId[];
  for (const threadId of threadIds) {
    const currentDraft = useComposerDraftStore.getState().draftsByThreadId[threadId];
    if (!currentDraft) {
      continue;
    }
    const legacyAttachments = legacyPersistedAttachmentsByThreadId[threadId] ?? [];
    delete legacyPersistedAttachmentsByThreadId[threadId];
    const persistedAttachments =
      legacyAttachments.length > 0
        ? legacyAttachments
        : await loadPersistedComposerDraftAttachments(
            threadId,
            currentDraft.persistedAttachmentMetadata,
          );
    const persistedAttachmentIds =
      legacyAttachments.length > 0
        ? await persistComposerDraftAttachments(threadId, legacyAttachments)
        : new Set(persistedAttachments.map((attachment) => attachment.id));
    const hydratedImages = hydrateImagesFromPersisted(persistedAttachments);
    setComposerDraftAttachmentHydration(threadId, {
      images: hydratedImages,
      attachmentPayloads: persistedAttachments,
      nonPersistedImageIds:
        legacyAttachments.length > 0
          ? hydratedImages
              .map((image) => image.id)
              .filter((imageId) => !persistedAttachmentIds.has(imageId))
          : [],
    });
  }
}

function setComposerDraftAttachmentHydration(
  threadId: ThreadId,
  input: {
    images: ComposerImageAttachment[];
    attachmentPayloads: ComposerImageAttachmentPayload[];
    nonPersistedImageIds: string[];
  },
): void {
  useComposerDraftStore.setState((state) => {
    const current = state.draftsByThreadId[threadId];
    if (!current) {
      return state;
    }
    const mergedImages = mergeComposerImages(current.images, input.images);
    const mergedAttachmentPayloads = filterAttachmentPayloadsForImages(
      mergedImages,
      mergeComposerAttachmentPayloads(current.attachmentPayloads, input.attachmentPayloads),
    );
    const mergedImageIdSet = new Set(mergedImages.map((image) => image.id));
    const nextNonPersistedImageIds = Array.from(
      new Set([
        ...current.nonPersistedImageIds.filter((imageId) => mergedImageIdSet.has(imageId)),
        ...input.nonPersistedImageIds.filter((imageId) => mergedImageIdSet.has(imageId)),
      ]),
    );
    const nonPersistedImageIdSet = new Set(nextNonPersistedImageIds);
    const persistedAttachmentMetadata = mergedAttachmentPayloads
      .filter((attachment) => !nonPersistedImageIdSet.has(attachment.id))
      .map(toPersistedComposerImageAttachmentMetadata);
    const nextDraft: ComposerThreadDraftState = {
      ...current,
      images: mergedImages,
      attachmentPayloads: mergedAttachmentPayloads,
      persistedAttachmentMetadata,
      nonPersistedImageIds: nextNonPersistedImageIds,
    };
    const nextDraftsByThreadId = { ...state.draftsByThreadId };
    if (shouldRemoveDraft(nextDraft)) {
      delete nextDraftsByThreadId[threadId];
    } else {
      nextDraftsByThreadId[threadId] = nextDraft;
    }
    return { draftsByThreadId: nextDraftsByThreadId };
  });
}

function scheduleComposerDraftAttachmentSync(threadId: ThreadId): void {
  delete legacyPersistedAttachmentsByThreadId[threadId];
  const syncVersion = nextComposerDraftAttachmentSyncVersion(threadId);
  void (async () => {
    const current = useComposerDraftStore.getState().draftsByThreadId[threadId];
    if (!current) {
      return;
    }
    const attachmentPayloads = filterAttachmentPayloadsForImages(
      current.images,
      current.attachmentPayloads,
    );
    const persistedIdSet = await persistComposerDraftAttachments(threadId, attachmentPayloads);
    if (!isLatestComposerDraftAttachmentSyncVersion(threadId, syncVersion)) {
      return;
    }
    useComposerDraftStore.setState((state) => {
      const latestDraft = state.draftsByThreadId[threadId];
      if (!latestDraft) {
        return state;
      }
      const syncedAttachmentPayloads = filterAttachmentPayloadsForImages(
        latestDraft.images,
        latestDraft.attachmentPayloads,
      );
      const nonPersistedImageIds = syncedAttachmentPayloads
        .map((attachment) => attachment.id)
        .filter((imageId) => !persistedIdSet.has(imageId));
      const nextDraft: ComposerThreadDraftState = {
        ...latestDraft,
        attachmentPayloads: syncedAttachmentPayloads,
        persistedAttachmentMetadata: syncedAttachmentPayloads
          .filter((attachment) => persistedIdSet.has(attachment.id))
          .map(toPersistedComposerImageAttachmentMetadata),
        nonPersistedImageIds,
      };
      const nextDraftsByThreadId = { ...state.draftsByThreadId };
      if (shouldRemoveDraft(nextDraft)) {
        delete nextDraftsByThreadId[threadId];
      } else {
        nextDraftsByThreadId[threadId] = nextDraft;
      }
      return { draftsByThreadId: nextDraftsByThreadId };
    });
  })();
}

export const useComposerDraftStore = create<ComposerDraftStoreState>()(
  persist(
    (set, get) => ({
      draftsByThreadId: {},
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
      getDraftThreadByProjectId: (projectId) => {
        if (projectId.length === 0) {
          return null;
        }
        const threadId = get().projectDraftThreadIdByProjectId[projectId];
        if (!threadId) {
          return null;
        }
        const draftThread = get().draftThreadsByThreadId[threadId];
        if (!draftThread || draftThread.projectId !== projectId) {
          return null;
        }
        return {
          threadId,
          ...draftThread,
        };
      },
      getDraftThread: (threadId) => {
        if (threadId.length === 0) {
          return null;
        }
        return get().draftThreadsByThreadId[threadId] ?? null;
      },
      setProjectDraftThreadId: (projectId, threadId, options) => {
        if (projectId.length === 0 || threadId.length === 0) {
          return;
        }
        set((state) => {
          const existingThread = state.draftThreadsByThreadId[threadId];
          const previousThreadIdForProject = state.projectDraftThreadIdByProjectId[projectId];
          const nextWorktreePath =
            options?.worktreePath === undefined
              ? (existingThread?.worktreePath ?? null)
              : (options.worktreePath ?? null);
          const nextDraftThread: DraftThreadState = {
            projectId,
            createdAt: options?.createdAt ?? existingThread?.createdAt ?? new Date().toISOString(),
            runtimeMode:
              options?.runtimeMode ?? existingThread?.runtimeMode ?? DEFAULT_RUNTIME_MODE,
            interactionMode:
              options?.interactionMode ??
              existingThread?.interactionMode ??
              DEFAULT_INTERACTION_MODE,
            branch:
              options?.branch === undefined
                ? (existingThread?.branch ?? null)
                : (options.branch ?? null),
            worktreePath: nextWorktreePath,
            envMode:
              options?.envMode ??
              (nextWorktreePath ? "worktree" : (existingThread?.envMode ?? "local")),
          };
          const hasSameProjectMapping = previousThreadIdForProject === threadId;
          const hasSameDraftThread =
            existingThread &&
            existingThread.projectId === nextDraftThread.projectId &&
            existingThread.createdAt === nextDraftThread.createdAt &&
            existingThread.runtimeMode === nextDraftThread.runtimeMode &&
            existingThread.interactionMode === nextDraftThread.interactionMode &&
            existingThread.branch === nextDraftThread.branch &&
            existingThread.worktreePath === nextDraftThread.worktreePath &&
            existingThread.envMode === nextDraftThread.envMode;
          if (hasSameProjectMapping && hasSameDraftThread) {
            return state;
          }
          const nextProjectDraftThreadIdByProjectId: Record<ProjectId, ThreadId> = {
            ...state.projectDraftThreadIdByProjectId,
            [projectId]: threadId,
          };
          const nextDraftThreadsByThreadId: Record<ThreadId, DraftThreadState> = {
            ...state.draftThreadsByThreadId,
            [threadId]: nextDraftThread,
          };
          let nextDraftsByThreadId = state.draftsByThreadId;
          if (
            previousThreadIdForProject &&
            previousThreadIdForProject !== threadId &&
            !Object.values(nextProjectDraftThreadIdByProjectId).includes(previousThreadIdForProject)
          ) {
            scheduleComposerDraftAttachmentClear(previousThreadIdForProject);
            delete nextDraftThreadsByThreadId[previousThreadIdForProject];
            if (state.draftsByThreadId[previousThreadIdForProject] !== undefined) {
              nextDraftsByThreadId = { ...state.draftsByThreadId };
              delete nextDraftsByThreadId[previousThreadIdForProject];
            }
          }
          return {
            draftsByThreadId: nextDraftsByThreadId,
            draftThreadsByThreadId: nextDraftThreadsByThreadId,
            projectDraftThreadIdByProjectId: nextProjectDraftThreadIdByProjectId,
          };
        });
      },
      setDraftThreadContext: (threadId, options) => {
        if (threadId.length === 0) {
          return;
        }
        set((state) => {
          const existing = state.draftThreadsByThreadId[threadId];
          if (!existing) {
            return state;
          }
          const nextProjectId = options.projectId ?? existing.projectId;
          if (nextProjectId.length === 0) {
            return state;
          }
          const nextWorktreePath =
            options.worktreePath === undefined
              ? existing.worktreePath
              : (options.worktreePath ?? null);
          const nextDraftThread: DraftThreadState = {
            projectId: nextProjectId,
            createdAt:
              options.createdAt === undefined
                ? existing.createdAt
                : options.createdAt || existing.createdAt,
            runtimeMode: options.runtimeMode ?? existing.runtimeMode,
            interactionMode: options.interactionMode ?? existing.interactionMode,
            branch: options.branch === undefined ? existing.branch : (options.branch ?? null),
            worktreePath: nextWorktreePath,
            envMode:
              options.envMode ?? (nextWorktreePath ? "worktree" : (existing.envMode ?? "local")),
          };
          const isUnchanged =
            nextDraftThread.projectId === existing.projectId &&
            nextDraftThread.createdAt === existing.createdAt &&
            nextDraftThread.runtimeMode === existing.runtimeMode &&
            nextDraftThread.interactionMode === existing.interactionMode &&
            nextDraftThread.branch === existing.branch &&
            nextDraftThread.worktreePath === existing.worktreePath &&
            nextDraftThread.envMode === existing.envMode;
          if (isUnchanged) {
            return state;
          }
          const nextProjectDraftThreadIdByProjectId: Record<ProjectId, ThreadId> = {
            ...state.projectDraftThreadIdByProjectId,
            [nextProjectId]: threadId,
          };
          if (existing.projectId !== nextProjectId) {
            if (nextProjectDraftThreadIdByProjectId[existing.projectId] === threadId) {
              delete nextProjectDraftThreadIdByProjectId[existing.projectId];
            }
          }
          return {
            draftThreadsByThreadId: {
              ...state.draftThreadsByThreadId,
              [threadId]: nextDraftThread,
            },
            projectDraftThreadIdByProjectId: nextProjectDraftThreadIdByProjectId,
          };
        });
      },
      clearProjectDraftThreadId: (projectId) => {
        if (projectId.length === 0) {
          return;
        }
        set((state) => {
          const threadId = state.projectDraftThreadIdByProjectId[projectId];
          if (threadId === undefined) {
            return state;
          }
          const { [projectId]: _removed, ...restProjectMappingsRaw } =
            state.projectDraftThreadIdByProjectId;
          const restProjectMappings = restProjectMappingsRaw as Record<ProjectId, ThreadId>;
          const nextDraftThreadsByThreadId: Record<ThreadId, DraftThreadState> = {
            ...state.draftThreadsByThreadId,
          };
          let nextDraftsByThreadId = state.draftsByThreadId;
          if (!Object.values(restProjectMappings).includes(threadId)) {
            scheduleComposerDraftAttachmentClear(threadId);
            delete nextDraftThreadsByThreadId[threadId];
            if (state.draftsByThreadId[threadId] !== undefined) {
              nextDraftsByThreadId = { ...state.draftsByThreadId };
              delete nextDraftsByThreadId[threadId];
            }
          }
          return {
            draftsByThreadId: nextDraftsByThreadId,
            draftThreadsByThreadId: nextDraftThreadsByThreadId,
            projectDraftThreadIdByProjectId: restProjectMappings,
          };
        });
      },
      clearProjectDraftThreadById: (projectId, threadId) => {
        if (projectId.length === 0 || threadId.length === 0) {
          return;
        }
        set((state) => {
          if (state.projectDraftThreadIdByProjectId[projectId] !== threadId) {
            return state;
          }
          const { [projectId]: _removed, ...restProjectMappingsRaw } =
            state.projectDraftThreadIdByProjectId;
          const restProjectMappings = restProjectMappingsRaw as Record<ProjectId, ThreadId>;
          const nextDraftThreadsByThreadId: Record<ThreadId, DraftThreadState> = {
            ...state.draftThreadsByThreadId,
          };
          let nextDraftsByThreadId = state.draftsByThreadId;
          if (!Object.values(restProjectMappings).includes(threadId)) {
            scheduleComposerDraftAttachmentClear(threadId);
            delete nextDraftThreadsByThreadId[threadId];
            if (state.draftsByThreadId[threadId] !== undefined) {
              nextDraftsByThreadId = { ...state.draftsByThreadId };
              delete nextDraftsByThreadId[threadId];
            }
          }
          return {
            draftsByThreadId: nextDraftsByThreadId,
            draftThreadsByThreadId: nextDraftThreadsByThreadId,
            projectDraftThreadIdByProjectId: restProjectMappings,
          };
        });
      },
      clearDraftThread: (threadId) => {
        if (threadId.length === 0) {
          return;
        }
        set((state) => {
          const hasDraftThread = state.draftThreadsByThreadId[threadId] !== undefined;
          const hasProjectMapping = Object.values(state.projectDraftThreadIdByProjectId).includes(
            threadId,
          );
          if (!hasDraftThread && !hasProjectMapping) {
            return state;
          }
          const nextProjectDraftThreadIdByProjectId = Object.fromEntries(
            Object.entries(state.projectDraftThreadIdByProjectId).filter(
              ([, draftThreadId]) => draftThreadId !== threadId,
            ),
          ) as Record<ProjectId, ThreadId>;
          const { [threadId]: _removedDraftThread, ...restDraftThreadsByThreadId } =
            state.draftThreadsByThreadId;
          return {
            draftThreadsByThreadId: restDraftThreadsByThreadId,
            projectDraftThreadIdByProjectId: nextProjectDraftThreadIdByProjectId,
          };
        });
      },
      setPrompt: (threadId, prompt) => {
        if (threadId.length === 0) {
          return;
        }
        set((state) => {
          const existing = state.draftsByThreadId[threadId] ?? createEmptyThreadDraft();
          const nextDraft: ComposerThreadDraftState = {
            ...existing,
            prompt,
          };
          const nextDraftsByThreadId = { ...state.draftsByThreadId };
          if (shouldRemoveDraft(nextDraft)) {
            delete nextDraftsByThreadId[threadId];
          } else {
            nextDraftsByThreadId[threadId] = nextDraft;
          }
          return { draftsByThreadId: nextDraftsByThreadId };
        });
      },
      setProvider: (threadId, provider) => {
        if (threadId.length === 0) {
          return;
        }
        const normalizedProvider = normalizeProviderKind(provider);
        set((state) => {
          const existing = state.draftsByThreadId[threadId];
          if (!existing && normalizedProvider === null) {
            return state;
          }
          const base = existing ?? createEmptyThreadDraft();
          if (base.provider === normalizedProvider) {
            return state;
          }
          const nextDraft: ComposerThreadDraftState = {
            ...base,
            provider: normalizedProvider,
          };
          const nextDraftsByThreadId = { ...state.draftsByThreadId };
          if (shouldRemoveDraft(nextDraft)) {
            delete nextDraftsByThreadId[threadId];
          } else {
            nextDraftsByThreadId[threadId] = nextDraft;
          }
          return { draftsByThreadId: nextDraftsByThreadId };
        });
      },
      setModel: (threadId, model) => {
        if (threadId.length === 0) {
          return;
        }
        const normalizedModel = normalizeModelSlug(model) ?? null;
        set((state) => {
          const existing = state.draftsByThreadId[threadId];
          if (!existing && normalizedModel === null) {
            return state;
          }
          const base = existing ?? createEmptyThreadDraft();
          if (base.model === normalizedModel) {
            return state;
          }
          const nextDraft: ComposerThreadDraftState = {
            ...base,
            model: normalizedModel,
          };
          const nextDraftsByThreadId = { ...state.draftsByThreadId };
          if (shouldRemoveDraft(nextDraft)) {
            delete nextDraftsByThreadId[threadId];
          } else {
            nextDraftsByThreadId[threadId] = nextDraft;
          }
          return { draftsByThreadId: nextDraftsByThreadId };
        });
      },
      setRuntimeMode: (threadId, runtimeMode) => {
        if (threadId.length === 0) {
          return;
        }
        const nextRuntimeMode =
          runtimeMode === "approval-required" || runtimeMode === "full-access" ? runtimeMode : null;
        set((state) => {
          const existing = state.draftsByThreadId[threadId];
          if (!existing && nextRuntimeMode === null) {
            return state;
          }
          const base = existing ?? createEmptyThreadDraft();
          if (base.runtimeMode === nextRuntimeMode) {
            return state;
          }
          const nextDraft: ComposerThreadDraftState = {
            ...base,
            runtimeMode: nextRuntimeMode,
          };
          const nextDraftsByThreadId = { ...state.draftsByThreadId };
          if (shouldRemoveDraft(nextDraft)) {
            delete nextDraftsByThreadId[threadId];
          } else {
            nextDraftsByThreadId[threadId] = nextDraft;
          }
          return { draftsByThreadId: nextDraftsByThreadId };
        });
      },
      setInteractionMode: (threadId, interactionMode) => {
        if (threadId.length === 0) {
          return;
        }
        const nextInteractionMode =
          interactionMode === "plan" || interactionMode === "default" ? interactionMode : null;
        set((state) => {
          const existing = state.draftsByThreadId[threadId];
          if (!existing && nextInteractionMode === null) {
            return state;
          }
          const base = existing ?? createEmptyThreadDraft();
          if (base.interactionMode === nextInteractionMode) {
            return state;
          }
          const nextDraft: ComposerThreadDraftState = {
            ...base,
            interactionMode: nextInteractionMode,
          };
          const nextDraftsByThreadId = { ...state.draftsByThreadId };
          if (shouldRemoveDraft(nextDraft)) {
            delete nextDraftsByThreadId[threadId];
          } else {
            nextDraftsByThreadId[threadId] = nextDraft;
          }
          return { draftsByThreadId: nextDraftsByThreadId };
        });
      },
      setEffort: (threadId, effort) => {
        if (threadId.length === 0) {
          return;
        }
        set((state) => {
          const existing = state.draftsByThreadId[threadId];
          const defaultEffort = DEFAULT_REASONING_EFFORT_BY_PROVIDER[existing?.provider ?? "codex"];
          const nextEffort =
            effort && REASONING_EFFORT_VALUES.has(effort) && effort !== defaultEffort
              ? effort
              : null;
          if (!existing && nextEffort === null) {
            return state;
          }
          const base = existing ?? createEmptyThreadDraft();
          if (base.effort === nextEffort) {
            return state;
          }
          const nextDraft: ComposerThreadDraftState = {
            ...base,
            effort: nextEffort,
          };
          const nextDraftsByThreadId = { ...state.draftsByThreadId };
          if (shouldRemoveDraft(nextDraft)) {
            delete nextDraftsByThreadId[threadId];
          } else {
            nextDraftsByThreadId[threadId] = nextDraft;
          }
          return { draftsByThreadId: nextDraftsByThreadId };
        });
      },
      setCodexFastMode: (threadId, enabled) => {
        if (threadId.length === 0) {
          return;
        }
        const nextCodexFastMode = enabled === true;
        set((state) => {
          const existing = state.draftsByThreadId[threadId];
          if (!existing && nextCodexFastMode === false) {
            return state;
          }
          const base = existing ?? createEmptyThreadDraft();
          if (base.codexFastMode === nextCodexFastMode) {
            return state;
          }
          const nextDraft: ComposerThreadDraftState = {
            ...base,
            codexFastMode: nextCodexFastMode,
          };
          const nextDraftsByThreadId = { ...state.draftsByThreadId };
          if (shouldRemoveDraft(nextDraft)) {
            delete nextDraftsByThreadId[threadId];
          } else {
            nextDraftsByThreadId[threadId] = nextDraft;
          }
          return { draftsByThreadId: nextDraftsByThreadId };
        });
      },
      setProviderModelOptions: (threadId, provider, options, opts) => {
        if (threadId.length === 0) {
          return;
        }
        set((state) => {
          const existing = state.draftsByThreadId[threadId];
          const base = existing ?? createEmptyThreadDraft();
          const prevModelOptions = base.modelOptions;
          const nextProviderOptions = options ?? undefined;
          const nextModelOptions: ProviderModelOptions | null = nextProviderOptions
            ? { ...prevModelOptions, [provider]: nextProviderOptions }
            : prevModelOptions
              ? (() => {
                  const copy = { ...prevModelOptions };
                  delete copy[provider];
                  return Object.keys(copy).length > 0 ? copy : null;
                })()
              : null;
          const nextDraft: ComposerThreadDraftState = {
            ...base,
            modelOptions: nextModelOptions,
          };
          const nextDraftsByThreadId = { ...state.draftsByThreadId };
          if (shouldRemoveDraft(nextDraft)) {
            delete nextDraftsByThreadId[threadId];
          } else {
            nextDraftsByThreadId[threadId] = nextDraft;
          }
          return { draftsByThreadId: nextDraftsByThreadId };
        });
      },
      addImageSnapshots: (threadId, snapshots) => {
        if (threadId.length === 0 || snapshots.length === 0) {
          return;
        }
        let addedSnapshots = false;
        set((state) => {
          const existing = state.draftsByThreadId[threadId] ?? createEmptyThreadDraft();
          const existingIds = new Set(existing.images.map((image) => image.id));
          const existingDedupKeys = new Set(
            existing.images.map((image) => composerImageDedupKey(image)),
          );
          const acceptedPreviewUrls = new Set(existing.images.map((image) => image.previewUrl));
          const acceptedSnapshots: ComposerImageSnapshot[] = [];
          for (const snapshot of snapshots) {
            const image = snapshot.attachment;
            const dedupKey = composerImageDedupKey(image);
            if (existingIds.has(image.id) || existingDedupKeys.has(dedupKey)) {
              // Avoid revoking a blob URL that's still referenced by an accepted image.
              if (!acceptedPreviewUrls.has(image.previewUrl)) {
                revokeObjectPreviewUrl(image.previewUrl);
              }
              continue;
            }
            acceptedSnapshots.push(snapshot);
            existingIds.add(image.id);
            existingDedupKeys.add(dedupKey);
            acceptedPreviewUrls.add(image.previewUrl);
          }
          if (acceptedSnapshots.length === 0) {
            return state;
          }
          addedSnapshots = true;
          return {
            draftsByThreadId: {
              ...state.draftsByThreadId,
              [threadId]: {
                ...existing,
                images: [
                  ...existing.images,
                  ...acceptedSnapshots.map((snapshot) => snapshot.attachment),
                ],
                attachmentPayloads: mergeComposerAttachmentPayloads(
                  existing.attachmentPayloads,
                  acceptedSnapshots.map((snapshot) => snapshot.payload),
                ),
              },
            },
          };
        });
        if (addedSnapshots) {
          scheduleComposerDraftAttachmentSync(threadId);
        }
      },
      removeImage: (threadId, imageId) => {
        if (threadId.length === 0) {
          return;
        }
        clearComposerDraftAttachmentSyncVersion(threadId);
        const existing = get().draftsByThreadId[threadId];
        if (!existing) {
          return;
        }
        const removedImage = existing.images.find((image) => image.id === imageId);
        if (removedImage) {
          revokeObjectPreviewUrl(removedImage.previewUrl);
        }
        delete legacyPersistedAttachmentsByThreadId[threadId];
        void removePersistedComposerDraftAttachment(threadId, imageId);
        set((state) => {
          const current = state.draftsByThreadId[threadId];
          if (!current) {
            return state;
          }
          const nextDraft: ComposerThreadDraftState = {
            ...current,
            images: current.images.filter((image) => image.id !== imageId),
            attachmentPayloads: current.attachmentPayloads.filter(
              (attachment) => attachment.id !== imageId,
            ),
            nonPersistedImageIds: current.nonPersistedImageIds.filter((id) => id !== imageId),
            persistedAttachmentMetadata: current.persistedAttachmentMetadata.filter(
              (attachment) => attachment.id !== imageId,
            ),
          };
          const nextDraftsByThreadId = { ...state.draftsByThreadId };
          if (shouldRemoveDraft(nextDraft)) {
            delete nextDraftsByThreadId[threadId];
          } else {
            nextDraftsByThreadId[threadId] = nextDraft;
          }
          return { draftsByThreadId: nextDraftsByThreadId };
        });
      },
      clearComposerContent: (threadId) => {
        if (threadId.length === 0) {
          return;
        }
        scheduleComposerDraftAttachmentClear(threadId);
        set((state) => {
          const current = state.draftsByThreadId[threadId];
          if (!current) {
            return state;
          }
          const nextDraft: ComposerThreadDraftState = {
            ...current,
            prompt: "",
            images: [],
            attachmentPayloads: [],
            nonPersistedImageIds: [],
            persistedAttachmentMetadata: [],
          };
          const nextDraftsByThreadId = { ...state.draftsByThreadId };
          if (shouldRemoveDraft(nextDraft)) {
            delete nextDraftsByThreadId[threadId];
          } else {
            nextDraftsByThreadId[threadId] = nextDraft;
          }
          return { draftsByThreadId: nextDraftsByThreadId };
        });
      },
      clearThreadDraft: (threadId) => {
        if (threadId.length === 0) {
          return;
        }
        const existing = get().draftsByThreadId[threadId];
        if (existing) {
          for (const image of existing.images) {
            revokeObjectPreviewUrl(image.previewUrl);
          }
        }
        scheduleComposerDraftAttachmentClear(threadId);
        set((state) => {
          const hasComposerDraft = state.draftsByThreadId[threadId] !== undefined;
          const hasDraftThread = state.draftThreadsByThreadId[threadId] !== undefined;
          const hasProjectMapping = Object.values(state.projectDraftThreadIdByProjectId).includes(
            threadId,
          );
          if (!hasComposerDraft && !hasDraftThread && !hasProjectMapping) {
            return state;
          }
          const { [threadId]: _removedComposerDraft, ...restComposerDraftsByThreadId } =
            state.draftsByThreadId;
          const { [threadId]: _removedDraftThread, ...restDraftThreadsByThreadId } =
            state.draftThreadsByThreadId;
          const nextProjectDraftThreadIdByProjectId = Object.fromEntries(
            Object.entries(state.projectDraftThreadIdByProjectId).filter(
              ([, draftThreadId]) => draftThreadId !== threadId,
            ),
          ) as Record<ProjectId, ThreadId>;
          return {
            draftsByThreadId: restComposerDraftsByThreadId,
            draftThreadsByThreadId: restDraftThreadsByThreadId,
            projectDraftThreadIdByProjectId: nextProjectDraftThreadIdByProjectId,
          };
        });
      },
    }),
    {
      name: COMPOSER_DRAFT_STORAGE_KEY,
      version: 2,
      storage: createComposerDraftPersistStorage(),
      partialize: (state) => {
        const persistedDraftsByThreadId: PersistedComposerDraftStoreState["draftsByThreadId"] = {};
        for (const [threadId, draft] of Object.entries(state.draftsByThreadId)) {
          if (typeof threadId !== "string" || threadId.length === 0) {
            continue;
          }
          if (
            draft.prompt.length === 0 &&
            draft.persistedAttachmentMetadata.length === 0 &&
            draft.provider === null &&
            draft.model === null &&
            draft.runtimeMode === null &&
            draft.interactionMode === null &&
            draft.effort === null &&
            draft.codexFastMode === false &&
            draft.modelOptions === null
          ) {
            continue;
          }
          const persistedDraft: PersistedComposerThreadDraftState = {
            prompt: draft.prompt,
            attachments: draft.persistedAttachmentMetadata,
          };
          if (draft.model) {
            persistedDraft.model = draft.model;
          }
          if (draft.provider) {
            persistedDraft.provider = draft.provider;
          }
          if (draft.runtimeMode) {
            persistedDraft.runtimeMode = draft.runtimeMode;
          }
          if (draft.interactionMode) {
            persistedDraft.interactionMode = draft.interactionMode;
          }
          if (draft.effort) {
            persistedDraft.effort = draft.effort;
          }
          if (draft.codexFastMode) {
            persistedDraft.codexFastMode = true;
          }
          if (draft.modelOptions) {
            persistedDraft.modelOptions = draft.modelOptions;
          }
          persistedDraftsByThreadId[threadId as ThreadId] = persistedDraft;
        }
        return {
          draftsByThreadId: persistedDraftsByThreadId,
          draftThreadsByThreadId: state.draftThreadsByThreadId,
          projectDraftThreadIdByProjectId: state.projectDraftThreadIdByProjectId,
        };
      },
      merge: (persistedState, currentState) => {
        const normalizedPersisted = normalizePersistedComposerDraftState(persistedState).state;
        const draftsByThreadId = Object.fromEntries(
          Object.entries(normalizedPersisted.draftsByThreadId).map(([threadId, draft]) => [
            threadId,
            toHydratedThreadDraft(draft),
          ]),
        );
        return {
          ...currentState,
          draftsByThreadId,
          draftThreadsByThreadId: normalizedPersisted.draftThreadsByThreadId,
          projectDraftThreadIdByProjectId: normalizedPersisted.projectDraftThreadIdByProjectId,
        };
      },
      onRehydrateStorage: () => (state, error) => {
        if (error || !state) {
          return;
        }
        Promise.resolve().then(() => hydrateComposerDraftAttachmentsAfterRehydrate(state));
      },
    },
  ),
);

export function useComposerThreadDraft(threadId: ThreadId): ComposerThreadDraftState {
  return useComposerDraftStore((state) => state.draftsByThreadId[threadId] ?? EMPTY_THREAD_DRAFT);
}
