import { type ProjectId } from "@fatma/contracts";
import { create } from "zustand";

interface ProjectShellMobileChromeState {
  readonly selectionModeByProjectId: Record<ProjectId, boolean>;
  readonly setSelectionMode: (projectId: ProjectId, open: boolean) => void;
}

export function selectProjectShellMobileSelectionMode(
  selectionModeByProjectId: Record<ProjectId, boolean>,
  projectId: ProjectId,
): boolean {
  return selectionModeByProjectId[projectId] ?? false;
}

export const useProjectShellMobileChromeStore = create<ProjectShellMobileChromeState>()((set) => ({
  selectionModeByProjectId: {},
  setSelectionMode: (projectId, open) => {
    set((state) => {
      const currentValue = state.selectionModeByProjectId[projectId] ?? false;
      if (currentValue === open) {
        return state;
      }

      if (!open) {
        const { [projectId]: _removed, ...rest } = state.selectionModeByProjectId;
        return {
          selectionModeByProjectId: rest as Record<ProjectId, boolean>,
        };
      }

      return {
        selectionModeByProjectId: {
          ...state.selectionModeByProjectId,
          [projectId]: true,
        },
      };
    });
  },
}));
