<p align="center">
  <img src="https://raw.githubusercontent.com/dinweldik/fatma/main/assets/prod/logo.svg" alt="fatma logo" width="140" />
</p>

# fatma-app

`fatma-app` is a mobile-friendly web UI for running Codex across a whole folder of local projects from one place.

Run it in the parent directory that contains your repos, open the web UI, and jump into any project to:

- run Codex on a selected repo
- start dev servers and shell commands from the browser
- inspect diffs and commit changes
- create new projects and prototype ideas quickly
- keep working remotely from your phone through Tailscale
- receive Telegram notifications when Codex finishes or needs input

## Install

> [!WARNING]
> You need [Codex CLI](https://github.com/openai/codex) installed and authorized before `fatma-app` can do useful work.

```bash
npx fatma-app
```

To expose it on your network without opening a browser locally:

```bash
npx fatma-app --host 0.0.0.0 --no-browser
```

That works well on a home server or VPS. Publish the port through Tailscale, open the URL on your phone, and keep your projects available from anywhere.

## What It Is For

Most developers do not have one project. They have a directory full of them: work repos, abandoned hobby apps, new experiments, client work, and side projects they want to turn into something bigger.

`fatma-app` turns that projects directory into a single control surface for Codex, so you do not need to bounce between terminals and machines just to keep momentum.

## Repository

- GitHub: https://github.com/dinweldik/fatma
- Monorepo README: https://github.com/dinweldik/fatma/blob/main/README.md
