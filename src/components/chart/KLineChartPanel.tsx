import { useEffect, useMemo, useRef } from 'react'
import { init, dispose } from 'klinecharts'
import type { ChartAnnotation, ChartAnnotationPayload, KlineBar } from '../../lib/types'
import { EmptyState } from '../shared/Panel'

type ChartApi = {
  applyNewData: (data: unknown[]) => void
  createIndicator?: (...args: unknown[]) => unknown
  createOverlay?: (overlay: unknown) => unknown
  removeOverlay?: (filter?: unknown) => unknown
  setStyles?: (styles: unknown) => void
}

export function KLineChartPanel({
  bars,
  annotations,
  drawingTool,
  onDrawComplete
}: {
  bars: KlineBar[]
  annotations: ChartAnnotation[]
  drawingTool: 'horizontal_line' | 'ray' | null
  onDrawComplete: (payload: ChartAnnotationPayload) => void
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<ChartApi | null>(null)
  const latestBarsRef = useRef<KlineBar[]>(bars)

  const chartData = useMemo(
    () =>
      bars.map(bar => ({
        timestamp: new Date(`${bar.date}T00:00:00`).getTime(),
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        turnover: bar.amount
      })),
    [bars]
  )

  useEffect(() => {
    latestBarsRef.current = bars
  }, [bars])

  useEffect(() => {
    if (!hostRef.current || bars.length === 0) return
    const chart = init(hostRef.current, {
      styles: {
        grid: {
          horizontal: { color: '#2a2a2a' },
          vertical: { color: '#262626' }
        },
        candle: {
          bar: {
            upColor: '#0f9f6e',
            downColor: '#dc2626',
            noChangeColor: '#737373',
            upBorderColor: '#0f9f6e',
            downBorderColor: '#dc2626',
            noChangeBorderColor: '#737373',
            upWickColor: '#0f9f6e',
            downWickColor: '#dc2626',
            noChangeWickColor: '#737373'
          }
        }
      }
    }) as ChartApi
    chartRef.current = chart
    chart.createIndicator?.('VOL', false, { height: 120 })
    return () => {
      chartRef.current = null
      if (hostRef.current) dispose(hostRef.current)
    }
  }, [bars.length])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    chart.applyNewData(chartData)
    chart.removeOverlay?.({ groupId: 'persisted' })
    annotations.forEach(annotation => {
      const overlay = annotationToOverlay(annotation)
      if (overlay) chart.createOverlay?.(overlay)
    })
  }, [annotations, chartData])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !drawingTool) return
    chart.createOverlay?.({
      name: drawingTool === 'horizontal_line' ? 'priceLine' : 'rayLine',
      groupId: 'drawing',
      paneId: 'candle_pane',
      mode: 'weak_magnet',
      modeSensitivity: 8,
      onDrawEnd: (event: unknown) => {
        const payload = eventToPayload(event, drawingTool, latestBarsRef.current)
        if (payload) onDrawComplete(payload)
      }
    })
  }, [drawingTool, onDrawComplete])

  if (bars.length === 0) {
    return <EmptyState title="数据未就绪" detail="图表只读取本地 K 线库。请先在数据页显式同步。" />
  }

  return <div ref={hostRef} className="kline-chart-host h-[560px] w-full border border-border bg-panel" />
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
  const points = (event as { overlay?: { points?: Array<{ timestamp?: number; value?: number }> } })
    ?.overlay?.points
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

