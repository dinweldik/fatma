import {
  ArrowUpIcon,
  ChevronRightIcon,
  FileIcon,
  FolderIcon,
  FolderPlusIcon,
  GitPullRequestIcon,
  RocketIcon,
  SettingsIcon,
  SquarePenIcon,
  TerminalIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import appSidebarLogoUrl from "../../../../assets/prod/logo_nobg.svg";
import {
  DEFAULT_RUNTIME_MODE,
  DEFAULT_MODEL_BY_PROVIDER,
  type DesktopUpdateState,
  ProjectId,
  ThreadId,
  type GitStatusResult,
  type ResolvedKeybindingsConfig,
} from "@fatma/contracts";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useAppSettings } from "../appSettings";
import { isElectron } from "../env";
import { APP_BASE_NAME } from "../branding";
import { cn, newCommandId, newProjectId, newThreadId } from "../lib/utils";
import { useStore } from "../store";
import {
  isChatNewLocalShortcut,
  isChatNewShortcut,
  resolveShortcutCommand,
  shortcutLabelForCommand,
} from "../keybindings";
import {
  closeAllProjectShells,
  createProjectShell,
  defaultProjectShellConfig,
  ensureProjectShell,
} from "../projectShellRunner";
import { useProjectShellStore, selectProjectShellCollection } from "../projectShellStore";
import { type Thread } from "../types";
import { derivePendingApprovals } from "../session-logic";
import { gitRemoveWorktreeMutationOptions, gitStatusQueryOptions } from "../lib/gitReactQuery";
import { serverConfigQueryOptions } from "../lib/serverReactQuery";
import { readNativeApi } from "../nativeApi";
import { type DraftThreadEnvMode, useComposerDraftStore } from "../composerDraftStore";
import { onServerWelcome } from "../wsNativeApi";
import { filterProjectBrowserEntries, isHiddenProjectBrowserEntry } from "../projectBrowserEntries";
import { toastManager } from "./ui/toast";
import {
  getDesktopUpdateActionError,
  getDesktopUpdateButtonTooltip,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
  shouldHighlightDesktopUpdateError,
  shouldShowDesktopUpdateButton,
  shouldToastDesktopUpdateActionResult,
} from "./desktopUpdate.logic";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";
import { Switch } from "./ui/switch";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenuAction,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarSeparator,
  useSidebar,
} from "./ui/sidebar";
import { formatWorktreePathForDisplay, getOrphanedWorktreePathForThread } from "../worktreeCleanup";
import { isNonEmpty as isNonEmptyString } from "effect/String";

const EMPTY_KEYBINDINGS: ResolvedKeybindingsConfig = [];
const THREAD_PREVIEW_LIMIT = 6;

type MobileSidebarPresentation = "page" | "sheet";

async function copyTextToClipboard(text: string): Promise<void> {
  if (typeof navigator === "undefined" || navigator.clipboard?.writeText === undefined) {
    throw new Error("Clipboard API unavailable.");
  }
  await navigator.clipboard.writeText(text);
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function basenameOfPath(input: string): string {
  const trimmed = input.replace(/[/\\]+$/, "");
  const segments = trimmed.split(/[/\\]/).filter(isNonEmptyString);
  return segments.at(-1) ?? input;
}

function isProjectDeleteBlockedByActiveThreads(message: string): boolean {
  return message.includes("cannot be deleted while it still has");
}

interface ThreadStatusPill {
  label: "Working" | "Connecting" | "Completed" | "Pending Approval";
  colorClass: string;
  dotClass: string;
  pulse: boolean;
}

interface PrStatusIndicator {
  label: "PR open" | "PR closed" | "PR merged";
  colorClass: string;
  tooltip: string;
  url: string;
}

type ThreadPr = GitStatusResult["pr"];

function hasUnseenCompletion(thread: Thread): boolean {
  if (!thread.latestTurn?.completedAt) return false;
  const completedAt = Date.parse(thread.latestTurn.completedAt);
  if (Number.isNaN(completedAt)) return false;
  if (!thread.lastVisitedAt) return true;

  const lastVisitedAt = Date.parse(thread.lastVisitedAt);
  if (Number.isNaN(lastVisitedAt)) return true;
  return completedAt > lastVisitedAt;
}

function threadStatusPill(thread: Thread, hasPendingApprovals: boolean): ThreadStatusPill | null {
  if (hasPendingApprovals) {
    return {
      label: "Pending Approval",
      colorClass: "text-amber-600 dark:text-amber-300/90",
      dotClass: "bg-amber-500 dark:bg-amber-300/90",
      pulse: false,
    };
  }

  if (thread.session?.status === "running") {
    return {
      label: "Working",
      colorClass: "text-sky-600 dark:text-sky-300/80",
      dotClass: "bg-sky-500 dark:bg-sky-300/80",
      pulse: true,
    };
  }

  if (thread.session?.status === "connecting") {
    return {
      label: "Connecting",
      colorClass: "text-sky-600 dark:text-sky-300/80",
      dotClass: "bg-sky-500 dark:bg-sky-300/80",
      pulse: true,
    };
  }

  if (hasUnseenCompletion(thread)) {
    return {
      label: "Completed",
      colorClass: "text-emerald-600 dark:text-emerald-300/90",
      dotClass: "bg-emerald-500 dark:bg-emerald-300/90",
      pulse: false,
    };
  }

  return null;
}

function prStatusIndicator(pr: ThreadPr): PrStatusIndicator | null {
  if (!pr) return null;

  if (pr.state === "open") {
    return {
      label: "PR open",
      colorClass: "text-emerald-600 dark:text-emerald-300/90",
      tooltip: `#${pr.number} PR open: ${pr.title}`,
      url: pr.url,
    };
  }
  if (pr.state === "closed") {
    return {
      label: "PR closed",
      colorClass: "text-zinc-500 dark:text-zinc-400/80",
      tooltip: `#${pr.number} PR closed: ${pr.title}`,
      url: pr.url,
    };
  }
  if (pr.state === "merged") {
    return {
      label: "PR merged",
      colorClass: "text-violet-600 dark:text-violet-300/90",
      tooltip: `#${pr.number} PR merged: ${pr.title}`,
      url: pr.url,
    };
  }
  return null;
}

function AppWordmark() {
  return (
    <span
      aria-label={APP_BASE_NAME}
      className="shrink-0 text-sm font-semibold tracking-[-0.08em] text-foreground"
    >
      {APP_BASE_NAME}
    </span>
  );
}

function AppBrandMark() {
  return (
    <img
      src={appSidebarLogoUrl}
      alt=""
      aria-hidden="true"
      className="size-5 shrink-0 rounded-md object-contain"
    />
  );
}

/**
 * Derives the server's HTTP origin (scheme + host + port) from the same
 * sources WsTransport uses, converting ws(s) to http(s).
 */
function getServerHttpOrigin(): string {
  const bridgeUrl = window.desktopBridge?.getWsUrl();
  const envUrl = import.meta.env.VITE_WS_URL as string | undefined;
  const wsUrl =
    bridgeUrl && bridgeUrl.length > 0
      ? bridgeUrl
      : envUrl && envUrl.length > 0
        ? envUrl
        : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
  // Parse to extract just the origin, dropping path/query (e.g. ?token=…)
  const httpUrl = wsUrl
    .replace(/^wss:/, "https:")
    .replace(/^ws:/, window.location.protocol === "https:" ? "https:" : "http:");
  try {
    return new URL(httpUrl).origin;
  } catch {
    return httpUrl;
  }
}

const serverHttpOrigin = getServerHttpOrigin();

function ProjectFavicon({ cwd }: { cwd: string }) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");

  const src = `${serverHttpOrigin}/api/project-favicon?cwd=${encodeURIComponent(cwd)}`;

  if (status === "error") {
    return <FolderIcon className="size-3.5 shrink-0 text-muted-foreground/50" />;
  }

  return (
    <img
      src={src}
      alt=""
      className={`size-3.5 shrink-0 rounded-sm object-contain ${status === "loading" ? "hidden" : ""}`}
      onLoad={() => setStatus("loaded")}
      onError={() => setStatus("error")}
    />
  );
}

