# 6d

6d is a minimal web GUI for coding agents. Currently Codex-first, with Claude Code support coming soon.

## How to use

> [!WARNING]
> You need to have [Codex CLI](https://github.com/openai/codex) installed and authorized for 6d to work.

```bash
npx fatma-app
```

You can also just install the desktop app. It's cooler.

Install the [desktop app from the Releases page](https://github.com/dinweldik/6d/releases)

## Some notes

We are very very early in this project. Expect bugs.

We are not accepting contributions yet.

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).

## Development

### Running locally

Install dependencies once with `bun install` and then start the stack with:

```bash
bun run dev
```

That launches the backend (`apps/server`) plus the Vite web client (`apps/web`). You can also split the pieces:

- `bun run dev:web` to run only the web UI (useful when iterating on React)
- `bun run dev:server` to run only the backend service and Codex worker
- `bun run dev:desktop` to exercise the bundled Electron shell
- `bun run dev:single` to mimic `npx fatma-app` (single process server + built web UI, no Vite HMR)

The frontend listens on `http://localhost:5733` by default and the backend on `ws://localhost:3773`, but the browser automatically normalizes those URLs (to `wss://` when the page is served over HTTPS and to the current host when you visit from another device).

### Accessing from other devices

For the best mobile and PWA experience, use one HTTPS origin for both the UI and the server. The easiest options are:

- `npx fatma-app --host 0.0.0.0 --no-browser`
- `bun run dev:single`

Then publish that single local port through Tailscale Serve:

```bash
tailscale serve https://sixd.example 3773
```

Open `https://sixd.example` on your phone, then install it from the browser UI. This keeps the service worker, manifest, and WebSocket traffic on one stable origin, which is what you want for a standalone app.

If you are actively iterating on the frontend with `bun run dev`, keep using the split Vite + backend setup, but treat that as a development workflow rather than the installable mobile path. The client can still normalize `localhost` hosts and upgrade to `wss`, but the best install/update behavior comes from the single-origin setup above.

See [docs/pwa.md](./docs/pwa.md) for the recommended install and update flow.

### Notifications

Notifications are delivered through Telegram from the server. Configure a bot token and Telegram user/chat ID under Settings → Notifications, then use the test button to verify delivery.

If you see "Checkpoint ref is unavailable for turn X" while looking at the diff viewer, the server is still scanning your turn history; wait a moment and reopen the diff, or click a different turn to trigger another fetch. The query will keep retrying for a few seconds while the checkpoint becomes available.

### Publishing to npm

Use the root publish command. It bumps `apps/server` to the next patch version by default, runs `bun lint`, runs `bun typecheck`, rebuilds the monorepo so the bundled web client is current, builds the CLI package, writes a temporary `.npmrc` from `NPM_TOKEN`, publishes `fatma-app`, and cleans up the temp auth file afterward.

```bash
bun run publish:npm
```

Useful variants:

- `bun run publish:npm -- --version 1.0.4`
- `bun run publish:npm -- --bump minor`
- `bun run publish:npm -- --dry-run --verbose`

The command requires `NPM_TOKEN` in the current shell and uses only that token for npm auth during publish.

See [docs/release.md](./docs/release.md) for the full release process.
