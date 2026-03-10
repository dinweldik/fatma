import { type ProjectBrowseDirectoryEntry } from "@fatma/contracts";

export function isHiddenProjectBrowserEntry(
  entry: Pick<ProjectBrowseDirectoryEntry, "name">,
): boolean {
  return entry.name.startsWith(".");
}

export function filterProjectBrowserEntries(
  entries: ReadonlyArray<ProjectBrowseDirectoryEntry>,
  input: { readonly showHidden: boolean },
): ReadonlyArray<ProjectBrowseDirectoryEntry> {
  if (input.showHidden) {
    return entries;
  }
  return entries.filter((entry) => !isHiddenProjectBrowserEntry(entry));
}
