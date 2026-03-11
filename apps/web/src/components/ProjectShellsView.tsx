import { FitAddon } from "@xterm/addon-fit";
import {
  DEFAULT_TERMINAL_ID,
  type ProjectId,
  type ResolvedKeybindingsConfig,
} from "@fatma/contracts";
import { Terminal, type ITheme } from "@xterm/xterm";
import { PlusIcon, SquareTerminalIcon, Trash2Icon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent,
} from "react";

import {
  isTerminalClearShortcut,
  resolveShortcutCommand,
  shortcutLabelForCommand,
  terminalNavigationShortcutData,
} from "../keybindings";
import { serverConfigQueryOptions } from "../lib/serverReactQuery";
import { cn } from "../lib/utils";
import { useMobileViewport } from "../mobileViewport";
import { readNativeApi } from "../nativeApi";
import {
  closeProjectShell,
  createProjectShell,
  defaultProjectShellConfig,
} from "../projectShellRunner";
import { projectShellRuntimeThreadId } from "../projectShells";
import { selectProjectShellCollection, useProjectShellStore } from "../projectShellStore";
import {
  extractTerminalLinks,
  isTerminalLinkActivation,
  preferredTerminalEditor,
  resolvePathLinkTarget,
} from "../terminal-links";
import { type Project } from "../types";
import { Button } from "./ui/button";

const EMPTY_KEYBINDINGS: ResolvedKeybindingsConfig = [];
const DESKTOP_TERMINAL_FONT_SIZE = 12;
const MOBILE_TERMINAL_FONT_SIZE = 15;
const MOBILE_SELECTION_LONG_PRESS_MS = 420;
const MOBILE_SELECTION_MOVE_THRESHOLD_PX = 10;

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
      selectionInactiveBackground: "rgba(180, 203, 255, 0.18)",
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
    selectionInactiveBackground: "rgba(37, 63, 99, 0.14)",
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

function controlModifiedInput(data: string): string {
  if (data.length !== 1) {
    return data;
  }

  const character = data.toUpperCase();
  if (character === "?") {
    return "\u007f";
  }

  const code = character.charCodeAt(0);
  if (code >= 64 && code <= 95) {
    return String.fromCharCode(code - 64);
  }

  return data;
}

interface ShellTerminalHandle {
  focus: () => void;
}

interface ShellTerminalViewportProps {
  projectId: ProjectId;
  shellId: string;
  cwd: string;
  runtimeEnv: Record<string, string>;
  fontSize: number;
  autoFocus: boolean;
  isMobile: boolean;
  selectionMode: boolean;
  onSelectionModeChange: (open: boolean) => void;
  transformUserInput: (data: string) => string;
}

