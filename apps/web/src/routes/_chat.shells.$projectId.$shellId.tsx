import { type KeybindingCommand, ProjectId, type ProjectScript } from "@t3tools/contracts";
import { QueryClient, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";

import ProjectShellsView from "../components/ProjectShellsView";
import { SidebarInset } from "../components/ui/sidebar";
import { decodeProjectScriptKeybindingRule } from "../lib/projectScriptKeybindings";
import { serverQueryKeys } from "../lib/serverReactQuery";
import { readNativeApi } from "../nativeApi";
import { commandForProjectScript, nextProjectScriptId } from "../projectScripts";
import { useStore } from "../store";
import { type Project } from "../types";
import { newCommandId } from "../lib/utils";
import { type NewProjectScriptInput } from "../components/ProjectScriptsControl";

async function persistProjectScripts(input: {
  project: Project;
  nextScripts: ProjectScript[];
  keybinding?: string | null;
  keybindingCommand: KeybindingCommand;
  queryClient: QueryClient;
}) {
  const api = readNativeApi();
  if (!api) {
    throw new Error("Native API is unavailable.");
  }

  await api.orchestration.dispatchCommand({
    type: "project.meta.update",
    commandId: newCommandId(),
    projectId: input.project.id,
    scripts: input.nextScripts,
  });

  const keybindingRule = decodeProjectScriptKeybindingRule({
    keybinding: input.keybinding,
    command: input.keybindingCommand,
  });
  if (!keybindingRule) {
    return;
  }

  await api.server.upsertKeybinding(keybindingRule);
  await input.queryClient.invalidateQueries({ queryKey: serverQueryKeys.all });
}

function ProjectShellRouteView() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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

  const addProjectScript = useCallback(
    async (input: NewProjectScriptInput) => {
      if (!project) {
        return;
      }
      const nextId = nextProjectScriptId(
        input.name,
        project.scripts.map((script) => script.id),
      );
      const nextScript: ProjectScript = {
        id: nextId,
        name: input.name,
        command: input.command,
        icon: input.icon,
        runOnWorktreeCreate: input.runOnWorktreeCreate,
      };
      const nextScripts = input.runOnWorktreeCreate
        ? [
            ...project.scripts.map((script) =>
              script.runOnWorktreeCreate ? { ...script, runOnWorktreeCreate: false } : script,
            ),
            nextScript,
          ]
        : [...project.scripts, nextScript];

      await persistProjectScripts({
        project,
        nextScripts,
        keybinding: input.keybinding,
        keybindingCommand: commandForProjectScript(nextId),
        queryClient,
      });
    },
    [project, queryClient],
  );

  const updateProjectScript = useCallback(
    async (scriptId: string, input: NewProjectScriptInput) => {
      if (!project) {
        return;
      }
      const existingScript = project.scripts.find((script) => script.id === scriptId);
      if (!existingScript) {
        throw new Error("Script not found.");
      }
      const updatedScript: ProjectScript = {
        ...existingScript,
        name: input.name,
        command: input.command,
        icon: input.icon,
        runOnWorktreeCreate: input.runOnWorktreeCreate,
      };
      const nextScripts = project.scripts.map((script) =>
        script.id === scriptId
          ? updatedScript
          : input.runOnWorktreeCreate
            ? { ...script, runOnWorktreeCreate: false }
            : script,
      );

      await persistProjectScripts({
        project,
        nextScripts,
        keybinding: input.keybinding,
        keybindingCommand: commandForProjectScript(scriptId),
        queryClient,
      });
    },
    [project, queryClient],
  );

  if (!project) {
    return null;
  }

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background pt-[var(--safe-area-inset-top)] pb-[var(--safe-area-inset-bottom)] text-foreground">
      <ProjectShellsView
        project={project}
        shellId={shellId}
        onAddProjectScript={addProjectScript}
        onUpdateProjectScript={updateProjectScript}
      />
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/shells/$projectId/$shellId")({
  component: ProjectShellRouteView,
});
