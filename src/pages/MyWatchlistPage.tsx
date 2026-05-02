import { useEffect, useState, useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toErrorMessage } from '../lib/format'
import { WatchlistSidebar } from '../components/watchlist/WatchlistSidebar'
import { StockInfoPanel } from '../components/watchlist/StockInfoPanel'
import { KLineChartPanel } from '../components/chart/KLineChartPanel'
import { ChartToolbar } from '../components/chart/ChartToolbar'
import { SettingsPopover } from '../components/chart/SettingsPopover'
import { CrosshairTooltip } from '../components/chart/CrosshairTooltip'
import type { ChartSettings } from '../components/chart/SettingsPopover'
import type { ChartAnnotation, ChartAnnotationPayload, KlineBar, Watchlist } from '../lib/types'
import { commands } from '../lib/commands'
import { useStockViewModel } from '../lib/useStockViewModel'
import {
  useWatchlistViewModel,
  type WatchlistSortColumn,
  type WatchlistSortDir,
} from '../lib/useWatchlistViewModel'

const DEFAULT_SETTINGS: ChartSettings = {
  maLines: [
    { period: 5, color: '#f0b93b', enabled: true },
    { period: 10, color: '#7dcfff', enabled: true },
    { period: 20, color: '#bb9af7', enabled: true },
    { period: 60, color: '#ff6b35', enabled: false },
  ],
  coordType: 'log',
}

