import { ProjectId, ThreadId } from "@fatma/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as composerDraftAttachmentPersistence from "./composerDraftAttachmentPersistence";
import {
  COMPOSER_DRAFT_STORAGE_KEY,
  type ComposerImageAttachment,
  type ComposerImageSnapshot,
  type PersistedComposerImageAttachment,
  useComposerDraftStore,
} from "./composerDraftStore";

function makeImage(input: {
  id: string;
  previewUrl: string;
  name?: string;
  mimeType?: string;
  sizeBytes?: number;
}): ComposerImageAttachment {
  const name = input.name ?? "image.png";
  const mimeType = input.mimeType ?? "image/png";
  const sizeBytes = input.sizeBytes ?? 4;
  return {
    type: "image",
    id: input.id,
    name,
    mimeType,
    sizeBytes,
    previewUrl: input.previewUrl,
  };
}

function makePersistedAttachment(input: {
  id: string;
  name?: string;
  mimeType?: string;
  sizeBytes?: number;
  blob?: Blob;
}): PersistedComposerImageAttachment {
  const mimeType = input.mimeType ?? "image/png";
  const blob =
    input.blob ?? new Blob([new Uint8Array(input.sizeBytes ?? 4).fill(1)], { type: mimeType });
  return {
    id: input.id,
    name: input.name ?? "image.png",
    mimeType,
    sizeBytes: blob.size,
    blob,
  };
}

function makeSnapshot(input: {
  id: string;
  previewUrl: string;
  name?: string;
  mimeType?: string;
  sizeBytes?: number;
}): ComposerImageSnapshot {
  const payload = makePersistedAttachment({
    id: input.id,
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.mimeType !== undefined ? { mimeType: input.mimeType } : {}),
    ...(input.sizeBytes !== undefined ? { sizeBytes: input.sizeBytes } : {}),
  });
  return {
    attachment: makeImage({
      id: input.id,
      previewUrl: input.previewUrl,
      name: payload.name,
      mimeType: payload.mimeType,
      sizeBytes: payload.sizeBytes,
    }),
    payload,
  };
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function createMemoryLocalStorage() {
  const values = new Map<string, string>();
  return {
    clear(): void {
      values.clear();
    },
    getItem(key: string): string | null {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      values.set(key, value);
    },
    removeItem(key: string): void {
      values.delete(key);
    },
  };
}

describe("composerDraftStore addImageSnapshots", () => {
  const threadId = ThreadId.makeUnsafe("thread-dedupe");
  let originalRevokeObjectUrl: typeof URL.revokeObjectURL;
  let revokeSpy: ReturnType<typeof vi.fn<(url: string) => void>>;

  beforeEach(() => {
    useComposerDraftStore.setState({
      draftsByThreadId: {},
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
    });
    originalRevokeObjectUrl = URL.revokeObjectURL;
    revokeSpy = vi.fn();
    URL.revokeObjectURL = revokeSpy;
  });

  afterEach(() => {
    URL.revokeObjectURL = originalRevokeObjectUrl;
  });

  it("deduplicates identical images in one batch by file signature", () => {
    const first = makeSnapshot({
      id: "img-1",
      previewUrl: "blob:first",
      name: "same.png",
      mimeType: "image/png",
      sizeBytes: 12,
    });
    const duplicate = makeSnapshot({
      id: "img-2",
      previewUrl: "blob:duplicate",
      name: "same.png",
      mimeType: "image/png",
      sizeBytes: 12,
    });

    useComposerDraftStore.getState().addImageSnapshots(threadId, [first, duplicate]);

    const draft = useComposerDraftStore.getState().draftsByThreadId[threadId];
    expect(draft?.images.map((image) => image.id)).toEqual(["img-1"]);
    expect(revokeSpy).toHaveBeenCalledWith("blob:duplicate");
  });

  it("deduplicates against existing images across calls by file signature", () => {
    const first = makeSnapshot({
      id: "img-a",
      previewUrl: "blob:a",
      name: "same.png",
      mimeType: "image/png",
      sizeBytes: 9,
    });
    const duplicateLater = makeSnapshot({
      id: "img-b",
      previewUrl: "blob:b",
      name: "same.png",
      mimeType: "image/png",
      sizeBytes: 9,
    });

    useComposerDraftStore.getState().addImageSnapshots(threadId, [first]);
    useComposerDraftStore.getState().addImageSnapshots(threadId, [duplicateLater]);

    const draft = useComposerDraftStore.getState().draftsByThreadId[threadId];
    expect(draft?.images.map((image) => image.id)).toEqual(["img-a"]);
    expect(revokeSpy).toHaveBeenCalledWith("blob:b");
  });

  it("does not revoke blob URLs that are still used by an accepted duplicate image", () => {
    const first = makeSnapshot({
      id: "img-shared",
      previewUrl: "blob:shared",
    });
    const duplicateSameUrl = makeSnapshot({
      id: "img-shared",
      previewUrl: "blob:shared",
    });

    useComposerDraftStore.getState().addImageSnapshots(threadId, [first, duplicateSameUrl]);

    const draft = useComposerDraftStore.getState().draftsByThreadId[threadId];
    expect(draft?.images.map((image) => image.id)).toEqual(["img-shared"]);
    expect(revokeSpy).not.toHaveBeenCalledWith("blob:shared");
  });
});

