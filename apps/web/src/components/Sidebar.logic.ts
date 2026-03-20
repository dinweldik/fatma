import type { Project, Thread } from "../types";
import {
  derivePendingApprovals,
  derivePendingUserInputs,
  findLatestProposedPlan,
  isLatestTurnSettled,
} from "../session-logic";

export const THREAD_SELECTION_SAFE_SELECTOR = "[data-thread-item], [data-thread-selection-safe]";

export interface ThreadStatusPill {
  label:
    | "Working"
    | "Connecting"
    | "Completed"
    | "Pending Approval"
    | "Awaiting Input"
    | "Plan Ready";
  colorClass: string;
  dotClass: string;
  pulse: boolean;
}

type ThreadStatusInput = Pick<
  Thread,
  "interactionMode" | "latestTurn" | "lastVisitedAt" | "proposedPlans" | "session"
>;

export interface SidebarThreadState {
  hasPendingApprovals: boolean;
  hasPendingUserInput: boolean;
  statusPill: ThreadStatusPill | null;
}

export interface ProjectThreadList<TThread extends Pick<Thread, "createdAt" | "id" | "projectId">> {
  allThreads: readonly TThread[];
  hasHiddenThreads: boolean;
  hiddenThreadCount: number;
  isExpanded: boolean;
  visibleThreads: readonly TThread[];
}

export function hasUnseenCompletion(thread: ThreadStatusInput): boolean {
  if (!thread.latestTurn?.completedAt) return false;
  const completedAt = Date.parse(thread.latestTurn.completedAt);
  if (Number.isNaN(completedAt)) return false;
  if (!thread.lastVisitedAt) return true;

  const lastVisitedAt = Date.parse(thread.lastVisitedAt);
  if (Number.isNaN(lastVisitedAt)) return true;
  return completedAt > lastVisitedAt;
}

export function shouldClearThreadSelectionOnMouseDown(target: HTMLElement | null): boolean {
  if (target === null) return true;
  return !target.closest(THREAD_SELECTION_SAFE_SELECTOR);
}

export function resolveThreadStatusPill(input: {
  thread: ThreadStatusInput;
  hasPendingApprovals: boolean;
  hasPendingUserInput: boolean;
}): ThreadStatusPill | null {
  const { hasPendingApprovals, hasPendingUserInput, thread } = input;

  if (hasPendingApprovals) {
    return {
      label: "Pending Approval",
      colorClass: "text-amber-600 dark:text-amber-300/90",
      dotClass: "bg-amber-500 dark:bg-amber-300/90",
      pulse: false,
    };
  }

  if (hasPendingUserInput) {
    return {
      label: "Awaiting Input",
      colorClass: "text-indigo-600 dark:text-indigo-300/90",
      dotClass: "bg-indigo-500 dark:bg-indigo-300/90",
      pulse: false,
    };
  }

  if (thread.session?.status === "running") {
    return {
      label: "Working",
      colorClass: "text-sky-600 dark:text-sky-300/80",
      dotClass: "bg-sky-500 dark:bg-sky-300/80",
      pulse: true,
    };
  }

  if (thread.session?.status === "connecting") {
    return {
      label: "Connecting",
      colorClass: "text-sky-600 dark:text-sky-300/80",
      dotClass: "bg-sky-500 dark:bg-sky-300/80",
      pulse: true,
    };
  }

  const hasPlanReadyPrompt =
    !hasPendingUserInput &&
    thread.interactionMode === "plan" &&
    isLatestTurnSettled(thread.latestTurn, thread.session) &&
    findLatestProposedPlan(thread.proposedPlans, thread.latestTurn?.turnId ?? null) !== null;
  if (hasPlanReadyPrompt) {
    return {
      label: "Plan Ready",
      colorClass: "text-violet-600 dark:text-violet-300/90",
      dotClass: "bg-violet-500 dark:bg-violet-300/90",
      pulse: false,
    };
  }

  if (hasUnseenCompletion(thread)) {
    return {
      label: "Completed",
      colorClass: "text-emerald-600 dark:text-emerald-300/90",
      dotClass: "bg-emerald-500 dark:bg-emerald-300/90",
      pulse: false,
    };
  }

  return null;
}

