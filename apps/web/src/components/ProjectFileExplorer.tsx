import type { ProjectBrowseDirectoryEntry } from "@fatma/contracts";
import { useBlocker } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronRightIcon,
  EyeIcon,
  FileIcon,
  Loader2Icon,
  RefreshCwIcon,
  SquarePenIcon,
  XIcon,
} from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { filterProjectBrowserEntries, isHiddenProjectBrowserEntry } from "../projectBrowserEntries";
import { cn } from "../lib/utils";
import { useMobileViewport } from "../mobileViewport";
import { readNativeApi } from "../nativeApi";
import type { Project } from "../types";
import { getVscodeIconUrlForEntry } from "../vscode-icons";
import {
  editorStatusLabel,
  isEditorDirty,
  relativeWorkspacePath,
} from "./ProjectFileExplorer.logic";
import { Button } from "./ui/button";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileEntryIcon({
  entry,
  theme,
}: {
  entry: Pick<ProjectBrowseDirectoryEntry, "kind" | "name" | "path">;
  theme: "light" | "dark";
}) {
  const iconUrl = getVscodeIconUrlForEntry(entry.path, entry.kind, theme);
  return (
    <img
      alt=""
      className="size-4 shrink-0"
      src={iconUrl}
      onError={(event) => {
        event.currentTarget.style.display = "none";
      }}
    />
  );
}

interface FileViewerProps {
  filePath: string;
  rootPath: string;
  onBack: () => void;
}