describe("composerDraftStore clearComposerContent", () => {
  const threadId = ThreadId.makeUnsafe("thread-clear");
  let originalRevokeObjectUrl: typeof URL.revokeObjectURL;
  let revokeSpy: ReturnType<typeof vi.fn<(url: string) => void>>;

  beforeEach(() => {
    useComposerDraftStore.setState({
      draftsByThreadId: {},
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
    });
    originalRevokeObjectUrl = URL.revokeObjectURL;
    revokeSpy = vi.fn();
    URL.revokeObjectURL = revokeSpy;
  });

  afterEach(() => {
    URL.revokeObjectURL = originalRevokeObjectUrl;
  });

  it("does not revoke blob preview URLs when clearing composer content", () => {
    const first = makeSnapshot({
      id: "img-optimistic",
      previewUrl: "blob:optimistic",
    });
    useComposerDraftStore.getState().addImageSnapshots(threadId, [first]);

    useComposerDraftStore.getState().clearComposerContent(threadId);

    const draft = useComposerDraftStore.getState().draftsByThreadId[threadId];
    expect(draft).toBeUndefined();
    expect(revokeSpy).not.toHaveBeenCalledWith("blob:optimistic");
  });
});

describe("composerDraftStore project draft thread mapping", () => {
  const projectId = ProjectId.makeUnsafe("project-a");
  const otherProjectId = ProjectId.makeUnsafe("project-b");
  const threadId = ThreadId.makeUnsafe("thread-a");
  const otherThreadId = ThreadId.makeUnsafe("thread-b");

  beforeEach(() => {
    useComposerDraftStore.setState({
      draftsByThreadId: {},
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
    });
  });

  it("stores and reads project draft thread ids via actions", () => {
    const store = useComposerDraftStore.getState();
    expect(store.getDraftThreadByProjectId(projectId)).toBeNull();
    expect(store.getDraftThread(threadId)).toBeNull();

    store.setProjectDraftThreadId(projectId, threadId, {
      branch: "feature/test",
      worktreePath: "/tmp/worktree-test",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(useComposerDraftStore.getState().getDraftThreadByProjectId(projectId)).toEqual({
      threadId,
      projectId,
      branch: "feature/test",
      worktreePath: "/tmp/worktree-test",
      envMode: "worktree",
      runtimeMode: "full-access",
      interactionMode: "default",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(useComposerDraftStore.getState().getDraftThread(threadId)).toEqual({
      projectId,
      branch: "feature/test",
      worktreePath: "/tmp/worktree-test",
      envMode: "worktree",
      runtimeMode: "full-access",
      interactionMode: "default",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("clears only matching project draft mapping entries", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectId, threadId);
    store.setPrompt(threadId, "hello");

    store.clearProjectDraftThreadById(projectId, otherThreadId);
    expect(useComposerDraftStore.getState().getDraftThreadByProjectId(projectId)?.threadId).toBe(
      threadId,
    );

    store.clearProjectDraftThreadById(projectId, threadId);
    expect(useComposerDraftStore.getState().getDraftThreadByProjectId(projectId)).toBeNull();
    expect(useComposerDraftStore.getState().getDraftThread(threadId)).toBeNull();
    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]).toBeUndefined();
  });

  it("clears project draft mapping by project id", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectId, threadId);
    store.setPrompt(threadId, "hello");
    store.clearProjectDraftThreadId(projectId);
    expect(useComposerDraftStore.getState().getDraftThreadByProjectId(projectId)).toBeNull();
    expect(useComposerDraftStore.getState().getDraftThread(threadId)).toBeNull();
    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]).toBeUndefined();
  });

  it("clears orphaned composer drafts when remapping a project to a new draft thread", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectId, threadId);
    store.setPrompt(threadId, "orphan me");

    store.setProjectDraftThreadId(projectId, otherThreadId);

    expect(useComposerDraftStore.getState().getDraftThreadByProjectId(projectId)?.threadId).toBe(
      otherThreadId,
    );
    expect(useComposerDraftStore.getState().getDraftThread(threadId)).toBeNull();
    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]).toBeUndefined();
  });

  it("keeps composer drafts when the thread is still mapped by another project", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectId, threadId);
    store.setProjectDraftThreadId(otherProjectId, threadId);
    store.setPrompt(threadId, "keep me");

    store.clearProjectDraftThreadId(projectId);

    expect(useComposerDraftStore.getState().getDraftThreadByProjectId(projectId)).toBeNull();
    expect(
      useComposerDraftStore.getState().getDraftThreadByProjectId(otherProjectId)?.threadId,
    ).toBe(threadId);
    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]?.prompt).toBe("keep me");
  });

  it("clears draft registration independently", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectId, threadId);
    store.clearDraftThread(threadId);
    expect(useComposerDraftStore.getState().getDraftThreadByProjectId(projectId)).toBeNull();
    expect(useComposerDraftStore.getState().getDraftThread(threadId)).toBeNull();
  });

  it("updates branch context on an existing draft thread", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectId, threadId, {
      branch: "main",
      worktreePath: null,
    });
    store.setDraftThreadContext(threadId, {
      branch: "feature/next",
      worktreePath: "/tmp/feature-next",
    });
    expect(useComposerDraftStore.getState().getDraftThreadByProjectId(projectId)?.threadId).toBe(
      threadId,
    );
    expect(useComposerDraftStore.getState().getDraftThread(threadId)).toMatchObject({
      projectId,
      branch: "feature/next",
      worktreePath: "/tmp/feature-next",
      envMode: "worktree",
    });
  });

  it("preserves existing branch and worktree when setProjectDraftThreadId receives undefined", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectId, threadId, {
      branch: "main",
      worktreePath: "/tmp/main-worktree",
    });
    const runtimeUndefinedOptions = {
      branch: undefined,
      worktreePath: undefined,
    } as unknown as {
      branch?: string | null;
      worktreePath?: string | null;
    };
    store.setProjectDraftThreadId(projectId, threadId, runtimeUndefinedOptions);

    expect(useComposerDraftStore.getState().getDraftThread(threadId)).toMatchObject({
      projectId,
      branch: "main",
      worktreePath: "/tmp/main-worktree",
      envMode: "worktree",
    });
  });

  it("preserves worktree env mode without a worktree path", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectId, threadId, {
      branch: "feature/base",
      worktreePath: null,
      envMode: "worktree",
    });
    const runtimeUndefinedOptions = {
      branch: undefined,
      worktreePath: undefined,
      envMode: undefined,
    } as unknown as {
      branch?: string | null;
      worktreePath?: string | null;
      envMode?: "local" | "worktree";
    };
    store.setProjectDraftThreadId(projectId, threadId, runtimeUndefinedOptions);

    expect(useComposerDraftStore.getState().getDraftThread(threadId)).toMatchObject({
      projectId,
      branch: "feature/base",
      worktreePath: null,
      envMode: "worktree",
    });
  });
});

