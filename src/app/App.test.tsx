import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { App } from './App'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn((command: string) => {
    switch (command) {
      case 'list_trade_systems':
        return Promise.resolve([])
      case 'list_model_providers':
        return Promise.resolve([])
      case 'get_data_coverage':
        return Promise.resolve({
          stockCode: '002261',
          daily: { frequency: '1d', startDate: null, endDate: null, rows: 0 },
          weekly: { frequency: '1w', startDate: null, endDate: null, rows: 0 },
          monthly: { frequency: '1M', startDate: null, endDate: null, rows: 0 },
          quarterly: { frequency: '1Q', startDate: null, endDate: null, rows: 0 },
          yearly: { frequency: '1Y', startDate: null, endDate: null, rows: 0 },
          lastSyncAt: null
        })
      case 'get_stock_reviews':
      case 'list_watchlists':
      case 'get_stock_meta':
        return Promise.resolve(null)
      default:
        return Promise.resolve(null)
    }
  })
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(vi.fn()))
}))

vi.mock('klinecharts', () => ({
  init: vi.fn(() => null),
  dispose: vi.fn(),
  registerLocale: vi.fn(),
  registerIndicator: vi.fn(),
  ActionType: { OnCrosshairChange: 'onCrosshairChange' },
  IndicatorSeries: { Volume: 'volume' },
  YAxisType: { Log: 'log', Normal: 'normal' },
  OverlayMode: { WeakMagnet: 'weak_magnet' },
  LineType: { Solid: 'solid' }
}))

describe('App', () => {
  it('renders the desktop shell', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    })
    render(
      <QueryClientProvider client={client}>
        <App />
      </QueryClientProvider>
    )

    expect(await screen.findByText('QSGG')).toBeInTheDocument()
    expect(screen.getAllByText('我的自选').length).toBeGreaterThan(0)
  })
})
