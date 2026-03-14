import "../index.css";

import { type NativeApi, ProjectId } from "@fatma/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { useProjectShellStore } from "../projectShellStore";
import type { Project } from "../types";
import ProjectShellsView from "./ProjectShellsView";

const navigateMock = vi.fn();
const readTextFromClipboardMock = vi.fn<() => Promise<string>>();
const writeTextToClipboardMock = vi.fn<(text: string) => Promise<void>>();
const terminalOpenMock = vi.fn();
const terminalWriteMock = vi.fn();
const terminalResizeMock = vi.fn();
const terminalCloseMock = vi.fn();
let currentNativeApi: NativeApi;

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("../mobileViewport", () => ({
  useMobileViewport: () => ({
    isKeyboardOpen: false,
    isMobile: true,
    keyboardInset: 0,
    viewportHeight: 932,
  }),
}));

vi.mock("../lib/clipboard", () => ({
  readTextFromClipboard: () => readTextFromClipboardMock(),
  writeTextToClipboard: (text: string) => writeTextToClipboardMock(text),
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
  cwd: "/repo/mobile-shell",
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
      resize: terminalResizeMock,
      clear: vi.fn(),
      restart: vi.fn(),
      close: terminalCloseMock,
      onEvent: vi.fn(() => () => undefined),
    },
    server: {
      getConfig: vi.fn(async () => ({
        cwd: "/repo/mobile-shell",
        keybindingsConfigPath: "/repo/mobile-shell/.fatma-keybindings.json",
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

async function waitForButton(label: string): Promise<HTMLButtonElement> {
  let button: HTMLButtonElement | null = null;
  await vi.waitFor(
    () => {
      button =
        Array.from(document.querySelectorAll("button")).find(
          (entry) => entry.textContent?.trim() === label,
        ) ?? null;
      expect(button, `Unable to find "${label}" button`).toBeTruthy();
    },
    { timeout: 5_000, interval: 16 },
  );

  if (!button) {
    throw new Error(`Unable to find "${label}" button`);
  }

  return button;
}

async function mountView(): Promise<{ cleanup: () => Promise<void> }> {
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
      expect(host.querySelector(".project-shell-terminal")).toBeTruthy();
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
    localStorage.clear();
    navigateMock.mockReset();
    readTextFromClipboardMock.mockReset();
    writeTextToClipboardMock.mockReset();
    terminalOpenMock.mockReset();
    terminalWriteMock.mockReset();
    terminalResizeMock.mockReset();
    terminalCloseMock.mockReset();
    terminalOpenMock.mockResolvedValue({
      threadId: "project-shell:project-mobile-shell:shell-mobile-1",
      terminalId: "default",
      cwd: PROJECT.cwd,
      status: "running",
      pid: 1234,
      history: "$ printf 'hello'\r\nhello\r\n",
      exitCode: null,
      exitSignal: null,
      updatedAt: "2026-03-13T12:00:00.000Z",
    });
    terminalWriteMock.mockResolvedValue(undefined);
    terminalResizeMock.mockResolvedValue(undefined);
    terminalCloseMock.mockResolvedValue(undefined);
    currentNativeApi = createNativeApi();
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
              createdAt: "2026-03-13T12:00:00.000Z",
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
  });

  it("renders the mobile accessory actions and sends control sequences", async () => {
    const mounted = await mountView();

    try {
      await (await waitForButton("Stop")).click();
      await (await waitForButton("↑")).click();
      await (await waitForButton("Tab")).click();
      await (await waitForButton("Esc")).click();

      await vi.waitFor(
        () => {
          expect(terminalWriteMock).toHaveBeenCalledWith(
            expect.objectContaining({ data: "\u0003" }),
          );
          expect(terminalWriteMock).toHaveBeenCalledWith(
            expect.objectContaining({ data: "\u001b[A" }),
          );
          expect(terminalWriteMock).toHaveBeenCalledWith(expect.objectContaining({ data: "\t" }));
          expect(terminalWriteMock).toHaveBeenCalledWith(
            expect.objectContaining({ data: "\u001b" }),
          );
        },
        { timeout: 5_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("pastes from the clipboard and toggles into selection actions", async () => {
    readTextFromClipboardMock.mockResolvedValue("printf 'mobile paste'");
    const mounted = await mountView();

    try {
      await (await waitForButton("Paste")).click();
      await vi.waitFor(
        () => {
          expect(readTextFromClipboardMock).toHaveBeenCalledTimes(1);
          expect(terminalWriteMock).toHaveBeenCalledWith(
            expect.objectContaining({ data: "printf 'mobile paste'" }),
          );
        },
        { timeout: 5_000, interval: 16 },
      );

      await (await waitForButton("Select")).click();

      await vi.waitFor(
        async () => {
          expect(await waitForButton("Copy")).toBeTruthy();
          expect(await waitForButton("Select all")).toBeTruthy();
          expect(await waitForButton("Done")).toBeTruthy();
          expect(document.body.textContent).toContain("Drag to select, then tap Copy");
        },
        { timeout: 5_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });
});
