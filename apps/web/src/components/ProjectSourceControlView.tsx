import { cn } from "../lib/utils";
import { useMobileViewport } from "../mobileViewport";
import type { Project } from "../types";
import GitActionsControl from "./GitActionsControl";
import ProjectBranchSelector from "./ProjectBranchSelector";

export default function ProjectSourceControlView({
  gitCwd,
  project,
}: {
  gitCwd: string;
  project: Project;
}) {
  const mobileViewport = useMobileViewport();

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground",
        mobileViewport.isMobile &&
          "bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.06),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0))]",
      )}
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-sidebar-border px-3 py-2.5 sm:px-4">
        <div className="min-w-0">
          <h1 className="truncate text-xs font-medium text-foreground/90">{project.name}</h1>
          <p className="truncate text-[10px] text-muted-foreground/60">{gitCwd}</p>
        </div>
        <ProjectBranchSelector projectId={project.id} cwd={gitCwd} />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-2 sm:p-3">
        <div
          className={cn(
            "mx-auto flex min-h-0 w-full flex-col",
            !mobileViewport.isMobile && "max-w-5xl",
          )}
        >
          <GitActionsControl presentation="inline" gitCwd={gitCwd} projectName={project.name} />
        </div>
      </div>
    </div>
  );
}
