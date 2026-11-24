import { describe, expect, it } from 'vitest'
import {
  PANE_DEFAULT_WIDTHS,
  PANE_DIVIDER_WIDTH,
  PANE_KEYBOARD_STEP,
  PANE_MAX_WIDTH,
  PANE_MIN_WIDTHS,
  buildGridTemplateColumns,
  computeEqualWidths,
  dividerTrackCount,
  inspectorWidthRange,
  normalizePaneLayout,
  paneBudget,
  parsePaneLayout,
  paneDefaultWidth,
  paneMinWidth,
  resizePaneWidth,
  serializePaneLayout,
  sidebarWidthRange,
  stepPaneWidth,
  visiblePaneCount,
} from './pane-layout'

const MIN_SUM_3 = PANE_MIN_WIDTHS.sidebar + PANE_MIN_WIDTHS.timeline + PANE_MIN_WIDTHS.inspector

describe('grid track helpers', () => {
  it('counts visible panes and divider tracks', () => {
    expect(visiblePaneCount(true)).toBe(3)
    expect(visiblePaneCount(false)).toBe(2)
    expect(dividerTrackCount(true)).toBe(2)
    expect(dividerTrackCount(false)).toBe(1)
  })

  it('derives the pane budget by subtracting divider tracks', () => {
    expect(paneBudget(1206, true)).toBe(1206 - 2 * PANE_DIVIDER_WIDTH)
    expect(paneBudget(800, false)).toBe(800 - PANE_DIVIDER_WIDTH)
    expect(paneBudget(0, true)).toBe(0)
    expect(paneBudget(4, true)).toBe(0)
  })

  it('clamps sidebar and inspector ranges to leave minimums for other panes', () => {
    const budget = 1200 - 2 * PANE_DIVIDER_WIDTH
    const sidebar = sidebarWidthRange(budget, true)
    expect(sidebar.min).toBe(PANE_MIN_WIDTHS.sidebar)
    expect(sidebar.max).toBe(budget - PANE_MIN_WIDTHS.timeline - PANE_MIN_WIDTHS.inspector)

    const inspector = inspectorWidthRange(budget)
    expect(inspector.min).toBe(PANE_MIN_WIDTHS.inspector)
    expect(inspector.max).toBe(budget - PANE_MIN_WIDTHS.sidebar - PANE_MIN_WIDTHS.timeline)
  })

  it('keeps ranges non-degenerate on tiny budgets', () => {
    const sidebar = sidebarWidthRange(200, true)
    expect(sidebar.max).toBe(PANE_MIN_WIDTHS.sidebar)
    const inspector = inspectorWidthRange(300)
    expect(inspector.max).toBe(PANE_MIN_WIDTHS.inspector)
  })
})

describe('resizePaneWidth', () => {
  const container = 1200
  const budget = container - 2 * PANE_DIVIDER_WIDTH

  it('moves the sidebar boundary with the pointer delta', () => {
    expect(resizePaneWidth('sidebar', 240, 40, container, true)).toBe(280)
    expect(resizePaneWidth('sidebar', 240, -40, container, true)).toBe(200)
  })

  it('moves the inspector boundary inversely (left drag widens it)', () => {
    expect(resizePaneWidth('inspector', 384, -84, container, true)).toBe(468)
    expect(resizePaneWidth('inspector', 384, 84, container, true)).toBe(300)
  })

  it('clamps the sidebar while the timeline and inspector keep their minimums', () => {
    const maxSidebar = budget - PANE_MIN_WIDTHS.timeline - PANE_MIN_WIDTHS.inspector
    expect(resizePaneWidth('sidebar', 240, 10_000, container, true)).toBe(maxSidebar)
    expect(resizePaneWidth('sidebar', 240, -10_000, container, true)).toBe(PANE_MIN_WIDTHS.sidebar)
  })

  it('clamps the inspector while the sidebar and timeline keep their minimums', () => {
    const maxInspector = budget - PANE_MIN_WIDTHS.sidebar - PANE_MIN_WIDTHS.timeline
    expect(resizePaneWidth('inspector', 384, -10_000, container, true)).toBe(maxInspector)
    expect(resizePaneWidth('inspector', 384, 10_000, container, true)).toBe(PANE_MIN_WIDTHS.inspector)
  })

  it('honours the two-pane layout when the inspector is hidden', () => {
    const maxSidebar = (container - PANE_DIVIDER_WIDTH) - PANE_MIN_WIDTHS.timeline
    expect(resizePaneWidth('sidebar', 240, 10_000, container, false)).toBe(maxSidebar)
  })

  it('rounds fractional deltas', () => {
    expect(resizePaneWidth('sidebar', 240, 10.6, container, true)).toBe(251)
    expect(resizePaneWidth('sidebar', 240, -10.4, container, true)).toBe(230)
  })
})

