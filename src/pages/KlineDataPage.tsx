import { useState, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, RefreshCw } from 'lucide-react'
import { listen } from '@tauri-apps/api/event'
import { cn } from '../lib/cn'
import { Panel } from '../components/shared/Panel'
import { Button } from '../components/shared/Button'
import { Badge } from '../components/shared/Badge'
import { Field, Input } from '../components/shared/Field'
import { DataTable, Td } from '../components/shared/DataTable'
import { commands } from '../lib/commands'
import { formatNumber } from '../lib/format'
import type { SecuritySearchResult, Security } from '../lib/types'

/* ------------------------------------------------------------------ */
/*  A. Data Health Banner                                              */
/* ------------------------------------------------------------------ */

function DataHealthBanner() {
  const queryClient = useQueryClient()
  const health = useQuery({
    queryKey: ['data-health'],
    queryFn: () => commands.getDataHealth(),
    refetchInterval: 30000
  })

  const moodMap: Record<string, { emoji: string; label: string }> = {
    good: { emoji: '\u{1F60A}', label: '良好' },
    ok: { emoji: '\u{1F610}', label: '一般' },
    bad: { emoji: '\u{1F61E}', label: '较差' }
  }

  const h = health.data

  return (
    <div className="flex items-center gap-5 border border-border bg-panel p-4">
      {h ? (
        <>
          <span className="text-3xl">{moodMap[h.mood]?.emoji ?? '\u{1F610}'}</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold">
              {'数据齐整度'} · {h.completenessPct.toFixed(1)}% · {moodMap[h.mood]?.label}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {'共'} {h.totalSecurities.toLocaleString()} {'只标的'} · {h.completeCount.toLocaleString()} {'只齐全'} · {h.incompleteCount.toLocaleString()} {'只待同步'}
            </div>
            {h.byMarket.length > 0 && (
              <div className="flex gap-2 mt-1.5 flex-wrap">
                {h.byMarket.slice(0, 5).map(m => (
                  <span key={m.marketType} className="text-[10px] font-mono text-muted-foreground">
                    {m.marketType || '未知'}: {m.complete}/{m.total}
                  </span>
                ))}
              </div>
            )}
          </div>
          <Button
            variant="secondary"
            icon={<RefreshCw className="h-4 w-4" />}
            onClick={async () => {
              await queryClient.invalidateQueries({ queryKey: ['data-health'] })
            }}
          >
            {'一键补齐'}
          </Button>
        </>
      ) : (
        <div className="text-sm text-muted-foreground">{'加载中...'}</div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  B. Security Autocomplete                                           */
/* ------------------------------------------------------------------ */

function SecurityAutocomplete({
  onSelect
}: {
  onSelect: (code: string) => void
}) {
  const [input, setInput] = useState('')
  const [results, setResults] = useState<SecuritySearchResult[]>([])
  const [open, setOpen] = useState(false)
  const [selectedName, setSelectedName] = useState('')

  const handleSelect = (r: SecuritySearchResult) => {
    setInput(r.code)
    setSelectedName(r.name)
    setOpen(false)
    onSelect(r.code)
  }

  useEffect(() => {
    if (input.length < 1) {
      setResults([])
      setOpen(false)
      return
    }
    const t = setTimeout(async () => {
      try {
        const r = await commands.searchSecurities(input, 15)
        setResults(r)
        setOpen(r.length > 0)
      } catch {
        setResults([])
      }
    }, 150)
    return () => clearTimeout(t)
  }, [input])

  return (
    <div className="relative mb-4">
      <div className="flex gap-2">
        <div className="w-28">
          <Field label={'代码'}>
            <Input
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={'输入代码'}
            />
          </Field>
        </div>
        <div className="flex-1">
          <Field label={'名称'}>
            <Input value={selectedName} readOnly placeholder={'自动补全'} />
          </Field>
        </div>
        <div className="flex items-end">
          <Button
            icon={<Search className="h-4 w-4" />}
            variant="primary"
            onClick={() => input && onSelect(input)}
          >
            {'检索'}
          </Button>
        </div>
      </div>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-80 border border-border bg-panel max-h-48 overflow-y-auto shadow-lg">
          {results.map(r => (
            <button
              key={r.code}
              onClick={() => handleSelect(r)}
              className="flex w-full items-center gap-3 px-3 py-1.5 text-left text-xs hover:bg-muted transition font-mono"
            >
              <span className="text-foreground w-16">{r.code}</span>
              <span className="flex-1">{r.name}</span>
              {r.marketType && <span className="text-muted-foreground text-[10px]">{r.marketType}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  C. Securities Table                                                */
/* ------------------------------------------------------------------ */

type SortField = 'code' | 'name'
type SortDir = 'asc' | 'desc'

function SecuritiesTable({ keyword }: { keyword?: string }) {
  const [sortField, setSortField] = useState<SortField>('code')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const secQuery = useQuery({
    queryKey: ['securities', keyword],
    queryFn: () => commands.listSecurities(keyword, 100)
  })

  const sorted = useMemo(() => {
    const data = secQuery.data ?? []
    return [...data].sort((a, b) => {
      const aVal = String(a[sortField])
      const bVal = String(b[sortField])
      const cmp = aVal.localeCompare(bVal, 'zh-CN')
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [secQuery.data, sortField, sortDir])

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  const sortArrow = (field: SortField) => {
    if (sortField !== field) return ''
    return sortDir === 'asc' ? ' ▲' : ' ▼'
  }

  const columns = [
    { key: 'code', label: '代码', sortable: true },
    { key: 'name', label: '名称', sortable: true },
    { key: 'price', label: '现价', sortable: false },
    { key: 'change', label: '涨幅', sortable: false },
    { key: 'industry', label: '所属行业', sortable: false },
    { key: 'status', label: '数据状态', sortable: false }
  ]

  return (
    <DataTable
      columns={columns.map(c =>
        c.sortable ? `${c.label}${sortArrow(c.key as SortField)}` : c.label
      )}
    >
      {sorted.map(security => (
        <SecuritiesRow key={security.symbolId} security={security} />
      ))}
    </DataTable>
  )
}

function SecuritiesRow({ security }: { security: Security }) {
  const queryClient = useQueryClient()
  const [syncing, setSyncing] = useState(false)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const unlisten = listen<{
      stockCode: string
      status: string
      percent: number
    }>('kline-sync-progress', event => {
      if (event.payload.stockCode === security.code) {
        setProgress(event.payload.percent)
        if (event.payload.status === 'completed') {
          setSyncing(false)
          void queryClient.invalidateQueries({ queryKey: ['securities'] })
        }
      }
    })
    return () => {
      void unlisten.then(f => f())
    }
  }, [security.code, queryClient])

  return (
    <tr className="cursor-pointer hover:bg-muted/50">
      <Td className="font-mono">{security.code}</Td>
      <Td>{security.name}</Td>
      <Td className="font-mono text-muted-foreground">-</Td>
      <Td className="font-mono text-muted-foreground">-</Td>
      <Td className="text-muted-foreground">{security.board ?? '-'}</Td>
      <Td>
        {syncing ? (
          <Badge tone="warning">{'同步中'} {progress}%</Badge>
        ) : security.status === 'active' ? (
          <Badge tone="success">{'齐全'}</Badge>
        ) : (
          <Badge tone="danger">{'缺失'}</Badge>
        )}
      </Td>
    </tr>
  )
}

/* ------------------------------------------------------------------ */
/*  D. Sync Button Row                                                 */
/* ------------------------------------------------------------------ */

function SyncRow({ stockCode }: { stockCode: string }) {
  const [syncing, setSyncing] = useState(false)
  const [progress, setProgress] = useState(0)
  const queryClient = useQueryClient()

  useEffect(() => {
    const unlisten = listen<{
      stockCode: string
      status: string
      percent: number
    }>('kline-sync-progress', event => {
      if (event.payload.stockCode === stockCode) {
        setProgress(event.payload.percent)
        if (event.payload.status === 'completed') {
          setSyncing(false)
          void queryClient.invalidateQueries({ queryKey: ['stock-meta'] })
        }
      }
    })
    return () => {
      void unlisten.then(f => f())
    }
  }, [stockCode, queryClient])

  if (!stockCode) return null

  return (
    <Button
      variant="primary"
      disabled={syncing}
      icon={
        syncing ? (
          <RefreshCw className="h-4 w-4 animate-spin" />
        ) : (
          <RefreshCw className="h-4 w-4" />
        )
      }
      onClick={async () => {
        setSyncing(true)
        try {
          await commands.syncKline(stockCode, 'incremental')
        } catch {
          setSyncing(false)
        }
      }}
    >
      {syncing ? `同步中 ${progress}%` : '同步'}
    </Button>
  )
}

/* ------------------------------------------------------------------ */
/*  E. KlineDataPage (main export)                                     */
/* ------------------------------------------------------------------ */

export function KlineDataPage({
  stockCode,
  onStockCodeChange
}: {
  stockCode: string
  onStockCodeChange: (code: string) => void
}) {
  return (
    <div className="grid gap-4">
      <DataHealthBanner />
      <Panel
        title={'证券检索'}
        action={<SyncRow stockCode={stockCode} />}
      >
        <SecurityAutocomplete onSelect={onStockCodeChange} />
        <SecuritiesTable keyword={stockCode} />
      </Panel>
    </div>
  )
}
