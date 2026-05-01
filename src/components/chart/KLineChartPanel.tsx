import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import {
  init, dispose, registerLocale,
  ActionType, IndicatorSeries, YAxisType, OverlayMode, LineType
} from 'klinecharts'
import type { Chart, Crosshair } from 'klinecharts'
import type { ChartAnnotation, ChartAnnotationPayload, KlineBar } from '../../lib/types'
import { EmptyState } from '../shared/Panel'
import { DrawingToolbar } from './DrawingToolbar'
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


export function KLineChartPanel({
  bars,
  annotations,
  drawingTool,
  onDrawComplete,
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

  onCrosshairBarRef.current = onCrosshairBar
  onCrosshairPositionRef.current = onCrosshairPosition

  const lastDrawIdRef = useRef<string | null>(null)
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null)
  const [showDrawingToolbar, setShowDrawingToolbar] = useState(false)
  const [toolbarPosition, setToolbarPosition] = useState({ x: 0, y: 0 })
  const [showMagnifier, setShowMagnifier] = useState(false)
  const [magnifierBar, setMagnifierBar] = useState<KlineBar | null>(null)
  const overlayIdsRef = useRef<string[]>([])
  const deltaHistoryRef = useRef<number[]>([])
  const drawingToolRef = useRef(drawingTool)
  drawingToolRef.current = drawingTool
  const crosshairPositionRef = useRef<'top-left' | 'top-right'>('top-right')

  const chartData = useMemo(
    () =>
      bars.map(bar => ({
        timestamp: new Date(`${bar.date}T00:00:00`).getTime(),
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: subChartType === 'amount' ? bar.amount : bar.volume,
        turnover: bar.amount
      })),
    [bars, subChartType]
  )

  useEffect(() => {
    latestBarsRef.current = bars
  }, [bars])

  // Chart initialization + crosshair subscription
  useEffect(() => {
    if (!hostRef.current || bars.length === 0) return
    const chart = init(hostRef.current, {
      locale: 'zh-CN',
      styles: {
        grid: {
          horizontal: { color: '#2a2a2a' },
          vertical: { color: '#262626' }
        },
        candle: {
          bar: {
            upColor: '#0d0d0d',
            upBorderColor: '#dc2626',
            upWickColor: '#dc2626',
            downColor: '#0f9f6e',
            downBorderColor: '#0f9f6e',
            downWickColor: '#0f9f6e',
            noChangeColor: '#737373',
            noChangeBorderColor: '#737373',
            noChangeWickColor: '#737373'
          }
        },
        yAxis: {
          inside: false,
          tickText: { show: true, color: '#888888', size: 9 } as never
        }
      }
    }) as Chart | null
    if (!chart) return
    chartRef.current = chart
    subPaneIdRef.current = null

    chart.setBarSpace(0.01)

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
      chart.unsubscribeAction(ActionType.OnCrosshairChange)
      chartRef.current = null
      subPaneIdRef.current = null
      if (hostRef.current) dispose(hostRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars.length])

  // Apply data and annotations
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    chart.applyNewData(chartData)
    chart.setBarSpace(0)
    chart.removeOverlay?.({ groupId: 'persisted' })
    annotations.forEach(annotation => {
      const overlay = annotationToOverlay(annotation)
      if (overlay) chart.createOverlay?.(overlay)
    })
  }, [annotations, chartData])

  // Drawing tool
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !drawingTool) return
    const idResult = chart.createOverlay?.(
      {
        name: drawingTool === 'horizontal_line' ? 'priceLine' : 'rayLine',
        groupId: 'drawing',
        mode: OverlayMode.WeakMagnet,
        modeSensitivity: 8,
        onDrawEnd: (event: unknown) => {
          const payload = eventToPayload(event, drawingTool, latestBarsRef.current)
          if (payload) {
            onDrawComplete(payload)
            const overlayId = Array.isArray(idResult) ? (idResult[0] ?? null) : (idResult ?? null)
            lastDrawIdRef.current = overlayId
            if (overlayId) {
              setSelectedOverlayId(overlayId)
              setShowDrawingToolbar(true)
              setToolbarPosition({ x: 100, y: 40 })
            }
          }
          return false
        }
      },
      'candle_pane'
    )
  }, [drawingTool, onDrawComplete])

  // MA overlay (MUST come before sub-chart to stay on candle_pane)
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    const enabledMas = (maLines ?? []).filter(ma => ma.enabled)
    const existing = chart.getIndicatorByPaneId?.('candle_pane', 'MA')
    if (existing) {
      chart.removeIndicator('candle_pane', 'MA')
    }

    if (enabledMas.length > 0) {
      chart.createIndicator?.(
        {
          name: 'MA',
          calcParams: enabledMas.map(ma => ma.period),
          styles: {
            lines: enabledMas.map(ma => ({
              color: ma.color, size: 1, style: LineType.Solid, smooth: false, dashedValue: []
            }))
          }
        } as never,
        false
      )
    }
  }, [maLines, bars.length])

  // Sub-chart indicator (VOL)
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

    const paneId = chart.createIndicator('VOL', false, { height: 120 })
    subPaneIdRef.current = paneId ?? null
  }, [subChartType, bars.length])

  // Log coordinate
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    chart.setStyles?.({
      yAxis: {
        type: coordType === 'log' ? YAxisType.Log : YAxisType.Normal
      }
    })
  }, [coordType, bars.length])

  // --- Magnifier: track crosshair velocity ---
  const crosshairTimestampRef = useRef(0)
  const originalOnCrosshairBarRef = useRef(onCrosshairBar)
  originalOnCrosshairBarRef.current = onCrosshairBar

  useEffect(() => {
    if (!drawingTool) {
      setShowMagnifier(false)
      setMagnifierBar(null)
    }
  }, [drawingTool, bars.length])

  // --- DrawingToolbar callbacks ---
  const handleColorChange = useCallback(
    (color: string) => {
      if (!selectedOverlayId) return
      const chart = chartRef.current
      if (!chart) return
      chart.overrideOverlay?.({ id: selectedOverlayId, styles: { line: { color } } } as never)
    },
    [selectedOverlayId]
  )

  const handleDeleteOverlay = useCallback(() => {
    if (!selectedOverlayId) return
    const chart = chartRef.current
    if (!chart) return
    chart.removeOverlay(selectedOverlayId)
    setSelectedOverlayId(null)
    setShowDrawingToolbar(false)
  }, [selectedOverlayId])

  const handleUndoOverlay = useCallback(() => {
    handleDeleteOverlay()
  }, [handleDeleteOverlay])

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

      {/* Sub-chart toggle */}
      <div className="absolute bottom-1 left-2 z-30 flex gap-0.5">
        <button type="button" onClick={() => onSubChartTypeChange?.('volume')}
          className={`h-5 px-1.5 text-[10px] font-mono transition ${subChartType === 'volume' ? 'bg-ring text-panel' : 'text-muted-foreground hover:text-foreground'}`}>
          成交量
        </button>
        <button type="button" onClick={() => onSubChartTypeChange?.('amount')}
          className={`h-5 px-1.5 text-[10px] font-mono transition ${subChartType === 'amount' ? 'bg-ring text-panel' : 'text-muted-foreground hover:text-foreground'}`}>
          成交额
        </button>
      </div>

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

