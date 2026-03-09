import { createFileRoute } from "@tanstack/react-router";

import { isElectron } from "../env";
import { useMobileViewport } from "../mobileViewport";
import { cn } from "../lib/utils";

function ChatIndexRouteView() {
  const mobileViewport = useMobileViewport();

  return (
    <div
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background text-muted-foreground/40",
        mobileViewport.isMobile &&
          "pb-[calc(var(--safe-area-inset-bottom)+var(--app-mobile-bottom-nav-height,0px))]",
      )}
    >
      {!isElectron && (
        <header
          className={cn(
            "border-b border-border px-3 py-2 md:hidden",
            mobileViewport.isMobile && "px-3 py-[calc(var(--safe-area-inset-top)+0.75rem)]",
          )}
        >
          <div className="flex items-center">
            <span className="text-sm font-medium text-foreground">Threads</span>
          </div>
        </header>
      )}

      {isElectron && (
        <div className="drag-region flex h-[52px] shrink-0 items-center border-b border-border px-5">
          <span className="text-xs text-muted-foreground/50">No active thread</span>
        </div>
      )}

      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <p className="text-sm">Select a thread or create a new one to get started.</p>
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/_chat/")({
  component: ChatIndexRouteView,
});
