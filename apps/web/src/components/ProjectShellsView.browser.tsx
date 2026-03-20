import "../index.css";

import { type NativeApi, ProjectId, type TerminalEvent } from "@fatma/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { useProjectShellMobileConsoleStore } from "../projectShellMobileConsoleStore";
import { useProjectShellStore } from "../projectShellStore";
import type { Project } from "../types";
import ProjectShellsView from "./ProjectShellsView";

const navigateMock = vi.fn();
const terminalOpenMock = vi.fn();
const terminalWriteMock = vi.fn();
const terminalCloseMock = vi.fn();
let currentNativeApi: NativeApi;
let terminalEventListener: ((event: TerminalEvent) => void) | null = null;
let currentMobileViewport = {
  isKeyboardOpen: false,
  isMobile: true,
  keyboardInset: 0,
  viewportHeight: 932,
};

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class MockFitAddon {
    fit = vi.fn();
  },
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class MockTerminal {
    attachCustomKeyEventHandler = vi.fn();
    blur = vi.fn();
    buffer = {
      active: {
        baseY: 0,
        getLine: vi.fn(() => null),
        viewportY: 0,
      },
    };
    clear = vi.fn();
    cols = 80;
    dispose = vi.fn();
    focus = vi.fn();
    loadAddon = vi.fn();
    onData = vi.fn(() => ({ dispose: vi.fn() }));
    open = vi.fn();
    options = {};
    refresh = vi.fn();
    registerLinkProvider = vi.fn(() => ({ dispose: vi.fn() }));
    rows = 24;
    scrollToBottom = vi.fn();
    textarea = document.createElement("textarea");
    write = vi.fn();
  },
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("../mobileViewport", () => ({
  useMobileViewport: () => currentMobileViewport,
}));

