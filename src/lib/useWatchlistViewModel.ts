import { useMemo } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { commands } from './commands'
import type { StockMeta, Watchlist, WatchlistItem } from './types'

export type WatchlistSortColumn = 'name' | 'changePct'
export type WatchlistSortDir = 'asc' | 'desc'

export type WatchlistRow = {
  item: WatchlistItem
  symbol: string
  meta?: StockMeta
  score?: number
  signal?: 'buy' | 'sell' | 'hold' | 'watch'
  dataHealth?: 'complete' | 'missing' | 'updating'
}

const zhCollator = new Intl.Collator('zh-CN')

export function useWatchlistViewModel({
  selectedWatchlistId,
  sortColumn,
  sortDir,
}: {
  selectedWatchlistId?: string
  sortColumn: WatchlistSortColumn
  sortDir: WatchlistSortDir
}) {
  const watchlistsQuery = useQuery({
    queryKey: ['watchlists'],
    queryFn: commands.listWatchlists,
    staleTime: 60_000,
  })
  const watchlists = watchlistsQuery.data ?? []
  const currentWatchlist = useMemo(
    () => watchlists.find(w => w.id === selectedWatchlistId) ?? watchlists[0],
    [selectedWatchlistId, watchlists],
  )
  const items = currentWatchlist?.items ?? []
  const symbols = useMemo(() => [...new Set(items.map(item => item.stockCode))], [items])
  const metaResults = useQueries({
    queries: symbols.map(symbol => ({
      queryKey: ['stock-meta', symbol],
      queryFn: () => commands.getStockMeta(symbol),
      enabled: Boolean(symbol),
      staleTime: 60_000,
    })),
  })

  const metaMap = useMemo(() => {
    const map = new Map<string, StockMeta>()
    symbols.forEach((symbol, index) => {
      const meta = metaResults[index]?.data
      if (meta) map.set(symbol, meta)
    })
    return map
  }, [metaResults, symbols])

  const rows = useMemo(() => {
    const next: WatchlistRow[] = items.map(item => {
      const meta = metaMap.get(item.stockCode)
      return {
        item,
        symbol: item.stockCode,
        meta,
        dataHealth: meta?.latestDate ? 'complete' : 'missing',
      }
    })
    next.sort((a, b) => {
      const cmp =
        sortColumn === 'name'
          ? zhCollator.compare(a.meta?.name ?? a.symbol, b.meta?.name ?? b.symbol)
          : (a.meta?.changePct ?? Number.NEGATIVE_INFINITY) -
            (b.meta?.changePct ?? Number.NEGATIVE_INFINITY)
      return sortDir === 'asc' ? cmp : -cmp
    })
    return next
  }, [items, metaMap, sortColumn, sortDir])

  return {
    watchlists,
    currentWatchlist: currentWatchlist as Watchlist | undefined,
    rows,
    isLoading: watchlistsQuery.isLoading || metaResults.some(result => result.isLoading),
    error: watchlistsQuery.error ?? metaResults.find(result => result.error)?.error,
  }
}
