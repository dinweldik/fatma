# Mobile QA Checklist

## Target Environments

- Android Chrome in browser tab
- Android installed PWA
- iOS Safari in browser tab
- iOS installed web app where available

## Resume And Live State

- Start a thread and leave it running.
- Background the app.
- Let the run finish while the app is backgrounded.
- Reopen the app.
- Confirm the thread no longer shows `Working`.
- Confirm the thread timeline and status update without a full app restart.
- Toggle airplane mode or otherwise interrupt connectivity, then restore it.
- Confirm the app shows a reconnecting state and recovers live status afterward.

## PWA Updates

- Install the PWA from a stable HTTPS origin.
- Load an older build, then deploy a newer build.
- Resume/focus the installed app.
- Confirm the update check runs and the app reports an available update.
- Reload/apply the update.
- Confirm the new build is active and stale shell assets are gone.
- Confirm live orchestration state still refreshes after resume.

## Thread And Project Deletes

- Delete an inactive thread.
- Confirm it disappears from the sidebar immediately.
- Delete the currently active thread.
- Confirm navigation falls back immediately to another thread or the root view.
- Force a delete failure if possible.
- Confirm the optimistic removal rolls back and an error toast is shown.
- Try deleting a project that still has threads.
- Confirm the blocked state is explained clearly.
- Delete an empty project.
- Confirm it disappears immediately and the UI stays responsive.

## Mobile Shell

- Open a project shell on mobile.
- Focus the shell so the keyboard opens.
- Confirm the action bar stays visible and tappable above the bottom nav and keyboard.
- Confirm the last prompt/output line remains visible above the action bar.
- Type using the action bar controls: arrows, `Tab`, `Esc`, `Enter`, `Ctrl+C`.
- Toggle selection mode on and off.
- Confirm the terminal viewport resizes cleanly and remains scrollable.
- Scroll away from the bottom, then resize/open the keyboard.
- Confirm the terminal does not forcibly jump unless it was already pinned to the bottom.

## File Editing

- Open a text file from the file browser.
- Enter edit mode and make a change.
- Confirm dirty state is obvious.
- Use `Save` and confirm the saved state updates cleanly.
- Make another change and use `Cancel`.
- Confirm discard confirmation appears when needed.
- Attempt to navigate back or switch files with unsaved changes.
- Confirm the app warns before discarding edits.
- Open a binary file.
- Confirm it stays read-only.

## Sidebar Performance

- Use a project with many threads.
- Open and close multiple project sections.
- Scroll through the mobile sidebar.
- Confirm there are no obvious stalls when expanding, collapsing, or switching threads.
