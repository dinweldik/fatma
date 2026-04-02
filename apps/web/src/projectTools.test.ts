import { ProjectId, ThreadId } from "@fatma/contracts";
import { describe, expect, it } from "vitest";

import {
  parseProjectToolsSearch,
  resolveDesktopProjectToolsBaseRoute,
  resolveProjectToolRoute,
} from "./projectTools";
import type { Thread } from "./types";

function createThread(input: { createdAt: string; id: string; projectId: string }): Thread {
  return {
    id: ThreadId.makeUnsafe(input.id),
    codexThreadId: null,
    projectId: ProjectId.makeUnsafe(input.projectId),
    title: input.id,
    modelSelection: {
      provider: "codex",
      model: "gpt-5",
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    session: null,
    messages: [],
    proposedPlans: [],
    error: null,
    createdAt: input.createdAt,
    archivedAt: null,
    latestTurn: null,
    branch: null,
    worktreePath: null,
    turnDiffSummaries: [],
    activities: [],
  };
}

describe("parseProjectToolsSearch", () => {
  it("parses valid project tool search values", () => {
    expect(
      parseProjectToolsSearch({
        projectTool: "shells",
        projectToolProjectId: "project-1",
      }),
    ).toEqual({
      projectTool: "shells",
      projectToolProjectId: "project-1",
    });
  });

  it("drops the project id when the tool is not valid", () => {
    expect(
      parseProjectToolsSearch({
        projectTool: "nope",
        projectToolProjectId: "project-1",
      }),
    ).toEqual({});
  });

  it("drops blank project ids", () => {
    expect(
      parseProjectToolsSearch({
        projectTool: "source-control",
        projectToolProjectId: "   ",
      }),
    ).toEqual({
      projectTool: "source-control",
    });
  });
});

describe("resolveProjectToolRoute", () => {
  it("builds the source control route target", () => {
    expect(
      resolveProjectToolRoute({
        projectId: ProjectId.makeUnsafe("project-1"),
        view: "source-control",
      }),
    ).toEqual({
      to: "/source-control/$projectId",
      params: { projectId: "project-1" },
    });
  });
});

describe("resolveDesktopProjectToolsBaseRoute", () => {
  it("prefers the selected thread when it belongs to the project", () => {
    const threads = [
      createThread({
        id: "thread-1",
        projectId: "project-1",
        createdAt: "2026-03-15T10:00:00.000Z",
      }),
      createThread({
        id: "thread-2",
        projectId: "project-1",
        createdAt: "2026-03-15T12:00:00.000Z",
      }),
    ];

    expect(
      resolveDesktopProjectToolsBaseRoute({
        projectId: ProjectId.makeUnsafe("project-1"),
        selectedThreadId: ThreadId.makeUnsafe("thread-1"),
        threads,
      }),
    ).toEqual({
      to: "/$threadId",
      params: { threadId: "thread-1" },
    });
  });

  it("falls back to the most recent project thread", () => {
    const threads = [
      createThread({
        id: "thread-1",
        projectId: "project-2",
        createdAt: "2026-03-15T10:00:00.000Z",
      }),
      createThread({
        id: "thread-2",
        projectId: "project-1",
        createdAt: "2026-03-15T11:00:00.000Z",
      }),
      createThread({
        id: "thread-3",
        projectId: "project-1",
        createdAt: "2026-03-15T12:00:00.000Z",
      }),
    ];

    expect(
      resolveDesktopProjectToolsBaseRoute({
        projectId: ProjectId.makeUnsafe("project-1"),
        selectedThreadId: ThreadId.makeUnsafe("thread-1"),
        threads,
      }),
    ).toEqual({
      to: "/$threadId",
      params: { threadId: "thread-3" },
    });
  });

  it("falls back to the projects page when the project has no threads", () => {
    expect(
      resolveDesktopProjectToolsBaseRoute({
        projectId: ProjectId.makeUnsafe("project-1"),
        selectedThreadId: null,
        threads: [],
      }),
    ).toEqual({
      to: "/projects",
    });
  });
});