export default function Sidebar({
  mobilePresentation = "sheet",
}: {
  mobilePresentation?: MobileSidebarPresentation;
}) {
  const projects = useStore((store) => store.projects);
  const threads = useStore((store) => store.threads);
  const markThreadUnread = useStore((store) => store.markThreadUnread);
  const toggleProject = useStore((store) => store.toggleProject);
  const clearComposerDraftForThread = useComposerDraftStore((store) => store.clearThreadDraft);
  const getDraftThreadByProjectId = useComposerDraftStore(
    (store) => store.getDraftThreadByProjectId,
  );
  const getDraftThread = useComposerDraftStore((store) => store.getDraftThread);
  const shellStateByProjectId = useProjectShellStore((state) => state.shellStateByProjectId);
  const setActiveShell = useProjectShellStore((state) => state.setActiveShell);
  const setProjectDraftThreadId = useComposerDraftStore((store) => store.setProjectDraftThreadId);
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);
  const clearProjectDraftThreadId = useComposerDraftStore(
    (store) => store.clearProjectDraftThreadId,
  );
  const clearProjectDraftThreadById = useComposerDraftStore(
    (store) => store.clearProjectDraftThreadById,
  );
  const { isMobile, setOpenMobile } = useSidebar();
  const navigate = useNavigate();
  const { settings: appSettings } = useAppSettings();
  const routeThreadId = useParams({
    strict: false,
    select: (params) => (params.threadId ? ThreadId.makeUnsafe(params.threadId) : null),
  });
  const routeProjectShell = useParams({
    strict: false,
    select: (params) => ({
      projectId: params.projectId ? ProjectId.makeUnsafe(params.projectId) : null,
      shellId: params.shellId ?? null,
    }),
  });
  const { data: serverConfig } = useQuery(serverConfigQueryOptions());
  const keybindings = serverConfig?.keybindings ?? EMPTY_KEYBINDINGS;
  const queryClient = useQueryClient();
  const removeWorktreeMutation = useMutation(gitRemoveWorktreeMutationOptions({ queryClient }));
  const [addingProject, setAddingProject] = useState(false);
  const [isPickingFolder, setIsPickingFolder] = useState(false);
  const [isAddingProject, setIsAddingProject] = useState(false);
  const [projectBrowserRootPath, setProjectBrowserRootPath] = useState<string | null>(null);
  const [projectBrowserCurrentPath, setProjectBrowserCurrentPath] = useState<string | null>(null);
  const [showHiddenProjectBrowserEntries, setShowHiddenProjectBrowserEntries] = useState(false);
  const [newProjectFolderName, setNewProjectFolderName] = useState("");
  const [renamingThreadId, setRenamingThreadId] = useState<ThreadId | null>(null);
  const [renamingTitle, setRenamingTitle] = useState("");
  const [expandedThreadListsByProject, setExpandedThreadListsByProject] = useState<
    ReadonlySet<ProjectId>
  >(() => new Set());
  const renamingCommittedRef = useRef(false);
  const renamingInputRef = useRef<HTMLInputElement | null>(null);
  const [desktopUpdateState, setDesktopUpdateState] = useState<DesktopUpdateState | null>(null);
  const pendingApprovalByThreadId = useMemo(() => {
    const map = new Map<ThreadId, boolean>();
    for (const thread of threads) {
      map.set(thread.id, derivePendingApprovals(thread.activities).length > 0);
    }
    return map;
  }, [threads]);
  const projectCwdById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.cwd] as const)),
    [projects],
  );
  const threadGitTargets = useMemo(
    () =>
      threads.map((thread) => ({
        threadId: thread.id,
        branch: thread.branch,
        cwd: thread.worktreePath ?? projectCwdById.get(thread.projectId) ?? null,
      })),
    [projectCwdById, threads],
  );
  const threadGitStatusCwds = useMemo(
    () => [
      ...new Set(
        threadGitTargets
          .filter((target) => target.branch !== null)
          .map((target) => target.cwd)
          .filter((cwd): cwd is string => cwd !== null),
      ),
    ],
    [threadGitTargets],
  );
  const threadGitStatusQueries = useQueries({
    queries: threadGitStatusCwds.map((cwd) => ({
      ...gitStatusQueryOptions(cwd),
      staleTime: 30_000,
      refetchInterval: 60_000,
    })),
  });
  const prByThreadId = useMemo(() => {
    const statusByCwd = new Map<string, GitStatusResult>();
    for (let index = 0; index < threadGitStatusCwds.length; index += 1) {
      const cwd = threadGitStatusCwds[index];
      if (!cwd) continue;
      const status = threadGitStatusQueries[index]?.data;
      if (status) {
        statusByCwd.set(cwd, status);
      }
    }

    const map = new Map<ThreadId, ThreadPr>();
    for (const target of threadGitTargets) {
      const status = target.cwd ? statusByCwd.get(target.cwd) : undefined;
      const branchMatches =
        target.branch !== null && status?.branch !== null && status?.branch === target.branch;
      map.set(target.threadId, branchMatches ? (status?.pr ?? null) : null);
    }
    return map;
  }, [threadGitStatusCwds, threadGitStatusQueries, threadGitTargets]);
  const projectBrowserQuery = useQuery({
    queryKey: ["projects", "browse-directory", projectBrowserRootPath, projectBrowserCurrentPath],
    queryFn: async () => {
      const api = readNativeApi();
      if (!api || !projectBrowserRootPath || !projectBrowserCurrentPath) {
        throw new Error("Project browser is unavailable.");
      }
      return api.projects.browseDirectory({
        rootPath: projectBrowserRootPath,
        directoryPath: projectBrowserCurrentPath,
      });
    },
    enabled: addingProject && projectBrowserRootPath !== null && projectBrowserCurrentPath !== null,
  });
  const createProjectDirectoryMutation = useMutation({
    mutationFn: async (name: string) => {
      const api = readNativeApi();
      if (!api || !projectBrowserRootPath || !projectBrowserCurrentPath) {
        throw new Error("Project browser is unavailable.");
      }
      return api.projects.createDirectory({
        rootPath: projectBrowserRootPath,
        parentPath: projectBrowserCurrentPath,
        name,
      });
    },
  });

  const openPrLink = useCallback((event: React.MouseEvent<HTMLElement>, prUrl: string) => {
    event.preventDefault();
    event.stopPropagation();

    const api = readNativeApi();
    if (!api) {
      toastManager.add({
        type: "error",
        title: "Link opening is unavailable.",
      });
      return;
    }

    void api.shell.openExternal(prUrl).catch((error) => {
      toastManager.add({
        type: "error",
        title: "Unable to open PR link",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    });
  }, []);

  const collapseMobileSidebar = useCallback(() => {
    if (!isMobile) {
      return;
    }
    setOpenMobile(false);
  }, [isMobile, setOpenMobile]);

  useEffect(() => {
    return onServerWelcome((payload) => {
      setProjectBrowserRootPath((current) => current ?? payload.cwd);
      setProjectBrowserCurrentPath((current) => current ?? payload.cwd);
    });
  }, []);

  useEffect(() => {
    if (!serverConfig?.cwd) {
      return;
    }
    setProjectBrowserRootPath((current) => current ?? serverConfig.cwd);
    setProjectBrowserCurrentPath((current) => current ?? serverConfig.cwd);
  }, [serverConfig?.cwd]);

  const handleNewThread = useCallback(
    (
      projectId: ProjectId,
      options?: {
        branch?: string | null;
        worktreePath?: string | null;
        envMode?: DraftThreadEnvMode;
      },
    ): Promise<void> => {
      const hasBranchOption = options?.branch !== undefined;
      const hasWorktreePathOption = options?.worktreePath !== undefined;
      const hasEnvModeOption = options?.envMode !== undefined;
      const storedDraftThread = getDraftThreadByProjectId(projectId);
      if (storedDraftThread) {
        return (async () => {
          if (hasBranchOption || hasWorktreePathOption || hasEnvModeOption) {
            setDraftThreadContext(storedDraftThread.threadId, {
              ...(hasBranchOption ? { branch: options?.branch ?? null } : {}),
              ...(hasWorktreePathOption ? { worktreePath: options?.worktreePath ?? null } : {}),
              ...(hasEnvModeOption ? { envMode: options?.envMode } : {}),
            });
          }
          setProjectDraftThreadId(projectId, storedDraftThread.threadId);
          if (routeThreadId === storedDraftThread.threadId) {
            return;
          }
          await navigate({
            to: "/$threadId",
            params: { threadId: storedDraftThread.threadId },
          });
        })();
      }
      clearProjectDraftThreadId(projectId);

      const activeDraftThread = routeThreadId ? getDraftThread(routeThreadId) : null;
      if (activeDraftThread && routeThreadId && activeDraftThread.projectId === projectId) {
        if (hasBranchOption || hasWorktreePathOption || hasEnvModeOption) {
          setDraftThreadContext(routeThreadId, {
            ...(hasBranchOption ? { branch: options?.branch ?? null } : {}),
            ...(hasWorktreePathOption ? { worktreePath: options?.worktreePath ?? null } : {}),
            ...(hasEnvModeOption ? { envMode: options?.envMode } : {}),
          });
        }
        setProjectDraftThreadId(projectId, routeThreadId);
        return Promise.resolve();
      }
      const threadId = newThreadId();
      const createdAt = new Date().toISOString();
      return (async () => {
        setProjectDraftThreadId(projectId, threadId, {
          createdAt,
          branch: options?.branch ?? null,
          worktreePath: options?.worktreePath ?? null,
          envMode: options?.envMode ?? "local",
          runtimeMode: DEFAULT_RUNTIME_MODE,
        });

        await navigate({
          to: "/$threadId",
          params: { threadId },
        });
      })();
    },
    [
      clearProjectDraftThreadId,
      getDraftThreadByProjectId,
      navigate,
      getDraftThread,
      routeThreadId,
      setDraftThreadContext,
      setProjectDraftThreadId,
    ],
  );

  const focusMostRecentThreadForProject = useCallback(
    (projectId: ProjectId) => {
      const latestThread = threads
        .filter((thread) => thread.projectId === projectId)
        .toSorted((a, b) => {
          const byDate = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
          if (byDate !== 0) return byDate;
          return b.id.localeCompare(a.id);
        })[0];
      if (!latestThread) return;

      void navigate({
        to: "/$threadId",
        params: { threadId: latestThread.id },
      });
    },
    [navigate, threads],
  );

  const addProjectFromPath = useCallback(
    async (rawCwd: string) => {
      const cwd = rawCwd.trim();
      if (!cwd || isAddingProject) return;
      const api = readNativeApi();
      if (!api) return;

      setIsAddingProject(true);
      const finishAddingProject = () => {
        setIsAddingProject(false);
        setNewProjectFolderName("");
        setShowHiddenProjectBrowserEntries(false);
        setProjectBrowserCurrentPath(projectBrowserRootPath);
        setAddingProject(false);
      };

      const existing = projects.find((project) => project.cwd === cwd);
      if (existing) {
        focusMostRecentThreadForProject(existing.id);
        finishAddingProject();
        return;
      }

      const projectId = newProjectId();
      const createdAt = new Date().toISOString();
      const title = basenameOfPath(cwd);
      try {
        await api.orchestration.dispatchCommand({
          type: "project.create",
          commandId: newCommandId(),
          projectId,
          title,
          workspaceRoot: cwd,
          defaultModel: DEFAULT_MODEL_BY_PROVIDER.codex,
          createdAt,
        });
        await handleNewThread(projectId).catch(() => undefined);
      } catch (error) {
        setIsAddingProject(false);
        toastManager.add({
          type: "error",
          title: "Unable to add project",
          description:
            error instanceof Error ? error.message : "An error occurred while adding the project.",
        });
        return;
      }
      finishAddingProject();
    },
    [
      focusMostRecentThreadForProject,
      handleNewThread,
      isAddingProject,
      projectBrowserRootPath,
      projects,
    ],
  );

  const handlePickFolder = async () => {
    const api = readNativeApi();
    if (!api || isPickingFolder) return;
    setIsPickingFolder(true);
    let pickedPath: string | null = null;
    try {
      pickedPath = await api.dialogs.pickFolder();
    } catch {
      // Ignore picker failures and leave the current thread selection unchanged.
    }
    if (pickedPath) {
      await addProjectFromPath(pickedPath);
    }
    setIsPickingFolder(false);
  };

  const openProjectBrowser = useCallback(() => {
    setNewProjectFolderName("");
    setShowHiddenProjectBrowserEntries(false);
    setProjectBrowserCurrentPath(projectBrowserRootPath);
    setAddingProject(true);
  }, [projectBrowserRootPath]);

  const handleProjectBrowserOpenChange = useCallback(
    (open: boolean) => {
      setAddingProject(open);
      if (!open) {
        setNewProjectFolderName("");
        setShowHiddenProjectBrowserEntries(false);
        setProjectBrowserCurrentPath(projectBrowserRootPath);
        return;
      }
      setShowHiddenProjectBrowserEntries(false);
      setProjectBrowserCurrentPath(projectBrowserRootPath);
    },
    [projectBrowserRootPath],
  );

  const handleCreateProjectFolder = useCallback(async () => {
    const folderName = newProjectFolderName.trim();
    if (!folderName || createProjectDirectoryMutation.isPending) {
      return;
    }
    try {
      const result = await createProjectDirectoryMutation.mutateAsync(folderName);
      setNewProjectFolderName("");
      setProjectBrowserCurrentPath(result.path);
      await queryClient.invalidateQueries({
        queryKey: ["projects", "browse-directory", projectBrowserRootPath],
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Unable to create folder",
        description:
          error instanceof Error ? error.message : "An error occurred while creating the folder.",
      });
    }
  }, [createProjectDirectoryMutation, newProjectFolderName, projectBrowserRootPath, queryClient]);

  const cancelRename = useCallback(() => {
    setRenamingThreadId(null);
    renamingInputRef.current = null;
  }, []);

  const commitRename = useCallback(
    async (threadId: ThreadId, newTitle: string, originalTitle: string) => {
      const finishRename = () => {
        setRenamingThreadId((current) => {
          if (current !== threadId) return current;
          renamingInputRef.current = null;
          return null;
        });
      };

      const trimmed = newTitle.trim();
      if (trimmed.length === 0) {
        toastManager.add({ type: "warning", title: "Thread title cannot be empty" });
        finishRename();
        return;
      }
      if (trimmed === originalTitle) {
        finishRename();
        return;
      }
      const api = readNativeApi();
      if (!api) {
        finishRename();
        return;
      }
      try {
        await api.orchestration.dispatchCommand({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId,
          title: trimmed,
        });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Failed to rename thread",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      }
      finishRename();
    },
    [],
  );

  const handleThreadContextMenu = useCallback(
    async (threadId: ThreadId, position: { x: number; y: number }) => {
      const api = readNativeApi();
      if (!api) return;
      const clicked = await api.contextMenu.show(
        [
          { id: "rename", label: "Rename thread" },
          { id: "mark-unread", label: "Mark unread" },
          { id: "copy-thread-id", label: "Copy Thread ID" },
          { id: "delete", label: "Delete", destructive: true },
        ],
        position,
      );
      const thread = threads.find((t) => t.id === threadId);
      if (!thread) return;

      if (clicked === "rename") {
        setRenamingThreadId(threadId);
        setRenamingTitle(thread.title);
        renamingCommittedRef.current = false;
        return;
      }

      if (clicked === "mark-unread") {
        markThreadUnread(threadId);
        return;
      }
      if (clicked === "copy-thread-id") {
        try {
          await copyTextToClipboard(threadId);
          toastManager.add({
            type: "success",
            title: "Thread ID copied",
            description: threadId,
          });
        } catch (error) {
          toastManager.add({
            type: "error",
            title: "Failed to copy thread ID",
            description: error instanceof Error ? error.message : "An error occurred.",
          });
        }
        return;
      }
      if (clicked !== "delete") return;
      if (appSettings.confirmThreadDelete) {
        const confirmed = await api.dialogs.confirm(
          [
            `Delete thread "${thread.title}"?`,
            "This permanently clears conversation history for this thread.",
          ].join("\n"),
        );
        if (!confirmed) {
          return;
        }
      }
      const threadProject = projects.find((project) => project.id === thread.projectId);
      const orphanedWorktreePath = getOrphanedWorktreePathForThread(threads, threadId);
      const displayWorktreePath = orphanedWorktreePath
        ? formatWorktreePathForDisplay(orphanedWorktreePath)
        : null;
      const canDeleteWorktree = orphanedWorktreePath !== null && threadProject !== undefined;
      const shouldDeleteWorktree =
        canDeleteWorktree &&
        (await api.dialogs.confirm(
          [
            "This thread is the only one linked to this worktree:",
            displayWorktreePath ?? orphanedWorktreePath,
            "",
            "Delete the worktree too?",
          ].join("\n"),
        ));

      if (thread.session && thread.session.status !== "closed") {
        await api.orchestration
          .dispatchCommand({
            type: "thread.session.stop",
            commandId: newCommandId(),
            threadId,
            createdAt: new Date().toISOString(),
          })
          .catch(() => undefined);
      }

      try {
        await api.terminal.close({
          threadId,
          deleteHistory: true,
        });
      } catch {
        // Terminal may already be closed
      }

      const shouldNavigateToFallback = routeThreadId === threadId;
      const fallbackThreadId = threads.find((entry) => entry.id !== threadId)?.id ?? null;
      await api.orchestration.dispatchCommand({
        type: "thread.delete",
        commandId: newCommandId(),
        threadId,
      });
      clearComposerDraftForThread(threadId);
      clearProjectDraftThreadById(thread.projectId, thread.id);
      if (shouldNavigateToFallback) {
        if (fallbackThreadId) {
          void navigate({
            to: "/$threadId",
            params: { threadId: fallbackThreadId },
            replace: true,
          });
        } else {
          void navigate({ to: "/", replace: true });
        }
      }

      if (!shouldDeleteWorktree || !orphanedWorktreePath || !threadProject) {
        return;
      }

      try {
        await removeWorktreeMutation.mutateAsync({
          cwd: threadProject.cwd,
          path: orphanedWorktreePath,
          force: true,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error removing worktree.";
        console.error("Failed to remove orphaned worktree after thread deletion", {
          threadId,
          projectCwd: threadProject.cwd,
          worktreePath: orphanedWorktreePath,
          error,
        });
        toastManager.add({
          type: "error",
          title: "Thread deleted, but worktree removal failed",
          description: `Could not remove ${displayWorktreePath ?? orphanedWorktreePath}. ${message}`,
        });
      }
    },
    [
      appSettings.confirmThreadDelete,
      clearComposerDraftForThread,
      clearProjectDraftThreadById,
      markThreadUnread,
      navigate,
      projects,
      removeWorktreeMutation,
      routeThreadId,
      threads,
    ],
  );

  const handleProjectContextMenu = useCallback(
    async (projectId: ProjectId, position: { x: number; y: number }) => {
      const api = readNativeApi();
      if (!api) return;
      const clicked = await api.contextMenu.show(
        [{ id: "delete", label: "Delete", destructive: true }],
        position,
      );
      if (clicked !== "delete") return;

      const project = projects.find((entry) => entry.id === projectId);
      if (!project) return;

      const confirmed = await api.dialogs.confirm(
        [`Delete project "${project.name}"?`, "This action cannot be undone."].join("\n"),
      );
      if (!confirmed) return;

      try {
        await closeAllProjectShells(projectId).catch(() => undefined);
        const projectDraftThread = getDraftThreadByProjectId(projectId);
        if (projectDraftThread) {
          clearComposerDraftForThread(projectDraftThread.threadId);
        }
        clearProjectDraftThreadId(projectId);
        await api.orchestration.dispatchCommand({
          type: "project.delete",
          commandId: newCommandId(),
          projectId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error deleting project.";
        console.error("Failed to remove project", { projectId, error });
        if (isProjectDeleteBlockedByActiveThreads(message)) {
          toastManager.add({
            type: "warning",
            title: "Project is not empty",
            description: "Delete all threads in this project before deleting it.",
          });
          return;
        }
        toastManager.add({
          type: "error",
          title: `Failed to delete "${project.name}"`,
          description: message,
        });
      }
    },
    [clearComposerDraftForThread, clearProjectDraftThreadId, getDraftThreadByProjectId, projects],
  );

  const openProjectShell = useCallback(
    async (projectId: ProjectId) => {
      const project = projects.find((entry) => entry.id === projectId);
      if (!project) return;
      const shell = ensureProjectShell(project.id, defaultProjectShellConfig(project));
      setActiveShell(project.id, shell.id);
      await navigate({
        to: "/shells/$projectId",
        params: {
          projectId: project.id,
        },
      });
    },
    [navigate, projects, setActiveShell],
  );

  const createAndOpenProjectShell = useCallback(
    async (projectId: ProjectId) => {
      const project = projects.find((entry) => entry.id === projectId);
      if (!project) return;
      const shell = createProjectShell(project.id, defaultProjectShellConfig(project));
      setActiveShell(project.id, shell.id);
      await navigate({
        to: "/shells/$projectId",
        params: {
          projectId: project.id,
        },
      });
    },
    [navigate, projects, setActiveShell],
  );

  const selectThreadFromSidebar = useCallback(
    async (threadId: ThreadId) => {
      await navigate({
        to: "/$threadId",
        params: { threadId },
      });
      collapseMobileSidebar();
    },
    [collapseMobileSidebar, navigate],
  );

  const selectShellFromSidebar = useCallback(
    async (projectId: ProjectId, shellId: string) => {
      setActiveShell(projectId, shellId);
      await navigate({
        to: "/shells/$projectId",
        params: {
          projectId,
        },
      });
      collapseMobileSidebar();
    },
    [collapseMobileSidebar, navigate, setActiveShell],
  );

  const createThreadFromSidebar = useCallback(
    async (projectId: ProjectId) => {
      await handleNewThread(projectId);
      collapseMobileSidebar();
    },
    [collapseMobileSidebar, handleNewThread],
  );

  const createShellFromSidebar = useCallback(
    async (projectId: ProjectId) => {
      await createAndOpenProjectShell(projectId);
      collapseMobileSidebar();
    },
    [collapseMobileSidebar, createAndOpenProjectShell],
  );

  const openSettingsFromSidebar = useCallback(async () => {
    await navigate({ to: "/settings" });
    collapseMobileSidebar();
  }, [collapseMobileSidebar, navigate]);

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      const activeThread = routeThreadId
        ? threads.find((thread) => thread.id === routeThreadId)
        : undefined;
      const activeDraftThread = routeThreadId ? getDraftThread(routeThreadId) : null;
      if (isChatNewLocalShortcut(event, keybindings)) {
        const projectId =
          activeThread?.projectId ?? activeDraftThread?.projectId ?? projects[0]?.id;
        if (!projectId) return;
        event.preventDefault();
        void handleNewThread(projectId);
        return;
      }

      if (!isChatNewShortcut(event, keybindings)) return;
      const projectId = activeThread?.projectId ?? activeDraftThread?.projectId ?? projects[0]?.id;
      if (!projectId) return;
      event.preventDefault();
      void handleNewThread(projectId, {
        branch: activeThread?.branch ?? activeDraftThread?.branch ?? null,
        worktreePath: activeThread?.worktreePath ?? activeDraftThread?.worktreePath ?? null,
        envMode: activeDraftThread?.envMode ?? (activeThread?.worktreePath ? "worktree" : "local"),
      });
    };

    window.addEventListener("keydown", onWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
    };
  }, [getDraftThread, handleNewThread, keybindings, projects, routeThreadId, threads]);

  useEffect(() => {
    const onTerminalToggleShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const activeThread = routeThreadId
        ? threads.find((thread) => thread.id === routeThreadId)
        : undefined;
      const projectId =
        routeProjectShell.projectId ?? activeThread?.projectId ?? projects[0]?.id ?? null;
      if (!projectId) return;
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: false,
          terminalOpen: false,
        },
      });
      if (command !== "terminal.toggle") return;
      event.preventDefault();
      event.stopPropagation();
      void openProjectShell(projectId);
    };

    window.addEventListener("keydown", onTerminalToggleShortcut);
    return () => {
      window.removeEventListener("keydown", onTerminalToggleShortcut);
    };
  }, [
    keybindings,
    openProjectShell,
    projects,
    routeProjectShell.projectId,
    routeThreadId,
    threads,
  ]);

  const shellCreateShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "terminal.new"),
    [keybindings],
  );

  useEffect(() => {
    if (!isElectron) return;
    const bridge = window.desktopBridge;
    if (
      !bridge ||
      typeof bridge.getUpdateState !== "function" ||
      typeof bridge.onUpdateState !== "function"
    ) {
      return;
    }

    let disposed = false;
    let receivedSubscriptionUpdate = false;
    const unsubscribe = bridge.onUpdateState((nextState) => {
      if (disposed) return;
      receivedSubscriptionUpdate = true;
      setDesktopUpdateState(nextState);
    });

    void bridge
      .getUpdateState()
      .then((nextState) => {
        if (disposed || receivedSubscriptionUpdate) return;
        setDesktopUpdateState(nextState);
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  const showDesktopUpdateButton = isElectron && shouldShowDesktopUpdateButton(desktopUpdateState);

  const desktopUpdateTooltip = desktopUpdateState
    ? getDesktopUpdateButtonTooltip(desktopUpdateState)
    : "Update available";

  const desktopUpdateButtonDisabled = isDesktopUpdateButtonDisabled(desktopUpdateState);
  const desktopUpdateButtonAction = desktopUpdateState
    ? resolveDesktopUpdateButtonAction(desktopUpdateState)
    : "none";
  const desktopUpdateButtonInteractivityClasses = desktopUpdateButtonDisabled
    ? "cursor-not-allowed opacity-60"
    : "hover:bg-accent hover:text-foreground";
  const desktopUpdateButtonClasses =
    desktopUpdateState?.status === "downloaded"
      ? "text-emerald-500"
      : desktopUpdateState?.status === "downloading"
        ? "text-sky-400"
        : shouldHighlightDesktopUpdateError(desktopUpdateState)
          ? "text-rose-500 animate-pulse"
          : "text-amber-500 animate-pulse";
  const newThreadShortcutLabel = useMemo(
    () =>
      shortcutLabelForCommand(keybindings, "chat.newLocal") ??
      shortcutLabelForCommand(keybindings, "chat.new"),
    [keybindings],
  );

  const handleDesktopUpdateButtonClick = useCallback(() => {
    const bridge = window.desktopBridge;
    if (!bridge || !desktopUpdateState) return;
    if (desktopUpdateButtonDisabled || desktopUpdateButtonAction === "none") return;

    if (desktopUpdateButtonAction === "download") {
      void bridge
        .downloadUpdate()
        .then((result) => {
          if (result.completed) {
            toastManager.add({
              type: "success",
              title: "Update downloaded",
              description: "Restart the app from the update button to install it.",
            });
          }
          if (!shouldToastDesktopUpdateActionResult(result)) return;
          const actionError = getDesktopUpdateActionError(result);
          if (!actionError) return;
          toastManager.add({
            type: "error",
            title: "Could not download update",
            description: actionError,
          });
        })
        .catch((error) => {
          toastManager.add({
            type: "error",
            title: "Could not start update download",
            description: error instanceof Error ? error.message : "An unexpected error occurred.",
          });
        });
      return;
    }

    if (desktopUpdateButtonAction === "install") {
      void bridge
        .installUpdate()
        .then((result) => {
          if (!shouldToastDesktopUpdateActionResult(result)) return;
          const actionError = getDesktopUpdateActionError(result);
          if (!actionError) return;
          toastManager.add({
            type: "error",
            title: "Could not install update",
            description: actionError,
          });
        })
        .catch((error) => {
          toastManager.add({
            type: "error",
            title: "Could not install update",
            description: error instanceof Error ? error.message : "An unexpected error occurred.",
          });
        });
    }
  }, [desktopUpdateButtonAction, desktopUpdateButtonDisabled, desktopUpdateState]);

  const expandThreadListForProject = useCallback((projectId: ProjectId) => {
    setExpandedThreadListsByProject((current) => {
      if (current.has(projectId)) return current;
      const next = new Set(current);
      next.add(projectId);
      return next;
    });
  }, []);

  const collapseThreadListForProject = useCallback((projectId: ProjectId) => {
    setExpandedThreadListsByProject((current) => {
      if (!current.has(projectId)) return current;
      const next = new Set(current);
      next.delete(projectId);
      return next;
    });
  }, []);
  const projectBrowserDirectoryPath =
    projectBrowserQuery.data?.directoryPath ?? projectBrowserCurrentPath;
  const projectBrowserParentPath = projectBrowserQuery.data?.parentPath ?? null;
  const projectBrowserEntries = projectBrowserQuery.data?.entries ?? [];
  const visibleProjectBrowserEntries = filterProjectBrowserEntries(projectBrowserEntries, {
    showHidden: showHiddenProjectBrowserEntries,
  });
  const projectBrowserHasHiddenEntries = projectBrowserEntries.some((entry) =>
    isHiddenProjectBrowserEntry(entry),
  );
  const isCreatingProjectFolder = createProjectDirectoryMutation.isPending;

  const wordmark = (
    <div className={cn("flex items-center gap-2", isMobile && "items-start gap-3")}>
      <div
        className={cn(
          "mt-2 ml-1 flex min-w-0 flex-1 items-center gap-2",
          isMobile && "mt-0 ml-0 flex-col items-start gap-0.5",
        )}
      >
        <div className="flex items-center gap-2">
          <AppBrandMark />
          <AppWordmark />
        </div>
        {isMobile ? (
          <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground/65">
            Projects, threads, and shells
          </span>
        ) : null}
      </div>
    </div>
  );

  return (
    <>
      {isElectron ? (
        <>
          <SidebarHeader className="drag-region h-[52px] flex-row items-center gap-2 px-4 py-0 pl-[82px]">
            {wordmark}
            {showDesktopUpdateButton && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label={desktopUpdateTooltip}
                      aria-disabled={desktopUpdateButtonDisabled || undefined}
                      disabled={desktopUpdateButtonDisabled}
                      className={`inline-flex size-7 ml-auto mt-2 items-center justify-center rounded-md text-muted-foreground transition-colors ${desktopUpdateButtonInteractivityClasses} ${desktopUpdateButtonClasses}`}
                      onClick={handleDesktopUpdateButtonClick}
                    >
                      <RocketIcon className="size-3.5" />
                    </button>
                  }
                />
                <TooltipPopup side="bottom">{desktopUpdateTooltip}</TooltipPopup>
              </Tooltip>
            )}
          </SidebarHeader>
        </>
      ) : (
        <SidebarHeader
          className={cn(
            "gap-3 px-3 py-2 sm:gap-2.5 sm:px-4 sm:py-3",
            isMobile &&
              "border-b border-border/70 px-3 pt-[calc(var(--safe-area-inset-top)+0.85rem)] pb-3",
          )}
        >
          {wordmark}
          {isMobile ? (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-dashed border-border bg-background px-3 text-sm font-medium text-foreground/85 transition-colors duration-150 hover:border-ring hover:text-foreground"
                onClick={openProjectBrowser}
              >
                + Add project
              </button>
              <button
                type="button"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-border bg-background px-3 text-sm font-medium text-foreground/80 transition-colors duration-150 hover:border-ring hover:text-foreground"
                onClick={() => {
                  void openSettingsFromSidebar();
                }}
              >
                <SettingsIcon className="size-4" />
                <span>Settings</span>
              </button>
            </div>
          ) : null}
        </SidebarHeader>
      )}

      <SidebarContent className="gap-0">
        <SidebarGroup className={cn("px-2 py-2", isMobile && "px-3 py-3")}>
          <SidebarMenu>
            {projects.map((project) => {
              const projectThreads = threads
                .filter((thread) => thread.projectId === project.id)
                .toSorted((a, b) => {
                  const byDate = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
                  if (byDate !== 0) return byDate;
                  return b.id.localeCompare(a.id);
                });
              const projectShells = selectProjectShellCollection(shellStateByProjectId, project.id);
              const isThreadListExpanded = expandedThreadListsByProject.has(project.id);
              const hasHiddenThreads = projectThreads.length > THREAD_PREVIEW_LIMIT;
              const visibleThreads =
                hasHiddenThreads && !isThreadListExpanded
                  ? projectThreads.slice(0, THREAD_PREVIEW_LIMIT)
                  : projectThreads;

              return (
                <Collapsible
                  key={project.id}
                  className={cn("group/collapsible", isMobile && "mb-2.5")}
                  open={project.expanded}
                  onOpenChange={(open) => {
                    if (open === project.expanded) return;
                    toggleProject(project.id);
                  }}
                >
                  <SidebarMenuItem>
                    <div
                      className={cn(
                        "group/project-header relative",
                        isMobile &&
                          "overflow-hidden rounded-[1.35rem] border border-border/70 bg-card/75 shadow-[0_1px_0_rgba(0,0,0,0.03)]",
                      )}
                    >
                      <CollapsibleTrigger
                        render={
                          <SidebarMenuButton
                            size="sm"
                            className={cn(
                              "gap-2 px-2 py-1.5 text-left hover:bg-accent group-hover/project-header:bg-accent group-hover/project-header:text-sidebar-accent-foreground",
                              isMobile &&
                                "min-h-13 gap-3 rounded-[1.35rem] px-3 py-3 hover:bg-accent/60",
                            )}
                          />
                        }
                        onContextMenu={(event) => {
                          event.preventDefault();
                          void handleProjectContextMenu(project.id, {
                            x: event.clientX,
                            y: event.clientY,
                          });
                        }}
                      >
                        <ChevronRightIcon
                          className={cn(
                            "-ml-0.5 size-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-150",
                            isMobile && "ml-0 size-4",
                            project.expanded && "rotate-90",
                          )}
                        />
                        <ProjectFavicon cwd={project.cwd} />
                        <div className="min-w-0 flex-1">
                          <span
                            className={cn(
                              "block truncate font-medium text-foreground/90",
                              isMobile ? "text-sm" : "text-xs",
                            )}
                          >
                            {project.name}
                          </span>
                          {isMobile ? (
                            <span className="block truncate text-[11px] text-muted-foreground/65">
                              {projectThreads.length} thread{projectThreads.length === 1 ? "" : "s"}{" "}
                              • {projectShells.shells.length} shell
                              {projectShells.shells.length === 1 ? "" : "s"}
                            </span>
                          ) : null}
                        </div>
                      </CollapsibleTrigger>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <SidebarMenuAction
                              render={
                                <button
                                  type="button"
                                  aria-label={`Create new thread in ${project.name}`}
                                />
                              }
                              showOnHover={!isMobile}
                              className={cn(
                                "top-1 right-1 size-5 rounded-md p-0 text-muted-foreground/70 hover:bg-secondary hover:text-foreground",
                                isMobile &&
                                  "top-3 right-3 size-8 rounded-xl border border-border/70 bg-background/85 text-foreground/75 shadow-sm",
                              )}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                void createThreadFromSidebar(project.id);
                              }}
                            >
                              <SquarePenIcon className="size-3.5" />
                            </SidebarMenuAction>
                          }
                        />
                        <TooltipPopup side="top">
                          {newThreadShortcutLabel
                            ? `New thread (${newThreadShortcutLabel})`
                            : "New thread"}
                        </TooltipPopup>
                      </Tooltip>
                    </div>

                    <CollapsibleContent>
                      <SidebarMenuSub
                        className={cn(
                          "mx-1 my-0 w-full translate-x-0 gap-0 px-1.5 py-0",
                          isMobile && "mx-0 px-2 pb-2.5",
                        )}
                      >
                        {visibleThreads.map((thread) => {
                          const isActive = routeThreadId === thread.id;
                          const threadStatus = threadStatusPill(
                            thread,
                            pendingApprovalByThreadId.get(thread.id) === true,
                          );
                          const prStatus = prStatusIndicator(prByThreadId.get(thread.id) ?? null);

                          return (
                            <SidebarMenuSubItem key={thread.id} className="w-full">
                              <SidebarMenuSubButton
                                render={<div role="button" tabIndex={0} />}
                                size="sm"
                                isActive={isActive}
                                className={cn(
                                  "w-full translate-x-0 cursor-default justify-start px-2 text-left hover:bg-accent hover:text-foreground",
                                  isMobile ? "min-h-12 rounded-2xl px-3 py-2.5" : "h-7",
                                  isActive
                                    ? "bg-accent/85 text-foreground font-medium ring-1 ring-border/70 dark:bg-accent/55 dark:ring-border/50"
                                    : "text-muted-foreground",
                                )}
                                onClick={() => {
                                  void selectThreadFromSidebar(thread.id);
                                }}
                                onKeyDown={(event) => {
                                  if (event.key !== "Enter" && event.key !== " ") return;
                                  event.preventDefault();
                                  void selectThreadFromSidebar(thread.id);
                                }}
                                onContextMenu={(event) => {
                                  event.preventDefault();
                                  void handleThreadContextMenu(thread.id, {
                                    x: event.clientX,
                                    y: event.clientY,
                                  });
                                }}
                              >
                                <div className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
                                  {prStatus && (
                                    <Tooltip>
                                      <TooltipTrigger
                                        render={
                                          <button
                                            type="button"
                                            aria-label={prStatus.tooltip}
                                            className={`inline-flex items-center justify-center ${prStatus.colorClass} cursor-pointer rounded-sm outline-hidden focus-visible:ring-1 focus-visible:ring-ring`}
                                            onClick={(event) => {
                                              openPrLink(event, prStatus.url);
                                            }}
                                          >
                                            <GitPullRequestIcon className="size-3" />
                                          </button>
                                        }
                                      />
                                      <TooltipPopup side="top">{prStatus.tooltip}</TooltipPopup>
                                    </Tooltip>
                                  )}
                                  {threadStatus && (
                                    <span
                                      className={cn(
                                        "inline-flex items-center gap-1",
                                        threadStatus.colorClass,
                                        isMobile ? "text-[11px]" : "text-[10px]",
                                      )}
                                    >
                                      <span
                                        className={`h-1.5 w-1.5 rounded-full ${threadStatus.dotClass} ${
                                          threadStatus.pulse ? "animate-pulse" : ""
                                        }`}
                                      />
                                      <span
                                        className={cn(isMobile ? "inline" : "hidden md:inline")}
                                      >
                                        {threadStatus.label}
                                      </span>
                                    </span>
                                  )}
                                  {renamingThreadId === thread.id ? (
                                    <input
                                      ref={(el) => {
                                        if (el && renamingInputRef.current !== el) {
                                          renamingInputRef.current = el;
                                          el.focus();
                                          el.select();
                                        }
                                      }}
                                      className="min-w-0 flex-1 truncate text-xs bg-transparent outline-none border border-ring rounded px-0.5"
                                      value={renamingTitle}
                                      onChange={(e) => setRenamingTitle(e.target.value)}
                                      onKeyDown={(e) => {
                                        e.stopPropagation();
                                        if (e.key === "Enter") {
                                          e.preventDefault();
                                          renamingCommittedRef.current = true;
                                          void commitRename(thread.id, renamingTitle, thread.title);
                                        } else if (e.key === "Escape") {
                                          e.preventDefault();
                                          renamingCommittedRef.current = true;
                                          cancelRename();
                                        }
                                      }}
                                      onBlur={() => {
                                        if (!renamingCommittedRef.current) {
                                          void commitRename(thread.id, renamingTitle, thread.title);
                                        }
                                      }}
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                  ) : (
                                    <span
                                      className={cn(
                                        "min-w-0 flex-1 truncate",
                                        isMobile ? "text-sm leading-5" : "text-xs",
                                      )}
                                    >
                                      {thread.title}
                                    </span>
                                  )}
                                </div>
                                <div
                                  className={cn(
                                    "ml-auto flex shrink-0 items-center gap-1.5",
                                    isMobile && "pl-2",
                                  )}
                                >
                                  <span
                                    className={`${isMobile ? "text-[11px]" : "text-[10px]"} ${
                                      isActive ? "text-foreground/65" : "text-muted-foreground/40"
                                    }`}
                                  >
                                    {formatRelativeTime(thread.createdAt)}
                                  </span>
                                </div>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          );
                        })}

                        {hasHiddenThreads && !isThreadListExpanded && (
                          <SidebarMenuSubItem className="w-full">
                            <SidebarMenuSubButton
                              render={<button type="button" />}
                              size="sm"
                              className={cn(
                                "w-full translate-x-0 justify-start px-2 text-left text-muted-foreground/60 hover:bg-accent hover:text-muted-foreground/80",
                                isMobile
                                  ? "min-h-10 rounded-2xl px-3 text-[11px]"
                                  : "h-6 text-[10px]",
                              )}
                              onClick={() => {
                                expandThreadListForProject(project.id);
                              }}
                            >
                              <span>Show more</span>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        )}
                        {hasHiddenThreads && isThreadListExpanded && (
                          <SidebarMenuSubItem className="w-full">
                            <SidebarMenuSubButton
                              render={<button type="button" />}
                              size="sm"
                              className={cn(
                                "w-full translate-x-0 justify-start px-2 text-left text-muted-foreground/60 hover:bg-accent hover:text-muted-foreground/80",
                                isMobile
                                  ? "min-h-10 rounded-2xl px-3 text-[11px]"
                                  : "h-6 text-[10px]",
                              )}
                              onClick={() => {
                                collapseThreadListForProject(project.id);
                              }}
                            >
                              <span>Show less</span>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        )}

                        <div
                          className={cn(
                            "px-2 pt-2 pb-1 text-[10px] font-semibold tracking-[0.14em] text-muted-foreground/60 uppercase",
                            isMobile && "px-3 pt-3 text-[11px]",
                          )}
                        >
                          Shells
                        </div>

                        {projectShells.shells.map((shell) => {
                          const isActive =
                            routeProjectShell.projectId === project.id &&
                            routeProjectShell.shellId === shell.id;
                          const isRunning = projectShells.runningShellIds.includes(shell.id);

                          return (
                            <SidebarMenuSubItem key={shell.id} className="w-full">
                              <SidebarMenuSubButton
                                render={<div role="button" tabIndex={0} />}
                                size="sm"
                                isActive={isActive}
                                className={cn(
                                  "w-full translate-x-0 cursor-default justify-start px-2 text-left hover:bg-accent hover:text-foreground",
                                  isMobile ? "min-h-12 rounded-2xl px-3 py-2.5" : "h-7",
                                  isActive
                                    ? "bg-accent/85 text-foreground font-medium ring-1 ring-border/70 dark:bg-accent/55 dark:ring-border/50"
                                    : "text-muted-foreground",
                                )}
                                onClick={() => {
                                  void selectShellFromSidebar(project.id, shell.id);
                                }}
                                onKeyDown={(event) => {
                                  if (event.key !== "Enter" && event.key !== " ") return;
                                  event.preventDefault();
                                  void selectShellFromSidebar(project.id, shell.id);
                                }}
                              >
                                <div className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
                                  <TerminalIcon
                                    className={cn("shrink-0", isMobile ? "size-4" : "size-3.5")}
                                  />
                                  <div className="min-w-0 flex-1">
                                    <span
                                      className={cn(
                                        "block truncate",
                                        isMobile ? "text-sm" : "text-xs",
                                      )}
                                    >
                                      {shell.title}
                                    </span>
                                    <span
                                      className={cn(
                                        "block truncate text-muted-foreground/70",
                                        isMobile ? "text-[11px]" : "text-[10px]",
                                      )}
                                    >
                                      {shell.cwd}
                                    </span>
                                  </div>
                                </div>
                                <div className="ml-auto flex shrink-0 items-center gap-1.5">
                                  {isRunning && (
                                    <span
                                      role="img"
                                      aria-label="Shell process running"
                                      title="Shell process running"
                                      className="inline-flex items-center justify-center text-teal-600 dark:text-teal-300/90"
                                    >
                                      <TerminalIcon className="size-3 animate-pulse" />
                                    </span>
                                  )}
                                  <span
                                    className={`${isMobile ? "text-[11px]" : "text-[10px]"} ${
                                      isActive ? "text-foreground/65" : "text-muted-foreground/40"
                                    }`}
                                  >
                                    {formatRelativeTime(shell.createdAt)}
                                  </span>
                                </div>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          );
                        })}

                        <SidebarMenuSubItem className="w-full">
                          <SidebarMenuSubButton
                            render={<button type="button" />}
                            size="sm"
                            className={cn(
                              "w-full translate-x-0 justify-start px-2 text-left text-muted-foreground/70 hover:bg-accent hover:text-foreground",
                              isMobile
                                ? "min-h-10 rounded-2xl px-3 text-[11px]"
                                : "h-6 text-[10px]",
                            )}
                            onClick={() => {
                              void createShellFromSidebar(project.id);
                            }}
                          >
                            <TerminalIcon className="size-3.5 shrink-0" />
                            <span>
                              {shellCreateShortcutLabel
                                ? `New shell (${shellCreateShortcutLabel})`
                                : "New shell"}
                            </span>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </SidebarMenuItem>
                </Collapsible>
              );
            })}
          </SidebarMenu>

          {projects.length === 0 && !addingProject && (
            <div
              className={cn(
                "px-2 pt-4 text-center text-xs text-muted-foreground/60",
                isMobile &&
                  "rounded-[1.4rem] border border-dashed border-border/70 bg-card/55 px-4 py-6 text-sm",
              )}
            >
              No projects yet.
              <br />
              Add one to get started.
            </div>
          )}
        </SidebarGroup>
      </SidebarContent>

      {!isMobile || mobilePresentation === "sheet" ? <SidebarSeparator /> : null}
      <SidebarFooter
        className={cn(
          "gap-2 p-3",
          isMobile &&
            mobilePresentation === "sheet" &&
            "border-t border-border/70 bg-background/96 px-3 pt-3 pb-[calc(var(--safe-area-inset-bottom)+0.85rem)] backdrop-blur-sm",
          isMobile && mobilePresentation === "page" && "hidden",
        )}
      >
        {!isMobile ? (
          <>
            <button
              type="button"
              className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-border py-2 text-xs text-muted-foreground/70 transition-colors duration-150 hover:border-ring hover:text-muted-foreground"
              onClick={openProjectBrowser}
            >
              + Add project
            </button>
            <button
              type="button"
              className="flex w-full items-center justify-center gap-2 rounded-md border border-border py-2 text-xs text-muted-foreground/80 transition-colors duration-150 hover:border-ring hover:text-foreground"
              onClick={() => {
                void openSettingsFromSidebar();
              }}
            >
              <SettingsIcon className="size-3.5" />
              <span>Settings</span>
            </button>
          </>
        ) : mobilePresentation === "sheet" ? (
          <div className="rounded-2xl border border-border/70 bg-card/80 px-3 py-2 text-[11px] text-muted-foreground/65">
            Swipe from the left edge in chat or shell to reopen this navigator.
          </div>
        ) : null}
      </SidebarFooter>

      <Dialog open={addingProject} onOpenChange={handleProjectBrowserOpenChange}>
        <DialogPopup
          className={cn(
            "max-w-2xl",
            isMobile &&
              "app-mobile-viewport h-[calc(var(--app-mobile-viewport-height)-1rem)] max-w-none rounded-[1.75rem] p-0",
          )}
        >
          <DialogHeader>
            <DialogTitle>Add project</DialogTitle>
            <DialogDescription>
              Browse folders under the server cwd and pick one as the project root.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className={cn("space-y-4", isMobile && "flex min-h-0 flex-1 flex-col p-4")}>
            <div className="rounded-xl border border-border bg-muted/30">
              <div className="border-b border-border px-4 py-3">
                <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">
                  <FolderIcon className="size-3.5" />
                  <span>Current folder</span>
                </div>
                <p className="mt-2 break-all font-mono text-xs text-foreground/90">
                  {projectBrowserDirectoryPath ?? projectBrowserRootPath ?? "Waiting for server..."}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (!projectBrowserParentPath) return;
                      setProjectBrowserCurrentPath(projectBrowserParentPath);
                    }}
                    disabled={!projectBrowserParentPath || projectBrowserQuery.isLoading}
                  >
                    <ArrowUpIcon className="size-4" />
                    Up
                  </Button>
                  {isElectron && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handlePickFolder()}
                      disabled={isPickingFolder || isAddingProject}
                    >
                      {isPickingFolder ? "Picking outside cwd..." : "Pick outside cwd"}
                    </Button>
                  )}
                </div>
                <label className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-background/70 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">Show hidden files and folders</p>
                    <p className="text-xs text-muted-foreground">
                      Hidden entries stay out of the picker unless you enable them.
                    </p>
                  </div>
                  <Switch
                    checked={showHiddenProjectBrowserEntries}
                    onCheckedChange={(checked) =>
                      setShowHiddenProjectBrowserEntries(Boolean(checked))
                    }
                    aria-label="Show hidden files and folders"
                  />
                </label>
              </div>

              <ScrollArea className={cn(isMobile ? "h-[min(56dvh,30rem)]" : "h-72")}>
                {!projectBrowserRootPath ? (
                  <div className="px-4 py-6 text-sm text-muted-foreground">
                    Waiting for the server cwd.
                  </div>
                ) : projectBrowserQuery.isLoading ? (
                  <div className="px-4 py-6 text-sm text-muted-foreground">Loading folders...</div>
                ) : projectBrowserQuery.isError ? (
                  <div className="px-4 py-6 text-sm text-destructive">
                    {projectBrowserQuery.error instanceof Error
                      ? projectBrowserQuery.error.message
                      : "Unable to load folder contents."}
                  </div>
                ) : visibleProjectBrowserEntries.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-muted-foreground">
                    {projectBrowserHasHiddenEntries
                      ? "Only hidden files or folders are in this location."
                      : "This folder is empty."}
                  </div>
                ) : (
                  <div className="p-2">
                    {visibleProjectBrowserEntries.map((entry) =>
                      entry.kind === "directory" ? (
                        <button
                          key={entry.path}
                          type="button"
                          className={cn(
                            "flex w-full items-center gap-3 text-left text-sm transition-colors hover:bg-accent",
                            isMobile ? "min-h-12 rounded-2xl px-3 py-3" : "rounded-lg px-3 py-2",
                          )}
                          onClick={() => setProjectBrowserCurrentPath(entry.path)}
                        >
                          <FolderIcon className="size-4 shrink-0 text-muted-foreground/80" />
                          <span className="min-w-0 flex-1 truncate text-foreground">
                            {entry.name}
                          </span>
                          <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/60" />
                        </button>
                      ) : (
                        <div
                          key={entry.path}
                          className={cn(
                            "flex w-full items-center gap-3 text-left text-sm text-muted-foreground/75",
                            isMobile ? "min-h-12 rounded-2xl px-3 py-3" : "rounded-lg px-3 py-2",
                          )}
                        >
                          <FileIcon className="size-4 shrink-0 text-muted-foreground/65" />
                          <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                        </div>
                      ),
                    )}
                  </div>
                )}
              </ScrollArea>
            </div>

            <div className="rounded-xl border border-border bg-muted/20 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground/90">
                <FolderPlusIcon className="size-4" />
                <span>Create folder here</span>
              </div>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <Input
                  placeholder="New folder name"
                  value={newProjectFolderName}
                  onChange={(event) => setNewProjectFolderName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void handleCreateProjectFolder();
                    }
                  }}
                />
                <Button
                  variant="outline"
                  onClick={() => void handleCreateProjectFolder()}
                  disabled={
                    !projectBrowserDirectoryPath ||
                    newProjectFolderName.trim().length === 0 ||
                    isCreatingProjectFolder
                  }
                >
                  {isCreatingProjectFolder ? "Creating..." : "Create folder"}
                </Button>
              </div>
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => handleProjectBrowserOpenChange(false)}
              disabled={isAddingProject}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void addProjectFromPath(projectBrowserDirectoryPath ?? "")}
              disabled={
                !projectBrowserDirectoryPath || projectBrowserQuery.isLoading || isAddingProject
              }
            >
              {isAddingProject
                ? "Adding..."
                : `Use ${projectBrowserDirectoryPath ? basenameOfPath(projectBrowserDirectoryPath) : "folder"}`}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
