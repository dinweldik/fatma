export function relativeWorkspacePath(rootPath: string, filePath: string): string {
  if (filePath.startsWith(rootPath)) {
    return filePath.slice(rootPath.length).replace(/^\/+/, "");
  }
  return filePath.replace(/^\/+/, "");
}

export function isEditorDirty(savedContents: string, draftContents: string): boolean {
  return savedContents !== draftContents;
}

export function editorStatusLabel(input: {
  dirty: boolean;
  errorMessage: string | null;
  isSaving: boolean;
  lastSavedAt: string | null;
}): string {
  if (input.isSaving) {
    return "Saving...";
  }
  if (input.errorMessage) {
    return input.errorMessage;
  }
  if (input.dirty) {
    return "Unsaved changes";
  }
  if (input.lastSavedAt) {
    return "Saved";
  }
  return "Read only";
}
