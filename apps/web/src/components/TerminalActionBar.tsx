import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  CornerDownLeftIcon,
} from "lucide-react";
import { useCallback, useRef } from "react";

import { cn } from "../lib/utils";

const KEY_SEQUENCES: Record<string, string> = {
  up: "\x1b[A",
  down: "\x1b[B",
  right: "\x1b[C",
  left: "\x1b[D",
  esc: "\x1b",
  enter: "\r",
  "ctrl-c": "\x03",
  tab: "\t",
};

interface TerminalActionBarProps {
  onSend: (data: string) => void;
  onPageUp?: () => void;
  onPageDown?: () => void;
  className?: string;
}

function ActionButton(props: {
  children: React.ReactNode;
  compact?: boolean;
  label: string;
  onPress: () => void;
}) {
  const pressedRef = useRef(false);

  const handleTouchStart = useCallback(
    (event: React.TouchEvent) => {
      event.preventDefault();
      event.stopPropagation();
      pressedRef.current = true;
    },
    [],
  );

  const handleTouchEnd = useCallback(
    (event: React.TouchEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (pressedRef.current) {
        pressedRef.current = false;
        props.onPress();
      }
    },
    [props],
  );

  return (
    <button
      type="button"
      aria-label={props.label}
      className={cn(
        "flex items-center justify-center rounded-lg border border-white/10 bg-white/5 text-xs font-medium text-foreground/90 active:bg-white/12 active:scale-[0.96] transition-all duration-100 select-none",
        props.compact ? "flex-[0.5] min-h-[2.25rem]" : "flex-1 min-h-[2.25rem]",
      )}
      tabIndex={-1}
      onMouseDown={(event) => {
        event.preventDefault();
        props.onPress();
      }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {props.children}
    </button>
  );
}

export default function TerminalActionBar({
  onSend,
  onPageUp,
  onPageDown,
  className,
}: TerminalActionBarProps) {
  const send = useCallback(
    (key: string) => {
      const sequence = KEY_SEQUENCES[key];
      if (sequence) {
        onSend(sequence);
      }
    },
    [onSend],
  );

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 px-2 py-1.5 bg-background/95 border-t border-border/50 backdrop-blur-xl",
        className,
      )}
    >
      {/* Row 1: Modifier keys + page navigation */}
      <div className="flex gap-1.5">
        <ActionButton label="Tab" onPress={() => send("tab")}>
          Tab
        </ActionButton>
        <ActionButton label="Escape" onPress={() => send("esc")}>
          Esc
        </ActionButton>
        <ActionButton label="Ctrl+C" onPress={() => send("ctrl-c")}>
          Ctrl+C
        </ActionButton>
        {onPageUp ? (
          <ActionButton label="Page Up" onPress={onPageUp}>
            PgUp
          </ActionButton>
        ) : null}
        {onPageDown ? (
          <ActionButton label="Page Down" onPress={onPageDown}>
            PgDn
          </ActionButton>
        ) : null}
      </div>
      {/* Row 2: Arrow keys + Enter */}
      <div className="flex gap-1.5">
        <ActionButton compact label="Left arrow" onPress={() => send("left")}>
          <ArrowLeftIcon className="size-3.5" />
        </ActionButton>
        <ActionButton compact label="Down arrow" onPress={() => send("down")}>
          <ArrowDownIcon className="size-3.5" />
        </ActionButton>
        <ActionButton compact label="Up arrow" onPress={() => send("up")}>
          <ArrowUpIcon className="size-3.5" />
        </ActionButton>
        <ActionButton compact label="Right arrow" onPress={() => send("right")}>
          <ArrowRightIcon className="size-3.5" />
        </ActionButton>
        <ActionButton label="Enter" onPress={() => send("enter")}>
          <CornerDownLeftIcon className="size-3.5 mr-1" />
          <span>Enter</span>
        </ActionButton>
      </div>
    </div>
  );
}
