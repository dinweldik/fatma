import { DEFAULT_TERMINAL_ID, type ProjectId } from "@fatma/contracts";
import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import {
  appendProjectShellMobileConsoleOutput,
  buildProjectShellMobileConsoleSnapshot,
  DEFAULT_PROJECT_SHELL_MOBILE_PROMPT,
} from "../projectShellMobileConsole.logic";
import {
  selectProjectShellMobileConsoleState,
  useProjectShellMobileConsoleStore,
} from "../projectShellMobileConsoleStore";
import { projectShellRuntimeThreadId } from "../projectShells";
import { Button } from "./ui/button";

function isScrolledNearBottom(element: HTMLTextAreaElement): boolean {
  return element.scrollTop + element.clientHeight >= element.scrollHeight - 32;
}

export default function ProjectShellMobileConsole(props: {
  readonly cwd: string;
  readonly projectId: ProjectId;
  readonly runtimeEnv: Record<string, string>;
  readonly shellId: string;
}) {
  const runtimeThreadId = useMemo(
    () => projectShellRuntimeThreadId(props.projectId, props.shellId),
    [props.projectId, props.shellId],
  );
  const outputTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);
  const consoleStateByProjectId = useProjectShellMobileConsoleStore(
    (state) => state.consoleStateByProjectId,
  );
  const appendConsoleOutput = useProjectShellMobileConsoleStore(
    (state) => state.appendConsoleOutput,
  );
  const replaceConsoleState = useProjectShellMobileConsoleStore(
    (state) => state.replaceConsoleState,
  );
  const consoleState = useMemo(
    () => selectProjectShellMobileConsoleState(consoleStateByProjectId, props.projectId),
    [consoleStateByProjectId, props.projectId],
  );
  const deferredOutputText = useDeferredValue(consoleState.outputText);

  useEffect(() => {
    setIsPinnedToBottom(true);
  }, [props.shellId]);

  useEffect(() => {
    const api = readNativeApi();
    if (!api) {
      return;
    }

    let disposed = false;
    const syncSnapshot = (history: string) => {
      const nextSnapshot = buildProjectShellMobileConsoleSnapshot(
        history,
        selectProjectShellMobileConsoleState(
          useProjectShellMobileConsoleStore.getState().consoleStateByProjectId,
          props.projectId,
        ).promptText || DEFAULT_PROJECT_SHELL_MOBILE_PROMPT,
      );

      startTransition(() => {
        replaceConsoleState(props.projectId, {
          ...nextSnapshot,
          shellId: props.shellId,
        });
      });
    };

    const appendOutputChunk = (chunk: string) => {
      const currentState = selectProjectShellMobileConsoleState(
        useProjectShellMobileConsoleStore.getState().consoleStateByProjectId,
        props.projectId,
      );
      const nextState = appendProjectShellMobileConsoleOutput({
        chunk,
        existingOutputText: currentState.shellId === props.shellId ? currentState.outputText : "",
        fallbackPrompt: currentState.promptText || DEFAULT_PROJECT_SHELL_MOBILE_PROMPT,
      });

      startTransition(() => {
        appendConsoleOutput(props.projectId, {
          ...nextState,
          shellId: props.shellId,
        });
      });
    };

    void api.terminal
      .open({
        threadId: runtimeThreadId,
        terminalId: DEFAULT_TERMINAL_ID,
        cwd: props.cwd,
        env: props.runtimeEnv,
      })
      .then((snapshot) => {
        if (disposed) {
          return;
        }
        syncSnapshot(snapshot.history);
      })
      .catch((error) => {
        if (disposed) {
          return;
        }
        const message = error instanceof Error ? error.message : "Failed to open shell";
        appendOutputChunk(`\n[shell] ${message}\n`);
      });

    const unsubscribe = api.terminal.onEvent((event) => {
      if (event.threadId !== runtimeThreadId || event.terminalId !== DEFAULT_TERMINAL_ID) {
        return;
      }

      if (event.type === "activity") {
        return;
      }

      if (event.type === "started" || event.type === "restarted") {
        syncSnapshot(event.snapshot.history);
        return;
      }

      if (event.type === "output") {
        appendOutputChunk(event.data);
        return;
      }

      if (event.type === "cleared") {
        startTransition(() => {
          replaceConsoleState(props.projectId, {
            outputText: "",
            promptText: DEFAULT_PROJECT_SHELL_MOBILE_PROMPT,
            shellId: props.shellId,
          });
        });
        return;
      }

      if (event.type === "error") {
        appendOutputChunk(`\n[shell] ${event.message}\n`);
        return;
      }

      if (event.type === "exited") {
        const details = [
          typeof event.exitCode === "number" ? `code ${event.exitCode}` : null,
          typeof event.exitSignal === "number" ? `signal ${event.exitSignal}` : null,
        ]
          .filter((value): value is string => value !== null)
          .join(", ");
        appendOutputChunk(
          `\n[shell] ${details.length > 0 ? `Process exited (${details})` : "Process exited"}\n`,
        );
      }
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [
    appendConsoleOutput,
    props.cwd,
    props.projectId,
    props.runtimeEnv,
    props.shellId,
    replaceConsoleState,
    runtimeThreadId,
  ]);

  useEffect(() => {
    const textarea = outputTextareaRef.current;
    if (!textarea || !isPinnedToBottom) {
      return;
    }

    textarea.scrollTop = textarea.scrollHeight;
  }, [deferredOutputText, isPinnedToBottom]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-white/6 px-3 py-2 text-[11px]">
        <div className="min-w-0">
          <p className="font-semibold tracking-[0.14em] text-muted-foreground/60 uppercase">
            Shell Output
          </p>
          <p className="truncate font-mono text-muted-foreground/70">{consoleState.promptText}</p>
        </div>
        {!isPinnedToBottom ? (
          <Button
            size="xs"
            variant="outline"
            className="rounded-none before:rounded-none"
            onClick={() => {
              const textarea = outputTextareaRef.current;
              if (!textarea) {
                return;
              }
              textarea.scrollTop = textarea.scrollHeight;
              setIsPinnedToBottom(true);
            }}
          >
            Latest
          </Button>
        ) : null}
      </div>

      <textarea
        ref={outputTextareaRef}
        aria-label="Shell output"
        className={cn(
          "flex-1 min-h-0 w-full resize-none overflow-y-auto border-0 bg-transparent px-3 py-3 font-mono text-[13px] leading-[1.55] text-foreground outline-none",
          "overscroll-contain [scrollbar-width:thin] [-webkit-overflow-scrolling:touch]",
          "[touch-action:pan-y] [user-select:text] [-webkit-user-select:text]",
        )}
        inputMode="none"
        readOnly
        spellCheck={false}
        tabIndex={-1}
        value={deferredOutputText}
        onScroll={(event) => {
          const nextPinned = isScrolledNearBottom(event.currentTarget);
          setIsPinnedToBottom((current) => (current === nextPinned ? current : nextPinned));
        }}
      />
    </div>
  );
}
