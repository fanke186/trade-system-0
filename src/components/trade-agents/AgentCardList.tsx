import { Edit3, Plus, Trash2 } from 'lucide-react'
import { Badge } from '../shared/Badge'
import { Button } from '../shared/Button'
import { EmptyState } from '../shared/Panel'
import { cn } from '../../lib/cn'
import type { TradeSystemSummary } from '../../lib/types'

export function AgentCardList({
  systems,
  selectedSystemId,
  onSelect,
  onCreate,
  onEdit,
  onDelete
}: {
  systems: TradeSystemSummary[]
  selectedSystemId?: string
  onSelect: (systemId: string) => void
  onCreate: () => void
  onEdit: (system: TradeSystemSummary) => void
  onDelete: (system: TradeSystemSummary) => void
}) {
  return (
    <aside className="flex min-h-0 w-[300px] shrink-0 flex-col border-r border-border bg-panel">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
        <div className="font-mono text-sm font-semibold">交易系统 Agents</div>
        <Button
          aria-label="新建交易系统 Agent"
          icon={<Plus className="h-4 w-4" />}
          onClick={onCreate}
          size="icon"
          title="新建"
          variant="secondary"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {systems.length === 0 ? (
          <EmptyState title="还没有交易系统 Agent" detail="点击右上角新建第一个交易系统。" />
        ) : (
          <div className="grid gap-2">
            {systems.map(system => {
              const active = selectedSystemId === system.id
              return (
                <button
                  className={cn(
                    'group relative border p-3 text-left transition',
                    active
                      ? 'border-ring bg-ring/10 shadow-[0_0_28px_rgba(77,144,254,0.14)]'
                      : 'border-border bg-background/40 hover:border-ring/70 hover:bg-muted/40'
                  )}
                  key={system.id}
                  onClick={() => onSelect(system.id)}
                  type="button"
                >
                  <div className="pr-16">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="truncate font-mono text-sm font-semibold text-foreground">
                        {system.name}
                      </div>
                      <Badge tone={system.completenessStatus === 'complete' ? 'success' : 'warning'}>
                        V{system.activeVersion ?? 1}
                      </Badge>
                    </div>
                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
                      {system.description?.trim() || '依据 system.md 持久化的交易系统 Agent'}
                    </p>
                    <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>关联标的 {system.stockCount ?? 0}</span>
                      <span>{formatDate(system.updatedAt)}</span>
                    </div>
                  </div>
                  <div className="absolute right-2 top-2 flex gap-1 opacity-80 transition group-hover:opacity-100">
                    <span
                      className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"
                      onClick={event => {
                        event.stopPropagation()
                        onEdit(system)
                      }}
                      role="button"
                      title="编辑"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                    </span>
                    <span
                      className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground hover:bg-danger/20 hover:text-danger"
                      onClick={event => {
                        event.stopPropagation()
                        onDelete(system)
                      }}
                      role="button"
                      title="删除"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </aside>
  )
}

function formatDate(value?: string | null) {
  if (!value) return '-'
  return value.slice(0, 10)
}
