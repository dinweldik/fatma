import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { isElectron } from "./env";
import { toastManager } from "./components/ui/toast";

interface BeforeInstallPromptChoice {
  outcome: "accepted" | "dismissed";
  platform: string;
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<BeforeInstallPromptChoice>;
}

interface PwaVersionPayload {
  appVersion: string;
}

interface PwaContextValue {
  readonly canInstall: boolean;
  readonly currentVersion: string;
  readonly installInstructions: string;
  readonly isCheckingForUpdates: boolean;
  readonly isInstalled: boolean;
  readonly isSupported: boolean;
  readonly latestVersion: string | null;
  readonly supportDetails: string;
  readonly updateAvailable: boolean;
  readonly applyUpdate: () => Promise<void>;
  readonly checkForUpdates: () => Promise<void>;
  readonly promptInstall: () => Promise<BeforeInstallPromptChoice | null>;
}

const APP_VERSION = __APP_VERSION__;
const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

const DEFAULT_PWA_CONTEXT: PwaContextValue = {
  canInstall: false,
  currentVersion: APP_VERSION,
  installInstructions: "Install is unavailable on this device or browser.",
  isCheckingForUpdates: false,
  isInstalled: false,
  isSupported: false,
  latestVersion: null,
  supportDetails: "PWA support is unavailable in the current environment.",
  updateAvailable: false,
  applyUpdate: async () => undefined,
  checkForUpdates: async () => undefined,
  promptInstall: async () => null,
};

const PwaContext = createContext<PwaContextValue>(DEFAULT_PWA_CONTEXT);

function isLocalhostHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

function resolveInstallInstructions(): string {
  const userAgent = navigator.userAgent.toLowerCase();
  const platform = navigator.platform.toLowerCase();
  const isTouchMac = /mac/i.test(platform) && navigator.maxTouchPoints > 1;

  if (/iphone|ipad|ipod/.test(userAgent) || isTouchMac) {
    return "Safari: Share -> Add to Home Screen.";
  }
  if (/android/.test(userAgent)) {
    return "Chrome/Edge: browser menu -> Install app or Add to Home screen.";
  }
  if (/mac/i.test(platform)) {
    return "Chrome/Edge: open the site menu and choose Install 6d.";
  }
  return "Use your browser's Install app / Add to Home Screen action.";
}

function resolveStandaloneMatch(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    navigatorWithStandalone.standalone === true
  );
}

