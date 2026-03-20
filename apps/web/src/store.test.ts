import {
  DEFAULT_MODEL_BY_PROVIDER,
  EventId,
  ProjectId,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
  type OrchestrationReadModel,
} from "@fatma/contracts";
import { describe, expect, it } from "vitest";

import {
  applyIncrementalOrchestrationEvent,
  markThreadUnread,
  removeProjectOptimistically,
  removeThreadOptimistically,
  reorderProjects,
  restoreRemovedProject,
  restoreRemovedThread,
  syncServerReadModel,
  type AppState,
} from "./store";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE, type Thread } from "./types";

function makeProject(
  overrides: Partial<AppState["projects"][number]> = {},
): AppState["projects"][number] {
  return {
    id: ProjectId.makeUnsafe("project-1"),
    name: "Project",
    cwd: "/tmp/project",
    model: "gpt-5-codex",
    expanded: true,
    scripts: [],
    ...overrides,
  };
}

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: ThreadId.makeUnsafe("thread-1"),
    codexThreadId: null,
    projectId: ProjectId.makeUnsafe("project-1"),
    title: "Thread",
    model: "gpt-5-codex",
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    session: null,
    messages: [],
    turnDiffSummaries: [],
    activities: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-02-13T00:00:00.000Z",
    latestTurn: null,
    branch: null,
    worktreePath: null,
    ...overrides,
  };
}

function makeState(thread: Thread): AppState {
  return {
    projects: [makeProject()],
    threads: [thread],
    threadsHydrated: true,
  };
}

function makeReadModelThread(overrides: Partial<OrchestrationReadModel["threads"][number]>) {
  return {
    id: ThreadId.makeUnsafe("thread-1"),
    projectId: ProjectId.makeUnsafe("project-1"),
    title: "Thread",
    model: "gpt-5.3-codex",
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-02-27T00:00:00.000Z",
    updatedAt: "2026-02-27T00:00:00.000Z",
    deletedAt: null,
    messages: [],
    activities: [],
    proposedPlans: [],
    checkpoints: [],
    session: null,
    ...overrides,
  } satisfies OrchestrationReadModel["threads"][number];
}

function makeReadModel(thread: OrchestrationReadModel["threads"][number]): OrchestrationReadModel {
  return {
    snapshotSequence: 1,
    updatedAt: "2026-02-27T00:00:00.000Z",
    projects: [
      {
        id: ProjectId.makeUnsafe("project-1"),
        title: "Project",
        workspaceRoot: "/tmp/project",
        defaultModel: "gpt-5.3-codex",
        createdAt: "2026-02-27T00:00:00.000Z",
        updatedAt: "2026-02-27T00:00:00.000Z",
        deletedAt: null,
        scripts: [],
      },
    ],
    threads: [thread],
  };
}

function makeReadModelProject(
  overrides: Partial<OrchestrationReadModel["projects"][number]>,
): OrchestrationReadModel["projects"][number] {
  return {
    id: ProjectId.makeUnsafe("project-1"),
    title: "Project",
    workspaceRoot: "/tmp/project",
    defaultModel: "gpt-5.3-codex",
    createdAt: "2026-02-27T00:00:00.000Z",
    updatedAt: "2026-02-27T00:00:00.000Z",
    deletedAt: null,
    scripts: [],
    ...overrides,
  };
}

