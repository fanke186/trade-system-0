import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { commands } from '../../lib/commands'
import { Badge } from '../shared/Badge'
import { cn } from '../../lib/cn'

export function StockInfoPanel({
  stockCode,
  selectedVersionId
}: {
  stockCode: string
  selectedVersionId?: string
}) {
  const queryClient = useQueryClient()

  const meta = useQuery({
    queryKey: ['stock-meta', stockCode],
    queryFn: () => commands.getStockMeta(stockCode),
    enabled: Boolean(stockCode)
  })

  const reviews = useQuery({
    queryKey: ['stock-reviews', stockCode, selectedVersionId],
    queryFn: () => commands.getStockReviews(stockCode, selectedVersionId),
    enabled: Boolean(stockCode)
  })

  const syncMutation = useMutation({
    mutationFn: () => commands.syncKline(stockCode, 'incremental'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['stock-meta', stockCode] })
      void queryClient.invalidateQueries({ queryKey: ['coverage', stockCode] })
    }
  })

  const m = meta.data
  const priceColor = !m?.change ? 'text-foreground'
    : m.change > 0 ? 'text-[#0f9f6e]' : 'text-[#dc2626]'
  const changeStr = m?.change != null
    ? `${m.change > 0 ? '+' : ''}${m.change.toFixed(2)} (${m.changePct != null ? (m.changePct > 0 ? '+' : '') + m.changePct.toFixed(2) + '%' : ''})`
    : ''

  return (
    <div className="flex h-full flex-col bg-panel/75">
      {/* Stock metadata card */}
      <div className="p-3 shadow-[0_1px_0_rgba(255,255,255,0.03)]">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-base font-semibold">{m?.name || stockCode}</span>
          {m?.stale && (
            <button
              className="px-1.5 py-0.5 bg-ring/20 text-ring font-mono text-[9px] hover:bg-ring hover:text-panel transition-all"
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
            >
              {syncMutation.isPending ? '同步中...' : '更新'}
            </button>
          )}
        </div>
        <div className="text-[10px] font-mono text-muted-foreground mb-2">
          {stockCode}{m?.exchange ? ` · ${m.exchange}` : ''}
        </div>
        {m?.latestPrice != null ? (
          <>
            <div className={cn('text-xl font-bold font-mono', priceColor)}>
              {m.latestPrice.toFixed(2)}
            </div>
            <div className={cn('font-mono text-[11px]', priceColor)}>
              {changeStr}
            </div>
          </>
        ) : (
          <div className="text-muted-foreground text-xs">暂无行情数据</div>
        )}
        {m?.latestDate && (
          <div className="text-[10px] font-mono text-muted-foreground mt-1">{m.latestDate}</div>
        )}
      </div>

      {/* Trade system evaluations */}
      <div className="flex-1 overflow-y-auto p-3">
        <div className="text-[10px] font-mono text-muted-foreground mb-2">交易系统评价</div>
        {(reviews.data ?? []).length > 0 ? (
          reviews.data!.map(review => (
            <div key={review.id} className="mb-1.5 bg-muted/35 p-2 text-xs">
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-[11px]">交易系统</span>
                <Badge tone={review.rating === 'focus' ? 'success' : review.rating === 'reject' ? 'danger' : 'warning'}>
                  {review.rating}
                </Badge>
              </div>
              <p className="text-[10px] text-muted-foreground leading-relaxed line-clamp-3">
                {review.overallEvaluation}
              </p>
            </div>
          ))
        ) : (
          <p className="text-[10px] text-muted-foreground">暂无交易系统纳入</p>
        )}
      </div>
    </div>
  )
}
