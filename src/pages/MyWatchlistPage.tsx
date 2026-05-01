import { useState, useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Save } from 'lucide-react'
import { toErrorMessage } from '../lib/format'
import { WatchlistSidebar } from '../components/watchlist/WatchlistSidebar'
import { StockInfoPanel } from '../components/watchlist/StockInfoPanel'
import { KLineChartPanel } from '../components/chart/KLineChartPanel'
import { ChartToolbar } from '../components/chart/ChartToolbar'
import { SettingsPopover } from '../components/chart/SettingsPopover'
import { CrosshairTooltip } from '../components/chart/CrosshairTooltip'
import { Button } from '../components/shared/Button'
import type { ChartSettings } from '../components/chart/SettingsPopover'
import type { ChartAnnotationPayload, KlineBar } from '../lib/types'
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
  const [frequency, setFrequency] = useState<'1d' | '1w' | '1M'>('1d')
  const [adjMode, setAdjMode] = useState<'pre' | 'post' | 'none'>('pre')
  const [subChartType, setSubChartType] = useState<'volume' | 'amount'>('volume')
  const [settings, setSettings] = useState<ChartSettings>(DEFAULT_SETTINGS)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [drawingTool, setDrawingTool] = useState<'horizontal_line' | 'ray' | null>(null)
  const [pendingPayload, setPendingPayload] = useState<ChartAnnotationPayload | null>(null)
  const [crosshairBar, setCrosshairBar] = useState<KlineBar | null>(null)
  const [crosshairPos, setCrosshairPos] = useState<'top-left' | 'top-right'>('top-right')

  const queryClient = useQueryClient()

  const handleDrawComplete = useCallback((payload: ChartAnnotationPayload) => {
    setPendingPayload(payload)
  }, [])

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

  const saveMutation = useMutation({
    mutationFn: (payload: ChartAnnotationPayload) =>
      commands.saveChartAnnotation({
        stockCode,
        tradeSystemVersionId: selectedVersionId ?? null,
        reviewId: null,
        source: 'user',
        annotationType: payload.type,
        payload,
      }),
    onSuccess: () => {
      setPendingPayload(null)
      setDrawingTool(null)
      void queryClient.invalidateQueries({ queryKey: ['annotations', stockCode, selectedVersionId] })
    },
  })

  return (
    <div className="flex h-full gap-0 bg-background">
      {/* LEFT — 160px sidebar */}
      <WatchlistSidebar stockCode={stockCode} onStockCodeChange={onStockCodeChange} />

      {/* CENTER — flex-1 chart area */}
      <div className="flex min-w-0 flex-1 flex-col">
        <ChartToolbar
          stockName={meta.data?.name || stockCode}
          stockCode={stockCode}
          frequency={frequency}
          onFrequencyChange={setFrequency}
          adjMode={adjMode}
          onAdjModeChange={setAdjMode}
          onSettingsClick={() => setSettingsOpen(o => !o)}
          settingsOpen={settingsOpen}
          drawingTool={drawingTool}
          onDrawingToolChange={setDrawingTool}
          subChartType={subChartType}
          onSubChartTypeChange={setSubChartType}
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
            subChartType={subChartType}
            maLines={settings.maLines}
            coordType={settings.coordType}
            onCrosshairBar={setCrosshairBar}
            onCrosshairPosition={setCrosshairPos}
          />
          <CrosshairTooltip bar={crosshairBar} position={crosshairPos} />
        </div>

        {pendingPayload ? (
          <div className="flex items-center justify-between border border-border bg-muted/40 px-3 py-2 text-xs">
            <span>
              待保存标注：{pendingPayload.type}
              {'price' in pendingPayload ? ` / ${pendingPayload.price.toFixed(2)}` : ''}
            </span>
            <Button
              icon={<Save className="h-4 w-4" />}
              onClick={() => saveMutation.mutate(pendingPayload)}
              disabled={saveMutation.isPending}
              variant="primary"
            >
              保存标注
            </Button>
          </div>
        ) : null}

        {barsQuery.isError ? (
          <p className="mt-1 px-3 text-xs text-danger">{toErrorMessage(barsQuery.error)}</p>
        ) : null}

        {saveMutation.isError ? (
          <p className="mt-1 px-3 text-xs text-danger">{toErrorMessage(saveMutation.error)}</p>
        ) : null}
      </div>

      {/* RIGHT — 240px stock info panel */}
      <StockInfoPanel stockCode={stockCode} selectedVersionId={selectedVersionId} />
    </div>
  )
}
