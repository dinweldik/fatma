import { Outlet, createFileRoute, useNavigate, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo } from "react";
import MobileBottomNav, { mobileBottomNavHeight } from "../components/MobileBottomNav";
import ProjectToolsDesktopPanel from "../components/ProjectToolsDesktopPanel";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { useProjectToolsSurfaceMode } from "../hooks/useProjectToolsSurfaceMode";
import { isElectron } from "../env";
import { isTerminalFocused } from "../lib/terminalFocus";
import { resolveShortcutCommand } from "../keybindings";
import { MobileViewportProvider } from "../mobileViewport";
import {
  buildHrefWithSearch,
  parseProjectToolsSearch,
  resolveProjectToolRoute,
  stripProjectToolsSearchParams,
} from "../projectTools";
import { useMobileViewport } from "../mobileViewport";
import { selectThreadTerminalState, useTerminalStateStore } from "../terminalStateStore";
import { useThreadSelectionStore } from "../threadSelectionStore";
import { resolveSidebarNewThreadEnvMode } from "~/components/Sidebar.logic";
import { useSettings } from "~/hooks/useSettings";
import { useServerKeybindings } from "~/rpc/serverState";
import { useStore } from "../store";
import { SidebarProvider } from "~/components/ui/sidebar";

const PROJECT_TOOLS_SIDEBAR_DEFAULT_WIDTH = "clamp(26rem,42vw,44rem)";
const PROJECT_TOOLS_SIDEBAR_STYLE = {
  "--sidebar-width": PROJECT_TOOLS_SIDEBAR_DEFAULT_WIDTH,
} as React.CSSProperties;
const MOBILE_NAV_VISIBLE_STYLE = {
  "--app-mobile-bottom-nav-height": mobileBottomNavHeight(true),
} as React.CSSProperties;
const MOBILE_NAV_HIDDEN_STYLE = {
  "--app-mobile-bottom-nav-height": mobileBottomNavHeight(false),
} as React.CSSProperties;

function ChatRouteGlobalShortcuts() {
  const clearSelection = useThreadSelectionStore((state) => state.clearSelection);
  const selectedThreadIdsSize = useThreadSelectionStore((state) => state.selectedThreadIds.size);
  const { activeDraftThread, activeThread, defaultProjectId, handleNewThread, routeThreadId } =
    useHandleNewThread();
  const keybindings = useServerKeybindings();
  const terminalOpen = useTerminalStateStore((state) =>
    routeThreadId
      ? selectThreadTerminalState(state.terminalStateByThreadId, routeThreadId).terminalOpen
      : false,
  );
  const appSettings = useSettings();

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      if (event.key === "Escape" && selectedThreadIdsSize > 0) {
        event.preventDefault();
        clearSelection();
        return;
      }

      const projectId = activeThread?.projectId ?? activeDraftThread?.projectId ?? defaultProjectId;
      if (!projectId) return;

      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen,
        },
      });

      if (command === "chat.newLocal") {
        event.preventDefault();
        event.stopPropagation();
        void handleNewThread(projectId, {
          envMode: resolveSidebarNewThreadEnvMode({
            defaultEnvMode: appSettings.defaultThreadEnvMode,
          }),
        });
        return;
      }

      if (command === "chat.new") {
        event.preventDefault();
        event.stopPropagation();
        void handleNewThread(projectId, {
          branch: activeThread?.branch ?? activeDraftThread?.branch ?? null,
          worktreePath: activeThread?.worktreePath ?? activeDraftThread?.worktreePath ?? null,
          envMode:
            activeDraftThread?.envMode ?? (activeThread?.worktreePath ? "worktree" : "local"),
        });
        return;
      }
    };

    window.addEventListener("keydown", onWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
    };
  }, [
    activeDraftThread,
    activeThread,
    clearSelection,
    handleNewThread,
    keybindings,
    defaultProjectId,
    selectedThreadIdsSize,
    terminalOpen,
    appSettings.defaultThreadEnvMode,
  ]);

  return null;
}

function ChatRouteLayout() {
  const navigate = useNavigate();
  const mobileViewport = useMobileViewport();
  const projectToolsSurfaceMode = useProjectToolsSurfaceMode();
  const bootstrapComplete = useStore((store) => store.bootstrapComplete);
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
    if (!bootstrapComplete) {
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
    bootstrapComplete,
    closeDesktopProjectTool,
    projectToolsProject,
    projectToolsSearch.projectTool,
    projectToolsSearch.projectToolProjectId,
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
    <>
      <ChatRouteGlobalShortcuts />
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
          style={PROJECT_TOOLS_SIDEBAR_STYLE}
        >
          <div
            className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
            style={showMobileBottomNav ? MOBILE_NAV_VISIBLE_STYLE : MOBILE_NAV_HIDDEN_STYLE}
          >
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
        <div
          className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
          style={showMobileBottomNav ? MOBILE_NAV_VISIBLE_STYLE : MOBILE_NAV_HIDDEN_STYLE}
        >
          <Outlet />
          <MobileBottomNav />
        </div>
      )}
    </>
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
