import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import {
  init, dispose, registerLocale,
  ActionType, IndicatorSeries, YAxisType, OverlayMode, LineType
} from 'klinecharts'
import { CandleType, type Chart, type Crosshair } from 'klinecharts'
import { BarChart3 } from 'lucide-react'
import type { ChartAnnotation, ChartAnnotationPayload, KlineBar } from '../../lib/types'
import { EmptyState } from '../shared/Panel'
import { DrawingToolbar } from './DrawingToolbar'
import { buildKLineChartModel, tradeDateToTimestamp } from './KLineChartModel'
import { Magnifier } from './Magnifier'

registerLocale('zh-CN', {
  time: '日期',
  open: '开盘',
  high: '最高',
  low: '最低',
  close: '收盘',
  volume: '成交量',
  change: '涨幅',
  turnover: '成交额'
})

const CANDLE_PANE_ID = 'candle_pane'
const SUB_PANE_ID = 'qsgg_sub_pane'
const DEFAULT_BAR_SPACE = 7
const CHART_BACKGROUND_COLOR = '#0d0d0d'
const MA_INDICATOR_NAME = 'QSGGMA'

export function KLineChartPanel({
  bars,
  annotations,
  drawingTool,
  onDrawComplete,
  onAnnotationUpdate,
  onAnnotationDelete,
  subChartType,
  onSubChartTypeChange,
  maLines,
  coordType,
  onCrosshairBar,
  onCrosshairPosition
}: {
  bars: KlineBar[]
  annotations: ChartAnnotation[]
  drawingTool: 'horizontal_line' | 'ray' | null
  onDrawComplete: (payload: ChartAnnotationPayload) => void
  onAnnotationUpdate?: (annotation: ChartAnnotation, payload: ChartAnnotationPayload) => void
  onAnnotationDelete?: (annotation: ChartAnnotation) => void
  subChartType?: 'volume' | 'amount'
  onSubChartTypeChange?: (type: 'volume' | 'amount') => void
  maLines?: Array<{ period: number; color: string; enabled: boolean }>
  coordType?: 'normal' | 'log'
  onCrosshairBar?: (bar: KlineBar | null) => void
  onCrosshairPosition?: (pos: 'top-left' | 'top-right') => void
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<Chart | null>(null)
  const latestBarsRef = useRef<KlineBar[]>(bars)
  const subPaneIdRef = useRef<string | null>(null)
  const onCrosshairBarRef = useRef(onCrosshairBar)
  const onCrosshairPositionRef = useRef(onCrosshairPosition)
  const selectedAnnotationRef = useRef<ChartAnnotation | null>(null)
  const undoHistoryRef = useRef<Map<string, ChartAnnotationPayload[]>>(new Map())
  const dataSignatureRef = useRef('')

  onCrosshairBarRef.current = onCrosshairBar
  onCrosshairPositionRef.current = onCrosshairPosition

  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null)
  const [showDrawingToolbar, setShowDrawingToolbar] = useState(false)
  const [toolbarPosition, setToolbarPosition] = useState({ x: 0, y: 0 })
  const [subPaneTop, setSubPaneTop] = useState<number | null>(null)
  const [showMagnifier, setShowMagnifier] = useState(false)
  const [magnifierBar, setMagnifierBar] = useState<KlineBar | null>(null)
  const deltaHistoryRef = useRef<number[]>([])
  const drawingToolRef = useRef(drawingTool)
  drawingToolRef.current = drawingTool
  const crosshairPositionRef = useRef<'top-left' | 'top-right'>('top-right')
  const hasChartData = bars.length > 0

  const chartModel = useMemo(() => buildKLineChartModel(bars, maLines), [bars, maLines])
  const chartData = chartModel.adapterBars

  const refreshSubPaneTop = useCallback(() => {
    const chart = chartRef.current
    const paneId = subPaneIdRef.current
    if (!chart || !paneId) return
    const size = chart.getSize?.(paneId)
    if (size?.top != null) setSubPaneTop(size.top + 6)
  }, [])

  const clearOverlaySelection = useCallback(() => {
    selectedAnnotationRef.current = null
    setSelectedOverlayId(null)
    setShowDrawingToolbar(false)
  }, [])

  const selectOverlay = useCallback((annotation: ChartAnnotation, event: OverlayCallbackEvent) => {
    const overlayId = event.overlay?.id
    if (!overlayId) return

    selectedAnnotationRef.current = annotation
    setSelectedOverlayId(overlayId)
    setShowDrawingToolbar(true)
    setToolbarPosition(resolveToolbarPosition(event, chartRef.current, hostRef.current))
  }, [])

  const updateAnnotationFromOverlay = useCallback(
    (annotation: ChartAnnotation, event: OverlayCallbackEvent) => {
      const payload = overlayEventToPayload(event, annotation, latestBarsRef.current)
      if (payload) {
        const history = undoHistoryRef.current.get(annotation.id) ?? []
        history.push(annotation.payload)
        undoHistoryRef.current.set(annotation.id, history.slice(-20))
        onAnnotationUpdate?.(annotation, payload)
      }
    },
    [onAnnotationUpdate]
  )

  useEffect(() => {
    latestBarsRef.current = chartModel.bars
  }, [chartModel.bars])

  const priceTicks = useMemo(() => {
    const range = bars.reduce(
      (next, bar) => ({
        min: Math.min(next.min, bar.low),
        max: Math.max(next.max, bar.high)
      }),
      { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY }
    )
    return createTicks(range.min, range.max, 5)
  }, [bars])

  const subTicks = useMemo(() => {
    const maxValue = bars.reduce(
      (max, bar) => Math.max(max, subChartType === 'amount' ? bar.amount : bar.volume),
      Number.NEGATIVE_INFINITY
    )
    return createTicks(0, maxValue, 4)
  }, [bars, subChartType])

  // Chart initialization + crosshair subscription
  useEffect(() => {
    if (!hostRef.current || !hasChartData) return
    const chart = init(hostRef.current, {
      locale: 'zh-CN',
      customApi: {
        formatBigNumber: formatChineseUnit
      },
      styles: {
        grid: {
          horizontal: { color: 'rgba(255,255,255,0.07)' },
          vertical: { color: 'rgba(255,255,255,0.05)' }
        },
        candle: {
          type: CandleType.CandleUpStroke,
          bar: {
            upColor: CHART_BACKGROUND_COLOR,
            upBorderColor: '#dc2626',
            upWickColor: '#dc2626',
            downColor: '#0f9f6e',
            downBorderColor: '#0f9f6e',
            downWickColor: '#0f9f6e',
            noChangeColor: '#737373',
            noChangeBorderColor: '#737373',
            noChangeWickColor: '#737373'
          },
          priceMark: {
            show: false
          }
        },
        yAxis: {
          inside: false,
          tickText: { show: true, color: '#888888', size: 9 } as never
        },
        separator: {
          size: 1,
          color: 'rgba(255,255,255,0.04)',
          fill: false,
          activeBackgroundColor: 'rgba(77,144,254,0.08)'
        }
      }
    }) as Chart | null
    if (!chart) return
    chartRef.current = chart
    subPaneIdRef.current = null

    chart.setBarSpace(DEFAULT_BAR_SPACE)
    configureScrollLimits(chart)

    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            if (resizeTimer) clearTimeout(resizeTimer)
            resizeTimer = setTimeout(() => {
              if (chartRef.current) {
                chartRef.current.resize()
                configureScrollLimits(chartRef.current)
                scheduleFrame(refreshSubPaneTop)
              }
            }, 100)
          })
        : null
    resizeObserver?.observe(hostRef.current)

    chart.subscribeAction(ActionType.OnCrosshairChange, (data: unknown) => {
      const crosshair = data as Crosshair | undefined
      if (!crosshair || crosshair.dataIndex == null || crosshair.dataIndex < 0) {
        onCrosshairBarRef.current?.(null)
        return
      }
      const idx = crosshair.realDataIndex ?? crosshair.dataIndex
      const bar =
        idx != null && idx >= 0 && idx < latestBarsRef.current.length
          ? latestBarsRef.current[idx]
          : null
      onCrosshairBarRef.current?.(bar)

      // Velocity tracking for magnifier
      if (drawingToolRef.current && bar) {
        const now = Date.now()
        const delta = now - crosshairTimestampRef.current
        crosshairTimestampRef.current = now
        const hist = deltaHistoryRef.current
        hist.push(delta)
        if (hist.length > 3) hist.shift()
        if (hist.length >= 3 && hist.every(d => d >= 300)) {
          setShowMagnifier(true)
          setMagnifierBar(bar)
        } else {
          setShowMagnifier(false)
          setMagnifierBar(null)
        }
      } else {
        setShowMagnifier(false)
        setMagnifierBar(null)
      }

      if (crosshair.realX != null && hostRef.current) {
        const mid = hostRef.current.clientWidth / 4
        const pos = crosshair.realX < mid ? 'top-right' : 'top-left'
        crosshairPositionRef.current = pos
        onCrosshairPositionRef.current?.(pos)
      }
    })

    return () => {
      if (resizeTimer) clearTimeout(resizeTimer)
      chart.unsubscribeAction(ActionType.OnCrosshairChange)
      resizeObserver?.disconnect()
      chartRef.current = null
      subPaneIdRef.current = null
      if (hostRef.current) dispose(hostRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasChartData, refreshSubPaneTop])

  // Apply data without recreating the chart instance. Reinitializing the canvas on every
  // data-length change can leave the time scale in an extreme zoom state after page switches.
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    chart.applyNewData(chartData, undefined, () => {
      configureScrollLimits(chart)
      refreshSubPaneTop()
    })
    const nextSignature = chartData.length > 0
      ? `${chartData.length}:${chartData[0]?.timestamp}:${chartData[chartData.length - 1]?.timestamp}`
      : ''
    if (nextSignature !== dataSignatureRef.current) {
      dataSignatureRef.current = nextSignature
      chart.setBarSpace(DEFAULT_BAR_SPACE)
      chart.setOffsetRightDistance?.(0)
    } else {
      const barSpace = chart.getBarSpace?.()
      if (!Number.isFinite(barSpace) || barSpace < 3 || barSpace > 16) {
        chart.setBarSpace(DEFAULT_BAR_SPACE)
      }
    }
    clearOverlaySelection()
  }, [chartData, clearOverlaySelection, refreshSubPaneTop])

  // Apply annotations independently from data so drawing edits do not force a full data refresh.
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    chart.removeOverlay?.({ groupId: 'persisted' })
    chart.removeOverlay?.({ groupId: 'drawing' })
    annotations.forEach(annotation => {
      const overlay = annotationToOverlay(annotation, {
        onSelect: selectOverlay,
        onMoveEnd: updateAnnotationFromOverlay
      })
      if (overlay) chart.createOverlay?.(overlay, CANDLE_PANE_ID)
    })
  }, [annotations, selectOverlay, updateAnnotationFromOverlay])

  // Drawing tool
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !drawingTool) return
    clearOverlaySelection()
    const idResult = chart.createOverlay?.(
      {
        name: drawingTool === 'horizontal_line' ? 'priceLine' : 'rayLine',
        groupId: 'drawing',
        needDefaultPointFigure: true,
        mode: OverlayMode.WeakMagnet,
        modeSensitivity: 8,
        onDrawEnd: (event: unknown) => {
          const payload = eventToPayload(event, drawingTool, latestBarsRef.current)
          if (payload) {
            onDrawComplete(payload)
            const overlayId = Array.isArray(idResult) ? (idResult[0] ?? null) : (idResult ?? null)
            if (overlayId) chart.removeOverlay(overlayId)
          }
          return false
        }
      },
      CANDLE_PANE_ID
    )
    return () => {
      const overlayId = Array.isArray(idResult) ? (idResult[0] ?? null) : (idResult ?? null)
      if (overlayId) chart.removeOverlay(overlayId)
    }
  }, [clearOverlaySelection, drawingTool, onDrawComplete])

  // MA overlay (MUST come before sub-chart to stay on candle_pane)
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    const enabledMas = (maLines ?? []).filter(ma => ma.enabled)
    const existing = chart.getIndicatorByPaneId?.(CANDLE_PANE_ID, MA_INDICATOR_NAME)
    if (existing) {
      chart.removeIndicator(CANDLE_PANE_ID, MA_INDICATOR_NAME)
    }

    if (enabledMas.length > 0) {
      chart.createIndicator?.(
        createMaIndicator(enabledMas) as never,
        true,
        { id: CANDLE_PANE_ID }
      )
    }
  }, [maLines, hasChartData])

  // Sub-chart indicator
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    if (subPaneIdRef.current) {
      try {
        chart.removeIndicator(subPaneIdRef.current)
      } catch {
        /* ignore */
      }
      subPaneIdRef.current = null
    }

    const paneId = chart.createIndicator(
      createSubChartIndicator(subChartType ?? 'volume') as never,
      false,
      { id: SUB_PANE_ID, height: 144, minHeight: 96, dragEnabled: false },
      refreshSubPaneTop
    )
    subPaneIdRef.current = paneId ?? SUB_PANE_ID
    scheduleFrame(refreshSubPaneTop)
  }, [hasChartData, refreshSubPaneTop, subChartType])

  // Log coordinate
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    chart.setStyles?.({
      yAxis: {
        type: coordType === 'log' ? YAxisType.Log : YAxisType.Normal
      }
    })
  }, [coordType, hasChartData])

  // --- Magnifier: track crosshair velocity ---
  const crosshairTimestampRef = useRef(0)
  useEffect(() => {
    if (!drawingTool) {
      setShowMagnifier(false)
      setMagnifierBar(null)
    }
  }, [drawingTool, hasChartData])

  // --- DrawingToolbar callbacks ---
  const handleColorChange = useCallback(
    (color: string) => {
      if (!selectedOverlayId) return
      const chart = chartRef.current
      if (!chart) return
      const annotation = selectedAnnotationRef.current
      if (annotation) {
        const history = undoHistoryRef.current.get(annotation.id) ?? []
        history.push(annotation.payload)
        undoHistoryRef.current.set(annotation.id, history.slice(-20))
        onAnnotationUpdate?.(annotation, { ...annotation.payload, color })
      }
      chart.overrideOverlay?.({ id: selectedOverlayId, styles: { line: { color } } } as never)
    },
    [onAnnotationUpdate, selectedOverlayId]
  )

  const handleDeleteOverlay = useCallback(() => {
    if (!selectedOverlayId) return
    const chart = chartRef.current
    if (!chart) return
    const annotation = selectedAnnotationRef.current
    chart.removeOverlay(selectedOverlayId)
    if (annotation) onAnnotationDelete?.(annotation)
    selectedAnnotationRef.current = null
    setSelectedOverlayId(null)
    setShowDrawingToolbar(false)
  }, [onAnnotationDelete, selectedOverlayId])

  const handleUndoOverlay = useCallback(() => {
    const annotation = selectedAnnotationRef.current
    if (!annotation) return
    const history = undoHistoryRef.current.get(annotation.id) ?? []
    const previous = history.pop()
    undoHistoryRef.current.set(annotation.id, history)
    if (previous) onAnnotationUpdate?.(annotation, previous)
  }, [onAnnotationUpdate])

  useEffect(() => {
    if (!selectedOverlayId) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        handleDeleteOverlay()
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        clearOverlaySelection()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [clearOverlaySelection, handleDeleteOverlay, selectedOverlayId])

  if (bars.length === 0) {
    return (
      <div className="kline-chart-host w-full h-full flex items-center justify-center">
        <EmptyState title="数据未就绪" detail="图表只读取本地 K 线库。请先在数据页显式同步。" />
      </div>
    )
  }

  return (
    <div className="relative w-full h-full">
      <div ref={hostRef} className="kline-chart-host w-full h-full" />
      <AxisLabels side="left" top={18} bottom={subPaneTop ?? 156} values={priceTicks} />
      <AxisLabels side="right" top={18} bottom={subPaneTop ?? 156} values={priceTicks} />
      <AxisLabels side="left" top={(subPaneTop ?? 0) + 28} bottom={12} values={subTicks} formatter={formatChineseUnit} />
      <AxisLabels side="right" top={(subPaneTop ?? 0) + 28} bottom={12} values={subTicks} formatter={formatChineseUnit} />

      {/* Sub-chart toggle */}
      <button
        type="button"
        onClick={() => onSubChartTypeChange?.(subChartType === 'amount' ? 'volume' : 'amount')}
        className="absolute left-2 z-30 inline-flex h-6 items-center gap-1.5 bg-background/80 px-2 text-[10px] font-mono text-foreground backdrop-blur-sm transition hover:bg-muted"
        style={{ top: subPaneTop ?? undefined, bottom: subPaneTop == null ? 18 : undefined }}
      >
        <BarChart3 className="h-3 w-3 text-ring" />
        {subChartType === 'amount' ? '成交额' : '成交量'}
      </button>

      {showDrawingToolbar && selectedOverlayId && (
        <DrawingToolbar
          position={toolbarPosition}
          onColorChange={handleColorChange}
          onUndo={handleUndoOverlay}
          onDelete={handleDeleteOverlay}
        />
      )}
      {showMagnifier && magnifierBar && (
        <Magnifier bar={magnifierBar} position={crosshairPositionRef.current || 'top-right'} />
      )}
    </div>
  )
}

