# AGENTS.md

## Project

Redmine QOL Lite is a small Manifest V3 extension for Brave, Chrome, Yandex Browser, and other Chromium-based browsers. It enhances an existing Redmine interface and talks directly to the Redmine REST API. There is no build step, package manager, backend, analytics, or telemetry.

Keep the extension lightweight and make narrowly scoped changes. Preserve compatibility with the older Redmine markup used by the target installation.

## Repository layout

- `manifest.json` — extension manifest and version.
- `background.js` — permissions, dynamic content-script registration, polling, API requests, event cache, and badge state.
- `content-common.js` — shared helpers exposed through `globalThis.RedmineSmallQol`.
- `content-watchers.js` — watcher groups and watcher dialog enhancements.
- `content-preview.js` — issue and journal-note hover previews.
- `content-events.js` — compact events window inside Redmine.
- `content-history.js` — all-history/comments-only toggle.
- `content-favorites.js` — favorite issue stars and compact sidebar list.
- `popup.html`, `popup.css`, `popup.js` — settings UI.

Content scripts are registered dynamically in `background.js`. When adding a new content script, also add it to `SCRIPT_FILES`; putting a file in the repository is not enough.

## Development rules

- Use plain JavaScript, HTML, and CSS. Do not add dependencies or a build pipeline unless explicitly requested.
- Do not hardcode a Redmine host, API key, usernames, project names, or other installation-specific data.
- Store settings and user state in `chrome.storage.local`. Keep existing storage keys and stored data backward-compatible whenever possible.
- Scope injected CSS with the `rsq-` prefix so Redmine styles are not unintentionally changed.
- Treat Redmine DOM markup as unstable. Prefer tolerant selectors and fail quietly when an expected element is absent.
- Content scripts may be re-run after an extension reload. DOM enhancements must be idempotent and must not create duplicate controls.
- Be careful with `MutationObserver`: mutations made by the extension must not cause an endless render loop.
- Do not introduce a permanent standalone sidebar. Small controls, bounded lists, and popovers inside the existing Redmine layout are acceptable.
- Keep long lists height-limited and scrollable so they do not stretch the page layout.
- Avoid broad or aggressive API fetching. Event polling should remain incremental and should not import old history on first run.
- Never log or commit API keys, issue contents, personal names, internal URLs, screenshots, or other private Redmine data.
- Bump the patch version in `manifest.json` for a user-visible change.
- Do not commit or push unless the user explicitly asks for it.

## Validation

There is no automated test suite. Before handing off a change:

1. Run `node --check` for every `*.js` file.
2. Parse `manifest.json` to confirm it is valid JSON.
3. Run `git diff --check` and inspect `git status --short`.
4. Confirm every file listed in `SCRIPT_FILES` exists.
5. For UI changes, reload the unpacked extension and refresh the Redmine tab. Check both an issue page and an issue list when relevant.

The unpacked extension must be loaded from the repository root containing `manifest.json`, not from the `.git` directory.
