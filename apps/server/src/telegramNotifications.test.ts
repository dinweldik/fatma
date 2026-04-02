import type {
  OrchestrationEvent,
  OrchestrationThread,
  OrchestrationThreadActivity,
} from "@fatma/contracts";
import { CheckpointRef, EventId, MessageId, ProjectId, ThreadId, TurnId } from "@fatma/contracts";
import { describe, expect, it } from "vitest";

import {
  buildTelegramNotificationText,
  isTelegramNotifiableOrchestrationEvent,
} from "./telegramNotifications.ts";

const asEventId = (value: string): EventId => EventId.makeUnsafe(value);
const asMessageId = (value: string): MessageId => MessageId.makeUnsafe(value);
const asProjectId = (value: string): ProjectId => ProjectId.makeUnsafe(value);
const asThreadId = (value: string): ThreadId => ThreadId.makeUnsafe(value);
const asTurnId = (value: string): TurnId => TurnId.makeUnsafe(value);

function makeActivity(
  overrides: Partial<OrchestrationThreadActivity> &
    Pick<OrchestrationThreadActivity, "kind" | "summary" | "createdAt">,
): OrchestrationThreadActivity {
  return {
    id: asEventId(`activity:${overrides.kind}:${overrides.createdAt}`),
    tone: "info",
    payload: {},
    turnId: asTurnId("turn-1"),
    ...overrides,
  };
}

function makeThread(overrides?: Partial<OrchestrationThread>): OrchestrationThread {
  return {
    id: asThreadId("thread-1"),
    projectId: asProjectId("project-1"),
    title: "Fix login race",
    modelSelection: {
      provider: "codex",
      model: "gpt-5-codex",
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: {
      turnId: asTurnId("turn-1"),
      state: "completed",
      requestedAt: "2026-03-08T12:00:00.000Z",
      startedAt: "2026-03-08T12:00:00.000Z",
      completedAt: "2026-03-08T12:01:05.000Z",
      assistantMessageId: asMessageId("assistant-1"),
    },
    createdAt: "2026-03-08T11:59:00.000Z",
    updatedAt: "2026-03-08T12:01:05.000Z",
    archivedAt: null,
    deletedAt: null,
    messages: [],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    session: null,
    ...overrides,
  };
}

function makeThreadActivityEvent(activity: OrchestrationThreadActivity): OrchestrationEvent {
  return {
    eventId: asEventId(`event:${activity.id}`),
    sequence: 1,
    aggregateKind: "thread",
    aggregateId: asThreadId("thread-1"),
    occurredAt: activity.createdAt,
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type: "thread.activity-appended",
    payload: {
      threadId: asThreadId("thread-1"),
      activity,
    },
  };
}

describe("telegramNotifications", () => {
  it("formats final task completion notifications with elapsed work time", () => {
    const started = makeActivity({
      kind: "task.started",
      summary: "Task started",
      createdAt: "2026-03-08T12:00:00.000Z",
      payload: {
        taskId: "task-1",
      },
    });
    const completed = makeActivity({
      kind: "task.completed",
      summary: "Task completed",
      createdAt: "2026-03-08T12:01:05.000Z",
      payload: {
        taskId: "task-1",
        status: "completed",
      },
    });

    const event = makeThreadActivityEvent(completed);
    const thread = makeThread({
      activities: [started, completed],
    });

    expect(isTelegramNotifiableOrchestrationEvent(event)).toBe(true);
    expect(buildTelegramNotificationText(event, thread)).toBe(
      "✅ fatma: Codex finished working\nFix login race is ready.\nTime worked: 1m 5s",
    );
  });

  it("formats waiting-for-user-input notifications with an explicit waiting indicator", () => {
    const requested = makeActivity({
      kind: "user-input.requested",
      summary: "User input requested",
      createdAt: "2026-03-08T12:01:05.000Z",
      payload: {
        questions: [
          {
            id: "environment",
            question: "Which environment should I use?",
            options: [],
          },
        ],
      },
    });

    const event = makeThreadActivityEvent(requested);

    expect(isTelegramNotifiableOrchestrationEvent(event)).toBe(true);
    expect(buildTelegramNotificationText(event, makeThread())).toBe(
      "⏳ fatma: Waiting for user input\nFix login race needs your input.\nWhich environment should I use?",
    );
  });

  it("does not treat intermediate turn diff updates as telegram notifications", () => {
    const event = {
      eventId: asEventId("event:thread.turn-diff-completed"),
      sequence: 2,
      aggregateKind: "thread",
      aggregateId: asThreadId("thread-1"),
      occurredAt: "2026-03-08T12:00:30.000Z",
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      type: "thread.turn-diff-completed",
      payload: {
        threadId: asThreadId("thread-1"),
        turnId: asTurnId("turn-1"),
        checkpointTurnCount: 1,
        checkpointRef: CheckpointRef.makeUnsafe("provider-diff:evt-1"),
        status: "missing",
        files: [],
        assistantMessageId: asMessageId("assistant-1"),
        completedAt: "2026-03-08T12:00:30.000Z",
      },
    } as OrchestrationEvent;

    expect(isTelegramNotifiableOrchestrationEvent(event)).toBe(false);
    expect(buildTelegramNotificationText(event, makeThread())).toBeNull();
  });
});
