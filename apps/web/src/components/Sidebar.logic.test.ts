import { ProjectId, ThreadId } from "@fatma/contracts";
import { describe, expect, it } from "vitest";

import {
  buildProjectThreadLists,
  buildThreadsByProjectId,
  findNewestThread,
  hasUnseenCompletion,
  resolveSidebarThreadState,
  resolveThreadStatusPill,
  compareThreadsByCreatedAtDescending,
  shouldClearThreadSelectionOnMouseDown,
  visibleThreadsForProject,
} from "./Sidebar.logic";

function makeLatestTurn(overrides?: {
  completedAt?: string | null;
  startedAt?: string | null;
}): Parameters<typeof hasUnseenCompletion>[0]["latestTurn"] {
  return {
    turnId: "turn-1" as never,
    state: "completed",
    assistantMessageId: null,
    requestedAt: "2026-03-09T10:00:00.000Z",
    startedAt: overrides?.startedAt ?? "2026-03-09T10:00:00.000Z",
    completedAt: overrides?.completedAt ?? "2026-03-09T10:05:00.000Z",
  };
}

describe("hasUnseenCompletion", () => {
  it("returns true when a thread completed after its last visit", () => {
    expect(
      hasUnseenCompletion({
        interactionMode: "default",
        latestTurn: makeLatestTurn(),
        lastVisitedAt: "2026-03-09T10:04:00.000Z",
        proposedPlans: [],
        session: null,
      }),
    ).toBe(true);
  });
});

describe("shouldClearThreadSelectionOnMouseDown", () => {
  it("preserves selection for thread items", () => {
    const child = {
      closest: (selector: string) =>
        selector.includes("[data-thread-item]") ? ({} as Element) : null,
    } as unknown as HTMLElement;

    expect(shouldClearThreadSelectionOnMouseDown(child)).toBe(false);
  });

  it("preserves selection for thread list toggle controls", () => {
    const selectionSafe = {
      closest: (selector: string) =>
        selector.includes("[data-thread-selection-safe]") ? ({} as Element) : null,
    } as unknown as HTMLElement;

    expect(shouldClearThreadSelectionOnMouseDown(selectionSafe)).toBe(false);
  });

  it("clears selection for unrelated sidebar clicks", () => {
    const unrelated = {
      closest: () => null,
    } as unknown as HTMLElement;

    expect(shouldClearThreadSelectionOnMouseDown(unrelated)).toBe(true);
  });
});

describe("resolveThreadStatusPill", () => {
  const baseThread = {
    interactionMode: "plan" as const,
    latestTurn: null,
    lastVisitedAt: undefined,
    proposedPlans: [],
    session: {
      provider: "codex" as const,
      status: "running" as const,
      createdAt: "2026-03-09T10:00:00.000Z",
      updatedAt: "2026-03-09T10:00:00.000Z",
      orchestrationStatus: "running" as const,
    },
  };

  it("shows pending approval before all other statuses", () => {
    expect(
      resolveThreadStatusPill({
        thread: baseThread,
        hasPendingApprovals: true,
        hasPendingUserInput: true,
      }),
    ).toMatchObject({ label: "Pending Approval", pulse: false });
  });

  it("shows awaiting input when plan mode is blocked on user answers", () => {
    expect(
      resolveThreadStatusPill({
        thread: baseThread,
        hasPendingApprovals: false,
        hasPendingUserInput: true,
      }),
    ).toMatchObject({ label: "Awaiting Input", pulse: false });
  });

  it("falls back to working when the thread is actively running without blockers", () => {
    expect(
      resolveThreadStatusPill({
        thread: baseThread,
        hasPendingApprovals: false,
        hasPendingUserInput: false,
      }),
    ).toMatchObject({ label: "Working", pulse: true });
  });

  it("shows plan ready when a settled plan turn has a proposed plan ready for follow-up", () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          latestTurn: makeLatestTurn(),
          proposedPlans: [
            {
              id: "plan-1" as never,
              turnId: "turn-1" as never,
              createdAt: "2026-03-09T10:00:00.000Z",
              updatedAt: "2026-03-09T10:05:00.000Z",
              planMarkdown: "# Plan",
            },
          ],
          session: {
            ...baseThread.session,
            status: "ready",
            orchestrationStatus: "ready",
          },
        },
        hasPendingApprovals: false,
        hasPendingUserInput: false,
      }),
    ).toMatchObject({ label: "Plan Ready", pulse: false });
  });

  it("shows completed when there is an unseen completion and no active blocker", () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          interactionMode: "default",
          latestTurn: makeLatestTurn(),
          lastVisitedAt: "2026-03-09T10:04:00.000Z",
          session: {
            ...baseThread.session,
            status: "ready",
            orchestrationStatus: "ready",
          },
        },
        hasPendingApprovals: false,
        hasPendingUserInput: false,
      }),
    ).toMatchObject({ label: "Completed", pulse: false });
  });
});

