import type { ReactNode } from 'react'
import { ExternalLink, FileText, Gauge, Info, Lightbulb } from 'lucide-react'
import { Badge } from '../shared/Badge'
import { Button } from '../shared/Button'
import { cn } from '../../lib/cn'
import type { TradeSystemStock } from '../../lib/types'

type ParsedReport = {
  overallEvaluation?: string
  tradePlan?: unknown
  rating?: string
  createdAt?: string
}

export function StockEvaluation({ stock }: { stock?: TradeSystemStock }) {
  if (!stock) {
    return (
      <section className="min-h-0 flex-1 bg-background">
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          请选择一个关联标的
        </div>
      </section>
    )
  }

  const report = parseReport(stock.latestReport)
  const score = stock.latestScore
  const reportPath = stock.latestReportPath

  return (
    <section className="min-h-0 flex-1 overflow-auto bg-background">
      <div className="mx-auto grid max-w-5xl gap-4 p-4">
        <div className="border border-border bg-panel">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-mono text-2xl font-semibold tracking-normal">{stock.name}</h1>
                <Badge tone="info">{stock.symbol}</Badge>
                {stock.industry ? <Badge>{stock.industry}</Badge> : null}
              </div>
              <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
                <span>代码 {stock.code}</span>
                <span>交易所 {stock.exchange ?? '-'}</span>
                <span>评分日 {stock.latestScoreDate ?? '-'}</span>
              </div>
            </div>
            <div className="text-right font-mono">
              <div className="text-sm text-muted-foreground">最新价</div>
              <div className="text-2xl text-foreground">{formatPrice(stock.latestPrice)}</div>
              <div className={cn('text-sm', changeClass(stock.changePct))}>{formatPct(stock.changePct)}</div>
            </div>
          </div>

          <div className="grid gap-4 p-4 lg:grid-cols-[240px_1fr]">
            <div className="border border-border bg-background/50 p-4">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Gauge className="h-4 w-4" />
                总评分
              </div>
              <div className={cn('mt-4 font-mono text-6xl font-semibold leading-none', scoreClass(score))}>
                {score ?? '--'}
              </div>
              <div className="mt-4 h-2 bg-muted">
                <div
                  className={cn('h-2', scoreBarClass(score))}
                  style={{ width: `${Math.max(0, Math.min(100, score ?? 0))}%` }}
                />
              </div>
              <div className="mt-3 text-xs text-muted-foreground">{scoreLabel(score)}</div>
            </div>

            <div className="grid gap-4">
              <InfoBlock
                icon={<Info className="h-4 w-4" />}
                title="摘要"
                value={report.overallEvaluation || summarizeRawReport(stock.latestReport)}
              />
              <InfoBlock
                icon={<Lightbulb className="h-4 w-4" />}
                title="推荐明日操作"
                value={extractTomorrowAction(report.tradePlan)}
              />
              <div className="flex flex-wrap items-center justify-between gap-3 border border-border bg-background/50 p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium">评分报告</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {reportPath ?? '尚未生成 HTML 报告'}
                    </div>
                  </div>
                </div>
                <Button
                  disabled={!reportPath}
                  icon={<ExternalLink className="h-4 w-4" />}
                  onClick={() => openReport(reportPath)}
                >
                  打开
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div className="border border-border bg-panel p-4">
          <div className="mb-2 font-mono text-sm font-semibold">其他信息</div>
          <div className="text-xs leading-6 text-muted-foreground">
            预留区域。可后续加入历史评分曲线、风险预算消耗、近期信号命中和人工备注。
          </div>
        </div>
      </div>
    </section>
  )
}

function InfoBlock({
  icon,
  title,
  value
}: {
  icon: ReactNode
  title: string
  value?: string
}) {
  return (
    <div className="border border-border bg-background/50 p-4">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
        {icon}
        {title}
      </div>
      <p className="text-sm leading-7 text-foreground">{value || '暂无评分内容'}</p>
    </div>
  )
}

function parseReport(value?: string | null): ParsedReport {
  if (!value) return {}
  try {
    return JSON.parse(value) as ParsedReport
  } catch {
    return { overallEvaluation: value }
  }
}

function summarizeRawReport(value?: string | null) {
  if (!value) return ''
  return value.length > 220 ? `${value.slice(0, 220)}...` : value
}

function extractTomorrowAction(tradePlan: unknown) {
  if (!tradePlan) return '暂无明确操作建议'
  if (typeof tradePlan === 'string') return tradePlan
  if (typeof tradePlan !== 'object') return '暂无明确操作建议'
  const plan = tradePlan as Record<string, unknown>
  const candidates = [
    plan.tomorrow_action,
    plan.tomorrowAction,
    plan.next_day_action,
    plan.nextDayAction,
    plan.recommendation,
    plan.action,
    plan.setup,
    plan.entry,
    plan.invalidation
  ]
  const text = candidates.find(item => typeof item === 'string' && item.trim().length > 0)
  if (typeof text === 'string') return text
  return JSON.stringify(tradePlan)
}

function openReport(path?: string | null) {
  if (!path) return
  const url = /^https?:\/\//.test(path) || path.startsWith('file://') ? path : `file://${path}`
  window.open(url, '_blank', 'noopener,noreferrer')
}

function formatPrice(value?: number | null) {
  if (value == null) return '-'
  return value.toFixed(2)
}

function formatPct(value?: number | null) {
  if (value == null) return '-'
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
}

function changeClass(value?: number | null) {
  if (value == null || value === 0) return 'text-muted-foreground'
  return value > 0 ? 'text-success' : 'text-danger'
}

function scoreClass(value?: number | null) {
  if (value == null) return 'text-muted-foreground'
  if (value >= 80) return 'text-info'
  if (value >= 60) return 'text-success'
  if (value >= 40) return 'text-warning'
  return 'text-danger'
}

function scoreBarClass(value?: number | null) {
  if (value == null) return 'bg-muted'
  if (value >= 80) return 'bg-info'
  if (value >= 60) return 'bg-success'
  if (value >= 40) return 'bg-warning'
  return 'bg-danger'
}

function scoreLabel(value?: number | null) {
  if (value == null) return '尚未评分'
  if (value >= 80) return '强信号，可进入重点观察'
  if (value >= 60) return '结构较好，等待确认'
  if (value >= 40) return '中性，条件不足'
  if (value >= 20) return '偏弱，谨慎处理'
  return '风险较高'
}
