import { ProjectId } from "@fatma/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import ProjectShellsView from "../components/ProjectShellsView";
import { SidebarInset } from "../components/ui/sidebar";
import { useStore } from "../store";

function ProjectShellIndexRouteView() {
  const navigate = useNavigate();
  const projectId = Route.useParams({
    select: (params) => ProjectId.makeUnsafe(params.projectId),
  });
  const project = useStore(
    (store) => store.projects.find((entry) => entry.id === projectId) ?? null,
  );

  useEffect(() => {
    if (!project) {
      void navigate({ to: "/", replace: true });
    }
  }, [navigate, project]);

  if (!project) {
    return null;
  }

  return (
    <SidebarInset className="app-mobile-viewport min-h-0 overflow-hidden overscroll-y-none bg-background pt-[var(--safe-area-inset-top)] pb-[var(--app-mobile-bottom-nav-height,0px)] text-foreground">
      <ProjectShellsView project={project} />
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/shells/$projectId/")({
  component: ProjectShellIndexRouteView,
});
