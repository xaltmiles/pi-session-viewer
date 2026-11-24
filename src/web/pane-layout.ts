/**
 * 窗格布局几何（Pane layout geometry）。
 *
 * 纯函数模块：不接触 DOM / localStorage，全部输入输出都是数字与字符串，
 * 便于单元测试。DOM 测量与持久化 IO 在 App.tsx 中完成，再把数值交给这里。
 *
 * 网格轨道模型：`.workspace` 在桌面端使用
 * `sidebar | divider | timeline | divider | inspector` 五列轨道；
 * 分隔条轨道宽度恒为 `PANE_DIVIDER_WIDTH`，时间轴通过
 * `minmax(PANE_MIN_WIDTHS.timeline, 1fr)` 吸收剩余宽度。
 */

export type PaneLayoutMode = 'default' | 'equal' | 'custom'

export interface PaneLayoutState {
  mode: PaneLayoutMode
  /** 侧栏宽度（px）；缺省时使用 PANE_DEFAULT_WIDTHS.sidebar。 */
  sidebarW?: number
  /** 详情面板宽度（px）；缺省时使用 PANE_DEFAULT_WIDTHS.inspector。 */
  inspectorW?: number
}

/** localStorage 键：持久化 { mode, sidebarW?, inspectorW? }。 */
export const PANE_STORAGE_KEY = 'sv.paneLayout'

/** Default 预设（与现有 CSS 几何一致）。 */
export const PANE_DEFAULT_WIDTHS = { sidebar: 240, inspector: 384 } as const

/** 拖拽与预设都必须满足的最小宽度。 */
export const PANE_MIN_WIDTHS = { sidebar: 180, timeline: 480, inspector: 280 } as const

/** 防御异常大值的上限（localStorage 校验与 aria-valuemax 用）。 */
export const PANE_MAX_WIDTH = 4000

/** 分隔条命中区（即网格分隔轨道）宽度。 */
export const PANE_DIVIDER_WIDTH = 6

/** 分隔条聚焦时方向键的步进（px）。 */
export const PANE_KEYBOARD_STEP = 16

/** 受分隔条控制的窗格。 */
export type ResizablePane = 'sidebar' | 'inspector'

function clampWidth(width: number, min: number, max: number): number {
  if (!Number.isFinite(width)) return min
  return Math.min(Math.max(Math.round(width), min), Math.max(min, max))
}

/** 可见窗格数量（桌面端：详情面板始终渲染）。 */
export function visiblePaneCount(inspectorVisible: boolean): number {
  return inspectorVisible ? 3 : 2
}

/** 网格中分隔条轨道数量。 */
export function dividerTrackCount(inspectorVisible: boolean): number {
  return inspectorVisible ? 2 : 1
}

/**
 * 窗格可用的总宽度：容器宽度减去分隔条轨道。
 * 拖拽/预设的钳制范围都基于这个预算。
 */
export function paneBudget(containerWidth: number, inspectorVisible: boolean): number {
  const budget = containerWidth - dividerTrackCount(inspectorVisible) * PANE_DIVIDER_WIDTH
  return Math.max(budget, 0)
}

/** 侧栏宽度合法区间 [min, max]；时间轴与（可见的）详情面板保留各自最小值。 */
export function sidebarWidthRange(budget: number, inspectorVisible: boolean): { min: number; max: number } {
  const reserved = PANE_MIN_WIDTHS.timeline + (inspectorVisible ? PANE_MIN_WIDTHS.inspector : 0)
  return { min: PANE_MIN_WIDTHS.sidebar, max: Math.max(PANE_MIN_WIDTHS.sidebar, budget - reserved) }
}

/** 详情面板宽度合法区间 [min, max]；侧栏与时间轴保留各自最小值。 */
export function inspectorWidthRange(budget: number): { min: number; max: number } {
  const reserved = PANE_MIN_WIDTHS.sidebar + PANE_MIN_WIDTHS.timeline
  return { min: PANE_MIN_WIDTHS.inspector, max: Math.max(PANE_MIN_WIDTHS.inspector, budget - reserved) }
}

/**
 * 计算拖动某个边界后的窗格宽度。
 * `delta` 为指针水平位移：sidebar 边界随 delta 增减；inspector 边界相反
 * （向左拖动让详情面板变宽）。时间轴吸收剩余空间，因此这里只钳制本窗格。
 */
