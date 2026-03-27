import { Outlet, createFileRoute, useNavigate, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo } from "react";

import MobileBottomNav, { mobileBottomNavHeight } from "../components/MobileBottomNav";
import ProjectToolsDesktopPanel from "../components/ProjectToolsDesktopPanel";
import ThreadSidebar from "../components/Sidebar";
import { useProjectToolsSurfaceMode } from "../hooks/useProjectToolsSurfaceMode";
import { MobileViewportProvider } from "../mobileViewport";
import { isElectron } from "../env";
import {
  buildHrefWithSearch,
  parseProjectToolsSearch,
  resolveProjectToolRoute,
  stripProjectToolsSearchParams,
} from "../projectTools";
import { useStore } from "../store";
import { Sidebar, SidebarProvider } from "~/components/ui/sidebar";
import { useMobileViewport } from "../mobileViewport";

const PROJECT_TOOLS_SIDEBAR_DEFAULT_WIDTH = "clamp(26rem,42vw,44rem)";

function ChatRouteLayout() {
  const navigate = useNavigate();
  const mobileViewport = useMobileViewport();
  const projectToolsSurfaceMode = useProjectToolsSurfaceMode();
  const threadsHydrated = useStore((store) => store.threadsHydrated);
  const currentLocation = useRouterState({
    select: (state) => ({
      hash: state.location.hash,
      pathname: state.location.pathname,
      search: state.location.search as Record<string, unknown>,
    }),
  });
  const projectToolsSearch = useMemo(
    () => parseProjectToolsSearch(currentLocation.search),
    [currentLocation.search],
  );
  const projectToolsProject = useStore((store) =>
    projectToolsSearch.projectToolProjectId
      ? (store.projects.find((project) => project.id === projectToolsSearch.projectToolProjectId) ??
        null)
      : null,
  );
  const showMobileBottomNav = mobileViewport.isMobile && !isElectron;
  const projectToolsPanelOpen =
    projectToolsSurfaceMode === "sidepanel" &&
    projectToolsSearch.projectTool !== undefined &&
    projectToolsProject !== null;
  const closeDesktopProjectTool = useCallback(async () => {
    await navigate({
      href: buildHrefWithSearch({
        pathname: currentLocation.pathname,
        hash: currentLocation.hash,
        search: {
          ...stripProjectToolsSearchParams(currentLocation.search),
          projectTool: "",
          projectToolProjectId: "",
        },
      }),
    });
  }, [currentLocation.hash, currentLocation.pathname, currentLocation.search, navigate]);

  useEffect(() => {
    const onMenuAction = window.desktopBridge?.onMenuAction;
    if (typeof onMenuAction !== "function") {
      return;
    }

    const unsubscribe = onMenuAction((action) => {
      if (action !== "open-settings") return;
      void navigate({ to: "/settings" });
    });

    return () => {
      unsubscribe?.();
    };
  }, [navigate]);

  useEffect(() => {
    if (!threadsHydrated) {
      return;
    }
    if (!projectToolsSearch.projectTool || !projectToolsSearch.projectToolProjectId) {
      return;
    }
    if (projectToolsProject) {
      return;
    }

    void closeDesktopProjectTool();
  }, [
    closeDesktopProjectTool,
    projectToolsProject,
    projectToolsSearch.projectTool,
    projectToolsSearch.projectToolProjectId,
    threadsHydrated,
  ]);

  useEffect(() => {
    if (
      projectToolsSurfaceMode === "sidepanel" ||
      !projectToolsSearch.projectTool ||
      !projectToolsSearch.projectToolProjectId
    ) {
      return;
    }

    void navigate({
      ...resolveProjectToolRoute({
        projectId: projectToolsSearch.projectToolProjectId,
        view: projectToolsSearch.projectTool,
      }),
      replace: true,
      search: {},
    });
  }, [
    navigate,
    projectToolsSearch.projectTool,
    projectToolsSearch.projectToolProjectId,
    projectToolsSurfaceMode,
  ]);

  return (
    <SidebarProvider
      defaultOpen
      style={
        {
          "--app-mobile-bottom-nav-height": mobileBottomNavHeight(showMobileBottomNav),
        } as React.CSSProperties
      }
    >
      {mobileViewport.isMobile ? null : (
        <Sidebar
          side="left"
          collapsible="offcanvas"
          className="border-r border-border bg-card text-foreground"
        >
          <ThreadSidebar />
        </Sidebar>
      )}
      {projectToolsSurfaceMode === "sidepanel" ? (
        <SidebarProvider
          defaultOpen={false}
          open={projectToolsPanelOpen}
          onOpenChange={(open) => {
            if (!open) {
              void closeDesktopProjectTool();
            }
          }}
          className="min-h-0 flex-1 bg-transparent"
          style={{ "--sidebar-width": PROJECT_TOOLS_SIDEBAR_DEFAULT_WIDTH } as React.CSSProperties}
        >
          <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <Outlet />
            <MobileBottomNav />
          </div>
          {projectToolsPanelOpen &&
          projectToolsProject !== null &&
          projectToolsSearch.projectTool ? (
            <ProjectToolsDesktopPanel
              project={projectToolsProject}
              view={projectToolsSearch.projectTool}
            />
          ) : null}
        </SidebarProvider>
      ) : (
        <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <Outlet />
          <MobileBottomNav />
        </div>
      )}
    </SidebarProvider>
  );
}

export const Route = createFileRoute("/_chat")({
  validateSearch: (search) => parseProjectToolsSearch(search),
  component: function ChatRouteLayoutWithViewport() {
    return (
      <MobileViewportProvider>
        <ChatRouteLayout />
      </MobileViewportProvider>
    );
  },
});
