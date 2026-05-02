import { useState } from 'react'
import { ArrowDown, ArrowUp, Minus, Trash2 } from 'lucide-react'
import { cn } from '../../lib/cn'
import type { TradeSystemStock } from '../../lib/types'

type SortKey = 'code' | 'name' | 'changePct' | 'latestScore'
type SortState = { key: SortKey; direction: 'asc' | 'desc' }

const columns: Array<{ key: SortKey; label: string; className?: string }> = [
  { key: 'code', label: '代码', className: 'w-[82px]' },
  { key: 'name', label: '名称' },
  { key: 'changePct', label: '涨跌', className: 'w-[74px] text-right' },
  { key: 'latestScore', label: '评分', className: 'w-[66px] text-right' }
]

export function StockTable({
  stocks,
  selectedSymbol,
  onSelect,
  onRemove
}: {
  stocks: TradeSystemStock[]
  selectedSymbol?: string
  onSelect: (symbol: string) => void
  onRemove: (stock: TradeSystemStock) => void
}) {
  const [sort, setSort] = usePersistentSort()
  const sorted = [...stocks].sort((a, b) => compareStocks(a, b, sort))

  return (
    <section className="flex min-h-0 w-[360px] shrink-0 flex-col border-r border-border bg-background">
      <div className="flex h-12 shrink-0 items-center border-b border-border px-3">
        <div className="font-mono text-sm font-semibold">关联标的</div>
        <span className="ml-2 text-xs text-muted-foreground">{stocks.length}</span>
      </div>

      <div className="grid grid-cols-[82px_minmax(72px,1fr)_74px_66px_34px] border-b border-border px-3 py-2 text-[11px] font-medium text-muted-foreground">
        {columns.map(column => (
          <button
            className={cn('flex items-center gap-1 text-left font-mono', column.className)}
            key={column.key}
            onClick={() =>
              setSort(previous => ({
                key: column.key,
                direction:
                  previous.key === column.key && previous.direction === 'desc' ? 'asc' : 'desc'
              }))
            }
            type="button"
          >
            <span>{column.label}</span>
            {sort.key === column.key ? (
              sort.direction === 'desc' ? (
                <ArrowDown className="h-3 w-3" />
              ) : (
                <ArrowUp className="h-3 w-3" />
              )
            ) : null}
          </button>
        ))}
        <span />
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {sorted.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">
            暂无关联标的。可在 K线数据页批量加入交易系统。
          </div>
        ) : (
          sorted.map(stock => (
            <button
              className={cn(
                'grid min-h-11 w-full grid-cols-[82px_minmax(72px,1fr)_74px_66px_34px] items-center border-b border-border/70 px-3 text-left text-xs transition',
                selectedSymbol === stock.symbol ? 'bg-ring/10 text-foreground' : 'hover:bg-muted/40'
              )}
              key={stock.id}
              onClick={() => onSelect(stock.symbol)}
              type="button"
            >
              <span className="font-mono text-muted-foreground">{stock.code || stock.symbol}</span>
              <span className="truncate font-medium">{stock.name || stock.symbol}</span>
              <span className={cn('text-right font-mono', changeClass(stock.changePct))}>
                {formatPct(stock.changePct)}
              </span>
              <span className={cn('text-right font-mono', scoreClass(stock.latestScore))}>
                {stock.latestScore ?? <Minus className="ml-auto h-3.5 w-3.5 text-muted-foreground" />}
              </span>
              <span
                className="ml-auto inline-flex h-7 w-7 items-center justify-center text-muted-foreground hover:bg-danger/20 hover:text-danger"
                onClick={event => {
                  event.stopPropagation()
                  onRemove(stock)
                }}
                role="button"
                title="移除关联"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </span>
            </button>
          ))
        )}
      </div>
    </section>
  )
}

function usePersistentSort() {
  return useState<SortState>({ key: 'latestScore', direction: 'desc' })
}

function compareStocks(a: TradeSystemStock, b: TradeSystemStock, sort: SortState) {
  const modifier = sort.direction === 'asc' ? 1 : -1
  const av = valueForSort(a, sort.key)
  const bv = valueForSort(b, sort.key)
  if (typeof av === 'number' && typeof bv === 'number') {
    return (av - bv) * modifier
  }
  return String(av).localeCompare(String(bv), 'zh-CN') * modifier
}

function valueForSort(stock: TradeSystemStock, key: SortKey) {
  if (key === 'latestScore') return stock.latestScore ?? -1
  if (key === 'changePct') return stock.changePct ?? -999
  if (key === 'name') return stock.name ?? ''
  return stock.code ?? stock.symbol
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
