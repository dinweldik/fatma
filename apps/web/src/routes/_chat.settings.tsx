import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { type ProviderKind, type ServerConfig as ServerRuntimeConfig } from "@t3tools/contracts";
import { getModelOptions, normalizeModelSlug } from "@t3tools/shared/model";
import { ZapIcon } from "lucide-react";

import {
  APP_SERVICE_TIER_OPTIONS,
  MAX_CUSTOM_MODEL_LENGTH,
  shouldShowFastTierIcon,
  useAppSettings,
} from "../appSettings";
import { isElectron } from "../env";
import { useTheme } from "../hooks/useTheme";
import { serverConfigQueryOptions, serverQueryKeys } from "../lib/serverReactQuery";
import { ensureNativeApi } from "../nativeApi";
import { usePwa } from "../pwa";
import { preferredTerminalEditor } from "../terminal-links";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../components/ui/select";
import { Switch } from "../components/ui/switch";
import { SidebarInset } from "~/components/ui/sidebar";

const THEME_OPTIONS = [
  {
    value: "system",
    label: "System",
    description: "Match your OS appearance setting.",
  },
  {
    value: "light",
    label: "Light",
    description: "Always use the light theme.",
  },
  {
    value: "dark",
    label: "Dark",
    description: "Always use the dark theme.",
  },
] as const;

const MODEL_PROVIDER_SETTINGS: Array<{
  provider: ProviderKind;
  title: string;
  description: string;
  placeholder: string;
  example: string;
}> = [
  {
    provider: "codex",
    title: "Codex",
    description: "Save additional Codex model slugs for the picker and `/model` command.",
    placeholder: "your-codex-model-slug",
    example: "gpt-6.7-codex-ultra-preview",
  },
] as const;

function getCustomModelsForProvider(
  settings: ReturnType<typeof useAppSettings>["settings"],
  provider: ProviderKind,
) {
  switch (provider) {
    case "codex":
    default:
      return settings.customCodexModels;
  }
}

function getDefaultCustomModelsForProvider(
  defaults: ReturnType<typeof useAppSettings>["defaults"],
  provider: ProviderKind,
) {
  switch (provider) {
    case "codex":
    default:
      return defaults.customCodexModels;
  }
}

function patchCustomModels(provider: ProviderKind, models: string[]) {
  switch (provider) {
    case "codex":
    default:
      return { customCodexModels: models };
  }
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallback;
}

