import { ProjectId, type ThreadId } from "@fatma/contracts";

import { getMostRecentThreadIdForProject } from "./selectedChatStore";
import type { Thread } from "./types";

export type ProjectToolView = "source-control" | "shells" | "files";

export interface ProjectToolsSearch {
  projectTool?: ProjectToolView | undefined;
  projectToolProjectId?: ProjectId | undefined;
}

function normalizeSearchString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeProjectToolView(value: unknown): ProjectToolView | undefined {
  if (value === "source-control" || value === "shells" || value === "files") {
    return value;
  }

  return undefined;
}

export function parseProjectToolsSearch(search: Record<string, unknown>): ProjectToolsSearch {
  const projectTool = normalizeProjectToolView(search.projectTool);
  const projectToolProjectIdRaw = projectTool
    ? normalizeSearchString(search.projectToolProjectId)
    : undefined;
  const projectToolProjectId = projectToolProjectIdRaw
    ? ProjectId.makeUnsafe(projectToolProjectIdRaw)
    : undefined;

  return {
    ...(projectTool ? { projectTool } : {}),
    ...(projectToolProjectId ? { projectToolProjectId } : {}),
  };
}

export function stripProjectToolsSearchParams<T extends Record<string, unknown>>(
  params: T,
): Omit<T, "projectTool" | "projectToolProjectId"> {
  const {
    projectTool: _projectTool,
    projectToolProjectId: _projectToolProjectId,
    ...rest
  } = params;
  return rest as Omit<T, "projectTool" | "projectToolProjectId">;
}

export function resolveProjectToolRoute(input: { projectId: ProjectId; view: ProjectToolView }):
  | {
      params: {
        projectId: ProjectId;
      };
      to: "/source-control/$projectId";
    }
  | {
      params: {
        projectId: ProjectId;
      };
      to: "/shells/$projectId";
    }
  | {
      params: {
        projectId: ProjectId;
      };
      to: "/files/$projectId";
    } {
  if (input.view === "source-control") {
    return {
      to: "/source-control/$projectId",
      params: { projectId: input.projectId },
    };
  }
  if (input.view === "files") {
    return {
      to: "/files/$projectId",
      params: { projectId: input.projectId },
    };
  }
  return {
    to: "/shells/$projectId",
    params: { projectId: input.projectId },
  };
}

export function resolveDesktopProjectToolsBaseRoute(input: {
  projectId: ProjectId;
  selectedThreadId: ThreadId | null;
  threads: readonly Thread[];
}):
  | {
      params: {
        threadId: ThreadId;
      };
      to: "/$threadId";
    }
  | {
      to: "/projects";
    } {
  const selectedProjectThread =
    input.selectedThreadId === null
      ? null
      : (input.threads.find(
          (thread) => thread.id === input.selectedThreadId && thread.projectId === input.projectId,
        ) ?? null);
  const threadId =
    selectedProjectThread?.id ??
    getMostRecentThreadIdForProject({
      projectId: input.projectId,
      threads: input.threads,
    });

  return threadId
    ? {
        to: "/$threadId",
        params: { threadId },
      }
    : {
        to: "/projects",
      };
}

export function buildHrefWithSearch(input: {
  hash?: string | undefined;
  pathname: string;
  search: Record<string, unknown>;
}): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(input.search)) {
    if (value === undefined || value === null || value === false) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry === undefined || entry === null || entry === false) {
          continue;
        }
        params.append(key, String(entry));
      }
      continue;
    }
    params.set(key, String(value));
  }

  const query = params.toString();
  const hash =
    input.hash && input.hash.length > 0
      ? input.hash.startsWith("#")
        ? input.hash
        : `#${input.hash}`
      : "";
  return query.length > 0 ? `${input.pathname}?${query}${hash}` : `${input.pathname}${hash}`;
}
