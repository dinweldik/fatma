import type {
  OrchestrationEvent,
  OrchestrationLatestTurn,
  OrchestrationThreadActivity,
  OrchestrationThread,
  ThreadId,
} from "@fatma/contracts";
import { resolveModelSlug } from "@fatma/shared/model";

import type { AppState } from "./store";
import type { ChatMessage, Thread, ThreadSession, TurnDiffSummary } from "./types";

const MAX_THREAD_MESSAGES = 2_000;
const MAX_THREAD_CHECKPOINTS = 500;
const MAX_THREAD_ACTIVITIES = 500;
const MAX_THREAD_PROPOSED_PLANS = 200;

function updateThread(
  threads: ReadonlyArray<Thread>,
  threadId: ThreadId,
  updater: (thread: Thread) => Thread,
): Thread[] {
  let changed = false;
  const nextThreads = threads.map((thread) => {
    if (thread.id !== threadId) {
      return thread;
    }
    const nextThread = updater(thread);
    if (nextThread !== thread) {
      changed = true;
    }
    return nextThread;
  });
  return changed ? nextThreads : [...threads];
}

function legacySessionStatus(session: OrchestrationThread["session"]): ThreadSession["status"] {
  switch (session?.status) {
    case "starting":
      return "connecting";
    case "running":
      return "running";
    case "error":
      return "error";
    case "ready":
    case "interrupted":
      return "ready";
    case "idle":
    case "stopped":
      return "closed";
    default:
      return "closed";
  }
}