export function MyWatchlistPage({
  stockCode,
  selectedVersionId,
  onStockCodeChange,
}: {
  stockCode: string
  selectedVersionId?: string
  onStockCodeChange: (code: string) => void
}) {
  const [frequency, setFrequency] = useState<'1d' | '1w' | '1M' | '1Q' | '1Y'>('1d')
  const [adjMode, setAdjMode] = useState<'pre' | 'none'>('pre')
  const [subChartType, setSubChartType] = useState<'volume' | 'amount'>(() =>
    window.localStorage.getItem('qsgg.subChartType') === 'amount' ? 'amount' : 'volume'
  )
  const [settings, setSettings] = useState<ChartSettings>(() => {
    try {
      const stored = window.localStorage.getItem('qsgg.chartSettings')
      return stored ? { ...DEFAULT_SETTINGS, ...JSON.parse(stored) } : DEFAULT_SETTINGS
    } catch {
      return DEFAULT_SETTINGS
    }
  })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [drawingTool, setDrawingTool] = useState<'horizontal_line' | 'ray' | null>(null)
  const [crosshairBar, setCrosshairBar] = useState<KlineBar | null>(null)
  const [crosshairPos, setCrosshairPos] = useState<'top-left' | 'top-right'>('top-right')
  const [selectedWatchlistId, setSelectedWatchlistId] = useState<string | undefined>()
  const [sortColumn, setSortColumn] = useState<WatchlistSortColumn>('name')
  const [sortDir, setSortDir] = useState<WatchlistSortDir>('asc')

  const queryClient = useQueryClient()
  const watchlistView = useWatchlistViewModel({ selectedWatchlistId, sortColumn, sortDir })
  const stockView = useStockViewModel({
    symbol: stockCode,
    versionId: selectedVersionId,
    frequency,
    adjMode,
  })

  useEffect(() => {
    if (!selectedWatchlistId && watchlistView.watchlists.length > 0) {
      setSelectedWatchlistId(watchlistView.watchlists[0].id)
    }
  }, [selectedWatchlistId, watchlistView.watchlists])

  useEffect(() => {
    if (watchlistView.rows.length === 0) return
    const activeInCurrentWatchlist = watchlistView.rows.some(row => row.symbol === stockCode)
    const firstSymbol = watchlistView.rows[0].symbol
    if (!stockCode || !activeInCurrentWatchlist) {
      onStockCodeChange(firstSymbol)
    }
  }, [onStockCodeChange, stockCode, watchlistView.rows])

  useEffect(() => {
    window.localStorage.setItem('qsgg.chartSettings', JSON.stringify(settings))
  }, [settings])

  useEffect(() => {
    window.localStorage.setItem('qsgg.subChartType', subChartType)
  }, [subChartType])

  const invalidateAnnotations = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['annotations', stockCode, selectedVersionId] })
  }, [queryClient, selectedVersionId, stockCode])

  const saveMutation = useMutation({
    mutationFn: ({ id, payload }: { id?: string; payload: ChartAnnotationPayload }) =>
      commands.saveChartAnnotation({
        id,
        stockCode,
        tradeSystemVersionId: selectedVersionId ?? null,
        reviewId: null,
        source: 'user',
        annotationType: payload.type,
        payload,
      }),
    onSuccess: () => {
      setDrawingTool(null)
      invalidateAnnotations()
    },
  })

  const handleDrawComplete = useCallback((payload: ChartAnnotationPayload) => {
    saveMutation.mutate({ payload })
  }, [saveMutation])

  const handleAnnotationUpdate = useCallback((annotation: ChartAnnotation, payload: ChartAnnotationPayload) => {
    saveMutation.mutate({ id: annotation.id, payload })
  }, [saveMutation])

  const deleteMutation = useMutation({
    mutationFn: (annotationId: string) => commands.deleteChartAnnotation(annotationId),
    onSuccess: invalidateAnnotations,
  })

  const handleAnnotationDelete = useCallback((annotation: ChartAnnotation) => {
    deleteMutation.mutate(annotation.id)
  }, [deleteMutation])

  const invalidateWatchlists = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['watchlists'] })
  }, [queryClient])

  const reorderMutation = useMutation({
    mutationFn: ({ itemId, position }: { itemId: string; position: 'top' | 'bottom' }) =>
      commands.reorderWatchlistItem(itemId, position),
    onSuccess: invalidateWatchlists,
  })
  const removeMutation = useMutation({
    mutationFn: async ({ watchlistId, symbols }: { watchlistId: string; symbols: string[] }) => {
      await Promise.all(symbols.map(symbol => commands.removeWatchlistItem(watchlistId, symbol)))
    },
    onSuccess: invalidateWatchlists,
  })
  const copyMutation = useMutation({
    mutationFn: async ({ itemIds, targetWatchlistId }: { itemIds: string[]; targetWatchlistId: string }) => {
      await Promise.all(itemIds.map(itemId => commands.copyWatchlistItem(itemId, targetWatchlistId)))
    },
    onSuccess: invalidateWatchlists,
  })
  const createGroupMutation = useMutation({
    mutationFn: (name: string) => commands.createWatchlistGroup(name),
    onSuccess: watchlist => {
      invalidateWatchlists()
      setSelectedWatchlistId(watchlist.id)
    },
  })
  const renameGroupMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => commands.renameWatchlistGroup(id, name),
    onSuccess: invalidateWatchlists,
  })
  const deleteGroupMutation = useMutation({
    mutationFn: (id: string) => commands.deleteWatchlistGroup(id),
    onSuccess: () => {
      setSelectedWatchlistId(undefined)
      invalidateWatchlists()
    },
  })

  const toggleSort = useCallback((column: WatchlistSortColumn) => {
    if (sortColumn === column) {
      setSortDir(dir => (dir === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortColumn(column)
      setSortDir('asc')
    }
  }, [sortColumn])

  const handleCreateGroup = useCallback(() => {
    const name = window.prompt('新分组名称')?.trim()
    if (name) createGroupMutation.mutate(name)
  }, [createGroupMutation])

  const handleRenameGroup = useCallback((watchlist: Watchlist) => {
    const name = window.prompt('分组名称', watchlist.name)?.trim()
    if (name && name !== watchlist.name) {
      renameGroupMutation.mutate({ id: watchlist.id, name })
    }
  }, [renameGroupMutation])

  const handleDeleteGroup = useCallback((watchlist: Watchlist) => {
    if (watchlist.name === '我的自选') return
    if (window.confirm(`删除分组「${watchlist.name}」？`)) {
      deleteGroupMutation.mutate(watchlist.id)
    }
  }, [deleteGroupMutation])

  return (
    <div className="flex h-full gap-0 bg-background">
      {/* LEFT — 160px sidebar */}
      <WatchlistSidebar
        activeStockCode={stockCode}
        watchlists={watchlistView.watchlists}
        currentWatchlist={watchlistView.currentWatchlist}
        rows={watchlistView.rows}
        sortColumn={sortColumn}
        sortDir={sortDir}
        onWatchlistChange={setSelectedWatchlistId}
        onToggleSort={toggleSort}
        onStockCodeChange={onStockCodeChange}
        onCreateGroup={handleCreateGroup}
        onRenameGroup={handleRenameGroup}
        onDeleteGroup={handleDeleteGroup}
        onReorderItem={(itemId, position) => reorderMutation.mutate({ itemId, position })}
        onRemoveItems={(watchlistId, symbols) => removeMutation.mutate({ watchlistId, symbols })}
        onCopyItems={(itemIds, targetWatchlistId) => copyMutation.mutate({ itemIds, targetWatchlistId })}
      />

      {/* CENTER — flex-1 chart area */}
      <div className="flex min-w-0 flex-1 flex-col">
          <ChartToolbar
            stockName={stockView.meta?.name || stockCode}
          stockCode={stockView.meta?.code ?? stockCode}
          frequency={frequency}
          onFrequencyChange={setFrequency}
          adjMode={adjMode}
          onAdjModeChange={setAdjMode}
          onSettingsClick={() => setSettingsOpen(o => !o)}
          settingsOpen={settingsOpen}
          drawingTool={drawingTool}
          onDrawingToolChange={setDrawingTool}
        />

        <div className="relative">
          {settingsOpen && (
            <SettingsPopover
              settings={settings}
              onChange={setSettings}
              onClose={() => setSettingsOpen(false)}
            />
          )}
        </div>

        <div className="relative flex-1">
          <KLineChartPanel
            bars={stockView.bars}
            annotations={stockView.annotations}
            drawingTool={drawingTool}
            onDrawComplete={handleDrawComplete}
            onAnnotationUpdate={handleAnnotationUpdate}
            onAnnotationDelete={handleAnnotationDelete}
            subChartType={subChartType}
            maLines={settings.maLines}
            coordType={settings.coordType}
            onCrosshairBar={setCrosshairBar}
            onCrosshairPosition={setCrosshairPos}
            onSubChartTypeChange={setSubChartType}
          />
          <CrosshairTooltip bar={crosshairBar} position={crosshairPos} />
        </div>

        {stockView.error ? (
          <p className="mt-1 px-3 text-xs text-danger">{toErrorMessage(stockView.error)}</p>
        ) : null}

        {saveMutation.isError ? (
          <p className="mt-1 px-3 text-xs text-danger">{toErrorMessage(saveMutation.error)}</p>
        ) : null}

        {deleteMutation.isError ? (
          <p className="mt-1 px-3 text-xs text-danger">{toErrorMessage(deleteMutation.error)}</p>
        ) : null}
      </div>

      {/* RIGHT — 240px stock info panel */}
      <StockInfoPanel
        stockCode={stockCode}
        selectedVersionId={selectedVersionId}
        meta={stockView.meta}
        reviews={stockView.reviews}
        coverage={stockView.coverage}
        coverageLoading={stockView.coverageLoading}
      />
    </div>
  )
}
