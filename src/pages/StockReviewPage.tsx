import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, Play } from 'lucide-react'
import { Badge } from '../components/shared/Badge'
import { Button } from '../components/shared/Button'
import { DataTable, Td } from '../components/shared/DataTable'
import { Field, Input } from '../components/shared/Field'
import { Panel } from '../components/shared/Panel'
import { ProviderTag } from '../components/shared/ProviderTag'
import { TradeSystemVersionSelect } from '../components/shared/Selectors'
import { commands } from '../lib/commands'
import { jsonPreview, toErrorMessage } from '../lib/format'

export function StockReviewPage({
  stockCode,
  selectedVersionId,
  onSelectVersion,
  onStockCodeChange,
  onNavigateToSettings,
}: {
  stockCode: string
  selectedVersionId?: string
  onSelectVersion: (versionId: string | undefined) => void
  onStockCodeChange: (code: string) => void
  onNavigateToSettings?: () => void
}) {
  const queryClient = useQueryClient()
  const reviewsQuery = useQuery({
    queryKey: ['stock-reviews', stockCode, selectedVersionId],
    queryFn: () => commands.getStockReviews(stockCode, selectedVersionId),
    enabled: Boolean(stockCode)
  })
  const scoreMutation = useMutation({
    mutationFn: () => {
      if (!selectedVersionId) throw new Error('请先选择交易系统版本')
      return commands.scoreStock(stockCode, selectedVersionId)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['stock-reviews', stockCode, selectedVersionId] })
    }
  })
  const latest = scoreMutation.data ?? reviewsQuery.data?.[0]

  return (
    <div className="grid gap-4">
      <Panel
        title="单股评分"
        action={
          <Button
            icon={<Play className="h-4 w-4" />}
            variant="primary"
            disabled={!stockCode || !selectedVersionId || scoreMutation.isPending}
            onClick={() => scoreMutation.mutate()}
          >
            评分
          </Button>
        }
      >
        <div className="grid grid-cols-[180px_280px_1fr] gap-3">
          <Field label="股票代码">
            <Input value={stockCode} onChange={event => onStockCodeChange(event.target.value)} />
          </Field>
          <TradeSystemVersionSelect value={selectedVersionId} onChange={onSelectVersion} />
          <div className="flex items-end text-xs text-muted-foreground">
            评分前会检查本地 K 线覆盖；数据不足不会调用 LLM。
          </div>
        </div>
        <div className="mt-3">
          <ProviderTag onSettingsClick={onNavigateToSettings} />
        </div>
        {scoreMutation.isError ? (
          <p className="mt-3 text-xs text-danger">{toErrorMessage(scoreMutation.error)}</p>
        ) : null}
      </Panel>

      {latest ? (
        <Panel title="评分结果">
          <div className="grid grid-cols-[120px_1fr] gap-4">
            <div className="border border-border bg-muted/40 p-3">
              <div className="text-xs text-muted-foreground">分数</div>
              <div className="mt-2 text-3xl font-semibold">{latest.score ?? '-'}</div>
              <div className="mt-2">
                <Badge tone={latest.rating === 'focus' ? 'success' : latest.rating === 'reject' ? 'danger' : 'warning'}>
                  {latest.rating}
                </Badge>
              </div>
            </div>
            <div>
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Activity className="h-4 w-4 text-accent" />
                {latest.overallEvaluation}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <pre className="max-h-72 overflow-auto border border-border bg-muted/40 p-3 text-xs leading-5">
                  {jsonPreview(latest.coreReasons)}
                </pre>
                <pre className="max-h-72 overflow-auto border border-border bg-muted/40 p-3 text-xs leading-5">
                  {jsonPreview(latest.tradePlan)}
                </pre>
              </div>
            </div>
          </div>
        </Panel>
      ) : null}

      <Panel title="历史评分">
        <DataTable columns={['时间', '股票', '分数', '评级', '摘要']}>
          {(reviewsQuery.data ?? []).map(review => (
            <tr key={review.id}>
              <Td>{review.createdAt}</Td>
              <Td>{review.stockCode}</Td>
              <Td>{review.score ?? '-'}</Td>
              <Td>{review.rating}</Td>
              <Td>{review.overallEvaluation}</Td>
            </tr>
          ))}
        </DataTable>
      </Panel>
    </div>
  )
}
