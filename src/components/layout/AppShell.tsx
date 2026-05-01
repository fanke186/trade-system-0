import type { ReactNode } from 'react'
import { CircleDot, Database, Server } from 'lucide-react'
import { routes, type PageId } from '../../app/routes'
import type { KlineCoverage, ModelProvider, StockReview, TradeSystemSummary } from '../../lib/types'
import { cn } from '../../lib/cn'
import { Badge } from '../shared/Badge'
import { formatDateTime, formatRows, jsonPreview } from '../../lib/format'

export function AppShell({
  activePage,
  onPageChange,
  tradeSystems,
  activeProvider,
  coverage,
  stockCode,
  selectedVersionId,
  latestReview,
  children
}: {
  activePage: PageId
  onPageChange: (page: PageId) => void
  tradeSystems: TradeSystemSummary[]
  activeProvider?: ModelProvider
  coverage?: KlineCoverage
  stockCode: string
  selectedVersionId?: string
  latestReview?: StockReview
  children: ReactNode
}) {
  const selectedSystem = tradeSystems.find(system => system.activeVersionId === selectedVersionId)

  return (
    <div className="grid h-screen grid-cols-[220px_minmax(680px,1fr)_320px] grid-rows-[48px_1fr] bg-background">
      <aside className="row-span-2 border-r border-border bg-panel">
        <div className="flex h-12 items-center gap-2 border-b border-border px-4">
          <CircleDot className="h-4 w-4 text-accent" />
          <div className="text-sm font-semibold">trade-system-0</div>
        </div>
        <nav className="p-2">
          {routes.map(route => {
            const Icon = route.icon
            return (
              <button
                className={cn(
                  'mb-1 flex h-9 w-full items-center gap-2 px-3 text-left text-sm transition',
                  activePage === route.id
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
                key={route.id}
                onClick={() => onPageChange(route.id)}
                type="button"
              >
                <Icon className="h-4 w-4" />
                {route.label}
              </button>
            )
          })}
        </nav>
      </aside>

      <header className="col-span-2 flex items-center justify-between border-b border-border bg-panel px-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>交易系统</span>
          <Badge tone={selectedVersionId ? 'success' : 'warning'}>
            {selectedSystem
              ? `${selectedSystem.name} v${selectedSystem.activeVersion ?? '-'}`
              : selectedVersionId
                ? selectedVersionId
                : '未选择'}
          </Badge>
          <span>Provider</span>
          <Badge tone={activeProvider ? 'accent' : 'warning'}>{activeProvider?.name ?? '未配置'}</Badge>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Database className="h-3.5 w-3.5" />
            {stockCode || '未输入股票'}
          </span>
          <span className="inline-flex items-center gap-1">
            <Server className="h-3.5 w-3.5" />
            日 {formatRows(coverage?.daily.rows)} / 周 {formatRows(coverage?.weekly.rows)} / 月{' '}
            {formatRows(coverage?.monthly.rows)}
          </span>
        </div>
      </header>

      <main className="overflow-auto p-4">{children}</main>

      <aside className="overflow-auto border-l border-border bg-panel">
        <div className="border-b border-border px-4 py-3">
          <div className="text-xs font-medium text-muted-foreground">当前股票</div>
          <div className="mt-1 text-lg font-semibold">{stockCode || '-'}</div>
        </div>
        <div className="border-b border-border px-4 py-3">
          <div className="text-xs font-medium text-muted-foreground">K 线覆盖</div>
          <dl className="mt-2 grid gap-1 text-xs">
            <ContextRow label="日 K" value={coverageText(coverage?.daily)} />
            <ContextRow label="周 K" value={coverageText(coverage?.weekly)} />
            <ContextRow label="月 K" value={coverageText(coverage?.monthly)} />
            <ContextRow label="最近同步" value={formatDateTime(coverage?.lastSyncAt)} />
          </dl>
        </div>
        <div className="px-4 py-3">
          <div className="text-xs font-medium text-muted-foreground">最近评分</div>
          {latestReview ? (
            <div className="mt-2 grid gap-2 text-xs">
              <div className="flex items-center gap-2">
                <Badge tone={latestReview.score ? 'success' : 'warning'}>
                  {latestReview.score ?? '-'} / 100
                </Badge>
                <Badge>{latestReview.rating}</Badge>
              </div>
              <p className="leading-5 text-muted-foreground">{latestReview.overallEvaluation}</p>
              <pre className="max-h-64 overflow-auto bg-muted p-2 text-[11px] leading-4">
                {jsonPreview(latestReview.tradePlan)}
              </pre>
            </div>
          ) : (
            <p className="mt-2 text-xs leading-5 text-muted-foreground">暂无评分记录</p>
          )}
        </div>
      </aside>
    </div>
  )
}

function ContextRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate text-right text-foreground">{value}</dd>
    </div>
  )
}

function coverageText(item?: KlineCoverage['daily']) {
  if (!item || item.rows === 0) return '无数据'
  return `${item.startDate ?? '-'} 至 ${item.endDate ?? '-'} (${formatRows(item.rows)})`
}