function AxisLabels({
  side,
  top,
  bottom,
  values,
  formatter = value => trimUnitNumber(value, 2)
}: {
  side: 'left' | 'right'
  top: number
  bottom: number
  values: number[]
  formatter?: (value: number) => string
}) {
  if (!values.length) return null
  return (
    <div
      className={`pointer-events-none absolute z-20 flex flex-col justify-between text-[9px] text-muted-foreground ${side === 'left' ? 'left-1 items-start' : 'right-1 items-end'}`}
      style={{ top, bottom }}
    >
      {[...values].reverse().map(value => (
        <span key={`${side}-${top}-${value}`} className="bg-background/35 px-0.5 font-mono">
          {formatter(value)}
        </span>
      ))}
    </div>
  )
}

function createTicks(min: number, max: number, count: number) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || count <= 1) return []
  if (max === min) return [max]
  const step = (max - min) / (count - 1)
  return Array.from({ length: count }, (_, index) => min + step * index)
}

type OverlayPoint = { dataIndex?: number; timestamp?: number; value?: number }

type OverlayCallbackEvent = {
  pageX?: number
  pageY?: number
  overlay?: {
    id?: string
    points?: OverlayPoint[]
  }
}

type AnnotationOverlayHandlers = {
  onSelect: (annotation: ChartAnnotation, event: OverlayCallbackEvent) => void
  onMoveEnd: (annotation: ChartAnnotation, event: OverlayCallbackEvent) => void
}

