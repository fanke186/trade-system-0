import type { KlineBar } from '../../lib/types'

export type KLineChartAdapterBar = {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  turnover: number
}

export type KLineChartModel = {
  bars: KlineBar[]
  adapterBars: KLineChartAdapterBar[]
}

export function buildKLineChartModel(
  bars: KlineBar[],
  maLines: Array<{ period: number; enabled: boolean }> = []
): KLineChartModel {
  const enabledPeriods = maLines
    .filter(line => line.enabled && Number.isFinite(line.period) && line.period > 0)
    .map(line => line.period)

  const sums = new Map<number, number>()
  const modelBars = bars.map((bar, index) => {
    const ma: Record<string, number | null> = {}
    enabledPeriods.forEach(period => {
      const nextSum = (sums.get(period) ?? 0) + bar.close
      sums.set(period, nextSum)
      if (index >= period - 1) {
        ma[`MA${period}`] = nextSum / period
        sums.set(period, nextSum - (bars[index - period + 1]?.close ?? 0))
      } else {
        ma[`MA${period}`] = null
      }
    })
    return Object.keys(ma).length > 0 ? { ...bar, ma } : bar
  })

  return {
    bars: modelBars,
    adapterBars: modelBars.map(bar => ({
      timestamp: tradeDateToTimestamp(bar.date),
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
      turnover: bar.amount,
    })),
  }
}

export function tradeDateToTimestamp(date: string) {
  return new Date(`${date}T00:00:00+08:00`).getTime()
}
