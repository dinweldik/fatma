import { ProjectId } from "@t3tools/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { defaultProjectShellConfig, ensureProjectShell } from "../projectShellRunner";
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
      return;
    }

    const shell = ensureProjectShell(project.id, defaultProjectShellConfig(project));
    void navigate({
      to: "/shells/$projectId/$shellId",
      params: {
        projectId: project.id,
        shellId: shell.id,
      },
      replace: true,
    });
  }, [navigate, project]);

  return null;
}

export const Route = createFileRoute("/_chat/shells/$projectId/")({
  component: ProjectShellIndexRouteView,
});