function compareActivities(
  left: OrchestrationThreadActivity,
  right: OrchestrationThreadActivity,
): number {
  if (left.sequence !== undefined && right.sequence !== undefined) {
    if (left.sequence !== right.sequence) {
      return left.sequence - right.sequence;
    }
  } else if (left.sequence !== undefined) {
    return 1;
  } else if (right.sequence !== undefined) {
    return -1;
  }
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function checkpointStatusToLatestTurnState(
  status: TurnDiffSummary["status"],
): OrchestrationLatestTurn["state"] {
  if (status === "error") return "error";
  if (status === "missing") return "interrupted";
  return "completed";
}

function threadSessionFromEvent(
  thread: Thread,
  session: OrchestrationThread["session"],
): ThreadSession | null {
  if (!session) {
    return null;
  }
  return {
    provider: "codex",
    status: legacySessionStatus(session),
    orchestrationStatus: session.status,
    activeTurnId: session.activeTurnId ?? undefined,
    createdAt: thread.session?.createdAt ?? session.updatedAt,
    updatedAt: session.updatedAt,
    ...(session.lastError ? { lastError: session.lastError } : {}),
  };
}

function appendOrUpdateMessage(
  thread: Thread,
  event: Extract<OrchestrationEvent, { type: "thread.message-sent" }>,
): Thread {
  const existingMessage = thread.messages.find((message) => message.id === event.payload.messageId);
  const nextMessage: ChatMessage = {
    id: event.payload.messageId,
    role: event.payload.role,
    text: event.payload.text,
    createdAt: event.payload.createdAt,
    streaming: event.payload.streaming,
    ...(event.payload.streaming ? {} : { completedAt: event.payload.updatedAt }),
    ...(event.payload.attachments
      ? {
          attachments: event.payload.attachments.map((attachment) => ({
            type: "image",
            id: attachment.id,
            name: attachment.name,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            previewUrl: `/attachments/${encodeURIComponent(attachment.id)}`,
          })),
        }
      : {}),
  };
  const messages = existingMessage
    ? thread.messages.map((message) =>
        message.id === nextMessage.id
          ? {
              ...message,
              text: nextMessage.streaming
                ? `${message.text}${nextMessage.text}`
                : nextMessage.text || message.text,
              streaming: nextMessage.streaming,
              ...(nextMessage.completedAt ? { completedAt: nextMessage.completedAt } : {}),
              ...(nextMessage.attachments ? { attachments: nextMessage.attachments } : {}),
            }
          : message,
      )
    : [...thread.messages, nextMessage];
  return {
    ...thread,
    messages: messages.slice(-MAX_THREAD_MESSAGES),
  };
}

function applySupportedEvent(state: AppState, event: OrchestrationEvent): AppState {
  switch (event.type) {
    case "project.created":
      return {
        ...state,
        projects: [
          ...state.projects.filter((project) => project.id !== event.payload.projectId),
          {
            id: event.payload.projectId,
            name: event.payload.title,
            cwd: event.payload.workspaceRoot,
            model: resolveModelSlug(event.payload.defaultModel),
            expanded: true,
            scripts: event.payload.scripts.map((script) => ({ ...script })),
          },
        ],
      };
    case "project.meta-updated":
      return {
        ...state,
        projects: state.projects.map((project) =>
          project.id === event.payload.projectId
            ? {
                ...project,
                ...(event.payload.title !== undefined ? { name: event.payload.title } : {}),
                ...(event.payload.workspaceRoot !== undefined
                  ? { cwd: event.payload.workspaceRoot }
                  : {}),
                ...(event.payload.defaultModel !== undefined
                  ? { model: resolveModelSlug(event.payload.defaultModel) }
                  : {}),
                ...(event.payload.scripts !== undefined
                  ? { scripts: event.payload.scripts.map((script) => ({ ...script })) }
                  : {}),
              }
            : project,
        ),
      };
    case "project.deleted":
      return {
        ...state,
        projects: state.projects.filter((project) => project.id !== event.payload.projectId),
        threads: state.threads.filter((thread) => thread.projectId !== event.payload.projectId),
      };
    case "thread.created":
      return {
        ...state,
        threads: [
          ...state.threads.filter((thread) => thread.id !== event.payload.threadId),
          {
            id: event.payload.threadId,
            codexThreadId: null,
            projectId: event.payload.projectId,
            title: event.payload.title,
            model: resolveModelSlug(event.payload.model),
            runtimeMode: event.payload.runtimeMode,
            interactionMode: event.payload.interactionMode,
            session: null,
            messages: [],
            proposedPlans: [],
            error: null,
            createdAt: event.payload.createdAt,
            latestTurn: null,
            lastVisitedAt: event.payload.updatedAt,
            branch: event.payload.branch,
            worktreePath: event.payload.worktreePath,
            turnDiffSummaries: [],
            activities: [],
          },
        ],
      };
    case "thread.deleted":
      return {
        ...state,
        threads: state.threads.filter((thread) => thread.id !== event.payload.threadId),
      };
    case "thread.meta-updated":
      return {
        ...state,
        threads: updateThread(state.threads, event.payload.threadId, (thread) => ({
          ...thread,
          ...(event.payload.title !== undefined ? { title: event.payload.title } : {}),
          ...(event.payload.model !== undefined
            ? { model: resolveModelSlug(event.payload.model) }
            : {}),
          ...(event.payload.branch !== undefined ? { branch: event.payload.branch } : {}),
          ...(event.payload.worktreePath !== undefined
            ? {
                worktreePath: event.payload.worktreePath,
                ...(thread.worktreePath !== event.payload.worktreePath ? { session: null } : {}),
              }
            : {}),
        })),
      };
    case "thread.runtime-mode-set":
      return {
        ...state,
        threads: updateThread(state.threads, event.payload.threadId, (thread) => ({
          ...thread,
          runtimeMode: event.payload.runtimeMode,
        })),
      };
    case "thread.interaction-mode-set":
      return {
        ...state,
        threads: updateThread(state.threads, event.payload.threadId, (thread) => ({
          ...thread,
          interactionMode: event.payload.interactionMode,
        })),
      };
    case "thread.message-sent":
      return {
        ...state,
        threads: updateThread(state.threads, event.payload.threadId, (thread) =>
          appendOrUpdateMessage(thread, event),
        ),
      };
    case "thread.turn-start-requested":
      return {
        ...state,
        threads: updateThread(state.threads, event.payload.threadId, (thread) => ({
          ...thread,
          runtimeMode: event.payload.runtimeMode,
          interactionMode: event.payload.interactionMode,
          session:
            thread.session?.status === "running"
              ? thread.session
              : {
                  provider: "codex",
                  status: "connecting",
                  orchestrationStatus: "starting",
                  activeTurnId: thread.session?.activeTurnId,
                  createdAt: thread.session?.createdAt ?? event.payload.createdAt,
                  updatedAt: event.payload.createdAt,
                },
        })),
      };
    case "thread.session-stop-requested":
      return {
        ...state,
        threads: updateThread(state.threads, event.payload.threadId, (thread) => ({
          ...thread,
          session: thread.session
            ? {
                ...thread.session,
                status: "closed",
                orchestrationStatus: "stopped",
                activeTurnId: undefined,
                updatedAt: event.payload.createdAt,
              }
            : null,
        })),
      };
    case "thread.session-set":
      return {
        ...state,
        threads: updateThread(state.threads, event.payload.threadId, (thread) => ({
          ...thread,
          session: threadSessionFromEvent(thread, event.payload.session),
          latestTurn:
            event.payload.session.status === "running" &&
            event.payload.session.activeTurnId !== null
              ? {
                  turnId: event.payload.session.activeTurnId,
                  state: "running",
                  requestedAt:
                    thread.latestTurn?.turnId === event.payload.session.activeTurnId
                      ? thread.latestTurn.requestedAt
                      : event.payload.session.updatedAt,
                  startedAt:
                    thread.latestTurn?.turnId === event.payload.session.activeTurnId
                      ? (thread.latestTurn.startedAt ?? event.payload.session.updatedAt)
                      : event.payload.session.updatedAt,
                  completedAt: null,
                  assistantMessageId:
                    thread.latestTurn?.turnId === event.payload.session.activeTurnId
                      ? thread.latestTurn.assistantMessageId
                      : null,
                }
              : thread.latestTurn,
          error: event.payload.session.lastError ?? null,
        })),
      };
    case "thread.proposed-plan-upserted":
      return {
        ...state,
        threads: updateThread(state.threads, event.payload.threadId, (thread) => ({
          ...thread,
          proposedPlans: [
            ...thread.proposedPlans.filter((plan) => plan.id !== event.payload.proposedPlan.id),
            {
              id: event.payload.proposedPlan.id,
              turnId: event.payload.proposedPlan.turnId,
              planMarkdown: event.payload.proposedPlan.planMarkdown,
              implementedAt: event.payload.proposedPlan.implementedAt ?? null,
              implementationThreadId: event.payload.proposedPlan.implementationThreadId ?? null,
              createdAt: event.payload.proposedPlan.createdAt,
              updatedAt: event.payload.proposedPlan.updatedAt,
            },
          ]
            .toSorted(
              (left, right) =>
                left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
            )
            .slice(-MAX_THREAD_PROPOSED_PLANS),
        })),
      };
    case "thread.turn-diff-completed":
      return {
        ...state,
        threads: updateThread(state.threads, event.payload.threadId, (thread) => {
          const existing = thread.turnDiffSummaries.find(
            (entry) => entry.turnId === event.payload.turnId,
          );
          if (existing && existing.status !== "missing" && event.payload.status === "missing") {
            return thread;
          }
          const nextSummary: TurnDiffSummary = {
            turnId: event.payload.turnId,
            completedAt: event.payload.completedAt,
            status: event.payload.status,
            assistantMessageId: event.payload.assistantMessageId ?? undefined,
            checkpointTurnCount: event.payload.checkpointTurnCount,
            checkpointRef: event.payload.checkpointRef,
            files: event.payload.files.map((file) => ({ ...file })),
          };
          return {
            ...thread,
            turnDiffSummaries: [
              ...thread.turnDiffSummaries.filter((entry) => entry.turnId !== nextSummary.turnId),
              nextSummary,
            ]
              .toSorted(
                (left, right) => (left.checkpointTurnCount ?? 0) - (right.checkpointTurnCount ?? 0),
              )
              .slice(-MAX_THREAD_CHECKPOINTS),
            latestTurn: {
              turnId: event.payload.turnId,
              state: checkpointStatusToLatestTurnState(event.payload.status),
              requestedAt:
                thread.latestTurn?.turnId === event.payload.turnId
                  ? thread.latestTurn.requestedAt
                  : event.payload.completedAt,
              startedAt:
                thread.latestTurn?.turnId === event.payload.turnId
                  ? (thread.latestTurn.startedAt ?? event.payload.completedAt)
                  : event.payload.completedAt,
              completedAt: event.payload.completedAt,
              assistantMessageId: event.payload.assistantMessageId ?? null,
            },
            session:
              thread.session && thread.session.activeTurnId === event.payload.turnId
                ? {
                    ...thread.session,
                    status: "ready",
                    orchestrationStatus: event.payload.status === "error" ? "error" : "ready",
                    activeTurnId: undefined,
                    updatedAt: event.payload.completedAt,
                  }
                : thread.session,
          };
        }),
      };
    case "thread.activity-appended":
      return {
        ...state,
        threads: updateThread(state.threads, event.payload.threadId, (thread) => ({
          ...thread,
          activities: [
            ...thread.activities.filter((activity) => activity.id !== event.payload.activity.id),
            { ...event.payload.activity },
          ]
            .toSorted(compareActivities)
            .slice(-MAX_THREAD_ACTIVITIES),
        })),
      };
    default:
      return state;
  }
}

const SUPPORTED_INCREMENTAL_EVENT_TYPES = new Set<OrchestrationEvent["type"]>([
  "project.created",
  "project.meta-updated",
  "project.deleted",
  "thread.created",
  "thread.deleted",
  "thread.meta-updated",
  "thread.runtime-mode-set",
  "thread.interaction-mode-set",
  "thread.message-sent",
  "thread.turn-start-requested",
  "thread.session-stop-requested",
  "thread.session-set",
  "thread.proposed-plan-upserted",
  "thread.turn-diff-completed",
  "thread.activity-appended",
]);

export function canApplyOrchestrationEventIncrementally(event: OrchestrationEvent): boolean {
  return SUPPORTED_INCREMENTAL_EVENT_TYPES.has(event.type);
}

export function applyOrchestrationEventToAppState(
  state: AppState,
  event: OrchestrationEvent,
): AppState {
  if (!canApplyOrchestrationEventIncrementally(event)) {
    return state;
  }
  return applySupportedEvent(state, event);
}
