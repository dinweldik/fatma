import {
  DEFAULT_REASONING_EFFORT_BY_PROVIDER,
  ProjectId,
  REASONING_EFFORT_OPTIONS_BY_PROVIDER,
  ThreadId,
  type CodexReasoningEffort,
  type ProviderKind,
  type ProviderInteractionMode,
  type RuntimeMode,
} from "@fatma/contracts";
import { normalizeModelSlug } from "@fatma/shared/model";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE, type ChatImageAttachment } from "./types";
import { create } from "zustand";
import { type PersistStorage, type StorageValue, persist } from "zustand/middleware";
import {
  clearPersistedComposerDraftAttachments,
  isQuotaExceededError,
  loadPersistedComposerDraftAttachments,
  normalizePersistedComposerImageAttachment,
  normalizePersistedComposerImageAttachmentMetadata,
  persistComposerDraftAttachments,
  removePersistedComposerDraftAttachment,
  toPersistedComposerImageAttachmentMetadata,
  type PersistedComposerImageAttachment,
  type PersistedComposerImageAttachmentMetadata,
} from "./composerDraftAttachmentPersistence";

export const COMPOSER_DRAFT_STORAGE_KEY = "fatma:composer-drafts:v1";
export type DraftThreadEnvMode = "local" | "worktree";
export type {
  PersistedComposerImageAttachment,
  PersistedComposerImageAttachmentMetadata,
} from "./composerDraftAttachmentPersistence";

export interface ComposerImageAttachment extends Omit<ChatImageAttachment, "previewUrl"> {
  previewUrl: string;
  file: File;
}

interface PersistedComposerThreadDraftState {
  prompt: string;
  attachments: PersistedComposerImageAttachmentMetadata[];
  provider?: ProviderKind | null;
  model?: string | null;
  runtimeMode?: RuntimeMode | null;
  interactionMode?: ProviderInteractionMode | null;
  effort?: CodexReasoningEffort | null;
  codexFastMode?: boolean | null;
  serviceTier?: string | null;
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
  nonPersistedImageIds: string[];
  persistedAttachments: PersistedComposerImageAttachment[];
  persistedAttachmentMetadata: PersistedComposerImageAttachmentMetadata[];
  provider: ProviderKind | null;
  model: string | null;
  runtimeMode: RuntimeMode | null;
  interactionMode: ProviderInteractionMode | null;
  effort: CodexReasoningEffort | null;
  codexFastMode: boolean;
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
  setEffort: (threadId: ThreadId, effort: CodexReasoningEffort | null | undefined) => void;
  setCodexFastMode: (threadId: ThreadId, enabled: boolean | null | undefined) => void;
  addImage: (threadId: ThreadId, image: ComposerImageAttachment) => void;
  addImages: (threadId: ThreadId, images: ComposerImageAttachment[]) => void;
  removeImage: (threadId: ThreadId, imageId: string) => void;
  clearPersistedAttachments: (threadId: ThreadId) => void;
  syncPersistedAttachments: (
    threadId: ThreadId,
    attachments: PersistedComposerImageAttachment[],
  ) => void;
  clearComposerContent: (threadId: ThreadId) => void;
  clearThreadDraft: (threadId: ThreadId) => void;
}

const EMPTY_PERSISTED_DRAFT_STORE_STATE: PersistedComposerDraftStoreState = {
  draftsByThreadId: {},
  draftThreadsByThreadId: {},
  projectDraftThreadIdByProjectId: {},
};

const EMPTY_IMAGES: ComposerImageAttachment[] = [];
const EMPTY_IDS: string[] = [];
const EMPTY_PERSISTED_ATTACHMENTS: PersistedComposerImageAttachment[] = [];
const EMPTY_PERSISTED_ATTACHMENT_METADATA: PersistedComposerImageAttachmentMetadata[] = [];
Object.freeze(EMPTY_IMAGES);
Object.freeze(EMPTY_IDS);
Object.freeze(EMPTY_PERSISTED_ATTACHMENTS);
Object.freeze(EMPTY_PERSISTED_ATTACHMENT_METADATA);
const EMPTY_THREAD_DRAFT = Object.freeze({
  prompt: "",
  images: EMPTY_IMAGES,
  nonPersistedImageIds: EMPTY_IDS,
  persistedAttachments: EMPTY_PERSISTED_ATTACHMENTS,
  persistedAttachmentMetadata: EMPTY_PERSISTED_ATTACHMENT_METADATA,
  provider: null,
  model: null,
  runtimeMode: null,
  interactionMode: null,
  effort: null,
  codexFastMode: false,
}) as ComposerThreadDraftState;