function FileViewer({ filePath, rootPath, onBack }: FileViewerProps) {
  const mobileViewport = useMobileViewport();
  const fileQuery = useQuery({
    queryKey: ["projects", "read-file", rootPath, filePath],
    queryFn: async () => {
      const api = readNativeApi();
      if (!api) {
        throw new Error("API unavailable");
      }
      return api.projects.readFile({ rootPath, filePath });
    },
    retry: 1,
    staleTime: 30_000,
  });
  const [editMode, setEditMode] = useState(false);
  const [draftContents, setDraftContents] = useState("");
  const [savedContents, setSavedContents] = useState("");
  const [lastLoadedFilePath, setLastLoadedFilePath] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const [mobileEditorActionBarHeight, setMobileEditorActionBarHeight] = useState(0);
  const mobileEditorActionBarRef = useRef<HTMLDivElement | null>(null);
  const resolvingRouteBlockRef = useRef(false);

  const fileName = useMemo(() => {
    const parts = filePath.split("/");
    return parts[parts.length - 1] ?? filePath;
  }, [filePath]);
  const relativePath = useMemo(
    () => relativeWorkspacePath(rootPath, filePath),
    [filePath, rootPath],
  );
  const isBinary = fileQuery.data?.isBinary ?? false;
  const dirty = isEditorDirty(savedContents, draftContents);
  const statusLabel = editorStatusLabel({
    dirty,
    errorMessage: saveErrorMessage,
    isSaving,
    lastSavedAt,
  });
  const fileSizeLabel = fileQuery.data ? formatFileSize(fileQuery.data.size) : null;
  const routeBlocker = useBlocker({
    disabled: !dirty || isSaving,
    enableBeforeUnload: () => dirty && !isSaving,
    shouldBlockFn: () => dirty && !isSaving,
    withResolver: true,
  });
  const lines = useMemo(() => {
    if (!fileQuery.data?.contents) return [];
    return fileQuery.data.contents.split("\n");
  }, [fileQuery.data?.contents]);
  const lineNumberWidth = useMemo(() => Math.max(2, String(lines.length).length), [lines.length]);
  const editorLayoutStyle = useMemo(
    () =>
      ({
        "--app-project-file-editor-action-bar-height":
          mobileViewport.isMobile && editMode ? `${mobileEditorActionBarHeight}px` : "0px",
      }) as CSSProperties,
    [editMode, mobileEditorActionBarHeight, mobileViewport.isMobile],
  );

  useEffect(() => {
    if (!fileQuery.data || fileQuery.isError) {
      return;
    }

    if (lastLoadedFilePath !== filePath) {
      setLastLoadedFilePath(filePath);
      setSavedContents(fileQuery.data.contents);
      setDraftContents(fileQuery.data.contents);
      setEditMode(false);
      setLastSavedAt(null);
      setSaveErrorMessage(null);
      return;
    }

    if (!dirty && !isSaving && savedContents !== fileQuery.data.contents) {
      setSavedContents(fileQuery.data.contents);
      setDraftContents(fileQuery.data.contents);
      setSaveErrorMessage(null);
    }
  }, [
    dirty,
    filePath,
    fileQuery.data,
    fileQuery.isError,
    isSaving,
    lastLoadedFilePath,
    savedContents,
  ]);

  const confirmDiscardChanges = useCallback(async () => {
    if (!dirty || isSaving) {
      return true;
    }
    const api = readNativeApi();
    if (!api) {
      return window.confirm("Discard unsaved file changes?");
    }
    return api.dialogs.confirm(
      ["Discard unsaved changes?", "Your edits to this file have not been saved yet."].join("\n"),
    );
  }, [dirty, isSaving]);

  useEffect(() => {
    if (routeBlocker.status !== "blocked" || resolvingRouteBlockRef.current) {
      return;
    }

    let disposed = false;
    resolvingRouteBlockRef.current = true;

    void confirmDiscardChanges()
      .then((allowNavigation) => {
        if (disposed) {
          return;
        }
        if (allowNavigation) {
          routeBlocker.proceed();
          return;
        }
        routeBlocker.reset();
      })
      .finally(() => {
        if (!disposed) {
          resolvingRouteBlockRef.current = false;
        }
      });

    return () => {
      disposed = true;
      resolvingRouteBlockRef.current = false;
    };
  }, [confirmDiscardChanges, routeBlocker]);

  const handleBack = useCallback(async () => {
    const allowNavigation = await confirmDiscardChanges();
    if (!allowNavigation) {
      return;
    }
    onBack();
  }, [confirmDiscardChanges, onBack]);

  const handleCancelEdit = useCallback(async () => {
    if (!(await confirmDiscardChanges())) {
      return;
    }
    setDraftContents(savedContents);
    setSaveErrorMessage(null);
    setEditMode(false);
  }, [confirmDiscardChanges, savedContents]);

  const handleSave = useCallback(async () => {
    if (isBinary || !dirty || isSaving) {
      return;
    }

    const api = readNativeApi();
    if (!api) {
      setSaveErrorMessage("API unavailable");
      return;
    }

    setIsSaving(true);
    setSaveErrorMessage(null);
    try {
      await api.projects.writeFile({
        cwd: rootPath,
        relativePath,
        contents: draftContents,
      });
      setSavedContents(draftContents);
      setLastSavedAt(new Date().toISOString());
      setSaveErrorMessage(null);
    } catch (error) {
      setSaveErrorMessage(error instanceof Error ? error.message : "Failed to save file");
    } finally {
      setIsSaving(false);
    }
  }, [dirty, draftContents, isBinary, isSaving, relativePath, rootPath]);

  const editorChromePadding = mobileViewport.isMobile
    ? "pb-[calc(var(--safe-area-inset-bottom)+var(--app-mobile-bottom-nav-height,0px)+var(--app-mobile-keyboard-inset,0px)+var(--app-project-file-editor-action-bar-height,0px)+1rem)]"
    : "pb-4";

  useEffect(() => {
    if (
      !mobileViewport.isMobile ||
      !editMode ||
      isBinary ||
      fileQuery.isLoading ||
      fileQuery.isError
    ) {
      setMobileEditorActionBarHeight(0);
      return;
    }

    const element = mobileEditorActionBarRef.current;
    if (!element) {
      return;
    }

    let frameId: number | null = null;
    const publishHeight = () => {
      frameId = null;
      setMobileEditorActionBarHeight(
        Math.max(0, Math.round(element.getBoundingClientRect().height)),
      );
    };
    const scheduleHeightPublish = () => {
      if (frameId !== null) {
        return;
      }
      frameId = window.requestAnimationFrame(publishHeight);
    };
    const observer = new ResizeObserver(scheduleHeightPublish);

    observer.observe(element);
    scheduleHeightPublish();

    return () => {
      observer.disconnect();
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      setMobileEditorActionBarHeight(0);
    };
  }, [editMode, fileQuery.isError, fileQuery.isLoading, isBinary, mobileViewport.isMobile]);

  return (
    <div className="flex h-full min-h-0 flex-col" style={editorLayoutStyle}>
      <header className="flex shrink-0 items-center gap-2 border-b border-border/70 px-3 py-2.5">
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Back to files"
          onClick={() => void handleBack()}
        >
          <ArrowLeftIcon className="size-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{fileName}</p>
          <p className="truncate text-[11px] text-muted-foreground">{relativePath}</p>
        </div>
        {fileQuery.data ? (
          <div className="hidden shrink-0 items-center gap-2 text-[11px] text-muted-foreground sm:flex">
            <span>{formatFileSize(fileQuery.data.size)}</span>
            {isBinary ? null : <span>{statusLabel}</span>}
          </div>
        ) : null}
        {!isBinary && !fileQuery.isLoading && !fileQuery.isError ? (
          editMode ? (
            !mobileViewport.isMobile ? (
              <div className="flex shrink-0 items-center gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-none before:rounded-none"
                  disabled={isSaving}
                  onClick={() => {
                    void handleCancelEdit();
                  }}
                >
                  <XIcon className="size-3.5" />
                  <span className="hidden sm:inline">Cancel</span>
                </Button>
                <Button
                  size="sm"
                  className="rounded-none before:rounded-none"
                  disabled={!dirty || isSaving}
                  onClick={() => {
                    void handleSave();
                  }}
                >
                  {isSaving ? (
                    <Loader2Icon className="size-3.5 animate-spin" />
                  ) : (
                    <CheckIcon className="size-3.5" />
                  )}
                  <span className="hidden sm:inline">{isSaving ? "Saving" : "Save"}</span>
                </Button>
              </div>
            ) : null
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="rounded-none before:rounded-none"
              onClick={() => {
                setEditMode(true);
                setSaveErrorMessage(null);
              }}
            >
              <SquarePenIcon className="size-3.5" />
              <span className="hidden sm:inline">Edit</span>
            </Button>
          )
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {fileQuery.isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : fileQuery.isError ? (
          <div className="px-4 py-8 text-center text-sm text-destructive-foreground">
            {fileQuery.error instanceof Error ? fileQuery.error.message : "Failed to read file"}
          </div>
        ) : fileQuery.data?.isBinary ? (
          <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
            <FileIcon className="size-10 text-muted-foreground/40" />
            <p className="mt-3 text-sm font-medium">Binary file</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatFileSize(fileQuery.data.size)} - binary files stay read-only in the web editor
            </p>
          </div>
        ) : editMode ? (
          <div className={cn("flex min-h-full flex-col px-3 pt-3", editorChromePadding)}>
            <div className="mb-2 flex items-center justify-between gap-3 text-[11px]">
              <span
                className={cn(
                  "truncate",
                  saveErrorMessage ? "text-destructive-foreground" : "text-muted-foreground",
                )}
              >
                {statusLabel}
              </span>
              <span className="shrink-0 text-muted-foreground">{fileSizeLabel}</span>
            </div>
            <textarea
              aria-label={`Editing ${relativePath}`}
              autoCapitalize="off"
              autoCorrect="off"
              className={cn(
                "min-h-[min(22rem,60vh)] flex-1 resize-none rounded-none border border-border/70 bg-background px-3 py-3 font-mono text-foreground shadow-sm outline-hidden transition-colors focus:border-ring focus:ring-1 focus:ring-ring",
                mobileViewport.isMobile
                  ? "text-[13px] leading-[1.55]"
                  : "text-[13px] leading-[1.6]",
              )}
              spellCheck={false}
              value={draftContents}
              onChange={(event) => {
                setDraftContents(event.target.value);
                if (saveErrorMessage) {
                  setSaveErrorMessage(null);
                }
              }}
            />
          </div>
        ) : (
          <div
            className={cn(
              "overflow-x-auto font-mono text-foreground",
              mobileViewport.isMobile ? "text-[13px] leading-[1.55]" : "text-[13px] leading-[1.6]",
            )}
          >
            <table className="w-full border-collapse">
              <tbody>
                {lines.map((line, lineIndex) => {
                  const lineNumber = lineIndex + 1;
                  const rowKey = line.length > 0 ? `${lineNumber}:${line}` : `blank:${lineNumber}`;
                  return (
                    <tr key={rowKey} className="transition-colors duration-75 hover:bg-accent/30">
                      <td className="sticky left-0 select-none whitespace-nowrap border-r border-border/40 bg-background/90 px-2.5 py-0 text-right text-muted-foreground/50 backdrop-blur-sm">
                        {String(lineNumber).padStart(lineNumberWidth)}
                      </td>
                      <td className="whitespace-pre-wrap break-all px-3 py-0">
                        {line || "\u00A0"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editMode &&
      mobileViewport.isMobile &&
      !fileQuery.isLoading &&
      !fileQuery.isError &&
      !isBinary ? (
        <div
          ref={mobileEditorActionBarRef}
          data-file-editor-action-bar="true"
          className="fixed inset-x-0 z-30 border-t border-border/70 bg-background/96 px-3 pt-2.5 pb-[calc(var(--safe-area-inset-bottom)+0.85rem)] shadow-[0_-18px_40px_rgba(0,0,0,0.18)] backdrop-blur-xl"
          style={{
            bottom:
              "calc(var(--app-mobile-bottom-nav-height, 0px) + var(--app-mobile-keyboard-inset, 0px))",
          }}
        >
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-2">
            <div className="flex items-center justify-between gap-3 text-[11px]">
              <span
                className={cn(
                  "truncate",
                  saveErrorMessage ? "text-destructive-foreground" : "text-muted-foreground",
                )}
              >
                {statusLabel}
              </span>
              <span className="shrink-0 text-muted-foreground">{fileSizeLabel}</span>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="rounded-none before:rounded-none"
                disabled={isSaving}
                onClick={() => {
                  void handleCancelEdit();
                }}
              >
                <XIcon className="size-3.5" />
                <span>Cancel</span>
              </Button>
              <Button
                size="sm"
                className="flex-1 rounded-none before:rounded-none"
                disabled={!dirty || isSaving}
                onClick={() => {
                  void handleSave();
                }}
              >
                {isSaving ? (
                  <Loader2Icon className="size-3.5 animate-spin" />
                ) : (
                  <CheckIcon className="size-3.5" />
                )}
                <span>{isSaving ? "Saving" : "Save"}</span>
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function ProjectFileExplorer({ project }: { project: Project }) {
  const mobileViewport = useMobileViewport();
  const [currentPath, setCurrentPath] = useState<string>(project.cwd);
  const [showHidden, setShowHidden] = useState(false);
  const [viewingFile, setViewingFile] = useState<string | null>(null);

  const theme: "light" | "dark" = useMemo(() => {
    if (typeof document === "undefined") return "dark";
    return document.documentElement.classList.contains("dark") ? "dark" : "light";
  }, []);

  const directoryQuery = useQuery({
    queryKey: ["projects", "browse-directory", project.cwd, currentPath],
    queryFn: async () => {
      const api = readNativeApi();
      if (!api) {
        throw new Error("API unavailable");
      }
      return api.projects.browseDirectory({
        rootPath: project.cwd,
        directoryPath: currentPath,
      });
    },
  });

  const entries = useMemo(() => {
    if (!directoryQuery.data?.entries) return [];
    return filterProjectBrowserEntries(directoryQuery.data.entries, { showHidden });
  }, [directoryQuery.data?.entries, showHidden]);

  const hiddenCount = useMemo(() => {
    if (!directoryQuery.data?.entries) return 0;
    return directoryQuery.data.entries.filter((entry) => isHiddenProjectBrowserEntry(entry)).length;
  }, [directoryQuery.data?.entries]);

  const relativePath = useMemo(() => {
    if (currentPath === project.cwd) return "/";
    if (currentPath.startsWith(project.cwd)) {
      return currentPath.slice(project.cwd.length) || "/";
    }
    return currentPath;
  }, [currentPath, project.cwd]);

  const navigateToDirectory = useCallback((path: string) => {
    setCurrentPath(path);
    setViewingFile(null);
  }, []);

  const navigateUp = useCallback(() => {
    if (directoryQuery.data?.parentPath) {
      setCurrentPath(directoryQuery.data.parentPath);
      setViewingFile(null);
    }
  }, [directoryQuery.data?.parentPath]);

  const handleEntryClick = useCallback(
    (entry: ProjectBrowseDirectoryEntry) => {
      if (entry.kind === "directory") {
        navigateToDirectory(entry.path);
      } else {
        setViewingFile(entry.path);
      }
    },
    [navigateToDirectory],
  );

  if (viewingFile) {
    return (
      <FileViewer
        filePath={viewingFile}
        rootPath={project.cwd}
        onBack={() => setViewingFile(null)}
      />
    );
  }

  const canGoUp =
    directoryQuery.data?.parentPath !== null && directoryQuery.data?.parentPath !== undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-border/70 px-3 py-3">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold tracking-[0.2em] text-muted-foreground/60 uppercase">
              Files
            </p>
            <div className="mt-1 flex items-center gap-2">
              <h1
                className={cn(
                  "truncate font-semibold",
                  mobileViewport.isMobile ? "text-base" : "text-sm",
                )}
              >
                {project.name}
              </h1>
            </div>
            <p className="truncate text-xs text-muted-foreground/70">{relativePath}</p>
          </div>
          <div className="flex items-center gap-1.5">
            {hiddenCount > 0 ? (
              <Button
                size="xs"
                variant={showHidden ? "secondary" : "outline"}
                className="rounded-none before:rounded-none"
                onClick={() => setShowHidden(!showHidden)}
              >
                <EyeIcon className="size-3.5" />
                <span className="text-[11px]">{hiddenCount}</span>
              </Button>
            ) : null}
            <Button
              size="icon-sm"
              variant="outline"
              className="rounded-none before:rounded-none"
              aria-label="Refresh"
              onClick={() => {
                void directoryQuery.refetch();
              }}
            >
              <RefreshCwIcon className="size-3.5" />
            </Button>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {directoryQuery.isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : directoryQuery.isError ? (
          <div className="px-4 py-8 text-center text-sm text-destructive-foreground">
            {directoryQuery.error instanceof Error
              ? directoryQuery.error.message
              : "Failed to load directory"}
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {canGoUp ? (
              <button
                type="button"
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent/40 active:bg-accent/60"
                onClick={navigateUp}
              >
                <ArrowLeftIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">..</span>
              </button>
            ) : null}

            {entries.map((entry) => (
              <button
                key={entry.path}
                type="button"
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent/40 active:bg-accent/60",
                  isHiddenProjectBrowserEntry(entry) && "opacity-50",
                )}
                onClick={() => handleEntryClick(entry)}
              >
                <FileEntryIcon entry={entry} theme={theme} />
                <span className="min-w-0 flex-1 truncate text-sm">{entry.name}</span>
                {entry.kind === "directory" ? (
                  <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/50" />
                ) : null}
              </button>
            ))}

            {entries.length === 0 && !canGoUp ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                This directory is empty.
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
