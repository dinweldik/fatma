import type {
  OrchestrationEvent,
  OrchestrationThread,
  ServerSendTestTelegramNotificationInput,
  ServerSendTestTelegramNotificationResult,
  ServerTelegramNotificationSettings,
  ServerUpdateTelegramNotificationsInput,
  ServerUpdateTelegramNotificationsResult,
} from "@t3tools/contracts";
import { Effect, FileSystem, Layer, Path, Ref, Schema, ServiceMap } from "effect";

import { ServerConfig } from "./config";

const TELEGRAM_NOTIFICATIONS_FILE = "telegram-notifications.json";
const APP_NOTIFICATION_NAME = "6d";
const MAX_BOT_TOKEN_LENGTH = 4096;
const MAX_CHAT_ID_LENGTH = 256;

const PersistedTelegramNotificationsSchema = Schema.Struct({
  botToken: Schema.String.check(Schema.isMaxLength(MAX_BOT_TOKEN_LENGTH)),
  chatId: Schema.String.check(Schema.isMaxLength(MAX_CHAT_ID_LENGTH)),
});
type PersistedTelegramNotifications = typeof PersistedTelegramNotificationsSchema.Type;

const EMPTY_PERSISTED_TELEGRAM_NOTIFICATIONS: PersistedTelegramNotifications = {
  botToken: "",
  chatId: "",
};

type TelegramNotifiableOrchestrationEvent = Extract<
  OrchestrationEvent,
  { type: "thread.activity-appended" }
>;

