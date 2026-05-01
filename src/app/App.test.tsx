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
          lastSyncAt: null
        })
      case 'get_stock_reviews':
      case 'list_watchlists':
        return Promise.resolve([])
      default:
        return Promise.resolve(null)
    }
  })
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

    expect(await screen.findByText('trade-system-0')).toBeInTheDocument()
    expect(screen.getAllByText('每日复盘').length).toBeGreaterThan(0)
  })
})
