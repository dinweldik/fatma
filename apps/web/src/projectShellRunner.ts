import { type ProjectId, type ProjectScript } from "@t3tools/contracts";

import { readNativeApi } from "./nativeApi";
import { type Project } from "./types";
import { projectScriptRuntimeEnv } from "./projectScripts";
import { projectShellRuntimeThreadId, type ProjectShellRecord } from "./projectShells";
import { selectProjectShellCollection, useProjectShellStore } from "./projectShellStore";

function envEntries(env: Record<string, string>): Array<[string, string]> {
  return Object.entries(env).toSorted(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
}

function sameEnv(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftEntries = envEntries(left);
  const rightEntries = envEntries(right);
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }
  for (let index = 0; index < leftEntries.length; index += 1) {
    const leftEntry = leftEntries[index];
    const rightEntry = rightEntries[index];
    if (!leftEntry || !rightEntry) {
      return false;
    }
    if (leftEntry[0] !== rightEntry[0] || leftEntry[1] !== rightEntry[1]) {
      return false;
    }
  }
  return true;
}

export function defaultProjectShellConfig(project: Project): {
  cwd: string;
  env: Record<string, string>;
} {
  return {
    cwd: project.cwd,
    env: projectScriptRuntimeEnv({
      project: {
        cwd: project.cwd,
      },
    }),
  };
}

export function createProjectShell(
  projectId: ProjectId,
  config: { cwd: string; env?: Record<string, string> },
) {
  return useProjectShellStore.getState().createShell(projectId, config);
}

export function ensureProjectShell(
  projectId: ProjectId,
  config: { cwd: string; env?: Record<string, string> },
) {
  return useProjectShellStore.getState().ensureShell(projectId, config);
}

export async function closeProjectShell(projectId: ProjectId, shellId: string): Promise<void> {
  const api = readNativeApi();
  if (!api) {
    throw new Error("Native API is unavailable.");
  }

  await api.terminal
    .close({
      threadId: projectShellRuntimeThreadId(projectId, shellId),
      deleteHistory: true,
    })
    .catch(() => undefined);
  useProjectShellStore.getState().removeShell(projectId, shellId);
}

export async function closeAllProjectShells(projectId: ProjectId): Promise<void> {
  const api = readNativeApi();
  if (!api) {
    throw new Error("Native API is unavailable.");
  }

  const collection = selectProjectShellCollection(
    useProjectShellStore.getState().shellStateByProjectId,
    projectId,
  );
  for (const shell of collection.shells) {
    await api.terminal
      .close({
        threadId: projectShellRuntimeThreadId(projectId, shell.id),
        deleteHistory: true,
      })
      .catch(() => undefined);
    useProjectShellStore.getState().removeShell(projectId, shell.id);
  }
}

async function openProjectShellSession(
  projectId: ProjectId,
  shell: ProjectShellRecord,
): Promise<void> {
  const api = readNativeApi();
  if (!api) {
    throw new Error("Native API is unavailable.");
  }

  await api.terminal.open({
    threadId: projectShellRuntimeThreadId(projectId, shell.id),
    cwd: shell.cwd,
    env: shell.env,
  });
}

function matchingActiveProjectShell(
  projectId: ProjectId,
  config: { cwd: string; env: Record<string, string> },
): ProjectShellRecord | null {
  const collection = selectProjectShellCollection(
    useProjectShellStore.getState().shellStateByProjectId,
    projectId,
  );
  if (!collection.activeShellId) {
    return null;
  }
  const activeShell =
    collection.shells.find((shell) => shell.id === collection.activeShellId) ?? null;
  if (!activeShell) {
    return null;
  }
  if (collection.runningShellIds.includes(activeShell.id)) {
    return null;
  }
  if (activeShell.cwd !== config.cwd) {
    return null;
  }
  if (!sameEnv(activeShell.env, config.env)) {
    return null;
  }
  return activeShell;
}

export async function runProjectScriptInShell(input: {
  project: Project;
  script: ProjectScript;
  cwd?: string;
  worktreePath?: string | null;
  env?: Record<string, string>;
  preferNewShell?: boolean;
}): Promise<ProjectShellRecord> {
  const config = {
    cwd: input.cwd ?? input.project.cwd,
    env: projectScriptRuntimeEnv({
      project: {
        cwd: input.project.cwd,
      },
      worktreePath: input.worktreePath ?? null,
      ...(input.env ? { extraEnv: input.env } : {}),
    }),
  };

  const shell =
    input.preferNewShell === true
      ? createProjectShell(input.project.id, config)
      : (matchingActiveProjectShell(input.project.id, config) ??
        createProjectShell(input.project.id, config));

  useProjectShellStore.getState().setActiveShell(input.project.id, shell.id);
  await openProjectShellSession(input.project.id, shell);

  const api = readNativeApi();
  if (!api) {
    throw new Error("Native API is unavailable.");
  }

  await api.terminal.write({
    threadId: projectShellRuntimeThreadId(input.project.id, shell.id),
    data: `${input.script.command}\r`,
  });

  return shell;
}
