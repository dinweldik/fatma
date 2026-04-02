import { ProjectId, ThreadId, TurnId, type OrchestrationEvent } from "@fatma/contracts";
import { describe, expect, it } from "vitest";

import { applyOrchestrationEventToAppState } from "./orchestrationEventReducer";
import type { AppState } from "./store";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE } from "./types";

const PROJECT_ID = ProjectId.makeUnsafe("project-1");
const THREAD_ID = ThreadId.makeUnsafe("thread-1");
const TURN_ID = TurnId.makeUnsafe("turn-1");

function makeState(): AppState {
  return {
    projects: [
      {
        id: PROJECT_ID,
        name: "Project",
        cwd: "/repo",
        defaultModelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        scripts: [],
      },
    ],
    threads: [
      {
        id: THREAD_ID,
        codexThreadId: null,
        projectId: PROJECT_ID,
        title: "Thread",
        modelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: DEFAULT_INTERACTION_MODE,
        session: null,
        messages: [],
        proposedPlans: [],
        error: null,
        createdAt: "2026-03-19T10:00:00.000Z",
        archivedAt: null,
        latestTurn: null,
        branch: null,
        worktreePath: null,
        turnDiffSummaries: [],
        activities: [],
      },
    ],
    sidebarThreadsById: {},
    threadIdsByProjectId: {
      [PROJECT_ID]: [THREAD_ID],
    },
    bootstrapComplete: true,
    threadsHydrated: true,
  };
}

describe("applyOrchestrationEventToAppState", () => {
  it("updates thread sessions incrementally", () => {
    const result = applyOrchestrationEventToAppState(makeState(), {
      type: "thread.session-set",
      sequence: 1,
      eventId: "event-1" as never,
      aggregateKind: "thread",
      aggregateId: THREAD_ID,
      occurredAt: "2026-03-19T10:01:00.000Z",
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      payload: {
        threadId: THREAD_ID,
        session: {
          threadId: THREAD_ID,
          status: "running",
          providerName: "codex",
          runtimeMode: DEFAULT_RUNTIME_MODE,
          activeTurnId: TURN_ID,
          lastError: null,
          updatedAt: "2026-03-19T10:01:00.000Z",
        },
      },
    } satisfies OrchestrationEvent);

    expect(result.handled).toBe(true);
    expect(result.state.threads[0]?.session).toMatchObject({
      status: "running",
      orchestrationStatus: "running",
      activeTurnId: TURN_ID,
    });
    expect(result.state.threads[0]?.latestTurn).toMatchObject({
      turnId: TURN_ID,
      state: "running",
    });
  });

  it("updates assistant messages without requiring a full snapshot", () => {
    const result = applyOrchestrationEventToAppState(makeState(), {
      type: "thread.message-sent",
      sequence: 2,
      eventId: "event-2" as never,
      aggregateKind: "thread",
      aggregateId: THREAD_ID,
      occurredAt: "2026-03-19T10:02:00.000Z",
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      payload: {
        threadId: THREAD_ID,
        messageId: "message-1" as never,
        role: "assistant",
        text: "hello",
        attachments: [],
        turnId: TURN_ID,
        streaming: false,
        createdAt: "2026-03-19T10:02:00.000Z",
        updatedAt: "2026-03-19T10:02:05.000Z",
      },
    } satisfies OrchestrationEvent);

    expect(result.handled).toBe(true);
    expect(result.state.threads[0]?.messages).toHaveLength(1);
    expect(result.state.threads[0]?.messages[0]).toMatchObject({
      text: "hello",
      completedAt: "2026-03-19T10:02:05.000Z",
    });
    expect(result.state.threads[0]?.latestTurn).toMatchObject({
      turnId: TURN_ID,
      assistantMessageId: "message-1",
      state: "completed",
    });
  });

  it("removes deleted threads incrementally", () => {
    const result = applyOrchestrationEventToAppState(makeState(), {
      type: "thread.deleted",
      sequence: 3,
      eventId: "event-3" as never,
      aggregateKind: "thread",
      aggregateId: THREAD_ID,
      occurredAt: "2026-03-19T10:03:00.000Z",
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      payload: {
        threadId: THREAD_ID,
        deletedAt: "2026-03-19T10:03:00.000Z",
      },
    } satisfies OrchestrationEvent);

    expect(result.handled).toBe(true);
    expect(result.state.threads).toHaveLength(0);
  });

  it("falls back to a snapshot for revert events", () => {
    const result = applyOrchestrationEventToAppState(makeState(), {
      type: "thread.reverted",
      sequence: 4,
      eventId: "event-4" as never,
      aggregateKind: "thread",
      aggregateId: THREAD_ID,
      occurredAt: "2026-03-19T10:04:00.000Z",
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      payload: {
        threadId: THREAD_ID,
        turnCount: 1,
      },
    } satisfies OrchestrationEvent);

    expect(result.handled).toBe(false);
    expect(result.state).toEqual(makeState());
  });
});
