import type { Project } from "../types";
import { type ProjectToolView } from "../projectTools";
import ProjectFileExplorer from "./ProjectFileExplorer";
import ProjectShellsView from "./ProjectShellsView";
import ProjectSourceControlView from "./ProjectSourceControlView";
import { Sidebar, SidebarRail } from "./ui/sidebar";

const PROJECT_TOOLS_SIDEBAR_MIN_WIDTH = 24 * 16;
const PROJECT_TOOLS_SIDEBAR_WIDTH_STORAGE_KEY = "chat_project_tools_sidebar_width";

function ProjectToolContent({
  project,
  view,
}: {
  project: Project;
  view: ProjectToolView;
}) {
  if (view === "source-control") {
    return <ProjectSourceControlView gitCwd={project.cwd} project={project} />;
  }
  if (view === "files") {
    return <ProjectFileExplorer project={project} />;
  }
  return <ProjectShellsView navigationMode="embedded" project={project} />;
}

export default function ProjectToolsDesktopPanel({
  project,
  view,
}: {
  project: Project;
  view: ProjectToolView;
}) {
  return (
    <Sidebar
      side="right"
      collapsible="offcanvas"
      className="border-l border-border bg-card text-foreground"
      resizable={{
        minWidth: PROJECT_TOOLS_SIDEBAR_MIN_WIDTH,
        storageKey: PROJECT_TOOLS_SIDEBAR_WIDTH_STORAGE_KEY,
      }}
    >
      <ProjectToolContent project={project} view={view} />
      <SidebarRail />
    </Sidebar>
  );
}
