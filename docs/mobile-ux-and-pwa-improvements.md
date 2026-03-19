# Mobile UX and PWA Improvements

This document breaks the current mobile, PWA, thread, shell, and file-browser issues into separate user-story style tasks so they can be planned and implemented independently.

## Epic 1: Reliable mobile live state and thread responsiveness

### Story 1.1 — Mobile clients should recover from stale WebSocket sessions
**As a** mobile user running fatma as a browser app or installed PWA  
**I want** the UI to reconnect and refresh state automatically when the app resumes, regains focus, or the network changes  
**So that** the UI does not keep showing a thread as "Working" after the agent already finished and Telegram already notified me.

**Problem this solves**
- Mobile clients can resume with stale live state.
- Telegram can show completion before the UI updates.
- Restarting the PWA currently acts as a manual recovery path.

**Implementation tasks**
- Add WebSocket liveness detection in `apps/web/src/wsTransport.ts`.
- Add reconnect triggers on `visibilitychange`, `focus`, and `online`.
- Detect stale connections when no server traffic is received for a defined interval.
- Force an orchestration snapshot refresh immediately after reconnect.
- Surface connection state in the UI when the transport is reconnecting.

**Acceptance criteria**
- After backgrounding and reopening the mobile PWA, stale thread state is refreshed automatically.
- If the agent finishes while the app is backgrounded, reopening the app updates the thread without requiring a full app restart.
- If the socket goes stale but does not hard-close, the client still recovers.

---

### Story 1.2 — Thread status updates should feel immediate on mobile
**As a** user following active agent runs on mobile  
**I want** thread state transitions to feel fast and accurate  
**So that** I can trust the UI without waiting for long snapshot refreshes.

**Problem this solves**
- The app currently leans heavily on full snapshot refreshes after domain events.
- Mobile devices feel much worse than desktop when state changes frequently.

**Implementation tasks**
- Reduce full-read-model replacement for common event paths.
- Apply incremental state updates for common thread events where safe.
- Keep full snapshot sync as a fallback after reconnect or error recovery.
- Audit expensive rerender paths triggered by thread/session changes.

**Acceptance criteria**
- Normal thread status changes feel visibly faster on mobile.
- The UI no longer relies on full snapshot reloads for every common state change.
- Recovery via full snapshot still works when incremental updates are not sufficient.

---

### Story 1.3 — Thread list rendering should stay responsive on mobile
**As a** mobile user with multiple projects and many threads  
**I want** the thread sidebar and project lists to remain responsive  
**So that** browsing and switching threads does not feel sluggish.

**Problem this solves**
- The sidebar currently does significant sorting, filtering, and derived-state work during render.
- This is noticeably worse on mobile.

**Implementation tasks**
- Precompute `threadsByProjectId` and related derived structures outside render-heavy loops.
- Memoize expensive per-project thread calculations.
- Avoid repeated sorting/filtering inside project list rendering.
- Consider lighter mobile rendering for collapsed or offscreen sections.
- Profile rerenders caused by store updates in `Sidebar.tsx`.

**Acceptance criteria**
- Opening and scrolling the mobile project/thread navigator feels smoother.
- Large thread lists no longer cause obvious UI stalls.
- Derived thread metadata does not repeatedly recompute in the hottest render path.

---

## Epic 2: Faster destructive actions and management flows

### Story 2.1 — Deleting a thread should feel instant
**As a** user cleaning up old threads  
**I want** thread deletion to feel immediate  
**So that** I do not experience long delays after confirming a delete action.

**Problem this solves**
- Thread deletion currently chains session stop, terminal close, backend delete, navigation, and snapshot refresh.
- The UI feels latent and unresponsive during the sequence.

**Implementation tasks**
- Add optimistic thread removal in the local UI state.
- Keep backend cleanup and reconciliation after the optimistic UI update.
- Roll back only on failure.
- Ensure fallback navigation happens immediately for the active thread.
- Add clear failure toasts if deletion ultimately fails.

**Acceptance criteria**
- Deleting a thread removes it from the visible UI immediately.
- The app does not feel blocked while backend cleanup finishes.
- Failed deletes can recover gracefully.

---

### Story 2.2 — Deleting a project should feel immediate and predictable
**As a** user cleaning up projects  
**I want** project deletion to respond quickly and clearly  
**So that** I understand whether the action succeeded or is blocked by existing threads.

**Problem this solves**
- Project deletion feels slow and may be blocked by active child data.
- The user experience is especially poor on mobile.

**Implementation tasks**
- Add optimistic project removal where safe.
- Preserve and improve the blocked-by-threads feedback path.
- Ensure shell cleanup and draft cleanup happen without freezing the UI.
- Reconcile with backend state after delete completion.

**Acceptance criteria**
- Successful project deletion feels immediate.
- Blocked project deletion clearly explains why it cannot proceed.
- Mobile UI remains responsive during the operation.

---

## Epic 3: Mobile shell usability and keyboard-safe layout

### Story 3.1 — The mobile shell terminal should always keep the last line visible
**As a** mobile user working in a shell  
**I want** the last visible terminal line to stay above the action bar, bottom nav, and mobile keyboard  
**So that** I can always see the active prompt and shell output while typing.

**Problem this solves**
- The terminal viewport can visually sit under the action bar on mobile.
- The issue gets worse when the mobile keyboard opens.

**Implementation tasks**
- Introduce a keyboard-aware bottom inset using `window.visualViewport` where available.
- Track and expose action bar height as a CSS variable.
- Combine safe-area inset, mobile tab-nav height, action-bar height, and keyboard height into one shell bottom layout contract.
- Ensure the xterm viewport resizes correctly whenever those values change.
- Preserve scroll-to-bottom behavior when the terminal was already pinned to the bottom.

