import type { ProjectBrowseDirectoryEntry } from "@fatma/contracts";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  EyeIcon,
  FileIcon,
  Loader2Icon,
  RefreshCwIcon,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import {
  filterProjectBrowserEntries,
  isHiddenProjectBrowserEntry,
} from "../projectBrowserEntries";
import { cn } from "../lib/utils";
import { useMobileViewport } from "../mobileViewport";
import { readNativeApi } from "../nativeApi";
import type { Project } from "../types";
import { getVscodeIconUrlForEntry } from "../vscode-icons";
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

  const fileName = useMemo(() => {
    const parts = filePath.split("/");
    return parts[parts.length - 1] ?? filePath;
  }, [filePath]);

  const relativePath = useMemo(() => {
    if (filePath.startsWith(rootPath)) {
      return filePath.slice(rootPath.length).replace(/^\//, "");
    }
    return filePath;
  }, [filePath, rootPath]);

  const lines = useMemo(() => {
    if (!fileQuery.data?.contents) return [];
    return fileQuery.data.contents.split("\n");
  }, [fileQuery.data?.contents]);

  const lineNumberWidth = useMemo(() => {
    return Math.max(2, String(lines.length).length);
  }, [lines.length]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <header className="flex shrink-0 items-center gap-2 border-b border-border/70 px-3 py-2.5">
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Back to files"
          onClick={onBack}
        >
          <ArrowLeftIcon className="size-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{fileName}</p>
          <p className="truncate text-[11px] text-muted-foreground">{relativePath}</p>
        </div>
        {fileQuery.data && !fileQuery.data.isBinary ? (
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {formatFileSize(fileQuery.data.size)} · {lines.length} lines
          </span>
        ) : null}
      </header>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-auto">
        {fileQuery.isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : fileQuery.isError ? (
          <div className="px-4 py-8 text-center text-sm text-destructive-foreground">
            {fileQuery.error instanceof Error
              ? fileQuery.error.message
              : "Failed to read file"}
          </div>
        ) : fileQuery.data?.isBinary ? (
          <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
            <FileIcon className="size-10 text-muted-foreground/40" />
            <p className="mt-3 text-sm font-medium">Binary file</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatFileSize(fileQuery.data.size)} — cannot display binary content
            </p>
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
                {lines.map((line, index) => (
                  <tr
                    key={index}
                    className="hover:bg-accent/30 transition-colors duration-75"
                  >
                    <td className="sticky left-0 select-none whitespace-nowrap border-r border-border/40 bg-background/90 px-2.5 py-0 text-right text-muted-foreground/50 backdrop-blur-sm">
                      {String(index + 1).padStart(lineNumberWidth)}
                    </td>
                    <td className="whitespace-pre-wrap break-all px-3 py-0">
                      {line || "\u00A0"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
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
    return directoryQuery.data.entries.filter((entry) =>
      isHiddenProjectBrowserEntry(entry),
    ).length;
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
    directoryQuery.data?.parentPath !== null &&
    directoryQuery.data?.parentPath !== undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
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
            <p className="truncate text-xs text-muted-foreground/70">
              {relativePath}
            </p>
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

      {/* File list */}
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
            {/* Parent directory link */}
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

            {/* Entries */}
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
