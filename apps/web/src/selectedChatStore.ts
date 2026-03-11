import { type ProjectId, type ThreadId } from "@fatma/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { DraftThreadState } from "./composerDraftStore";
import type { Project, Thread } from "./types";

const SELECTED_CHAT_STORAGE_KEY = "fatma:selected-chat:v1";

interface SelectedChatStoreState {
  projectId: ProjectId | null;
  threadId: ThreadId | null;
  setSelectedChat: (selection: { projectId: ProjectId; threadId: ThreadId }) => void;
  clearSelectedChat: () => void;
}

export function findProjectIdForThread(input: {
  readonly draftThreadsByThreadId: Record<ThreadId, DraftThreadState>;
  readonly threadId: ThreadId | null;
  readonly threads: readonly Thread[];
}): ProjectId | null {
  if (!input.threadId) {
    return null;
  }

  const serverThread = input.threads.find((thread) => thread.id === input.threadId);
  if (serverThread) {
    return serverThread.projectId;
  }

  return input.draftThreadsByThreadId[input.threadId]?.projectId ?? null;
}

export function getMostRecentThreadIdForProject(input: {
  readonly projectId: ProjectId | null;
  readonly threads: readonly Thread[];
}): ThreadId | null {
  if (!input.projectId) {
    return input.threads[0]?.id ?? null;
  }

  return (
    input.threads
      .filter((thread) => thread.projectId === input.projectId)
      .toSorted((a, b) => {
        const byDate = Date.parse(b.createdAt) - Date.parse(a.createdAt);
        if (byDate !== 0) return byDate;
        return b.id.localeCompare(a.id);
      })[0]?.id ?? null
  );
}

export function resolveSelectedChatProjectId(input: {
  readonly draftThreadsByThreadId: Record<ThreadId, DraftThreadState>;
  readonly projects: readonly Project[];
  readonly selectedProjectId: ProjectId | null;
  readonly selectedThreadId: ThreadId | null;
  readonly threads: readonly Thread[];
}): ProjectId | null {
  const threadProjectId = findProjectIdForThread({
    draftThreadsByThreadId: input.draftThreadsByThreadId,
    threadId: input.selectedThreadId,
    threads: input.threads,
  });
  if (threadProjectId && input.projects.some((project) => project.id === threadProjectId)) {
    return threadProjectId;
  }

  if (!input.selectedProjectId) {
    return null;
  }

  return input.projects.some((project) => project.id === input.selectedProjectId)
    ? input.selectedProjectId
    : null;
}

export function resolveSelectedChatThreadId(input: {
  readonly draftThreadsByThreadId: Record<ThreadId, DraftThreadState>;
  readonly selectedThreadId: ThreadId | null;
  readonly threads: readonly Thread[];
}): ThreadId | null {
  return findProjectIdForThread({
    draftThreadsByThreadId: input.draftThreadsByThreadId,
    threadId: input.selectedThreadId,
    threads: input.threads,
  })
    ? input.selectedThreadId
    : null;
}

export const useSelectedChatStore = create<SelectedChatStoreState>()(
  persist(
    (set) => ({
      projectId: null,
      threadId: null,
      setSelectedChat: ({ projectId, threadId }) => {
        set((state) => {
          if (state.projectId === projectId && state.threadId === threadId) {
            return state;
          }
          return {
            projectId,
            threadId,
          };
        });
      },
      clearSelectedChat: () => {
        set((state) => {
          if (state.projectId === null && state.threadId === null) {
            return state;
          }
          return {
            projectId: null,
            threadId: null,
          };
        });
      },
    }),
    {
      name: SELECTED_CHAT_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