describe('stepPaneWidth', () => {
  const container = 1200

  it('steps by 16px in both directions', () => {
    expect(stepPaneWidth('sidebar', 240, 1, container, true)).toBe(240 + PANE_KEYBOARD_STEP)
    expect(stepPaneWidth('sidebar', 240, -1, container, true)).toBe(240 - PANE_KEYBOARD_STEP)
    expect(stepPaneWidth('inspector', 384, 1, container, true)).toBe(384 - PANE_KEYBOARD_STEP)
    expect(stepPaneWidth('inspector', 384, -1, container, true)).toBe(384 + PANE_KEYBOARD_STEP)
  })

  it('never crosses the minimums', () => {
    expect(stepPaneWidth('sidebar', PANE_MIN_WIDTHS.sidebar, -1, container, true)).toBe(PANE_MIN_WIDTHS.sidebar)
    expect(stepPaneWidth('inspector', PANE_MIN_WIDTHS.inspector, 1, container, true)).toBe(PANE_MIN_WIDTHS.inspector)
  })
})

describe('preset definitions', () => {
  it('exposes Default preset widths and per-boundary values', () => {
    expect(PANE_DEFAULT_WIDTHS).toEqual({ sidebar: 240, inspector: 384 })
    expect(paneDefaultWidth('sidebar')).toBe(240)
    expect(paneDefaultWidth('inspector')).toBe(384)
    expect(paneMinWidth('sidebar')).toBe(PANE_MIN_WIDTHS.sidebar)
    expect(paneMinWidth('inspector')).toBe(PANE_MIN_WIDTHS.inspector)
  })
})

describe('computeEqualWidths', () => {
  it('splits three visible panes equally and lets the timeline absorb the rounding remainder', () => {
    const container = 1500
    const { sidebarW, inspectorW } = computeEqualWidths(container, true)
    const budget = container - 2 * PANE_DIVIDER_WIDTH
    expect(sidebarW).toBe(Math.floor(budget / 3))
    expect(inspectorW).toBe(sidebarW)
    expect(budget - sidebarW - (inspectorW ?? 0)).toBeGreaterThanOrEqual(PANE_MIN_WIDTHS.timeline)
  })

  it('shrinks both side panes evenly when the timeline minimum bites', () => {
    // 预算 1188：均分 396 会压扁时间轴（480 下限），两侧各收缩到 354。
    const { sidebarW, inspectorW } = computeEqualWidths(1200, true)
    expect(sidebarW).toBe(354)
    expect(inspectorW).toBe(354)
    expect(paneBudget(1200, true) - sidebarW - (inspectorW ?? 0)).toBe(PANE_MIN_WIDTHS.timeline)
  })

  it('returns a null inspector width when the inspector is hidden', () => {
    const { sidebarW, inspectorW } = computeEqualWidths(1000, false)
    expect(inspectorW).toBeNull()
    expect(sidebarW).toBe(Math.floor((1000 - PANE_DIVIDER_WIDTH) / 2))
  })

  it('compresses the equal split toward the minimums when the timeline minimum wins', () => {
    // 预算 940 = 最小值之和：均分不可行，全部退到最小值。
    const container = 940 + 2 * PANE_DIVIDER_WIDTH
    const { sidebarW, inspectorW } = computeEqualWidths(container, true)
    expect(sidebarW).toBe(PANE_MIN_WIDTHS.sidebar)
    expect(inspectorW).toBe(PANE_MIN_WIDTHS.inspector)
  })

  it('keeps every pane at or above its minimum on narrow desktop containers', () => {
    for (let container = 1025; container <= 1180; container += 5) {
      const { sidebarW, inspectorW } = computeEqualWidths(container, true)
      const timelineW = paneBudget(container, true) - sidebarW - (inspectorW ?? 0)
      expect(sidebarW).toBeGreaterThanOrEqual(PANE_MIN_WIDTHS.sidebar)
      expect(inspectorW).toBeGreaterThanOrEqual(PANE_MIN_WIDTHS.inspector)
      expect(timelineW).toBeGreaterThanOrEqual(PANE_MIN_WIDTHS.timeline)
    }
  })
})

describe('buildGridTemplateColumns', () => {
  it('returns null for the Default preset so the stylesheet stays in control', () => {
    expect(buildGridTemplateColumns({ mode: 'default' }, true)).toBeNull()
  })

  it('builds five tracks with the timeline as the flexible minmax track', () => {
    const columns = buildGridTemplateColumns({ mode: 'custom', sidebarW: 300, inspectorW: 420 }, true)
    expect(columns).toBe(`300px ${PANE_DIVIDER_WIDTH}px minmax(${PANE_MIN_WIDTHS.timeline}px, 1fr) ${PANE_DIVIDER_WIDTH}px 420px`)
  })

  it('omits the inspector tracks when it is not visible', () => {
    const columns = buildGridTemplateColumns({ mode: 'custom', sidebarW: 300 }, false)
    expect(columns).toBe(`300px ${PANE_DIVIDER_WIDTH}px minmax(${PANE_MIN_WIDTHS.timeline}px, 1fr)`)
  })

  it('falls back to default widths for missing values', () => {
    const columns = buildGridTemplateColumns({ mode: 'equal', sidebarW: 400 }, true)
    expect(columns).toBe(`400px ${PANE_DIVIDER_WIDTH}px minmax(${PANE_MIN_WIDTHS.timeline}px, 1fr) ${PANE_DIVIDER_WIDTH}px ${PANE_DEFAULT_WIDTHS.inspector}px`)
  })
})

