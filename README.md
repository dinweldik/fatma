<p align="center">
  <img src="./assets/prod/logo.svg" alt="fatma logo" width="140" />
</p>

# fatma

```
Run Codex across all your local projects from one mobile-friendly web UI, whether you are at your desk or working from your phone on the go.
```

fatma started as a fork of [t3code](https://github.com/pingdotgg/t3code).
fatma is a GUI for coding agents. Currently Codex-first, with Claude Code support coming soon.

The main idea is simple: you already have a folder full of projects, but they are not all in the same phase of life. Some are work projects from your 9 to 5. Some are old hobby repos you have not touched in months. Some are fresh experiments, side projects, or startup ideas you want to push further.

fatma turns that projects folder into a browser-based control surface for Codex. You run `npx fatma-app` in the parent directory, open the web UI, and launch into any project from there. From the UI you can run Codex against a selected repo, start dev servers, execute shell commands, inspect code changes, and commit without bouncing between terminals.

It is also meant to support the earliest stage of a project. When a new idea shows up, you can create a project directly from the web UI and let AI help you turn it into a first prototype immediately.

That setup also works well beyond your laptop. You can run fatma on your home server or a VPS, expose it through Tailscale, and work from your phone while you are on the go. The goal is to let you move between projects and keep shipping from anywhere, whenever you want, without losing access to your usual development environment.

When Codex finishes a task or gets blocked and needs input to continue, fatma can send Telegram notifications so you do not need to keep the UI open the whole time.

## Installation

> [!WARNING]
> fatma currently supports Codex and Claude.
> Install and authenticate at least one provider before use:
>
> - Codex: install [Codex CLI](https://github.com/openai/codex) and run `codex login`
> - Claude: install Claude Code and run `claude auth login`

### Run without installing

```bash
npx fatma-app
```

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
tailscale serve https://fatma.example 3773
```

Open `https://fatma.example` on your phone, then install it from the browser UI. This keeps the service worker, manifest, and WebSocket traffic on one stable origin, which is what you want for a standalone app.

If you are actively iterating on the frontend with `bun run dev`, keep using the split Vite + backend setup, but treat that as a development workflow rather than the installable mobile path. The client can still normalize `localhost` hosts and upgrade to `wss`, but the best install/update behavior comes from the single-origin setup above.

See [docs/pwa.md](./docs/pwa.md) for the recommended install and update flow.

### Notifications (Telegram)

Notifications are delivered through Telegram from the server. Configure a bot token and Telegram user/chat ID under Settings → Notifications, then use the test button to verify delivery.

### Publishing to npm

Use the root publish command. It picks the next available patch version for `apps/server` by default, taking already-published npm versions into account, then runs `bun lint`, runs `bun typecheck`, rebuilds the monorepo so the bundled web client is current, builds the CLI package, writes a temporary `.npmrc` from `NPM_TOKEN`, publishes `fatma-app`, and cleans up the temp auth file afterward.

```bash
bun run publish:npm
```

Useful variants:

- `bun run publish:npm -- --version 1.0.4`
- `bun run publish:npm -- --bump minor`
- `bun run publish:npm -- --dry-run --verbose`

The command requires `NPM_TOKEN` in the current shell and uses only that token for npm auth during publish.

See [docs/release.md](./docs/release.md) for the full release process.