const ShellTerminalViewport = forwardRef<ShellTerminalHandle, ShellTerminalViewportProps>(
  function ShellTerminalViewport(props, forwardedRef) {
    const runtimeThreadId = useMemo(
      () => projectShellRuntimeThreadId(props.projectId, props.shellId),
      [props.projectId, props.shellId],
    );
    const containerRef = useRef<HTMLDivElement>(null);
    const terminalRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const transformUserInputRef = useRef(props.transformUserInput);
    const longPressTimerRef = useRef<number | null>(null);
    const longPressOriginRef = useRef<{ x: number; y: number } | null>(null);

    useEffect(() => {
      transformUserInputRef.current = props.transformUserInput;
    }, [props.transformUserInput]);

    const clearLongPressTimer = useCallback(() => {
      if (longPressTimerRef.current !== null) {
        window.clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      longPressOriginRef.current = null;
    }, []);

    useEffect(() => clearLongPressTimer, [clearLongPressTimer]);

    useImperativeHandle(
      forwardedRef,
      () => ({
        focus: () => {
          props.onSelectionModeChange(false);
          terminalRef.current?.focus();
        },
      }),
      [props],
    );

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
        allowTransparency: true,
        cursorBlink: true,
        cursorInactiveStyle: "none",
        fontFamily: '"SF Mono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
        fontSize: props.fontSize,
        lineHeight: props.fontSize >= MOBILE_TERMINAL_FONT_SIZE ? 1.28 : 1.2,
        screenReaderMode: props.isMobile,
        scrollback: 5_000,
        theme: terminalThemeFromApp(),
      });
      terminal.loadAddon(fitAddon);
      terminal.open(mount);
      fitAddon.fit();

      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;

      const textarea = terminal.textarea;
      if (textarea) {
        textarea.autocapitalize = "none";
        textarea.autocomplete = "off";
        textarea.autocorrect = false;
        textarea.enterKeyHint = "enter";
        textarea.inputMode = "text";
        textarea.spellcheck = false;
      }

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

                const target = resolvePathLinkTarget(match.text, props.cwd);
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
        const transformedInput = transformUserInputRef.current(data);
        if (transformedInput.length === 0) {
          return;
        }

        void api.terminal
          .write({
            threadId: runtimeThreadId,
            terminalId: DEFAULT_TERMINAL_ID,
            data: transformedInput,
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
            cwd: props.cwd,
            cols: terminal.cols,
            rows: terminal.rows,
            env: props.runtimeEnv,
          });
          if (disposed) {
            return;
          }
          terminal.write("\u001bc");
          if (snapshot.history.length > 0) {
            terminal.write(snapshot.history);
          }
          if (props.autoFocus) {
            window.requestAnimationFrame(() => {
              terminal.focus();
            });
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
    }, [
      props.autoFocus,
      props.cwd,
      props.fontSize,
      props.isMobile,
      props.runtimeEnv,
      props.projectId,
      props.shellId,
      runtimeThreadId,
    ]);

    useEffect(() => {
      const terminal = terminalRef.current;
      const fitAddon = fitAddonRef.current;
      const api = readNativeApi();
      if (!terminal || !fitAddon || !api) {
        return;
      }

      terminal.options.fontSize = props.fontSize;
      terminal.options.lineHeight = props.fontSize >= MOBILE_TERMINAL_FONT_SIZE ? 1.28 : 1.2;
      fitAddon.fit();
      void api.terminal
        .resize({
          threadId: runtimeThreadId,
          terminalId: DEFAULT_TERMINAL_ID,
          cols: terminal.cols,
          rows: terminal.rows,
        })
        .catch(() => undefined);
    }, [props.fontSize, runtimeThreadId]);

    useEffect(() => {
      if (!props.selectionMode) {
        return;
      }
      terminalRef.current?.blur();
    }, [props.selectionMode]);

    const handleTerminalTouchStartCapture = useCallback(
      (event: ReactTouchEvent<HTMLDivElement>) => {
        clearLongPressTimer();
        if (!props.isMobile || props.selectionMode || event.touches.length !== 1) {
          return;
        }

        const touch = event.touches[0];
        if (!touch) {
          return;
        }

        longPressOriginRef.current = {
          x: touch.clientX,
          y: touch.clientY,
        };
        longPressTimerRef.current = window.setTimeout(() => {
          props.onSelectionModeChange(true);
          longPressTimerRef.current = null;
        }, MOBILE_SELECTION_LONG_PRESS_MS);
      },
      [clearLongPressTimer, props],
    );

    const handleTerminalTouchMoveCapture = useCallback(
      (event: ReactTouchEvent<HTMLDivElement>) => {
        const origin = longPressOriginRef.current;
        const touch = event.touches[0];
        if (!origin || !touch) {
          return;
        }

        const movedX = Math.abs(touch.clientX - origin.x);
        const movedY = Math.abs(touch.clientY - origin.y);
        if (
          movedX > MOBILE_SELECTION_MOVE_THRESHOLD_PX ||
          movedY > MOBILE_SELECTION_MOVE_THRESHOLD_PX
        ) {
          clearLongPressTimer();
        }
      },
      [clearLongPressTimer],
    );

    const handleTerminalClick = useCallback(() => {
      if (props.selectionMode) {
        return;
      }
      terminalRef.current?.focus();
    }, [props.selectionMode]);

    return (
      <div
        ref={containerRef}
        className="project-shell-terminal h-full min-h-0 w-full overflow-hidden rounded-none"
        data-mobile={props.isMobile ? "true" : "false"}
        data-selection-mode={props.selectionMode ? "true" : "false"}
        onClick={handleTerminalClick}
        onTouchCancelCapture={clearLongPressTimer}
        onTouchEndCapture={clearLongPressTimer}
        onTouchMoveCapture={handleTerminalTouchMoveCapture}
        onTouchStartCapture={handleTerminalTouchStartCapture}
      />
    );
  },
);

