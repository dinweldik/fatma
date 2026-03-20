import { ProjectId } from "@fatma/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { useProjectToolsSurfaceMode } from "../hooks/useProjectToolsSurfaceMode";
import { resolveDesktopProjectToolsBaseRoute } from "../projectTools";
import { useSelectedChatStore } from "../selectedChatStore";
import ProjectShellsView from "../components/ProjectShellsView";
import { SidebarInset } from "../components/ui/sidebar";
import { useStore } from "../store";

function ProjectShellIndexRouteView() {
  const navigate = useNavigate();
  const projectToolsSurfaceMode = useProjectToolsSurfaceMode();
  const selectedThreadId = useSelectedChatStore((store) => store.threadId);
  const projectId = Route.useParams({
    select: (params) => ProjectId.makeUnsafe(params.projectId),
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
    if (projectToolsSurfaceMode !== "sidepanel") {
      return;
    }

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
  }, [navigate, project, projectToolsSurfaceMode, selectedThreadId, threads]);

  if (!project) {
    return null;
  }

  if (projectToolsSurfaceMode === "sidepanel") {
    return null;
  }

  return (
    <SidebarInset className="app-mobile-viewport min-h-0 overflow-hidden overscroll-y-none bg-background pt-[var(--safe-area-inset-top)] pb-0 text-foreground">
      <ProjectShellsView project={project} />
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/shells/$projectId/")({
  component: ProjectShellIndexRouteView,
});
