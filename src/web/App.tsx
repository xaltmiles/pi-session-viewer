import { AlertCircle, ArrowLeft, Bot, Clock3, Columns3, Copy, FolderOpen, LayoutPanelTop, Menu, PanelRightOpen, RefreshCw, Rows3, Search, X } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { fetchSession, fetchSessions, resolveSession } from './api'
import { Inspector } from './components/Inspector'
import { SessionSidebar } from './components/SessionSidebar'
import { Timeline, type TimelineHandle } from './components/Timeline'
import {
  buildGridTemplateColumns,
  computeEqualWidths,
  inspectorWidthRange,
  normalizePaneLayout,
  PANE_DEFAULT_WIDTHS,
  PANE_MAX_WIDTH,
  PANE_MIN_WIDTHS,
  PANE_STORAGE_KEY,
  paneBudget,
  parsePaneLayout,
  resizePaneWidth,
  serializePaneLayout,
  sidebarWidthRange,
  stepPaneWidth,
  type PaneLayoutState,
  type ResizablePane,
} from './pane-layout'
import { formatDateTime, formatDuration } from '../core/format'
import { parseSessionJsonl } from '../core/session-parser'
import { buildSessionView } from '../core/session-view'
import { browserAccessToken, browserInitialCwd } from './session-auth'
import { sessionCache } from './session-cache'
import { createSessionViewController, isSearchQueryActive } from './session-view-controller'
import { useCopyFeedback } from './use-copy-feedback'
import type {
  EventKind,
  SessionListItem,
  SubagentReference,
  TimelineEvent,
} from '../core/types'
import { useI18n } from './i18n'

const initialCatalogLoadControllers = new WeakSet<object>()
const compactQuery = '(max-width: 1024px)'

function subscribeToCompactScreen(onChange: () => void) {
  const media = window.matchMedia(compactQuery)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

function isCompactScreen() {
  return window.matchMedia(compactQuery).matches
}

/* ---- 窗格布局（pane layout）：持久化 IO + DOM 测量，几何运算在 pane-layout.ts ---- */

function readStoredPaneLayout(): PaneLayoutState {
  try {
    const raw = localStorage.getItem(PANE_STORAGE_KEY)
    if (!raw) return { mode: 'default' }
    return parsePaneLayout(raw) ?? { mode: 'default' }
  } catch {
    return { mode: 'default' }
  }
}

function writeStoredPaneLayout(state: PaneLayoutState) {
  try {
    localStorage.setItem(PANE_STORAGE_KEY, serializePaneLayout(state))
  } catch {
    // ignore write failures (private mode, quota)
  }
}

/** 读取 `.workspace` 当前实际列宽（Default 模式由样式表决定，含响应式断点）。 */
function measureWorkspaceColumns(element: HTMLElement): { sidebarW: number; inspectorW: number } | null {
  const columns = getComputedStyle(element).gridTemplateColumns
  const widths = columns
    .split(' ')
    .map((value) => Number.parseFloat(value))
    .filter((value) => Number.isFinite(value))
  if (widths.length < 3) return null
  return { sidebarW: widths[0], inspectorW: widths[widths.length - 1] }
}

interface PaneDragSession {
  pane: ResizablePane
  startWidth: number
  startPointerX: number
  clientX: number
  sidebarW: number
  inspectorW: number
  frame: number | null
  moved: boolean
}

interface PaneDividerProps {
  pane: ResizablePane
  className: string
  label: string
  valueNow: number
  onDragStart: (pane: ResizablePane, event: ReactPointerEvent<HTMLDivElement>) => void
  onDragMove: (event: ReactPointerEvent<HTMLDivElement>) => void
  onDragEnd: (event: ReactPointerEvent<HTMLDivElement>) => void
  onReset: (pane: ResizablePane) => void
  onKeyDown: (pane: ResizablePane, event: ReactKeyboardEvent<HTMLDivElement>) => void
}

/** 桌面端窗格分隔条：拖拽 / 双击复位 / 方向键调整（role="separator"）。 */
function PaneDivider({ pane, className, label, valueNow, onDragStart, onDragMove, onDragEnd, onReset, onKeyDown }: PaneDividerProps) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      className={`pane-divider ${className}`}
      tabIndex={0}
      aria-label={label}
      aria-controls="workspace"
      aria-valuemin={pane === 'sidebar' ? PANE_MIN_WIDTHS.sidebar : PANE_MIN_WIDTHS.inspector}
      aria-valuemax={PANE_MAX_WIDTH}
      aria-valuenow={valueNow}
      aria-valuetext={`${valueNow}px`}
      onPointerDown={(event) => onDragStart(pane, event)}
      onPointerMove={onDragMove}
      onPointerUp={onDragEnd}
      onPointerCancel={onDragEnd}
      onDoubleClick={() => onReset(pane)}
      onKeyDown={(event) => onKeyDown(pane, event)}
    />
  )
}

