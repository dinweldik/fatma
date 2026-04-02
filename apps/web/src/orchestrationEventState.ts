import type { OrchestrationEvent } from "@fatma/contracts";

import { applyOrchestrationEvent, type AppState } from "./store";

const SNAPSHOT_REQUIRED_EVENT_TYPES = new Set<OrchestrationEvent["type"]>([
  "thread.checkpoint-revert-requested",
  "thread.reverted",
]);

export function canApplyOrchestrationEventIncrementally(event: OrchestrationEvent): boolean {
  return !SNAPSHOT_REQUIRED_EVENT_TYPES.has(event.type);
}

export function applyOrchestrationEventToAppState(
  state: AppState,
  event: OrchestrationEvent,
): AppState {
  if (!canApplyOrchestrationEventIncrementally(event)) {
    return state;
  }

  return applyOrchestrationEvent(state, event);
}