export function resolveSidebarThreadState(
  thread: ThreadStatusInput & Pick<Thread, "activities">,
): SidebarThreadState {
  const hasPendingApprovals = derivePendingApprovals(thread.activities).length > 0;
  const hasPendingUserInput = derivePendingUserInputs(thread.activities).length > 0;

  return {
    hasPendingApprovals,
    hasPendingUserInput,
    statusPill: resolveThreadStatusPill({
      thread,
      hasPendingApprovals,
      hasPendingUserInput,
    }),
  };
}

export function compareThreadsByCreatedAtDescending(
  left: Pick<Thread, "createdAt" | "id">,
  right: Pick<Thread, "createdAt" | "id">,
): number {
  const byDate = Date.parse(right.createdAt) - Date.parse(left.createdAt);
  if (byDate !== 0) {
    return byDate;
  }
  return right.id.localeCompare(left.id);
}

export function buildThreadsByProjectId<
  TThread extends Pick<Thread, "createdAt" | "id" | "projectId">,
>(threads: ReadonlyArray<TThread>): Map<Project["id"], TThread[]> {
  const grouped = new Map<Project["id"], TThread[]>();
  for (const thread of threads) {
    const existing = grouped.get(thread.projectId);
    if (existing) {
      existing.push(thread);
      continue;
    }
    grouped.set(thread.projectId, [thread]);
  }
  for (const projectThreads of grouped.values()) {
    projectThreads.sort(compareThreadsByCreatedAtDescending);
  }
  return grouped;
}

export function buildProjectThreadLists<
  TThread extends Pick<Thread, "createdAt" | "id" | "projectId">,
>(input: {
  projectIds: ReadonlyArray<Project["id"]>;
  previewLimit: number;
  expandedProjectIds: ReadonlySet<Project["id"]>;
  threadsByProjectId: ReadonlyMap<Project["id"], ReadonlyArray<TThread>>;
}): Map<Project["id"], ProjectThreadList<TThread>> {
  const lists = new Map<Project["id"], ProjectThreadList<TThread>>();
  for (const projectId of input.projectIds) {
    lists.set(
      projectId,
      visibleThreadsForProject({
        projectId,
        previewLimit: input.previewLimit,
        expandedProjectIds: input.expandedProjectIds,
        threadsByProjectId: input.threadsByProjectId,
      }),
    );
  }
  return lists;
}

export function visibleThreadsForProject<
  TThread extends Pick<Thread, "createdAt" | "id" | "projectId">,
>(input: {
  projectId: Project["id"];
  previewLimit: number;
  expandedProjectIds: ReadonlySet<Project["id"]>;
  threadsByProjectId: ReadonlyMap<Project["id"], ReadonlyArray<TThread>>;
}): ProjectThreadList<TThread> {
  const emptyThreads: readonly TThread[] = [];
  const allThreads = input.threadsByProjectId.get(input.projectId) ?? emptyThreads;
  const isExpanded = input.expandedProjectIds.has(input.projectId);
  const hasHiddenThreads = allThreads.length > input.previewLimit;
  const visibleThreads =
    hasHiddenThreads && !isExpanded ? allThreads.slice(0, input.previewLimit) : allThreads;

  return {
    allThreads,
    hasHiddenThreads,
    hiddenThreadCount: hasHiddenThreads ? allThreads.length - visibleThreads.length : 0,
    isExpanded,
    visibleThreads,
  };
}

export function findNewestThread<TThread extends Pick<Thread, "createdAt" | "id">>(
  threads: ReadonlyArray<TThread>,
): TThread | null {
  return threads[0] ?? null;
}
