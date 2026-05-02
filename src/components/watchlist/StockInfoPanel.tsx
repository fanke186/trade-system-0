import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { commands } from '../../lib/commands'
import { Badge } from '../shared/Badge'
import { cn } from '../../lib/cn'
import type { KlineCoverage, StockMeta, StockReview } from '../../lib/types'

export function StockInfoPanel({
  stockCode,
  selectedVersionId,
  meta: metaProp,
  reviews: reviewsProp,
  coverage: coverageProp,
  coverageLoading,
}: {
  stockCode: string
  selectedVersionId?: string
  meta?: StockMeta
  reviews?: StockReview[]
  coverage?: KlineCoverage
  coverageLoading?: boolean
}) {
  const queryClient = useQueryClient()

  const meta = useQuery({
    queryKey: ['stock-meta', stockCode],
    queryFn: () => commands.getStockMeta(stockCode),
    enabled: Boolean(stockCode) && metaProp === undefined
  })

  const reviews = useQuery({
    queryKey: ['stock-reviews', stockCode, selectedVersionId],
    queryFn: () => commands.getStockReviews(stockCode, selectedVersionId),
    enabled: Boolean(stockCode) && reviewsProp === undefined
  })
  const tradeSystems = useQuery({
    queryKey: ['trade-systems'],
    queryFn: commands.listTradeSystems
  })
  const coverage = useQuery({
    queryKey: ['coverage', stockCode],
    queryFn: () => commands.getDataCoverage(stockCode),
    enabled: Boolean(stockCode) && coverageProp === undefined,
    staleTime: 60_000
  })

  const syncMutation = useMutation({
    mutationFn: () => commands.refreshFromMarket(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['stock-meta', stockCode] })
      void queryClient.invalidateQueries({ queryKey: ['coverage', stockCode] })
      void queryClient.invalidateQueries({ queryKey: ['bars'] })
      void queryClient.invalidateQueries({ queryKey: ['data-health'] })
    }
  })

  const m = metaProp ?? meta.data
  const resolvedReviews = reviewsProp ?? reviews.data ?? []
  const resolvedCoverage = coverageProp ?? coverage.data
  const isCoverageLoading = coverageLoading ?? coverage.isLoading
  const needsLocalRefresh = !resolvedCoverage?.daily.rows && !isCoverageLoading
  const priceColor = !m?.change ? 'text-foreground'
    : m.change > 0 ? 'text-[#dc2626]' : 'text-[#0f9f6e]'
  const changeStr = m?.change != null
    ? `${m.change > 0 ? '+' : ''}${m.change.toFixed(2)} (${m.changePct != null ? (m.changePct > 0 ? '+' : '') + m.changePct.toFixed(2) + '%' : ''})`
    : ''

  return (
    <div className="flex h-full flex-col bg-panel/75">
      {/* Stock metadata card */}
      <div className="p-3 shadow-[0_1px_0_rgba(255,255,255,0.03)]">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="min-w-0 flex-1 truncate text-2xl font-semibold leading-7">{m?.name || stockCode}</span>
          {needsLocalRefresh && (
            <button
              className="px-1.5 py-0.5 bg-ring/20 text-ring font-mono text-[9px] hover:bg-ring hover:text-panel transition-all"
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
            >
              {syncMutation.isPending ? '刷新中...' : '刷新本地数据'}
            </button>
          )}
        </div>
        <div className="text-[10px] font-mono text-muted-foreground mb-2">
          {m?.symbol ?? stockCode}{m?.exchange ? ` · ${m.exchange}` : ''}{m?.board ? ` · ${m.board}` : ''}
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

      <div className="flex-1 overflow-y-auto p-3">
        <InfoSection title="交易状态">
          <div className="grid grid-cols-2 gap-1.5">
            <SignalPill label="趋势" value={describeTrend(m)} />
            <SignalPill label="量能" value={describeVolume(resolvedCoverage)} />
            <SignalPill label="数据" value={resolvedCoverage?.daily.rows ? '齐全' : '缺失'} />
            <SignalPill label="评分" value={latestScore(resolvedReviews)} />
          </div>
        </InfoSection>

        <InfoSection title="数据覆盖">
          {resolvedCoverage ? (
            <div className="space-y-1">
              <CoverageRow label="日K" rows={resolvedCoverage.daily.rows} start={resolvedCoverage.daily.startDate} end={resolvedCoverage.daily.endDate} />
              <CoverageRow label="周K" rows={resolvedCoverage.weekly.rows} start={resolvedCoverage.weekly.startDate} end={resolvedCoverage.weekly.endDate} />
              <CoverageRow label="月K" rows={resolvedCoverage.monthly.rows} start={resolvedCoverage.monthly.startDate} end={resolvedCoverage.monthly.endDate} />
              <CoverageRow label="季K" rows={resolvedCoverage.quarterly.rows} start={resolvedCoverage.quarterly.startDate} end={resolvedCoverage.quarterly.endDate} />
              <CoverageRow label="年K" rows={resolvedCoverage.yearly.rows} start={resolvedCoverage.yearly.startDate} end={resolvedCoverage.yearly.endDate} />
            </div>
          ) : (
            <p className="text-[10px] text-muted-foreground">{isCoverageLoading ? '加载中' : '暂无覆盖数据'}</p>
          )}
        </InfoSection>

        <InfoSection title="交易系统评价">
        {resolvedReviews.length > 0 ? (
          resolvedReviews.map(review => (
            <div key={review.id} className="mb-1.5 bg-muted/35 p-2 text-xs">
              <div className="flex items-center justify-between mb-1">
                <span className="min-w-0 truncate font-medium text-[11px]">
                  {tradeSystems.data?.find(system => system.id === review.tradeSystemId)?.name ?? '交易系统'}
                </span>
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
        </InfoSection>
      </div>
    </div>
  )
}

function InfoSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-4">
      <div className="mb-2 text-[10px] font-mono text-muted-foreground">{title}</div>
      {children}
    </section>
  )
}

function SignalPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border/70 bg-background/35 px-2 py-1.5">
      <div className="text-[9px] font-mono text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate text-[11px] font-medium text-foreground">{value}</div>
    </div>
  )
}

function CoverageRow({
  label,
  rows,
  start,
  end,
}: {
  label: string
  rows: number
  start?: string | null
  end?: string | null
}) {
  return (
    <div className="grid grid-cols-[2.4rem_3rem_1fr] gap-1 text-[10px] font-mono">
      <span className="text-muted-foreground">{label}</span>
      <span className={rows > 0 ? 'text-success' : 'text-danger'}>{rows}条</span>
      <span className="truncate text-right text-muted-foreground">
        {start && end ? `${start} ~ ${end}` : '-'}
      </span>
    </div>
  )
}

function describeTrend(meta?: StockMeta) {
  const pct = meta?.changePct
  if (pct == null) return '-'
  if (pct >= 3) return '强势'
  if (pct > 0) return '偏强'
  if (pct <= -3) return '弱势'
  if (pct < 0) return '偏弱'
  return '震荡'
}

function describeVolume(coverage?: KlineCoverage) {
  if (!coverage?.daily.rows) return '-'
  if (coverage.daily.rows >= 250) return '充足'
  if (coverage.daily.rows >= 60) return '可用'
  return '不足'
}

function latestScore(reviews: StockReview[]) {
  const review = reviews.find(item => item.score != null)
  return review?.score != null ? String(review.score) : '-'
}
