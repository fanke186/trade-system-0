import type { KlineBar, SnapTarget } from '../../lib/types'

const OHLC_LABELS: Array<{ key: keyof KlineBar; label: string }> = [
  { key: 'open', label: '开' },
  { key: 'high', label: '高' },
  { key: 'low', label: '低' },
  { key: 'close', label: '收' },
]

export function Magnifier({
  bar,
  position,
  mousePrice,
  snapTarget,
}: {
  bar: KlineBar
  position: 'top-left' | 'top-right'
  mousePrice?: number | null
  snapTarget?: SnapTarget | null
}) {
  const posClass = position === 'top-left' ? 'left-2 top-2' : 'right-2 top-2'
  const priceRange = bar.high - bar.low || 0.01
  const mousePct = mousePrice != null ? (mousePrice - bar.low) / priceRange : null

  return (
    <div className={`absolute z-50 ${posClass} border border-border/80 bg-background/92 backdrop-blur-sm px-2.5 py-2 font-mono text-[11px] shadow-lg`} style={{ width: 168 }}>
      {/* Date */}
      <div className="text-muted-foreground mb-1.5 text-[10px]">{bar.date}</div>

      {/* OHLC rows */}
      {OHLC_LABELS.map(({ key, label }) => {
        const value = bar[key] as number
        const isSnapped = snapTarget === key
        return (
          <div
            key={key}
            className={'flex justify-between leading-relaxed' + (isSnapped ? ' text-ring' : ' text-foreground')}
          >
            <span className="text-muted-foreground">{label}</span>
            <span>{value.toFixed(2)}</span>
          </div>
        )
      })}

      {/* Mouse price */}
      {mousePrice != null && (
        <div className="mt-1 border-t border-border/50 pt-1 flex justify-between leading-relaxed text-warning">
          <span className="text-muted-foreground">当前</span>
          <span>{mousePrice.toFixed(2)}</span>
        </div>
      )}

      {/* Snap indicator */}
      {snapTarget && (
        <div className="mt-0.5 text-[10px] text-ring">
          吸附: {snapTarget} {bar[snapTarget]?.toFixed(2)}
        </div>
      )}

      {/* Mini price ruler */}
      <div className="mt-1.5 relative h-16 bg-muted/30">
        {/* Ticks */}
        {[0, 0.25, 0.5, 0.75, 1].map(pct => {
          const price = bar.low + priceRange * (1 - pct)
          return (
            <div
              key={pct}
              className="absolute left-0 right-0 flex items-center"
              style={{ top: `${pct * 100}%` }}
            >
              <span className="text-[8px] text-muted-foreground ml-0.5 leading-none">{price.toFixed(2)}</span>
              <span className="flex-1 border-t border-border/40 mx-1" />
            </div>
          )
        })}
        {/* Mouse indicator on ruler */}
        {mousePct != null && mousePct >= 0 && mousePct <= 1 && (
          <div
            className="absolute left-0 right-0 h-px bg-warning"
            style={{ top: `${(1 - mousePct) * 100}%` }}
          />
        )}
      </div>
    </div>
  )
}