function annotationToOverlay(annotation: ChartAnnotation, handlers: AnnotationOverlayHandlers) {
  const base = {
    groupId: 'persisted',
    lock: false,
    needDefaultPointFigure: true,
    mode: OverlayMode.WeakMagnet,
    modeSensitivity: 8,
    extendData: annotation.payload.label ?? '',
    styles: annotation.payload.color ? { line: { color: annotation.payload.color } } : undefined,
    onClick: (event: OverlayCallbackEvent) => {
      handlers.onSelect(annotation, event)
      return false
    },
    onSelected: (event: OverlayCallbackEvent) => {
      handlers.onSelect(annotation, event)
      return false
    },
    onPressedMoveEnd: (event: OverlayCallbackEvent) => {
      handlers.onMoveEnd(annotation, event)
      return false
    }
  }

  if (annotation.annotationType === 'horizontal_line' && annotation.payload.type === 'horizontal_line') {
    return {
      ...base,
      name: 'priceLine',
      points: [
        {
          timestamp: Date.now(),
          value: annotation.payload.price
        }
      ]
    }
  }
  if (annotation.annotationType === 'ray' && annotation.payload.type === 'ray') {
    return {
      ...base,
      name: 'rayLine',
      points: [
        {
          timestamp: tradeDateToTimestamp(annotation.payload.start.date),
          value: annotation.payload.start.price
        },
        {
          timestamp: tradeDateToTimestamp(annotation.payload.end.date),
          value: annotation.payload.end.price
        }
      ]
    }
  }
  return null
}