const REASONING_EFFORT_VALUES = new Set<CodexReasoningEffort>(
  REASONING_EFFORT_OPTIONS_BY_PROVIDER.codex,
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
    nonPersistedImageIds: [],
    persistedAttachments: [],
    persistedAttachmentMetadata: [],
    provider: null,
    model: null,
    runtimeMode: null,
    interactionMode: null,
    effort: null,
    codexFastMode: false,
  };
}

function composerImageDedupKey(image: ComposerImageAttachment): string {
  // Keep this independent from File.lastModified so dedupe is stable for hydrated
  // images reconstructed from localStorage (which get a fresh lastModified value).
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
    draft.codexFastMode === false
  );
}

function normalizeProviderKind(value: unknown): ProviderKind | null {
  return value === "codex" ? value : null;
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
          const normalized = normalizePersistedComposerImageAttachment(entry);
          return normalized ? [normalized] : [];
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
      effortCandidate && REASONING_EFFORT_VALUES.has(effortCandidate as CodexReasoningEffort)
        ? (effortCandidate as CodexReasoningEffort)
        : null;
    const codexFastMode =
      draftCandidate.codexFastMode === true ||
      (typeof draftCandidate.serviceTier === "string" && draftCandidate.serviceTier === "fast");
    if (
      prompt.length === 0 &&
      attachments.length === 0 &&
      !provider &&
      !model &&
      !runtimeMode &&
      !interactionMode &&
      !effort &&
      !codexFastMode
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

function hydreatePersistedComposerImageAttachment(
  attachment: PersistedComposerImageAttachment,
): File | null {
  const commaIndex = attachment.dataUrl.indexOf(",");
  const header = commaIndex === -1 ? attachment.dataUrl : attachment.dataUrl.slice(0, commaIndex);
  const payload = commaIndex === -1 ? "" : attachment.dataUrl.slice(commaIndex + 1);
  if (payload.length === 0) {
    return null;
  }
  try {
    const isBase64 = header.includes(";base64");
    if (!isBase64) {
      const decodedText = decodeURIComponent(payload);
      const inferredMimeType =
        header.startsWith("data:") && header.includes(";")
          ? header.slice("data:".length, header.indexOf(";"))
          : attachment.mimeType;
      return new File([decodedText], attachment.name, {
        type: inferredMimeType || attachment.mimeType,
      });
    }
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new File([bytes], attachment.name, { type: attachment.mimeType });
  } catch {
    return null;
  }
}

function hydrateImagesFromPersisted(
  attachments: PersistedComposerImageAttachment[],
): ComposerImageAttachment[] {
  return attachments.flatMap((attachment) => {
    const file = hydreatePersistedComposerImageAttachment(attachment);
    if (!file) return [];

    return [
      {
        type: "image" as const,
        id: attachment.id,
        name: attachment.name,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        previewUrl: attachment.dataUrl,
        file,
      } satisfies ComposerImageAttachment,
    ];
  });
}

function toHydratedThreadDraft(
  persistedDraft: PersistedComposerThreadDraftState,
): ComposerThreadDraftState {
  return {
    prompt: persistedDraft.prompt,
    images: [],
    nonPersistedImageIds: [],
    persistedAttachments: [],
    persistedAttachmentMetadata: persistedDraft.attachments,
    provider: persistedDraft.provider ?? null,
    model: persistedDraft.model ?? null,
    runtimeMode: persistedDraft.runtimeMode ?? null,
    interactionMode: persistedDraft.interactionMode ?? null,
    effort: persistedDraft.effort ?? null,
    codexFastMode: persistedDraft.codexFastMode === true,
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
      persistedAttachments: persistedAttachments.filter((attachment) =>
        persistedAttachmentIds.has(attachment.id),
      ),
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
    persistedAttachments: PersistedComposerImageAttachment[];
    nonPersistedImageIds: string[];
  },
): void {
  useComposerDraftStore.setState((state) => {
    const current = state.draftsByThreadId[threadId];
    if (!current) {
      return state;
    }
    const mergedImages = mergeComposerImages(current.images, input.images);
    const mergedPersistedAttachments = Array.from(
      new Map(
        [...current.persistedAttachments, ...input.persistedAttachments].map((attachment) => [
          attachment.id,
          attachment,
        ]),
      ).values(),
    );
    const persistedAttachmentMetadata = mergedPersistedAttachments.map(
      toPersistedComposerImageAttachmentMetadata,
    );
    const persistedAttachmentIdSet = new Set(
      persistedAttachmentMetadata.map((attachment) => attachment.id),
    );
    const mergedImageIdSet = new Set(mergedImages.map((image) => image.id));
    const nextDraft: ComposerThreadDraftState = {
      ...current,
      images: mergedImages,
      persistedAttachments: mergedPersistedAttachments,
      persistedAttachmentMetadata,
      nonPersistedImageIds: Array.from(
        new Set([
          ...current.nonPersistedImageIds.filter(
            (imageId) => mergedImageIdSet.has(imageId) && !persistedAttachmentIdSet.has(imageId),
          ),
          ...input.nonPersistedImageIds.filter((imageId) => mergedImageIdSet.has(imageId)),
        ]),
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
        const nextEffort =
          effort &&
          REASONING_EFFORT_VALUES.has(effort) &&
          effort !== DEFAULT_REASONING_EFFORT_BY_PROVIDER.codex
            ? effort
            : null;
        set((state) => {
          const existing = state.draftsByThreadId[threadId];
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
      addImage: (threadId, image) => {
        if (threadId.length === 0) {
          return;
        }
        get().addImages(threadId, [image]);
      },
      addImages: (threadId, images) => {
        if (threadId.length === 0 || images.length === 0) {
          return;
        }
        set((state) => {
          const existing = state.draftsByThreadId[threadId] ?? createEmptyThreadDraft();
          const existingIds = new Set(existing.images.map((image) => image.id));
          const existingDedupKeys = new Set(
            existing.images.map((image) => composerImageDedupKey(image)),
          );
          const acceptedPreviewUrls = new Set(existing.images.map((image) => image.previewUrl));
          const dedupedIncoming: ComposerImageAttachment[] = [];
          for (const image of images) {
            const dedupKey = composerImageDedupKey(image);
            if (existingIds.has(image.id) || existingDedupKeys.has(dedupKey)) {
              // Avoid revoking a blob URL that's still referenced by an accepted image.
              if (!acceptedPreviewUrls.has(image.previewUrl)) {
                revokeObjectPreviewUrl(image.previewUrl);
              }
              continue;
            }
            dedupedIncoming.push(image);
            existingIds.add(image.id);
            existingDedupKeys.add(dedupKey);
            acceptedPreviewUrls.add(image.previewUrl);
          }
          if (dedupedIncoming.length === 0) {
            return state;
          }
          return {
            draftsByThreadId: {
              ...state.draftsByThreadId,
              [threadId]: {
                ...existing,
                images: [...existing.images, ...dedupedIncoming],
              },
            },
          };
        });
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
            nonPersistedImageIds: current.nonPersistedImageIds.filter((id) => id !== imageId),
            persistedAttachments: current.persistedAttachments.filter(
              (attachment) => attachment.id !== imageId,
            ),
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
      clearPersistedAttachments: (threadId) => {
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
            persistedAttachments: [],
            persistedAttachmentMetadata: [],
            nonPersistedImageIds: current.images.map((image) => image.id),
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
      syncPersistedAttachments: (threadId, attachments) => {
        if (threadId.length === 0) {
          return;
        }
        delete legacyPersistedAttachmentsByThreadId[threadId];
        const syncVersion = nextComposerDraftAttachmentSyncVersion(threadId);
        void (async () => {
          const current = get().draftsByThreadId[threadId];
          if (!current) {
            return;
          }
          const attachmentById = new Map(
            attachments.map((attachment) => [attachment.id, attachment]),
          );
          const fallbackMetadata = current.persistedAttachmentMetadata.filter(
            (attachment) =>
              current.images.some((image) => image.id === attachment.id) &&
              !attachmentById.has(attachment.id),
          );
          if (fallbackMetadata.length > 0) {
            const fallbackAttachments = await loadPersistedComposerDraftAttachments(
              threadId,
              fallbackMetadata,
            );
            for (const attachment of fallbackAttachments) {
              if (!attachmentById.has(attachment.id)) {
                attachmentById.set(attachment.id, attachment);
              }
            }
          }
          const attachmentsToPersist = Array.from(attachmentById.values());
          const persistedIdSet = await persistComposerDraftAttachments(
            threadId,
            attachmentsToPersist,
          );
          if (!isLatestComposerDraftAttachmentSyncVersion(threadId, syncVersion)) {
            return;
          }
          set((state) => {
            const latestDraft = state.draftsByThreadId[threadId];
            if (!latestDraft) {
              return state;
            }
            const imageIdSet = new Set(latestDraft.images.map((image) => image.id));
            const persistedAttachments = attachmentsToPersist.filter(
              (attachment) => imageIdSet.has(attachment.id) && persistedIdSet.has(attachment.id),
            );
            const nonPersistedImageIds = latestDraft.images
              .map((image) => image.id)
              .filter((imageId) => !persistedIdSet.has(imageId));
            const nextDraft: ComposerThreadDraftState = {
              ...latestDraft,
              persistedAttachments,
              persistedAttachmentMetadata: persistedAttachments.map(
                toPersistedComposerImageAttachmentMetadata,
              ),
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
            nonPersistedImageIds: [],
            persistedAttachments: [],
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
            draft.codexFastMode === false
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
