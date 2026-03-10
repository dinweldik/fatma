import { ProjectId, ThreadId } from "@fatma/contracts";
import { useNavigate, useParams, useRouterState } from "@tanstack/react-router";
import { FolderKanbanIcon, MessageSquareTextIcon, SettingsIcon, TerminalSquareIcon } from "lucide-react";
import { useMemo } from "react";

import { isElectron } from "../env";
import { useMobileViewport } from "../mobileViewport";
import { useStore } from "../store";
import { cn } from "../lib/utils";

const MOBILE_BOTTOM_NAV_HEIGHT = "5rem";

function iconClass(active: boolean): string {
  return active ? "text-foreground" : "text-muted-foreground/72";
}

export function mobileBottomNavHeight(isVisible: boolean): string {
  return isVisible ? MOBILE_BOTTOM_NAV_HEIGHT : "0px";
}

export default function MobileBottomNav() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const mobileViewport = useMobileViewport();
  const projects = useStore((store) => store.projects);
  const threads = useStore((store) => store.threads);
  const routeParams = useParams({
    strict: false,
    select: (params) => ({
      projectId: params.projectId ? ProjectId.makeUnsafe(params.projectId) : null,
      threadId: params.threadId ? ThreadId.makeUnsafe(params.threadId) : null,
    }),
  });

  const activeThread = useMemo(
    () => (routeParams.threadId ? threads.find((thread) => thread.id === routeParams.threadId) : null),
    [routeParams.threadId, threads],
  );
  const activeProjectId = routeParams.projectId ?? activeThread?.projectId ?? projects[0]?.id ?? null;
  const mostRecentThreadIdForActiveProject = useMemo(() => {
    if (!activeProjectId) {
      return threads[0]?.id ?? null;
    }

    return (
      threads
        .filter((thread) => thread.projectId === activeProjectId)
        .toSorted((a, b) => {
          const byDate = Date.parse(b.createdAt) - Date.parse(a.createdAt);
          if (byDate !== 0) return byDate;
          return b.id.localeCompare(a.id);
        })[0]?.id ?? null
    );
  }, [activeProjectId, threads]);
  const showBottomNav = mobileViewport.isMobile && !mobileViewport.isKeyboardOpen && !isElectron;

  if (!showBottomNav) {
    return null;
  }

  const chatIsActive =
    pathname === "/" ||
    (!pathname.startsWith("/projects") &&
      !pathname.startsWith("/settings") &&
      !pathname.startsWith("/shells/"));
  const projectsIsActive = pathname.startsWith("/projects");
  const shellIsActive = pathname.startsWith("/shells/");
  const settingsIsActive = pathname.startsWith("/settings");
  const canOpenShell = activeProjectId !== null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-background/96 shadow-[0_-12px_32px_rgba(0,0,0,0.18)] backdrop-blur-xl">
      <nav
        aria-label="Mobile navigation"
        className="mx-auto flex w-full items-stretch gap-1.5 px-2 pt-2 pb-[calc(var(--safe-area-inset-bottom)+0.4rem)]"
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
            if (mostRecentThreadIdForActiveProject) {
              void navigate({
                to: "/$threadId",
                params: { threadId: mostRecentThreadIdForActiveProject },
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
          disabled={!canOpenShell}
          className={cn(
            "flex min-h-12 flex-1 flex-col items-center justify-center gap-1 rounded-[1rem] px-2 text-[11px] font-medium transition-colors duration-150 hover:bg-accent hover:text-foreground disabled:opacity-40",
            shellIsActive ? "bg-accent text-foreground" : "text-muted-foreground",
          )}
          onClick={() => {
            if (!activeProjectId) return;
            void navigate({
              to: "/shells/$projectId",
              params: { projectId: activeProjectId },
            });
          }}
        >
          <TerminalSquareIcon className={cn("size-4", iconClass(shellIsActive))} />
          <span>Shell</span>
        </button>
        <button
          type="button"
          className={cn(
            "flex min-h-12 flex-1 flex-col items-center justify-center gap-1 rounded-[1rem] px-2 text-[11px] font-medium transition-colors duration-150 hover:bg-accent hover:text-foreground",
            settingsIsActive ? "bg-accent text-foreground" : "text-muted-foreground",
          )}
          onClick={() => {
            void navigate({ to: "/settings" });
          }}
        >
          <SettingsIcon className={cn("size-4", iconClass(settingsIsActive))} />
          <span>Settings</span>
        </button>
      </nav>
    </div>
  );
}
