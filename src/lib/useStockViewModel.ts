import { useQueries, useQuery } from '@tanstack/react-query'
import { commands } from './commands'
import type { ChartAnnotation, KlineBar, KlineCoverage, StockMeta, StockReview } from './types'

type Frequency = '1d' | '1w' | '1M' | '1Q' | '1Y'
type AdjMode = 'pre' | 'none'

export type StockViewModel = {
  symbol: string
  meta?: StockMeta
  bars: KlineBar[]
  annotations: ChartAnnotation[]
  reviews: StockReview[]
  coverage?: KlineCoverage
  isLoading: boolean
  barsLoading: boolean
  annotationsLoading: boolean
  reviewsLoading: boolean
  coverageLoading: boolean
  error: unknown
}

export function useStockViewModel({
  symbol,
  versionId,
  frequency,
  adjMode,
  limit = 800,
}: {
  symbol: string
  versionId?: string
  frequency: Frequency
  adjMode: AdjMode
  limit?: number
}): StockViewModel {
  const enabled = Boolean(symbol)
  const metaQuery = useQuery({
    queryKey: ['stock-meta', symbol],
    queryFn: () => commands.getStockMeta(symbol),
    enabled,
    staleTime: 60_000,
  })

  const [barsQuery, annotationsQuery, reviewsQuery, coverageQuery] = useQueries({
    queries: [
      {
        queryKey: ['bars', symbol, frequency, adjMode],
        queryFn: () => commands.getBars(symbol, frequency, undefined, undefined, limit, adjMode),
        enabled,
      },
      {
        queryKey: ['annotations', symbol, versionId],
        queryFn: () => commands.listChartAnnotations(symbol, versionId),
        enabled,
      },
      {
        queryKey: ['stock-reviews', symbol, versionId],
        queryFn: () => commands.getStockReviews(symbol, versionId),
        enabled,
        staleTime: 30_000,
      },
      {
        queryKey: ['coverage', symbol],
        queryFn: () => commands.getDataCoverage(symbol),
        enabled,
        staleTime: 60_000,
      },
    ],
  })

  return {
    symbol,
    meta: metaQuery.data,
    bars: barsQuery.data ?? [],
    annotations: annotationsQuery.data ?? [],
    reviews: reviewsQuery.data ?? [],
    coverage: coverageQuery.data,
    isLoading:
      metaQuery.isLoading ||
      barsQuery.isLoading ||
      annotationsQuery.isLoading ||
      reviewsQuery.isLoading ||
      coverageQuery.isLoading,
    barsLoading: barsQuery.isLoading,
    annotationsLoading: annotationsQuery.isLoading,
    reviewsLoading: reviewsQuery.isLoading,
    coverageLoading: coverageQuery.isLoading,
    error:
      metaQuery.error ??
      barsQuery.error ??
      annotationsQuery.error ??
      reviewsQuery.error ??
      coverageQuery.error,
  }
}
