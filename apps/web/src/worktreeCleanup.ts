import type { ThreadId } from "@fatma/contracts";

import type { Thread } from "./types";

export function getOrphanedWorktreePathForThread(
  threads: ReadonlyArray<Thread>,
  threadId: ThreadId,
): string | null {
  const targetThread = threads.find((thread) => thread.id === threadId);
  const worktreePath = targetThread?.worktreePath ?? null;
  if (!worktreePath) {
    return null;
  }

  const hasSiblingThread = threads.some(
    (thread) => thread.id !== threadId && thread.worktreePath === worktreePath,
  );
  return hasSiblingThread ? null : worktreePath;
}

export function formatWorktreePathForDisplay(worktreePath: string): string {
  const trimmedPath = worktreePath.replace(/[\\/]+$/, "");
  const normalizedPath = trimmedPath.replace(/\\/g, "/");
  const lastSegment = normalizedPath.split("/").at(-1);
  return lastSegment && lastSegment.length > 0 ? lastSegment : normalizedPath;
}
