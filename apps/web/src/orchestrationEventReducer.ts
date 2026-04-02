import type { OrchestrationEvent } from "@fatma/contracts";

import { applyOrchestrationEvent, type AppState } from "./store";

interface ApplyEventResult {
  readonly handled: boolean;
  readonly state: AppState;
}

const SNAPSHOT_REQUIRED_EVENT_TYPES = new Set<OrchestrationEvent["type"]>([
  "thread.checkpoint-revert-requested",
  "thread.reverted",
]);

export function applyOrchestrationEventToAppState(
  state: AppState,
  event: OrchestrationEvent,
): ApplyEventResult {
  if (SNAPSHOT_REQUIRED_EVENT_TYPES.has(event.type)) {
    return { handled: false, state };
  }

  return {
    handled: true,
    state: applyOrchestrationEvent(state, event),
  };
}
