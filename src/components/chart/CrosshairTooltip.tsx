import type { KlineBar } from '../../lib/types'

export function CrosshairTooltip({
  bar,
  position,
}: {
  bar: KlineBar | null
  position: 'top-left' | 'top-right'
}) {
  if (!bar) return null

  const isUp = bar.close >= bar.open
  const textColor = isUp ? 'text-success' : 'text-danger'

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
        <span className="text-right text-foreground">{bar.open.toFixed(2)}</span>

        <span className="text-muted-foreground">最高</span>
        <span className={`text-right ${textColor}`}>{bar.high.toFixed(2)}</span>

        <span className="text-muted-foreground">最低</span>
        <span className={`text-right ${textColor}`}>{bar.low.toFixed(2)}</span>

        <span className="text-muted-foreground">收盘</span>
        <span className={`text-right ${textColor}`}>{bar.close.toFixed(2)}</span>

        <span className="text-muted-foreground">涨幅</span>
        <span className={`text-right ${textColor}`}>
          {bar.preClose
            ? `${((bar.close - bar.preClose) / bar.preClose * 100).toFixed(2)}%`
            : '-'}
        </span>

        <span className="text-muted-foreground">振幅</span>
        <span className="text-right text-foreground">
          {bar.preClose
            ? `${((bar.high - bar.low) / bar.preClose * 100).toFixed(2)}%`
            : '-'}
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
