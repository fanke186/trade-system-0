import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '../components/shared/Button'
import { DataTable, Td } from '../components/shared/DataTable'
import { Field, Input, Select } from '../components/shared/Field'
import { Panel } from '../components/shared/Panel'
import { commands } from '../lib/commands'
import { toErrorMessage } from '../lib/format'

export function WatchlistPage({ onStockCodeChange }: { onStockCodeChange: (code: string) => void }) {
  const queryClient = useQueryClient()
  const [selectedWatchlistId, setSelectedWatchlistId] = useState<string>()
  const [watchlistName, setWatchlistName] = useState('')
  const [stockCode, setStockCode] = useState('002261')

  const watchlistsQuery = useQuery({
    queryKey: ['watchlists'],
    queryFn: commands.listWatchlists
  })
  const selectedWatchlist = useMemo(() => {
    const watchlists = watchlistsQuery.data ?? []
    return watchlists.find(item => item.id === selectedWatchlistId) ?? watchlists[0]
  }, [selectedWatchlistId, watchlistsQuery.data])

  const saveWatchlistMutation = useMutation({
    mutationFn: () => commands.saveWatchlist(watchlistName || '新股票池'),
    onSuccess: result => {
      setSelectedWatchlistId(result.id)
      setWatchlistName('')
      void queryClient.invalidateQueries({ queryKey: ['watchlists'] })
    }
  })
  const addMutation = useMutation({
    mutationFn: () => {
      if (!selectedWatchlist) throw new Error('请先创建股票池')
      return commands.addWatchlistItem(selectedWatchlist.id, stockCode)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['watchlists'] })
    }
  })
  const removeMutation = useMutation({
    mutationFn: (code: string) => {
      if (!selectedWatchlist) throw new Error('请先选择股票池')
      return commands.removeWatchlistItem(selectedWatchlist.id, code)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['watchlists'] })
    }
  })

  return (
    <div className="grid gap-4">
      <Panel
        title="股票池"
        action={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => saveWatchlistMutation.mutate()}>
            新建
          </Button>
        }
      >
        <div className="grid grid-cols-[220px_1fr] gap-3">
          <Field label="选择股票池">
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
          <Field label="新股票池名称">
            <Input value={watchlistName} onChange={event => setWatchlistName(event.target.value)} />
          </Field>
        </div>
      </Panel>

      <Panel
        title="股票列表"
        action={
          <Button
            icon={<Plus className="h-4 w-4" />}
            disabled={!stockCode || addMutation.isPending}
            onClick={() => addMutation.mutate()}
          >
            加入
          </Button>
        }
      >
        <div className="mb-3 max-w-xs">
          <Field label="股票代码">
            <Input value={stockCode} onChange={event => setStockCode(event.target.value)} />
          </Field>
        </div>
        <DataTable columns={['代码', '状态', '备注', '操作']}>
          {(selectedWatchlist?.items ?? []).map(item => (
            <tr
              className="cursor-pointer hover:bg-muted/50"
              key={item.id}
              onClick={() => onStockCodeChange(item.stockCode)}
            >
              <Td>{item.stockCode}</Td>
              <Td>{item.localStatus}</Td>
              <Td>{item.note ?? '-'}</Td>
              <Td>
                <Button
                  icon={<Trash2 className="h-4 w-4" />}
                  size="icon"
                  variant="ghost"
                  onClick={event => {
                    event.stopPropagation()
                    removeMutation.mutate(item.stockCode)
                  }}
                />
              </Td>
            </tr>
          ))}
        </DataTable>
        {addMutation.isError ? <p className="mt-2 text-xs text-danger">{toErrorMessage(addMutation.error)}</p> : null}
      </Panel>
    </div>
  )
}

