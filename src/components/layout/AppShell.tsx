import { type ReactNode, useCallback } from 'react'
import { Cpu, Settings } from 'lucide-react'
import appIcon from '../../assets/qsgg-transparent.png'
import { routes, type PageId } from '../../app/routes'
import type { ModelProvider, TradeSystemSummary } from '../../lib/types'
import { cn } from '../../lib/cn'
import { Badge } from '../shared/Badge'
import { TitleBar } from './TitleBar'

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

  const handleHeaderDoubleClick = useCallback(async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      getCurrentWindow().toggleMaximize()
    } catch { /* not in Tauri */ }
  }, [])

  return (
    <div className="grid h-screen grid-cols-[200px_minmax(680px,1fr)] grid-rows-[36px_1fr] bg-background">
      <header
        className="col-span-2 grid grid-cols-[200px_1fr_auto] items-center border-b border-border/60 bg-panel/95"
        data-tauri-drag-region
        onDoubleClick={handleHeaderDoubleClick}
      >
        <div className="flex items-center gap-2 pl-[72px]">
          <img src={appIcon} className="h-7 w-7 object-contain" alt="QSGG" />
          <div className="leading-tight">
            <div className="font-mono text-xs font-semibold text-foreground">QSGG</div>
            <div className="text-[9px] font-mono text-muted-foreground">trade desk</div>
          </div>
        </div>

        <div className="flex justify-center">
          <div className="inline-flex items-center gap-1 rounded-[6px] bg-muted/45 p-0.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]">
            <StatusPill label="交易系统" value={selectedSystem ? `${selectedSystem.name} v${selectedSystem.activeVersion ?? '-'}` : selectedVersionId ? selectedVersionId : '未选择'} tone={selectedVersionId ? 'success' : 'warning'} />
            <StatusPill label="Provider" value={activeProvider?.name ?? '未配置'} tone={activeProvider ? 'info' : 'warning'} />
          </div>
        </div>

        <div className="flex items-center">
          <button
            type="button"
            onClick={() => onPageChange('settings')}
            className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground transition hover:bg-muted hover:text-foreground"
            title="设置"
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
          <TitleBar />
        </div>
      </header>

      <aside className="bg-panel/90">
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

      <main
        className={
          activePage === 'my-watchlist' || activePage === 'trade-system-agents'
            ? 'min-h-0 flex-1'
            : activePage === 'kline-data'
              ? 'min-h-0 overflow-hidden p-4'
              : 'overflow-auto p-4'
        }
      >
        {children}
      </main>
    </div>
  )
}

function StatusPill({
  label,
  value,
  tone
}: {
  label: string
  value: string
  tone: 'success' | 'warning' | 'info'
}) {
  return (
    <div className="flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-[11px]">
      <Cpu className="h-3 w-3 text-muted-foreground" />
      <span className="text-muted-foreground">{label}</span>
      <Badge tone={tone}>{value}</Badge>
    </div>
  )
}