function eventToPayload(
  event: unknown,
  drawingTool: 'horizontal_line' | 'ray',
  bars: KlineBar[]
): ChartAnnotationPayload | null {
  const points = (event as OverlayCallbackEvent)?.overlay?.points
  return pointsToPayload(points, drawingTool, bars)
}

function overlayEventToPayload(
  event: OverlayCallbackEvent,
  annotation: ChartAnnotation,
  bars: KlineBar[]
): ChartAnnotationPayload | null {
  return pointsToPayload(event.overlay?.points, annotation.annotationType, bars, annotation.payload)
}

function pointsToPayload(
  points: OverlayPoint[] | undefined,
  annotationType: 'horizontal_line' | 'ray',
  bars: KlineBar[],
  basePayload?: ChartAnnotationPayload
): ChartAnnotationPayload | null {
  if (!points || points.length === 0) return null

  if (annotationType === 'horizontal_line') {
    const price = points[0]?.value
    if (typeof price !== 'number') return null
    const base = basePayload?.type === 'horizontal_line' ? basePayload : undefined
    return {
      type: 'horizontal_line',
      price,
      label: base?.label ?? '手动画线',
      ...(base?.color ? { color: base.color } : {}),
      ...(base?.reason ? { reason: base.reason } : {})
    }
  }

  const first = pointToBar(points[0], bars)
  const second = pointToBar(points[1], bars)
  if (!first || !second) return null
  const base = basePayload?.type === 'ray' ? basePayload : undefined
  const snapped = nearestHighLow(points[1]?.value, second.bar)
  return {
    type: 'ray',
    start: { date: first.bar.date, price: first.price },
    end: { date: second.bar.date, price: second.price },
    label: base?.label ?? '手动画线',
    ...(base?.color ? { color: base.color } : {}),
    ...(base?.reason ? { reason: base.reason } : {}),
    ...(snapped ? { snappedTo: snapped } : {})
  }
}

