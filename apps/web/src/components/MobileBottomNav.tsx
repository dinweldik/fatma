import { ProjectId, ThreadId } from "@fatma/contracts";
import { useNavigate, useParams, useRouterState } from "@tanstack/react-router";
import {
  FolderKanbanIcon,
  FolderOpenIcon,
  GitBranchIcon,
  MessageSquareTextIcon,
  TerminalSquareIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import { useComposerDraftStore } from "../composerDraftStore";
import { isElectron } from "../env";
import { cn } from "../lib/utils";
import { useMobileViewport } from "../mobileViewport";
import ProjectShellMobileDock from "./ProjectShellMobileDock";
import {
  findProjectIdForThread,
  getMostRecentThreadIdForProject,
  resolveSelectedChatProjectId,
  resolveSelectedChatThreadId,
  useSelectedChatStore,
} from "../selectedChatStore";
import { useStore } from "../store";

// Reserve only the base nav chrome. Shell routes can extend this measured dock.
const MOBILE_BOTTOM_NAV_HEIGHT = "3.75rem";

function iconClass(active: boolean): string {
  return active ? "text-foreground" : "text-muted-foreground/72";
}

export function mobileBottomNavHeight(isVisible: boolean): string {
  return isVisible ? MOBILE_BOTTOM_NAV_HEIGHT : "0px";
}

export default function MobileBottomNav() {
  const navigate = useNavigate();
  const dockRef = useRef<HTMLDivElement>(null);
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const mobileViewport = useMobileViewport();
  const draftThreadsByThreadId = useComposerDraftStore((store) => store.draftThreadsByThreadId);
  const projects = useStore((store) => store.projects);
  const selectedChatProjectId = useSelectedChatStore((store) => store.projectId);
  const selectedChatThreadId = useSelectedChatStore((store) => store.threadId);
  const threads = useStore((store) => store.threads);
  const routeParams = useParams({
    strict: false,
    select: (params) => ({
      projectId: params.projectId ? ProjectId.makeUnsafe(params.projectId) : null,
      threadId: params.threadId ? ThreadId.makeUnsafe(params.threadId) : null,
    }),
  });

  const routeThreadProjectId = useMemo(
    () =>
      findProjectIdForThread({
        draftThreadsByThreadId,
        threadId: routeParams.threadId,
        threads,
      }),
    [draftThreadsByThreadId, routeParams.threadId, threads],
  );
  const persistedProjectId = useMemo(
    () =>
      resolveSelectedChatProjectId({
        draftThreadsByThreadId,
        projects,
        selectedProjectId: selectedChatProjectId,
        selectedThreadId: selectedChatThreadId,
        threads,
      }),
    [draftThreadsByThreadId, projects, selectedChatProjectId, selectedChatThreadId, threads],
  );
  const persistedThreadId = useMemo(
    () =>
      resolveSelectedChatThreadId({
        draftThreadsByThreadId,
        selectedThreadId: selectedChatThreadId,
        threads,
      }),
    [draftThreadsByThreadId, selectedChatThreadId, threads],
  );
  const navigationProjectId =
    persistedProjectId ?? routeParams.projectId ?? routeThreadProjectId ?? projects[0]?.id ?? null;
  const chatTargetThreadId = useMemo(
    () =>
      persistedThreadId ??
      getMostRecentThreadIdForProject({
        projectId: navigationProjectId,
        threads,
      }),
    [navigationProjectId, persistedThreadId, threads],
  );
  const showBottomNav = mobileViewport.isMobile && !isElectron;
  const projectsIsActive = pathname.startsWith("/projects") || pathname.startsWith("/settings");
  const sourceControlIsActive = pathname.startsWith("/source-control/");
  const shellIsActive = pathname.startsWith("/shells/");
  const filesIsActive = pathname.startsWith("/files/");
  const chatIsActive =
    pathname === "/" ||
    (!projectsIsActive && !shellIsActive && !sourceControlIsActive && !filesIsActive);
  const canOpenProjectTabs = navigationProjectId !== null;
  const shellDockProjectId = shellIsActive ? routeParams.projectId : null;

  useEffect(() => {
    const root = document.documentElement;
    if (!showBottomNav) {
      root.style.removeProperty("--app-mobile-bottom-dock-height");
      return;
    }

    const element = dockRef.current;
    if (!element) {
      root.style.setProperty("--app-mobile-bottom-dock-height", MOBILE_BOTTOM_NAV_HEIGHT);
      return;
    }

    let frameId: number | null = null;
    const publishDockHeight = () => {
      frameId = null;
      root.style.setProperty(
        "--app-mobile-bottom-dock-height",
        `${Math.max(0, Math.round(element.getBoundingClientRect().height))}px`,
      );
    };
    const scheduleDockHeightPublish = () => {
      if (frameId !== null) {
        return;
      }
      frameId = window.requestAnimationFrame(publishDockHeight);
    };
    const observer = new ResizeObserver(scheduleDockHeightPublish);

    observer.observe(element);
    scheduleDockHeightPublish();

    return () => {
      observer.disconnect();
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      root.style.removeProperty("--app-mobile-bottom-dock-height");
    };
  }, [shellDockProjectId, showBottomNav]);

  if (!showBottomNav) {
    return null;
  }

  return (
    <div
      ref={dockRef}
      data-mobile-bottom-dock="true"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-background/96 shadow-[0_-12px_32px_rgba(0,0,0,0.18)] backdrop-blur-xl"
      style={{ bottom: "var(--app-mobile-keyboard-inset)" }}
    >
      {shellDockProjectId ? <ProjectShellMobileDock projectId={shellDockProjectId} /> : null}
      <nav
        aria-label="Mobile navigation"
        className="mx-auto flex w-full items-stretch gap-1.5 px-2 pt-1 pb-[calc(var(--safe-area-inset-bottom)+0.4rem)]"
      >
        <button
          type="button"
          className={cn(
            "flex min-h-12 flex-1 flex-col items-center justify-center gap-1 rounded-[1rem] px-2 text-[11px] font-medium transition-colors duration-150 hover:bg-accent hover:text-foreground",
            projectsIsActive ? "bg-accent text-foreground" : "text-muted-foreground",
          )}
          onClick={() => {
            void navigate({ to: "/projects" });
          }}
        >
          <FolderKanbanIcon className={cn("size-4", iconClass(projectsIsActive))} />
          <span>Projects</span>
        </button>
        <button
          type="button"
          className={cn(
            "flex min-h-12 flex-1 flex-col items-center justify-center gap-1 rounded-[1rem] px-2 text-[11px] font-medium transition-colors duration-150 hover:bg-accent hover:text-foreground",
            chatIsActive ? "bg-accent text-foreground" : "text-muted-foreground",
          )}
          onClick={() => {
            if (chatTargetThreadId) {
              void navigate({
                to: "/$threadId",
                params: { threadId: chatTargetThreadId },
              });
              return;
            }
            void navigate({ to: "/" });
          }}
        >
          <MessageSquareTextIcon className={cn("size-4", iconClass(chatIsActive))} />
          <span>Chat</span>
        </button>
        <button
          type="button"
          disabled={!canOpenProjectTabs}
          className={cn(
            "flex min-h-12 flex-1 flex-col items-center justify-center gap-1 rounded-[1rem] px-2 text-[11px] font-medium transition-colors duration-150 hover:bg-accent hover:text-foreground disabled:opacity-40",
            sourceControlIsActive ? "bg-accent text-foreground" : "text-muted-foreground",
          )}
          onClick={() => {
            if (!navigationProjectId) return;
            void navigate({
              to: "/source-control/$projectId",
              params: { projectId: navigationProjectId },
            });
          }}
        >
          <GitBranchIcon className={cn("size-4", iconClass(sourceControlIsActive))} />
          <span>Source</span>
        </button>
        <button
          type="button"
          disabled={!canOpenProjectTabs}
          className={cn(
            "flex min-h-12 flex-1 flex-col items-center justify-center gap-1 rounded-[1rem] px-2 text-[11px] font-medium transition-colors duration-150 hover:bg-accent hover:text-foreground disabled:opacity-40",
            filesIsActive ? "bg-accent text-foreground" : "text-muted-foreground",
          )}
          onClick={() => {
            if (!navigationProjectId) return;
            void navigate({
              to: "/files/$projectId",
              params: { projectId: navigationProjectId },
            });
          }}
        >
          <FolderOpenIcon className={cn("size-4", iconClass(filesIsActive))} />
          <span>Files</span>
        </button>
        <button
          type="button"
          disabled={!canOpenProjectTabs}
          className={cn(
            "flex min-h-12 flex-1 flex-col items-center justify-center gap-1 rounded-[1rem] px-2 text-[11px] font-medium transition-colors duration-150 hover:bg-accent hover:text-foreground disabled:opacity-40",
            shellIsActive ? "bg-accent text-foreground" : "text-muted-foreground",
          )}
          onClick={() => {
            if (!navigationProjectId) return;
            void navigate({
              to: "/shells/$projectId",
              params: { projectId: navigationProjectId },
            });
          }}
        >
          <TerminalSquareIcon className={cn("size-4", iconClass(shellIsActive))} />
          <span>Shell</span>
        </button>
      </nav>
    </div>
  );
}
