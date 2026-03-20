import { ProjectId } from "@fatma/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { useProjectToolsSurfaceMode } from "../hooks/useProjectToolsSurfaceMode";
import { resolveDesktopProjectToolsBaseRoute } from "../projectTools";
import { useSelectedChatStore } from "../selectedChatStore";
import ProjectShellsView from "../components/ProjectShellsView";
import { SidebarInset } from "../components/ui/sidebar";
import { useProjectShellStore } from "../projectShellStore";
import { useStore } from "../store";

function ProjectShellRouteView() {
  const navigate = useNavigate();
  const projectToolsSurfaceMode = useProjectToolsSurfaceMode();
  const selectedThreadId = useSelectedChatStore((store) => store.threadId);
  const setActiveShell = useProjectShellStore((store) => store.setActiveShell);
  const { projectId, shellId } = Route.useParams({
    select: (params) => ({
      projectId: ProjectId.makeUnsafe(params.projectId),
      shellId: params.shellId,
    }),
  });
  const project = useStore(
    (store) => store.projects.find((entry) => entry.id === projectId) ?? null,
  );
  const threads = useStore((store) => store.threads);

  useEffect(() => {
    if (!project) {
      void navigate({ to: "/", replace: true });
      return;
    }

    setActiveShell(project.id, shellId);
    if (projectToolsSurfaceMode === "sidepanel") {
      void navigate({
        ...resolveDesktopProjectToolsBaseRoute({
          projectId: project.id,
          selectedThreadId,
          threads,
        }),
        replace: true,
        search: {
          projectTool: "shells",
          projectToolProjectId: project.id,
        },
      });
      return;
    }

    void navigate({
      to: "/shells/$projectId",
      params: {
        projectId: project.id,
      },
      replace: true,
    });
  }, [
    navigate,
    project,
    projectToolsSurfaceMode,
    selectedThreadId,
    setActiveShell,
    shellId,
    threads,
  ]);

  if (!project) {
    return null;
  }

  if (projectToolsSurfaceMode === "sidepanel") {
    return null;
  }

  return (
    <SidebarInset className="app-mobile-viewport min-h-0 overflow-hidden overscroll-y-none bg-background pt-[var(--safe-area-inset-top)] pb-0 text-foreground">
      <ProjectShellsView project={project} shellId={shellId} />
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/shells/$projectId/$shellId")({
  component: ProjectShellRouteView,
});
