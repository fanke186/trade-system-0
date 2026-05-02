import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, RefreshCw, RotateCcw, Search } from 'lucide-react'
import { listen } from '@tauri-apps/api/event'
import { cn } from '../lib/cn'
import { Panel } from '../components/shared/Panel'
import { Button } from '../components/shared/Button'
import { Badge } from '../components/shared/Badge'
import { Field, Input } from '../components/shared/Field'
import { DataTable, Td } from '../components/shared/DataTable'
import { commands } from '../lib/commands'
import { formatNumber, toErrorMessage } from '../lib/format'
import type { Security, TradeSystemSummary, Watchlist } from '../lib/types'

function DataHealthBanner() {
  const queryClient = useQueryClient()
  const [progress, setProgress] = useState(0)
  const health = useQuery({
    queryKey: ['data-health'],
    queryFn: () => commands.getDataHealth(),
    refetchInterval: 30000
  })
  const refreshMutation = useMutation({
    mutationFn: () => commands.refreshFromMarket(),
    onMutate: () => setProgress(0),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['data-health'] })
      void queryClient.invalidateQueries({ queryKey: ['securities'] })
      void queryClient.invalidateQueries({ queryKey: ['stock-meta'] })
      void queryClient.invalidateQueries({ queryKey: ['bars'] })
    }
  })

  useEffect(() => {
    const unlisten = listen<{
      stockCode: string
      status: string
      percent: number
      message?: string
    }>('kline-sync-progress', event => {
      if (event.payload.stockCode === '') {
        setProgress(event.payload.percent)
      }
    })
    return () => {
      void unlisten.then(f => f())
    }
  }, [])

  const h = health.data
  const moodMap: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' }> = {
    good: { label: '良好', tone: 'success' },
    ok: { label: '一般', tone: 'warning' },
    bad: { label: '较差', tone: 'danger' }
  }
  const mood = moodMap[h?.mood ?? 'ok']

  return (
    <div className="border border-border bg-panel p-4">
      {h ? (
        <div className="flex items-center gap-5">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <span>{'数据齐整度'}</span>
              <span className="font-mono">{h.completenessPct.toFixed(1)}%</span>
              <Badge tone={mood.tone}>{mood.label}</Badge>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {'共'} {h.totalSecurities.toLocaleString()} {'只标的'} · {h.completeCount.toLocaleString()} {'只齐全'} · {h.incompleteCount.toLocaleString()} {'只待同步'}
            </div>
            {h.byMarket.length > 0 && (
              <div className="flex gap-2 mt-1.5 flex-wrap">
                {h.byMarket.slice(0, 5).map(m => (
                  <span key={m.marketType} className="text-[10px] font-mono text-muted-foreground">
                    {m.marketType || '未知'}: {m.complete}/{m.total}
                  </span>
                ))}
              </div>
            )}
          </div>
          <Button
            variant="secondary"
            icon={<RefreshCw className={cn('h-4 w-4', refreshMutation.isPending && 'animate-spin')} />}
            disabled={refreshMutation.isPending}
            onClick={() => refreshMutation.mutate()}
          >
            {refreshMutation.isPending ? `同步中 ${progress}%` : '一键补齐'}
          </Button>
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">{'加载中...'}</div>
      )}
      {refreshMutation.isError ? (
        <div className="mt-2 text-xs text-danger">{toErrorMessage(refreshMutation.error)}</div>
      ) : null}
    </div>
  )
}

