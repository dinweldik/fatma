import { FileDiff } from "@pierre/diffs/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  GitFileChangeStatus,
  GitFileDiffScope,
  GitReadWorkingTreeFileDiffResult,
  GitStatusResult,
} from "@fatma/contracts";
import { CheckIcon, ChevronDownIcon, FileIcon, FolderIcon } from "lucide-react";
import {
  type ComponentProps,
  type ReactNode,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useTheme } from "../hooks/useTheme";
import { useMediaQuery } from "../hooks/useMediaQuery";
import {
  gitBranchesQueryOptions,
  gitCommitMutationOptions,
  gitInitMutationOptions,
  gitPullMutationOptions,
  gitPushMutationOptions,
  gitStageFilesMutationOptions,
  gitStatusQueryOptions,
  gitUnstageFilesMutationOptions,
  gitWorkingTreeFileDiffQueryOptions,
} from "../lib/gitReactQuery";
import { resolveDiffThemeName } from "../lib/diffRendering";
import {
  buildFileDiffRenderKey,
  DIFF_SURFACE_UNSAFE_CSS,
  getRenderablePatch,
} from "../lib/diffPatch";
import { cn } from "../lib/utils";
import { basenameOfPath, getVscodeIconUrlForEntry } from "../vscode-icons";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "./ui/popover";
import { Sheet, SheetPopup, SheetTrigger } from "./ui/sheet";
import { toastManager } from "./ui/toast";

interface GitActionsControlProps {
  gitCwd: string | null;
  projectName?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  presentation?: "overlay" | "inline";
  triggerAriaLabel?: string;
  triggerClassName?: string;
  triggerContent?: ReactNode;
  triggerSize?: ComponentProps<typeof Button>["size"];
  triggerVariant?: ComponentProps<typeof Button>["variant"];
}

type ChangeScope = Extract<GitFileDiffScope, "staged" | "unstaged">;
type SelectedFileTarget = { path: string; scope: ChangeScope };
type GitChangedFile = GitStatusResult["workingTree"]["files"][number];
const EMPTY_GIT_FILES: readonly GitChangedFile[] = [];

function dirnameOfPath(pathValue: string): string | null {
  const lastSlashIndex = Math.max(pathValue.lastIndexOf("/"), pathValue.lastIndexOf("\\"));
  if (lastSlashIndex <= 0) {
    return null;
  }
  return pathValue.slice(0, lastSlashIndex);
}

function resolveRepositoryLabel(gitCwd: string, projectName?: string): string {
  if (projectName && projectName.trim().length > 0) {
    return projectName;
  }
  return basenameOfPath(gitCwd.replace(/[/\\]+$/, ""));
}

function statusLetter(status: GitFileChangeStatus): string {
  if (status === "added") return "A";
  if (status === "deleted") return "D";
  if (status === "renamed") return "R";
  if (status === "copied") return "C";
  if (status === "untracked") return "U";
  if (status === "type_changed") return "T";
  if (status === "unmerged") return "!";
  return "M";
}

function statusClassName(status: GitFileChangeStatus): string {
  if (status === "added" || status === "untracked") {
    return "text-emerald-600 dark:text-emerald-300/90";
  }
  if (status === "deleted") {
    return "text-red-600 dark:text-red-300/90";
  }
  if (status === "renamed" || status === "copied") {
    return "text-sky-600 dark:text-sky-300/90";
  }
  if (status === "unmerged") {
    return "text-amber-600 dark:text-amber-300/90";
  }
  return "text-amber-700 dark:text-amber-200/90";
}

function statusLabel(status: GitFileChangeStatus): string {
  if (status === "added") return "Added";
  if (status === "deleted") return "Deleted";
  if (status === "renamed") return "Renamed";
  if (status === "copied") return "Copied";
  if (status === "untracked") return "Untracked";
  if (status === "type_changed") return "Type changed";
  if (status === "unmerged") return "Unmerged";
  return "Modified";
}

