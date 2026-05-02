import type { KlineBar } from '../../lib/types'

export function CrosshairTooltip({
  bar,
  position,
}: {
  bar: KlineBar | null
  position: 'top-left' | 'top-right'
}) {
  if (!bar) return null

  const prevClose = bar.preClose ?? bar.open
  const valueColor = (value: number) => {
    if (value > prevClose) return 'text-[#dc2626]'
    if (value < prevClose) return 'text-[#0f9f6e]'
    return 'text-muted-foreground'
  }
  const changeColor = (bar.change ?? 0) > 0
    ? 'text-[#dc2626]'
    : (bar.change ?? 0) < 0
      ? 'text-[#0f9f6e]'
      : 'text-muted-foreground'

  const positionClass = position === 'top-right' ? 'right-2 top-2' : 'left-2 top-2'

  return (
    <div
      className={`pointer-events-none absolute ${positionClass} z-40 min-w-36 border border-border px-3 py-2 text-xs leading-5`}
      style={{ backgroundColor: 'rgba(13,13,13,0.88)' }}
    >
      <div className="grid grid-cols-[4rem_1fr] gap-x-2 font-mono">
        <span className="text-muted-foreground">日期</span>
        <span className="text-right text-foreground">{bar.date}</span>

        <span className="text-muted-foreground">开盘</span>
        <span className={`text-right ${valueColor(bar.open)}`}>{bar.open.toFixed(2)}</span>

        <span className="text-muted-foreground">最高</span>
        <span className={`text-right ${valueColor(bar.high)}`}>{bar.high.toFixed(2)}</span>

        <span className="text-muted-foreground">最低</span>
        <span className={`text-right ${valueColor(bar.low)}`}>{bar.low.toFixed(2)}</span>

        <span className="text-muted-foreground">收盘</span>
        <span className={`text-right ${valueColor(bar.close)}`}>{bar.close.toFixed(2)}</span>

        <span className="text-muted-foreground">涨幅</span>
        <span className={`text-right ${changeColor}`}>
          {bar.changePct != null ? `${bar.changePct > 0 ? '+' : ''}${bar.changePct.toFixed(2)}%` : bar.preClose ? `${((bar.close - bar.preClose) / bar.preClose * 100).toFixed(2)}%` : '-'}
        </span>

        <span className="text-muted-foreground">振幅</span>
        <span className="text-right text-foreground">
          {bar.amplitude != null ? `${bar.amplitude.toFixed(2)}%` : bar.preClose ? `${((bar.high - bar.low) / bar.preClose * 100).toFixed(2)}%` : '-'}
        </span>

        <span className="text-muted-foreground">成交量</span>
        <span className="text-right text-foreground">
          {new Intl.NumberFormat('zh-CN').format(Math.round(bar.volume / 10000))}万
        </span>

        <span className="text-muted-foreground">成交额</span>
        <span className="text-right text-foreground">
          {new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(bar.amount / 100000000)}亿
        </span>

        <span className="text-muted-foreground">换手率</span>
        <span className="text-right text-foreground">
          {bar.turnover ? `${bar.turnover.toFixed(2)}%` : '-'}
        </span>
      </div>
    </div>
  )
}