describe("composerDraftStore codex fast mode", () => {
  const threadId = ThreadId.makeUnsafe("thread-service-tier");

  beforeEach(() => {
    useComposerDraftStore.setState({
      draftsByThreadId: {},
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
    });
  });

  it("stores codex fast mode in the draft", () => {
    const store = useComposerDraftStore.getState();
    store.setCodexFastMode(threadId, true);

    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]?.codexFastMode).toBe(true);
  });

  it("clears codex fast mode when reset to the default", () => {
    const store = useComposerDraftStore.getState();
    store.setCodexFastMode(threadId, true);
    store.setCodexFastMode(threadId, false);

    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]).toBeUndefined();
  });
});

describe("composerDraftStore setModel", () => {
  const threadId = ThreadId.makeUnsafe("thread-model");

  beforeEach(() => {
    useComposerDraftStore.setState({
      draftsByThreadId: {},
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
    });
  });

  it("keeps explicit DEFAULT_MODEL overrides instead of coercing to null", () => {
    const store = useComposerDraftStore.getState();

    store.setModel(threadId, "gpt-5.3-codex");

    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]?.model).toBe(
      "gpt-5.3-codex",
    );
  });
});

describe("composerDraftStore setProvider", () => {
  const threadId = ThreadId.makeUnsafe("thread-provider");

  beforeEach(() => {
    useComposerDraftStore.setState({
      draftsByThreadId: {},
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
    });
  });

  it("persists provider-only selection even when prompt/model are empty", () => {
    const store = useComposerDraftStore.getState();

    store.setProvider(threadId, "codex");

    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]?.provider).toBe("codex");
  });

  it("removes empty provider-only draft when provider is reset", () => {
    const store = useComposerDraftStore.getState();

    store.setProvider(threadId, "codex");
    store.setProvider(threadId, null);

    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]).toBeUndefined();
  });
});