type OverlayEvent = {
  overlay?: {
    points?: Array<{ timestamp?: number; value?: number }>
  }
}

function annotationToOverlay(annotation: ChartAnnotation) {
  if (annotation.annotationType === 'horizontal_line' && annotation.payload.type === 'horizontal_line') {
    return {
      name: 'priceLine',
      groupId: 'persisted',
      lock: true,
      points: [
        {
          timestamp: Date.now(),
          value: annotation.payload.price
        }
      ],
      extendData: annotation.payload.label
    }
  }
  if (annotation.annotationType === 'ray' && annotation.payload.type === 'ray') {
    return {
      name: 'rayLine',
      groupId: 'persisted',
      lock: true,
      points: [
        {
          timestamp: new Date(`${annotation.payload.start.date}T00:00:00`).getTime(),
          value: annotation.payload.start.price
        },
        {
          timestamp: new Date(`${annotation.payload.end.date}T00:00:00`).getTime(),
          value: annotation.payload.end.price
        }
      ],
      extendData: annotation.payload.label
    }
  }
  return null
}

function eventToPayload(
  event: unknown,
  drawingTool: 'horizontal_line' | 'ray',
  bars: KlineBar[]
): ChartAnnotationPayload | null {
  const points = (event as OverlayEvent)?.overlay?.points
  if (!points || points.length === 0) return null

  if (drawingTool === 'horizontal_line') {
    const price = points[0]?.value
    if (typeof price !== 'number') return null
    return { type: 'horizontal_line', price, label: '手动画线' }
  }

  const first = pointToBar(points[0], bars)
  const second = pointToBar(points[1], bars)
  if (!first || !second) return null
  const snapped = nearestHighLow(points[1]?.value, second.bar)
  return {
    type: 'ray',
    start: { date: first.bar.date, price: first.price },
    end: { date: second.bar.date, price: second.price },
    label: '手动画线',
    snappedTo: snapped
  }
}

function pointToBar(
  point: { timestamp?: number; value?: number } | undefined,
  bars: KlineBar[]
): { bar: KlineBar; price: number } | null {
  if (!point || typeof point.value !== 'number') return null
  const timestamp = point.timestamp ?? 0
  const found =
    bars.reduce<{ bar: KlineBar; diff: number } | null>((best, bar) => {
      const diff = Math.abs(new Date(`${bar.date}T00:00:00`).getTime() - timestamp)
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
