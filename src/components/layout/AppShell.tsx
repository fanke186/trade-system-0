import type { ReactNode } from 'react'
import appIcon from '../../assets/qsgg-transparent.png'
import { routes, type PageId } from '../../app/routes'
import type { ModelProvider, TradeSystemSummary } from '../../lib/types'
import { cn } from '../../lib/cn'
import { Badge } from '../shared/Badge'

export function AppShell({
  activePage,
  onPageChange,
  tradeSystems,
  activeProvider,
  selectedVersionId,
  children
}: {
  activePage: PageId
  onPageChange: (page: PageId) => void
  tradeSystems: TradeSystemSummary[]
  activeProvider?: ModelProvider
  selectedVersionId?: string
  children: ReactNode
}) {
  const selectedSystem = tradeSystems.find(system => system.activeVersionId === selectedVersionId)

  return (
    <div className="grid h-screen grid-cols-[200px_minmax(680px,1fr)] grid-rows-[56px_1fr] bg-background">
      <aside className="row-span-2 bg-panel/90">
        <div
          className="flex h-14 items-center gap-2 px-3 pl-[84px]"
          data-tauri-drag-region
        >
          <img src={appIcon} className="h-10 w-10 object-contain" alt="QSGG" />
          <span className="text-sm font-semibold text-foreground font-mono">QSGG</span>
        </div>
        <nav className="px-2 py-3">
          {routes.map(route => {
            const Icon = route.icon
            return (
              <button
                className={cn(
                  'mb-1 flex h-10 w-full items-center gap-2 px-3 text-left text-sm transition font-mono',
                  activePage === route.id
                    ? 'bg-ring text-panel shadow-[0_0_24px_rgba(77,144,254,0.18)]'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                )}
                key={route.id}
                onClick={() => onPageChange(route.id)}
                type="button"
              >
                <Icon className="h-4 w-4" />
                {route.label}
              </button>
            )
          })}
        </nav>
      </aside>

      <header
        className="flex items-center justify-between bg-panel/70 px-4"
        data-tauri-drag-region
      >
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>交易系统</span>
          <Badge tone={selectedVersionId ? 'success' : 'warning'}>
            {selectedSystem
              ? `${selectedSystem.name} v${selectedSystem.activeVersion ?? '-'}`
              : selectedVersionId
                ? selectedVersionId
                : '未选择'}
          </Badge>
          <span>Provider</span>
          <Badge tone={activeProvider ? 'info' : 'warning'}>{activeProvider?.name ?? '未配置'}</Badge>
        </div>
      </header>

      <main
        className={
          activePage === 'my-watchlist' || activePage === 'trade-system-agents'
            ? 'min-h-0 flex-1'
            : 'overflow-auto p-4'
        }
      >
        {children}
      </main>
    </div>
  )
}
