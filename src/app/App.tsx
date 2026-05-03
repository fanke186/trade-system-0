import { type ReactElement, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AppShell } from '../components/layout/AppShell'
import { commands } from '../lib/commands'
import type { PageId } from './routes'
import { DailyReviewPage } from '../pages/DailyReviewPage'
import { TradeSystemAgentsPage } from '../pages/TradeSystemAgentsPage'
import { StockReviewPage } from '../pages/StockReviewPage'
import { MyWatchlistPage } from '../pages/MyWatchlistPage'
import { KlineDataPage } from '../pages/KlineDataPage'
import { SettingsPage } from '../pages/SettingsPage'

export function App() {
  const [activePage, setActivePage] = useState<PageId>('my-watchlist')
  const [stockCode, setStockCode] = useState('002261.SZ')
  const [selectedVersionId, setSelectedVersionId] = useState<string | undefined>()

  const tradeSystemsQuery = useQuery({
    queryKey: ['trade-systems'],
    queryFn: commands.listTradeSystems
  })
  const providersQuery = useQuery({
    queryKey: ['model-providers'],
    queryFn: commands.listModelProviders
  })
  const tradeSystems = tradeSystemsQuery.data ?? []
  const activeProvider = providersQuery.data?.find(provider => provider.isActive)

  const activeVersionId = useMemo(() => {
    if (selectedVersionId) return selectedVersionId
    return tradeSystems.find(system => system.activeVersionId)?.activeVersionId ?? undefined
  }, [selectedVersionId, tradeSystems])

  const page = {
    'daily-review': (
      <DailyReviewPage
        selectedVersionId={activeVersionId}
        onSelectVersion={setSelectedVersionId}
        stockCode={stockCode}
        onStockCodeChange={setStockCode}
        onNavigateToSettings={() => setActivePage('settings')}
      />
    ),
    'trade-system-agents': (
      <TradeSystemAgentsPage
        selectedVersionId={activeVersionId}
        onSelectVersion={setSelectedVersionId}
        onNavigateToSettings={() => setActivePage('settings')}
      />
    ),
    'stock-review': (
      <StockReviewPage
        selectedVersionId={activeVersionId}
        onSelectVersion={setSelectedVersionId}
        stockCode={stockCode}
        onStockCodeChange={setStockCode}
        onNavigateToSettings={() => setActivePage('settings')}
      />
    ),
    'my-watchlist': (
      <MyWatchlistPage
        selectedVersionId={activeVersionId}
        stockCode={stockCode}
        onStockCodeChange={setStockCode}
      />
    ),
    'kline-data': <KlineDataPage stockCode={stockCode} onStockCodeChange={setStockCode} />,
    settings: <SettingsPage />
  } satisfies Record<PageId, ReactElement>

  return (
    <AppShell
      activePage={activePage}
      onPageChange={setActivePage}
      tradeSystems={tradeSystems}
      activeProvider={activeProvider}
      selectedVersionId={activeVersionId}
    >
      {page[activePage]}
    </AppShell>
  )
}
