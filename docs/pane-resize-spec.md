# Feature spec: pane resizing + layout presets

Current geometry: `.workspace` is a CSS grid — `240px minmax(480px, 1fr) 384px`
(sidebar | timeline | inspector); the inspector column is collapsible; compact
screens use drawer modes.

## Presets (buttons in the top header)
- Two buttons in `.app-header .header-actions`: **Default** (exact current
  geometry) and **Equal** (all visible panes share the width equally — 3 panes
  when the inspector is open, 2 when closed).
- The active preset is visually indicated (aria-pressed). Any manual drag
  switches to a "custom" layout and deselects both buttons.
- Lucide icons consistent with existing header buttons; i18n labels/tooltips in
  `en` + `zh-CN`.

## Dragging
- Thin divider handles between adjacent visible panes (sidebar|timeline,
  timeline|inspector). ~6px hit area, `col-resize` cursor, subtle visible
  affordance on hover.
- Pointer Events with `setPointerCapture` (mouse + touch + pen), live grid
  update while dragging (inline `grid-template-columns` on `.workspace` or
  CSS custom properties).
- Minimum widths: sidebar ≥ 180px, inspector ≥ 280px, timeline ≥ 480px (the
  existing minmax minimum). Timeline absorbs the remainder.
- Double-click a divider → reset that boundary to the Default preset value.
- Accessibility: `role="separator"` + `aria-orientation="vertical"`, arrow keys
  resize by 16px steps when focused.
- Compact screens / drawer modes: handles not rendered, presets no-op — the
  existing responsive behavior must be unchanged.

## Persistence
- Persist to `localStorage` (e.g. `sv.paneLayout`): `{ mode: 'default'|'equal'|'custom', sidebarW?, inspectorW? }`.
  Restore on mount; corrupt/invalid values ignored (fall back to Default).
- Switching to Default recomputes 240/384 defaults; Equal recomputes from the
  container width at apply time (or via `1fr` in CSS — preferred if clean).

## Constraints

> Reviewer-accepted deviation: at the 1025–1180px medium breakpoint the CSS
> timeline minimum is 424px (not 480px) so sidebar + divider tracks + timeline
> + inspector still fit a 1025px container without horizontal overflow. The
> 480px minimum applies to presets, dragging, and the base (>1180px) grid.

- No new npm dependencies.
- Do not break `react-virtuoso` behavior: the timeline keeps its 480px minimum
  and must not scroll-jump while dragging (recalculation during drag is fine if
  smooth; a light debounce/rAF is acceptable).
- Put pure geometry in a small testable module (e.g.
  `src/web/pane-layout.ts`: clamp, equal split, grid-template-columns builder,
  preset definitions) with unit tests; wire it up in `App.tsx`; divider +
  handle styles in `styles.css`. Preset/layout state is local UI state in App
  (no controller changes needed unless the existing architecture demands it).
- Do NOT touch `src/server/`, `src/extension/`, or the search feature code.
- Conventional commits (`feat(web): pane resize presets and draggable dividers`).
  Finish with `npm ci` (if needed), `npm test`, `npm run build`
  (tsc must pass), then `git add -f dist` and commit.
- Report with `hc send t2`: files changed, `git diff --stat`, test results,
  anything skipped.
