# PWA Usage

6d can be installed as a standalone web app, but it works best when the browser, service worker, and WebSocket server all live on one stable HTTPS origin.

## Recommended setup

Use one of these local server modes:

```bash
npx @dinweldik/6d --host 0.0.0.0 --no-browser
```

```bash
bun run dev:single
```

Then expose that single port through Tailscale Serve:

```bash
tailscale serve https://sixd.example 3773
```

Open `https://sixd.example` from the phone, tablet, or desktop browser you want to install from.

Why this setup is best:

- The installed app is origin-bound. Keep using the same HTTPS URL after install.
- The service worker update flow is much more reliable when the app shell and API share one origin.
- Raw LAN HTTP addresses are not a good install target. Use HTTPS or `localhost`.

## Installing

On Android Chrome or desktop Chrome/Edge:

- Open the Tailscale HTTPS URL.
- Use the browser menu and choose `Install app` or `Add to Home screen`.
- If the browser surfaces an install chip or prompt, you can use that instead.

On iPhone or iPad Safari:

- Open the Tailscale HTTPS URL in Safari.
- Tap `Share`.
- Choose `Add to Home Screen`.

You can also open `Settings -> Web App` inside 6d to see install guidance for the current device.

## Updating the installed app

6d checks for app-shell updates automatically while it is open. When a newer installed shell is ready:

- a toast appears with `Reload`
- `Settings -> Web App` shows `Reload to update`

Use one of those actions to switch the installed app to the latest version.

Notes:

- Built assets are cached aggressively, but `index.html`, `manifest.webmanifest`, `sw.js`, and the version metadata are revalidated so installs can pick up new releases.
- The app is installable, but it is not intended to be an offline-first product. A live server connection is still required for normal use.
- `bun run dev` is useful for frontend iteration, but not the recommended install/update path. Use `bun run dev:single` when you want to test the real PWA flow locally.
