import { ProjectId } from "@fatma/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { useProjectToolsSurfaceMode } from "../hooks/useProjectToolsSurfaceMode";
import { resolveDesktopProjectToolsBaseRoute } from "../projectTools";
import { useSelectedChatStore } from "../selectedChatStore";
import ProjectFileExplorer from "../components/ProjectFileExplorer";
import { SidebarInset } from "../components/ui/sidebar";
import { useStore } from "../store";

function ProjectFilesRouteView() {
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
        projectTool: "files",
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
    <SidebarInset className="app-mobile-viewport min-h-0 overflow-hidden overscroll-y-none bg-background pt-[var(--safe-area-inset-top)] pb-[calc(var(--safe-area-inset-bottom)+var(--app-mobile-bottom-nav-height,0px))] text-foreground">
      <ProjectFileExplorer project={project} />
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/files/$projectId")({
  component: ProjectFilesRouteView,
});
