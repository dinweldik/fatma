import { ProjectId } from "@t3tools/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import ProjectShellsView from "../components/ProjectShellsView";
import { SidebarInset } from "../components/ui/sidebar";
import { useStore } from "../store";

function ProjectShellRouteView() {
  const navigate = useNavigate();
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
    if (project) {
      return;
    }
    void navigate({ to: "/", replace: true });
  }, [navigate, project]);

  if (!project) {
    return null;
  }

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background pt-[var(--safe-area-inset-top)] pb-[var(--safe-area-inset-bottom)] text-foreground">
      <ProjectShellsView project={project} shellId={shellId} />
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/shells/$projectId/$shellId")({
  component: ProjectShellRouteView,
});
