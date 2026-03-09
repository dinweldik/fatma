/// <reference types="vite/client" />

import type { NativeApi, DesktopBridge } from "@t3tools/contracts";

declare global {
  const __APP_VERSION__: string;

  interface Window {
    nativeApi?: NativeApi;
    desktopBridge?: DesktopBridge;
  }
}
