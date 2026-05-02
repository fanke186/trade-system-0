import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { cn } from '../../lib/cn'
import type { Watchlist } from '../../lib/types'
import type { WatchlistRow, WatchlistSortColumn, WatchlistSortDir } from '../../lib/useWatchlistViewModel'

type ContextMenuState = {
  x: number
  y: number
  row: WatchlistRow
} | null

export function WatchlistSidebar({
  activeStockCode,
  watchlists,
  currentWatchlist,
  rows,
  sortColumn,
  sortDir,
  onWatchlistChange,
  onToggleSort,
  onStockCodeChange,
  onCreateGroup,
  onRenameGroup,
  onDeleteGroup,
  onReorderItem,
  onRemoveItems,
  onCopyItems,
}: {
  activeStockCode: string
  watchlists: Watchlist[]
  currentWatchlist?: Watchlist
  rows: WatchlistRow[]
  sortColumn: WatchlistSortColumn
  sortDir: WatchlistSortDir
  onWatchlistChange: (watchlistId: string) => void
  onToggleSort: (column: WatchlistSortColumn) => void
  onStockCodeChange: (code: string) => void
  onCreateGroup: () => void
  onRenameGroup: (watchlist: Watchlist) => void
  onDeleteGroup: (watchlist: Watchlist) => void
  onReorderItem: (itemId: string, position: 'top' | 'bottom') => void
  onRemoveItems: (watchlistId: string, symbols: string[]) => void
  onCopyItems: (itemIds: string[], targetWatchlistId: string) => void
}) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null)
  const [copySubOpen, setCopySubOpen] = useState(false)
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set())
  const menuRef = useRef<HTMLDivElement>(null)
  const subRef = useRef<HTMLDivElement>(null)

  const closeContextMenu = useCallback(() => {
    setContextMenu(null)
    setCopySubOpen(false)
  }, [])

  useEffect(() => {
    if (!contextMenu) return
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (
        menuRef.current &&
        !menuRef.current.contains(target) &&
        (!subRef.current || !subRef.current.contains(target))
      ) {
        closeContextMenu()
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeContextMenu()
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [closeContextMenu, contextMenu])

  const selectedRows = useMemo(() => {
    if (!contextMenu) return []
    const ids = selectedItemIds.has(contextMenu.row.item.id)
      ? selectedItemIds
      : new Set([contextMenu.row.item.id])
    return rows.filter(row => ids.has(row.item.id))
  }, [contextMenu, rows, selectedItemIds])

  const handleContextMenu = useCallback((event: React.MouseEvent, row: WatchlistRow) => {
    event.preventDefault()
    event.stopPropagation()
    if (!selectedItemIds.has(row.item.id)) {
      setSelectedItemIds(new Set([row.item.id]))
    }
    setContextMenu({ x: event.clientX, y: event.clientY, row })
    setCopySubOpen(false)
  }, [selectedItemIds])

  return (
    <div className="flex w-40 flex-col bg-panel/75">
      <div className="flex gap-1 px-2 py-2">
        <select
          value={currentWatchlist?.id ?? ''}
          onChange={event => {
            onWatchlistChange(event.target.value)
            setSelectedItemIds(new Set())
            closeContextMenu()
          }}
          className="min-w-0 flex-1 border-0 bg-muted/45 px-2 py-1.5 text-xs text-foreground font-mono outline-none transition focus:bg-muted"
        >
          {watchlists.map(watchlist => (
            <option key={watchlist.id} value={watchlist.id}>
              {watchlist.name}
            </option>
          ))}
        </select>
        <IconButton title="新建分组" onClick={onCreateGroup}>
          <Plus className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton
          title="重命名分组"
          disabled={!currentWatchlist}
          onClick={() => currentWatchlist && onRenameGroup(currentWatchlist)}
        >
          <Pencil className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton
          title="删除分组"
          disabled={!currentWatchlist || currentWatchlist.name === '我的自选'}
          onClick={() => currentWatchlist && onDeleteGroup(currentWatchlist)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </IconButton>
      </div>

      <div className="flex px-1 text-xs text-muted-foreground">
        <HeaderButton active={sortColumn === 'name'} dir={sortDir} onClick={() => onToggleSort('name')} className="flex-1 justify-start">
          名称
        </HeaderButton>
        <HeaderButton active={sortColumn === 'changePct'} dir={sortDir} onClick={() => onToggleSort('changePct')} className="w-16 justify-end">
          涨幅
        </HeaderButton>
      </div>

      <div className="flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <div className="px-2 py-4 text-center text-xs text-muted-foreground">暂无股票</div>
        ) : null}
        {rows.map(row => {
          const meta = row.meta
          const isActive = row.symbol === activeStockCode
          const changePct = meta?.changePct
          const isUp = changePct != null && changePct >= 0
          const isDown = changePct != null && changePct < 0

          return (
            <button
              key={row.item.id}
              type="button"
              onClick={event => {
                setSelectedItemIds(previous => {
                  if (event.metaKey || event.ctrlKey) {
                    const next = new Set(previous)
                    if (next.has(row.item.id)) next.delete(row.item.id)
                    else next.add(row.item.id)
                    return next
                  }
                  return new Set([row.item.id])
                })
                onStockCodeChange(row.symbol)
              }}
              onContextMenu={event => handleContextMenu(event, row)}
              className={cn(
                'mx-1 mb-0.5 flex w-[calc(100%-0.5rem)] border-l-2 px-2 py-1.5 text-left transition',
                isActive
                  ? 'border-l-ring bg-ring/10'
                  : selectedItemIds.has(row.item.id)
                    ? 'border-l-ring/50 bg-muted/35'
                    : 'border-l-transparent hover:bg-muted/40',
              )}
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium leading-5 text-foreground">
                  {meta?.name || row.symbol}
                </span>
                <span className="truncate text-[11px] font-mono leading-4 text-muted-foreground">
                  {meta?.code ?? row.symbol}
                </span>
                {row.score != null || row.signal || row.dataHealth ? (
                  <span className="truncate text-[9px] font-mono leading-3 text-muted-foreground">
                    {row.score != null ? `评分 ${row.score}` : '评分 -'}
                    {' · '}
                    {row.signal ?? 'watch'}
                    {' · '}
                    {row.dataHealth === 'complete' ? '齐全' : row.dataHealth === 'updating' ? '更新中' : '缺失'}
                  </span>
                ) : null}
              </div>
              <div className="flex w-14 flex-col items-end">
                {changePct != null ? (
                  <>
                    <span className={cn('text-sm font-mono leading-5', isUp && 'text-danger', isDown && 'text-success')}>
                      {changePct >= 0 ? '+' : ''}
                      {changePct.toFixed(2)}%
                    </span>
                    <span className="text-[11px] font-mono leading-4 text-muted-foreground">
                      {meta?.latestPrice?.toFixed(2) ?? '-'}
                    </span>
                  </>
                ) : (
                  <span className="text-[11px] font-mono leading-5 text-muted-foreground">--</span>
                )}
              </div>
            </button>
          )
        })}
      </div>

      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-36 border border-border bg-panel py-1 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseLeave={() => setCopySubOpen(false)}
        >
          <ContextMenuItem
            label="置顶"
            onClick={() => {
              onReorderItem(contextMenu.row.item.id, 'top')
              closeContextMenu()
            }}
          />
          <ContextMenuItem
            label="置底"
            onClick={() => {
              onReorderItem(contextMenu.row.item.id, 'bottom')
              closeContextMenu()
            }}
          />
          <div className="my-1 border-t border-border" />
          <ContextMenuItem
            label="从当前分组删除"
            tone="danger"
            onClick={() => {
              if (currentWatchlist) {
                onRemoveItems(currentWatchlist.id, selectedRows.map(row => row.symbol))
              }
              closeContextMenu()
            }}
          />
          <div className="relative" onMouseEnter={() => setCopySubOpen(true)}>
            <div className="flex h-8 items-center justify-between px-3 text-xs text-foreground font-mono hover:bg-muted">
              <span>复制到</span>
              <span className="text-muted-foreground">{'>'}</span>
            </div>
            {copySubOpen && (
              <div ref={subRef} className="absolute left-full top-0 z-50 min-w-28 border border-border bg-panel py-1 shadow-lg">
                {watchlists
                  .filter(watchlist => watchlist.id !== currentWatchlist?.id)
                  .map(watchlist => (
                    <ContextMenuItem
                      key={watchlist.id}
                      label={watchlist.name}
                      onClick={() => {
                        onCopyItems(selectedRows.map(row => row.item.id), watchlist.id)
                        closeContextMenu()
                      }}
                    />
                  ))}
                {watchlists.filter(watchlist => watchlist.id !== currentWatchlist?.id).length === 0 ? (
                  <div className="px-3 py-2 text-xs text-muted-foreground">无其他分组</div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function HeaderButton({
  active,
  dir,
  className,
  onClick,
  children,
}: {
  active: boolean
  dir: WatchlistSortDir
  className?: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('flex h-7 items-center px-2 font-mono transition hover:text-foreground', className)}
    >
      {children}
      {active ? <span className="ml-0.5">{dir === 'asc' ? '▲' : '▼'}</span> : null}
    </button>
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
        tone === 'danger' ? 'text-danger hover:bg-danger/10' : 'text-foreground hover:bg-muted',
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
  children: ReactNode
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
