import { useEffect, useMemo, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot, ExternalLink, Loader2, Play, RefreshCw, Search, Star } from 'lucide-react'
import { Badge } from '../components/shared/Badge'
import { Button } from '../components/shared/Button'
import { DataTable, Td } from '../components/shared/DataTable'
import { Field, Input, Select } from '../components/shared/Field'
import { Panel } from '../components/shared/Panel'
import { ProviderSelect, TradeSystemVersionSelect } from '../components/shared/Selectors'
import { commands } from '../lib/commands'
import { toErrorMessage } from '../lib/format'
import { cn } from '../lib/cn'
import type { AiScoreRecord, SecuritySearchResult, TriggerAiScoreInput } from '../lib/types'

type TriggerType = TriggerAiScoreInput['triggerType']

const triggerModes: Array<{ id: TriggerType; label: string; icon: typeof Bot }> = [
  { id: 'trade_system_agent', label: '交易系统 Agent', icon: Bot },
  { id: 'single_stock', label: '单只标的', icon: Search },
  { id: 'watchlist', label: '自选分组', icon: Star }
]

export function DailyReviewPage({
  selectedVersionId,
  onSelectVersion,
  stockCode,
  onStockCodeChange
}: {
  selectedVersionId?: string
  onSelectVersion: (versionId: string | undefined) => void
  stockCode: string
  onStockCodeChange: (code: string) => void
}) {
  const queryClient = useQueryClient()
  const [triggerType, setTriggerType] = useState<TriggerType>('trade_system_agent')
  const [selectedWatchlistId, setSelectedWatchlistId] = useState<string>()
  const [providerId, setProviderId] = useState<string>()
  const [singleKeyword, setSingleKeyword] = useState(stockCode)
  const [selectedSecurity, setSelectedSecurity] = useState<SecuritySearchResult | null>(null)

  const tradeSystemsQuery = useQuery({
    queryKey: ['trade-systems'],
    queryFn: commands.listTradeSystems
  })
  const selectedSystem = useMemo(
    () => tradeSystemsQuery.data?.find(system => system.activeVersionId === selectedVersionId),
    [selectedVersionId, tradeSystemsQuery.data]
  )
  const tradeSystemStocksQuery = useQuery({
    queryKey: ['trade-system-stocks', selectedSystem?.id],
    queryFn: () => commands.listTradeSystemStocks(selectedSystem!.id),
    enabled: Boolean(selectedSystem?.id)
  })
  const watchlistsQuery = useQuery({
    queryKey: ['watchlists'],
    queryFn: commands.listWatchlists
  })
  const selectedWatchlist = useMemo(() => {
    const watchlists = watchlistsQuery.data ?? []
    return watchlists.find(item => item.id === selectedWatchlistId) ?? watchlists[0]
  }, [selectedWatchlistId, watchlistsQuery.data])
  const securitiesQuery = useQuery({
    queryKey: ['security-search', singleKeyword],
    queryFn: () => commands.searchSecurities(singleKeyword, 8),
    enabled: triggerType === 'single_stock' && singleKeyword.trim().length > 0
  })
  const recordsQuery = useQuery({
    queryKey: ['ai-score-records'],
    queryFn: () => commands.listAiScoreRecords({ limit: 200 }),
    refetchInterval: query => {
      const records = query.state.data ?? []
      return records.some(record => record.status === 'pending' || record.status === 'running') ? 1800 : false
    }
  })

  useEffect(() => {
    const unlisten = listen('ai-score-progress', () => {
      void queryClient.invalidateQueries({ queryKey: ['ai-score-records'] })
      if (selectedSystem?.id) {
        void queryClient.invalidateQueries({ queryKey: ['trade-system-stocks', selectedSystem.id] })
      }
    })
    return () => {
      void unlisten.then(dispose => dispose())
    }
  }, [queryClient, selectedSystem?.id])

  const triggerMutation = useMutation({
    mutationFn: () => {
      if (!selectedVersionId) throw new Error('请先选择交易系统版本')
      const input: TriggerAiScoreInput = {
        triggerType,
        tradeSystemVersionId: selectedVersionId,
        providerId
      }
      if (triggerType === 'single_stock') {
        const symbol = selectedSecurity?.symbol ?? singleKeyword.trim()
        if (!symbol) throw new Error('请选择标的')
        input.stockSymbol = symbol
      }
      if (triggerType === 'watchlist') {
        if (!selectedWatchlist) throw new Error('请选择自选分组')
        input.watchlistId = selectedWatchlist.id
      }
      return commands.triggerAiScore(input)
    },
    onSuccess: () => {
      setSelectedSecurity(null)
      void queryClient.invalidateQueries({ queryKey: ['ai-score-records'] })
      void queryClient.invalidateQueries({ queryKey: ['trade-systems'] })
      if (selectedSystem?.id) {
        void queryClient.invalidateQueries({ queryKey: ['trade-system-stocks', selectedSystem.id] })
      }
    }
  })

  const records = recordsQuery.data ?? []
  const targetCount =
    triggerType === 'trade_system_agent'
      ? tradeSystemStocksQuery.data?.length ?? selectedSystem?.stockCount ?? 0
      : triggerType === 'watchlist'
        ? selectedWatchlist?.items.length ?? 0
        : selectedSecurity
          ? 1
          : singleKeyword.trim()
            ? 1
            : 0

  return (
    <div className="grid gap-4">
      <Panel
        title="触发 AI 评分"
        action={
          <Button
            icon={<Play className="h-4 w-4" />}
            variant="primary"
            disabled={!selectedVersionId || targetCount === 0 || triggerMutation.isPending}
            onClick={() => triggerMutation.mutate()}
          >
            触发
          </Button>
        }
      >
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex border border-border bg-background/50">
              {triggerModes.map(mode => {
                const Icon = mode.icon
                return (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => setTriggerType(mode.id)}
                    className={cn(
                      'inline-flex h-9 items-center gap-2 border-r border-border px-3 font-mono text-xs last:border-r-0 transition',
                      triggerType === mode.id
                        ? 'bg-ring text-panel'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {mode.label}
                  </button>
                )
              })}
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={selectedVersionId ? 'success' : 'warning'}>{selectedSystem?.name ?? '未选择交易系统'}</Badge>
              <Badge tone={targetCount > 0 ? 'info' : 'warning'}>{targetCount} 标的</Badge>
            </div>
          </div>

          <div className="grid grid-cols-[minmax(260px,1fr)_minmax(240px,360px)_minmax(220px,300px)] gap-4">
            <TradeSystemVersionSelect value={selectedVersionId} onChange={onSelectVersion} />
            <TriggerTargetControls
              triggerType={triggerType}
              selectedWatchlistId={selectedWatchlist?.id}
              watchlists={watchlistsQuery.data ?? []}
              onWatchlistChange={setSelectedWatchlistId}
              singleKeyword={singleKeyword}
              onSingleKeywordChange={value => {
                setSingleKeyword(value)
                setSelectedSecurity(null)
                onStockCodeChange(value)
              }}
              securities={securitiesQuery.data ?? []}
              selectedSecurity={selectedSecurity}
              onSecuritySelect={security => {
                setSelectedSecurity(security)
                setSingleKeyword(`${security.code} ${security.name}`)
                onStockCodeChange(security.symbol)
              }}
            />
            <ProviderSelect value={providerId} onChange={setProviderId} />
          </div>

          <div className="grid grid-cols-4 gap-3">
            <Metric label="触发方式" value={triggerLabel(triggerType)} />
            <Metric label="交易系统标的" value={`${tradeSystemStocksQuery.data?.length ?? selectedSystem?.stockCount ?? 0}`} />
            <Metric label="历史记录" value={`${records.length}`} />
            <Metric
              label="运行中"
              value={`${records.filter(record => record.status === 'pending' || record.status === 'running').length}`}
            />
          </div>

          {triggerMutation.isError ? (
            <p className="text-xs text-danger">{toErrorMessage(triggerMutation.error)}</p>
          ) : null}
        </div>
      </Panel>

      <Panel
        title="历史 AI 评分记录"
        action={
          <Button
            icon={<RefreshCw className={cn('h-4 w-4', recordsQuery.isFetching && 'animate-spin')} />}
            onClick={() => recordsQuery.refetch()}
          >
            刷新
          </Button>
        }
      >
        <DataTable columns={['序号', '时间', '名称', '代码', '总分', '完成状态', '评分报告']}>
          {records.map((record, index) => (
            <tr className="hover:bg-muted/45" key={record.id}>
              <Td className="w-14 text-muted-foreground">{index + 1}</Td>
              <Td className="w-44 font-mono text-xs text-muted-foreground">{record.triggerTime}</Td>
              <Td>{record.stockName}</Td>
              <Td className="font-mono">{record.stockCode}</Td>
              <Td className={cn('w-24 text-right font-mono font-semibold', scoreClass(record.score))}>
                {record.score ?? '--'}
              </Td>
              <Td className="w-36">
                <StatusBadge record={record} />
              </Td>
              <Td className="w-40">
                <Button
                  disabled={!record.reportPath}
                  icon={<ExternalLink className="h-4 w-4" />}
                  onClick={() => openReport(record.reportPath)}
                  size="sm"
                >
                  HTML
                </Button>
              </Td>
            </tr>
          ))}
        </DataTable>
        {records.length === 0 ? (
          <div className="border-x border-b border-border bg-background/40 py-10 text-center text-sm text-muted-foreground">
            暂无 AI 评分记录
          </div>
        ) : null}
      </Panel>
    </div>
  )
}

function TriggerTargetControls({
  triggerType,
  selectedWatchlistId,
  watchlists,
  onWatchlistChange,
  singleKeyword,
  onSingleKeywordChange,
  securities,
  selectedSecurity,
  onSecuritySelect
}: {
  triggerType: TriggerType
  selectedWatchlistId?: string
  watchlists: Array<{ id: string; name: string; items: unknown[] }>
  onWatchlistChange: (id: string | undefined) => void
  singleKeyword: string
  onSingleKeywordChange: (value: string) => void
  securities: SecuritySearchResult[]
  selectedSecurity: SecuritySearchResult | null
  onSecuritySelect: (security: SecuritySearchResult) => void
}) {
  if (triggerType === 'trade_system_agent') {
    return (
      <Field label="目标范围">
        <Input value="交易系统已关联标的" readOnly />
      </Field>
    )
  }
  if (triggerType === 'watchlist') {
    return (
      <Field label="自选分组">
        <Select value={selectedWatchlistId ?? ''} onChange={event => onWatchlistChange(event.target.value || undefined)}>
          {watchlists.map(watchlist => (
            <option key={watchlist.id} value={watchlist.id}>
              {watchlist.name} · {watchlist.items.length}
            </option>
          ))}
        </Select>
      </Field>
    )
  }
  return (
    <div className="relative">
      <Field label="标的搜索">
        <Input
          value={singleKeyword}
          placeholder="输入名称或代码"
          onChange={event => onSingleKeywordChange(event.target.value)}
        />
      </Field>
      {securities.length > 0 && !selectedSecurity ? (
        <div className="absolute left-0 right-0 top-full z-30 mt-2 border border-border bg-panel shadow-[0_18px_40px_rgba(0,0,0,0.35)]">
          {securities.map(security => (
            <button
              className="flex w-full items-center justify-between gap-3 border-b border-border px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted"
              key={security.symbol}
              onClick={() => onSecuritySelect(security)}
              type="button"
            >
              <span>{security.name}</span>
              <span className="font-mono text-xs text-muted-foreground">{security.code}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border bg-background/40 p-3">
      <div className="font-mono text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-mono text-lg text-foreground">{value}</div>
    </div>
  )
}

function StatusBadge({ record }: { record: AiScoreRecord }) {
  if (record.status === 'pending' || record.status === 'running') {
    return (
      <span className="inline-flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin text-info" />
        <Badge tone="info">{record.status}</Badge>
      </span>
    )
  }
  if (record.status === 'completed') return <Badge tone="success">{record.rating ?? 'completed'}</Badge>
  if (record.status === 'failed') return <Badge tone="danger">failed</Badge>
  return <Badge tone="warning">{record.status}</Badge>
}

function triggerLabel(value: TriggerType) {
  return triggerModes.find(mode => mode.id === value)?.label ?? value
}

function scoreClass(value?: number | null) {
  if (value == null) return 'text-muted-foreground'
  if (value >= 80) return 'text-info'
  if (value >= 60) return 'text-success'
  if (value >= 40) return 'text-warning'
  return 'text-danger'
}

function openReport(path?: string | null) {
  if (!path) return
  const url = /^https?:\/\//.test(path) || path.startsWith('file://') ? path : `file://${path}`
  window.open(url, '_blank', 'noopener,noreferrer')
}
