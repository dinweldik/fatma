import { type ProjectId } from "@fatma/contracts";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";

import { stripDiffSearchParams } from "./diffRouteSearch";
import { useProjectToolsSurfaceMode } from "./hooks/useProjectToolsSurfaceMode";
import {
  buildHrefWithSearch,
  parseProjectToolsSearch,
  resolveProjectToolRoute,
  stripProjectToolsSearchParams,
  type ProjectToolView,
} from "./projectTools";

export function useProjectToolsNavigation() {
  const navigate = useNavigate();
  const surfaceMode = useProjectToolsSurfaceMode();
  const currentLocation = useRouterState({
    select: (state) => ({
      hash: state.location.hash,
      pathname: state.location.pathname,
      search: state.location.search as Record<string, unknown>,
    }),
  });
  const activeProjectTools = useMemo(
    () => parseProjectToolsSearch(currentLocation.search),
    [currentLocation.search],
  );

  const openProjectTool = useCallback(
    async (input: { projectId: ProjectId; view: ProjectToolView }) => {
      if (surfaceMode === "sidepanel") {
        await navigate({
          href: buildHrefWithSearch({
            pathname: currentLocation.pathname,
            hash: currentLocation.hash,
            search: {
              ...stripProjectToolsSearchParams(stripDiffSearchParams(currentLocation.search)),
              projectTool: input.view,
              projectToolProjectId: input.projectId,
            },
          }),
        });
        return;
      }

      await navigate({
        ...resolveProjectToolRoute(input),
      });
    },
    [currentLocation.hash, currentLocation.pathname, currentLocation.search, navigate, surfaceMode],
  );

  const closeProjectTool = useCallback(async () => {
    if (surfaceMode !== "sidepanel") {
      return;
    }

    await navigate({
      href: buildHrefWithSearch({
        pathname: currentLocation.pathname,
        hash: currentLocation.hash,
        search: {
          ...stripProjectToolsSearchParams(currentLocation.search),
          projectTool: "",
          projectToolProjectId: "",
        },
      }),
    });
  }, [
    currentLocation.hash,
    currentLocation.pathname,
    currentLocation.search,
    navigate,
    surfaceMode,
  ]);

  const toggleProjectTool = useCallback(
    async (input: { projectId: ProjectId; view: ProjectToolView }) => {
      if (
        surfaceMode === "sidepanel" &&
        activeProjectTools.projectTool === input.view &&
        activeProjectTools.projectToolProjectId === input.projectId
      ) {
        await closeProjectTool();
        return;
      }

      await openProjectTool(input);
    },
    [
      activeProjectTools.projectTool,
      activeProjectTools.projectToolProjectId,
      closeProjectTool,
      openProjectTool,
      surfaceMode,
    ],
  );

  const openFiles = useCallback(
    async (projectId: ProjectId) => {
      await openProjectTool({ projectId, view: "files" });
    },
    [openProjectTool],
  );

  const openShells = useCallback(
    async (projectId: ProjectId) => {
      await openProjectTool({ projectId, view: "shells" });
    },
    [openProjectTool],
  );

  const openSourceControl = useCallback(
    async (projectId: ProjectId) => {
      await openProjectTool({ projectId, view: "source-control" });
    },
    [openProjectTool],
  );

  const toggleFiles = useCallback(
    async (projectId: ProjectId) => {
      await toggleProjectTool({ projectId, view: "files" });
    },
    [toggleProjectTool],
  );

  const toggleShells = useCallback(
    async (projectId: ProjectId) => {
      await toggleProjectTool({ projectId, view: "shells" });
    },
    [toggleProjectTool],
  );

  const toggleSourceControl = useCallback(
    async (projectId: ProjectId) => {
      await toggleProjectTool({ projectId, view: "source-control" });
    },
    [toggleProjectTool],
  );

  return {
    activeProjectId: activeProjectTools.projectToolProjectId ?? null,
    activeProjectTool: activeProjectTools.projectTool ?? null,
    closeProjectTool,
    openFiles,
    openProjectTool,
    openShells,
    openSourceControl,
    surfaceMode,
    toggleFiles,
    toggleProjectTool,
    toggleShells,
    toggleSourceControl,
  };
}