function CopySessionPathButton({ path }: { path: string }) {
  const { t } = useI18n()
  const { copy, status } = useCopyFeedback()

  return (
    <>
      <button
        type="button"
        className="icon-button header-path-copy"
        onClick={() => { if (path) void copy(path) }}
        disabled={!path}
        title={path || t.header.copySessionPath}
        aria-label={t.header.copySessionPath}
      >
        <Copy size={14} />
      </button>
      {status !== 'idle' && (
        <span role="status" className={`copy-status-toast${status === 'error' ? ' is-error' : ''}`}>
          {status === 'success' ? t.common.copiedTooltip : t.common.copyFailed}
        </span>
      )}
    </>
  )
}

function PiGlyph({ size = 26 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 28 28"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 11.2c.6-1.5 1.5-1.7 2.6-1.7h13.4" />
      <path d="M10.25 9.5v9.5" />
      <path d="M16.75 9.5v7c0 1.5 1 2.5 2.5 2.5" />
    </svg>
  )
}

function measurePerformance<T>(name: string, work: () => T): T {
  const start = performance.now()
  const result = work()
  performance.measure(name, { start, end: performance.now() })
  return result
}

function App() {
  const { t, locale, setLocale } = useI18n()
  const compactScreen = useSyncExternalStore(subscribeToCompactScreen, isCompactScreen, () => false)
  const [accessToken] = useState<string | null>(() => browserAccessToken())
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const timelineRef = useRef<TimelineHandle>(null)
  const drawerReturnFocusRef = useRef<HTMLElement | null>(null)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const paneDragRef = useRef<PaneDragSession | null>(null)
  const [paneLayout, setPaneLayout] = useState<PaneLayoutState>(readStoredPaneLayout)
  const paneLayoutRef = useRef(paneLayout)

  useEffect(() => {
    paneLayoutRef.current = paneLayout
    writeStoredPaneLayout(paneLayout)
  }, [paneLayout])

  // custom/equal 布局写内联 grid-template-columns；default 移除内联样式，
  // 让样式表（含响应式断点）接管。紧凑模式下始终移除，避免内联样式压过抽屉布局。
  useEffect(() => {
    const element = workspaceRef.current
    if (!element) return
    const columns = compactScreen ? null : buildGridTemplateColumns(paneLayout, true)
    if (columns === null) element.style.removeProperty('grid-template-columns')
    else element.style.setProperty('grid-template-columns', columns)
  }, [paneLayout, compactScreen])

  // 拖拽中切到紧凑屏：分隔条随即卸载，丢弃会话并还原光标/选中态。
  useEffect(() => {
    if (!compactScreen) return
    const session = paneDragRef.current
    if (!session) return
    if (session.frame != null) cancelAnimationFrame(session.frame)
    paneDragRef.current = null
    workspaceRef.current?.classList.remove('is-pane-dragging')
  }, [compactScreen])

  const beginPaneDrag = useCallback((pane: ResizablePane, event: ReactPointerEvent<HTMLDivElement>) => {
    if (compactScreen || paneDragRef.current || event.button !== 0) return
    const element = workspaceRef.current
    if (!element) return
    const measured = measureWorkspaceColumns(element)
    if (!measured) return
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.classList.add('is-dragging')
    paneDragRef.current = {
      pane,
      startWidth: pane === 'sidebar' ? measured.sidebarW : measured.inspectorW,
      startPointerX: event.clientX,
      clientX: event.clientX,
      sidebarW: measured.sidebarW,
      inspectorW: measured.inspectorW,
      frame: null,
      moved: false,
    }
    element.classList.add('is-pane-dragging')
  }, [compactScreen])

  // 拖拽期间直接写 DOM（rAF 合并），不逐帧触发 React 渲染，
  // 时间轴 react-virtuoso 只经历平滑的宽度变化，不产生滚动跳变。
  const movePaneDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const session = paneDragRef.current
    const element = workspaceRef.current
    if (!session || !element) return
    session.clientX = event.clientX
    if (!session.moved && Math.abs(session.clientX - session.startPointerX) > 2) session.moved = true
    if (session.frame != null) return
    session.frame = requestAnimationFrame(() => {
      session.frame = null
      if (paneDragRef.current !== session) return // 拖拽已被取消（如切到紧凑模式）
      const containerWidth = element.getBoundingClientRect().width
      const width = resizePaneWidth(session.pane, session.startWidth, session.clientX - session.startPointerX, containerWidth, true)
      if (session.pane === 'sidebar') session.sidebarW = width
      else session.inspectorW = width
      const columns = buildGridTemplateColumns({ mode: 'custom', sidebarW: session.sidebarW, inspectorW: session.inspectorW }, true)
      if (columns) element.style.setProperty('grid-template-columns', columns)
    })
  }, [])

  const endPaneDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const session = paneDragRef.current
    if (!session) return
    paneDragRef.current = null
    if (session.frame != null) cancelAnimationFrame(session.frame)
    event.currentTarget.classList.remove('is-dragging')
    workspaceRef.current?.classList.remove('is-pane-dragging')
    if (event.type === 'pointercancel' || !session.moved) {
      // 取消或未拖动：以提交过的布局为准，恢复内联样式（新对象强制 effect 重跑）。
      setPaneLayout((prev) => ({ ...prev }))
      return
    }
    const element = workspaceRef.current
    if (!element) return
    const containerWidth = element.getBoundingClientRect().width
    const sidebarW = resizePaneWidth('sidebar', session.sidebarW, 0, containerWidth, true)
    const inspectorW = resizePaneWidth('inspector', session.inspectorW, 0, containerWidth, true)
    setPaneLayout(normalizePaneLayout({ mode: 'custom', sidebarW, inspectorW }))
  }, [])

  const handleDividerKeyDown = useCallback((pane: ResizablePane, event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (compactScreen) return
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return
    const element = workspaceRef.current
    if (!element) return
    const containerWidth = element.getBoundingClientRect().width
    let nextWidth: number
    if (event.key === 'Home' || event.key === 'End') {
      const range = pane === 'sidebar' ? sidebarWidthRange(paneBudget(containerWidth, true), true) : inspectorWidthRange(paneBudget(containerWidth, true))
      nextWidth = event.key === 'Home' ? range.min : range.max
    } else {
      const committed = paneLayoutRef.current
      const fallbackWidth = pane === 'sidebar'
        ? committed.sidebarW ?? PANE_DEFAULT_WIDTHS.sidebar
        : committed.inspectorW ?? PANE_DEFAULT_WIDTHS.inspector
      const measured = measureWorkspaceColumns(element)
      const currentWidth = measured ? (pane === 'sidebar' ? measured.sidebarW : measured.inspectorW) : fallbackWidth
      // ArrowRight / ArrowLeft 均指分隔条移动方向：sidebar 右移变宽，inspector 右移变窄。
      const direction = event.key === 'ArrowRight' ? 1 : -1
      nextWidth = stepPaneWidth(pane, currentWidth, direction, containerWidth, true)
    }
    event.preventDefault()
    const prev = paneLayoutRef.current
    setPaneLayout(normalizePaneLayout({
      mode: 'custom',
      sidebarW: pane === 'sidebar' ? nextWidth : prev.sidebarW,
      inspectorW: pane === 'inspector' ? nextWidth : prev.inspectorW,
    }))
  }, [compactScreen])

  const resetPaneBoundary = useCallback((pane: ResizablePane) => {
    if (compactScreen) return
    setPaneLayout((prev) => normalizePaneLayout({
      mode: 'custom',
      sidebarW: pane === 'sidebar' ? PANE_DEFAULT_WIDTHS.sidebar : prev.sidebarW,
      inspectorW: pane === 'inspector' ? PANE_DEFAULT_WIDTHS.inspector : prev.inspectorW,
    }))
  }, [compactScreen])

  const applyDefaultPreset = useCallback(() => {
    if (compactScreen) return
    setPaneLayout({ mode: 'default' })
  }, [compactScreen])

  const applyEqualPreset = useCallback(() => {
    if (compactScreen) return
    const element = workspaceRef.current
    if (!element) return
    const widths = computeEqualWidths(element.getBoundingClientRect().width, true)
    setPaneLayout(normalizePaneLayout({
      mode: 'equal',
      sidebarW: widths.sidebarW,
      inspectorW: widths.inspectorW ?? undefined,
    }))
  }, [compactScreen])

  const effectiveSidebarW = paneLayout.sidebarW ?? PANE_DEFAULT_WIDTHS.sidebar
  const effectiveInspectorW = paneLayout.inspectorW ?? PANE_DEFAULT_WIDTHS.inspector

  useEffect(() => {
    if (!compactScreen) {
      setSidebarOpen(false)
      setInspectorOpen(false)
    }
  }, [compactScreen])

  const activeDrawer = compactScreen ? sidebarOpen ? 'sidebar' : inspectorOpen ? 'inspector' : null : null
  useEffect(() => {
    if (!activeDrawer) return
    const panel = document.querySelector<HTMLElement>(activeDrawer === 'sidebar' ? '.sidebar-layer' : '.inspector')
    if (!panel) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const fallback = document.querySelector<HTMLElement>(
      activeDrawer === 'sidebar' ? '.app-header > .mobile-only' : '.header-actions .mobile-only',
    )
    panel.querySelector<HTMLElement>(activeDrawer === 'sidebar' ? '.sidebar-close' : '.inspector-close')?.focus()

    const onDrawerKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setSidebarOpen(false)
        setInspectorOpen(false)
        return
      }
      if (event.key !== 'Tab') return
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(
        'button:not(:disabled), select:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.getClientRects().length > 0 && !element.closest('[inert]'))
      if (!focusable.length) {
        event.preventDefault()
        panel.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onDrawerKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onDrawerKeyDown, true)
      const opener = drawerReturnFocusRef.current
      const target = opener?.isConnected && !opener.closest('[inert]')
        ? opener
        : previousFocus?.isConnected && !previousFocus.closest('[inert]') ? previousFocus : fallback
      target?.focus()
      drawerReturnFocusRef.current = null
    }
  }, [activeDrawer])

  const [controller] = useState(() => createSessionViewController<File>({
    readServerSession: async (token) => {
      if (!accessToken) throw { code: 'missing-token' }
      return fetchSession(token, accessToken)
    },
    resolveSubagent: async (targetFile, parentRelative) => {
      if (!accessToken) throw { code: 'missing-token' }
      return resolveSession(targetFile, parentRelative, accessToken)
    },
    readImportedFile: (source) => source.file.text(),
    refreshCatalog: async () => {
      if (!accessToken) return null
      return fetchSessions(accessToken)
    },
    cache: sessionCache,
    parseSession: (content, sourceName) => measurePerformance('pi-session-viewer:parse-session', () => parseSessionJsonl(content, sourceName)),
    buildView: (parsed, leafId, projection) => measurePerformance(
      'pi-session-viewer:build-session-view',
      () => buildSessionView(parsed, leafId, projection),
    ),
    now: () => new Date().toISOString(),
    initialCwd: browserInitialCwd(),
    initialCatalogLoading: Boolean(accessToken),
  }))
  const sessionState = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  useEffect(() => {
    if (!accessToken || initialCatalogLoadControllers.has(controller)) return
    initialCatalogLoadControllers.add(controller)
    void controller.dispatch({ type: 'load-catalog', autoOpen: true })
  }, [accessToken, controller])

  const activeSession = sessionState.active
  const sessionLoading = sessionState.loading
  const catalog = sessionState.catalog
  const selectedToken = activeSession?.token ?? null
  const selectedMetadata = activeSession?.metadata ?? null
  const parsedSession = activeSession?.parsed ?? null
  const selectedLeafId = sessionState.selectedLeafId
  const selectedEventId = sessionState.selectedEventId
  const enabledKinds = sessionState.enabledKinds
  const sessionStack = sessionState.navigation
  const restorePosition = sessionState.restoreIntent
  const loadedAt = sessionState.loadedAt
  const importedSource = activeSession?.source.kind === 'file' ? activeSession.source.imported : null
  const importedFile = importedSource?.file ?? null
  const view = sessionState.view
  const activeContextProjection = sessionState.contextProjection
  const selectedEvent = sessionState.selectedEvent
  const previousPrompt = sessionState.previousPrompt
  const visibleTurns = sessionState.visibleTurns
  const fullJsonlPath = sessionState.fullJsonlPath
  const searchQuery = sessionState.searchQuery
  const searchActive = isSearchQueryActive(searchQuery)
  const searchHitCount = sessionState.searchHitCount

  const selectBranch = useCallback((leafId: string) => {
    void controller.dispatch({ type: 'select-branch', leafId })
  }, [controller])
  const toggleEventKind = useCallback((kind: EventKind) => {
    void controller.dispatch({ type: 'toggle-event-kind', kind })
  }, [controller])
  const toggleAllEventKinds = useCallback(() => {
    void controller.dispatch({ type: 'toggle-all-event-kinds' })
  }, [controller])
  const ensureEventKindEnabled = useCallback((kind: EventKind) => {
    void controller.dispatch({ type: 'ensure-event-kind', kind })
  }, [controller])
  const setSearchQuery = useCallback((query: string) => {
    void controller.dispatch({ type: 'set-search-query', query })
  }, [controller])
  const clearSearch = useCallback(() => {
    void controller.dispatch({ type: 'set-search-query', query: '' })
  }, [controller])
  const acknowledgeRestorePosition = useCallback((key: number) => {
    void controller.dispatch({ type: 'acknowledge-timeline-restore', key })
  }, [controller])

  const refreshCurrent = useCallback(() => {
    const viewport = timelineRef.current?.getViewport() ?? null
    void controller.dispatch({ type: 'refresh', viewport })
  }, [controller])

  const openServerSession = useCallback((session: SessionListItem) => {
    setSidebarOpen(false)
    void controller.dispatch({ type: 'open', session })
  }, [controller])

  const openSubagent = useCallback((reference: SubagentReference, sourceEventId?: string) => {
    const viewport = timelineRef.current?.getViewport() ?? null
    setInspectorOpen(false)
    void controller.dispatch({ type: 'open-subagent', reference, sourceEventId, viewport })
  }, [controller])

  const returnToParent = useCallback(() => {
    const viewport = timelineRef.current?.getViewport() ?? null
    void controller.dispatch({ type: 'return-to-parent', viewport })
  }, [controller])

  const importFile = useCallback((file: File) => {
    setSidebarOpen(false)
    void controller.dispatch({ type: 'import', source: { name: file.name, file } })
  }, [controller])

  const selectEvent = useCallback((event: TimelineEvent, showDetails = true) => {
    void controller.dispatch({ type: 'select-event', eventId: event.id })
    if (compactScreen && showDetails) {
      if (!inspectorOpen) drawerReturnFocusRef.current = document.querySelector<HTMLElement>('.timeline-scroll')
      setInspectorOpen(true)
    }
  }, [compactScreen, controller, inspectorOpen])

  const jumpToSelectedEvent = useCallback(() => {
    if (selectedEvent) {
      void controller.dispatch({ type: 'jump-to-event', eventId: selectedEvent.id })
      if (compactScreen) setInspectorOpen(false)
    }
  }, [compactScreen, controller, selectedEvent])

  const jumpToEntry = useCallback((entryId: string) => {
    void controller.dispatch({ type: 'jump-to-entry', entryId })
    if (compactScreen) setInspectorOpen(false)
  }, [compactScreen, controller])

  const errorMessage = (error: NonNullable<typeof sessionState.loadError>) => {
    switch (error.code) {
      case 'missing-token': return t.header.missingToken
      case 'invalid-session': return t.header.invalidSessionFile
      case 'subagent-transcript-only': return t.header.subagentTranscriptOnly
      case 'operation-failed': return t.header.operationFailed
    }
  }
  const loadError = sessionState.loadError ? errorMessage(sessionState.loadError) : null
  const actionError = sessionState.actionError
    ? t.header.failedToLoadSubagent(errorMessage(sessionState.actionError))
    : null
  const displayError = loadError ?? (!accessToken && !importedFile ? t.header.missingToken : null)
  const blockingError = parsedSession && view ? null : displayError
  const title = sessionState.sessionTitle ?? t.header.selectSession

  return (
    <div className="app-shell">
      <header className="app-header" inert={Boolean(activeDrawer)}>
        <button className="icon-button mobile-only" type="button" onClick={(event) => { drawerReturnFocusRef.current = event.currentTarget; setInspectorOpen(false); setSidebarOpen(true) }} title={t.header.openSidebar} aria-label={t.header.openSidebar}>
          <Menu size={19} />
        </button>
        <div className="product-mark" aria-label={t.common.productName}>
          <span className="product-glyph"><PiGlyph size={18} /></span>
          <strong>{t.common.productName}</strong>
        </div>
        {sessionStack.length > 0 ? (
          <div className="header-session header-session--breadcrumbs">
            <CopySessionPathButton path={fullJsonlPath} />
            <div className="breadcrumb-trail">
              <button
                type="button"
                className="breadcrumb-back-btn"
                onClick={returnToParent}
                title={t.header.backToParent}
                aria-label={t.header.backToParent}
              >
                <ArrowLeft size={15} />
                <span>{t.header.backToParent}</span>
              </button>
              <div className="breadcrumb-current">
                <span className="breadcrumb-badge"><Bot size={13} /> {t.header.subagentBadge}</span>
                <strong>{title}</strong>
              </div>
            </div>
          </div>
        ) : (
          <div className="header-session">
            <CopySessionPathButton path={fullJsonlPath} />
            <div className="header-session-info">
              <strong>{title}</strong>
              <span>{selectedMetadata?.cwd ?? parsedSession?.header?.cwd ?? t.header.noSessionLoaded}</span>
            </div>
          </div>
        )}
        <div className="header-actions">
          {loadedAt && <span className="loaded-at"><Clock3 size={14} />{t.header.loadedAt(formatDateTime(loadedAt))}</span>}
          <div className="layout-presets" role="group" aria-label={t.header.layoutPresetsLabel}>
            <button
              type="button"
              className="preset-button desktop-only"
              onClick={applyDefaultPreset}
              aria-pressed={paneLayout.mode === 'default'}
              title={t.header.layoutDefaultTitle}
              aria-label={t.header.layoutDefaultTitle}
            >
              <LayoutPanelTop size={15} aria-hidden="true" />
              <span>{t.header.layoutDefault}</span>
            </button>
            <button
              type="button"
              className="preset-button desktop-only"
              onClick={applyEqualPreset}
              aria-pressed={paneLayout.mode === 'equal'}
              title={t.header.layoutEqualTitle}
              aria-label={t.header.layoutEqualTitle}
            >
              <Columns3 size={15} aria-hidden="true" />
              <span>{t.header.layoutEqual}</span>
            </button>
          </div>
          <button
            type="button"
            className="lang-toggle-button"
            onClick={() => setLocale(locale === 'en' ? 'zh-CN' : 'en')}
            title={locale === 'en' ? t.header.switchToChinese : t.header.switchToEnglish}
            aria-label={locale === 'en' ? t.header.switchToChinese : t.header.switchToEnglish}
          >
            <span className={locale === 'en' ? 'active' : ''}>EN</span>
            <span className="lang-separator">/</span>
            <span className={locale === 'zh-CN' ? 'active' : ''}>中</span>
          </button>
          <button
            className="icon-button"
            type="button"
            onClick={refreshCurrent}
            disabled={sessionLoading || catalog.loading || (!accessToken && !importedFile)}
            title={t.header.reloadTitle}
            aria-label={t.header.reloadTitle}
          >
            <RefreshCw className={sessionLoading || catalog.loading ? 'spin' : ''} size={18} />
          </button>
          <button className="icon-button mobile-only" type="button" onClick={(event) => { drawerReturnFocusRef.current = event.currentTarget; setSidebarOpen(false); setInspectorOpen(true) }} title={t.header.openInspector} aria-label={t.header.openInspector}>
            <PanelRightOpen size={19} />
          </button>
        </div>
      </header>

      <div className="workspace" id="workspace" ref={workspaceRef}>
        <div
          className={`sidebar-layer${sidebarOpen ? ' is-open' : ''}`}
          inert={compactScreen && !sidebarOpen}
          role={activeDrawer === 'sidebar' ? 'dialog' : undefined}
          aria-modal={activeDrawer === 'sidebar' ? true : undefined}
          aria-label={activeDrawer === 'sidebar' ? t.sidebar.heading : undefined}
          tabIndex={-1}
        >
          <SessionSidebar
            projects={catalog.projects}
            sessions={catalog.sessions}
            selectedToken={selectedToken}
            root={catalog.root}
            loading={catalog.loading}
            warnings={catalog.warnings}
            currentCwd={catalog.currentCwd}
            scopeMode={catalog.scopeMode}
            selectedProjectCwd={catalog.selectedProjectCwd}
            onScopeModeChange={(mode) => void controller.dispatch({ type: 'set-scope-mode', mode })}
            onProjectFilterChange={(cwd) => void controller.dispatch({ type: 'set-project-filter', cwd })}
            onSelect={openServerSession}
            onImport={() => fileInput.current?.click()}
            onClose={() => setSidebarOpen(false)}
          />
        </div>

        {!compactScreen && (
          <PaneDivider
            pane="sidebar"
            className="pane-divider--sidebar"
            label={t.header.sidebarDividerLabel}
            valueNow={effectiveSidebarW}
            onDragStart={beginPaneDrag}
            onDragMove={movePaneDrag}
            onDragEnd={endPaneDrag}
            onReset={resetPaneBoundary}
            onKeyDown={handleDividerKeyDown}
          />
        )}

        <main className="main-stage" inert={Boolean(activeDrawer)}>
          {parsedSession && view && (
            <div className="mobile-session-heading">
              <strong>{title}</strong>
              <CopySessionPathButton path={fullJsonlPath} />
            </div>
          )}
          {blockingError ? (
            <div className="load-state is-error" role="alert">
              <AlertCircle size={28} />
              <h1>{!loadError && !accessToken && !importedFile ? t.overview.missingAccessTitle : t.overview.failedToOpen}</h1>
              <p>{blockingError}</p>
              {!accessToken && !importedFile && (
                <div className="load-state-actions">
                  <span>{t.overview.offlineImportHint}</span>
                  <button type="button" className="empty-import-button" onClick={() => fileInput.current?.click()}>
                    <FolderOpen size={16} aria-hidden="true" />
                    {t.sidebar.openJsonl}
                  </button>
                </div>
              )}
            </div>
          ) : parsedSession && view ? (
            <>
              {loadError && (
                <div className="action-error-strip" role="alert">
                  <AlertCircle size={14} />
                  <span>{t.overview.failedToOpen}: {loadError}</span>
                  <button type="button" onClick={() => void controller.dispatch({ type: 'dismiss-load-error' })} aria-label={t.common.dismiss}>
                    <X size={13} />
                  </button>
                </div>
              )}
              {actionError && (
                <div className="action-error-strip" role="alert">
                  <AlertCircle size={14} />
                  <span>{actionError}</span>
                  <button type="button" onClick={() => { void controller.dispatch({ type: 'dismiss-action-error' }) }} aria-label={t.common.dismiss}>
                    <X size={13} />
                  </button>
                </div>
              )}
              <section className="session-summary" aria-label={t.overview.sessionSummary}>
                <div><span>{t.overview.entries}</span><strong>{view.stats.entryCount}</strong></div>
                <div><span>{t.overview.turns}</span><strong>{view.stats.turnCount}</strong></div>
                <div><span>{t.overview.duration}</span><strong>{formatDuration(view.stats.elapsedMs)}</strong></div>
                <div><span>{t.overview.started}</span><strong>{formatDateTime(view.stats.startedAt)}</strong></div>
              </section>
              <div className="timeline-search-bar">
                <div className="timeline-search-box">
                  <Search size={14} className="timeline-search-icon" aria-hidden="true" />
                  <input
                    className="timeline-search-input"
                    type="text"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape' && searchQuery) {
                        event.preventDefault()
                        setSearchQuery('')
                      }
                    }}
                    placeholder={t.timeline.searchPlaceholder}
                    aria-label={t.timeline.searchLabel}
                    spellCheck={false}
                    autoComplete="off"
                  />
                  {searchQuery.trim() !== '' && (
                    <button
                      type="button"
                      className="timeline-search-clear"
                      onClick={() => setSearchQuery('')}
                      title={t.timeline.searchClear}
                      aria-label={t.timeline.searchClear}
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
                {searchActive && (
                  <span
                    className={`timeline-search-count${searchHitCount === 0 ? ' is-empty' : ''}`}
                    role="status"
                  >
                    {t.timeline.searchEventsMatch(searchHitCount)}
                  </span>
                )}
              </div>
              <Timeline
                ref={timelineRef}
                session={parsedSession}
                turns={visibleTurns}
                allEvents={view.events}
                selectedEventId={selectedEventId}
                restorePosition={restorePosition}
                selectedLeafId={selectedLeafId}
                contextProjection={activeContextProjection}
                enabledKinds={enabledKinds}
                searchActive={searchActive}
                searchQuery={searchQuery}
                searchMatchCounts={sessionState.searchMatchCounts}
                onClearSearch={clearSearch}
                onSelectEvent={selectEvent}
                onSelectBranch={selectBranch}
                onToggleKind={toggleEventKind}
                onToggleAllKinds={toggleAllEventKinds}
                onEnsureEventKindEnabled={ensureEventKindEnabled}
                onRestorePositionApplied={acknowledgeRestorePosition}
                onOpenSubagent={openSubagent}
              />
            </>
          ) : (
            <div className="load-state">
              <Rows3 size={30} />
              <h1>{sessionLoading ? t.overview.loadingTitle : t.overview.emptyTitle}</h1>
              <p>{sessionLoading ? t.overview.loadingDesc : t.overview.emptyDesc}</p>
            </div>
          )}
        </main>

        {!compactScreen && (
          <PaneDivider
            pane="inspector"
            className="pane-divider--inspector"
            label={t.header.inspectorDividerLabel}
            valueNow={effectiveInspectorW}
            onDragStart={beginPaneDrag}
            onDragMove={movePaneDrag}
            onDragEnd={endPaneDrag}
            onReset={resetPaneBoundary}
            onKeyDown={handleDividerKeyDown}
          />
        )}

        <Inspector
          event={selectedEvent}
          previousPrompt={previousPrompt}
          searchQuery={searchQuery}
          mobileOpen={inspectorOpen}
          compactScreen={compactScreen}
          onClose={() => setInspectorOpen(false)}
          onJumpToEvent={jumpToSelectedEvent}
          onJumpToEntry={jumpToEntry}
        />
      </div>

      {activeDrawer && <button className="mobile-backdrop" tabIndex={-1} type="button" onClick={() => { setSidebarOpen(false); setInspectorOpen(false) }} aria-label={t.header.closeOverlay} />}

      <input
        ref={fileInput}
        className="visually-hidden"
        type="file"
        accept=".jsonl,application/json,text/plain"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void importFile(file)
          event.target.value = ''
        }}
      />
    </div>
  )
}

export default App