function pointToBar(
  point: OverlayPoint | undefined,
  bars: KlineBar[]
): { bar: KlineBar; price: number } | null {
  if (!point || typeof point.value !== 'number') return null
  if (typeof point.dataIndex === 'number') {
    const index = Math.max(0, Math.min(bars.length - 1, Math.round(point.dataIndex)))
    const bar = bars[index]
    return bar ? { bar, price: point.value } : null
  }
  const timestamp = point.timestamp ?? 0
  const found =
    bars.reduce<{ bar: KlineBar; diff: number } | null>((best, bar) => {
      const diff = Math.abs(tradeDateToTimestamp(bar.date) - timestamp)
      if (!best || diff < best.diff) return { bar, diff }
      return best
    }, null)?.bar ?? bars[bars.length - 1]
  return { bar: found, price: point.value }
}

function nearestHighLow(price: number | undefined, bar: KlineBar) {
  if (typeof price !== 'number') return undefined
  const range = Math.max(bar.high - bar.low, 0.01)
  const threshold = range * 0.08
  if (Math.abs(price - bar.high) <= threshold) return 'high'
  if (Math.abs(price - bar.low) <= threshold) return 'low'
  return undefined
}

function createSubChartIndicator(type: 'volume' | 'amount') {
  const title = type === 'amount' ? '成交额' : '成交量'
  const maTitle = type === 'amount' ? '均额' : '均量'
  const calcParams = [5, 10, 20]

  return {
    name: 'VOL',
    shortName: title,
    series: IndicatorSeries.Volume,
    calcParams,
    precision: 0,
    minValue: 0,
    shouldFormatBigNumber: true,
    figures: [
      ...calcParams.map((period, index) => ({
        key: `ma${index + 1}`,
        title: `${maTitle}${period}: `,
        type: 'line'
      })),
      {
        key: 'qsggValue',
        title: `${title}: `,
        type: 'bar',
        baseValue: 0,
        styles: (data: IndicatorStyleData, _indicator: unknown, defaultStyles: IndicatorDefaultStyles) => {
          const kLineData = data.current.kLineData
          if (!kLineData) return {}
          if (kLineData.close > kLineData.open) return { color: '#dc2626' }
          if (kLineData.close < kLineData.open) return { color: '#0f9f6e' }
          return { color: defaultStyles.bars?.[0]?.noChangeColor ?? '#737373' }
        }
      }
    ],
    calc: (dataList: Array<{ volume?: number; turnover?: number }>) => {
      const sums: number[] = []
      return dataList.map((data, index) => {
        const value = type === 'amount' ? (data.turnover ?? 0) : (data.volume ?? 0)
        const result: Record<string, number> = { qsggValue: value }
        calcParams.forEach((period, periodIndex) => {
          sums[periodIndex] = (sums[periodIndex] ?? 0) + value
          if (index >= period - 1) {
            result[`ma${periodIndex + 1}`] = sums[periodIndex] / period
            const oldValue =
              type === 'amount'
                ? (dataList[index - (period - 1)]?.turnover ?? 0)
                : (dataList[index - (period - 1)]?.volume ?? 0)
            sums[periodIndex] -= oldValue
          }
        })
        return result
      })
    },
    styles: {
      lines: [
        { color: '#f0b93b', size: 1, style: LineType.Solid, smooth: false, dashedValue: [] },
        { color: '#bb9af7', size: 1, style: LineType.Solid, smooth: false, dashedValue: [] },
        { color: '#1677ff', size: 1, style: LineType.Solid, smooth: false, dashedValue: [] }
      ]
    }
  }
}

