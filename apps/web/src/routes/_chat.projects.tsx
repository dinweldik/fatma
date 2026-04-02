import { createFileRoute } from "@tanstack/react-router";

import ThreadSidebar from "../components/Sidebar";
import { SidebarInset } from "../components/ui/sidebar";
import { cn } from "../lib/utils";
import { useMobileViewport } from "../mobileViewport";

function ProjectsRouteView() {
  const mobileViewport = useMobileViewport();

  return (
    <SidebarInset className="app-mobile-viewport min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div
        className={cn(
          "flex h-full min-h-0 flex-col bg-card text-foreground",
          mobileViewport.isMobile && "pb-[var(--app-mobile-bottom-nav-height,0px)]",
        )}
      >
        <ThreadSidebar />
      </div>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/projects")({
  component: ProjectsRouteView,
});
