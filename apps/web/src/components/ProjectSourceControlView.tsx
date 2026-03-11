import { cn } from "../lib/utils";
import { useMobileViewport } from "../mobileViewport";
import type { Project } from "../types";
import GitActionsControl from "./GitActionsControl";
import { Badge } from "./ui/badge";

export default function ProjectSourceControlView({
  gitCwd,
  project,
  selectedThreadTitle = null,
}: {
  gitCwd: string;
  project: Project;
  selectedThreadTitle?: string | null;
}) {
  const mobileViewport = useMobileViewport();

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground",
        mobileViewport.isMobile &&
          "bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.06),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0))]",
      )}
    >
      <header className="shrink-0 border-b border-border/70 bg-background/78 px-3 py-3 backdrop-blur-xl sm:px-5 sm:py-4">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold tracking-[0.2em] text-muted-foreground/60 uppercase">
            Source Control
          </p>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="truncate text-base font-semibold sm:text-lg">{project.name}</h1>
            {selectedThreadTitle ? (
              <Badge variant="outline" className="hidden max-w-40 truncate sm:inline-flex">
                {selectedThreadTitle}
              </Badge>
            ) : null}
          </div>
          <p className="truncate text-xs text-muted-foreground/70 sm:text-sm">{gitCwd}</p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
        <div className={cn("mx-auto flex min-h-0 w-full flex-col", !mobileViewport.isMobile && "max-w-5xl")}>
          <GitActionsControl presentation="inline" gitCwd={gitCwd} projectName={project.name} />
        </div>
      </div>
    </div>
  );
}
