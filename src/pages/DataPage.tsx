import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Search } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../components/shared/Button'
import { DataTable, Td } from '../components/shared/DataTable'
import { Field, Input, Select } from '../components/shared/Field'
import { Panel } from '../components/shared/Panel'
import { commands } from '../lib/commands'
import { formatDateTime, formatRows, toErrorMessage } from '../lib/format'

export function DataPage({
  stockCode,
  onStockCodeChange
}: {
  stockCode: string
  onStockCodeChange: (code: string) => void
}) {
  const [mode, setMode] = useState<'full' | 'incremental'>('incremental')
  const [keyword, setKeyword] = useState('')
  const queryClient = useQueryClient()

  const coverageQuery = useQuery({
    queryKey: ['coverage', stockCode],
    queryFn: () => commands.getDataCoverage(stockCode),
    enabled: Boolean(stockCode)
  })
  const securitiesQuery = useQuery({
    queryKey: ['securities', keyword],
    queryFn: () => commands.listSecurities(keyword, 30)
  })
  const syncMutation = useMutation({
    mutationFn: () => commands.syncKline(stockCode, mode),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['coverage', stockCode] })
      void queryClient.invalidateQueries({ queryKey: ['bars'] })
    }
  })

  return (
    <div className="grid gap-4">
      <Panel
        title="单股 K 线同步"
        action={
          <Button
            icon={<RefreshCw className="h-4 w-4" />}
            onClick={() => syncMutation.mutate()}
            disabled={!stockCode || syncMutation.isPending}
            variant="primary"
          >
            同步
          </Button>
        }
      >
        <div className="grid grid-cols-[180px_180px_1fr] gap-3">
          <Field label="股票代码">
            <Input value={stockCode} onChange={event => onStockCodeChange(event.target.value)} />
          </Field>
          <Field label="同步模式">
            <Select value={mode} onChange={event => setMode(event.target.value as 'full' | 'incremental')}>
              <option value="incremental">增量</option>
              <option value="full">全量</option>
            </Select>
          </Field>
          <div className="flex items-end text-xs text-muted-foreground">
            {syncMutation.isError
              ? toErrorMessage(syncMutation.error)
              : syncMutation.data
                ? `${syncMutation.data.status} / ${syncMutation.data.rowsWritten} 行 / ${syncMutation.data.source}`
                : '同步是唯一下载入口，图表和评分不会自动下载行情。'}
          </div>
        </div>
      </Panel>

      <Panel title="覆盖范围">
        <DataTable columns={['周期', '开始', '结束', '行数', '最近同步']}>
          {(['daily', 'weekly', 'monthly'] as const).map(key => {
            const item = coverageQuery.data?.[key]
            return (
              <tr key={key}>
                <Td>{item?.frequency ?? key}</Td>
                <Td>{item?.startDate ?? '-'}</Td>
                <Td>{item?.endDate ?? '-'}</Td>
                <Td>{formatRows(item?.rows)}</Td>
                <Td>{formatDateTime(coverageQuery.data?.lastSyncAt)}</Td>
              </tr>
            )
          })}
        </DataTable>
      </Panel>

      <Panel title="证券搜索">
        <div className="mb-3 flex max-w-md items-center gap-2">
          <Input
            placeholder="代码或名称"
            value={keyword}
            onChange={event => setKeyword(event.target.value)}
          />
          <Button icon={<Search className="h-4 w-4" />} size="icon" />
        </div>
        <DataTable columns={['代码', '名称', '交易所', '板块', '上市日期', '状态']}>
          {(securitiesQuery.data ?? []).map(security => (
            <tr
              className="cursor-pointer hover:bg-muted/50"
              key={security.symbolId}
              onClick={() => onStockCodeChange(security.code)}
            >
              <Td>{security.code}</Td>
              <Td>{security.name}</Td>
              <Td>{security.exchange}</Td>
              <Td>{security.board ?? '-'}</Td>
              <Td>{security.listDate ?? '-'}</Td>
              <Td>{security.status}</Td>
            </tr>
          ))}
        </DataTable>
      </Panel>
    </div>
  )
}

