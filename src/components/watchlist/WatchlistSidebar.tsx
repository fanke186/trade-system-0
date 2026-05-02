import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useMutation, useQuery, useQueries, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { cn } from '../../lib/cn'
import { commands } from '../../lib/commands'
import type { StockMeta, WatchlistItem } from '../../lib/types'

type SortColumn = 'name' | 'changePct'
type SortDir = 'asc' | 'desc'

interface ContextMenuState {
  x: number
  y: number
  item: WatchlistItem
}

export function WatchlistSidebar({
  stockCode: activeStockCode,
  onStockCodeChange,
}: {
  stockCode: string
  onStockCodeChange: (code: string) => void
}) {
  const queryClient = useQueryClient()
  const [selectedWatchlistId, setSelectedWatchlistId] = useState<string | undefined>()
  const [sortColumn, setSortColumn] = useState<SortColumn>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [copySubOpen, setCopySubOpen] = useState(false)
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set())
  const menuRef = useRef<HTMLDivElement>(null)
  const subRef = useRef<HTMLDivElement>(null)

  // Queries
  const watchlistsQuery = useQuery({
    queryKey: ['watchlists'],
    queryFn: commands.listWatchlists,
  })

  const watchlists = watchlistsQuery.data ?? []
  const currentWatchlist = useMemo(
    () => watchlists.find(w => w.id === selectedWatchlistId) ?? watchlists[0],
    [watchlists, selectedWatchlistId],
  )

  // Update selected ID when data first loads
  useEffect(() => {
    if (!selectedWatchlistId && watchlists.length > 0) {
      setSelectedWatchlistId(watchlists[0].id)
    }
  }, [watchlists, selectedWatchlistId])

  const items = currentWatchlist?.items ?? []

  // Fetch StockMeta for each unique stock code in the watchlist
  const stockCodes = useMemo(() => [...new Set(items.map(i => i.stockCode))], [items])
  const metaResults = useQueries({
    queries: stockCodes.map(code => ({
      queryKey: ['stock-meta', code],
      queryFn: () => commands.getStockMeta(code),
      enabled: stockCodes.length > 0,
    })),
  })

  const metaMap = useMemo(() => {
    const map = new Map<string, StockMeta>()
    stockCodes.forEach((code, i) => {
      const data = metaResults[i]?.data
      if (data) map.set(code, data)
    })
    return map
  }, [stockCodes, metaResults])

  // Merge items with meta and sort
  const sortedItems = useMemo(() => {
    const withMeta = items.map(item => ({
      item,
      meta: metaMap.get(item.stockCode),
    }))

    withMeta.sort((a, b) => {
      let cmp: number
      if (sortColumn === 'name') {
        const nameA = a.meta?.name || a.item.stockCode
        const nameB = b.meta?.name || b.item.stockCode
        cmp = nameA.localeCompare(nameB, 'zh-CN')
      } else {
        const pctA = a.meta?.changePct ?? 0
        const pctB = b.meta?.changePct ?? 0
        cmp = pctA - pctB
      }
      return sortDir === 'asc' ? cmp : -cmp
    })

    return withMeta
  }, [items, metaMap, sortColumn, sortDir])

  // Mutations
  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['watchlists'] })
  }, [queryClient])

  const reorderMutation = useMutation({
    mutationFn: ({ itemId, position }: { itemId: string; position: 'top' | 'bottom' }) =>
      commands.reorderWatchlistItem(itemId, position),
    onSuccess: invalidate,
  })

  const removeMutation = useMutation({
    mutationFn: ({ watchlistId, stockCode }: { watchlistId: string; stockCode: string }) =>
      commands.removeWatchlistItem(watchlistId, stockCode),
    onSuccess: invalidate,
  })

  const copyMutation = useMutation({
    mutationFn: ({ itemId, targetWatchlistId }: { itemId: string; targetWatchlistId: string }) =>
      commands.copyWatchlistItem(itemId, targetWatchlistId),
    onSuccess: invalidate,
  })

  const createGroupMutation = useMutation({
    mutationFn: (name: string) => commands.createWatchlistGroup(name),
    onSuccess: created => {
      invalidate()
      if (typeof created === 'object' && created && 'id' in created) {
        setSelectedWatchlistId(String(created.id))
      }
    },
  })

  const renameGroupMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => commands.renameWatchlistGroup(id, name),
    onSuccess: invalidate,
  })

  const deleteGroupMutation = useMutation({
    mutationFn: (id: string) => commands.deleteWatchlistGroup(id),
    onSuccess: () => {
      setSelectedWatchlistId(undefined)
      invalidate()
    },
  })

  // Sort toggle
  const toggleSort = useCallback(
    (column: SortColumn) => {
      if (sortColumn === column) {
        setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
      } else {
        setSortColumn(column)
        setSortDir('asc')
      }
    },
    [sortColumn],
  )

  // Context menu handlers
  const handleContextMenu = useCallback(
    (e: React.MouseEvent, item: WatchlistItem) => {
      e.preventDefault()
      e.stopPropagation()
      if (!selectedItemIds.has(item.id)) {
        setSelectedItemIds(new Set([item.id]))
      }
      setContextMenu({ x: e.clientX, y: e.clientY, item })
      setCopySubOpen(false)
    },
    [selectedItemIds],
  )

  const closeContextMenu = useCallback(() => {
    setContextMenu(null)
    setCopySubOpen(false)
  }, [])

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return
    const handler = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        (!subRef.current || !subRef.current.contains(e.target as Node))
      ) {
        closeContextMenu()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [contextMenu, closeContextMenu])

  // Close context menu on escape
  useEffect(() => {
    if (!contextMenu) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeContextMenu()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [contextMenu, closeContextMenu])

  // Group selector change
  const handleGroupChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedWatchlistId(e.target.value)
    setSelectedItemIds(new Set())
    closeContextMenu()
  }, [closeContextMenu])

  const contextItems = useMemo(() => {
    if (!contextMenu) return []
    const ids = selectedItemIds.has(contextMenu.item.id) ? selectedItemIds : new Set([contextMenu.item.id])
    return items.filter(item => ids.has(item.id))
  }, [contextMenu, items, selectedItemIds])

  const handleCreateGroup = useCallback(() => {
    const name = window.prompt('新分组名称')?.trim()
    if (name) createGroupMutation.mutate(name)
  }, [createGroupMutation])

  const handleRenameGroup = useCallback(() => {
    if (!currentWatchlist) return
    const name = window.prompt('分组名称', currentWatchlist.name)?.trim()
    if (name && name !== currentWatchlist.name) {
      renameGroupMutation.mutate({ id: currentWatchlist.id, name })
    }
  }, [currentWatchlist, renameGroupMutation])

  const handleDeleteGroup = useCallback(() => {
    if (!currentWatchlist || currentWatchlist.name === '我的自选') return
    if (window.confirm(`删除分组「${currentWatchlist.name}」？`)) {
      deleteGroupMutation.mutate(currentWatchlist.id)
    }
  }, [currentWatchlist, deleteGroupMutation])

  return (
    <div className="flex w-40 flex-col bg-panel/75">
      {/* Group selector */}
      <div className="flex gap-1 px-2 py-2">
        <select
          value={currentWatchlist?.id ?? ''}
          onChange={handleGroupChange}
          className="min-w-0 flex-1 border-0 bg-muted/45 px-2 py-1.5 text-xs text-foreground font-mono outline-none transition focus:bg-muted"
        >
          {watchlists.map(w => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <IconButton title="新建分组" onClick={handleCreateGroup}>
          <Plus className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton title="重命名分组" onClick={handleRenameGroup}>
          <Pencil className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton title="删除分组" onClick={handleDeleteGroup} disabled={currentWatchlist?.name === '我的自选'}>
          <Trash2 className="h-3.5 w-3.5" />
        </IconButton>
      </div>

      {/* Column headers */}
      <div className="flex px-1 text-xs text-muted-foreground">
        <button
          type="button"
          onClick={() => toggleSort('name')}
          className="flex h-7 flex-1 items-center px-2 text-left font-mono transition hover:text-foreground"
        >
          名称
          {sortColumn === 'name' && (
            <span className="ml-0.5">{sortDir === 'asc' ? '▲' : '▼'}</span>
          )}
        </button>
        <button
          type="button"
          onClick={() => toggleSort('changePct')}
          className="flex h-7 w-16 items-center justify-end px-2 font-mono transition hover:text-foreground"
        >
          涨幅
          {sortColumn === 'changePct' && (
            <span className="ml-0.5">{sortDir === 'asc' ? '▲' : '▼'}</span>
          )}
        </button>
      </div>

      {/* Stock list */}
      <div className="flex-1 overflow-y-auto">
        {sortedItems.length === 0 && (
          <div className="px-2 py-4 text-center text-xs text-muted-foreground">
            暂无股票
          </div>
        )}
        {sortedItems.map(({ item, meta }) => {
          const isActive = item.stockCode === activeStockCode
          const changePct = meta?.changePct
          const isUp = changePct !== null && changePct !== undefined && changePct >= 0
          const isDown = changePct !== null && changePct !== undefined && changePct < 0

          return (
            <button
              key={item.id}
              type="button"
              onClick={event => {
                setSelectedItemIds(prev => {
                  if (event.metaKey || event.ctrlKey) {
                    const next = new Set(prev)
                    if (next.has(item.id)) next.delete(item.id)
                    else next.add(item.id)
                    return next
                  }
                  return new Set([item.id])
                })
                onStockCodeChange(item.stockCode)
              }}
              onContextMenu={e => handleContextMenu(e, item)}
              className={cn(
                'mx-1 mb-0.5 flex w-[calc(100%-0.5rem)] border-l-2 px-2 py-1.5 text-left transition',
                isActive
                  ? 'border-l-ring bg-ring/10'
                  : selectedItemIds.has(item.id)
                    ? 'border-l-ring/50 bg-muted/35'
                  : 'border-l-transparent hover:bg-muted/40',
              )}
            >
              {/* Left: name + code */}
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium text-foreground leading-5">
                  {meta?.name || item.stockCode}
                </span>
                <span className="truncate text-[11px] text-muted-foreground font-mono leading-4">
                  {meta?.code ?? item.stockCode}
                </span>
              </div>
              {/* Right: changePct + price */}
              <div className="flex w-14 flex-col items-end">
                {changePct !== null && changePct !== undefined ? (
                  <>
                    <span
                      className={cn(
                        'text-sm leading-5 font-mono',
                        isUp && 'text-danger',
                        isDown && 'text-success',
                      )}
                    >
                      {changePct >= 0 ? '+' : ''}
                      {changePct.toFixed(2)}%
                    </span>
                    <span className="text-[11px] text-muted-foreground font-mono leading-4">
                      {meta?.latestPrice?.toFixed(2) ?? '-'}
                    </span>
                  </>
                ) : (
                  <span className="text-[11px] text-muted-foreground font-mono leading-5">--</span>
                )}
              </div>
            </button>
          )
        })}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <>
          <div
            ref={menuRef}
            className="fixed z-50 min-w-36 border border-border bg-panel py-1 shadow-lg"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onMouseLeave={() => setCopySubOpen(false)}
          >
            <ContextMenuItem
              label="置顶"
              onClick={() => {
                reorderMutation.mutate({ itemId: contextMenu.item.id, position: 'top' })
                closeContextMenu()
              }}
            />
            <ContextMenuItem
              label="置底"
              onClick={() => {
                reorderMutation.mutate({ itemId: contextMenu.item.id, position: 'bottom' })
                closeContextMenu()
              }}
            />
            <div className="my-1 border-t border-border" />
            <ContextMenuItem
              label="从当前分组删除"
              tone="danger"
              onClick={() => {
                if (currentWatchlist) {
                  contextItems.forEach(item => {
                    removeMutation.mutate({
                      watchlistId: currentWatchlist.id,
                      stockCode: item.stockCode,
                    })
                  })
                }
                closeContextMenu()
              }}
            />
            <div
              className="relative"
              onMouseEnter={() => setCopySubOpen(true)}
            >
              <div className="flex h-8 items-center justify-between px-3 text-xs text-foreground font-mono hover:bg-muted">
                <span>复制到</span>
                <span className="text-muted-foreground">{'▶'}</span>
              </div>
              {copySubOpen && (
                <div
                  ref={subRef}
                  className="absolute left-full top-0 z-50 min-w-28 border border-border bg-panel py-1 shadow-lg"
                >
                  {watchlists
                    .filter(w => w.id !== currentWatchlist?.id)
                    .map(w => (
                      <ContextMenuItem
                        key={w.id}
                        label={w.name}
                        onClick={() => {
                          contextItems.forEach(item => {
                            copyMutation.mutate({
                              itemId: item.id,
                              targetWatchlistId: w.id,
                            })
                          })
                          closeContextMenu()
                        }}
                      />
                    ))}
                  {watchlists.filter(w => w.id !== currentWatchlist?.id).length === 0 && (
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      无其他分组
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function ContextMenuItem({
  label,
  tone,
  onClick,
}: {
  label: string
  tone?: 'danger'
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-8 w-full items-center px-3 text-left text-xs font-mono transition',
        tone === 'danger'
          ? 'text-danger hover:bg-danger/10'
          : 'text-foreground hover:bg-muted',
      )}
    >
      {label}
    </button>
  )
}

function IconButton({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="flex h-7 w-7 shrink-0 items-center justify-center bg-muted/45 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  )
}