function createMaIndicator(maLines: Array<{ period: number; color: string; enabled: boolean }>) {
  const periods = maLines.map(ma => ma.period)
  return {
    name: MA_INDICATOR_NAME,
    shortName: 'MA',
    series: IndicatorSeries.Price,
    calcParams: periods,
    precision: 2,
    figures: periods.map(period => ({
      key: `ma${period}`,
      title: `MA${period}: `,
      type: 'line'
    })),
    calc: (dataList: Array<{ close?: number }>) => {
      const sums = new Map<number, number>()
      return dataList.map((data, index) => {
        const close = data.close ?? 0
        const result: Record<string, number> = {}
        periods.forEach(period => {
          const nextSum = (sums.get(period) ?? 0) + close
          sums.set(period, nextSum)
          if (index >= period - 1) {
            result[`ma${period}`] = nextSum / period
            sums.set(period, nextSum - (dataList[index - period + 1]?.close ?? 0))
          }
        })
        return result
      })
    },
    styles: {
      lines: maLines.map(ma => ({
        color: ma.color,
        size: 1,
        style: LineType.Solid,
        smooth: false,
        dashedValue: []
      }))
    }
  }
}

function configureScrollLimits(chart: Chart) {
  chart.setMaxOffsetLeftDistance?.(0)
  chart.setMaxOffsetRightDistance?.(0)
}

