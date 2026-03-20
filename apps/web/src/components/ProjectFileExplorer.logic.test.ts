import { describe, expect, it } from "vitest";

import {
  editorStatusLabel,
  isEditorDirty,
  relativeWorkspacePath,
} from "./ProjectFileExplorer.logic";

describe("relativeWorkspacePath", () => {
  it("returns a workspace-relative path when the file is inside the project root", () => {
    expect(relativeWorkspacePath("/repo/project", "/repo/project/src/index.ts")).toBe(
      "src/index.ts",
    );
  });

  it("falls back to a trimmed path when the file is outside the root prefix", () => {
    expect(relativeWorkspacePath("/repo/project", "/tmp/other/file.txt")).toBe(
      "tmp/other/file.txt",
    );
  });
});

describe("isEditorDirty", () => {
  it("detects unsaved changes", () => {
    expect(isEditorDirty("before", "after")).toBe(true);
  });

  it("returns false when contents match the last saved version", () => {
    expect(isEditorDirty("same", "same")).toBe(false);
  });
});

describe("editorStatusLabel", () => {
  it("prioritizes saving state", () => {
    expect(
      editorStatusLabel({
        dirty: true,
        errorMessage: null,
        isSaving: true,
        lastSavedAt: null,
      }),
    ).toBe("Saving...");
  });

  it("shows errors ahead of other passive states", () => {
    expect(
      editorStatusLabel({
        dirty: true,
        errorMessage: "Save failed",
        isSaving: false,
        lastSavedAt: "2026-03-19T12:00:00.000Z",
      }),
    ).toBe("Save failed");
  });

  it("shows saved when the buffer is clean after a save", () => {
    expect(
      editorStatusLabel({
        dirty: false,
        errorMessage: null,
        isSaving: false,
        lastSavedAt: "2026-03-19T12:00:00.000Z",
      }),
    ).toBe("Saved");
  });
});
