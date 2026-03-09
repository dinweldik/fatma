import { useCallback, useRef, type TouchEvent } from "react";

const DEFAULT_EDGE_ACTIVATION_PX = 32;
const DEFAULT_MIN_SWIPE_DISTANCE_PX = 72;
const DIRECTION_LOCK_RATIO = 1.15;

interface MobileEdgeSwipeState {
  readonly side: "left" | "right";
  readonly startX: number;
  readonly startY: number;
}

function isInteractiveTouchTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  return Boolean(
    target.closest(
      [
        "a",
        "button",
        "input",
        "label",
        "select",
        "summary",
        "textarea",
        "[contenteditable='true']",
        "[data-touch-swipe-ignore='true']",
        "[role='button']",
        "[role='textbox']",
      ].join(","),
    ),
  );
}

export function useMobileEdgeSwipe(input: {
  readonly enabled: boolean;
  readonly leftEnabled?: boolean;
  readonly rightEnabled?: boolean;
  readonly onSwipeFromLeftEdge?: () => void;
  readonly onSwipeFromRightEdge?: () => void;
  readonly edgeActivationPx?: number;
  readonly minSwipeDistancePx?: number;
}) {
  const stateRef = useRef<MobileEdgeSwipeState | null>(null);
  const triggeredRef = useRef(false);
  const enabled = input.enabled;
  const edgeActivationPx = input.edgeActivationPx ?? DEFAULT_EDGE_ACTIVATION_PX;
  const minSwipeDistancePx = input.minSwipeDistancePx ?? DEFAULT_MIN_SWIPE_DISTANCE_PX;
  const leftEnabled = input.leftEnabled ?? true;
  const onSwipeFromLeftEdge = input.onSwipeFromLeftEdge;
  const onSwipeFromRightEdge = input.onSwipeFromRightEdge;
  const rightEnabled = input.rightEnabled ?? true;

  const clearGestureState = useCallback(() => {
    stateRef.current = null;
    triggeredRef.current = false;
  }, []);

  const onTouchStartCapture = useCallback(
    (event: TouchEvent<HTMLElement>) => {
      clearGestureState();
      if (!enabled || event.touches.length !== 1) {
        return;
      }
      if (isInteractiveTouchTarget(event.target)) {
        return;
      }

      const touch = event.touches[0];
      if (!touch) return;

      const rightEdgeDistance = window.innerWidth - touch.clientX;
      const side =
        leftEnabled && touch.clientX <= edgeActivationPx
          ? "left"
          : rightEnabled && rightEdgeDistance <= edgeActivationPx
            ? "right"
            : null;

      if (!side) {
        return;
      }

      stateRef.current = {
        side,
        startX: touch.clientX,
        startY: touch.clientY,
      };
    },
    [clearGestureState, edgeActivationPx, enabled, leftEnabled, rightEnabled],
  );

  const onTouchMoveCapture = useCallback(
    (event: TouchEvent<HTMLElement>) => {
      if (triggeredRef.current) {
        return;
      }

      const gesture = stateRef.current;
      const touch = event.touches[0];
      if (!gesture || !touch) {
        return;
      }

      const deltaX = touch.clientX - gesture.startX;
      const deltaY = touch.clientY - gesture.startY;
      const absDeltaX = Math.abs(deltaX);
      const absDeltaY = Math.abs(deltaY);

      if (absDeltaY > absDeltaX && absDeltaY > 12) {
        clearGestureState();
        return;
      }
      if (absDeltaX < minSwipeDistancePx) {
        return;
      }
      if (absDeltaX < absDeltaY * DIRECTION_LOCK_RATIO) {
        return;
      }

      if (gesture.side === "left" && deltaX > 0) {
        triggeredRef.current = true;
        onSwipeFromLeftEdge?.();
        clearGestureState();
        return;
      }
      if (gesture.side === "right" && deltaX < 0) {
        triggeredRef.current = true;
        onSwipeFromRightEdge?.();
        clearGestureState();
      }
    },
    [clearGestureState, minSwipeDistancePx, onSwipeFromLeftEdge, onSwipeFromRightEdge],
  );

  const onTouchEndCapture = useCallback(() => {
    clearGestureState();
  }, [clearGestureState]);

  return {
    onTouchCancelCapture: onTouchEndCapture,
    onTouchEndCapture,
    onTouchMoveCapture,
    onTouchStartCapture,
  };
}
