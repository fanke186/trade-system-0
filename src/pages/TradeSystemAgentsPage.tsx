import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AgentCardList } from '../components/trade-agents/AgentCardList'
import { AgentEditWindow } from '../components/trade-agents/AgentEditWindow'
import { StockEvaluation } from '../components/trade-agents/StockEvaluation'
import { StockTable } from '../components/trade-agents/StockTable'
import { commands } from '../lib/commands'
import type { TradeSystemSummary, TradeSystemVersion } from '../lib/types'

type EditorTarget =
  | { mode: 'create'; name: string }
  | { mode: 'edit'; system: TradeSystemSummary }

export function TradeSystemAgentsPage({
  selectedVersionId,
  onSelectVersion,
  onNavigateToSettings,
}: {
  selectedVersionId?: string
  onSelectVersion: (versionId: string | undefined) => void
  onNavigateToSettings?: () => void
}) {
  const queryClient = useQueryClient()
  const [selectedSystemId, setSelectedSystemId] = useState<string | undefined>()
  const [selectedSymbol, setSelectedSymbol] = useState<string | undefined>()
  const [editorTarget, setEditorTarget] = useState<EditorTarget | null>(null)

  const systemsQuery = useQuery({
    queryKey: ['trade-systems'],
    queryFn: commands.listTradeSystems
  })
  const systems = systemsQuery.data ?? []

  useEffect(() => {
    if (selectedSystemId || systems.length === 0) return
    const selectedByVersion = systems.find(system => system.activeVersionId === selectedVersionId)
    setSelectedSystemId(selectedByVersion?.id ?? systems[0].id)
  }, [selectedSystemId, selectedVersionId, systems])

  const selectedSystem = useMemo(
    () => systems.find(system => system.id === selectedSystemId),
    [selectedSystemId, systems]
  )

  const detailQuery = useQuery({
    queryKey: ['trade-system-detail', selectedSystemId],
    queryFn: () => commands.getTradeSystem(selectedSystemId!),
    enabled: Boolean(selectedSystemId)
  })

  const stocksQuery = useQuery({
    queryKey: ['trade-system-stocks', selectedSystemId],
    queryFn: () => commands.listTradeSystemStocks(selectedSystemId!),
    enabled: Boolean(selectedSystemId)
  })
  const stocks = stocksQuery.data ?? []

  useEffect(() => {
    if (stocks.length === 0) {
      setSelectedSymbol(undefined)
      return
    }
    if (!selectedSymbol || !stocks.some(stock => stock.symbol === selectedSymbol)) {
      setSelectedSymbol(stocks[0].symbol)
    }
  }, [selectedSymbol, stocks])

  const deleteSystemMutation = useMutation({
    mutationFn: (system: TradeSystemSummary) => {
      const ok = window.confirm(`删除交易系统 Agent「${system.name}」？对应 Markdown 文档也会删除。`)
      if (!ok) throw new Error('已取消删除')
      return commands.deleteTradeSystem(system.id)
    },
    onSuccess: () => {
      setSelectedSystemId(undefined)
      setSelectedSymbol(undefined)
      void queryClient.invalidateQueries({ queryKey: ['trade-systems'] })
    }
  })

  const removeStockMutation = useMutation({
    mutationFn: ({ tradeSystemId, symbol }: { tradeSystemId: string; symbol: string }) =>
      commands.removeTradeSystemStock(tradeSystemId, symbol),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['trade-system-stocks', selectedSystemId] })
      void queryClient.invalidateQueries({ queryKey: ['trade-systems'] })
    }
  })

  const selectedStock = stocks.find(stock => stock.symbol === selectedSymbol)

  const handleCreate = () => {
    const baseName = '新交易系统 Agent'
    const existingNames = new Set(systems.map(system => system.name))
    let name = baseName
    let index = 2
    while (existingNames.has(name)) {
      name = `${baseName} ${index}`
      index += 1
    }
    setEditorTarget({ mode: 'create', name })
  }

  const handlePublished = (version: TradeSystemVersion) => {
    setSelectedSystemId(version.tradeSystemId)
    onSelectVersion(version.id)
    void queryClient.invalidateQueries({ queryKey: ['trade-systems'] })
    void queryClient.invalidateQueries({ queryKey: ['trade-system-detail'] })
    void queryClient.invalidateQueries({ queryKey: ['trade-system-stocks'] })
  }

  return (
    <div className="flex h-full min-h-0 bg-background">
      <AgentCardList
        systems={systems}
        selectedSystemId={selectedSystemId}
        onCreate={handleCreate}
        onDelete={system => deleteSystemMutation.mutate(system)}
        onEdit={system => {
          setSelectedSystemId(system.id)
          setEditorTarget({ mode: 'edit', system })
        }}
        onSelect={systemId => {
          setSelectedSystemId(systemId)
          const system = systems.find(item => item.id === systemId)
          onSelectVersion(system?.activeVersionId ?? undefined)
        }}
      />

      <StockTable
        stocks={stocks}
        selectedSymbol={selectedSymbol}
        onSelect={setSelectedSymbol}
        onRemove={stock => {
          if (!selectedSystemId) return
          removeStockMutation.mutate({ tradeSystemId: selectedSystemId, symbol: stock.symbol })
        }}
      />

      <StockEvaluation stock={selectedStock} />

      <AgentEditWindow
        detail={editorTarget?.mode === 'edit' && editorTarget.system.id === selectedSystemId ? detailQuery.data : undefined}
        onClose={() => setEditorTarget(null)}
        onPublished={handlePublished}
        target={editorTarget}
        onNavigateToSettings={onNavigateToSettings}
      />

      {systemsQuery.isError ? (
        <div className="fixed bottom-3 left-1/2 z-40 -translate-x-1/2 border border-danger bg-panel px-3 py-2 text-xs text-danger">
          交易系统列表加载失败
        </div>
      ) : null}
      {selectedSystem && stocksQuery.isFetching ? (
        <div className="fixed bottom-3 right-3 z-40 border border-border bg-panel px-3 py-2 text-xs text-muted-foreground">
          正在刷新关联标的...
        </div>
      ) : null}
    </div>
  )
}