function scopeLabel(scope: ChangeScope): string {
  return scope === "staged" ? "Staged" : "Changes";
}

function commitShortcutLabel(): string {
  if (typeof navigator !== "undefined" && /Mac/i.test(navigator.platform)) {
    return "Cmd+Enter";
  }
  return "Ctrl+Enter";
}

function BranchDelta({
  aheadCount,
  behindCount,
}: {
  aheadCount: number;
  behindCount: number;
}) {
  if (aheadCount <= 0 && behindCount <= 0) {
    return <span className="text-muted-foreground/70">In sync</span>;
  }

  return (
    <>
      {behindCount > 0 && <span className="text-muted-foreground">-{behindCount}</span>}
      {aheadCount > 0 && <span className="text-foreground">+{aheadCount}</span>}
    </>
  );
}

function ChangeSection({
  title,
  emptyLabel,
  files,
  insertions,
  deletions,
  scope,
  selectedTarget,
  onSelectFile,
  actionLabel,
  actionPending,
  allActionLabel,
  onActionAll,
  onActionFile,
  resolvedTheme,
}: {
  title: string;
  emptyLabel: string;
  files: ReadonlyArray<GitChangedFile>;
  insertions: number;
  deletions: number;
  scope: ChangeScope;
  selectedTarget: SelectedFileTarget | null;
  onSelectFile: (target: SelectedFileTarget) => void;
  actionLabel: string;
  actionPending: boolean;
  allActionLabel: string;
  onActionAll: () => void;
  onActionFile: (path: string) => void;
  resolvedTheme: "light" | "dark";
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <p className="text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            {title}
          </p>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {files.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="xs"
            variant="ghost"
            disabled={files.length === 0 || actionPending}
            onClick={onActionAll}
          >
            {allActionLabel}
          </Button>
          <span className="font-mono text-[11px] text-emerald-600 dark:text-emerald-300/90">
            +{insertions}
          </span>
          <span className="font-mono text-[11px] text-red-600 dark:text-red-300/90">
            -{deletions}
          </span>
        </div>
      </div>

      {files.length === 0 ? (
        <div className="rounded-xl border border-border/70 bg-background/70 px-4 py-5 text-sm text-muted-foreground">
          {emptyLabel}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/70 bg-background/70">
          <div className="max-h-64 overflow-y-auto p-1">
            {files.map((file) => {
              const selected =
                selectedTarget?.scope === scope && selectedTarget.path === file.path;
              const iconUrl = getVscodeIconUrlForEntry(file.path, "file", resolvedTheme);
              const directory = dirnameOfPath(file.path);

              return (
                <div
                  key={`${scope}:${file.path}`}
                  className={cn(
                    "flex items-center gap-2 rounded-lg pr-2 transition-colors",
                    selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
                  )}
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center justify-between gap-3 px-3 py-2.5 text-left"
                    onClick={() => onSelectFile({ path: file.path, scope })}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <img src={iconUrl} alt="" className="size-4 shrink-0" loading="lazy" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{basenameOfPath(file.path)}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {directory ?? statusLabel(file.status)}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span
                        className={cn(
                          "w-4 text-center font-semibold text-xs",
                          statusClassName(file.status),
                        )}
                      >
                        {statusLetter(file.status)}
                      </span>
                      <span className="min-w-18 text-right font-mono text-[11px] text-muted-foreground">
                        <span className="text-emerald-600 dark:text-emerald-300/90">
                          +{file.insertions}
                        </span>
                        <span className="mx-1 text-muted-foreground/60">/</span>
                        <span className="text-red-600 dark:text-red-300/90">
                          -{file.deletions}
                        </span>
                      </span>
                    </div>
                  </button>
                  <Button
                    size="xs"
                    variant={selected ? "secondary" : "ghost"}
                    disabled={actionPending}
                    onClick={() => onActionFile(file.path)}
                  >
                    {actionLabel}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

function SourceControlPanel({
  gitCwd,
  projectName,
  isMobileLayout,
  isRepo,
  isLoadingRepoState,
  isLoadingStatus,
  initPending,
  onInitializeGit,
  branchListError,
  gitStatus,
  gitStatusError,
  commitMessage,
  onCommitMessageChange,
  commitPending,
  pullPending,
  pushPending,
  onCommit,
  onPull,
  onPush,
  stagePending,
  unstagePending,
  onStageAll,
  onStageFile,
  onUnstageAll,
  onUnstageFile,
  resolvedTheme,
  selectedTarget,
  onSelectFile,
  selectedFileDiffQuery,
}: {
  gitCwd: string;
  projectName?: string;
  isMobileLayout: boolean;
  isRepo: boolean | null;
  isLoadingRepoState: boolean;
  isLoadingStatus: boolean;
  initPending: boolean;
  onInitializeGit: () => void;
  branchListError: string | null;
  gitStatus: GitStatusResult | null;
  gitStatusError: string | null;
  commitMessage: string;
  onCommitMessageChange: (value: string) => void;
  commitPending: boolean;
  pullPending: boolean;
  pushPending: boolean;
  onCommit: () => void;
  onPull: () => void;
  onPush: () => void;
  stagePending: boolean;
  unstagePending: boolean;
  onStageAll: () => void;
  onStageFile: (path: string) => void;
  onUnstageAll: () => void;
  onUnstageFile: (path: string) => void;
  resolvedTheme: "light" | "dark";
  selectedTarget: SelectedFileTarget | null;
  onSelectFile: (target: SelectedFileTarget) => void;
  selectedFileDiffQuery: {
    data: GitReadWorkingTreeFileDiffResult | undefined;
    error: unknown;
    isLoading: boolean;
    isFetching: boolean;
  };
}) {
  const deferredPatch = useDeferredValue(selectedFileDiffQuery.data?.diff);
  const repositoryLabel = resolveRepositoryLabel(gitCwd, projectName);
  const stagedFiles = gitStatus?.staged?.files ?? EMPTY_GIT_FILES;
  const unstagedFiles =
    gitStatus?.unstaged?.files ?? gitStatus?.workingTree.files ?? EMPTY_GIT_FILES;
  const selectedRenderablePatch = useMemo(
    () =>
      getRenderablePatch(
        deferredPatch,
        `working-tree:${gitCwd}:${selectedTarget?.scope ?? "none"}:${selectedTarget?.path ?? "none"}:${resolvedTheme}`,
      ),
    [deferredPatch, gitCwd, resolvedTheme, selectedTarget?.path, selectedTarget?.scope],
  );
  const selectedFiles = useMemo(
    () => (selectedRenderablePatch?.kind === "files" ? selectedRenderablePatch.files : []),
    [selectedRenderablePatch],
  );
  const selectedFile = useMemo(() => {
    if (!selectedTarget) {
      return null;
    }
    const files = selectedTarget.scope === "staged" ? stagedFiles : unstagedFiles;
    return files.find((file) => file.path === selectedTarget.path) ?? null;
  }, [selectedTarget, stagedFiles, unstagedFiles]);
  const selectedFileDiffError =
    selectedFileDiffQuery.error instanceof Error
      ? selectedFileDiffQuery.error.message
      : selectedFileDiffQuery.error
        ? "Unable to load file diff."
        : null;
  const trimmedCommitMessage = commitMessage.trim();
  const commitDisabled =
    stagedFiles.length === 0 ||
    trimmedCommitMessage.length === 0 ||
    commitPending ||
    stagePending ||
    unstagePending;
  const pullDisabled =
    !gitStatus?.branch ||
    !gitStatus.hasUpstream ||
    pullPending ||
    pushPending ||
    commitPending ||
    stagePending ||
    unstagePending;
  const pushDisabled =
    !gitStatus?.branch || pushPending || commitPending || stagePending || unstagePending;
  const remoteUrl = gitStatus?.remoteUrl?.trim() ? gitStatus.remoteUrl : "No origin remote configured";

  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 w-full flex-col gap-4",
        !isMobileLayout && "max-h-[min(82vh,56rem)]",
      )}
    >
      <div className="space-y-1">
        <p className="text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
          Source Control
        </p>
        <p className="text-sm text-muted-foreground">
          Stage files, commit changes, fetch and pull the current branch, and inspect diffs inline.
        </p>
      </div>

      {isLoadingRepoState ? (
        <div className="rounded-xl border border-border/70 bg-background/70 px-4 py-5 text-sm text-muted-foreground">
          Loading repository status...
        </div>
      ) : isRepo === false ? (
        <div className="rounded-xl border border-border/70 bg-background/70 p-4">
          <div className="space-y-2">
            <p className="font-medium text-foreground">This project is not a git repository.</p>
            <p className="text-sm text-muted-foreground">
              Initialize git here to start tracking changes from the source control panel.
            </p>
            <Button size="sm" variant="outline" disabled={initPending} onClick={onInitializeGit}>
              {initPending ? "Initializing..." : "Initialize Git"}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
                Repositories
              </p>
              {gitStatus ? (
                <div className="flex items-center gap-2 font-mono text-[11px]">
                  <BranchDelta aheadCount={gitStatus.aheadCount} behindCount={gitStatus.behindCount} />
                </div>
              ) : null}
            </div>
            <div className="rounded-xl border border-border/70 bg-background/70 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-card">
                    <FolderIcon className="size-4 text-foreground/80" />
                  </div>
                  <div className="min-w-0 space-y-0.5">
                    <p className="truncate font-medium text-foreground">{repositoryLabel}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {gitStatus?.branch ?? "Detached HEAD"}
                      {gitStatus?.hasWorkingTreeChanges ? " *" : ""}
                    </p>
                    <p className="truncate font-mono text-[11px] text-muted-foreground/80">
                      {remoteUrl}
                    </p>
                  </div>
                </div>
                {gitStatus?.pr ? (
                  <span className="rounded-full border border-border/70 bg-card px-2 py-0.5 text-[11px] text-muted-foreground">
                    PR {gitStatus.pr.state}
                  </span>
                ) : null}
              </div>
            </div>
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
                Commit
              </p>
              <span className="font-mono text-[11px] text-muted-foreground/70">
                {commitShortcutLabel()}
              </span>
            </div>
            <div className="space-y-3 rounded-xl border border-border/70 bg-background/70 p-3">
              <Input
                aria-label="Commit message"
                autoComplete="off"
                placeholder={`Message (${commitShortcutLabel()} to commit on "${repositoryLabel}")`}
                value={commitMessage}
                onChange={(event) => onCommitMessageChange(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !commitDisabled) {
                    event.preventDefault();
                    onCommit();
                  }
                }}
              />
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                <Button disabled={commitDisabled} onClick={onCommit}>
                  <CheckIcon className="size-4" />
                  {commitPending ? "Committing..." : "Commit"}
                </Button>
                <Button variant="outline" disabled={pullDisabled} onClick={onPull}>
                  {pullPending ? "Fetching & pulling..." : "Fetch & pull"}
                </Button>
                <Button variant="outline" disabled={pushDisabled} onClick={onPush}>
                  {pushPending
                    ? "Pushing..."
                    : gitStatus?.aheadCount && gitStatus.aheadCount > 0
                      ? `Push +${gitStatus.aheadCount}`
                      : "Push"}
                </Button>
              </div>
            </div>
          </section>

          <ChangeSection
            title="Staged Changes"
            emptyLabel="No staged changes."
            files={stagedFiles}
            insertions={gitStatus?.staged?.insertions ?? 0}
            deletions={gitStatus?.staged?.deletions ?? 0}
            scope="staged"
            selectedTarget={selectedTarget}
            onSelectFile={(target) => {
              onSelectFile(target);
            }}
            actionLabel="Unstage"
            actionPending={unstagePending || commitPending}
            allActionLabel="Unstage All"
            onActionAll={onUnstageAll}
            onActionFile={onUnstageFile}
            resolvedTheme={resolvedTheme}
          />

          <ChangeSection
            title="Changes"
            emptyLabel={isLoadingStatus ? "Loading changed files..." : "Working tree clean."}
            files={unstagedFiles}
            insertions={gitStatus?.unstaged?.insertions ?? gitStatus?.workingTree.insertions ?? 0}
            deletions={gitStatus?.unstaged?.deletions ?? gitStatus?.workingTree.deletions ?? 0}
            scope="unstaged"
            selectedTarget={selectedTarget}
            onSelectFile={(target) => {
              onSelectFile(target);
            }}
            actionLabel="Stage"
            actionPending={stagePending || commitPending}
            allActionLabel="Stage All"
            onActionAll={onStageAll}
            onActionFile={onStageFile}
            resolvedTheme={resolvedTheme}
          />

          {selectedFile ? (
            <section className={cn("space-y-2", !isMobileLayout && "min-h-0 flex-1")}>
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
                  {scopeLabel(selectedTarget?.scope ?? "unstaged")} Diff
                </p>
                <button
                  type="button"
                  className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => onSelectFile(selectedTarget!)}
                >
                  Collapse
                </button>
              </div>
              <div className="min-h-0 overflow-hidden rounded-xl border border-border/70 bg-card">
                <div className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background">
                      <FileIcon className="size-4 text-foreground/80" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{selectedFile.path}</p>
                      <p className={cn("text-xs", statusClassName(selectedFile.status))}>
                        {scopeLabel(selectedTarget?.scope ?? "unstaged")} ·{" "}
                        {statusLabel(selectedFile.status)}
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 text-right font-mono text-sm">
                    <span className="text-red-600 dark:text-red-300/90">
                      -{selectedFile.deletions}
                    </span>
                    <span className="mx-2 text-muted-foreground/60" />
                    <span className="text-emerald-600 dark:text-emerald-300/90">
                      +{selectedFile.insertions}
                    </span>
                  </div>
                </div>

                <div
                  className={cn(
                    "overflow-x-auto",
                    isMobileLayout ? "overflow-y-visible" : "max-h-[28rem] overflow-y-auto",
                  )}
                >
                  {selectedFileDiffError ? (
                    <div className="px-4 py-5 text-sm text-destructive">{selectedFileDiffError}</div>
                  ) : !selectedRenderablePatch ? (
                    <div className="px-4 py-5 text-sm text-muted-foreground">
                      {selectedFileDiffQuery.isLoading || selectedFileDiffQuery.isFetching
                        ? "Loading file diff..."
                        : "No diff available for this file."}
                    </div>
                  ) : selectedRenderablePatch.kind === "files" ? (
                    <div className="[&_[data-file-info]]:hidden">
                      {selectedFiles.map((fileDiff) => (
                        <div key={buildFileDiffRenderKey(fileDiff)}>
                          <FileDiff
                            fileDiff={fileDiff}
                            options={{
                              diffStyle: "unified",
                              lineDiffType: "none",
                              theme: resolveDiffThemeName(resolvedTheme),
                              themeType: resolvedTheme,
                              unsafeCSS: DIFF_SURFACE_UNSAFE_CSS,
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-2 p-4">
                      <p className="text-[11px] text-muted-foreground/75">
                        {selectedRenderablePatch.reason}
                      </p>
                      <pre className="overflow-auto rounded-lg border border-border/70 bg-background/70 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground/90">
                        {selectedRenderablePatch.text}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            </section>
          ) : null}
        </>
      )}

      {(branchListError || gitStatusError) && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/6 px-4 py-3 text-sm text-destructive">
          {branchListError ?? gitStatusError}
        </div>
      )}
    </div>
  );
}

export default function GitActionsControl({
  gitCwd,
  projectName,
  open: openProp,
  onOpenChange,
  presentation = "overlay",
  triggerAriaLabel,
  triggerClassName,
  triggerContent,
  triggerSize,
  triggerVariant,
}: GitActionsControlProps) {
  const queryClient = useQueryClient();
  const { resolvedTheme } = useTheme();
  const isMobile = useMediaQuery("(max-width: 767px)");
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [selectedTarget, setSelectedTarget] = useState<SelectedFileTarget | null>(null);
  const open = openProp ?? uncontrolledOpen;
  const panelOpen = presentation === "inline" ? true : open;
  const setOpen = (nextOpen: boolean) => {
    onOpenChange?.(nextOpen);
    if (openProp === undefined) {
      setUncontrolledOpen(nextOpen);
    }
  };

  const branchListQuery = useQuery(gitBranchesQueryOptions(gitCwd));
  const initMutation = useMutation(gitInitMutationOptions({ cwd: gitCwd, queryClient }));
  const stageFilesMutation = useMutation(gitStageFilesMutationOptions({ cwd: gitCwd, queryClient }));
  const unstageFilesMutation = useMutation(
    gitUnstageFilesMutationOptions({ cwd: gitCwd, queryClient }),
  );
  const commitMutation = useMutation(gitCommitMutationOptions({ cwd: gitCwd, queryClient }));
  const pullMutation = useMutation(gitPullMutationOptions({ cwd: gitCwd, queryClient }));
  const pushMutation = useMutation(gitPushMutationOptions({ cwd: gitCwd, queryClient }));
  const gitStatusQuery = useQuery({
    ...gitStatusQueryOptions(gitCwd),
    enabled: gitCwd !== null && branchListQuery.data?.isRepo === true,
  });
  const selectedFileDiffQuery = useQuery(
    gitWorkingTreeFileDiffQueryOptions({
      cwd: gitCwd,
      path: selectedTarget?.path ?? null,
      enabled:
        panelOpen &&
        gitCwd !== null &&
        branchListQuery.data?.isRepo === true &&
        selectedTarget !== null,
      ...(selectedTarget ? { scope: selectedTarget.scope } : {}),
    }),
  );

  const stagedFiles = gitStatusQuery.data?.staged?.files ?? EMPTY_GIT_FILES;
  const unstagedFiles =
    gitStatusQuery.data?.unstaged?.files ??
    gitStatusQuery.data?.workingTree.files ??
    EMPTY_GIT_FILES;

  useEffect(() => {
    if (presentation !== "inline" && !open) {
      setSelectedTarget(null);
    }
  }, [open, presentation]);

  useEffect(() => {
    if (!selectedTarget) {
      return;
    }
    const files = selectedTarget.scope === "staged" ? stagedFiles : unstagedFiles;
    if (!files.some((file) => file.path === selectedTarget.path)) {
      setSelectedTarget(null);
    }
  }, [selectedTarget, stagedFiles, unstagedFiles]);

  useEffect(() => {
    setCommitMessage("");
    setSelectedTarget(null);
  }, [gitCwd]);

  if (!gitCwd) {
    return null;
  }

  const handleMutationError = (title: string, error: unknown) => {
    toastManager.add({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An unexpected error occurred.",
    });
  };

  const handleStageFiles = (paths: string[]) => {
    void stageFilesMutation.mutateAsync(paths).catch((error) => {
      handleMutationError("Could not stage files", error);
    });
  };

  const handleUnstageFiles = (paths: string[]) => {
    void unstageFilesMutation.mutateAsync(paths).catch((error) => {
      handleMutationError("Could not unstage files", error);
    });
  };

  const handleCommit = () => {
    const trimmedMessage = commitMessage.trim();
    if (trimmedMessage.length === 0) {
      toastManager.add({
        type: "warning",
        title: "Enter a commit message",
      });
      return;
    }
    void commitMutation
      .mutateAsync(trimmedMessage)
      .then((result) => {
        setCommitMessage("");
        toastManager.add({
          type: "success",
          title: "Commit created",
          description: `${result.subject} · ${result.commitSha.slice(0, 7)}`,
        });
      })
      .catch((error) => {
        handleMutationError("Could not create commit", error);
      });
  };

  const handlePush = () => {
    void pushMutation
      .mutateAsync()
      .then((result) => {
        toastManager.add({
          type: result.status === "pushed" ? "success" : "info",
          title: result.status === "pushed" ? "Branch pushed" : "Branch already up to date",
          description: result.upstreamBranch
            ? `${result.branch} → ${result.upstreamBranch}`
            : result.branch,
        });
      })
      .catch((error) => {
        handleMutationError("Could not push branch", error);
      });
  };

  const handlePull = () => {
    void pullMutation
      .mutateAsync()
      .then((result) => {
        toastManager.add({
          type: result.status === "pulled" ? "success" : "info",
          title: result.status === "pulled" ? "Fetched and pulled branch" : "Branch already up to date",
          description: result.upstreamBranch
            ? `${result.branch} ← ${result.upstreamBranch}`
            : result.branch,
        });
      })
      .catch((error) => {
        handleMutationError("Could not fetch and pull branch", error);
      });
  };

  const trigger = (
    <Button
      size={triggerSize ?? "xs"}
      variant={triggerVariant ?? "outline"}
      className={cn(open && "bg-accent text-accent-foreground", triggerClassName)}
      {...(triggerAriaLabel ? { "aria-label": triggerAriaLabel } : {})}
    >
      {triggerContent ?? (
        <>
          <FolderIcon className="size-3.5" />
          <span className="sr-only @sm/header-actions:not-sr-only">Source Control</span>
          <ChevronDownIcon className="size-3.5 opacity-70" />
        </>
      )}
    </Button>
  );

  const panel = (
    <SourceControlPanel
      gitCwd={gitCwd}
      isMobileLayout={isMobile}
      isRepo={branchListQuery.data?.isRepo ?? null}
      isLoadingRepoState={branchListQuery.isLoading}
      isLoadingStatus={gitStatusQuery.isLoading}
      initPending={initMutation.isPending}
      onInitializeGit={() => initMutation.mutate()}
      branchListError={
        branchListQuery.error instanceof Error ? branchListQuery.error.message : null
      }
      gitStatus={gitStatusQuery.data ?? null}
      gitStatusError={gitStatusQuery.error instanceof Error ? gitStatusQuery.error.message : null}
      commitMessage={commitMessage}
      onCommitMessageChange={setCommitMessage}
      commitPending={commitMutation.isPending}
      pullPending={pullMutation.isPending}
      pushPending={pushMutation.isPending}
      onCommit={handleCommit}
      onPull={handlePull}
      onPush={handlePush}
      stagePending={stageFilesMutation.isPending}
      unstagePending={unstageFilesMutation.isPending}
      onStageAll={() => handleStageFiles(unstagedFiles.map((file) => file.path))}
      onStageFile={(path) => handleStageFiles([path])}
      onUnstageAll={() => handleUnstageFiles(stagedFiles.map((file) => file.path))}
      onUnstageFile={(path) => handleUnstageFiles([path])}
      resolvedTheme={resolvedTheme}
      selectedTarget={selectedTarget}
      onSelectFile={(target) => {
        setSelectedTarget((current) =>
          current?.path === target.path && current.scope === target.scope ? null : target,
        );
      }}
      selectedFileDiffQuery={selectedFileDiffQuery}
      {...(projectName ? { projectName } : {})}
    />
  );

  if (presentation === "inline") {
    return panel;
  }

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger render={trigger} />
        <SheetPopup side="right" className="app-mobile-viewport w-full max-w-none p-0">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-5">
              {panel}
            </div>
          </div>
        </SheetPopup>
      </Sheet>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={trigger} />
      <PopoverPopup align="end" side="bottom" className="w-[min(92vw,48rem)]">
        {panel}
      </PopoverPopup>
    </Popover>
  );
}
