import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { useMediaQuery } from "./hooks/useMediaQuery";

export interface MobileViewportMetrics {
  readonly isKeyboardOpen: boolean;
  readonly isMobile: boolean;
  readonly keyboardInset: number;
  readonly viewportHeight: number | null;
}

const DEFAULT_MOBILE_VIEWPORT_METRICS: MobileViewportMetrics = {
  isKeyboardOpen: false,
  isMobile: false,
  keyboardInset: 0,
  viewportHeight: null,
};

const MobileViewportContext = createContext<MobileViewportMetrics>(
  DEFAULT_MOBILE_VIEWPORT_METRICS,
);

export function resolveMobileViewportMetrics(input: {
  readonly innerHeight: number;
  readonly visualViewportHeight?: number | null | undefined;
  readonly visualViewportOffsetTop?: number | null | undefined;
}): Omit<MobileViewportMetrics, "isMobile"> {
  const innerHeight = Number.isFinite(input.innerHeight) ? Math.max(0, input.innerHeight) : 0;
  const visualViewportHeight =
    typeof input.visualViewportHeight === "number" && Number.isFinite(input.visualViewportHeight)
      ? Math.max(0, input.visualViewportHeight)
      : innerHeight;
  const visualViewportOffsetTop =
    typeof input.visualViewportOffsetTop === "number" &&
    Number.isFinite(input.visualViewportOffsetTop)
      ? Math.max(0, input.visualViewportOffsetTop)
      : 0;
  const viewportHeight = visualViewportHeight > 0 ? visualViewportHeight : innerHeight || null;
  const keyboardInset =
    viewportHeight === null
      ? 0
      : Math.max(0, innerHeight - (viewportHeight + visualViewportOffsetTop));

  return {
    isKeyboardOpen: keyboardInset > 0,
    keyboardInset,
    viewportHeight,
  };
}

export function MobileViewportProvider(props: { readonly children: ReactNode }) {
  const { children } = props;
  const isMobile = useMediaQuery("(max-width: 767px)");
  const [metrics, setMetrics] = useState<Omit<MobileViewportMetrics, "isMobile">>(() => {
    if (typeof window === "undefined") {
      return DEFAULT_MOBILE_VIEWPORT_METRICS;
    }

    return resolveMobileViewportMetrics({
      innerHeight: window.innerHeight,
      visualViewportHeight: window.visualViewport?.height,
      visualViewportOffsetTop: window.visualViewport?.offsetTop,
    });
  });

  useEffect(() => {
    const root = document.documentElement;
    const clearViewportVars = () => {
      root.style.removeProperty("--app-mobile-viewport-height");
      root.style.removeProperty("--app-mobile-keyboard-inset");
    };

    if (!isMobile) {
      clearViewportVars();
      setMetrics(DEFAULT_MOBILE_VIEWPORT_METRICS);
      return;
    }

    let frameId: number | null = null;
    const updateMetrics = () => {
      frameId = null;
      const nextMetrics = resolveMobileViewportMetrics({
        innerHeight: window.innerHeight,
        visualViewportHeight: window.visualViewport?.height,
        visualViewportOffsetTop: window.visualViewport?.offsetTop,
      });

      setMetrics((current) => {
        if (
          current.viewportHeight === nextMetrics.viewportHeight &&
          current.keyboardInset === nextMetrics.keyboardInset &&
          current.isKeyboardOpen === nextMetrics.isKeyboardOpen
        ) {
          return current;
        }
        return nextMetrics;
      });

      if (nextMetrics.viewportHeight === null) {
        root.style.removeProperty("--app-mobile-viewport-height");
      } else {
        root.style.setProperty("--app-mobile-viewport-height", `${nextMetrics.viewportHeight}px`);
      }
      root.style.setProperty("--app-mobile-keyboard-inset", `${nextMetrics.keyboardInset}px`);
    };
    const scheduleMetricsUpdate = () => {
      if (frameId !== null) return;
      frameId = window.requestAnimationFrame(updateMetrics);
    };

    scheduleMetricsUpdate();

    const visualViewport = window.visualViewport;
    window.addEventListener("resize", scheduleMetricsUpdate);
    visualViewport?.addEventListener("resize", scheduleMetricsUpdate);
    visualViewport?.addEventListener("scroll", scheduleMetricsUpdate);

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      window.removeEventListener("resize", scheduleMetricsUpdate);
      visualViewport?.removeEventListener("resize", scheduleMetricsUpdate);
      visualViewport?.removeEventListener("scroll", scheduleMetricsUpdate);
      clearViewportVars();
    };
  }, [isMobile]);

  const value = useMemo<MobileViewportMetrics>(
    () => ({
      isMobile,
      ...metrics,
    }),
    [isMobile, metrics],
  );

  return <MobileViewportContext.Provider value={value}>{children}</MobileViewportContext.Provider>;
}

export function useMobileViewport(): MobileViewportMetrics {
  return useContext(MobileViewportContext);
}
