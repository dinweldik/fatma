import "../index.css";

import { type NativeApi, ProjectId } from "@fatma/contracts";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { useComposerDraftStore } from "../composerDraftStore";
import { useProjectShellMobileConsoleStore } from "../projectShellMobileConsoleStore";
import { useProjectShellStore } from "../projectShellStore";
import { useSelectedChatStore } from "../selectedChatStore";
import { useStore } from "../store";
import type { Project } from "../types";
import MobileBottomNav from "./MobileBottomNav";

const navigateMock = vi.fn();
const terminalWriteMock = vi.fn();
let currentPathname = "";
let currentRouteProjectId: string | null = null;
let currentRouteThreadId: string | null = null;
let currentMobileViewport = {
  isKeyboardOpen: false,
  isMobile: true,
  keyboardInset: 0,
  viewportHeight: 932,
};

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useParams: ({ select }: { select: (params: Record<string, string>) => unknown }) =>
      select({
        ...(currentRouteProjectId ? { projectId: currentRouteProjectId } : {}),
        ...(currentRouteThreadId ? { threadId: currentRouteThreadId } : {}),
      }),
    useRouterState: ({
      select,
    }: {
      select: (state: { location: { pathname: string } }) => unknown;
    }) =>
      select({
        location: {
          pathname: currentPathname,
        },
      }),
  };
});

vi.mock("../mobileViewport", () => ({
  useMobileViewport: () => currentMobileViewport,
}));

vi.mock("../nativeApi", () => ({
  readNativeApi: () =>
    ({
      terminal: {
        write: terminalWriteMock,
      },
    }) as unknown as NativeApi,
}));

const PROJECT_ID = ProjectId.makeUnsafe("project-mobile-shell");
const SHELL_ID = "shell-mobile-1";
const PROJECT: Project = {
  id: PROJECT_ID,
  name: "Mobile Shell Project",
  cwd: "/root/fatma/apps/server",
  model: "gpt-5",
  expanded: true,
  scripts: [],
};

async function nextFrame(): Promise<void> {
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
}

async function setViewport(): Promise<void> {
  await page.viewport(430, 932);
  await nextFrame();
  await nextFrame();
}

describe("MobileBottomNav shell dock", () => {
  beforeEach(async () => {
    document.body.innerHTML = "";
    document.documentElement.style.removeProperty("--app-mobile-bottom-dock-height");
    localStorage.clear();
    navigateMock.mockReset();
    terminalWriteMock.mockReset();
    terminalWriteMock.mockResolvedValue(undefined);
    currentPathname = `/shells/${PROJECT_ID}`;
    currentRouteProjectId = PROJECT_ID;
    currentRouteThreadId = null;
    currentMobileViewport = {
      isKeyboardOpen: false,
      isMobile: true,
      keyboardInset: 0,
      viewportHeight: 932,
    };
    useComposerDraftStore.setState({
      draftThreadsByThreadId: {},
      draftsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
    });
    useProjectShellMobileConsoleStore.setState({
      consoleStateByProjectId: {
        [PROJECT_ID]: {
          draftText: "echo one\npwd",
          outputText: "",
          promptText: "root@vscode:~/fatma/apps/server# ",
          shellId: SHELL_ID,
        },
      },
    });
    useProjectShellStore.setState({
      shellStateByProjectId: {
        [PROJECT_ID]: {
          activeShellId: SHELL_ID,
          nextShellOrdinal: 2,
          runningShellIds: [SHELL_ID],
          shells: [
            {
              id: SHELL_ID,
              title: "Shell 1",
              createdAt: "2026-03-20T10:00:00.000Z",
              cwd: PROJECT.cwd,
              env: {},
            },
          ],
        },
      },
    });
    useSelectedChatStore.setState({
      projectId: PROJECT_ID,
      threadId: null,
    });
    useStore.setState({
      projects: [PROJECT],
      threads: [],
      threadsHydrated: true,
    });
    await setViewport();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    document.documentElement.style.removeProperty("--app-mobile-bottom-dock-height");
  });

  it("extends the shared dock with shell input controls on shell routes", async () => {
    const screen = await render(<MobileBottomNav />);

    try {
      await vi.waitFor(
        () => {
          const input = document.querySelector<HTMLTextAreaElement>(
            'textarea[placeholder="Type a shell command"]',
          );
          expect(input).toBeTruthy();
          expect(document.body.textContent).toContain("root@vscode:~/fatma/apps/server#");
        },
        { timeout: 5_000, interval: 16 },
      );

      await vi.waitFor(
        () => {
          const dockHeight = document.documentElement.style.getPropertyValue(
            "--app-mobile-bottom-dock-height",
          );
          expect(Number.parseInt(dockHeight, 10)).toBeGreaterThan(60);
        },
        { timeout: 5_000, interval: 16 },
      );

      const input = document.querySelector<HTMLTextAreaElement>(
        'textarea[placeholder="Type a shell command"]',
      );
      expect(input).toBeTruthy();
      input?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
        }),
      );

      await vi.waitFor(
        () => {
          expect(terminalWriteMock).toHaveBeenCalledWith(
            expect.objectContaining({
              data: "echo one\rpwd\r",
              threadId: `project-shell:${PROJECT_ID}:${SHELL_ID}`,
            }),
          );
        },
        { timeout: 5_000, interval: 16 },
      );

      const interruptButton =
        Array.from(document.querySelectorAll("button")).find(
          (entry) => entry.textContent?.trim() === "Ctrl+C",
        ) ?? null;
      expect(interruptButton).toBeTruthy();
      interruptButton?.click();

      await vi.waitFor(
        () => {
          expect(terminalWriteMock).toHaveBeenCalledWith(
            expect.objectContaining({
              data: "\u0003",
              threadId: `project-shell:${PROJECT_ID}:${SHELL_ID}`,
            }),
          );
        },
        { timeout: 5_000, interval: 16 },
      );
    } finally {
      await screen.unmount();
    }
  });

  it("keeps shell controls out of non-shell routes", async () => {
    currentPathname = `/files/${PROJECT_ID}`;

    const screen = await render(<MobileBottomNav />);

    try {
      await vi.waitFor(
        () => {
          expect(document.querySelector('textarea[placeholder="Type a shell command"]')).toBeNull();
        },
        { timeout: 5_000, interval: 16 },
      );
    } finally {
      await screen.unmount();
    }
  });
});
