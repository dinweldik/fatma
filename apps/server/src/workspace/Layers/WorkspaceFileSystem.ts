import { Effect, FileSystem, Layer, Path } from "effect";

import {
  WorkspaceFileSystem,
  WorkspaceFileSystemError,
  type WorkspaceFileSystemShape,
} from "../Services/WorkspaceFileSystem.ts";
import { WorkspaceEntries } from "../Services/WorkspaceEntries.ts";
import { WorkspacePaths } from "../Services/WorkspacePaths.ts";

const MAX_READABLE_FILE_BYTES = 1024 * 1024;

function toPosixRelativePath(input: string): string {
  return input.replaceAll("\\", "/");
}

function isValidDirectoryName(name: string): boolean {
  return name !== "." && name !== ".." && !/[\\/]/.test(name) && !name.includes("\u0000");
}

export const makeWorkspaceFileSystem = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const workspacePaths = yield* WorkspacePaths;
  const workspaceEntries = yield* WorkspaceEntries;

  const resolvePathWithinRoot = Effect.fn("WorkspaceFileSystem.resolvePathWithinRoot")(
    function* (input: { readonly rootPath: string; readonly targetPath?: string }) {
      const absoluteRootPath = yield* workspacePaths.normalizeWorkspaceRoot(input.rootPath).pipe(
        Effect.mapError(
          (cause) =>
            new WorkspaceFileSystemError({
              cwd: input.rootPath,
              operation: "workspaceFileSystem.resolveWorkspaceRoot",
              detail: cause.message,
              cause,
            }),
        ),
      );
      const normalizedTargetPath = input.targetPath?.trim();
      const absolutePath =
        normalizedTargetPath && normalizedTargetPath.length > 0
          ? path.isAbsolute(normalizedTargetPath)
            ? path.resolve(normalizedTargetPath)
            : path.resolve(absoluteRootPath, normalizedTargetPath)
          : absoluteRootPath;
      const relativePath = toPosixRelativePath(path.relative(absoluteRootPath, absolutePath));
      if (
        relativePath === ".." ||
        relativePath.startsWith("../") ||
        path.isAbsolute(relativePath)
      ) {
        return yield* new WorkspaceFileSystemError({
          cwd: absoluteRootPath,
          relativePath: normalizedTargetPath ?? "",
          operation: "workspaceFileSystem.resolvePathWithinRoot",
          detail: "Path must stay inside the workspace root.",
        });
      }

      return {
        absoluteRootPath,
        absolutePath,
        relativePath: relativePath === "." ? "" : relativePath,
      };
    },
  );

  const browseDirectory: WorkspaceFileSystemShape["browseDirectory"] = Effect.fn(
    "WorkspaceFileSystem.browseDirectory",
  )(function* (input) {
    const target = yield* resolvePathWithinRoot({
      rootPath: input.rootPath,
      ...(input.directoryPath !== undefined ? { targetPath: input.directoryPath } : {}),
    });
    const directoryInfo = yield* fileSystem.stat(target.absolutePath).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceFileSystemError({
            cwd: target.absoluteRootPath,
            relativePath: target.relativePath,
            operation: "workspaceFileSystem.statDirectory",
            detail: cause.message,
            cause,
          }),
      ),
    );
    if (directoryInfo.type !== "Directory") {
      return yield* new WorkspaceFileSystemError({
        cwd: target.absoluteRootPath,
        relativePath: target.relativePath,
        operation: "workspaceFileSystem.browseDirectory",
        detail: "Selected path is not a directory.",
      });
    }

    const rawEntries = yield* fileSystem
      .readDirectory(target.absolutePath, { recursive: false })
      .pipe(
        Effect.mapError(
          (cause) =>
            new WorkspaceFileSystemError({
              cwd: target.absoluteRootPath,
              relativePath: target.relativePath,
              operation: "workspaceFileSystem.readDirectory",
              detail: cause.message,
              cause,
            }),
        ),
      );

    const entries = yield* Effect.forEach(
      rawEntries,
      (entry) =>
        Effect.gen(function* () {
          const normalizedName = entry.replace(/^[/\\]+/, "").replace(/\\/g, "/");
          if (
            normalizedName.length === 0 ||
            normalizedName.includes("/") ||
            normalizedName === "." ||
            normalizedName === ".."
          ) {
            return null;
          }

          const absoluteEntryPath = path.join(target.absolutePath, normalizedName);
          const entryInfo = yield* fileSystem
            .stat(absoluteEntryPath)
            .pipe(Effect.catch(() => Effect.succeed(null)));
          if (!entryInfo) {
            return null;
          }
          if (entryInfo.type === "Directory") {
            return {
              name: normalizedName,
              path: absoluteEntryPath,
              kind: "directory" as const,
            };
          }
          if (entryInfo.type === "File") {
            return {
              name: normalizedName,
              path: absoluteEntryPath,
              kind: "file" as const,
            };
          }
          return null;
        }),
      { concurrency: 8 },
    ).pipe(Effect.map((items) => items.filter((entry) => entry !== null)));

    return {
      rootPath: target.absoluteRootPath,
      directoryPath: target.absolutePath,
      parentPath: target.relativePath.length === 0 ? null : path.dirname(target.absolutePath),
      entries: entries.toSorted((left, right) => {
        if (left.kind !== right.kind) {
          return left.kind === "directory" ? -1 : 1;
        }
        return left.name.localeCompare(right.name);
      }),
    };
  });

  const createDirectory: WorkspaceFileSystemShape["createDirectory"] = Effect.fn(
    "WorkspaceFileSystem.createDirectory",
  )(function* (input) {
    if (!isValidDirectoryName(input.name)) {
      return yield* new WorkspaceFileSystemError({
        cwd: input.rootPath,
        relativePath: input.parentPath,
        operation: "workspaceFileSystem.createDirectory",
        detail: "Folder name cannot contain path separators.",
      });
    }

    const parent = yield* resolvePathWithinRoot({
      rootPath: input.rootPath,
      targetPath: input.parentPath,
    });
    const parentInfo = yield* fileSystem.stat(parent.absolutePath).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceFileSystemError({
            cwd: parent.absoluteRootPath,
            relativePath: parent.relativePath,
            operation: "workspaceFileSystem.statParentDirectory",
            detail: cause.message,
            cause,
          }),
      ),
    );
    if (parentInfo.type !== "Directory") {
      return yield* new WorkspaceFileSystemError({
        cwd: parent.absoluteRootPath,
        relativePath: parent.relativePath,
        operation: "workspaceFileSystem.createDirectory",
        detail: "Parent path is not a directory.",
      });
    }

    const target = yield* resolvePathWithinRoot({
      rootPath: input.rootPath,
      targetPath: path.join(parent.absolutePath, input.name),
    });
    yield* fileSystem.makeDirectory(target.absolutePath, { recursive: false }).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceFileSystemError({
            cwd: target.absoluteRootPath,
            relativePath: target.relativePath,
            operation: "workspaceFileSystem.makeDirectory",
            detail: cause.message,
            cause,
          }),
      ),
    );
    yield* workspaceEntries.invalidate(target.absoluteRootPath);
    return { path: target.absolutePath };
  });

  const readFile: WorkspaceFileSystemShape["readFile"] = Effect.fn("WorkspaceFileSystem.readFile")(
    function* (input) {
      const target = yield* resolvePathWithinRoot({
        rootPath: input.rootPath,
        ...(input.filePath !== undefined ? { targetPath: input.filePath } : {}),
      });
      const fileInfo = yield* fileSystem.stat(target.absolutePath).pipe(
        Effect.mapError(
          (cause) =>
            new WorkspaceFileSystemError({
              cwd: target.absoluteRootPath,
              relativePath: target.relativePath,
              operation: "workspaceFileSystem.statFile",
              detail: cause.message,
              cause,
            }),
        ),
      );
      if (fileInfo.type !== "File") {
        return yield* new WorkspaceFileSystemError({
          cwd: target.absoluteRootPath,
          relativePath: target.relativePath,
          operation: "workspaceFileSystem.readFile",
          detail: "Selected path is not a file.",
        });
      }

      const size = Number(fileInfo.size);
      if (size > MAX_READABLE_FILE_BYTES) {
        return {
          path: target.absolutePath,
          contents: "",
          size,
          isBinary: true,
        };
      }

      const contents = yield* fileSystem
        .readFileString(target.absolutePath)
        .pipe(Effect.catch(() => Effect.succeed(null)));
      if (contents === null) {
        return {
          path: target.absolutePath,
          contents: "",
          size,
          isBinary: true,
        };
      }

      const isBinary = contents.includes("\0");
      return {
        path: target.absolutePath,
        contents: isBinary ? "" : contents,
        size,
        isBinary,
      };
    },
  );

  const writeFile: WorkspaceFileSystemShape["writeFile"] = Effect.fn(
    "WorkspaceFileSystem.writeFile",
  )(function* (input) {
    const target = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
    });

    yield* fileSystem.makeDirectory(path.dirname(target.absolutePath), { recursive: true }).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceFileSystemError({
            cwd: input.cwd,
            relativePath: input.relativePath,
            operation: "workspaceFileSystem.makeDirectory",
            detail: cause.message,
            cause,
          }),
      ),
    );
    yield* fileSystem.writeFileString(target.absolutePath, input.contents).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceFileSystemError({
            cwd: input.cwd,
            relativePath: input.relativePath,
            operation: "workspaceFileSystem.writeFile",
            detail: cause.message,
            cause,
          }),
      ),
    );
    yield* workspaceEntries.invalidate(input.cwd);
    return { relativePath: target.relativePath };
  });
  return {
    browseDirectory,
    createDirectory,
    readFile,
    writeFile,
  } satisfies WorkspaceFileSystemShape;
});

export const WorkspaceFileSystemLive = Layer.effect(WorkspaceFileSystem, makeWorkspaceFileSystem);