describe('normalizePaneLayout', () => {
  it('keeps genuine custom layouts', () => {
    expect(normalizePaneLayout({ mode: 'custom', sidebarW: 300, inspectorW: 420 })).toEqual({ mode: 'custom', sidebarW: 300, inspectorW: 420 })
  })

  it('collapses a state equal to the Default preset back to default', () => {
    expect(normalizePaneLayout({ mode: 'custom', sidebarW: 240, inspectorW: 384 })).toEqual({ mode: 'default' })
    expect(normalizePaneLayout({ mode: 'equal', sidebarW: 240 })).toEqual({ mode: 'default' })
    expect(normalizePaneLayout({ mode: 'equal', inspectorW: 384 })).toEqual({ mode: 'default' })
    expect(normalizePaneLayout({ mode: 'equal', sidebarW: 240, inspectorW: 420 })).toEqual({ mode: 'equal', sidebarW: 240, inspectorW: 420 })
  })
})

describe('parsePaneLayout', () => {
  it('parses valid persisted layouts', () => {
    expect(parsePaneLayout({ mode: 'default' })).toEqual({ mode: 'default' })
    expect(parsePaneLayout({ mode: 'custom', sidebarW: 300, inspectorW: 420.4 })).toEqual({ mode: 'custom', sidebarW: 300, inspectorW: 420 })
    expect(parsePaneLayout({ mode: 'equal', inspectorW: 280 })).toEqual({ mode: 'equal', inspectorW: 280 })
    expect(parsePaneLayout(JSON.stringify({ mode: 'custom', sidebarW: 260, inspectorW: 390 }))).toEqual({ mode: 'custom', sidebarW: 260, inspectorW: 390 })
  })

  it('rejects corrupt or invalid payloads', () => {
    expect(parsePaneLayout(null)).toBeNull()
    expect(parsePaneLayout(undefined)).toBeNull()
    expect(parsePaneLayout(42)).toBeNull()
    expect(parsePaneLayout('not json')).toBeNull()
    expect(parsePaneLayout([])).toBeNull()
    expect(parsePaneLayout({})).toBeNull()
    expect(parsePaneLayout({ mode: 'bogus' })).toBeNull()
    expect(parsePaneLayout({ mode: 'custom' })).toBeNull()
    expect(parsePaneLayout({ mode: 'custom', sidebarW: '300' })).toBeNull()
    expect(parsePaneLayout({ mode: 'custom', sidebarW: -20 })).toBeNull()
    expect(parsePaneLayout({ mode: 'custom', sidebarW: Number.NaN })).toBeNull()
    expect(parsePaneLayout({ mode: 'custom', inspectorW: Number.POSITIVE_INFINITY })).toBeNull()
    expect(parsePaneLayout({ mode: 'custom', sidebarW: PANE_MAX_WIDTH + 1 })).toBeNull()
    expect(parsePaneLayout({ mode: 'equal', sidebarW: PANE_MIN_WIDTHS.sidebar - 1 })).toBeNull()
    expect(parsePaneLayout({ mode: 'default', sidebarW: 'bogus' })).toEqual({ mode: 'default' })
  })

  it('accepts widths at the exact minimums', () => {
    expect(parsePaneLayout({ mode: 'custom', sidebarW: PANE_MIN_WIDTHS.sidebar, inspectorW: PANE_MIN_WIDTHS.inspector })).toEqual({
      mode: 'custom',
      sidebarW: PANE_MIN_WIDTHS.sidebar,
      inspectorW: PANE_MIN_WIDTHS.inspector,
    })
  })
})

describe('serializePaneLayout', () => {
  it('round-trips through parse', () => {
    const states = [
      { mode: 'default' } as const,
      { mode: 'custom', sidebarW: 300 } as const,
      { mode: 'equal', sidebarW: 320, inspectorW: 320 } as const,
    ]
    for (const state of states) {
      expect(parsePaneLayout(serializePaneLayout(state))).toEqual(state)
    }
  })

  it('omits missing widths', () => {
    expect(serializePaneLayout({ mode: 'equal', sidebarW: 320 })).toBe('{"mode":"equal","sidebarW":320}')
  })
})
