export type AppResumeReason = "visibilitychange" | "focus" | "online";

type AppResumeListener = (reason: AppResumeReason) => void;

const listeners = new Set<AppResumeListener>();
const RESUME_SIGNAL_DEDUPE_MS = 750;

let detachGlobalListeners: (() => void) | null = null;
let lastEmittedAt = 0;

function emit(reason: AppResumeReason): void {
  const now = Date.now();
  if (now - lastEmittedAt < RESUME_SIGNAL_DEDUPE_MS) {
    return;
  }
  lastEmittedAt = now;
  for (const listener of listeners) {
    try {
      listener(reason);
    } catch {
      // Swallow listener errors so one subscriber does not break resume recovery.
    }
  }
}

function ensureGlobalListeners(): void {
  if (
    detachGlobalListeners !== null ||
    typeof window === "undefined" ||
    typeof document === "undefined"
  ) {
    return;
  }

  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      emit("visibilitychange");
    }
  };
  const onFocus = () => {
    emit("focus");
  };
  const onOnline = () => {
    emit("online");
  };

  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("focus", onFocus);
  window.addEventListener("online", onOnline);

  detachGlobalListeners = () => {
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("online", onOnline);
    detachGlobalListeners = null;
  };
}

export function subscribeToAppResume(listener: AppResumeListener): () => void {
  ensureGlobalListeners();
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      lastEmittedAt = 0;
      detachGlobalListeners?.();
    }
  };
}
