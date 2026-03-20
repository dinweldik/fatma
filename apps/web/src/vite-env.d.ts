/// <reference types="vite/client" />

import type { NativeApi, DesktopBridge } from "@fatma/contracts";

interface ImportMetaEnv {
  readonly APP_VERSION: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare global {
  const __APP_VERSION__: string;
  const __APP_BUILD_ID__: string;

  interface Window {
    nativeApi?: NativeApi;
    desktopBridge?: DesktopBridge;
  }
}