type IndicatorStyleData = {
  current: {
    kLineData?: {
      open: number
      close: number
    }
  }
}

type IndicatorDefaultStyles = {
  bars?: Array<{
    upColor: string
    downColor: string
    noChangeColor: string
  }>
}

function formatChineseUnit(value: string | number) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return `${value}`
  const abs = Math.abs(numeric)
  if (abs >= 100000000) return `${trimUnitNumber(numeric / 100000000)}亿`
  if (abs >= 10000) return `${trimUnitNumber(numeric / 10000)}万`
  return trimUnitNumber(numeric, abs >= 100 ? 0 : 2)
}

function trimUnitNumber(value: number, digits = 2) {
  return value.toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')
}

function resolveToolbarPosition(
  event: OverlayCallbackEvent,
  chart: Chart | null,
  host: HTMLDivElement | null
) {
  const fallback = { x: 96, y: 42 }
  if (!host) return fallback
  const rect = host.getBoundingClientRect()
  let x: number | undefined
  let y: number | undefined

  if (typeof event.pageX === 'number' && typeof event.pageY === 'number') {
    x = event.pageX - rect.left
    y = event.pageY - rect.top
  } else if (chart && event.overlay?.points?.[0]) {
    const pixel = chart.convertToPixel(event.overlay.points[0], {
      paneId: CANDLE_PANE_ID,
      absolute: true
    }) as { x?: number; y?: number }
    x = pixel.x
    y = pixel.y
  }

  return {
    x: clamp((x ?? fallback.x) + 10, 8, Math.max(8, rect.width - 180)),
    y: clamp((y ?? fallback.y) - 36, 8, Math.max(8, rect.height - 40))
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function scheduleFrame(callback: () => void) {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(callback)
  } else {
    setTimeout(callback, 0)
  }
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable
}
