import { type ProjectId } from "@fatma/contracts";
import { ArrowDownIcon, ArrowUpIcon, CornerDownLeftIcon } from "lucide-react";
import { useMemo, useRef } from "react";

import {
  toProjectShellMobileInputData,
  DEFAULT_PROJECT_SHELL_MOBILE_PROMPT,
} from "../projectShellMobileConsole.logic";
import {
  selectProjectShellMobileConsoleState,
  useProjectShellMobileConsoleStore,
} from "../projectShellMobileConsoleStore";
import { interruptProjectShell, writeToProjectShell } from "../projectShellRunner";
import { resolveActiveProjectShell } from "../projectShells";
import { selectProjectShellCollection, useProjectShellStore } from "../projectShellStore";
import { Button } from "./ui/button";

function AccessoryButton(props: {
  readonly label: string;
  readonly onPress: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="inline-flex min-h-8 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/5 px-2.5 font-medium text-[11px] text-foreground/88 active:scale-[0.98] active:bg-white/12"
      onMouseDown={(event) => {
        event.preventDefault();
        props.onPress();
      }}
      onTouchStart={(event) => {
        event.preventDefault();
      }}
      onTouchEnd={(event) => {
        event.preventDefault();
        props.onPress();
      }}
    >
      {props.children}
    </button>
  );
}

export default function ProjectShellMobileDock({ projectId }: { readonly projectId: ProjectId }) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const shellStateByProjectId = useProjectShellStore((state) => state.shellStateByProjectId);
  const collection = useMemo(
    () => selectProjectShellCollection(shellStateByProjectId, projectId),
    [projectId, shellStateByProjectId],
  );
  const activeShell = useMemo(() => resolveActiveProjectShell(collection), [collection]);
  const consoleStateByProjectId = useProjectShellMobileConsoleStore(
    (state) => state.consoleStateByProjectId,
  );
  const setDraftText = useProjectShellMobileConsoleStore((state) => state.setDraftText);
  const consoleState = useMemo(
    () => selectProjectShellMobileConsoleState(consoleStateByProjectId, projectId),
    [consoleStateByProjectId, projectId],
  );

  if (!activeShell) {
    return null;
  }

  const submitDraft = async () => {
    if (consoleState.draftText.trim().length === 0) {
      return;
    }

    await writeToProjectShell(
      projectId,
      activeShell.id,
      toProjectShellMobileInputData(consoleState.draftText),
    );
    setDraftText(projectId, "");
    inputRef.current?.focus();
  };

  return (
    <div className="border-b border-border/55 bg-background/96">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-2 py-2">
        <div className="rounded-[1.15rem] border border-white/8 bg-card/92 p-2 shadow-[0_-14px_30px_rgba(0,0,0,0.18)]">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold tracking-[0.16em] text-muted-foreground/60 uppercase">
                Shell Input
              </p>
              <p className="truncate font-mono text-[11px] text-muted-foreground/78">
                {consoleState.promptText || DEFAULT_PROJECT_SHELL_MOBILE_PROMPT}
              </p>
            </div>
            <Button
              size="icon-sm"
              className="rounded-none before:rounded-none"
              disabled={consoleState.draftText.trim().length === 0}
              onClick={() => {
                void submitDraft();
              }}
            >
              <CornerDownLeftIcon className="size-4" />
            </Button>
          </div>

          <textarea
            ref={inputRef}
            autoCapitalize="off"
            autoCorrect="off"
            className="min-h-[3.25rem] max-h-32 w-full resize-none overflow-y-auto rounded-[0.9rem] border border-white/8 bg-background/72 px-3 py-2.5 font-mono text-[13px] leading-[1.5] text-foreground outline-none [scrollbar-width:thin] focus:border-ring"
            placeholder="Type a shell command"
            rows={1}
            spellCheck={false}
            value={consoleState.draftText}
            onChange={(event) => {
              setDraftText(projectId, event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey) {
                return;
              }

              event.preventDefault();
              void submitDraft();
            }}
          />

          <div className="mt-2 flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <AccessoryButton
              label="Tab"
              onPress={() => {
                void writeToProjectShell(projectId, activeShell.id, "\t");
                inputRef.current?.focus();
              }}
            >
              Tab
            </AccessoryButton>
            <AccessoryButton
              label="Ctrl+C"
              onPress={() => {
                void interruptProjectShell(projectId, activeShell.id);
                inputRef.current?.focus();
              }}
            >
              Ctrl+C
            </AccessoryButton>
            <AccessoryButton
              label="Up"
              onPress={() => {
                void writeToProjectShell(projectId, activeShell.id, "\x1b[A");
                inputRef.current?.focus();
              }}
            >
              <ArrowUpIcon className="size-3.5" />
            </AccessoryButton>
            <AccessoryButton
              label="Down"
              onPress={() => {
                void writeToProjectShell(projectId, activeShell.id, "\x1b[B");
                inputRef.current?.focus();
              }}
            >
              <ArrowDownIcon className="size-3.5" />
            </AccessoryButton>
          </div>
        </div>
      </div>
    </div>
  );
}
