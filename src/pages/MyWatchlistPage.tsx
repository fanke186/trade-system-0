import { useEffect, useState, useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toErrorMessage } from '../lib/format'
import { WatchlistSidebar } from '../components/watchlist/WatchlistSidebar'
import { StockInfoPanel } from '../components/watchlist/StockInfoPanel'
import { KLineChartPanel } from '../components/chart/KLineChartPanel'
import { ChartToolbar } from '../components/chart/ChartToolbar'
import { SettingsPopover } from '../components/chart/SettingsPopover'
import { CrosshairTooltip } from '../components/chart/CrosshairTooltip'
import type { ChartSettings } from '../components/chart/SettingsPopover'
import type { ChartAnnotation, ChartAnnotationPayload, KlineBar } from '../lib/types'
import { commands } from '../lib/commands'

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
  const [adjMode, setAdjMode] = useState<'pre' | 'post' | 'none'>('pre')
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

  const queryClient = useQueryClient()
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

  const meta = useQuery({
    queryKey: ['stock-meta', stockCode],
    queryFn: () => commands.getStockMeta(stockCode),
    enabled: Boolean(stockCode),
  })

  const barsQuery = useQuery({
    queryKey: ['bars', stockCode, frequency, adjMode],
    queryFn: () => commands.getBars(stockCode, frequency, undefined, undefined, 800, adjMode),
    enabled: Boolean(stockCode),
  })

  const annotationsQuery = useQuery({
    queryKey: ['annotations', stockCode, selectedVersionId],
    queryFn: () => commands.listChartAnnotations(stockCode, selectedVersionId),
    enabled: Boolean(stockCode),
  })

  return (
    <div className="flex h-full gap-0 bg-background">
      {/* LEFT — 160px sidebar */}
      <WatchlistSidebar stockCode={stockCode} onStockCodeChange={onStockCodeChange} />

      {/* CENTER — flex-1 chart area */}
      <div className="flex min-w-0 flex-1 flex-col">
          <ChartToolbar
            stockName={meta.data?.name || stockCode}
          stockCode={meta.data?.code ?? stockCode}
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
            bars={barsQuery.data ?? []}
            annotations={annotationsQuery.data ?? []}
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

        {barsQuery.isError ? (
          <p className="mt-1 px-3 text-xs text-danger">{toErrorMessage(barsQuery.error)}</p>
        ) : null}

        {saveMutation.isError ? (
          <p className="mt-1 px-3 text-xs text-danger">{toErrorMessage(saveMutation.error)}</p>
        ) : null}

        {deleteMutation.isError ? (
          <p className="mt-1 px-3 text-xs text-danger">{toErrorMessage(deleteMutation.error)}</p>
        ) : null}
      </div>

      {/* RIGHT — 240px stock info panel */}
      <StockInfoPanel stockCode={stockCode} selectedVersionId={selectedVersionId} />
    </div>
  )
}