function ShellTabButton(props: {
  title: string;
  isActive: boolean;
  isRunning: boolean;
  mobile: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "group inline-flex shrink-0 items-center gap-2 rounded-none border text-left transition-colors duration-150",
        props.mobile ? "min-w-[8.5rem] px-3 py-2.5" : "w-full justify-between px-3 py-3 text-sm",
        props.isActive
          ? "border-white/12 bg-white/8 text-foreground shadow-[0_12px_40px_rgba(0,0,0,0.2)]"
          : "border-white/6 bg-black/10 text-muted-foreground hover:border-white/12 hover:bg-white/5 hover:text-foreground",
      )}
      onClick={props.onSelect}
    >
      <span className="inline-flex min-w-0 items-center gap-2">
        <SquareTerminalIcon className="size-4 shrink-0" />
        <span className="truncate text-sm font-medium">{props.title}</span>
      </span>
      <span
        className={cn(
          "inline-flex size-2 shrink-0 rounded-full",
          props.isRunning ? "bg-emerald-400" : "bg-white/18",
        )}
      />
    </button>
  );
}

function MobileAccessoryButton(props: {
  active?: boolean | undefined;
  disabled?: boolean | undefined;
  label: string;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPress: () => void;
  tone?: "default" | "danger" | undefined;
}) {
  return (
    <Button
      aria-pressed={props.active}
      className={cn(
        "h-12 rounded-none before:rounded-none text-sm font-semibold",
        props.active && "border-primary bg-primary text-primary-foreground",
        props.tone === "danger" &&
          !props.active &&
          "border-destructive/30 text-destructive-foreground hover:border-destructive/40 hover:bg-destructive/6",
      )}
      disabled={props.disabled}
      size="sm"
      variant={props.active ? "default" : "outline"}
      onClick={props.onPress}
      onPointerDown={props.onPointerDown}
    >
      {props.label}
    </Button>
  );
}

function DesktopShellListButton(props: {
  cwd: string;
  isActive: boolean;
  isRunning: boolean;
  onSelect: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-start gap-2 rounded-none border px-3 py-2.5 text-left transition-colors duration-150",
        props.isActive
          ? "border-border bg-accent/70 text-foreground shadow-[0_8px_28px_rgba(0,0,0,0.12)]"
          : "border-transparent bg-transparent text-muted-foreground hover:border-border/60 hover:bg-accent/40 hover:text-foreground",
      )}
      onClick={props.onSelect}
    >
      <SquareTerminalIcon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{props.title}</span>
          <span
            className={cn(
              "inline-flex size-1.5 shrink-0 rounded-full",
              props.isRunning ? "bg-emerald-500" : "bg-muted-foreground/30",
            )}
          />
        </div>
        <p className="mt-1 truncate text-[11px] text-muted-foreground/75">{props.cwd}</p>
      </div>
    </button>
  );
}

