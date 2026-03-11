import { describe, expect, it } from "vitest";

import { filterProjectBrowserEntries, isHiddenProjectBrowserEntry } from "./projectBrowserEntries";

describe("isHiddenProjectBrowserEntry", () => {
  it("treats dot-prefixed entries as hidden", () => {
    expect(isHiddenProjectBrowserEntry({ name: ".git" })).toBe(true);
    expect(isHiddenProjectBrowserEntry({ name: ".env" })).toBe(true);
  });

  it("leaves regular entries visible", () => {
    expect(isHiddenProjectBrowserEntry({ name: "src" })).toBe(false);
    expect(isHiddenProjectBrowserEntry({ name: "package.json" })).toBe(false);
  });
});

describe("filterProjectBrowserEntries", () => {
  const entries = [
    { name: ".git", path: "/tmp/project/.git", kind: "directory" as const },
    { name: "src", path: "/tmp/project/src", kind: "directory" as const },
    { name: ".env", path: "/tmp/project/.env", kind: "file" as const },
    { name: "package.json", path: "/tmp/project/package.json", kind: "file" as const },
  ] as const;

  it("hides hidden entries by default", () => {
    expect(filterProjectBrowserEntries(entries, { showHidden: false })).toEqual([
      entries[1],
      entries[3],
    ]);
  });

  it("returns all entries when hidden entries are enabled", () => {
    expect(filterProjectBrowserEntries(entries, { showHidden: true })).toEqual(entries);
  });
});