vi.mock("../nativeApi", () => ({
  readNativeApi: () => currentNativeApi,
  ensureNativeApi: () => currentNativeApi,
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

function createNativeApi(): NativeApi {
  return {
    orchestration: {
      dispatchCommand: vi.fn(),
      getSnapshot: vi.fn(),
      getTurnDiff: vi.fn(),
      getFullThreadDiff: vi.fn(),
      replayEvents: vi.fn(),
      onDomainEvent: vi.fn(() => () => undefined),
    },
    projects: {
      browseDirectory: vi.fn(),
      createDirectory: vi.fn(),
      searchEntries: vi.fn(),
      writeFile: vi.fn(),
    },
    shell: {
      openExternal: vi.fn(),
      openInEditor: vi.fn(),
    },
    git: {
      pull: vi.fn(),
      push: vi.fn(),
      commit: vi.fn(),
      status: vi.fn(),
      readWorkingTreeFileDiff: vi.fn(),
      stageFiles: vi.fn(),
      unstageFiles: vi.fn(),
      runStackedAction: vi.fn(),
      listBranches: vi.fn(),
      createWorktree: vi.fn(),
      removeWorktree: vi.fn(),
      createBranch: vi.fn(),
      checkout: vi.fn(),
      init: vi.fn(),
      resolvePullRequest: vi.fn(),
      preparePullRequestThread: vi.fn(),
    },
    terminal: {
      open: terminalOpenMock,
      write: terminalWriteMock,
      resize: vi.fn(),
      clear: vi.fn(),
      restart: vi.fn(),
      close: terminalCloseMock,
      onEvent: vi.fn((listener) => {
        terminalEventListener = listener;
        return () => {
          if (terminalEventListener === listener) {
            terminalEventListener = null;
          }
        };
      }),
    },
    server: {
      getConfig: vi.fn(async () => ({
        cwd: PROJECT.cwd,
        keybindingsConfigPath: `${PROJECT.cwd}/.fatma-keybindings.json`,
        keybindings: [],
        issues: [],
        providers: [],
        availableEditors: [],
        telegramNotifications: {
          chatId: "",
          hasBotToken: false,
          botTokenHint: null,
          enabled: false,
        },
      })),
      upsertKeybinding: vi.fn(),
      updateTelegramNotifications: vi.fn(),
      sendTestTelegramNotification: vi.fn(),
      onWelcome: vi.fn(() => () => undefined),
      onConfigUpdated: vi.fn(() => () => undefined),
    },
    contextMenu: {
      show: vi.fn(async () => null),
    },
  } as unknown as NativeApi;
}

async function nextFrame(): Promise<void> {
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
}

async function setViewport(): Promise<void> {
  await page.viewport(430, 932);
  await nextFrame();
  await nextFrame();
}

async function mountView(): Promise<{
  cleanup: () => Promise<void>;
}> {
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.inset = "0";
  host.style.width = "100vw";
  host.style.height = "100vh";
  host.style.overflow = "hidden";
  document.body.append(host);

  const queryClient = new QueryClient();
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <ProjectShellsView project={PROJECT} />
    </QueryClientProvider>,
    { container: host },
  );

  await vi.waitFor(
    () => {
      expect(terminalOpenMock).toHaveBeenCalled();
      expect(document.querySelector('textarea[aria-label="Shell output"]')).toBeTruthy();
    },
    { timeout: 5_000, interval: 16 },
  );

  return {
    cleanup: async () => {
      await screen.unmount();
      queryClient.clear();
      host.remove();
    },
  };
}

describe("ProjectShellsView mobile shell", () => {
  beforeEach(async () => {
    document.body.innerHTML = "";
    document.documentElement.style.setProperty("--app-mobile-bottom-dock-height", "60px");
    localStorage.clear();
    navigateMock.mockReset();
    terminalOpenMock.mockReset();
    terminalWriteMock.mockReset();
    terminalCloseMock.mockReset();
    terminalEventListener = null;
    currentMobileViewport = {
      isKeyboardOpen: false,
      isMobile: true,
      keyboardInset: 0,
      viewportHeight: 932,
    };
    terminalOpenMock.mockResolvedValue({
      threadId: `project-shell:${PROJECT_ID}:${SHELL_ID}`,
      terminalId: "default",
      cwd: PROJECT.cwd,
      status: "running",
      pid: 1234,
      history:
        "root@vscode:~/fatma/apps/server# printf 'hello'\r\nhello\r\nroot@vscode:~/fatma/apps/server# ",
      exitCode: null,
      exitSignal: null,
      updatedAt: "2026-03-20T12:00:00.000Z",
    });
    terminalWriteMock.mockResolvedValue(undefined);
    terminalCloseMock.mockResolvedValue(undefined);
    currentNativeApi = createNativeApi();
    useProjectShellMobileConsoleStore.setState({
      consoleStateByProjectId: {},
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
              createdAt: "2026-03-20T12:00:00.000Z",
              cwd: PROJECT.cwd,
              env: {},
            },
          ],
        },
      },
    });
    await setViewport();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    document.documentElement.style.removeProperty("--app-mobile-bottom-dock-height");
  });

  it("renders mobile shell output with the current prompt label", async () => {
    const mounted = await mountView();

    try {
      await vi.waitFor(
        () => {
          const shellLayout = document.querySelector<HTMLElement>('[data-shell-layout="mobile"]');
          const output = document.querySelector<HTMLTextAreaElement>(
            'textarea[aria-label="Shell output"]',
          );
          expect(shellLayout).toBeTruthy();
          expect(getComputedStyle(shellLayout!).paddingBottom).toBe("60px");
          expect(output?.value).toBe(
            "root@vscode:~/fatma/apps/server# printf 'hello'\nhello\nroot@vscode:~/fatma/apps/server# ",
          );
          expect(
            useProjectShellMobileConsoleStore.getState().consoleStateByProjectId[PROJECT_ID]
              ?.promptText,
          ).toBe("root@vscode:~/fatma/apps/server# ");
        },
        { timeout: 5_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("live-updates output and prompt state", async () => {
    const mounted = await mountView();

    try {
      terminalEventListener?.({
        createdAt: "2026-03-20T12:01:00.000Z",
        data: "cd /tmp\r\nroot@vscode:/tmp# ",
        terminalId: "default",
        threadId: `project-shell:${PROJECT_ID}:${SHELL_ID}`,
        type: "output",
      });

      await vi.waitFor(
        () => {
          const output = document.querySelector<HTMLTextAreaElement>(
            'textarea[aria-label="Shell output"]',
          );
          expect(output?.value).toBe(
            "root@vscode:~/fatma/apps/server# printf 'hello'\nhello\nroot@vscode:~/fatma/apps/server# cd /tmp\nroot@vscode:/tmp# ",
          );
          expect(
            useProjectShellMobileConsoleStore.getState().consoleStateByProjectId[PROJECT_ID]
              ?.promptText,
          ).toBe("root@vscode:/tmp# ");
        },
        { timeout: 5_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });
});