describe("resolveSidebarThreadState", () => {
  it("derives pending user-input state from thread activities", () => {
    const state = resolveSidebarThreadState({
      interactionMode: "default",
      latestTurn: null,
      lastVisitedAt: undefined,
      proposedPlans: [],
      session: null,
      activities: [
        {
          id: "event-1" as never,
          tone: "approval",
          kind: "user-input.requested",
          summary: "Need input",
          payload: {
            requestId: "request-1",
            questions: [
              {
                id: "question-1",
                header: "Question",
                question: "Pick one",
                options: [{ label: "Yes", description: "Approve" }],
              },
            ],
          },
          turnId: null,
          createdAt: "2026-03-09T10:00:00.000Z",
        },
      ],
    });

    expect(state.hasPendingApprovals).toBe(false);
    expect(state.hasPendingUserInput).toBe(true);
    expect(state.statusPill).toMatchObject({ label: "Awaiting Input", pulse: false });
  });
});

describe("sidebar thread derivation", () => {
  type DerivedThread = {
    id: ThreadId;
    projectId: ProjectId;
    createdAt: string;
  };
  const project1 = ProjectId.makeUnsafe("project-1");
  const project2 = ProjectId.makeUnsafe("project-2");
  const project3 = ProjectId.makeUnsafe("project-3");
  const threadA: DerivedThread = {
    id: ThreadId.makeUnsafe("thread-a"),
    projectId: project1,
    createdAt: "2026-03-09T10:01:00.000Z",
  };
  const threadB: DerivedThread = {
    id: ThreadId.makeUnsafe("thread-b"),
    projectId: project1,
    createdAt: "2026-03-09T10:03:00.000Z",
  };
  const threadC: DerivedThread = {
    id: ThreadId.makeUnsafe("thread-c"),
    projectId: project2,
    createdAt: "2026-03-09T10:02:00.000Z",
  };

  it("sorts threads by newest first", () => {
    expect(
      [threadA, threadB].toSorted(compareThreadsByCreatedAtDescending).map((thread) => thread.id),
    ).toEqual(["thread-b", "thread-a"]);
  });

  it("groups and sorts threads once per project", () => {
    const grouped = buildThreadsByProjectId([threadA, threadB, threadC]);

    expect(grouped.get(project1)?.map((thread) => thread.id)).toEqual([threadB.id, threadA.id]);
    expect(grouped.get(project2)?.map((thread) => thread.id)).toEqual([threadC.id]);
  });

  it("slices project thread previews without recomputing inline render logic", () => {
    const grouped = buildThreadsByProjectId([threadA, threadB, threadC]);

    expect(
      visibleThreadsForProject({
        projectId: project1,
        previewLimit: 1,
        expandedProjectIds: new Set(),
        threadsByProjectId: grouped,
      }),
    ).toMatchObject({
      hasHiddenThreads: true,
      hiddenThreadCount: 1,
      isExpanded: false,
      visibleThreads: [{ id: "thread-b" }],
    });
  });

  it("builds per-project thread lists for every project once", () => {
    const grouped = buildThreadsByProjectId([threadA, threadB, threadC]);

    const lists = buildProjectThreadLists({
      projectIds: [project1, project2, project3],
      previewLimit: 1,
      expandedProjectIds: new Set([project2]),
      threadsByProjectId: grouped,
    });

    expect(lists.get(project1)).toMatchObject({
      hasHiddenThreads: true,
      hiddenThreadCount: 1,
      isExpanded: false,
    });
    expect(lists.get(project2)).toMatchObject({
      hasHiddenThreads: false,
      hiddenThreadCount: 0,
      isExpanded: true,
      visibleThreads: [{ id: "thread-c" }],
    });
    expect(lists.get(project3)).toMatchObject({
      allThreads: [],
      visibleThreads: [],
      hasHiddenThreads: false,
      hiddenThreadCount: 0,
      isExpanded: false,
    });
  });

  it("returns the newest thread from a pre-sorted list", () => {
    expect(findNewestThread([threadB, threadA])).toMatchObject({ id: "thread-b" });
    expect(findNewestThread([])).toBeNull();
  });
});
