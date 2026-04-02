import {
  type ContextMenuItem,
  type GitActionProgressEvent,
  type NativeApi,
} from "@fatma/contracts";

import { showContextMenuFallback } from "./contextMenuFallback";
import { resetServerStateForTests } from "./rpc/serverState";
import { type TransportState, WsTransport } from "./wsTransport";
import { __resetWsRpcClientForTests, createWsRpcClient } from "./wsRpcClient";

let instance: { api: NativeApi; transport: WsTransport } | null = null;

const transportStateListeners = new Set<(state: TransportState) => void>();
const transportReconnectListeners = new Set<() => void>();
const gitActionProgressListeners = new Set<(payload: GitActionProgressEvent) => void>();

function emitGitActionProgress(event: GitActionProgressEvent): void {
  for (const listener of gitActionProgressListeners) {
    try {
      listener(event);
    } catch {
      // Swallow listener errors.
    }
  }
}

export function __resetWsNativeApiForTests() {
  instance = null;
  void __resetWsRpcClientForTests();
  resetServerStateForTests();
}

export function getTransportState(): TransportState {
  return instance?.transport.getState() ?? "connecting";
}

export function onTransportStateChanged(
  listener: (state: TransportState) => void,
  options?: { replayCurrent?: boolean },
): () => void {
  transportStateListeners.add(listener);
  if (options?.replayCurrent) {
    listener(getTransportState());
  }
  return () => {
    transportStateListeners.delete(listener);
  };
}

export function onTransportReconnected(listener: () => void): () => void {
  transportReconnectListeners.add(listener);
  return () => {
    transportReconnectListeners.delete(listener);
  };
}

export function createWsNativeApi(): NativeApi {
  if (instance) {
    return instance.api;
  }

  const transport = new WsTransport();
  const rpcClient = createWsRpcClient(transport);

  transport.onStateChange(
    (state) => {
      for (const listener of transportStateListeners) {
        try {
          listener(state);
        } catch {
          // Swallow listener errors.
        }
      }
    },
    { replayCurrent: true },
  );
  transport.onReconnect(() => {
    for (const listener of transportReconnectListeners) {
      try {
        listener();
      } catch {
        // Swallow listener errors.
      }
    }
  });

  const api: NativeApi = {
    dialogs: {
      pickFolder: async () => {
        if (!window.desktopBridge) return null;
        return window.desktopBridge.pickFolder();
      },
      confirm: async (message) => {
        if (window.desktopBridge) {
          return window.desktopBridge.confirm(message);
        }
        return window.confirm(message);
      },
    },
    terminal: {
      open: (input) => rpcClient.terminal.open(input as never),
      write: (input) => rpcClient.terminal.write(input as never),
      resize: (input) => rpcClient.terminal.resize(input as never),
      clear: (input) => rpcClient.terminal.clear(input as never),
      restart: (input) => rpcClient.terminal.restart(input as never),
      close: (input) => rpcClient.terminal.close(input as never),
      onEvent: (callback) => rpcClient.terminal.onEvent(callback),
    },
    projects: {
      browseDirectory: rpcClient.projects.browseDirectory,
      createDirectory: rpcClient.projects.createDirectory,
      searchEntries: rpcClient.projects.searchEntries,
      writeFile: rpcClient.projects.writeFile,
      readFile: rpcClient.projects.readFile,
    },
    shell: {
      openInEditor: (cwd, editor) => rpcClient.shell.openInEditor({ cwd, editor }),
      openExternal: async (url) => {
        if (window.desktopBridge) {
          const opened = await window.desktopBridge.openExternal(url);
          if (!opened) {
            throw new Error("Unable to open link.");
          }
          return;
        }

        window.open(url, "_blank", "noopener,noreferrer");
      },
    },
    git: {
      pull: rpcClient.git.pull,
      push: rpcClient.git.push,
      commit: rpcClient.git.commit,
      status: rpcClient.git.status,
      readWorkingTreeFileDiff: rpcClient.git.readWorkingTreeFileDiff,
      stageFiles: rpcClient.git.stageFiles,
      unstageFiles: rpcClient.git.unstageFiles,
      runStackedAction: (input) =>
        rpcClient.git.runStackedAction(input, {
          onProgress: emitGitActionProgress,
        }),
      listBranches: rpcClient.git.listBranches,
      createWorktree: rpcClient.git.createWorktree,
      removeWorktree: rpcClient.git.removeWorktree,
      createBranch: rpcClient.git.createBranch,
      checkout: rpcClient.git.checkout,
      init: rpcClient.git.init,
      resolvePullRequest: rpcClient.git.resolvePullRequest,
      preparePullRequestThread: rpcClient.git.preparePullRequestThread,
      generateCommitMessage: rpcClient.git.generateCommitMessage,
      onActionProgress: (callback) => {
        gitActionProgressListeners.add(callback);
        return () => {
          gitActionProgressListeners.delete(callback);
        };
      },
    },
    contextMenu: {
      show: async <T extends string>(
        items: readonly ContextMenuItem<T>[],
        position?: { x: number; y: number },
      ): Promise<T | null> => {
        if (window.desktopBridge) {
          return window.desktopBridge.showContextMenu(items, position) as Promise<T | null>;
        }
        return showContextMenuFallback(items, position);
      },
    },
    server: {
      getConfig: rpcClient.server.getConfig,
      refreshProviders: rpcClient.server.refreshProviders,
      upsertKeybinding: rpcClient.server.upsertKeybinding,
      getSettings: rpcClient.server.getSettings,
      updateSettings: rpcClient.server.updateSettings,
      updateTelegramNotifications: rpcClient.server.updateTelegramNotifications,
      sendTestTelegramNotification: rpcClient.server.sendTestTelegramNotification,
    },
    orchestration: {
      getSnapshot: rpcClient.orchestration.getSnapshot,
      dispatchCommand: rpcClient.orchestration.dispatchCommand,
      getTurnDiff: rpcClient.orchestration.getTurnDiff,
      getFullThreadDiff: rpcClient.orchestration.getFullThreadDiff,
      replayEvents: (fromSequenceExclusive) =>
        rpcClient.orchestration
          .replayEvents({ fromSequenceExclusive })
          .then((events) => [...events]),
      onDomainEvent: (callback) => rpcClient.orchestration.onDomainEvent(callback),
    },
  };

  instance = { api, transport };
  return api;
}
