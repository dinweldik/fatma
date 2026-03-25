import {
  DEFAULT_MODEL_BY_PROVIDER,
  type OrchestrationEvent,
  type OrchestrationLatestTurn,
  type OrchestrationSession,
  type ProviderKind,
} from "@fatma/contracts";
import { inferProviderForModel, resolveModelSlugForProvider } from "@fatma/shared/model";

import type { AppState } from "./store";
import type { Project, Thread, ThreadSession } from "./types";

interface ApplyEventResult {
  readonly handled: boolean;
  readonly state: AppState;
}

function toLegacySessionStatus(status: OrchestrationSession["status"]): ThreadSession["status"] {
  switch (status) {
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
  }
}

function toProviderKind(name: string | null): ProviderKind {
  if (name === "codex" || name === "claudeAgent") return name;
  return "codex";
}

function toThreadSession(session: OrchestrationSession): ThreadSession {
  return {
    provider: toProviderKind(session.providerName),
    status: toLegacySessionStatus(session.status),
    activeTurnId: session.activeTurnId ?? undefined,
    createdAt: session.updatedAt,
    updatedAt: session.updatedAt,
    orchestrationStatus: session.status,
    ...(session.lastError ? { lastError: session.lastError } : {}),
  };
}

function updateThread(
  state: AppState,
  threadId: Thread["id"],
  updater: (thread: Thread) => Thread,
): AppState {
  let changed = false;
  const threads = state.threads.map((thread) => {
    if (thread.id !== threadId) {
      return thread;
    }
    const nextThread = updater(thread);
    changed ||= nextThread !== thread;
    return nextThread;
  });
  return changed ? { ...state, threads } : state;
}

function updateProject(
  state: AppState,
  projectId: Project["id"],
  updater: (project: Project) => Project,
): AppState {
  let changed = false;
  const projects = state.projects.map((project) => {
    if (project.id !== projectId) {
      return project;
    }
    const nextProject = updater(project);
    changed ||= nextProject !== project;
    return nextProject;
  });
  return changed ? { ...state, projects } : state;
}

function upsertLatestTurn(
  thread: Thread,
  updater: (latestTurn: OrchestrationLatestTurn | null) => OrchestrationLatestTurn | null,
): Thread {
  const nextLatestTurn = updater(thread.latestTurn);
  return nextLatestTurn === thread.latestTurn ? thread : { ...thread, latestTurn: nextLatestTurn };
}

function resolveThreadModel(model: string): string {
  const provider = inferProviderForModel(model);
  return resolveModelSlugForProvider(provider, model);
}

function resolveProjectModel(model: string | null): string {
  if (!model) {
    return DEFAULT_MODEL_BY_PROVIDER.codex;
  }
  const provider = inferProviderForModel(model);
  return resolveModelSlugForProvider(provider, model);
}

function createProjectFromEvent(
  event: Extract<OrchestrationEvent, { type: "project.created" }>,
): Project {
  return {
    id: event.payload.projectId,
    name: event.payload.title,
    cwd: event.payload.workspaceRoot,
    model: resolveProjectModel(event.payload.defaultModel),
    expanded: true,
    scripts: event.payload.scripts.map((script) => ({ ...script })),
  };
}

function createThreadFromEvent(
  event: Extract<OrchestrationEvent, { type: "thread.created" }>,
): Thread {
  return {
    id: event.payload.threadId,
    codexThreadId: null,
    projectId: event.payload.projectId,
    title: event.payload.title,
    model: resolveThreadModel(event.payload.model),
    runtimeMode: event.payload.runtimeMode,
    interactionMode: event.payload.interactionMode,
    session: null,
    messages: [],
    proposedPlans: [],
    error: null,
    createdAt: event.payload.createdAt,
    latestTurn: null,
    branch: event.payload.branch,
    worktreePath: event.payload.worktreePath,
    turnDiffSummaries: [],
    activities: [],
  };
}

function upsertMessage(thread: Thread, message: Thread["messages"][number]): Thread {
  const existingIndex = thread.messages.findIndex((entry) => entry.id === message.id);
  if (existingIndex < 0) {
    return { ...thread, messages: [...thread.messages, message] };
  }
  const existing = thread.messages[existingIndex];
  if (!existing) {
    return thread;
  }
  const nextMessage = {
    ...existing,
    ...message,
    ...(message.attachments !== undefined
      ? { attachments: message.attachments }
      : existing.attachments !== undefined
        ? { attachments: existing.attachments }
        : {}),
    ...(message.streaming ? {} : { completedAt: message.completedAt ?? existing.completedAt }),
  } satisfies Thread["messages"][number];
  if (nextMessage === existing) {
    return thread;
  }
  const messages = [...thread.messages];
  messages[existingIndex] = nextMessage;
  return { ...thread, messages };
}

