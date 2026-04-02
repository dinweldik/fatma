import { CommandId, ProjectId, ThreadId } from "@fatma/contracts";
import { describe, expect, it, vi } from "vitest";

import { ensureThreadExists, type ThreadCreateCommand } from "./ensureThreadExists";

function createThreadCommand(): ThreadCreateCommand {
  return {
    type: "thread.create",
    commandId: CommandId.makeUnsafe("cmd-thread-create"),
    threadId: ThreadId.makeUnsafe("thread-1"),
    projectId: ProjectId.makeUnsafe("project-1"),
    title: "New thread",
    modelSelection: {
      provider: "codex",
      model: "gpt-5-codex",
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    createdAt: "2026-03-11T00:00:00.000Z",
  };
}

describe("ensureThreadExists", () => {
  it("returns created when the dispatch succeeds", async () => {
    const command = createThreadCommand();
    const dispatchCommand = vi.fn().mockResolvedValue({ sequence: 1 });
    const getSnapshot = vi.fn();

    await expect(
      ensureThreadExists({
        api: {
          orchestration: {
            dispatchCommand,
            getSnapshot,
          },
        },
        command,
      }),
    ).resolves.toBe("created");

    expect(dispatchCommand).toHaveBeenCalledWith(command);
    expect(getSnapshot).not.toHaveBeenCalled();
  });

  it("reconciles against the snapshot when the thread already exists", async () => {
    const command = createThreadCommand();
    const dispatchCommand = vi
      .fn()
      .mockRejectedValue(new Error("Thread already exists and cannot be created twice."));
    const snapshot = {
      snapshotSequence: 2,
      updatedAt: "2026-03-11T00:00:01.000Z",
      projects: [],
      threads: [
        {
          id: command.threadId,
          projectId: command.projectId,
          title: command.title,
          modelSelection: command.modelSelection,
          runtimeMode: command.runtimeMode,
          interactionMode: command.interactionMode,
          branch: command.branch,
          worktreePath: command.worktreePath,
          latestTurn: null,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
          archivedAt: null,
          deletedAt: null,
          messages: [],
          activities: [],
          checkpoints: [],
          session: null,
          proposedPlans: [],
        },
      ],
    } as const;
    const getSnapshot = vi.fn().mockResolvedValue(snapshot);
    const onSnapshot = vi.fn();

    await expect(
      ensureThreadExists({
        api: {
          orchestration: {
            dispatchCommand,
            getSnapshot,
          },
        },
        command,
        onSnapshot,
      }),
    ).resolves.toBe("existing");

    expect(getSnapshot).toHaveBeenCalledTimes(1);
    expect(onSnapshot).toHaveBeenCalledWith(snapshot);
  });

  it("rethrows the original error when the snapshot does not include the thread", async () => {
    const command = createThreadCommand();
    const error = new Error("boom");
    const dispatchCommand = vi.fn().mockRejectedValue(error);
    const getSnapshot = vi.fn().mockResolvedValue({
      snapshotSequence: 1,
      updatedAt: "2026-03-11T00:00:01.000Z",
      projects: [],
      threads: [],
    });

    await expect(
      ensureThreadExists({
        api: {
          orchestration: {
            dispatchCommand,
            getSnapshot,
          },
        },
        command,
      }),
    ).rejects.toBe(error);
  });
});
