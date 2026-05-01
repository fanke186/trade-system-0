import { useCallback, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LineChart, PencilLine, Save } from 'lucide-react'
import { KLineChartPanel } from '../components/chart/KLineChartPanel'
import { Button } from '../components/shared/Button'
import { Badge } from '../components/shared/Badge'
import { Field, Input, Select } from '../components/shared/Field'
import { Panel } from '../components/shared/Panel'
import { commands } from '../lib/commands'
import type { ChartAnnotationPayload } from '../lib/types'
import { toErrorMessage } from '../lib/format'

export function ChartPage({
  stockCode,
  selectedVersionId,
  onStockCodeChange
}: {
  stockCode: string
  selectedVersionId?: string
  onStockCodeChange: (code: string) => void
}) {
  const [frequency, setFrequency] = useState<'1d' | '1w' | '1M'>('1d')
  const [drawingTool, setDrawingTool] = useState<'horizontal_line' | 'ray' | null>(null)
  const [pendingPayload, setPendingPayload] = useState<ChartAnnotationPayload | null>(null)
  const queryClient = useQueryClient()

  const barsQuery = useQuery({
    queryKey: ['bars', stockCode, frequency],
    queryFn: () => commands.getBars(stockCode, frequency, undefined, undefined, 800),
    enabled: Boolean(stockCode)
  })
  const annotationsQuery = useQuery({
    queryKey: ['annotations', stockCode, selectedVersionId],
    queryFn: () => commands.listChartAnnotations(stockCode, selectedVersionId),
    enabled: Boolean(stockCode)
  })
  const saveMutation = useMutation({
    mutationFn: (payload: ChartAnnotationPayload) =>
      commands.saveChartAnnotation({
        stockCode,
        tradeSystemVersionId: selectedVersionId ?? null,
        reviewId: null,
        source: 'user',
        annotationType: payload.type,
        payload
      }),
    onSuccess: () => {
      setPendingPayload(null)
      setDrawingTool(null)
      void queryClient.invalidateQueries({ queryKey: ['annotations', stockCode, selectedVersionId] })
    }
  })

  const handleDrawComplete = useCallback((payload: ChartAnnotationPayload) => {
    setPendingPayload(payload)
  }, [])

  return (
    <div className="grid gap-4">
      <Panel
        title="KLineChart"
        action={
          <div className="flex items-center gap-2">
            <Badge>{frequency}</Badge>
            <Button
              icon={<PencilLine className="h-4 w-4" />}
              variant={drawingTool === 'horizontal_line' ? 'primary' : 'secondary'}
              onClick={() => setDrawingTool('horizontal_line')}
            >
              横线
            </Button>
            <Button
              icon={<LineChart className="h-4 w-4" />}
              variant={drawingTool === 'ray' ? 'primary' : 'secondary'}
              onClick={() => setDrawingTool('ray')}
            >
              射线
            </Button>
          </div>
        }
      >
        <div className="mb-3 grid grid-cols-[160px_140px_1fr] gap-3">
          <Field label="股票代码">
            <Input value={stockCode} onChange={event => onStockCodeChange(event.target.value)} />
          </Field>
          <Field label="周期">
            <Select value={frequency} onChange={event => setFrequency(event.target.value as '1d' | '1w' | '1M')}>
              <option value="1d">日 K</option>
              <option value="1w">周 K</option>
              <option value="1M">月 K</option>
            </Select>
          </Field>
          <div className="flex items-end text-xs text-muted-foreground">
            周期切换只会重新调用 get_bars，不会触发行情同步。
          </div>
        </div>

        <KLineChartPanel
          bars={barsQuery.data ?? []}
          annotations={annotationsQuery.data ?? []}
          drawingTool={drawingTool}
          onDrawComplete={handleDrawComplete}
        />

        {pendingPayload ? (
          <div className="mt-3 flex items-center justify-between border border-border bg-muted/40 px-3 py-2 text-xs">
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
          <p className="mt-3 text-xs text-danger">{toErrorMessage(barsQuery.error)}</p>
        ) : null}
      </Panel>
    </div>
  )
}

