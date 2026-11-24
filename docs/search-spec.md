# Feature spec: message search in the session viewer

Goal: filter the timeline to events whose content matches a query, live as the
user types, and highlight matches in the Details pane.

## UI
- One text input in the timeline toolbar area (above the event list). No button.
- Filters as-you-type. Queries shorter than 3 characters (after trim)
  deactivate filtering and highlighting entirely.
- Show a match count next to the input ("N matches"); a 0-match state should
  be visually distinct but not look broken.
- Esc in the input clears it. A small clear (✕) button is optional.

## Matching
- Case-insensitive substring match against each entry's searchable text.
- Searchable text per entry: user message text, assistant message text, tool
  call name + serialized input, tool output text, system/error text — i.e.
  the text the entry's content view actually renders.
- Only entries with at least one match are shown in the timeline; others are
  filtered out. Original order preserved.
- Optional (nice to have): per-entry match-count badge in the list row.

## Highlighting
- In the Inspector Details pane (EventContentView; EventRawView too if
  trivial), wrap every case-insensitive match occurrence in
  `<mark class="sv-search-hit">…</mark>`.
- Only active when the query is ≥ 3 chars.
- Plain-text content only: split strings and wrap text nodes — never inject
  HTML into markdown / tool-code rendering paths.
- `styles.css`: highlight style consistent with the existing dark theme.

## Implementation constraints
- State lives in `src/web/session-view-controller.ts` (`searchQuery` +
  derived filtered entries); `App.tsx` consumes it. Memoize per-entry text
  blobs so typing stays fast on large sessions (the timeline is virtualized —
  do not break `react-virtuoso` behavior).
- No new npm dependencies. `tsc --noEmit` must pass.
- i18n: add labels/placeholders to `src/web/locales/en.ts` and `zh-CN.ts`.
- Tests: controller tests for the filter (activates at exactly 3 chars,
  case-insensitivity, matches across user/assistant/tool text, restores full
  list when cleared) in `session-view-controller.test.ts`. `npm test` green.
- Branch: `search` (already created). Conventional commits matching repo
  history (`feat(web): ...`). Final step: `npm ci && npm test && npm run build`,
  then `git add -f dist` and commit, so the branch is installable by pi from
  the git ref.
- Do NOT touch `src/server/`, `src/extension/`, dependencies, or anything
  unrelated. Scope: search only. No upstream PR.
