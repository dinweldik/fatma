import { type ProjectId } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import {
  defaultProjectShellTitle,
  newProjectShellId,
  projectShellCollectionDefaults,
  type ProjectShellCollectionState,
  type ProjectShellConfig,
  type ProjectShellRecord,
} from "./projectShells";

const PROJECT_SHELL_STORAGE_KEY = "t3code:project-shells:v1";

function normalizeShellEnv(env: Record<string, string> | undefined): Record<string, string> {
  if (!env) {
    return {};
  }

  const entries = Object.entries(env).filter(([key]) => key.trim().length > 0);
  if (entries.length === 0) {
    return {};
  }
  return Object.fromEntries(entries);
}

function uniqueShells(shells: ProjectShellRecord[]): ProjectShellRecord[] {
  const seen = new Set<string>();
  const nextShells: ProjectShellRecord[] = [];

  for (const shell of shells) {
    const shellId = shell.id.trim();
    const shellTitle = shell.title.trim();
    const shellCwd = shell.cwd.trim();
    if (shellId.length === 0 || shellTitle.length === 0 || shellCwd.length === 0) {
      continue;
    }
    if (seen.has(shellId)) {
      continue;
    }
    seen.add(shellId);
    nextShells.push({
      ...shell,
      id: shellId,
      title: shellTitle,
      cwd: shellCwd,
      env: normalizeShellEnv(shell.env),
    });
  }

  return nextShells;
}

function normalizeCollection(
  collection: ProjectShellCollectionState | undefined,
): ProjectShellCollectionState {
  const defaults = projectShellCollectionDefaults();
  if (!collection) {
    return defaults;
  }

  const shells = uniqueShells(collection.shells);
  const shellIdSet = new Set(shells.map((shell) => shell.id));
  const activeShellId =
    collection.activeShellId && shellIdSet.has(collection.activeShellId)
      ? collection.activeShellId
      : (shells[0]?.id ?? null);
  const runningShellIds = [...new Set(collection.runningShellIds)].filter((shellId) =>
    shellIdSet.has(shellId),
  );
  const nextShellOrdinal = Math.max(
    shells.length + 1,
    Number.isFinite(collection.nextShellOrdinal) ? Math.floor(collection.nextShellOrdinal) : 1,
    1,
  );

  return {
    shells,
    activeShellId,
    nextShellOrdinal,
    runningShellIds,
  };
}

function collectionsEqual(
  left: ProjectShellCollectionState,
  right: ProjectShellCollectionState,
): boolean {
  if (
    left.activeShellId !== right.activeShellId ||
    left.nextShellOrdinal !== right.nextShellOrdinal ||
    left.shells.length !== right.shells.length ||
    left.runningShellIds.length !== right.runningShellIds.length
  ) {
    return false;
  }

  for (let index = 0; index < left.shells.length; index += 1) {
    const leftShell = left.shells[index];
    const rightShell = right.shells[index];
    if (!leftShell || !rightShell) {
      return false;
    }
    if (
      leftShell.id !== rightShell.id ||
      leftShell.title !== rightShell.title ||
      leftShell.createdAt !== rightShell.createdAt ||
      leftShell.cwd !== rightShell.cwd
    ) {
      return false;
    }
    const leftEnvEntries = Object.entries(leftShell.env);
    const rightEnvEntries = Object.entries(rightShell.env);
    if (leftEnvEntries.length !== rightEnvEntries.length) {
      return false;
    }
    for (const [key, value] of leftEnvEntries) {
      if (rightShell.env[key] !== value) {
        return false;
      }
    }
  }

  for (let index = 0; index < left.runningShellIds.length; index += 1) {
    if (left.runningShellIds[index] !== right.runningShellIds[index]) {
      return false;
    }
  }

  return true;
}

function selectCollection(
  shellStateByProjectId: Record<ProjectId, ProjectShellCollectionState>,
  projectId: ProjectId,
): ProjectShellCollectionState {
  const existing = shellStateByProjectId[projectId];
  return normalizeCollection(existing);
}

function updateCollectionMap(
  shellStateByProjectId: Record<ProjectId, ProjectShellCollectionState>,
  projectId: ProjectId,
  updater: (collection: ProjectShellCollectionState) => ProjectShellCollectionState,
): Record<ProjectId, ProjectShellCollectionState> {
  const current = selectCollection(shellStateByProjectId, projectId);
  const next = normalizeCollection(updater(current));

  if (collectionsEqual(current, next)) {
    return shellStateByProjectId;
  }

  if (next.shells.length === 0) {
    if (shellStateByProjectId[projectId] === undefined) {
      return shellStateByProjectId;
    }
    const { [projectId]: _removed, ...rest } = shellStateByProjectId;
    return rest as Record<ProjectId, ProjectShellCollectionState>;
  }

  return {
    ...shellStateByProjectId,
    [projectId]: next,
  };
}

interface PersistedShellCollectionState {
  shells: ProjectShellRecord[];
  activeShellId: string | null;
  nextShellOrdinal: number;
}

interface ProjectShellStoreState {
  shellStateByProjectId: Record<ProjectId, ProjectShellCollectionState>;
  createShell: (projectId: ProjectId, config: ProjectShellConfig) => ProjectShellRecord;
  ensureShell: (projectId: ProjectId, config: ProjectShellConfig) => ProjectShellRecord;
  setActiveShell: (projectId: ProjectId, shellId: string) => void;
  removeShell: (projectId: ProjectId, shellId: string) => void;
  setShellActivity: (projectId: ProjectId, shellId: string, hasRunningSubprocess: boolean) => void;
  removeOrphanedProjectShellStates: (activeProjectIds: Set<ProjectId>) => void;
}

