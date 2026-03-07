# 6d

6d is a minimal web GUI for coding agents. Currently Codex-first, with Claude Code support coming soon.

## How to use

> [!WARNING]
> You need to have [Codex CLI](https://github.com/openai/codex) installed and authorized for 6d to work.

```bash
npx @dinweldik/6d
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

The frontend listens on `http://localhost:5733` by default and the backend on `ws://localhost:3773`, but the browser automatically normalizes those URLs (to `wss://` when the page is served over HTTPS and to the current host when you visit from another device).

### Accessing from other devices

To surface the UI on a phone without republishing, run the stack locally and proxy the ports over your VPN of choice. For example, with Tailscale:

```bash
tailscale serve https://sixd.example 5733
tailscale serve https://sixd-example-ws.example 3773
```

The client rewrites `localhost` hosts to your browser’s origin and upgrades to `wss`, so just open `https://sixd.example` on your phone after both ports are forwarded. If you need to target a different WebSocket host, set `VITE_WS_URL` before running `bun run dev`.

### Browser notifications

Notifications are available via the "Browser notifications" toggle under Settings → Notifications. Grant permission by hitting the "Request permission" button and make sure the switch is turned on. The app registers a service worker at `/browser-notifications-sw.js` so it can show messages even when the tab is in the background or the screen is locked.

If you see "Checkpoint ref is unavailable for turn X" while looking at the diff viewer, the server is still scanning your turn history; wait a moment and reopen the diff, or click a different turn to trigger another fetch. The query will keep retrying for a few seconds while the checkpoint becomes available.

### Publishing to npm

The CLI publishes from `apps/server` and politics start at version `1.0.0`. When it is time to ship a release:

1. Build the monorepo: `bun run build`.
2. From the project root run `node apps/server/scripts/cli.ts build`.
3. Publish with `node apps/server/scripts/cli.ts publish --tag latest --access public --verbose`.

NPM requires an automation token; create one at `https://www.npmjs.com/settings/dinweldik/tokens`. Do **not** persist the token inside `~/.zshrc`. Instead, export it just for the publish command:

```bash
export NPM_TOKEN=<your-token>
# …run the publish command above…
unset NPM_TOKEN
```

The publish script automatically writes the token to a temporary `.npmrc` and removes it afterward, so the credential never lands in your shell profile.