export default function ProjectShellsView({
  project,
  shellId = null,
}: {
  project: Project;
  shellId?: string | null;
}) {
  const navigate = useNavigate();
  const mobileViewport = useMobileViewport();
  const terminalHandleRef = useRef<ShellTerminalHandle | null>(null);
  const shellStateByProjectId = useProjectShellStore((state) => state.shellStateByProjectId);
  const collection = useMemo(
    () => selectProjectShellCollection(shellStateByProjectId, project.id),
    [project.id, shellStateByProjectId],
  );
  const setActiveShell = useProjectShellStore((state) => state.setActiveShell);
  const { data: keybindings = EMPTY_KEYBINDINGS } = useQuery({
    ...serverConfigQueryOptions(),
    select: (config) => config.keybindings,
  });
  const [mobileCtrlLatched, setMobileCtrlLatched] = useState(false);
  const [mobileSelectionMode, setMobileSelectionMode] = useState(false);

  const activeShell = useMemo(() => {
    if (shellId) {
      const routedShell = collection.shells.find((shell) => shell.id === shellId);
      if (routedShell) {
        return routedShell;
      }
    }

    if (collection.activeShellId) {
      const storedActiveShell =
        collection.shells.find((shell) => shell.id === collection.activeShellId) ?? null;
      if (storedActiveShell) {
        return storedActiveShell;
      }
    }

    return collection.shells[0] ?? null;
  }, [collection.activeShellId, collection.shells, shellId]);

  const activeShellId = activeShell?.id ?? null;
  const shellRuntimeThreadId = useMemo(
    () => (activeShell ? projectShellRuntimeThreadId(project.id, activeShell.id) : null),
    [activeShell, project.id],
  );
  const terminalFontSize = mobileViewport.isMobile
    ? MOBILE_TERMINAL_FONT_SIZE
    : DESKTOP_TERMINAL_FONT_SIZE;
  const newShellShortcutLabel = shortcutLabelForCommand(keybindings, "terminal.new");
  const closeShellShortcutLabel = shortcutLabelForCommand(keybindings, "terminal.close");

  useEffect(() => {
    if (!shellId || !collection.shells.some((shell) => shell.id === shellId)) {
      return;
    }
    if (collection.activeShellId === shellId) {
      return;
    }
    setActiveShell(project.id, shellId);
  }, [collection.activeShellId, collection.shells, project.id, setActiveShell, shellId]);

  useEffect(() => {
    if (!activeShellId || collection.activeShellId === activeShellId) {
      return;
    }
    setActiveShell(project.id, activeShellId);
  }, [activeShellId, collection.activeShellId, project.id, setActiveShell]);

  useEffect(() => {
    setMobileCtrlLatched(false);
    setMobileSelectionMode(false);
  }, [activeShellId]);

  const focusTerminal = useCallback(() => {
    terminalHandleRef.current?.focus();
  }, []);

  const openProjectShellPage = useCallback(
    async (replace = false) => {
      await navigate({
        to: "/shells/$projectId",
        params: {
          projectId: project.id,
        },
        ...(replace ? { replace: true } : {}),
      });
    },
    [navigate, project.id],
  );

  const openShell = useCallback(
    async (nextShellId: string) => {
      setActiveShell(project.id, nextShellId);
      await openProjectShellPage();
      if (!mobileViewport.isMobile) {
        window.requestAnimationFrame(() => {
          focusTerminal();
        });
      }
    },
    [focusTerminal, mobileViewport.isMobile, openProjectShellPage, project.id, setActiveShell],
  );

  const createShellAndOpen = useCallback(async () => {
    const shell = createProjectShell(project.id, defaultProjectShellConfig(project));
    setActiveShell(project.id, shell.id);
    await openProjectShellPage();
    if (!mobileViewport.isMobile) {
      window.requestAnimationFrame(() => {
        focusTerminal();
      });
    }
  }, [focusTerminal, mobileViewport.isMobile, openProjectShellPage, project, setActiveShell]);

  const closeShellById = useCallback(
    async (targetShellId: string) => {
      await closeProjectShell(project.id, targetShellId).catch(() => undefined);
      await openProjectShellPage(true);
    },
    [openProjectShellPage, project.id],
  );

  const closeActiveShell = useCallback(async () => {
    if (!activeShell) {
      return;
    }
    await closeShellById(activeShell.id);
  }, [activeShell, closeShellById]);

  const writeToActiveShell = useCallback(
    async (data: string) => {
      if (!shellRuntimeThreadId) {
        return;
      }
      const api = readNativeApi();
      if (!api) {
        return;
      }

      await api.terminal.write({
        threadId: shellRuntimeThreadId,
        terminalId: DEFAULT_TERMINAL_ID,
        data,
      });

      if (!mobileViewport.isMobile || !mobileSelectionMode) {
        focusTerminal();
      }
    },
    [focusTerminal, mobileSelectionMode, mobileViewport.isMobile, shellRuntimeThreadId],
  );

  const interruptActiveShell = useCallback(async () => {
    await writeToActiveShell("\u0003");
  }, [writeToActiveShell]);

  const transformUserInput = useCallback(
    (data: string) => {
      if (!mobileViewport.isMobile || !mobileCtrlLatched) {
        return data;
      }
      setMobileCtrlLatched(false);
      return controlModifiedInput(data);
    },
    [mobileCtrlLatched, mobileViewport.isMobile],
  );

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
      if (event.defaultPrevented) {
        return;
      }

      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen: activeShell !== null,
        },
      });
      if (!command) {
        return;
      }

      if (command === "terminal.toggle") {
        event.preventDefault();
        event.stopPropagation();
        focusTerminal();
        return;
      }

      if (command === "terminal.new" || command === "terminal.split") {
        event.preventDefault();
        event.stopPropagation();
        void createShellAndOpen();
        return;
      }

      if (command === "terminal.close" && activeShell) {
        event.preventDefault();
        event.stopPropagation();
        void closeActiveShell();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeShell, closeActiveShell, createShellAndOpen, focusTerminal, keybindings]);

  const keepKeyboardOpenOnPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!mobileViewport.isMobile) {
        return;
      }
      event.preventDefault();
    },
    [mobileViewport.isMobile],
  );

  const mobileAccessoryButtons = activeShell
    ? [
        {
          label: "Stop",
          onPress: () => {
            void interruptActiveShell();
          },
          tone: "danger" as const,
        },
        {
          active: mobileCtrlLatched,
          label: "Ctrl",
          onPress: () => {
            setMobileCtrlLatched((current) => !current);
            if (mobileSelectionMode) {
              setMobileSelectionMode(false);
            }
            focusTerminal();
          },
        },
        {
          label: "↑",
          onPress: () => {
            void writeToActiveShell("\u001b[A");
          },
        },
        {
          label: "Tab",
          onPress: () => {
            void writeToActiveShell("\t");
          },
        },
        {
          label: "Esc",
          onPress: () => {
            void writeToActiveShell("\u001b");
          },
        },
      ]
    : [];

  if (!mobileViewport.isMobile) {
    return (
      <div className="flex h-full min-h-0 overflow-hidden bg-background text-foreground">
        <section className="flex min-h-0 flex-1 flex-col">
          <div className="relative flex min-h-0 flex-1 overflow-hidden rounded-none border border-border/70 bg-card/55 shadow-[0_20px_64px_rgba(0,0,0,0.16)]">
            {activeShell ? (
              <ShellTerminalViewport
                ref={terminalHandleRef}
                autoFocus
                cwd={activeShell.cwd}
                fontSize={terminalFontSize}
                isMobile={false}
                projectId={project.id}
                runtimeEnv={activeShell.env}
                selectionMode={false}
                shellId={activeShell.id}
                transformUserInput={transformUserInput}
                onSelectionModeChange={() => undefined}
              />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
                <SquareTerminalIcon className="size-10 text-muted-foreground/35" />
                <h2 className="mt-4 text-lg font-semibold">No shells yet</h2>
                <p className="mt-2 max-w-sm text-sm text-muted-foreground/70">
                  Add a shell for {project.name} when you need one.
                </p>
                <Button
                  className="mt-5 rounded-none before:rounded-none"
                  onClick={() => {
                    void createShellAndOpen();
                  }}
                >
                  <PlusIcon className="size-4" />
                  Add shell
                </Button>
              </div>
            )}
          </div>
        </section>

        <aside className="flex w-[18rem] shrink-0 flex-col border-border/70 border-l bg-muted/18 backdrop-blur-xl">
          <div className="flex items-start justify-between gap-3 border-border/70 border-b px-3 py-3">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold tracking-[0.18em] text-muted-foreground/60 uppercase">
                Project Shells
              </p>
              <h1 className="mt-1 truncate text-sm font-semibold">{project.name}</h1>
              <p className="truncate text-xs text-muted-foreground/70">
                {activeShell?.cwd ?? project.cwd}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <Button
                aria-label={
                  newShellShortcutLabel ? `Add shell (${newShellShortcutLabel})` : "Add shell"
                }
                className="rounded-none before:rounded-none"
                size="icon-xs"
                title={newShellShortcutLabel ? `Add shell (${newShellShortcutLabel})` : "Add shell"}
                variant="outline"
                onClick={() => {
                  void createShellAndOpen();
                }}
              >
                <PlusIcon className="size-3.5" />
              </Button>
              <Button
                aria-label={
                  closeShellShortcutLabel
                    ? `Delete active shell (${closeShellShortcutLabel})`
                    : "Delete active shell"
                }
                className="rounded-none before:rounded-none"
                disabled={!activeShell}
                size="icon-xs"
                title={
                  closeShellShortcutLabel
                    ? `Delete active shell (${closeShellShortcutLabel})`
                    : "Delete active shell"
                }
                variant="ghost"
                onClick={() => {
                  void closeActiveShell();
                }}
              >
                <Trash2Icon className="size-3.5" />
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between border-border/70 border-b px-3 py-2 text-[11px] text-muted-foreground/70">
            <span>
              {collection.shells.length} shell{collection.shells.length === 1 ? "" : "s"}
            </span>
            <span>{collection.runningShellIds.length} running</span>
          </div>

          {collection.shells.length === 0 ? (
            <div className="px-3 py-4 text-sm text-muted-foreground/65">
              No shells for this project yet.
            </div>
          ) : (
            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
              {collection.shells.map((shell) => (
                <DesktopShellListButton
                  key={shell.id}
                  cwd={shell.cwd}
                  isActive={shell.id === activeShellId}
                  isRunning={collection.runningShellIds.includes(shell.id)}
                  title={shell.title}
                  onSelect={() => {
                    void openShell(shell.id);
                  }}
                />
              ))}
            </div>
          )}
        </aside>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.06),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0))] text-foreground">
      <header className="shrink-0 border-border/70 border-b bg-background/78 px-3 py-3 backdrop-blur-xl sm:px-5 sm:py-4">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold tracking-[0.2em] text-muted-foreground/60 uppercase">
              Shells
            </p>
            <div className="mt-1 flex items-center gap-2">
              <h1 className="truncate text-base font-semibold sm:text-lg">{project.name}</h1>
              <span className="hidden rounded-full border border-white/8 bg-white/5 px-2 py-0.5 text-[11px] text-muted-foreground sm:inline-flex">
                {collection.shells.length} shell{collection.shells.length === 1 ? "" : "s"}
              </span>
            </div>
            <p className="truncate text-xs text-muted-foreground/70 sm:text-sm">
              {activeShell?.cwd ?? project.cwd}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              aria-label={
                newShellShortcutLabel ? `Add shell (${newShellShortcutLabel})` : "Add shell"
              }
              className="rounded-none before:rounded-none"
              size="icon-sm"
              title={newShellShortcutLabel ? `Add shell (${newShellShortcutLabel})` : "Add shell"}
              variant="outline"
              onClick={() => {
                void createShellAndOpen();
              }}
            >
              <PlusIcon className="size-4" />
            </Button>
            <Button
              aria-label={
                closeShellShortcutLabel
                  ? `Delete active shell (${closeShellShortcutLabel})`
                  : "Delete active shell"
              }
              className="rounded-none before:rounded-none"
              disabled={!activeShell}
              size="icon-sm"
              title={
                closeShellShortcutLabel
                  ? `Delete active shell (${closeShellShortcutLabel})`
                  : "Delete active shell"
              }
              variant="ghost"
              onClick={() => {
                void closeActiveShell();
              }}
            >
              <Trash2Icon className="size-4" />
            </Button>
          </div>
        </div>

        <div className="turn-chip-strip mt-3 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {collection.shells.map((shell) => (
            <ShellTabButton
              key={shell.id}
              isActive={shell.id === activeShellId}
              isRunning={collection.runningShellIds.includes(shell.id)}
              mobile
              title={shell.title}
              onSelect={() => {
                void openShell(shell.id);
              }}
            />
          ))}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <section className="flex min-h-0 flex-1 flex-col">
          <div className="relative flex min-h-0 flex-1 overflow-hidden border border-white/8 bg-card/70 backdrop-blur-sm rounded-none border-r-0 border-l-0 shadow-none">
            {activeShell ? (
              <>
                {mobileSelectionMode ? (
                  <div className="absolute top-3 right-3 z-20">
                    <Button
                      className="rounded-none before:rounded-none"
                      size="xs"
                      variant="secondary"
                      onClick={() => {
                        setMobileSelectionMode(false);
                        focusTerminal();
                      }}
                    >
                      Done
                    </Button>
                  </div>
                ) : null}
                <ShellTerminalViewport
                  ref={terminalHandleRef}
                  autoFocus={false}
                  cwd={activeShell.cwd}
                  fontSize={terminalFontSize}
                  isMobile
                  projectId={project.id}
                  runtimeEnv={activeShell.env}
                  selectionMode={mobileSelectionMode}
                  shellId={activeShell.id}
                  transformUserInput={transformUserInput}
                  onSelectionModeChange={setMobileSelectionMode}
                />
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
                <SquareTerminalIcon className="size-10 text-muted-foreground/35" />
                <h2 className="mt-4 text-lg font-semibold">No shells yet</h2>
                <p className="mt-2 max-w-sm text-sm text-muted-foreground/70">
                  Add a shell for {project.name} when you need one. This page stays empty until a
                  shell is created.
                </p>
                <Button
                  className="mt-5 rounded-none before:rounded-none"
                  onClick={() => {
                    void createShellAndOpen();
                  }}
                >
                  <PlusIcon className="size-4" />
                  Add shell
                </Button>
              </div>
            )}
          </div>
        </section>
      </div>

      {activeShell ? (
        <div className="shrink-0 border-border/70 border-t bg-background/92 backdrop-blur-xl">
          <div className="grid grid-cols-5 gap-2 px-3 py-1">
            {mobileAccessoryButtons.map((button) => (
              <MobileAccessoryButton
                key={button.label}
                active={button.active}
                label={button.label}
                tone={button.tone}
                onPointerDown={keepKeyboardOpenOnPointerDown}
                onPress={button.onPress}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