export function selectProjectShellCollection(
  shellStateByProjectId: Record<ProjectId, ProjectShellCollectionState>,
  projectId: ProjectId,
): ProjectShellCollectionState {
  return selectCollection(shellStateByProjectId, projectId);
}

export const useProjectShellStore = create<ProjectShellStoreState>()(
  persist(
    (set, get) => ({
      shellStateByProjectId: {},
      createShell: (projectId, config) => {
        const shell: ProjectShellRecord = {
          id: newProjectShellId(),
          title:
            config.title?.trim() ||
            defaultProjectShellTitle(
              selectCollection(get().shellStateByProjectId, projectId).nextShellOrdinal,
            ),
          createdAt: new Date().toISOString(),
          cwd: config.cwd.trim(),
          env: normalizeShellEnv(config.env),
        };

        set((state) => ({
          shellStateByProjectId: updateCollectionMap(
            state.shellStateByProjectId,
            projectId,
            (collection) => ({
              ...collection,
              shells: [shell, ...collection.shells],
              activeShellId: shell.id,
              nextShellOrdinal: collection.nextShellOrdinal + 1,
            }),
          ),
        }));

        return shell;
      },
      ensureShell: (projectId, config) => {
        const collection = selectCollection(get().shellStateByProjectId, projectId);
        const activeShell =
          collection.activeShellId === null
            ? null
            : (collection.shells.find((shell) => shell.id === collection.activeShellId) ?? null);
        if (activeShell) {
          return activeShell;
        }
        return get().createShell(projectId, config);
      },
      setActiveShell: (projectId, shellId) => {
        set((state) => ({
          shellStateByProjectId: updateCollectionMap(
            state.shellStateByProjectId,
            projectId,
            (collection) => {
              if (!collection.shells.some((shell) => shell.id === shellId)) {
                return collection;
              }
              if (collection.activeShellId === shellId) {
                return collection;
              }
              return {
                ...collection,
                activeShellId: shellId,
              };
            },
          ),
        }));
      },
      removeShell: (projectId, shellId) => {
        set((state) => ({
          shellStateByProjectId: updateCollectionMap(
            state.shellStateByProjectId,
            projectId,
            (collection) => {
              const remainingShells = collection.shells.filter((shell) => shell.id !== shellId);
              const nextActiveShellId =
                collection.activeShellId === shellId
                  ? (remainingShells[0]?.id ?? null)
                  : collection.activeShellId;
              return {
                ...collection,
                shells: remainingShells,
                activeShellId: nextActiveShellId,
                runningShellIds: collection.runningShellIds.filter(
                  (runningId) => runningId !== shellId,
                ),
              };
            },
          ),
        }));
      },
      setShellActivity: (projectId, shellId, hasRunningSubprocess) => {
        set((state) => ({
          shellStateByProjectId: updateCollectionMap(
            state.shellStateByProjectId,
            projectId,
            (collection) => {
              if (!collection.shells.some((shell) => shell.id === shellId)) {
                return collection;
              }
              const runningShellIds = new Set(collection.runningShellIds);
              if (hasRunningSubprocess) {
                runningShellIds.add(shellId);
              } else {
                runningShellIds.delete(shellId);
              }
              return {
                ...collection,
                runningShellIds: [...runningShellIds],
              };
            },
          ),
        }));
      },
      removeOrphanedProjectShellStates: (activeProjectIds) => {
        set((state) => {
          const orphanedProjectIds = Object.keys(state.shellStateByProjectId).filter(
            (projectId) => !activeProjectIds.has(projectId as ProjectId),
          );
          if (orphanedProjectIds.length === 0) {
            return state;
          }
          const nextShellStateByProjectId = { ...state.shellStateByProjectId };
          for (const projectId of orphanedProjectIds) {
            delete nextShellStateByProjectId[projectId as ProjectId];
          }
          return {
            shellStateByProjectId: nextShellStateByProjectId,
          };
        });
      },
    }),
    {
      name: PROJECT_SHELL_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        shellStateByProjectId: Object.fromEntries(
          Object.entries(state.shellStateByProjectId).map(([projectId, collection]) => [
            projectId,
            {
              shells: collection.shells,
              activeShellId: collection.activeShellId,
              nextShellOrdinal: collection.nextShellOrdinal,
            } satisfies PersistedShellCollectionState,
          ]),
        ) as Record<ProjectId, PersistedShellCollectionState>,
      }),
      merge: (persistedState, currentState) => {
        const merged = persistedState as
          | {
              shellStateByProjectId?: Record<ProjectId, PersistedShellCollectionState>;
            }
          | undefined;

        const nextShellStateByProjectId: Record<ProjectId, ProjectShellCollectionState> = {};
        for (const [projectId, collection] of Object.entries(merged?.shellStateByProjectId ?? {})) {
          nextShellStateByProjectId[projectId as ProjectId] = normalizeCollection({
            shells: collection.shells,
            activeShellId: collection.activeShellId,
            nextShellOrdinal: collection.nextShellOrdinal,
            runningShellIds: [],
          });
        }

        return {
          ...currentState,
          shellStateByProjectId: nextShellStateByProjectId,
        };
      },
    },
  ),
);