export class TelegramNotificationsError extends Schema.TaggedErrorClass<TelegramNotificationsError>()(
  "TelegramNotificationsError",
  {
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export interface TelegramNotificationsShape {
  readonly getSettingsSummary: Effect.Effect<ServerTelegramNotificationSettings>;
  readonly updateSettings: (
    input: ServerUpdateTelegramNotificationsInput,
  ) => Effect.Effect<ServerUpdateTelegramNotificationsResult, TelegramNotificationsError>;
  readonly sendTestNotification: (
    input: ServerSendTestTelegramNotificationInput,
  ) => Effect.Effect<ServerSendTestTelegramNotificationResult, TelegramNotificationsError>;
  readonly sendOrchestrationNotification: (
    event: OrchestrationEvent,
    thread?: OrchestrationThread | null,
  ) => Effect.Effect<void, never>;
}

export class TelegramNotifications extends ServiceMap.Service<
  TelegramNotifications,
  TelegramNotificationsShape
>()("@dinweldik/6d/telegramNotifications") {}

function trimStoredValue(value: string): string {
  return value.trim();
}

function maskBotToken(botToken: string): string | null {
  const trimmed = trimStoredValue(botToken);
  if (trimmed.length === 0) {
    return null;
  }

  const suffix = trimmed.slice(-4);
  return suffix.length > 0 ? `...${suffix}` : "saved";
}

function summarizeSettings(
  config: PersistedTelegramNotifications,
): ServerTelegramNotificationSettings {
  const botToken = trimStoredValue(config.botToken);
  const chatId = trimStoredValue(config.chatId);
  return {
    chatId,
    hasBotToken: botToken.length > 0,
    botTokenHint: maskBotToken(botToken),
    enabled: botToken.length > 0 && chatId.length > 0,
  };
}

function resolveDraftSettings(
  current: PersistedTelegramNotifications,
  input: ServerUpdateTelegramNotificationsInput | ServerSendTestTelegramNotificationInput,
): PersistedTelegramNotifications {
  const nextChatId = trimStoredValue(input.chatId);
  const nextBotTokenInput = trimStoredValue(input.botToken ?? "");

  return {
    chatId: nextChatId,
    botToken: input.clearBotToken
      ? ""
      : nextBotTokenInput.length > 0
        ? nextBotTokenInput
        : current.botToken,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function formatDuration(startedAt: string | null, endedAt: string): string | null {
  if (startedAt === null) {
    return null;
  }

  const startedAtMs = Date.parse(startedAt);
  const endedAtMs = Date.parse(endedAt);
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(endedAtMs) || endedAtMs < startedAtMs) {
    return null;
  }

  const totalSeconds = Math.max(0, Math.round((endedAtMs - startedAtMs) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  if (minutes > 0) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }

  return `${seconds}s`;
}

function resolveThreadTitle(thread?: OrchestrationThread | null): string {
  return thread?.title.trim() || "Current thread";
}

function taskIdFromActivity(activity: OrchestrationThread["activities"][number]): string | null {
  const payload = asRecord(activity.payload);
  return asNonEmptyString(payload?.taskId);
}

function taskStatusFromActivity(
  activity: OrchestrationThread["activities"][number],
): "completed" | "failed" | "stopped" | null {
  const payload = asRecord(activity.payload);
  const status = asNonEmptyString(payload?.status);
  return status === "completed" || status === "failed" || status === "stopped" ? status : null;
}

function resolveTaskStartedAt(
  activity: OrchestrationThread["activities"][number],
  thread?: OrchestrationThread | null,
): string | null {
  const taskId = taskIdFromActivity(activity);
  if (taskId && thread) {
    for (let index = thread.activities.length - 1; index >= 0; index -= 1) {
      const candidate = thread.activities[index];
      if (candidate?.kind !== "task.started") {
        continue;
      }
      if (taskIdFromActivity(candidate) === taskId) {
        return candidate.createdAt;
      }
    }
  }

  return thread?.latestTurn?.startedAt ?? thread?.latestTurn?.requestedAt ?? null;
}

function summarizeQuestions(activity: OrchestrationThread["activities"][number]): string | null {
  const payload = asRecord(activity.payload);
  const questions = payload?.questions;
  if (!Array.isArray(questions)) {
    return null;
  }

  const firstQuestion = questions.find(
    (question) => asNonEmptyString(asRecord(question)?.question) !== null,
  );
  return firstQuestion ? asNonEmptyString(asRecord(firstQuestion)?.question) : null;
}

function compactLines(lines: ReadonlyArray<string | null>): string {
  return lines.filter((line): line is string => line !== null && line.length > 0).join("\n");
}

export function isTelegramNotifiableOrchestrationEvent(
  event: OrchestrationEvent,
): event is TelegramNotifiableOrchestrationEvent {
  if (event.type !== "thread.activity-appended") {
    return false;
  }

  return (
    event.payload.activity.kind === "task.completed" ||
    event.payload.activity.kind === "user-input.requested" ||
    event.payload.activity.kind === "approval.requested"
  );
}

export function buildTelegramNotificationText(
  event: OrchestrationEvent,
  thread?: OrchestrationThread | null,
): string | null {
  if (!isTelegramNotifiableOrchestrationEvent(event)) {
    return null;
  }

  const resolvedThreadTitle = resolveThreadTitle(thread);
  const { activity } = event.payload;
  const duration = formatDuration(resolveTaskStartedAt(activity, thread), activity.createdAt);

  if (activity.kind === "task.completed") {
    const status = taskStatusFromActivity(activity);
    if (status === "failed") {
      return compactLines([
        `❌ ${APP_NOTIFICATION_NAME}: Codex finished with errors`,
        `${resolvedThreadTitle} needs review.`,
        duration ? `Time worked: ${duration}` : null,
      ]);
    }

    if (status === "stopped") {
      return compactLines([
        `⏹️ ${APP_NOTIFICATION_NAME}: Codex stopped`,
        `${resolvedThreadTitle} stopped.`,
        duration ? `Time worked: ${duration}` : null,
      ]);
    }

    return compactLines([
      `✅ ${APP_NOTIFICATION_NAME}: Codex finished working`,
      `${resolvedThreadTitle} is ready.`,
      duration ? `Time worked: ${duration}` : null,
    ]);
  }

  if (activity.kind === "user-input.requested") {
    return compactLines([
      `⏳ ${APP_NOTIFICATION_NAME}: Waiting for user input`,
      `${resolvedThreadTitle} needs your input.`,
      summarizeQuestions(activity),
    ]);
  }

  if (activity.kind === "approval.requested") {
    return compactLines([
      `⏳ ${APP_NOTIFICATION_NAME}: Waiting for user input`,
      `${resolvedThreadTitle} needs approval.`,
      activity.summary,
    ]);
  }

  return null;
}

const makeTelegramNotifications = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { stateDir } = yield* ServerConfig;
  const settingsPath = path.join(stateDir, TELEGRAM_NOTIFICATIONS_FILE);

  const toPersistenceError = (
    cause: unknown,
    action: "read" | "create directory" | "write" | "save",
  ): TelegramNotificationsError =>
    new TelegramNotificationsError({
      detail:
        cause instanceof Error
          ? cause.message
          : action === "read"
            ? `Unable to read Telegram notification settings at ${settingsPath}.`
            : action === "create directory"
              ? `Unable to create the Telegram notification settings directory for ${settingsPath}.`
              : action === "write"
                ? `Unable to write Telegram notification settings to ${settingsPath}.`
                : `Unable to save Telegram notification settings to ${settingsPath}.`,
    });

  const loadPersistedSettings = Effect.gen(function* () {
    const exists = yield* fs.exists(settingsPath).pipe(Effect.orElseSucceed(() => false));
    if (!exists) {
      return EMPTY_PERSISTED_TELEGRAM_NOTIFICATIONS;
    }

    const raw = yield* fs.readFileString(settingsPath).pipe(
      Effect.mapError((cause) => toPersistenceError(cause, "read")),
    );

    return yield* Effect.try({
      try: () => Schema.decodeSync(Schema.fromJsonString(PersistedTelegramNotificationsSchema))(raw),
      catch: (cause) =>
        new TelegramNotificationsError({
          detail:
            cause instanceof Error
              ? cause.message
              : "Telegram notification settings are invalid JSON.",
        }),
    }).pipe(
      Effect.catch((error) =>
        Effect.logWarning("Failed to parse Telegram notification settings; using defaults.").pipe(
          Effect.annotateLogs({
            settingsPath,
            cause: error.message,
          }),
          Effect.as(EMPTY_PERSISTED_TELEGRAM_NOTIFICATIONS),
        ),
      ),
    );
  });

  const persistSettings = (next: PersistedTelegramNotifications) =>
    Effect.gen(function* () {
      const serialized = `${JSON.stringify(next, null, 2)}\n`;
      const tempPath = `${settingsPath}.${process.pid}.${Date.now()}.tmp`;

      yield* fs.makeDirectory(path.dirname(settingsPath), { recursive: true }).pipe(
        Effect.mapError((cause) => toPersistenceError(cause, "create directory")),
      );
      yield* fs.writeFileString(tempPath, serialized).pipe(
        Effect.mapError((cause) => toPersistenceError(cause, "write")),
      );
      yield* fs.rename(tempPath, settingsPath).pipe(
        Effect.mapError((cause) => toPersistenceError(cause, "save")),
      );
    });

  const sendTelegramMessage = (config: PersistedTelegramNotifications, text: string) =>
    Effect.tryPromise({
      try: async () => {
        const response = await fetch(
          `https://api.telegram.org/bot${encodeURIComponent(config.botToken)}/sendMessage`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({
              chat_id: config.chatId,
              text,
              disable_web_page_preview: true,
            }),
          },
        );

        const rawBody = await response.text();
        let payload: { ok?: boolean; description?: string } | null = null;
        try {
          payload =
            rawBody.trim().length > 0 ? (JSON.parse(rawBody) as { ok?: boolean; description?: string }) : null;
        } catch {
          payload = null;
        }

        if (!response.ok || payload?.ok !== true) {
          const detail =
            payload?.description?.trim() ||
            rawBody.trim() ||
            `Telegram request failed with status ${response.status}.`;
          throw new TelegramNotificationsError({ detail });
        }
      },
      catch: (cause) =>
        Schema.is(TelegramNotificationsError)(cause)
          ? cause
          : new TelegramNotificationsError({
              detail: cause instanceof Error ? cause.message : "Telegram request failed.",
            }),
    });

  const initialSettings = yield* loadPersistedSettings.pipe(
    Effect.catch((error) =>
      Effect.logWarning("Failed to load Telegram notification settings; using defaults.").pipe(
        Effect.annotateLogs({ detail: error.message, settingsPath }),
        Effect.as(EMPTY_PERSISTED_TELEGRAM_NOTIFICATIONS),
      ),
    ),
  );
  const settingsRef = yield* Ref.make(initialSettings);

  const getResolvedSettingsSummary: TelegramNotificationsShape["getSettingsSummary"] = Ref.get(
    settingsRef,
  ).pipe(Effect.map(summarizeSettings));

  const updateSettings: TelegramNotificationsShape["updateSettings"] = (input) =>
    Effect.gen(function* () {
      const current = yield* Ref.get(settingsRef);
      const next = resolveDraftSettings(current, input);
      yield* persistSettings(next);
      yield* Ref.set(settingsRef, next);
      return summarizeSettings(next);
    });

  const sendTestNotification: TelegramNotificationsShape["sendTestNotification"] = (input) =>
    Effect.gen(function* () {
      const current = yield* Ref.get(settingsRef);
      const resolved = resolveDraftSettings(current, input);
      if (trimStoredValue(resolved.botToken).length === 0) {
        return yield* new TelegramNotificationsError({
          detail: "Enter a Telegram bot token before sending a test notification.",
        });
      }
      if (trimStoredValue(resolved.chatId).length === 0) {
        return yield* new TelegramNotificationsError({
          detail: "Enter a Telegram user/chat ID before sending a test notification.",
        });
      }

      yield* sendTelegramMessage(
        resolved,
        `${APP_NOTIFICATION_NAME}: Test notification\nYour Telegram notification settings are working.`,
      );
      return { delivered: true };
    });

  const sendOrchestrationNotification: TelegramNotificationsShape["sendOrchestrationNotification"] = (
    event,
    thread,
  ) =>
    Effect.gen(function* () {
      const current = yield* Ref.get(settingsRef);
      const message = buildTelegramNotificationText(event, thread);
      if (!message) {
        return;
      }

      if (
        trimStoredValue(current.botToken).length === 0 ||
        trimStoredValue(current.chatId).length === 0
      ) {
        return;
      }

      yield* sendTelegramMessage(current, message).pipe(
        Effect.catch((error) =>
          Effect.logWarning("Failed to send Telegram notification.").pipe(
            Effect.annotateLogs({
              detail: error.message,
              threadTitle: thread?.title ?? "",
            }),
          ),
        ),
      );
    });

  return {
    getSettingsSummary: getResolvedSettingsSummary,
    updateSettings,
    sendTestNotification,
    sendOrchestrationNotification,
  } satisfies TelegramNotificationsShape;
});

export const TelegramNotificationsLive = Layer.effect(
  TelegramNotifications,
  makeTelegramNotifications,
);