function applySessionToLatestTurn(
  current: OrchestrationLatestTurn | null,
  session: OrchestrationSession,
): OrchestrationLatestTurn | null {
  const activeTurnId = session.activeTurnId ?? current?.turnId ?? null;
  if (!activeTurnId) {
    return current;
  }

  if (session.status === "running" || session.status === "starting") {
    return {
      turnId: activeTurnId,
      state: "running",
      requestedAt: current?.requestedAt ?? session.updatedAt,
      startedAt: current?.startedAt ?? session.updatedAt,
      completedAt: null,
      assistantMessageId: current?.assistantMessageId ?? null,
    };
  }

  if (session.status === "interrupted") {
    return {
      turnId: activeTurnId,
      state: "interrupted",
      requestedAt: current?.requestedAt ?? session.updatedAt,
      startedAt: current?.startedAt ?? session.updatedAt,
      completedAt: session.updatedAt,
      assistantMessageId: current?.assistantMessageId ?? null,
    };
  }

  if (session.status === "error") {
    return {
      turnId: activeTurnId,
      state: "error",
      requestedAt: current?.requestedAt ?? session.updatedAt,
      startedAt: current?.startedAt ?? session.updatedAt,
      completedAt: session.updatedAt,
      assistantMessageId: current?.assistantMessageId ?? null,
    };
  }

  if (current?.turnId === activeTurnId) {
    return {
      ...current,
      state: current.completedAt ? current.state : "completed",
      completedAt: current.completedAt ?? session.updatedAt,
    };
  }

  return current;
}

