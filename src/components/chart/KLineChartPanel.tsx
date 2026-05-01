import { useEffect, useMemo, useRef } from 'react'
import {
  init, dispose, registerLocale, registerIndicator,
  ActionType, IndicatorSeries, YAxisType, OverlayMode, LineType
} from 'klinecharts'
import type { Chart, Crosshair } from 'klinecharts'
import type { ChartAnnotation, ChartAnnotationPayload, KlineBar } from '../../lib/types'
import { EmptyState } from '../shared/Panel'

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

registerIndicator({
  name: 'AMOUNT',
  shortName: 'AMOUNT',
  series: IndicatorSeries.Volume,
  calc: (dataList: Array<Record<string, unknown>>) =>
    dataList.map(k => ({ amount: (k.turnover as number) || 0 })),
  figures: [{ key: 'amount', title: '成交额', type: 'bar' }]
})

export function KLineChartPanel({
  bars,
  annotations,
  drawingTool,
  onDrawComplete,
  subChartType,
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
    }) as Chart | null
    if (!chart) return
    chartRef.current = chart
    subPaneIdRef.current = null

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

      if (crosshair.realX != null && hostRef.current) {
        const mid = hostRef.current.clientWidth / 4
        onCrosshairPositionRef.current?.(crosshair.realX < mid ? 'top-right' : 'top-left')
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
    chart.createOverlay?.(
      {
        name: drawingTool === 'horizontal_line' ? 'priceLine' : 'rayLine',
        groupId: 'drawing',
        mode: OverlayMode.WeakMagnet,
        modeSensitivity: 8,
        onDrawEnd: (event: unknown) => {
          const payload = eventToPayload(event, drawingTool, latestBarsRef.current)
          if (payload) onDrawComplete(payload)
          return false
        }
      },
      'candle_pane'
    )
  }, [drawingTool, onDrawComplete])

  // Sub-chart indicator (VOL / AMOUNT)
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

    const name = subChartType === 'amount' ? 'AMOUNT' : 'VOL'
    const paneId = chart.createIndicator(name, false, { height: 120 })
    subPaneIdRef.current = paneId ?? null
  }, [subChartType, bars.length])

  // MA overlay
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    const existing = chart.getIndicatorByPaneId?.('candle_pane', 'MA')
    if (existing) {
      chart.removeIndicator('candle_pane', 'MA')
    }

    ;(maLines ?? [])
      .filter(ma => ma.enabled)
      .forEach(ma => {
        chart.createIndicator?.(
          {
            name: 'MA',
            calcParams: [ma.period],
            styles: {
              lines: [{ color: ma.color, size: 1, style: LineType.Solid, smooth: false, dashedValue: [] }]
            }
          },
          true
        )
      })
  }, [maLines, bars.length])

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

  if (bars.length === 0) {
    return <EmptyState title="数据未就绪" detail="图表只读取本地 K 线库。请先在数据页显式同步。" />
  }

  return <div ref={hostRef} className="kline-chart-host w-full h-full" />
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