describe("composerDraftStore runtime and interaction settings", () => {
  const threadId = ThreadId.makeUnsafe("thread-settings");

  beforeEach(() => {
    useComposerDraftStore.setState({
      draftsByThreadId: {},
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
    });
  });

  it("stores runtime mode overrides in the composer draft", () => {
    const store = useComposerDraftStore.getState();

    store.setRuntimeMode(threadId, "approval-required");

    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]?.runtimeMode).toBe(
      "approval-required",
    );
  });

  it("stores interaction mode overrides in the composer draft", () => {
    const store = useComposerDraftStore.getState();

    store.setInteractionMode(threadId, "plan");

    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]?.interactionMode).toBe(
      "plan",
    );
  });

  it("removes empty settings-only drafts when overrides are cleared", () => {
    const store = useComposerDraftStore.getState();

    store.setRuntimeMode(threadId, "approval-required");
    store.setInteractionMode(threadId, "plan");
    store.setRuntimeMode(threadId, null);
    store.setInteractionMode(threadId, null);

    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]).toBeUndefined();
  });
});

describe("composerDraftStore persistence", () => {
  const threadId = ThreadId.makeUnsafe("thread-persistence");

  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.doUnmock("./composerDraftAttachmentPersistence");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("stores only attachment metadata in localStorage", async () => {
    const memoryLocalStorage = createMemoryLocalStorage();
    vi.stubGlobal("localStorage", memoryLocalStorage);
    vi.doMock("./composerDraftAttachmentPersistence", async () => {
      const actual = await vi.importActual<typeof composerDraftAttachmentPersistence>(
        "./composerDraftAttachmentPersistence",
      );
      return {
        ...actual,
        persistComposerDraftAttachments: vi.fn().mockResolvedValue(new Set(["img-1"])),
      };
    });
    const { useComposerDraftStore, COMPOSER_DRAFT_STORAGE_KEY } =
      await import("./composerDraftStore");

    useComposerDraftStore.getState().setPrompt(threadId, "with image");
    useComposerDraftStore.getState().addImageSnapshots(threadId, [
      makeSnapshot({
        id: "img-1",
        previewUrl: "blob:img-1",
      }),
    ]);
    await flushAsyncWork();

    const raw = memoryLocalStorage.getItem(COMPOSER_DRAFT_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const persisted = JSON.parse(raw as string) as {
      state: {
        draftsByThreadId: Record<string, { attachments: Array<Record<string, unknown>> }>;
      };
    };
    expect(persisted.state.draftsByThreadId[threadId]?.attachments).toEqual([
      {
        id: "img-1",
        name: "image.png",
        mimeType: "image/png",
        sizeBytes: 4,
      },
    ]);
  });

  it("keeps attachment payloads in memory and marks them non-persisted when IndexedDB writes fail", async () => {
    const memoryLocalStorage = createMemoryLocalStorage();
    vi.stubGlobal("localStorage", memoryLocalStorage);
    vi.doMock("./composerDraftAttachmentPersistence", async () => {
      const actual = await vi.importActual<typeof composerDraftAttachmentPersistence>(
        "./composerDraftAttachmentPersistence",
      );
      return {
        ...actual,
        persistComposerDraftAttachments: vi.fn().mockResolvedValue(new Set()),
      };
    });
    const { useComposerDraftStore } = await import("./composerDraftStore");

    useComposerDraftStore.getState().addImageSnapshots(threadId, [
      makeSnapshot({
        id: "img-1",
        previewUrl: "blob:img-1",
      }),
    ]);
    await flushAsyncWork();

    const draft = useComposerDraftStore.getState().draftsByThreadId[threadId];
    expect(draft?.attachmentPayloads.map((attachment) => attachment.id)).toEqual(["img-1"]);
    expect(draft?.persistedAttachmentMetadata).toEqual([]);
    expect(draft?.nonPersistedImageIds).toEqual(["img-1"]);
  });

  it("swallows QuotaExceededError from localStorage persistence", async () => {
    const memoryLocalStorage = createMemoryLocalStorage();
    const quotaError = new DOMException("Quota exceeded", "QuotaExceededError");
    memoryLocalStorage.setItem = () => {
      throw quotaError;
    };
    vi.stubGlobal("localStorage", memoryLocalStorage);
    const { useComposerDraftStore } = await import("./composerDraftStore");

    expect(() => {
      useComposerDraftStore.getState().setPrompt(threadId, "still in memory");
    }).not.toThrow();
    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]?.prompt).toBe(
      "still in memory",
    );
  });

  it("rehydrates persisted attachments from IndexedDB-backed storage", async () => {
    const memoryLocalStorage = createMemoryLocalStorage();
    const persistedAttachment = makePersistedAttachment({ id: "img-1" });
    vi.stubGlobal("localStorage", memoryLocalStorage);
    vi.doMock("./composerDraftAttachmentPersistence", async () => {
      const actual = await vi.importActual<typeof composerDraftAttachmentPersistence>(
        "./composerDraftAttachmentPersistence",
      );
      return {
        ...actual,
        loadPersistedComposerDraftAttachments: vi.fn().mockResolvedValue([persistedAttachment]),
      };
    });

    memoryLocalStorage.setItem(
      COMPOSER_DRAFT_STORAGE_KEY,
      JSON.stringify({
        state: {
          draftsByThreadId: {
            [threadId]: {
              prompt: "rehydrate me",
              attachments: [
                {
                  id: persistedAttachment.id,
                  name: persistedAttachment.name,
                  mimeType: persistedAttachment.mimeType,
                  sizeBytes: persistedAttachment.sizeBytes,
                },
              ],
            },
          },
          draftThreadsByThreadId: {},
          projectDraftThreadIdByProjectId: {},
        },
        version: 2,
      }),
    );
    const { useComposerDraftStore } = await import("./composerDraftStore");
    await flushAsyncWork();

    const draft = useComposerDraftStore.getState().draftsByThreadId[threadId];
    expect(draft?.prompt).toBe("rehydrate me");
    expect(draft?.images.map((image) => image.id)).toEqual(["img-1"]);
    expect(draft?.persistedAttachmentMetadata).toEqual([
      {
        id: "img-1",
        name: "image.png",
        mimeType: "image/png",
        sizeBytes: 4,
      },
    ]);
  });
});
