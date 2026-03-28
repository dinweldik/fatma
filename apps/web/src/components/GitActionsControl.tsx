import { FileDiff } from "@pierre/diffs/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  GitFileChangeStatus,
  GitFileDiffScope,
  GitReadWorkingTreeFileDiffResult,
  GitStatusResult,
} from "@fatma/contracts";
import {
  CheckIcon,
  ChevronDownIcon,
  FolderIcon,
  LoaderIcon,
  SparklesIcon,
} from "lucide-react";
import {
  type ComponentProps,
  type ReactNode,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTheme } from "../hooks/useTheme";
import { useMediaQuery } from "../hooks/useMediaQuery";
import {
  gitBranchesQueryOptions,
  gitCommitMutationOptions,
  gitGenerateCommitMessageMutationOptions,
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

function commitShortcutLabel(): string {
  if (typeof navigator !== "undefined" && /Mac/i.test(navigator.platform)) {
    return "Cmd+Enter";
  }
  return "Ctrl+Enter";
}

function BranchDelta({ aheadCount, behindCount }: { aheadCount: number; behindCount: number }) {
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
  selectedFile,
  selectedFileDiffError,
  selectedFileDiffQuery,
  selectedRenderablePatch,
  selectedFiles,
  isMobileLayout,
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
  selectedFile: GitChangedFile | null;
  selectedFileDiffError: string | null;
  selectedFileDiffQuery: { isLoading: boolean; isFetching: boolean };
  selectedRenderablePatch: ReturnType<typeof getRenderablePatch>;
  selectedFiles: ReadonlyArray<import("@pierre/diffs/react").FileDiffMetadata>;
  isMobileLayout: boolean;
}) {
  return (
    <section className="space-y-1">
      <div className="flex items-center justify-between gap-2 px-2 py-1">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
            {title}
          </span>
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground/50">
            {files.length}
          </span>
          {(insertions > 0 || deletions > 0) && (
            <span className="font-mono text-[10px] tabular-nums">
              <span className="text-emerald-600 dark:text-emerald-300/90">+{insertions}</span>
              <span className="mx-0.5 text-muted-foreground/40">/</span>
              <span className="text-red-600 dark:text-red-300/90">-{deletions}</span>
            </span>
          )}
        </div>
        <Button
          size="xs"
          variant="ghost"
          className="h-6 px-1.5 text-[10px] text-muted-foreground/60 hover:text-foreground"
          disabled={files.length === 0 || actionPending}
          onClick={onActionAll}
        >
          {allActionLabel}
        </Button>
      </div>

      {files.length === 0 ? (
        <p className="px-2 py-3 text-[11px] text-muted-foreground/50">{emptyLabel}</p>
      ) : (
        <div className="max-h-64 overflow-y-auto">
          {files.map((file) => {
            const selected = selectedTarget?.scope === scope && selectedTarget.path === file.path;
            const iconUrl = getVscodeIconUrlForEntry(file.path, "file", resolvedTheme);

            return (
              <div
                key={`${scope}:${file.path}`}
                className={cn(
                  "group flex items-center gap-1 rounded-lg pr-1 transition-colors",
                  selected
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "hover:bg-sidebar-accent/50",
                )}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left"
                  onClick={() => onSelectFile({ path: file.path, scope })}
                >
                  <img src={iconUrl} alt="" className="size-3.5 shrink-0" loading="lazy" />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground/80 group-hover:text-foreground/90">
                    {file.path}
                  </span>
                  <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/50">
                    <span className="text-emerald-600 dark:text-emerald-300/90">+{file.insertions}</span>
                    <span className="mx-0.5 text-muted-foreground/30">/</span>
                    <span className="text-red-600 dark:text-red-300/90">-{file.deletions}</span>
                  </span>
                  <span
                    className={cn(
                      "w-3.5 shrink-0 text-center font-mono text-[10px] font-semibold",
                      statusClassName(file.status),
                    )}
                  >
                    {statusLetter(file.status)}
                  </span>
                </button>
                <button
                  type="button"
                  className="shrink-0 rounded-md px-1 py-0.5 text-[10px] text-muted-foreground/50 opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                  disabled={actionPending}
                  onClick={() => onActionFile(file.path)}
                >
                  {actionLabel}
                </button>
              </div>
            );
          })}
        </div>
      )}
      {selectedTarget?.scope === scope && selectedFile ? (
        <section className={cn("mt-1 space-y-1", !isMobileLayout && "min-h-0 flex-1")}>
          <div className="flex items-center justify-between gap-2 px-2">
            <span className="truncate font-mono text-[11px] text-muted-foreground/70">
              {selectedFile.path}
              <span className={cn("ml-1.5 text-[10px]", statusClassName(selectedFile.status))}>
                {statusLabel(selectedFile.status)}
              </span>
            </span>
            <button
              type="button"
              className="shrink-0 text-[10px] text-muted-foreground/50 transition-colors hover:text-foreground"
              onClick={() => onSelectFile(selectedTarget!)}
            >
              Close
            </button>
          </div>
          <div className="min-h-0 overflow-hidden rounded-lg border border-sidebar-border">
            <div
              className={cn(
                "overflow-x-auto",
                isMobileLayout ? "overflow-y-visible" : "max-h-[28rem] overflow-y-auto",
              )}
            >
              {selectedFileDiffError ? (
                <div className="px-3 py-4 text-[11px] text-destructive">{selectedFileDiffError}</div>
              ) : !selectedRenderablePatch ? (
                <div className="px-3 py-4 text-[11px] text-muted-foreground/60">
                  {selectedFileDiffQuery.isLoading || selectedFileDiffQuery.isFetching
                    ? "Loading diff..."
                    : "No diff available."}
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
                <div className="space-y-1.5 p-3">
                  <p className="text-[10px] text-muted-foreground/60">
                    {selectedRenderablePatch.reason}
                  </p>
                  <pre className="overflow-auto rounded-md bg-background/50 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground/80">
                    {selectedRenderablePatch.text}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </section>
      ) : null}
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
  generateCommitMessagePending,
  onGenerateCommitMessage,
  anyMutationStuck,
  onResetMutations,
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
  generateCommitMessagePending: boolean;
  onGenerateCommitMessage: () => void;
  anyMutationStuck: boolean;
  onResetMutations: () => void;
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

  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 w-full flex-col gap-3",
        !isMobileLayout && "max-h-[min(82vh,56rem)]",
      )}
    >
      {!isMobileLayout && (
        <span className="px-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
          Source Control
        </span>
      )}

      {isLoadingRepoState ? (
        <p className="px-2 py-3 text-[11px] text-muted-foreground/50">
          Loading repository status...
        </p>
      ) : isRepo === false ? (
        <div className="space-y-2 px-2 py-3">
          <p className="text-xs font-medium text-foreground/90">Not a git repository</p>
          <p className="text-[11px] text-muted-foreground/60">
            Initialize git to start tracking changes.
          </p>
          <Button size="sm" variant="outline" disabled={initPending} onClick={onInitializeGit}>
            {initPending ? "Initializing..." : "Initialize Git"}
          </Button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 rounded-lg px-2 py-1.5">
            <FolderIcon className="size-3.5 shrink-0 text-muted-foreground/70" />
            <div className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-foreground/90">
                {repositoryLabel}
              </span>
              <span className="block truncate text-[10px] text-muted-foreground/50">
                {gitStatus?.branch ?? "Detached HEAD"}
                {gitStatus?.hasWorkingTreeChanges ? " *" : ""}
                {gitStatus?.pr ? (
                  <span className="ml-1.5 text-muted-foreground/40">
                    PR {gitStatus.pr.state}
                  </span>
                ) : null}
              </span>
            </div>
            {gitStatus ? (
              <span className="shrink-0 font-mono text-[10px] tabular-nums">
                <BranchDelta
                  aheadCount={gitStatus.aheadCount}
                  behindCount={gitStatus.behindCount}
                />
              </span>
            ) : null}
          </div>

          <section className="space-y-1.5 px-1">
            <div className="relative">
              <Input
                aria-label="Commit message"
                autoComplete="off"
                className="h-8 pr-8 text-xs"
                placeholder={`Commit message (${commitShortcutLabel()})`}
                value={commitMessage}
                onChange={(event) => onCommitMessageChange(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    (event.metaKey || event.ctrlKey) &&
                    event.key === "Enter" &&
                    !commitDisabled
                  ) {
                    event.preventDefault();
                    onCommit();
                  }
                }}
              />
              <button
                type="button"
                aria-label="Generate commit message"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-muted-foreground/50 transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                disabled={
                  generateCommitMessagePending || stagedFiles.length === 0 || commitPending
                }
                onClick={onGenerateCommitMessage}
              >
                {generateCommitMessagePending ? (
                  <LoaderIcon className="size-3.5 animate-spin" />
                ) : (
                  <SparklesIcon className="size-3.5" />
                )}
              </button>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-1.5">
              <Button size="sm" disabled={commitDisabled} onClick={onCommit}>
                <CheckIcon className="size-3.5" />
                {commitPending ? "Committing..." : "Commit"}
              </Button>
              <Button size="sm" variant="outline" disabled={pullDisabled} onClick={onPull}>
                {pullPending ? "Pulling..." : "Pull"}
              </Button>
              <Button size="sm" variant="outline" disabled={pushDisabled} onClick={onPush}>
                {pushPending
                  ? "Pushing..."
                  : gitStatus?.aheadCount && gitStatus.aheadCount > 0
                    ? `Push +${gitStatus.aheadCount}`
                    : "Push"}
              </Button>
            </div>
            {anyMutationStuck && (
              <button
                type="button"
                className="w-full text-center text-[10px] text-muted-foreground/50 transition-colors hover:text-foreground"
                onClick={onResetMutations}
              >
                Taking too long? Reset
              </button>
            )}
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
            selectedFile={selectedTarget?.scope === "staged" ? selectedFile : null}
            selectedFileDiffError={
              selectedTarget?.scope === "staged" ? selectedFileDiffError : null
            }
            selectedFileDiffQuery={selectedFileDiffQuery}
            selectedRenderablePatch={
              selectedTarget?.scope === "staged" ? selectedRenderablePatch : null
            }
            selectedFiles={selectedTarget?.scope === "staged" ? selectedFiles : []}
            isMobileLayout={isMobileLayout}
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
            selectedFile={selectedTarget?.scope === "unstaged" ? selectedFile : null}
            selectedFileDiffError={
              selectedTarget?.scope === "unstaged" ? selectedFileDiffError : null
            }
            selectedFileDiffQuery={selectedFileDiffQuery}
            selectedRenderablePatch={
              selectedTarget?.scope === "unstaged" ? selectedRenderablePatch : null
            }
            selectedFiles={selectedTarget?.scope === "unstaged" ? selectedFiles : []}
            isMobileLayout={isMobileLayout}
          />
        </>
      )}
      {(branchListError || gitStatusError) && (
        <p className="px-2 text-[11px] text-destructive">
          {branchListError ?? gitStatusError}
        </p>
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
  const stageFilesMutation = useMutation(
    gitStageFilesMutationOptions({ cwd: gitCwd, queryClient }),
  );
  const unstageFilesMutation = useMutation(
    gitUnstageFilesMutationOptions({ cwd: gitCwd, queryClient }),
  );
  const commitMutation = useMutation(gitCommitMutationOptions({ cwd: gitCwd, queryClient }));
  const pullMutation = useMutation(gitPullMutationOptions({ cwd: gitCwd, queryClient }));
  const pushMutation = useMutation(gitPushMutationOptions({ cwd: gitCwd, queryClient }));
  const generateCommitMessageMutation = useMutation(
    gitGenerateCommitMessageMutationOptions({ cwd: gitCwd }),
  );
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

  // Stuck mutation detection: show reset link after 30s of any mutation pending.
  const STUCK_THRESHOLD_MS = 30_000;
  const [anyMutationStuck, setAnyMutationStuck] = useState(false);
  const anyPending =
    stageFilesMutation.isPending ||
    unstageFilesMutation.isPending ||
    commitMutation.isPending ||
    pullMutation.isPending ||
    pushMutation.isPending;
  const stuckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (anyPending) {
      stuckTimerRef.current = setTimeout(() => setAnyMutationStuck(true), STUCK_THRESHOLD_MS);
    } else {
      setAnyMutationStuck(false);
      if (stuckTimerRef.current) {
        clearTimeout(stuckTimerRef.current);
        stuckTimerRef.current = null;
      }
    }
    return () => {
      if (stuckTimerRef.current) {
        clearTimeout(stuckTimerRef.current);
        stuckTimerRef.current = null;
      }
    };
  }, [anyPending]);

  const handleResetMutations = useCallback(() => {
    stageFilesMutation.reset();
    unstageFilesMutation.reset();
    commitMutation.reset();
    pullMutation.reset();
    pushMutation.reset();
    setAnyMutationStuck(false);
    toastManager.add({
      type: "info",
      title: "Git operations reset",
      description: "All pending operations have been cancelled.",
    });
  }, [stageFilesMutation, unstageFilesMutation, commitMutation, pullMutation, pushMutation]);

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
          title:
            result.status === "pulled" ? "Fetched and pulled branch" : "Branch already up to date",
          description: result.upstreamBranch
            ? `${result.branch} ← ${result.upstreamBranch}`
            : result.branch,
        });
      })
      .catch((error) => {
        handleMutationError("Could not fetch and pull branch", error);
      });
  };

  const handleGenerateCommitMessage = () => {
    void generateCommitMessageMutation
      .mutateAsync()
      .then((result) => {
        setCommitMessage(result.subject);
      })
      .catch((error) => {
        handleMutationError("Could not generate commit message", error);
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
      generateCommitMessagePending={generateCommitMessageMutation.isPending}
      onGenerateCommitMessage={handleGenerateCommitMessage}
      anyMutationStuck={anyMutationStuck}
      onResetMutations={handleResetMutations}
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
      <PopoverPopup align="end" side="bottom" className="w-[min(92vw,36rem)]">
        {panel}
      </PopoverPopup>
    </Popover>
  );
}
