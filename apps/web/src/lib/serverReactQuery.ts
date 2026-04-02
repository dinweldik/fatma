import { queryOptions } from "@tanstack/react-query";

import { ensureNativeApi } from "../nativeApi";

export const serverQueryKeys = {
  all: ["server"] as const,
  config: () => ["server", "config"] as const,
};

export function serverConfigQueryOptions() {
  return queryOptions({
    queryKey: serverQueryKeys.config(),
    queryFn: () => ensureNativeApi().server.getConfig(),
    staleTime: Infinity,
    refetchOnMount: "always",
  });
}