export function applyOrchestrationEventToAppState(
  state: AppState,
  event: OrchestrationEvent,
): ApplyEventResult {
  switch (event.type) {
    case "project.created": {
      const exists = state.projects.some((project) => project.id === event.payload.projectId);
      if (exists) {
        return { handled: true, state };
      }
      return {
        handled: true,
        state: {
          ...state,
          projects: [...state.projects, createProjectFromEvent(event)],
        },
      };
    }

    case "project.meta-updated":
      return {
        handled: true,
        state: updateProject(state, event.payload.projectId, (project) => ({
          ...project,
          ...(event.payload.title ? { name: event.payload.title } : {}),
          ...(event.payload.workspaceRoot ? { cwd: event.payload.workspaceRoot } : {}),
          ...(event.payload.defaultModel !== undefined
            ? { model: resolveProjectModel(event.payload.defaultModel) }
            : {}),
          ...(event.payload.scripts
            ? { scripts: event.payload.scripts.map((script) => ({ ...script })) }
            : {}),
        })),
      };

    case "project.deleted":
      return {
        handled: true,
        state: {
          ...state,
          projects: state.projects.filter((project) => project.id !== event.payload.projectId),
          threads: state.threads.filter((thread) => thread.projectId !== event.payload.projectId),
        },
      };

    case "thread.created": {
      const exists = state.threads.some((thread) => thread.id === event.payload.threadId);
      if (exists) {
        return { handled: true, state };
      }
      return {
        handled: true,
        state: {
          ...state,
          threads: [...state.threads, createThreadFromEvent(event)],
        },
      };
    }

    case "thread.deleted":
      return {
        handled: true,
        state: {
          ...state,
          threads: state.threads.filter((thread) => thread.id !== event.payload.threadId),
        },
      };

    case "thread.meta-updated":
      return {
        handled: true,
        state: updateThread(state, event.payload.threadId, (thread) => ({
          ...thread,
          ...(event.payload.title ? { title: event.payload.title } : {}),
          ...(event.payload.model ? { model: resolveThreadModel(event.payload.model) } : {}),
          ...(event.payload.branch !== undefined ? { branch: event.payload.branch } : {}),
          ...(event.payload.worktreePath !== undefined
            ? { worktreePath: event.payload.worktreePath }
            : {}),
        })),
      };

    case "thread.runtime-mode-set":
      return {
        handled: true,
        state: updateThread(state, event.payload.threadId, (thread) => ({
          ...thread,
          runtimeMode: event.payload.runtimeMode,
        })),
      };

    case "thread.interaction-mode-set":
      return {
        handled: true,
        state: updateThread(state, event.payload.threadId, (thread) => ({
          ...thread,
          interactionMode: event.payload.interactionMode,
        })),
      };

    case "thread.message-sent":
      return {
        handled: true,
        state: updateThread(state, event.payload.threadId, (thread) => {
          const attachments = event.payload.attachments?.map((attachment) => ({ ...attachment }));
          let nextThread = upsertMessage(thread, {
            id: event.payload.messageId,
            role: event.payload.role,
            text: event.payload.text,
            createdAt: event.payload.createdAt,
            streaming: event.payload.streaming,
            ...(attachments !== undefined ? { attachments } : {}),
            ...(event.payload.streaming ? {} : { completedAt: event.payload.updatedAt }),
          } satisfies Thread["messages"][number]);

          if (event.payload.role === "assistant") {
            nextThread = upsertLatestTurn(nextThread, (latestTurn) => {
              if (
                event.payload.turnId === null ||
                (latestTurn !== null && latestTurn.turnId !== event.payload.turnId)
              ) {
                return latestTurn;
              }

              return {
                ...(latestTurn ?? {
                  turnId: event.payload.turnId,
                  requestedAt: event.payload.createdAt,
                  startedAt: event.payload.createdAt,
                  completedAt: null,
                  state: "running" as const,
                  assistantMessageId: null,
                }),
                assistantMessageId: event.payload.messageId,
                ...(event.payload.streaming
                  ? { state: "running" as const, completedAt: null }
                  : { state: "completed" as const, completedAt: event.payload.updatedAt }),
              };
            });
          }

          return nextThread;
        }),
      };

    case "thread.turn-start-requested":
      return {
        handled: true,
        state: updateThread(state, event.payload.threadId, (thread) => ({
          ...thread,
          model: event.payload.model ? resolveThreadModel(event.payload.model) : thread.model,
          runtimeMode: event.payload.runtimeMode,
          interactionMode: event.payload.interactionMode,
        })),
      };

    case "thread.turn-interrupt-requested":
      return {
        handled: true,
        state: updateThread(state, event.payload.threadId, (thread) =>
          upsertLatestTurn(thread, (latestTurn) => {
            if (latestTurn === null) {
              return null;
            }
            if (event.payload.turnId && latestTurn.turnId !== event.payload.turnId) {
              return latestTurn;
            }
            return {
              ...latestTurn,
              state: "interrupted",
              completedAt: latestTurn.completedAt ?? event.payload.createdAt,
            };
          }),
        ),
      };

    case "thread.session-stop-requested":
      return {
        handled: true,
        state: updateThread(state, event.payload.threadId, (thread) =>
          thread.session
            ? {
                ...thread,
                session: {
                  ...thread.session,
                  status: "closed",
                  orchestrationStatus: "stopped",
                  updatedAt: event.payload.createdAt,
                },
              }
            : thread,
        ),
      };

    case "thread.session-set":
      return {
        handled: true,
        state: updateThread(state, event.payload.threadId, (thread) => {
          const session = toThreadSession(event.payload.session);
          return {
            ...thread,
            session,
            error: event.payload.session.lastError ?? thread.error,
            latestTurn: applySessionToLatestTurn(thread.latestTurn, event.payload.session),
          };
        }),
      };

    case "thread.proposed-plan-upserted":
      return {
        handled: true,
        state: updateThread(state, event.payload.threadId, (thread) => {
          const existingIndex = thread.proposedPlans.findIndex(
            (proposedPlan) => proposedPlan.id === event.payload.proposedPlan.id,
          );
          const nextPlan = { ...event.payload.proposedPlan };
          if (existingIndex < 0) {
            return { ...thread, proposedPlans: [...thread.proposedPlans, nextPlan] };
          }
          const proposedPlans = [...thread.proposedPlans];
          proposedPlans[existingIndex] = nextPlan;
          return { ...thread, proposedPlans };
        }),
      };

    case "thread.turn-diff-completed":
      return {
        handled: true,
        state: updateThread(state, event.payload.threadId, (thread) => ({
          ...thread,
          turnDiffSummaries: [
            ...thread.turnDiffSummaries.filter(
              (summary) => summary.turnId !== event.payload.turnId,
            ),
            {
              turnId: event.payload.turnId,
              completedAt: event.payload.completedAt,
              status: event.payload.status,
              assistantMessageId: event.payload.assistantMessageId ?? undefined,
              checkpointTurnCount: event.payload.checkpointTurnCount,
              checkpointRef: event.payload.checkpointRef,
              files: event.payload.files.map((file) => ({ ...file })),
            },
          ].toSorted((left, right) => left.completedAt.localeCompare(right.completedAt)),
          latestTurn: {
            turnId: event.payload.turnId,
            state: "completed",
            requestedAt: thread.latestTurn?.requestedAt ?? event.payload.completedAt,
            startedAt: thread.latestTurn?.startedAt ?? event.payload.completedAt,
            completedAt: event.payload.completedAt,
            assistantMessageId: event.payload.assistantMessageId,
          },
        })),
      };

    case "thread.activity-appended":
      return {
        handled: true,
        state: updateThread(state, event.payload.threadId, (thread) => ({
          ...thread,
          activities: [...thread.activities, { ...event.payload.activity }],
        })),
      };

    case "thread.approval-response-requested":
    case "thread.user-input-response-requested":
      return { handled: true, state };

    case "thread.checkpoint-revert-requested":
    case "thread.reverted":
      return { handled: false, state };
  }
}