describe("store pure functions", () => {
  it("markThreadUnread moves lastVisitedAt before completion for a completed thread", () => {
    const latestTurnCompletedAt = "2026-02-25T12:30:00.000Z";
    const initialState = makeState(
      makeThread({
        latestTurn: {
          turnId: TurnId.makeUnsafe("turn-1"),
          state: "completed",
          requestedAt: "2026-02-25T12:28:00.000Z",
          startedAt: "2026-02-25T12:28:30.000Z",
          completedAt: latestTurnCompletedAt,
          assistantMessageId: null,
        },
        lastVisitedAt: "2026-02-25T12:35:00.000Z",
      }),
    );

    const next = markThreadUnread(initialState, ThreadId.makeUnsafe("thread-1"));

    const updatedThread = next.threads[0];
    expect(updatedThread).toBeDefined();
    expect(updatedThread?.lastVisitedAt).toBe("2026-02-25T12:29:59.999Z");
    expect(Date.parse(updatedThread?.lastVisitedAt ?? "")).toBeLessThan(
      Date.parse(latestTurnCompletedAt),
    );
  });

  it("markThreadUnread does not change a thread without a completed turn", () => {
    const initialState = makeState(
      makeThread({
        latestTurn: null,
        lastVisitedAt: "2026-02-25T12:35:00.000Z",
      }),
    );

    const next = markThreadUnread(initialState, ThreadId.makeUnsafe("thread-1"));

    expect(next).toEqual(initialState);
  });

  it("reorderProjects moves a project to a target index", () => {
    const project1 = ProjectId.makeUnsafe("project-1");
    const project2 = ProjectId.makeUnsafe("project-2");
    const project3 = ProjectId.makeUnsafe("project-3");
    const state: AppState = {
      projects: [
        {
          id: project1,
          name: "Project 1",
          cwd: "/tmp/project-1",
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
          expanded: true,
          scripts: [],
        },
        {
          id: project2,
          name: "Project 2",
          cwd: "/tmp/project-2",
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
          expanded: true,
          scripts: [],
        },
        {
          id: project3,
          name: "Project 3",
          cwd: "/tmp/project-3",
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
          expanded: true,
          scripts: [],
        },
      ],
      threads: [],
      threadsHydrated: true,
    };

    const next = reorderProjects(state, project1, project3);

    expect(next.projects.map((project) => project.id)).toEqual([project2, project3, project1]);
  });

  it("removes and restores a thread optimistically without losing order", () => {
    const thread1 = makeThread({
      id: ThreadId.makeUnsafe("thread-1"),
      createdAt: "2026-02-13T00:00:00.000Z",
    });
    const thread2 = makeThread({
      id: ThreadId.makeUnsafe("thread-2"),
      createdAt: "2026-02-14T00:00:00.000Z",
    });
    const state: AppState = {
      projects: [makeProject()],
      threads: [thread1, thread2],
      threadsHydrated: true,
    };

    const { nextState, removedThread } = removeThreadOptimistically(state, thread1.id);
    expect(nextState.threads.map((thread) => thread.id)).toEqual([thread2.id]);

    const restored = restoreRemovedThread(nextState, removedThread);
    expect(restored.threads.map((thread) => thread.id)).toEqual([thread1.id, thread2.id]);
  });

  it("does not restore a removed thread after its project is gone", () => {
    const initialState = makeState(makeThread());
    const { nextState, removedThread } = removeThreadOptimistically(
      initialState,
      ThreadId.makeUnsafe("thread-1"),
    );

    const restored = restoreRemovedThread(
      { ...nextState, projects: [], threadsHydrated: true },
      removedThread,
    );

    expect(restored.threads).toEqual([]);
  });

  it("removes and restores a project with all of its threads optimistically", () => {
    const project1 = makeProject({ id: ProjectId.makeUnsafe("project-1") });
    const project2 = makeProject({
      id: ProjectId.makeUnsafe("project-2"),
      name: "Project 2",
      cwd: "/tmp/project-2",
    });
    const thread1 = makeThread({
      id: ThreadId.makeUnsafe("thread-1"),
      projectId: project1.id,
    });
    const thread2 = makeThread({
      id: ThreadId.makeUnsafe("thread-2"),
      projectId: project2.id,
    });
    const state: AppState = {
      projects: [project1, project2],
      threads: [thread1, thread2],
      threadsHydrated: true,
    };

    const { nextState, removedProject } = removeProjectOptimistically(state, project1.id);
    expect(nextState.projects.map((project) => project.id)).toEqual([project2.id]);
    expect(nextState.threads.map((thread) => thread.id)).toEqual([thread2.id]);

    const restored = restoreRemovedProject(nextState, removedProject);
    expect(restored.projects.map((project) => project.id)).toEqual([project1.id, project2.id]);
    expect(restored.threads.map((thread) => thread.id)).toEqual([thread1.id, thread2.id]);
  });

  it("applies common orchestration events incrementally", () => {
    const initialState: AppState = {
      projects: [makeProject()],
      threads: [],
      threadsHydrated: true,
    };
    const threadId = ThreadId.makeUnsafe("thread-1");
    const event = {
      type: "thread.created",
      sequence: 1,
      eventId: EventId.makeUnsafe("event-1"),
      aggregateId: threadId,
      aggregateKind: "thread",
      occurredAt: "2026-03-09T10:00:00.000Z",
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      payload: {
        threadId,
        projectId: ProjectId.makeUnsafe("project-1"),
        title: "Created from event",
        model: "gpt-5-codex",
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: DEFAULT_INTERACTION_MODE,
        branch: null,
        worktreePath: null,
        createdAt: "2026-03-09T10:00:00.000Z",
        updatedAt: "2026-03-09T10:00:00.000Z",
      },
    } satisfies OrchestrationEvent;

    const result = applyIncrementalOrchestrationEvent(initialState, event);

    expect(result.handled).toBe(true);
    expect(result.state.threads[0]).toMatchObject({
      id: threadId,
      title: "Created from event",
      projectId: ProjectId.makeUnsafe("project-1"),
    });
  });
});

describe("store read model sync", () => {
  it("falls back to the codex default for unsupported provider models without an active session", () => {
    const initialState = makeState(makeThread());
    const readModel = makeReadModel(
      makeReadModelThread({
        model: "claude-opus-4-6",
      }),
    );

    const next = syncServerReadModel(initialState, readModel);

    expect(next.threads[0]?.model).toBe(DEFAULT_MODEL_BY_PROVIDER.codex);
  });

  it("preserves the current project order when syncing incoming read model updates", () => {
    const project1 = ProjectId.makeUnsafe("project-1");
    const project2 = ProjectId.makeUnsafe("project-2");
    const project3 = ProjectId.makeUnsafe("project-3");
    const initialState: AppState = {
      projects: [
        {
          id: project2,
          name: "Project 2",
          cwd: "/tmp/project-2",
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
          expanded: true,
          scripts: [],
        },
        {
          id: project1,
          name: "Project 1",
          cwd: "/tmp/project-1",
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
          expanded: true,
          scripts: [],
        },
      ],
      threads: [],
      threadsHydrated: true,
    };
    const readModel: OrchestrationReadModel = {
      snapshotSequence: 2,
      updatedAt: "2026-02-27T00:00:00.000Z",
      projects: [
        makeReadModelProject({
          id: project1,
          title: "Project 1",
          workspaceRoot: "/tmp/project-1",
        }),
        makeReadModelProject({
          id: project2,
          title: "Project 2",
          workspaceRoot: "/tmp/project-2",
        }),
        makeReadModelProject({
          id: project3,
          title: "Project 3",
          workspaceRoot: "/tmp/project-3",
        }),
      ],
      threads: [],
    };

    const next = syncServerReadModel(initialState, readModel);

    expect(next.projects.map((project) => project.id)).toEqual([project2, project1, project3]);
  });
});
