import { ProjectId } from "@fatma/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import ProjectShellsView from "../components/ProjectShellsView";
import { SidebarInset } from "../components/ui/sidebar";
import { useProjectShellStore } from "../projectShellStore";
import { useStore } from "../store";

function ProjectShellRouteView() {
  const navigate = useNavigate();
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

  useEffect(() => {
    if (!project) {
      void navigate({ to: "/", replace: true });
      return;
    }

    setActiveShell(project.id, shellId);
    void navigate({
      to: "/shells/$projectId",
      params: {
        projectId: project.id,
      },
      replace: true,
    });
  }, [navigate, project, setActiveShell, shellId]);

  if (!project) {
    return null;
  }

  return (
    <SidebarInset className="app-mobile-viewport min-h-0 overflow-hidden overscroll-y-none bg-background pt-[var(--safe-area-inset-top)] pb-[calc(var(--safe-area-inset-bottom)+var(--app-mobile-bottom-nav-height,0px))] text-foreground">
      <ProjectShellsView project={project} shellId={shellId} />
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/shells/$projectId/$shellId")({
  component: ProjectShellRouteView,
});