export function resizePaneWidth(
  pane: ResizablePane,
  currentWidth: number,
  delta: number,
  containerWidth: number,
  inspectorVisible: boolean,
): number {
  const budget = paneBudget(containerWidth, inspectorVisible)
  if (pane === 'sidebar') {
    const range = sidebarWidthRange(budget, inspectorVisible)
    return clampWidth(currentWidth + delta, range.min, range.max)
  }
  const range = inspectorWidthRange(budget)
  return clampWidth(currentWidth - delta, range.min, range.max)
}

/** 分隔条方向键调整：delta 为 +PANE_KEYBOARD_STEP / -PANE_KEYBOARD_STEP。 */
export function stepPaneWidth(
  pane: ResizablePane,
  currentWidth: number,
  direction: 1 | -1,
  containerWidth: number,
  inspectorVisible: boolean,
): number {
  return resizePaneWidth(pane, currentWidth, direction * PANE_KEYBOARD_STEP, containerWidth, inspectorVisible)
}

/** 某个边界的 Default 预设宽度（双击复位目标值）。 */
export function paneDefaultWidth(pane: ResizablePane): number {
  return pane === 'sidebar' ? PANE_DEFAULT_WIDTHS.sidebar : PANE_DEFAULT_WIDTHS.inspector
}

/** 某个边界的最小宽度。 */
export function paneMinWidth(pane: ResizablePane): number {
  return pane === 'sidebar' ? PANE_MIN_WIDTHS.sidebar : PANE_MIN_WIDTHS.inspector
}

/**
 * 把已应用/持久化的布局宽度钳制到当前容器内（窗口缩放、恢复持久值后调用）。
 * 先把低于最小值的宽度抬到最小值；若 sidebar + timeline + inspector 超出预算，
 * 则按各窗格超出自身最小值的比例收缩，收缩后恰好回到预算。
 * 已经合法的布局保持原样（例如 Equal 均分结果不会被扭曲）。
 */
export function fitLayoutToContainer(
  sidebarW: number,
  inspectorW: number,
  containerWidth: number,
  inspectorVisible: boolean,
): { sidebarW: number; inspectorW: number | null } {
  const budget = paneBudget(containerWidth, inspectorVisible)
  if (!inspectorVisible) {
    let sidebar = Math.max(PANE_MIN_WIDTHS.sidebar, Math.round(sidebarW))
    const overflow = sidebar + PANE_MIN_WIDTHS.timeline - budget
    if (overflow > 0) sidebar = Math.max(PANE_MIN_WIDTHS.sidebar, sidebar - overflow)
    return { sidebarW: sidebar, inspectorW: null }
  }
  let sidebar = Math.max(PANE_MIN_WIDTHS.sidebar, Math.round(sidebarW))
  let inspector = Math.max(PANE_MIN_WIDTHS.inspector, Math.round(inspectorW))
  const overflow = sidebar + inspector + PANE_MIN_WIDTHS.timeline - budget
  if (overflow > 0) {
    const sidebarExcess = sidebar - PANE_MIN_WIDTHS.sidebar
    const inspectorExcess = inspector - PANE_MIN_WIDTHS.inspector
    const totalExcess = sidebarExcess + inspectorExcess
    if (totalExcess >= overflow) {
      // 按超出比例分摊：ceil 落在侧栏，余量记在详情面板；两侧都不会跌破最小值。
      const sidebarShrink = Math.min(Math.ceil((overflow * sidebarExcess) / totalExcess), overflow)
      sidebar -= sidebarShrink
      inspector -= overflow - sidebarShrink
    } else {
      // 预算连最小值之和都放不下（仅出现在极窄视口）：全部退到最小值。
      sidebar = PANE_MIN_WIDTHS.sidebar
      inspector = PANE_MIN_WIDTHS.inspector
    }
  }
  return { sidebarW: sidebar, inspectorW: inspector }
}

/**
 * Equal 预设：所有可见窗格均分预算宽度，时间轴吸收取整余量；
 * 均分结果低于时间轴最小值时，向最小值方向压缩其余窗格。
 * 返回侧栏与详情面板的宽度（详情面板不可见时为 null）。
 */
