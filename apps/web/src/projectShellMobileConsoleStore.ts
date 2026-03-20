import { type ProjectId } from "@fatma/contracts";
import { create } from "zustand";

import { DEFAULT_PROJECT_SHELL_MOBILE_PROMPT } from "./projectShellMobileConsole.logic";

export interface ProjectShellMobileConsoleState {
  readonly draftText: string;
  readonly outputText: string;
  readonly promptText: string;
  readonly shellId: string | null;
}

const EMPTY_PROJECT_SHELL_MOBILE_CONSOLE_STATE = Object.freeze({
  draftText: "",
  outputText: "",
  promptText: DEFAULT_PROJECT_SHELL_MOBILE_PROMPT,
  shellId: null,
}) satisfies ProjectShellMobileConsoleState;

interface ProjectShellMobileConsoleStoreState {
  readonly consoleStateByProjectId: Record<ProjectId, ProjectShellMobileConsoleState>;
  readonly appendConsoleOutput: (
    projectId: ProjectId,
    input: {
      outputText: string;
      promptText: string;
      shellId: string;
    },
  ) => void;
  readonly clearConsoleState: (projectId: ProjectId) => void;
  readonly replaceConsoleState: (
    projectId: ProjectId,
    input: {
      outputText: string;
      promptText: string;
      shellId: string;
    },
  ) => void;
  readonly setDraftText: (projectId: ProjectId, draftText: string) => void;
}

export function selectProjectShellMobileConsoleState(
  consoleStateByProjectId: Record<ProjectId, ProjectShellMobileConsoleState>,
  projectId: ProjectId,
): ProjectShellMobileConsoleState {
  return consoleStateByProjectId[projectId] ?? EMPTY_PROJECT_SHELL_MOBILE_CONSOLE_STATE;
}

export const useProjectShellMobileConsoleStore = create<ProjectShellMobileConsoleStoreState>()(
  (set) => ({
    consoleStateByProjectId: {},
    appendConsoleOutput: (projectId, input) => {
      set((state) => {
        const currentState =
          state.consoleStateByProjectId[projectId] ?? EMPTY_PROJECT_SHELL_MOBILE_CONSOLE_STATE;
        if (currentState.shellId && currentState.shellId !== input.shellId) {
          return state;
        }

        const nextState: ProjectShellMobileConsoleState = {
          ...currentState,
          outputText: input.outputText,
          promptText: input.promptText,
          shellId: input.shellId,
        };
        return {
          consoleStateByProjectId: {
            ...state.consoleStateByProjectId,
            [projectId]: nextState,
          },
        };
      });
    },
    clearConsoleState: (projectId) => {
      set((state) => {
        if (!state.consoleStateByProjectId[projectId]) {
          return state;
        }

        const { [projectId]: _removed, ...rest } = state.consoleStateByProjectId;
        return {
          consoleStateByProjectId: rest as Record<ProjectId, ProjectShellMobileConsoleState>,
        };
      });
    },
    replaceConsoleState: (projectId, input) => {
      set((state) => {
        const currentState =
          state.consoleStateByProjectId[projectId] ?? EMPTY_PROJECT_SHELL_MOBILE_CONSOLE_STATE;
        const nextState: ProjectShellMobileConsoleState = {
          draftText: currentState.shellId === input.shellId ? currentState.draftText : "",
          outputText: input.outputText,
          promptText: input.promptText,
          shellId: input.shellId,
        };

        return {
          consoleStateByProjectId: {
            ...state.consoleStateByProjectId,
            [projectId]: nextState,
          },
        };
      });
    },
    setDraftText: (projectId, draftText) => {
      set((state) => {
        const currentState =
          state.consoleStateByProjectId[projectId] ?? EMPTY_PROJECT_SHELL_MOBILE_CONSOLE_STATE;
        if (currentState.draftText === draftText) {
          return state;
        }

        return {
          consoleStateByProjectId: {
            ...state.consoleStateByProjectId,
            [projectId]: {
              ...currentState,
              draftText,
            },
          },
        };
      });
    },
  }),
);
