import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Play } from 'lucide-react'
import { Badge } from '../components/shared/Badge'
import { Button } from '../components/shared/Button'
import { DataTable, Td } from '../components/shared/DataTable'
import { Field, Input, Select } from '../components/shared/Field'
import { Panel } from '../components/shared/Panel'
import { TradeSystemVersionSelect } from '../components/shared/Selectors'
import { commands } from '../lib/commands'
import { toErrorMessage } from '../lib/format'

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
  const [selectedWatchlistId, setSelectedWatchlistId] = useState<string>()
  const watchlistsQuery = useQuery({
    queryKey: ['watchlists'],
    queryFn: commands.listWatchlists
  })
  const selectedWatchlist = useMemo(() => {
    const watchlists = watchlistsQuery.data ?? []
    return watchlists.find(item => item.id === selectedWatchlistId) ?? watchlists[0]
  }, [selectedWatchlistId, watchlistsQuery.data])

  const reviewMutation = useMutation({
    mutationFn: () => {
      if (!selectedWatchlist) throw new Error('请先选择股票池')
      if (!selectedVersionId) throw new Error('请先选择交易系统版本')
      return commands.runDailyReview(selectedWatchlist.id, selectedVersionId)
    }
  })

  return (
    <div className="grid gap-4">
      <Panel
        title="每日复盘"
        action={
          <Button
            icon={<Play className="h-4 w-4" />}
            variant="primary"
            disabled={!selectedWatchlist || !selectedVersionId || reviewMutation.isPending}
            onClick={() => reviewMutation.mutate()}
          >
            开始
          </Button>
        }
      >
        <div className="grid grid-cols-[220px_260px_180px_1fr] gap-3">
          <Field label="股票池">
            <Select
              value={selectedWatchlist?.id ?? ''}
              onChange={event => setSelectedWatchlistId(event.target.value)}
            >
              {(watchlistsQuery.data ?? []).map(watchlist => (
                <option key={watchlist.id} value={watchlist.id}>
                  {watchlist.name}
                </option>
              ))}
            </Select>
          </Field>
          <TradeSystemVersionSelect value={selectedVersionId} onChange={onSelectVersion} />
          <Field label="当前股票">
            <Input value={stockCode} onChange={event => onStockCodeChange(event.target.value)} />
          </Field>
          <div className="flex items-end text-xs text-muted-foreground">
            每日复盘会先对股票池逐只增量同步，再通过本地 K 线评分。
          </div>
        </div>
        {reviewMutation.isError ? <p className="mt-3 text-xs text-danger">{toErrorMessage(reviewMutation.error)}</p> : null}
      </Panel>

      <Panel title="批量结果">
        <div className="mb-3 flex items-center gap-2 text-xs">
          <Badge>股票 {selectedWatchlist?.items.length ?? 0}</Badge>
          <Badge tone={reviewMutation.isPending ? 'warning' : reviewMutation.data ? 'success' : 'neutral'}>
            {reviewMutation.isPending ? '运行中' : reviewMutation.data ? '完成' : '待运行'}
          </Badge>
        </div>
        <DataTable columns={['股票', '同步', '评分', '分数', '评级', '摘要']}>
          {(reviewMutation.data?.results ?? []).map(item => (
            <tr
              className="cursor-pointer hover:bg-muted/50"
              key={item.stockCode}
              onClick={() => onStockCodeChange(item.stockCode)}
            >
              <Td>{item.stockCode}</Td>
              <Td>{item.syncStatus}</Td>
              <Td>{item.reviewStatus}</Td>
              <Td>{item.score ?? '-'}</Td>
              <Td>{item.rating ?? '-'}</Td>
              <Td>{item.message ?? '-'}</Td>
            </tr>
          ))}
        </DataTable>
      </Panel>
    </div>
  )
}