export function computeEqualWidths(
  containerWidth: number,
  inspectorVisible: boolean,
): { sidebarW: number; inspectorW: number | null } {
  const budget = paneBudget(containerWidth, inspectorVisible)
  const target = clampWidth(Math.floor(budget / visiblePaneCount(inspectorVisible)), 0, PANE_MAX_WIDTH)
  const sideMin = PANE_MIN_WIDTHS.sidebar
  const inspectorMin = PANE_MIN_WIDTHS.inspector
  let sidebarW = Math.max(target, sideMin)
  let inspectorW = inspectorVisible ? Math.max(target, inspectorMin) : null
  // 均分结果给不齐时间轴最小值时：两侧窗格对半收缩，顶到最小值为止。
  let remaining = PANE_MIN_WIDTHS.timeline - (budget - sidebarW - (inspectorW ?? 0))
  if (remaining > 0) {
    const shrink = (width: number, min: number, amount: number) =>
      width - Math.min(width - min, Math.max(amount, 0))
    const sidebarBefore = sidebarW
    sidebarW = shrink(sidebarW, sideMin, Math.ceil(remaining / (inspectorW != null ? 2 : 1)))
    remaining -= sidebarBefore - sidebarW
    if (inspectorW != null && remaining > 0) {
      const inspectorBefore = inspectorW
      inspectorW = shrink(inspectorW, inspectorMin, remaining)
      remaining -= inspectorBefore - inspectorW
    }
    if (remaining > 0) sidebarW = shrink(sidebarW, sideMin, remaining)
  }
  return { sidebarW, inspectorW }
}

/**
 * 把布局状态编译为 `.workspace` 的内联 `grid-template-columns`。
 * Default 模式返回 null：不写内联样式，让样式表（含响应式断点）接管。
 * 轨道顺序：sidebar | divider | timeline | divider? | inspector?。
 */
export function buildGridTemplateColumns(
  state: PaneLayoutState,
  inspectorVisible: boolean,
): string | null {
  if (state.mode === 'default') return null
  const sidebarW = state.sidebarW ?? PANE_DEFAULT_WIDTHS.sidebar
  const timelineTrack = `minmax(${PANE_MIN_WIDTHS.timeline}px, 1fr)`
  if (!inspectorVisible) {
    return `${sidebarW}px ${PANE_DIVIDER_WIDTH}px ${timelineTrack}`
  }
  const inspectorW = state.inspectorW ?? PANE_DEFAULT_WIDTHS.inspector
  return `${sidebarW}px ${PANE_DIVIDER_WIDTH}px ${timelineTrack} ${PANE_DIVIDER_WIDTH}px ${inspectorW}px`
}

/**
 * 归一化：custom/equal 状态若与 Default 预设视觉等价（所有生效宽度都等于
 * 默认值或缺省），折叠为 default，让 CSS（含响应式断点）接管。
 */
export function normalizePaneLayout(state: PaneLayoutState): PaneLayoutState {
  if (state.mode === 'default') return state
  const sidebarMatches = (state.sidebarW ?? PANE_DEFAULT_WIDTHS.sidebar) === PANE_DEFAULT_WIDTHS.sidebar
  const inspectorMatches = (state.inspectorW ?? PANE_DEFAULT_WIDTHS.inspector) === PANE_DEFAULT_WIDTHS.inspector
  if (sidebarMatches && inspectorMatches) return { mode: 'default' }
  return state
}

function isValidWidth(value: unknown, min: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= PANE_MAX_WIDTH
}

/**
 * 解析并校验持久化的布局。非法/损坏的值一律返回 null（调用方回退 Default）：
 * mode 必须是三个字面量之一；custom/equal 至少需要一个合法宽度；
 * 宽度必须是非负有限数值且不低于各自最小值（允许小数，四舍五入）。
 */
export function parsePaneLayout(raw: unknown): PaneLayoutState | null {
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const mode = record.mode
  if (mode === 'default') {
    return { mode: 'default' }
  }
  if (mode !== 'equal' && mode !== 'custom') return null
  const sidebarW = isValidWidth(record.sidebarW, PANE_MIN_WIDTHS.sidebar)
    ? Math.round(record.sidebarW as number)
    : undefined
  const inspectorW = isValidWidth(record.inspectorW, PANE_MIN_WIDTHS.inspector)
    ? Math.round(record.inspectorW as number)
    : undefined
  if (sidebarW === undefined && inspectorW === undefined) return null
  return { mode, ...(sidebarW !== undefined ? { sidebarW } : {}), ...(inspectorW !== undefined ? { inspectorW } : {}) }
}

/** 序列化用于 localStorage；缺省宽度不写入。 */
export function serializePaneLayout(state: PaneLayoutState): string {
  const payload: Record<string, unknown> = { mode: state.mode }
  if (state.sidebarW !== undefined) payload.sidebarW = state.sidebarW
  if (state.inspectorW !== undefined) payload.inspectorW = state.inspectorW
  return JSON.stringify(payload)
}
