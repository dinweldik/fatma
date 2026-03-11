import { ProjectId } from "@fatma/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";

import ProjectSourceControlView from "../components/ProjectSourceControlView";
import { SidebarInset } from "../components/ui/sidebar";
import { useComposerDraftStore } from "../composerDraftStore";
import { useSelectedChatStore } from "../selectedChatStore";
import { useStore } from "../store";

function ProjectSourceControlRouteView() {
  const navigate = useNavigate();
  const selectedChatThreadId = useSelectedChatStore((store) => store.threadId);
  const draftThreadsByThreadId = useComposerDraftStore((store) => store.draftThreadsByThreadId);
  const projectId = Route.useParams({
    select: (params) => ProjectId.makeUnsafe(params.projectId),
  });
  const project = useStore(
    (store) => store.projects.find((entry) => entry.id === projectId) ?? null,
  );
  const threads = useStore((store) => store.threads);

  const selectedServerThread = useMemo(() => {
    if (!selectedChatThreadId) {
      return null;
    }

    const thread = threads.find((entry) => entry.id === selectedChatThreadId) ?? null;
    if (!thread || thread.projectId !== projectId) {
      return null;
    }

    return thread;
  }, [projectId, selectedChatThreadId, threads]);

  const selectedDraftThread = useMemo(() => {
    if (!selectedChatThreadId) {
      return null;
    }

    const draftThread = draftThreadsByThreadId[selectedChatThreadId];
    if (!draftThread || draftThread.projectId !== projectId) {
      return null;
    }

    return draftThread;
  }, [draftThreadsByThreadId, projectId, selectedChatThreadId]);

  useEffect(() => {
    if (!project) {
      void navigate({ to: "/", replace: true });
    }
  }, [navigate, project]);

  if (!project) {
    return null;
  }

  const gitCwd = selectedServerThread?.worktreePath ?? selectedDraftThread?.worktreePath ?? project.cwd;

  return (
    <SidebarInset className="app-mobile-viewport min-h-0 overflow-hidden overscroll-y-none bg-background pt-[var(--safe-area-inset-top)] pb-[calc(var(--safe-area-inset-bottom)+var(--app-mobile-bottom-nav-height,0px))] text-foreground">
      <ProjectSourceControlView
        gitCwd={gitCwd}
        project={project}
        selectedThreadTitle={selectedServerThread?.title ?? null}
      />
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/source-control/$projectId")({
  component: ProjectSourceControlRouteView,
});