async function fetchLatestPwaVersion(): Promise<string | null> {
  const response = await fetch("/pwa-version.json", {
    cache: "no-store",
    headers: {
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch PWA version (${response.status}).`);
  }
  const payload = (await response.json()) as Partial<PwaVersionPayload>;
  return typeof payload.appVersion === "string" && payload.appVersion.trim().length > 0
    ? payload.appVersion
    : null;
}

function resolveSupportDetails(params: { isDevelopment: boolean; isSupported: boolean }): string {
  const { isDevelopment, isSupported } = params;

  if (isElectron) {
    return "The desktop app already provides a native shell. Open the browser UI if you want the installable web app.";
  }
  if (typeof window === "undefined") {
    return "PWA support is only available in a browser environment.";
  }
  if (isDevelopment) {
    return "PWA install and update flows are disabled in Vite dev mode. Use `bun run dev:single` or the packaged server over HTTPS instead.";
  }
  if (!("serviceWorker" in navigator)) {
    return "This browser does not support the service worker APIs required for installation.";
  }
  if (isSupported) {
    return "For the best mobile experience, serve 6d from one stable HTTPS origin and install that origin as the standalone app.";
  }
  return "Installability requires HTTPS or localhost. Open 6d through your Tailscale HTTPS URL instead of a raw LAN HTTP address.";
}

export function PwaProvider(props: { readonly children: ReactNode }) {
  const { children } = props;
  const [deferredInstallPrompt, setDeferredInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [isCheckingForUpdates, setIsCheckingForUpdates] = useState(false);
  const [isInstalled, setIsInstalled] = useState(() => resolveStandaloneMatch());
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const updateToastShownRef = useRef(false);
  const isApplyingUpdateRef = useRef(false);
  const isDevelopment = import.meta.env.DEV;

  const isSupported =
    !isElectron &&
    !isDevelopment &&
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    (window.isSecureContext || isLocalhostHost(window.location.hostname));

  const checkForUpdates = useCallback(async () => {
    if (!isSupported) {
      return;
    }

    setIsCheckingForUpdates(true);
    try {
      const nextRegistration = registration;
      await nextRegistration?.update();
      const nextLatestVersion = await fetchLatestPwaVersion();
      setLatestVersion(nextLatestVersion);
      setUpdateAvailable(
        nextRegistration?.waiting != null ||
          (nextLatestVersion !== null && nextLatestVersion !== APP_VERSION),
      );
    } catch {
      // Keep the existing install/update state and retry later.
    } finally {
      setIsCheckingForUpdates(false);
    }
  }, [isSupported, registration]);

  const applyUpdate = useCallback(async () => {
    if (!isSupported) {
      return;
    }

    if (registration?.waiting) {
      isApplyingUpdateRef.current = true;
      // oxlint-disable-next-line unicorn/require-post-message-target-origin
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
      return;
    }

    window.location.reload();
  }, [isSupported, registration]);

  const promptInstall = useCallback(async () => {
    if (!deferredInstallPrompt) {
      return null;
    }

    await deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    setDeferredInstallPrompt(null);
    return choice;
  }, [deferredInstallPrompt]);

  useEffect(() => {
    if (!isSupported) {
      return;
    }

    let disposed = false;

    const registerServiceWorker = async () => {
      try {
        const nextRegistration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
        });
        if (disposed) {
          return;
        }
        setRegistration(nextRegistration);
        if (nextRegistration.waiting) {
          setUpdateAvailable(true);
        }

        const installingWorker = nextRegistration.installing;
        if (installingWorker) {
          installingWorker.addEventListener("statechange", () => {
            if (installingWorker.state === "installed" && navigator.serviceWorker.controller) {
              setUpdateAvailable(true);
            }
          });
        }

        nextRegistration.addEventListener("updatefound", () => {
          const worker = nextRegistration.installing;
          if (!worker) {
            return;
          }
          worker.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              setUpdateAvailable(true);
            }
          });
        });
      } catch {
        // Installability degrades gracefully without a registered service worker.
      }
    };

    void registerServiceWorker();

    return () => {
      disposed = true;
    };
  }, [isSupported]);

  useEffect(() => {
    if (!isSupported) {
      return;
    }

    const syncInstalledState = () => {
      setIsInstalled(resolveStandaloneMatch());
    };
    const onAppInstalled = () => {
      setDeferredInstallPrompt(null);
      syncInstalledState();
    };

    syncInstalledState();
    const standaloneMediaQuery = window.matchMedia("(display-mode: standalone)");
    standaloneMediaQuery.addEventListener("change", syncInstalledState);
    window.addEventListener("appinstalled", onAppInstalled);

    return () => {
      standaloneMediaQuery.removeEventListener("change", syncInstalledState);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, [isSupported]);

  useEffect(() => {
    if (!isSupported) {
      return;
    }

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredInstallPrompt(event as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    };
  }, [isSupported]);

  useEffect(() => {
    if (!isSupported) {
      return;
    }

    const onControllerChange = () => {
      if (!isApplyingUpdateRef.current) {
        return;
      }
      isApplyingUpdateRef.current = false;
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, [isSupported]);

  useEffect(() => {
    if (!isSupported) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void checkForUpdates();
    }, UPDATE_CHECK_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      void checkForUpdates();
    };
    const onFocus = () => {
      void checkForUpdates();
    };

    void checkForUpdates();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
    };
  }, [checkForUpdates, isSupported]);

  useEffect(() => {
    if (!updateAvailable) {
      updateToastShownRef.current = false;
      return;
    }
    if (updateToastShownRef.current) {
      return;
    }

    updateToastShownRef.current = true;
    toastManager.add({
      type: "info",
      title: "Web app update available",
      description:
        latestVersion && latestVersion !== APP_VERSION
          ? `Version ${latestVersion} is ready. Reload the installed app shell to switch to it.`
          : "A fresh web app shell is ready. Reload to update the installed version.",
      actionProps: {
        children: "Reload",
        onClick: () => {
          void applyUpdate();
        },
      },
    });
  }, [applyUpdate, latestVersion, updateAvailable]);

  const value = useMemo<PwaContextValue>(
    () => ({
      canInstall: deferredInstallPrompt !== null,
      currentVersion: APP_VERSION,
      installInstructions: resolveInstallInstructions(),
      isCheckingForUpdates,
      isInstalled,
      isSupported,
      latestVersion,
      supportDetails: resolveSupportDetails({ isDevelopment, isSupported }),
      updateAvailable,
      applyUpdate,
      checkForUpdates,
      promptInstall,
    }),
    [
      applyUpdate,
      checkForUpdates,
      deferredInstallPrompt,
      isCheckingForUpdates,
      isDevelopment,
      isInstalled,
      isSupported,
      latestVersion,
      promptInstall,
      updateAvailable,
    ],
  );

  return <PwaContext.Provider value={value}>{children}</PwaContext.Provider>;
}

export function usePwa(): PwaContextValue {
  return useContext(PwaContext);
}