function SecuritySearchBox({
  keyword,
  onKeywordChange,
  onSearch,
  onReset,
  onSelect
}: {
  keyword: string
  onKeywordChange: (keyword: string) => void
  onSearch: () => void
  onReset: () => void
  onSelect: (code: string) => void
}) {
  const [open, setOpen] = useState(false)
  const securitiesQuery = useQuery({
    queryKey: ['securities'],
    queryFn: () => commands.listSecurities('', 10000),
    staleTime: 60_000
  })
  const results = useMemo(() => {
    const value = keyword.trim().toLowerCase()
    if (!value) return []
    return (securitiesQuery.data ?? [])
      .filter(security =>
        [
          security.code,
          security.name,
          security.symbol,
          security.exchange,
          security.stockType,
          security.industry,
          security.board,
        ].filter(Boolean).join(' ').toLowerCase().includes(value)
      )
      .slice(0, 15)
  }, [keyword, securitiesQuery.data])

  const handleSelect = (result: Security) => {
    onKeywordChange(result.code)
    setOpen(false)
    onSelect(result.symbol)
  }

  useEffect(() => {
    setOpen(keyword.trim().length > 0 && results.length > 0)
  }, [keyword, results.length])

  return (
    <div className="relative mb-4 max-w-xl">
      <Field label={'证券'}>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              value={keyword}
              onChange={event => onKeywordChange(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') onSearch()
              }}
              onFocus={() => setOpen(keyword.trim().length > 0 && results.length > 0)}
              placeholder={'输入代码或名称'}
            />
          </div>
          <Button
            icon={<Search className="h-4 w-4" />}
            variant="primary"
            onClick={onSearch}
          >
            {'检索'}
          </Button>
          <Button
            icon={<RotateCcw className="h-4 w-4" />}
            onClick={onReset}
            variant="secondary"
          >
            {'重置'}
          </Button>
        </div>
      </Field>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-full max-h-56 overflow-y-auto border border-border bg-panel shadow-lg">
          {results.map(result => (
            <button
              key={result.symbol}
              onClick={() => handleSelect(result)}
              className="flex w-full items-center gap-3 px-3 py-2 text-left text-xs hover:bg-muted transition font-mono"
            >
              <span className="w-20 text-foreground">{result.code}</span>
              <span className="flex-1 font-sans">{result.name}</span>
              <span className="text-muted-foreground text-[10px]">{result.exchange} · {result.stockType}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

type SortField =
  | 'code'
  | 'name'
  | 'exchange'
  | 'stockType'
  | 'changePct'
  | 'latestPrice'
  | 'latestDate'
  | 'industry'
  | 'dataStatus'
type SortDir = 'asc' | 'desc'
type ContextMenuState = { x: number; y: number; symbols: string[] } | null
type DataStatusFilter = 'all' | 'complete' | 'stale' | 'missing'
const KLINE_DATA_PAGE_SIZE = 12
const zhCollator = new Intl.Collator('zh-CN')

function SecuritiesTable({
  keyword,
  resetToken,
  onSelect
}: {
  keyword: string
  resetToken: number
  onSelect: (code: string) => void
}) {
  const queryClient = useQueryClient()
  const [sortField, setSortField] = useState<SortField>('code')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [selectedSymbols, setSelectedSymbols] = useState<Set<string>>(() => new Set())
  const [menu, setMenu] = useState<ContextMenuState>(null)
  const [page, setPage] = useState(0)
  const [dataStatusFilter, setDataStatusFilter] = useState<DataStatusFilter>('all')

  // Load all securities once into memory, filter/sort client-side
  const allSecQuery = useQuery({
    queryKey: ['securities'],
    queryFn: () => commands.listSecurities('', 10000),
    staleTime: 60_000
  })
  const watchlists = useQuery({
    queryKey: ['watchlists'],
    queryFn: commands.listWatchlists
  })
  const tradeSystems = useQuery({
    queryKey: ['trade-systems'],
    queryFn: commands.listTradeSystems
  })

  const addToWatchlist = useMutation({
    mutationFn: async ({ watchlistId, symbols }: { watchlistId: string; symbols: string[] }) => {
      await Promise.all(symbols.map(symbol => commands.addWatchlistItem(watchlistId, symbol)))
    },
    onSuccess: () => {
      setMenu(null)
      void queryClient.invalidateQueries({ queryKey: ['watchlists'] })
    }
  })
  const addToTradeSystem = useMutation({
    mutationFn: ({ tradeSystemId, symbols }: { tradeSystemId: string; symbols: string[] }) =>
      commands.addTradeSystemStocks(tradeSystemId, symbols),
    onSuccess: () => setMenu(null)
  })

  useEffect(() => {
    const close = () => setMenu(null)
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null)
    }
    window.addEventListener('click', close)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [])

  useEffect(() => {
    setSortField('code')
    setSortDir('asc')
    setDataStatusFilter('all')
    setSelectedSymbols(new Set())
    setPage(0)
  }, [resetToken])

  const indexedSecurities = useMemo(
    () =>
      (allSecQuery.data ?? []).map(security => ({
        security,
        searchText: [
          security.code,
          security.name,
          security.symbol,
          security.exchange,
          security.stockType,
          security.industry,
          security.board,
        ].filter(Boolean).join(' ').toLowerCase()
      })),
    [allSecQuery.data]
  )

  const sorted = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase()
    const filtered = indexedSecurities
      .filter(({ security, searchText }) =>
        (dataStatusFilter === 'all' || security.dataStatus === dataStatusFilter) &&
        (!normalizedKeyword || searchText.includes(normalizedKeyword))
      )
      .map(item => item.security)
    return [...filtered].sort((a, b) => {
      const aVal = valueForSort(a, sortField)
      const bVal = valueForSort(b, sortField)
      const cmp =
        typeof aVal === 'number' || typeof bVal === 'number'
          ? Number(aVal ?? Number.NEGATIVE_INFINITY) - Number(bVal ?? Number.NEGATIVE_INFINITY)
          : zhCollator.compare(String(aVal ?? ''), String(bVal ?? ''))
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [dataStatusFilter, indexedSecurities, keyword, sortField, sortDir])

  const totalPages = Math.ceil(sorted.length / KLINE_DATA_PAGE_SIZE)
  const paged = sorted.slice(page * KLINE_DATA_PAGE_SIZE, (page + 1) * KLINE_DATA_PAGE_SIZE)

  // Reset page when filter/sort changes
  useEffect(() => { setPage(0) }, [keyword, sortField, sortDir, dataStatusFilter])

  const visibleSymbols = paged.map(security => security.symbol)
  const allSelected = visibleSymbols.length > 0 && visibleSymbols.every(symbol => selectedSymbols.has(symbol))

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  const toggleAll = () => {
    setSelectedSymbols(previous => {
      const next = new Set(previous)
      if (allSelected) {
        visibleSymbols.forEach(symbol => next.delete(symbol))
      } else {
        visibleSymbols.forEach(symbol => next.add(symbol))
      }
      return next
    })
  }

  const toggleOne = (symbol: string) => {
    setSelectedSymbols(previous => {
      const next = new Set(previous)
      if (next.has(symbol)) next.delete(symbol)
      else next.add(symbol)
      return next
    })
  }

  const openContextMenu = (event: MouseEvent, security: Security) => {
    event.preventDefault()
    const symbols = selectedSymbols.has(security.symbol)
      ? Array.from(selectedSymbols)
      : [security.symbol]
    if (!selectedSymbols.has(security.symbol)) {
      setSelectedSymbols(new Set([security.symbol]))
    }
    setMenu({ x: event.clientX, y: event.clientY, symbols })
  }

  const columns = [
    {
      key: 'select',
      label: (
        <input
          aria-label="选择全部"
          checked={allSelected}
          onChange={toggleAll}
          type="checkbox"
          className="h-3.5 w-3.5 accent-ring"
        />
      )
    },
    { key: 'code', label: '代码', onClick: () => handleSort('code'), active: sortField === 'code', dir: sortDir },
    { key: 'name', label: '名称', onClick: () => handleSort('name'), active: sortField === 'name', dir: sortDir },
    { key: 'exchange', label: '交易所', onClick: () => handleSort('exchange'), active: sortField === 'exchange', dir: sortDir },
    { key: 'stockType', label: '类型', onClick: () => handleSort('stockType'), active: sortField === 'stockType', dir: sortDir },
    { key: 'changePct', label: '涨幅', onClick: () => handleSort('changePct'), active: sortField === 'changePct', dir: sortDir },
    { key: 'latestPrice', label: '现价', onClick: () => handleSort('latestPrice'), active: sortField === 'latestPrice', dir: sortDir },
    { key: 'latestDate', label: '最新日期', onClick: () => handleSort('latestDate'), active: sortField === 'latestDate', dir: sortDir },
    { key: 'industry', label: '所属行业', onClick: () => handleSort('industry'), active: sortField === 'industry', dir: sortDir },
    {
      key: 'dataStatus',
      label: (
        <select
          aria-label="筛选数据状态"
          className="h-6 bg-muted/55 px-1.5 text-[11px] text-foreground outline-none"
          value={dataStatusFilter}
          onClick={event => event.stopPropagation()}
          onChange={event => setDataStatusFilter(event.target.value as DataStatusFilter)}
        >
          <option value="all">数据状态</option>
          <option value="complete">齐全</option>
          <option value="stale">待更新</option>
          <option value="missing">缺失</option>
        </select>
      )
    }
  ]

  return (
    <div className="relative">
      <DataTable columns={columns}>
        {paged.map(security => (
          <SecuritiesRow
            key={security.symbol}
            security={security}
            selected={selectedSymbols.has(security.symbol)}
            onToggle={() => toggleOne(security.symbol)}
            onSelect={() => onSelect(security.symbol)}
            onContextMenu={event => openContextMenu(event, security)}
          />
        ))}
      </DataTable>
      {allSecQuery.isLoading ? (
        <div className="border-x border-b border-border px-3 py-2 text-xs text-muted-foreground">加载中...</div>
      ) : null}
      {allSecQuery.isError ? (
        <div className="border-x border-b border-border px-3 py-2 text-xs text-danger">{toErrorMessage(allSecQuery.error)}</div>
      ) : null}
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-x border-b border-border px-3 py-2 text-[10px] font-mono text-muted-foreground">
          <span>共 {sorted.length} 条 · 第 {page + 1}/{totalPages} 页</span>
          <div className="flex gap-1">
            <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage(0)}>{'<<'}</Button>
            <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>{'<'}</Button>
            <Button variant="secondary" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>{'>'}</Button>
            <Button variant="secondary" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(totalPages - 1)}>{'>>'}</Button>
          </div>
        </div>
      )}
      <SecuritiesContextMenu
        menu={menu}
        watchlists={watchlists.data ?? []}
        tradeSystems={tradeSystems.data ?? []}
        onAddToWatchlist={(watchlistId, symbols) => addToWatchlist.mutate({ watchlistId, symbols })}
        onAddToTradeSystem={(tradeSystemId, symbols) => addToTradeSystem.mutate({ tradeSystemId, symbols })}
      />
    </div>
  )
}

function SecuritiesRow({
  security,
  selected,
  onToggle,
  onSelect,
  onContextMenu
}: {
  security: Security
  selected: boolean
  onToggle: () => void
  onSelect: () => void
  onContextMenu: (event: MouseEvent) => void
}) {
  return (
    <tr
      className={cn('cursor-pointer hover:bg-muted/50', selected && 'bg-muted/60')}
      onClick={onSelect}
      onContextMenu={onContextMenu}
    >
      <Td>
        <input
          aria-label={`选择 ${security.name}`}
          checked={selected}
          onChange={onToggle}
          onClick={event => event.stopPropagation()}
          type="checkbox"
          className="h-3.5 w-3.5 accent-ring"
        />
      </Td>
      <Td className="font-mono">{security.code}</Td>
      <Td>{security.name}</Td>
      <Td className="font-mono text-muted-foreground">{security.exchange}</Td>
      <Td className="text-muted-foreground">{security.stockType === 'index' ? '指数' : '股票'}</Td>
      <Td className={cn('font-mono', (security.changePct ?? 0) > 0 && 'text-danger', (security.changePct ?? 0) < 0 && 'text-[#0f9f6e]')}>
        {security.changePct == null ? '-' : `${security.changePct > 0 ? '+' : ''}${formatNumber(security.changePct)}%`}
      </Td>
      <Td className={cn('font-mono', (security.changePct ?? 0) > 0 && 'text-danger', (security.changePct ?? 0) < 0 && 'text-[#0f9f6e]')}>
        {formatNumber(security.latestPrice)}
      </Td>
      <Td className="font-mono text-muted-foreground">{security.latestDate ?? '-'}</Td>
      <Td className="text-muted-foreground">{security.industry ?? security.board ?? '-'}</Td>
      <Td>
        {security.dataStatus === 'complete' ? (
          <Badge tone="success">{'齐全'}</Badge>
        ) : security.dataStatus === 'stale' ? (
          <Badge tone="warning">{'待更新'}</Badge>
        ) : (
          <Badge tone="danger">{'缺失'}</Badge>
        )}
      </Td>
    </tr>
  )
}

function SecuritiesContextMenu({
  menu,
  watchlists,
  tradeSystems,
  onAddToWatchlist,
  onAddToTradeSystem
}: {
  menu: ContextMenuState
  watchlists: Watchlist[]
  tradeSystems: TradeSystemSummary[]
  onAddToWatchlist: (watchlistId: string, symbols: string[]) => void
  onAddToTradeSystem: (tradeSystemId: string, symbols: string[]) => void
}) {
  if (!menu) return null
  return (
    <div
      className="fixed z-[80] min-w-48 border border-border bg-panel py-1 text-xs shadow-xl"
      style={{ left: menu.x, top: menu.y }}
      onClick={event => event.stopPropagation()}
    >
      <div className="px-3 py-1.5 font-mono text-[10px] text-muted-foreground">
        已选 {menu.symbols.length} 个标的
      </div>
      <Submenu label="添加到分组" emptyLabel="暂无分组">
        {watchlists.map(watchlist => (
          <button
            key={watchlist.id}
            className="block w-full px-3 py-1.5 text-left hover:bg-muted"
            onClick={() => onAddToWatchlist(watchlist.id, menu.symbols)}
          >
            {watchlist.name}
          </button>
        ))}
      </Submenu>
      <Submenu label="添加到交易系统" emptyLabel="暂无交易系统">
        {tradeSystems.map(system => (
          <button
            key={system.id}
            className="block w-full px-3 py-1.5 text-left hover:bg-muted"
            onClick={() => onAddToTradeSystem(system.id, menu.symbols)}
          >
            {system.name}
          </button>
        ))}
      </Submenu>
    </div>
  )
}

function Submenu({
  label,
  emptyLabel,
  children
}: {
  label: string
  emptyLabel: string
  children: ReactNode
}) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children)
  return (
    <div className="group relative">
      <button className="flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left hover:bg-muted">
        <span>{label}</span>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
      <div className="invisible absolute left-full top-0 min-w-44 border border-border bg-panel py-1 shadow-xl group-hover:visible">
        {hasChildren ? children : <div className="px-3 py-1.5 text-muted-foreground">{emptyLabel}</div>}
      </div>
    </div>
  )
}

function valueForSort(security: Security, field: SortField) {
  if (field === 'industry') return security.industry ?? security.board ?? ''
  return security[field]
}

export function KlineDataPage({
  stockCode,
  onStockCodeChange
}: {
  stockCode: string
  onStockCodeChange: (code: string) => void
}) {
  const [keywordDraft, setKeywordDraft] = useState('')
  const [keyword, setKeyword] = useState('')
  const [resetToken, setResetToken] = useState(0)

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-4 overflow-hidden">
      <DataHealthBanner />
      <Panel title={'证券检索'} className="min-h-0 overflow-hidden" bodyClassName="flex min-h-0 flex-col overflow-hidden">
        <SecuritySearchBox
          keyword={keywordDraft}
          onKeywordChange={setKeywordDraft}
          onSearch={() => setKeyword(keywordDraft)}
          onReset={() => {
            setKeywordDraft('')
            setKeyword('')
            setResetToken(token => token + 1)
          }}
          onSelect={onStockCodeChange}
        />
        <div className="min-h-0 flex-1 overflow-hidden">
          <SecuritiesTable keyword={keyword} resetToken={resetToken} onSelect={onStockCodeChange} />
        </div>
      </Panel>
    </div>
  )
}