**Acceptance criteria**
- The active terminal prompt is always visible above the action bar.
- The action bar always sits above the mobile tab menu.
- The full shell input area remains above the open keyboard.
- The layout works in both browser and installed PWA modes.

---

### Story 3.2 — The terminal action bar should behave like a first-class mobile input accessory
**As a** mobile shell user  
**I want** the terminal action bar to stay correctly positioned and usable while the keyboard is open  
**So that** arrow keys, Enter, Tab, Escape, and Ctrl+C remain accessible without covering terminal content.

**Problem this solves**
- The action bar exists, but it does not participate in a full mobile keyboard-safe layout model.

**Implementation tasks**
- Define a stable layout contract for the action bar in the mobile shell.
- Ensure the action bar can be measured and incorporated into viewport calculations.
- Verify touch targets, stacking order, and safe-area behavior on mobile browsers.
- Validate interaction behavior when toggling selection mode.

**Acceptance criteria**
- The action bar stays fully visible and tappable while the keyboard is open.
- It no longer overlaps the visible terminal content area.
- Shell interaction remains comfortable on smaller screens.

---

## Epic 4: PWA correctness and update robustness

### Story 4.1 — The PWA should update predictably on mobile without serving stale shells longer than necessary
**As a** user who installs fatma as a PWA  
**I want** app shell updates to be reliable and predictable  
**So that** I do not end up using an outdated cached client longer than necessary.

**Problem this solves**
- The current service worker is a reasonable baseline, but cache invalidation is partly manual.
- Stale shell/assets can worsen perceived mobile bugs.

**Implementation tasks**
- Review and improve service-worker cache versioning so it is tied to build/app version rather than a manually bumped constant.
- Split caches by concern where useful, such as app shell vs runtime assets.
- Keep navigation handling network-first while preserving offline fallback safety.
- Ensure live API routes and similar dynamic endpoints are never accidentally cached.
- Verify update prompts and reload behavior in installed PWA flows.

**Acceptance criteria**
- New builds are detected and applied reliably in the installed PWA.
- Cache invalidation does not depend on easy-to-forget manual steps.
- Service worker caching does not interfere with live app correctness.

---

### Story 4.2 — Mobile resume should refresh both the app shell state and live orchestration state
**As a** mobile PWA user  
**I want** the app to refresh both install/update state and live runtime state when I return to it  
**So that** the client does not recover only the shell version while still showing stale live thread data.

**Problem this solves**
- The PWA provider currently checks for shell updates on focus/visibility changes.
- The live orchestration state recovery path is separate and needs to be coordinated.

**Implementation tasks**
- Align PWA resume/update checks with live-state reconnect checks.
- Ensure mobile resume triggers both service-worker update checks and live orchestration refreshes.
- Test browser and installed-PWA resume behavior on mobile.

**Acceptance criteria**
- Returning to the installed app refreshes both shell update state and live app state.
- Mobile resume no longer leaves the UI stale while only the update system is active.

---

## Epic 5: File browser editing support

### Story 5.1 — The file browser should allow editing, not just reading
**As a** user browsing project files from the web UI  
**I want** to edit and save text files directly from the file browser  
**So that** I can make quick code and config changes without leaving fatma.

**Problem this solves**
- The contracts and native API already expose file writing support.
- The current UI only supports browsing and read-only viewing.

**Implementation tasks**
- Add an edit mode to `ProjectFileExplorer.tsx` for text files.
- Wire save actions to `projects.writeFile`.
- Add dirty state, save, cancel, and error handling.
- Keep binary files read-only.
- Make the first version mobile-friendly even if the editor is simple.

**Acceptance criteria**
- A user can open a text file, edit it, and save it from the UI.
- Save failures are surfaced clearly.
- Binary files are protected from unsupported editing.

---

### Story 5.2 — File editing should feel safe on mobile
**As a** mobile user making quick file edits  
**I want** a simple, reliable editing flow with clear save state  
**So that** I do not lose changes or fight the UI on a small screen.

**Problem this solves**
- Editing support needs to work well in the exact environment where the browser is currently weakest.

**Implementation tasks**
- Design a mobile-friendly edit layout.
- Show clear dirty/saved/error state.
- Protect against accidental navigation away from unsaved edits.
- Ensure virtual keyboard interactions do not hide critical controls.

**Acceptance criteria**
- File editing is comfortable enough on mobile for quick changes.
- Unsaved changes are not easy to lose accidentally.
- Keyboard interactions do not break the editing workflow.

---

## Cross-cutting validation tasks

### Story 6.1 — Mobile browser and installed-PWA flows should be tested explicitly
**As a** maintainer  
**I want** the mobile browser and installed-PWA experiences to be validated directly  
**So that** regressions are caught in the environment where these issues are most visible.

**Implementation tasks**
- Add a focused manual QA checklist for Android Chrome, iOS Safari, and installed-PWA flows where possible.
- Add automated coverage for layout/state logic that can be tested without a real mobile device.
- Validate resume behavior, delete flows, shell keyboard layout, and file editing.

**Acceptance criteria**
- The team has a repeatable way to validate mobile regressions.
- The highest-risk mobile flows are explicitly covered.

---

## Suggested implementation order

1. Story 1.1 — stale WebSocket recovery on mobile  
2. Story 3.1 — mobile shell keyboard-safe terminal layout  
3. Story 2.1 and 2.2 — optimistic delete flows  
4. Story 1.3 — sidebar/thread-list performance improvements  
5. Story 4.1 and 4.2 — PWA/service-worker hardening  
6. Story 5.1 and 5.2 — file browser editing support  
7. Story 6.1 — dedicated validation coverage
