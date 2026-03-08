import { FitAddon } from "@xterm/addon-fit";
import {
  DEFAULT_TERMINAL_ID,
  type ProjectId,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import { Terminal, type ITheme } from "@xterm/xterm";
import { PlusIcon, SquareTerminalIcon, TerminalIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { serverConfigQueryOptions } from "../lib/serverReactQuery";
import {
  isTerminalClearShortcut,
  resolveShortcutCommand,
  shortcutLabelForCommand,
  terminalNavigationShortcutData,
} from "../keybindings";
import { cn } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import {
  closeProjectShell,
  createProjectShell,
  defaultProjectShellConfig,
  runProjectScriptInShell,
} from "../projectShellRunner";
import { projectScriptIdFromCommand } from "../projectScripts";
import { projectShellRuntimeThreadId } from "../projectShells";
import { selectProjectShellCollection, useProjectShellStore } from "../projectShellStore";
import { type Project } from "../types";
import {
  extractTerminalLinks,
  isTerminalLinkActivation,
  preferredTerminalEditor,
  resolvePathLinkTarget,
} from "../terminal-links";
import ProjectScriptsControl, { type NewProjectScriptInput } from "./ProjectScriptsControl";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { SidebarTrigger } from "./ui/sidebar";

const EMPTY_KEYBINDINGS: ResolvedKeybindingsConfig = [];

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function writeSystemMessage(terminal: Terminal, message: string): void {
  terminal.write(`\r\n[shell] ${message}\r\n`);
}

function terminalThemeFromApp(): ITheme {
  const isDark = document.documentElement.classList.contains("dark");
  const bodyStyles = getComputedStyle(document.body);
  const background =
    bodyStyles.backgroundColor || (isDark ? "rgb(14, 18, 24)" : "rgb(255, 255, 255)");
  const foreground = bodyStyles.color || (isDark ? "rgb(237, 241, 247)" : "rgb(28, 33, 41)");

  if (isDark) {
    return {
      background,
      foreground,
      cursor: "rgb(180, 203, 255)",
      selectionBackground: "rgba(180, 203, 255, 0.25)",
      scrollbarSliderBackground: "rgba(255, 255, 255, 0.1)",
      scrollbarSliderHoverBackground: "rgba(255, 255, 255, 0.18)",
      scrollbarSliderActiveBackground: "rgba(255, 255, 255, 0.22)",
      black: "rgb(24, 30, 38)",
      red: "rgb(255, 122, 142)",
      green: "rgb(134, 231, 149)",
      yellow: "rgb(244, 205, 114)",
      blue: "rgb(137, 190, 255)",
      magenta: "rgb(208, 176, 255)",
      cyan: "rgb(124, 232, 237)",
      white: "rgb(210, 218, 230)",
      brightBlack: "rgb(110, 120, 136)",
      brightRed: "rgb(255, 168, 180)",
      brightGreen: "rgb(176, 245, 186)",
      brightYellow: "rgb(255, 224, 149)",
      brightBlue: "rgb(174, 210, 255)",
      brightMagenta: "rgb(229, 203, 255)",
      brightCyan: "rgb(167, 244, 247)",
      brightWhite: "rgb(244, 247, 252)",
    };
  }

  return {
    background,
    foreground,
    cursor: "rgb(38, 56, 78)",
    selectionBackground: "rgba(37, 63, 99, 0.2)",
    scrollbarSliderBackground: "rgba(0, 0, 0, 0.15)",
    scrollbarSliderHoverBackground: "rgba(0, 0, 0, 0.25)",
    scrollbarSliderActiveBackground: "rgba(0, 0, 0, 0.3)",
    black: "rgb(44, 53, 66)",
    red: "rgb(191, 70, 87)",
    green: "rgb(60, 126, 86)",
    yellow: "rgb(146, 112, 35)",
    blue: "rgb(72, 102, 163)",
    magenta: "rgb(132, 86, 149)",
    cyan: "rgb(53, 127, 141)",
    white: "rgb(210, 215, 223)",
    brightBlack: "rgb(112, 123, 140)",
    brightRed: "rgb(212, 95, 112)",
    brightGreen: "rgb(85, 148, 111)",
    brightYellow: "rgb(173, 133, 45)",
    brightBlue: "rgb(91, 124, 194)",
    brightMagenta: "rgb(153, 107, 172)",
    brightCyan: "rgb(70, 149, 164)",
    brightWhite: "rgb(236, 240, 246)",
  };
}

function ShellTerminalViewport({
  projectId,
  shellId,
  cwd,
  runtimeEnv,
  focusRequestId,
}: {
  projectId: ProjectId;
  shellId: string;
  cwd: string;
  runtimeEnv: Record<string, string>;
  focusRequestId: number;
}) {
  const runtimeThreadId = useMemo(
    () => projectShellRuntimeThreadId(projectId, shellId),
    [projectId, shellId],
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    const mount = containerRef.current;
    if (!mount) {
      return;
    }

    const api = readNativeApi();
    if (!api) {
      return;
    }

    let disposed = false;
    const fitAddon = new FitAddon();
    const terminal = new Terminal({
      cursorBlink: true,
      lineHeight: 1.2,
      fontSize: 12,
      scrollback: 5_000,
      fontFamily: '"SF Mono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
      theme: terminalThemeFromApp(),
    });
    terminal.loadAddon(fitAddon);
    terminal.open(mount);
    fitAddon.fit();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const themeObserver = new MutationObserver(() => {
      const activeTerminal = terminalRef.current;
      if (!activeTerminal) {
        return;
      }
      activeTerminal.options.theme = terminalThemeFromApp();
      activeTerminal.refresh(0, activeTerminal.rows - 1);
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });

    terminal.attachCustomKeyEventHandler((event) => {
      const navigationData = terminalNavigationShortcutData(event);
      if (navigationData !== null) {
        event.preventDefault();
        event.stopPropagation();
        void api.terminal
          .write({
            threadId: runtimeThreadId,
            terminalId: DEFAULT_TERMINAL_ID,
            data: navigationData,
          })
          .catch((error) =>
            writeSystemMessage(
              terminal,
              error instanceof Error ? error.message : "Failed to move cursor",
            ),
          );
        return false;
      }

      if (!isTerminalClearShortcut(event)) {
        return true;
      }

      event.preventDefault();
      event.stopPropagation();
      void api.terminal
        .write({
          threadId: runtimeThreadId,
          terminalId: DEFAULT_TERMINAL_ID,
          data: "\u000c",
        })
        .catch((error) =>
          writeSystemMessage(
            terminal,
            error instanceof Error ? error.message : "Failed to clear shell",
          ),
        );
      return false;
    });

    const linkDisposable = terminal.registerLinkProvider({
      provideLinks: (bufferLineNumber, callback) => {
        const activeTerminal = terminalRef.current;
        if (!activeTerminal) {
          callback(undefined);
          return;
        }
        const line = activeTerminal.buffer.active.getLine(bufferLineNumber - 1);
        if (!line) {
          callback(undefined);
          return;
        }
        const lineText = line.translateToString(true);
        const matches = extractTerminalLinks(lineText);
        if (matches.length === 0) {
          callback(undefined);
          return;
        }
        callback(
          matches.map((match) => ({
            text: match.text,
            range: {
              start: { x: match.start + 1, y: bufferLineNumber },
              end: { x: match.end, y: bufferLineNumber },
            },
            activate: (event: MouseEvent) => {
              if (!isTerminalLinkActivation(event)) {
                return;
              }

              const latestTerminal = terminalRef.current;
              if (!latestTerminal) {
                return;
              }

              if (match.kind === "url") {
                void api.shell
                  .openExternal(match.text)
                  .catch((error) =>
                    writeSystemMessage(
                      latestTerminal,
                      error instanceof Error ? error.message : "Unable to open link",
                    ),
                  );
                return;
              }

              const target = resolvePathLinkTarget(match.text, cwd);
              void api.shell
                .openInEditor(target, preferredTerminalEditor())
                .catch((error) =>
                  writeSystemMessage(
                    latestTerminal,
                    error instanceof Error ? error.message : "Unable to open path",
                  ),
                );
            },
          })),
        );
      },
    });

    const inputDisposable = terminal.onData((data) => {
      void api.terminal
        .write({
          threadId: runtimeThreadId,
          terminalId: DEFAULT_TERMINAL_ID,
          data,
        })
        .catch((error) =>
          writeSystemMessage(
            terminal,
            error instanceof Error ? error.message : "Shell write failed",
          ),
        );
    });

    const openShell = async () => {
      try {
        fitAddon.fit();
        const snapshot = await api.terminal.open({
          threadId: runtimeThreadId,
          terminalId: DEFAULT_TERMINAL_ID,
          cwd,
          cols: terminal.cols,
          rows: terminal.rows,
          env: runtimeEnv,
        });
        if (disposed) {
          return;
        }
        terminal.write("\u001bc");
        if (snapshot.history.length > 0) {
          terminal.write(snapshot.history);
        }
      } catch (error) {
        if (disposed) {
          return;
        }
        writeSystemMessage(
          terminal,
          error instanceof Error ? error.message : "Failed to open shell",
        );
      }
    };

    const unsubscribe = api.terminal.onEvent((event) => {
      if (event.threadId !== runtimeThreadId) {
        return;
      }

      const activeTerminal = terminalRef.current;
      if (!activeTerminal) {
        return;
      }

      if (event.type === "output") {
        activeTerminal.write(event.data);
        return;
      }
      if (event.type === "started" || event.type === "restarted") {
        activeTerminal.write("\u001bc");
        if (event.snapshot.history.length > 0) {
          activeTerminal.write(event.snapshot.history);
        }
        return;
      }
      if (event.type === "cleared") {
        activeTerminal.clear();
        activeTerminal.write("\u001bc");
        return;
      }
      if (event.type === "error") {
        writeSystemMessage(activeTerminal, event.message);
        return;
      }
      if (event.type === "exited") {
        const details = [
          typeof event.exitCode === "number" ? `code ${event.exitCode}` : null,
          typeof event.exitSignal === "number" ? `signal ${event.exitSignal}` : null,
        ]
          .filter((value): value is string => value !== null)
          .join(", ");
        writeSystemMessage(
          activeTerminal,
          details.length > 0 ? `Process exited (${details})` : "Process exited",
        );
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      const activeTerminal = terminalRef.current;
      const activeFitAddon = fitAddonRef.current;
      if (!activeTerminal || !activeFitAddon) {
        return;
      }
      const wasAtBottom =
        activeTerminal.buffer.active.viewportY >= activeTerminal.buffer.active.baseY;
      activeFitAddon.fit();
      if (wasAtBottom) {
        activeTerminal.scrollToBottom();
      }
      void api.terminal
        .resize({
          threadId: runtimeThreadId,
          terminalId: DEFAULT_TERMINAL_ID,
          cols: activeTerminal.cols,
          rows: activeTerminal.rows,
        })
        .catch(() => undefined);
    });
    resizeObserver.observe(mount);

    void openShell();

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      unsubscribe();
      inputDisposable.dispose();
      linkDisposable.dispose();
      themeObserver.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [cwd, projectId, runtimeEnv, runtimeThreadId, shellId]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      terminal.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [focusRequestId]);

  return (
    <div
      ref={containerRef}
      className="project-shell-terminal h-full min-h-0 w-full overflow-hidden rounded-xl"
    />
  );
}

export default function ProjectShellsView({
  project,
  shellId,
  onAddProjectScript,
  onUpdateProjectScript,
}: {
  project: Project;
  shellId: string;
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<void>;
  onUpdateProjectScript: (scriptId: string, input: NewProjectScriptInput) => Promise<void>;
}) {
  const navigate = useNavigate();
  const [focusRequestId, setFocusRequestId] = useState(0);
  const collection = useProjectShellStore((state) =>
    selectProjectShellCollection(state.shellStateByProjectId, project.id),
  );
  const setActiveShell = useProjectShellStore((state) => state.setActiveShell);
  const { data: keybindings = EMPTY_KEYBINDINGS } = useQuery({
    ...serverConfigQueryOptions(),
    select: (config) => config.keybindings,
  });

  const activeShell =
    collection.shells.find((shell) => shell.id === shellId) ?? collection.shells[0] ?? null;

  const openShell = useCallback(
    async (nextShellId: string) => {
      setActiveShell(project.id, nextShellId);
      await navigate({
        to: "/shells/$projectId/$shellId",
        params: {
          projectId: project.id,
          shellId: nextShellId,
        },
      });
    },
    [navigate, project.id, setActiveShell],
  );

  const createShellAndOpen = useCallback(async () => {
    const shell = createProjectShell(project.id, defaultProjectShellConfig(project));
    await openShell(shell.id);
  }, [openShell, project]);

  const closeActiveShell = useCallback(async () => {
    if (!activeShell) {
      return;
    }
    await closeProjectShell(project.id, activeShell.id).catch(() => undefined);
    await navigate({
      to: "/shells/$projectId",
      params: {
        projectId: project.id,
      },
      replace: true,
    });
  }, [activeShell, navigate, project.id]);

  const runScript = useCallback(
    async (script: Project["scripts"][number], preferNewShell = false) => {
      const shell = await runProjectScriptInShell({
        project,
        script,
        preferNewShell,
      });
      await openShell(shell.id);
      setFocusRequestId((current) => current + 1);
    },
    [openShell, project],
  );

  useEffect(() => {
    if (collection.shells.length === 0) {
      void createShellAndOpen();
      return;
    }
    if (!activeShell || activeShell.id === shellId) {
      return;
    }
    void navigate({
      to: "/shells/$projectId/$shellId",
      params: {
        projectId: project.id,
        shellId: activeShell.id,
      },
      replace: true,
    });
  }, [activeShell, collection.shells.length, createShellAndOpen, navigate, project.id, shellId]);

  useEffect(() => {
    if (!activeShell) {
      return;
    }
    setActiveShell(project.id, activeShell.id);
  }, [activeShell, project.id, setActiveShell]);

  useEffect(() => {
    const isTerminalFocused = (): boolean => {
      const activeElement = document.activeElement;
      if (!(activeElement instanceof HTMLElement)) {
        return false;
      }
      if (activeElement.classList.contains("xterm-helper-textarea")) {
        return true;
      }
      return activeElement.closest(".project-shell-terminal .xterm") !== null;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !activeShell) {
        return;
      }
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen: true,
        },
      });
      if (!command) {
        return;
      }

      if (command === "terminal.toggle") {
        event.preventDefault();
        event.stopPropagation();
        setFocusRequestId((current) => current + 1);
        return;
      }

      if (command === "terminal.new" || command === "terminal.split") {
        event.preventDefault();
        event.stopPropagation();
        void createShellAndOpen().then(() => {
          setFocusRequestId((current) => current + 1);
        });
        return;
      }

      if (command === "terminal.close") {
        event.preventDefault();
        event.stopPropagation();
        void closeActiveShell();
        return;
      }

      const scriptId = projectScriptIdFromCommand(command);
      if (!scriptId) {
        return;
      }
      const script = project.scripts.find((entry) => entry.id === scriptId);
      if (!script) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      void runScript(script);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeShell, closeActiveShell, createShellAndOpen, keybindings, project, runScript]);

  const newShellShortcutLabel = shortcutLabelForCommand(keybindings, "terminal.new");
  const closeShellShortcutLabel = shortcutLabelForCommand(keybindings, "terminal.close");

  if (!activeShell) {
    return null;
  }

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-background text-foreground">
      <header className="border-b border-border/70 px-3 py-3 sm:px-4">
        <div className="flex items-center gap-2">
          <SidebarTrigger className="size-7 shrink-0 md:hidden" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-sm font-semibold">{project.name}</h1>
              <Badge variant="outline" className="hidden sm:inline-flex">
                Shells
              </Badge>
            </div>
            <p className="truncate text-xs text-muted-foreground">{activeShell.cwd}</p>
          </div>
          <Button
            size="xs"
            variant="outline"
            title={newShellShortcutLabel ? `New shell (${newShellShortcutLabel})` : "New shell"}
            onClick={() => {
              void createShellAndOpen();
            }}
          >
            <PlusIcon className="size-3.5" />
            <span className="hidden sm:inline">New Shell</span>
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="border-b border-border/70 bg-card/35 lg:flex lg:w-80 lg:min-w-80 lg:flex-col lg:border-r lg:border-b-0">
          <div className="space-y-3 p-3 sm:p-4">
            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
                    Project Shells
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Shells are shared across this project.
                  </p>
                </div>
                <Button
                  size="icon-xs"
                  variant="outline"
                  aria-label="Create shell"
                  onClick={() => {
                    void createShellAndOpen();
                  }}
                >
                  <PlusIcon className="size-3.5" />
                </Button>
              </div>

              <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-y-auto lg:pb-0">
                {collection.shells.map((shell) => {
                  const isActive = shell.id === activeShell.id;
                  const isRunning = collection.runningShellIds.includes(shell.id);
                  return (
                    <button
                      key={shell.id}
                      type="button"
                      className={cn(
                        "flex min-w-52 flex-col items-start gap-1 rounded-2xl border px-3 py-3 text-left transition-colors lg:min-w-0",
                        isActive
                          ? "border-border bg-accent text-accent-foreground"
                          : "border-border/60 bg-background/80 hover:bg-accent/60",
                      )}
                      onClick={() => {
                        void openShell(shell.id).then(() => {
                          setFocusRequestId((current) => current + 1);
                        });
                      }}
                    >
                      <div className="flex w-full items-center gap-2">
                        <div className="inline-flex size-8 items-center justify-center rounded-xl bg-muted/70">
                          <SquareTerminalIcon className="size-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{shell.title}</p>
                          <p className="truncate text-[11px] text-muted-foreground">{shell.cwd}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        {isRunning ? (
                          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-300/90">
                            <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            Running
                          </span>
                        ) : (
                          <span>Idle</span>
                        )}
                        <span>{formatRelativeTime(shell.createdAt)}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="space-y-2 rounded-2xl border border-border/70 bg-background/70 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
                    Commands
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Save project-wide shell commands and run them in a shared shell.
                  </p>
                </div>
                <TerminalIcon className="mt-0.5 size-4 text-muted-foreground" />
              </div>

              <ProjectScriptsControl
                scripts={project.scripts}
                keybindings={keybindings}
                onRunScript={(script) => {
                  void runScript(script);
                }}
                onAddScript={onAddProjectScript}
                onUpdateScript={onUpdateProjectScript}
              />

              {project.scripts.length > 0 && (
                <div className="space-y-2">
                  {project.scripts.map((script) => (
                    <div
                      key={script.id}
                      className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-background px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{script.name}</p>
                        <p className="truncate font-mono text-[11px] text-muted-foreground">
                          {script.command}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => {
                            void runScript(script);
                          }}
                        >
                          Run
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => {
                            void runScript(script, true);
                          }}
                        >
                          New Shell
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </aside>

        <main className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-border/70 px-3 py-3 sm:px-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-sm font-medium">{activeShell.title}</h2>
                {collection.runningShellIds.includes(activeShell.id) && (
                  <Badge variant="outline" className="text-emerald-600 dark:text-emerald-300/90">
                    Live
                  </Badge>
                )}
              </div>
              <p className="truncate text-xs text-muted-foreground">{activeShell.cwd}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="icon-xs"
                variant="outline"
                aria-label="Focus shell"
                onClick={() => {
                  setFocusRequestId((current) => current + 1);
                }}
              >
                <TerminalIcon className="size-3.5" />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={
                  closeShellShortcutLabel
                    ? `Close shell (${closeShellShortcutLabel})`
                    : "Close shell"
                }
                onClick={() => {
                  void closeActiveShell();
                }}
              >
                <Trash2Icon className="size-3.5" />
              </Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 p-3 sm:p-4">
            <div className="h-full min-h-[24rem] rounded-2xl border border-border/70 bg-card/40 p-2 shadow-sm">
              <ShellTerminalViewport
                projectId={project.id}
                shellId={activeShell.id}
                cwd={activeShell.cwd}
                runtimeEnv={activeShell.env}
                focusRequestId={focusRequestId}
              />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