function SettingsRouteView() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const { settings, defaults, updateSettings } = useAppSettings();
  const queryClient = useQueryClient();
  const serverConfigQuery = useQuery(serverConfigQueryOptions());
  const pwa = usePwa();
  const [isOpeningKeybindings, setIsOpeningKeybindings] = useState(false);
  const [openKeybindingsError, setOpenKeybindingsError] = useState<string | null>(null);
  const [pwaInstallStatus, setPwaInstallStatus] = useState<string | null>(null);
  const [customModelInputByProvider, setCustomModelInputByProvider] = useState<
    Record<ProviderKind, string>
  >({
    codex: "",
  });
  const [customModelErrorByProvider, setCustomModelErrorByProvider] = useState<
    Partial<Record<ProviderKind, string | null>>
  >({});
  const [telegramChatId, setTelegramChatId] = useState("");
  const [telegramBotToken, setTelegramBotToken] = useState("");
  const [clearSavedTelegramBotToken, setClearSavedTelegramBotToken] = useState(false);
  const [telegramDraftInitialized, setTelegramDraftInitialized] = useState(false);
  const [telegramFormStatus, setTelegramFormStatus] = useState<{
    tone: "success" | "error" | "info";
    message: string;
  } | null>(null);

  const codexBinaryPath = settings.codexBinaryPath;
  const codexHomePath = settings.codexHomePath;
  const codexServiceTier = settings.codexServiceTier;
  const keybindingsConfigPath = serverConfigQuery.data?.keybindingsConfigPath ?? null;
  const telegramNotifications = serverConfigQuery.data?.telegramNotifications ?? null;

  useEffect(() => {
    if (!telegramNotifications || telegramDraftInitialized) {
      return;
    }
    setTelegramChatId(telegramNotifications.chatId);
    setTelegramDraftInitialized(true);
  }, [telegramDraftInitialized, telegramNotifications]);

  const openKeybindingsFile = useCallback(() => {
    if (!keybindingsConfigPath) return;
    setOpenKeybindingsError(null);
    setIsOpeningKeybindings(true);
    const api = ensureNativeApi();
    void api.shell
      .openInEditor(keybindingsConfigPath, preferredTerminalEditor())
      .catch((error) => {
        setOpenKeybindingsError(
          error instanceof Error ? error.message : "Unable to open keybindings file.",
        );
      })
      .finally(() => {
        setIsOpeningKeybindings(false);
      });
  }, [keybindingsConfigPath]);

  const addCustomModel = useCallback((provider: ProviderKind) => {
    const customModelInput = customModelInputByProvider[provider];
    const customModels = getCustomModelsForProvider(settings, provider);
    const normalized = normalizeModelSlug(customModelInput, provider);
    if (!normalized) {
      setCustomModelErrorByProvider((existing) => ({
        ...existing,
        [provider]: "Enter a model slug.",
      }));
      return;
    }
    if (getModelOptions(provider).some((option) => option.slug === normalized)) {
      setCustomModelErrorByProvider((existing) => ({
        ...existing,
        [provider]: "That model is already built in.",
      }));
      return;
    }
    if (normalized.length > MAX_CUSTOM_MODEL_LENGTH) {
      setCustomModelErrorByProvider((existing) => ({
        ...existing,
        [provider]: `Model slugs must be ${MAX_CUSTOM_MODEL_LENGTH} characters or less.`,
      }));
      return;
    }
    if (customModels.includes(normalized)) {
      setCustomModelErrorByProvider((existing) => ({
        ...existing,
        [provider]: "That custom model is already saved.",
      }));
      return;
    }

    updateSettings(patchCustomModels(provider, [...customModels, normalized]));
    setCustomModelInputByProvider((existing) => ({
      ...existing,
      [provider]: "",
    }));
    setCustomModelErrorByProvider((existing) => ({
      ...existing,
      [provider]: null,
    }));
  }, [customModelInputByProvider, settings, updateSettings]);

  const removeCustomModel = useCallback(
    (provider: ProviderKind, slug: string) => {
      const customModels = getCustomModelsForProvider(settings, provider);
      updateSettings(patchCustomModels(provider, customModels.filter((model) => model !== slug)));
      setCustomModelErrorByProvider((existing) => ({
        ...existing,
        [provider]: null,
      }));
    },
    [settings, updateSettings],
  );

  const buildTelegramMutationInput = useCallback(() => {
    return {
      chatId: telegramChatId,
      ...(telegramBotToken.trim().length > 0 ? { botToken: telegramBotToken } : {}),
      ...(clearSavedTelegramBotToken ? { clearBotToken: true } : {}),
    };
  }, [clearSavedTelegramBotToken, telegramBotToken, telegramChatId]);

  const saveTelegramSettingsMutation = useMutation({
    mutationFn: async () => {
      return ensureNativeApi().server.updateTelegramNotifications(buildTelegramMutationInput());
    },
    onSuccess: (nextSettings) => {
      queryClient.setQueryData<ServerRuntimeConfig>(serverQueryKeys.config(), (existing) =>
        existing ? { ...existing, telegramNotifications: nextSettings } : existing,
      );
      setTelegramChatId(nextSettings.chatId);
      setTelegramBotToken("");
      setClearSavedTelegramBotToken(false);
      setTelegramDraftInitialized(true);
      setTelegramFormStatus({
        tone: nextSettings.enabled ? "success" : "info",
        message: nextSettings.enabled
          ? "Telegram notifications saved. 6d will send Telegram messages when Codex finishes or needs your input."
          : "Telegram settings saved. Add both a bot token and a user/chat ID to enable notifications.",
      });
    },
    onError: (error) => {
      setTelegramFormStatus({
        tone: "error",
        message: toErrorMessage(error, "Unable to save Telegram notification settings."),
      });
    },
  });

  const sendTestTelegramNotificationMutation = useMutation({
    mutationFn: async () => {
      return ensureNativeApi().server.sendTestTelegramNotification(buildTelegramMutationInput());
    },
    onSuccess: () => {
      setTelegramFormStatus({
        tone: "success",
        message: "Test Telegram notification sent.",
      });
    },
    onError: (error) => {
      setTelegramFormStatus({
        tone: "error",
        message: toErrorMessage(error, "Unable to send a test Telegram notification."),
      });
    },
  });

  const hasDraftTelegramBotToken = telegramBotToken.trim().length > 0;
  const hasEffectiveTelegramBotToken = clearSavedTelegramBotToken
    ? hasDraftTelegramBotToken
    : hasDraftTelegramBotToken || (telegramNotifications?.hasBotToken ?? false);
  const canSendTelegramTest =
    telegramChatId.trim().length > 0 &&
    hasEffectiveTelegramBotToken &&
    !saveTelegramSettingsMutation.isPending &&
    !sendTestTelegramNotificationMutation.isPending;
  const isTelegramBusy =
    saveTelegramSettingsMutation.isPending || sendTestTelegramNotificationMutation.isPending;
  const effectivePwaVersion =
    pwa.latestVersion && pwa.latestVersion !== pwa.currentVersion
      ? `${pwa.currentVersion} -> ${pwa.latestVersion}`
      : pwa.currentVersion;

  const installPwa = useCallback(() => {
    setPwaInstallStatus(null);
    void pwa
      .promptInstall()
      .then((choice) => {
        if (!choice) {
          setPwaInstallStatus("Use your browser install action if no install prompt appears.");
          return;
        }
        if (choice.outcome === "accepted") {
          setPwaInstallStatus("Install prompt accepted. Finish adding 6d from your browser UI.");
          return;
        }
        setPwaInstallStatus("Install prompt dismissed.");
      })
      .catch((error) => {
        setPwaInstallStatus(toErrorMessage(error, "Unable to open the install prompt."));
      });
  }, [pwa]);

  const refreshPwa = useCallback(() => {
    setPwaInstallStatus(null);
    void pwa.checkForUpdates().catch((error) => {
      setPwaInstallStatus(toErrorMessage(error, "Unable to check for updates."));
    });
  }, [pwa]);

  const applyPwaUpdate = useCallback(() => {
    setPwaInstallStatus(null);
    void pwa.applyUpdate().catch((error) => {
      setPwaInstallStatus(toErrorMessage(error, "Unable to apply the latest web app update."));
    });
  }, [pwa]);

  return (
    <SidebarInset className="app-mobile-viewport min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        {isElectron && (
          <div className="drag-region flex h-[52px] shrink-0 items-center border-b border-border px-5">
            <span className="text-xs font-medium tracking-wide text-muted-foreground/70">
              Settings
            </span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
            <header className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Settings</h1>
              <p className="text-sm text-muted-foreground">
                Configure app-level preferences for this device.
              </p>
            </header>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Appearance</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Choose how 6d handles light and dark mode.
                </p>
              </div>

              <div className="space-y-2" role="radiogroup" aria-label="Theme preference">
                {THEME_OPTIONS.map((option) => {
                  const selected = theme === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className={`flex w-full items-start justify-between rounded-lg border px-3 py-2 text-left transition-colors ${
                        selected
                          ? "border-primary/60 bg-primary/8 text-foreground"
                          : "border-border bg-background text-muted-foreground hover:bg-accent"
                      }`}
                      onClick={() => setTheme(option.value)}
                    >
                      <span className="flex flex-col">
                        <span className="text-sm font-medium">{option.label}</span>
                        <span className="text-xs">{option.description}</span>
                      </span>
                      {selected ? (
                        <span className="rounded bg-primary/14 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                          Selected
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>

              <p className="mt-4 text-xs text-muted-foreground">
                Active theme: <span className="font-medium text-foreground">{resolvedTheme}</span>
              </p>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Codex App Server</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  These overrides apply to new sessions and let you use a non-default Codex install.
                </p>
              </div>

              <div className="space-y-4">
                <label htmlFor="codex-binary-path" className="block space-y-1">
                  <span className="text-xs font-medium text-foreground">Codex binary path</span>
                  <Input
                    id="codex-binary-path"
                    value={codexBinaryPath}
                    onChange={(event) => updateSettings({ codexBinaryPath: event.target.value })}
                    placeholder="codex"
                    spellCheck={false}
                  />
                  <span className="text-xs text-muted-foreground">
                    Leave blank to use <code>codex</code> from your PATH.
                  </span>
                </label>

                <label htmlFor="codex-home-path" className="block space-y-1">
                  <span className="text-xs font-medium text-foreground">CODEX_HOME path</span>
                  <Input
                    id="codex-home-path"
                    value={codexHomePath}
                    onChange={(event) => updateSettings({ codexHomePath: event.target.value })}
                    placeholder="/Users/you/.codex"
                    spellCheck={false}
                  />
                  <span className="text-xs text-muted-foreground">
                    Optional custom Codex home/config directory.
                  </span>
                </label>

                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <p>
                    Binary source:{" "}
                    <span className="font-medium text-foreground">{codexBinaryPath || "PATH"}</span>
                  </p>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      updateSettings({
                        codexBinaryPath: defaults.codexBinaryPath,
                        codexHomePath: defaults.codexHomePath,
                      })
                    }
                  >
                    Reset codex overrides
                  </Button>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Web App</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Install 6d as a standalone app shell and keep the installed version current.
                </p>
              </div>

              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-border bg-background px-3 py-3">
                    <p className="text-xs font-medium text-foreground">Shell status</p>
                    <p className="mt-1 text-sm text-foreground">
                      {pwa.isInstalled ? "Installed standalone app" : "Browser tab"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {pwa.updateAvailable
                        ? "A newer shell is ready to activate."
                        : "Updates are checked automatically while the app is open."}
                    </p>
                  </div>

                  <div className="rounded-lg border border-border bg-background px-3 py-3">
                    <p className="text-xs font-medium text-foreground">Version</p>
                    <p className="mt-1 text-sm font-medium text-foreground">
                      <code>{effectivePwaVersion}</code>
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Current build {pwa.currentVersion}
                      {pwa.latestVersion ? `, latest seen ${pwa.latestVersion}` : ""}.
                    </p>
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-background px-3 py-3 text-xs text-muted-foreground">
                  <p>{pwa.supportDetails}</p>
                  {pwa.isSupported ? (
                    <p className="mt-2">
                      Install instructions:{" "}
                      <span className="text-foreground">{pwa.installInstructions}</span>
                    </p>
                  ) : null}
                </div>

                <div className="rounded-lg border border-border bg-background px-3 py-3 text-xs text-muted-foreground">
                  <p>
                    Best mobile setup: open the same HTTPS URL each time, install from that origin,
                    and use Settings or the update toast to reload when a new version is available.
                  </p>
                </div>

                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={refreshPwa}
                    disabled={!pwa.isSupported || pwa.isCheckingForUpdates}
                  >
                    {pwa.isCheckingForUpdates ? "Checking..." : "Check for updates"}
                  </Button>
                  {pwa.updateAvailable ? (
                    <Button size="xs" onClick={applyPwaUpdate} disabled={!pwa.isSupported}>
                      Reload to update
                    </Button>
                  ) : null}
                  {!pwa.isInstalled && pwa.canInstall ? (
                    <Button size="xs" variant="outline" onClick={installPwa}>
                      Install app
                    </Button>
                  ) : null}
                </div>

                {pwaInstallStatus ? (
                  <p className="text-xs text-muted-foreground">{pwaInstallStatus}</p>
                ) : null}
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Models</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Save additional provider model slugs so they appear in the chat model picker and
                  `/model` command suggestions.
                </p>
              </div>

              <div className="space-y-5">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-foreground">Default service tier</span>
                  <Select
                    items={APP_SERVICE_TIER_OPTIONS.map((option) => ({
                      label: option.label,
                      value: option.value,
                    }))}
                    value={codexServiceTier}
                    onValueChange={(value) => {
                      if (!value) return;
                      updateSettings({ codexServiceTier: value });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup alignItemWithTrigger={false}>
                      {APP_SERVICE_TIER_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          <div className="flex min-w-0 items-center gap-2">
                            {option.value === "fast" ? (
                              <ZapIcon className="size-3.5 text-amber-500" />
                            ) : (
                              <span className="size-3.5 shrink-0" aria-hidden="true" />
                            )}
                            <span className="truncate">{option.label}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                  <span className="text-xs text-muted-foreground">
                    {APP_SERVICE_TIER_OPTIONS.find((option) => option.value === codexServiceTier)
                      ?.description ?? "Use Codex defaults without forcing a service tier."}
                  </span>
                </label>

                {MODEL_PROVIDER_SETTINGS.map((providerSettings) => {
                  const provider = providerSettings.provider;
                  const customModels = getCustomModelsForProvider(settings, provider);
                  const customModelInput = customModelInputByProvider[provider];
                  const customModelError = customModelErrorByProvider[provider] ?? null;
                  return (
                    <div
                      key={provider}
                      className="rounded-xl border border-border bg-background/50 p-4"
                    >
                      <div className="mb-4">
                        <h3 className="text-sm font-medium text-foreground">
                          {providerSettings.title}
                        </h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {providerSettings.description}
                        </p>
                      </div>

                      <div className="space-y-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                          <label
                            htmlFor={`custom-model-slug-${provider}`}
                            className="block flex-1 space-y-1"
                          >
                            <span className="text-xs font-medium text-foreground">
                              Custom model slug
                            </span>
                            <Input
                              id={`custom-model-slug-${provider}`}
                              value={customModelInput}
                              onChange={(event) => {
                                const value = event.target.value;
                                setCustomModelInputByProvider((existing) => ({
                                  ...existing,
                                  [provider]: value,
                                }));
                                if (customModelError) {
                                  setCustomModelErrorByProvider((existing) => ({
                                    ...existing,
                                    [provider]: null,
                                  }));
                                }
                              }}
                              onKeyDown={(event) => {
                                if (event.key !== "Enter") return;
                                event.preventDefault();
                                addCustomModel(provider);
                              }}
                              placeholder={providerSettings.placeholder}
                              spellCheck={false}
                            />
                            <span className="text-xs text-muted-foreground">
                              Example: <code>{providerSettings.example}</code>
                            </span>
                          </label>

                          <Button
                            className="sm:mt-6"
                            type="button"
                            onClick={() => addCustomModel(provider)}
                          >
                            Add model
                          </Button>
                        </div>

                        {customModelError ? (
                          <p className="text-xs text-destructive">{customModelError}</p>
                        ) : null}

                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                            <p>Saved custom models: {customModels.length}</p>
                            {customModels.length > 0 ? (
                              <Button
                                size="xs"
                                variant="outline"
                                onClick={() =>
                                  updateSettings(
                                    patchCustomModels(
                                      provider,
                                      [...getDefaultCustomModelsForProvider(defaults, provider)],
                                    ),
                                  )
                                }
                              >
                                Reset custom models
                              </Button>
                            ) : null}
                          </div>

                          {customModels.length > 0 ? (
                            <div className="space-y-2">
                              {customModels.map((slug) => (
                                <div
                                  key={`${provider}:${slug}`}
                                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2"
                                >
                                  <div className="flex min-w-0 flex-1 items-center gap-2">
                                    {provider === "codex" && shouldShowFastTierIcon(slug, codexServiceTier) ? (
                                      <ZapIcon className="size-3.5 shrink-0 text-amber-500" />
                                    ) : null}
                                    <code className="min-w-0 flex-1 truncate text-xs text-foreground">
                                      {slug}
                                    </code>
                                  </div>
                                  <Button
                                    size="xs"
                                    variant="ghost"
                                    onClick={() => removeCustomModel(provider, slug)}
                                  >
                                    Remove
                                  </Button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="rounded-lg border border-dashed border-border bg-background px-3 py-4 text-xs text-muted-foreground">
                              No custom models saved yet.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Responses</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Control how assistant output is rendered during a turn.
                </p>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-foreground">Stream assistant messages</p>
                  <p className="text-xs text-muted-foreground">
                    Show token-by-token output while a response is in progress.
                  </p>
                </div>
                <Switch
                  checked={settings.enableAssistantStreaming}
                  onCheckedChange={(checked) =>
                    updateSettings({
                      enableAssistantStreaming: Boolean(checked),
                    })
                  }
                  aria-label="Stream assistant messages"
                />
              </div>

              {settings.enableAssistantStreaming !== defaults.enableAssistantStreaming ? (
                <div className="mt-3 flex justify-end">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      updateSettings({
                        enableAssistantStreaming: defaults.enableAssistantStreaming,
                      })
                    }
                  >
                    Restore default
                  </Button>
                </div>
              ) : null}
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Notifications</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Server-side Telegram notifications for long-running turns, approvals, and user
                  input requests.
                </p>
              </div>

              <div className="space-y-4">
                <label htmlFor="telegram-bot-token" className="block space-y-1">
                  <span className="text-xs font-medium text-foreground">Telegram bot token</span>
                  <Input
                    id="telegram-bot-token"
                    type="password"
                    autoComplete="off"
                    placeholder={
                      telegramNotifications?.hasBotToken && !clearSavedTelegramBotToken
                        ? "Leave blank to keep the saved bot token"
                        : "123456789:AA..."
                    }
                    value={telegramBotToken}
                    onChange={(event) => {
                      setTelegramBotToken(event.target.value);
                      setTelegramFormStatus(null);
                    }}
                  />
                </label>

                <div className="rounded-lg border border-border bg-background px-3 py-3 text-xs text-muted-foreground">
                  <p>
                    {telegramNotifications?.hasBotToken && !clearSavedTelegramBotToken
                      ? `Saved bot token ${telegramNotifications.botTokenHint ?? "is present"}. Leave the field blank to keep it, or enter a new token to replace it.`
                      : clearSavedTelegramBotToken
                        ? "The saved bot token will be removed when you save."
                        : "The bot token is stored on the server and is never read back into the browser after it is saved."}
                  </p>
                  {telegramNotifications?.hasBotToken ? (
                    <div className="mt-3 flex justify-end">
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => {
                          setClearSavedTelegramBotToken((value) => !value);
                          setTelegramFormStatus(null);
                        }}
                      >
                        {clearSavedTelegramBotToken ? "Keep saved token" : "Remove saved token"}
                      </Button>
                    </div>
                  ) : null}
                </div>

                <label htmlFor="telegram-chat-id" className="block space-y-1">
                  <span className="text-xs font-medium text-foreground">Telegram user / chat ID</span>
                  <Input
                    id="telegram-chat-id"
                    autoComplete="off"
                    placeholder="123456789"
                    value={telegramChatId}
                    onChange={(event) => {
                      setTelegramChatId(event.target.value);
                      setTelegramFormStatus(null);
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    For direct messages, open the bot in Telegram and start it first. The test
                    button uses the current values, even if you have not saved them yet.
                  </p>
                </label>

                <div className="rounded-lg border border-border bg-background px-3 py-3 text-xs text-muted-foreground">
                  <p>
                    {telegramNotifications?.enabled
                      ? "Telegram notifications are active. 6d will message you when Codex finishes or needs approval/input."
                      : "Telegram notifications are inactive until both a bot token and a user/chat ID are configured."}
                  </p>
                  {telegramFormStatus ? (
                    <p
                      className={`mt-2 ${
                        telegramFormStatus.tone === "error"
                          ? "text-destructive"
                          : telegramFormStatus.tone === "success"
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-muted-foreground"
                      }`}
                    >
                      {telegramFormStatus.message}
                    </p>
                  ) : null}
                </div>

                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => void sendTestTelegramNotificationMutation.mutateAsync()}
                    disabled={!canSendTelegramTest}
                  >
                    {sendTestTelegramNotificationMutation.isPending
                      ? "Sending..."
                      : "Send test notification"}
                  </Button>
                  <Button
                    size="xs"
                    onClick={() => void saveTelegramSettingsMutation.mutateAsync()}
                    disabled={isTelegramBusy}
                  >
                    {saveTelegramSettingsMutation.isPending ? "Saving..." : "Save settings"}
                  </Button>
                </div>
                {serverConfigQuery.isLoading ? (
                  <p className="text-xs text-muted-foreground">Loading Telegram settings...</p>
                ) : null}
                {serverConfigQuery.isError ? (
                  <p className="text-xs text-destructive">
                    {toErrorMessage(
                      serverConfigQuery.error,
                      "Unable to load Telegram notification settings.",
                    )}
                  </p>
                ) : null}
                {telegramNotifications?.hasBotToken === false && telegramBotToken.trim().length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No bot token is currently saved on the server.
                  </p>
                ) : null}
                {clearSavedTelegramBotToken && !hasDraftTelegramBotToken ? (
                  <p className="text-xs text-muted-foreground">
                    Save to remove the current token, or enter a replacement token before saving.
                  </p>
                ) : null}
                {!hasEffectiveTelegramBotToken && telegramChatId.trim().length > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Add a bot token before saving or sending a test notification.
                  </p>
                ) : null}
                {!telegramNotifications?.enabled && telegramChatId.trim().length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Add a bot token and user/chat ID to enable notifications.
                  </p>
                ) : null}
                {serverConfigQuery.isSuccess && !telegramNotifications?.enabled ? (
                  <div className="rounded-lg border border-border bg-background px-3 py-3 text-xs text-muted-foreground">
                    <p>
                      6d sends Telegram messages from the server, so delivery does not depend on
                      the current browser tab staying active.
                    </p>
                  </div>
                ) : null}
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Keybindings</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Open the persisted <code>keybindings.json</code> file to edit advanced bindings
                  directly.
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-foreground">Config file path</p>
                    <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                      {keybindingsConfigPath ?? "Resolving keybindings path..."}
                    </p>
                  </div>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={!keybindingsConfigPath || isOpeningKeybindings}
                    onClick={openKeybindingsFile}
                  >
                    {isOpeningKeybindings ? "Opening..." : "Open keybindings.json"}
                  </Button>
                </div>

                <p className="text-xs text-muted-foreground">
                  Opens in your preferred editor selection.
                </p>
                {openKeybindingsError ? (
                  <p className="text-xs text-destructive">{openKeybindingsError}</p>
                ) : null}
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Safety</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Additional guardrails for destructive local actions.
                </p>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-foreground">Confirm thread deletion</p>
                  <p className="text-xs text-muted-foreground">
                    Ask for confirmation before deleting a thread and its chat history.
                  </p>
                </div>
                <Switch
                  checked={settings.confirmThreadDelete}
                  onCheckedChange={(checked) =>
                    updateSettings({
                      confirmThreadDelete: Boolean(checked),
                    })
                  }
                  aria-label="Confirm thread deletion"
                />
              </div>

              {settings.confirmThreadDelete !== defaults.confirmThreadDelete ? (
                <div className="mt-3 flex justify-end">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      updateSettings({
                        confirmThreadDelete: defaults.confirmThreadDelete,
                      })
                    }
                  >
                    Restore default
                  </Button>
                </div>
              ) : null}
            </section>
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/settings")({
  component: SettingsRouteView,
});
