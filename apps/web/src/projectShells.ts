import { ProjectId, ThreadId } from "@fatma/contracts";

import { randomUuid } from "./lib/utils";

const PROJECT_SHELL_THREAD_PREFIX = "project-shell";

export interface ProjectShellRecord {
  id: string;
  title: string;
  createdAt: string;
  cwd: string;
  env: Record<string, string>;
}

export interface ProjectShellCollectionState {
  shells: ProjectShellRecord[];
  activeShellId: string | null;
  nextShellOrdinal: number;
  runningShellIds: string[];
}

export interface ProjectShellConfig {
  cwd: string;
  env?: Record<string, string>;
  title?: string | null;
}

export function newProjectShellId(): string {
  return `shell-${randomUuid()}`;
}

export function defaultProjectShellTitle(ordinal: number): string {
  return `Shell ${ordinal}`;
}

export function projectShellRuntimeThreadId(projectId: ProjectId, shellId: string): ThreadId {
  return ThreadId.makeUnsafe(`${PROJECT_SHELL_THREAD_PREFIX}:${projectId}:${shellId}`);
}

export function parseProjectShellRuntimeThreadId(
  runtimeThreadId: string,
): { projectId: ProjectId; shellId: string } | null {
  if (!runtimeThreadId.startsWith(`${PROJECT_SHELL_THREAD_PREFIX}:`)) {
    return null;
  }

  const parts = runtimeThreadId.split(":");
  if (parts.length !== 3) {
    return null;
  }

  const [, rawProjectId, shellId] = parts;
  if (!rawProjectId || !shellId) {
    return null;
  }

  return {
    projectId: ProjectId.makeUnsafe(rawProjectId),
    shellId,
  };
}

export function projectShellsRoutePath(projectId: ProjectId, shellId: string): string {
  return `/shells/${projectId}/${shellId}`;
}

export function resolveActiveProjectShell(
  collection: ProjectShellCollectionState,
  preferredShellId?: string | null,
): ProjectShellRecord | null {
  if (preferredShellId) {
    const preferredShell = collection.shells.find((shell) => shell.id === preferredShellId) ?? null;
    if (preferredShell) {
      return preferredShell;
    }
  }

  if (collection.activeShellId) {
    const activeShell =
      collection.shells.find((shell) => shell.id === collection.activeShellId) ?? null;
    if (activeShell) {
      return activeShell;
    }
  }

  return collection.shells[0] ?? null;
}

export function projectShellCollectionDefaults(): ProjectShellCollectionState {
  return {
    shells: [],
    activeShellId: null,
    nextShellOrdinal: 1,
    runningShellIds: [],
  };
}
