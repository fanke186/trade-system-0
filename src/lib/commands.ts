import { invoke } from '@tauri-apps/api/core'
import type {
  Agent,
  AgentChatResult,
  ChartAnnotation,
  ChatMessage,
  CompletenessReport,
  DailyReviewRun,
  DataHealth,
  KlineBar,
  KlineCoverage,
  KlineSyncResult,
  MaterialRecord,
  ModelProvider,
  OkResult,
  ProviderTestResult,
  SaveModelProviderInput,
  Security,
  SecuritySearchResult,
  StockMeta,
  StockReview,
  TradeSystemDetail,
  TradeSystemDraft,
  TradeSystemSummary,
  TradeSystemVersion,
  Watchlist,
  WatchlistItem
} from './types'

const call = <T>(command: string, args?: Record<string, unknown>) => invoke<T>(command, args)

export const commands = {
  listTradeSystems: () => call<TradeSystemSummary[]>('list_trade_systems'),
  getTradeSystem: (tradeSystemId: string) =>
    call<TradeSystemDetail>('get_trade_system', { tradeSystemId }),
  importMaterial: (tradeSystemId: string | null, filePath: string) =>
    call<MaterialRecord>('import_material', {
      tradeSystemId,
      filePath
    }),
  generateTradeSystemDraft: (materialIds: string[], prompt?: string) =>
    call<TradeSystemDraft>('generate_trade_system_draft', {
      materialIds,
      prompt
    }),
  checkTradeSystemCompleteness: (markdown: string) =>
    call<CompletenessReport>('check_trade_system_completeness', { markdown }),
  saveTradeSystemVersion: (
    tradeSystemId: string | null,
    name: string,
    markdown: string,
    changeSummary?: string
  ) =>
    call<TradeSystemVersion>('save_trade_system_version', {
      tradeSystemId,
      name,
      markdown,
      changeSummary
    }),
  exportTradeSystemVersion: (versionId: string, targetPath: string) =>
    call<{ versionId: string; targetPath: string; bytesWritten: number }>(
      'export_trade_system_version',
      { versionId, targetPath }
    ),

  listModelProviders: () => call<ModelProvider[]>('list_model_providers'),
  saveModelProvider: (provider: SaveModelProviderInput) =>
    call<ModelProvider>('save_model_provider', { provider }),
  setActiveModelProvider: (providerId: string) =>
    call<ModelProvider>('set_active_model_provider', { providerId }),
  testModelProvider: (providerId: string) =>
    call<ProviderTestResult>('test_model_provider', { providerId }),

  createAgentFromTradeSystem: (versionId: string, providerId?: string | null) =>
    call<Agent>('create_agent_from_trade_system', {
      versionId,
      providerId
    }),
  runAgentChat: (agentId: string, messages: ChatMessage[]) =>
    call<AgentChatResult>('run_agent_chat', { agentId, messages }),

  syncKline: (stockCode: string, mode: 'full' | 'incremental', scope?: 'all' | 'incomplete' | 'symbols') =>
    call<KlineSyncResult>('sync_kline', { stockCode, mode, scope }),
  getBars: (
    stockCode: string,
    frequency: '1d' | '1w' | '1M' | '1Q' | '1Y',
    startDate?: string,
    endDate?: string,
    limit?: number,
    adj?: 'pre' | 'post' | 'none'
  ) =>
    call<KlineBar[]>('get_bars', {
      stockCode, frequency, startDate, endDate, limit, adj
    }),
  getDataCoverage: (stockCode: string) =>
    call<KlineCoverage>('get_data_coverage', { stockCode }),
  listSecurities: (keyword?: string, limit?: number) =>
    call<Security[]>('list_securities', { keyword, limit }),

  scoreStock: (stockCode: string, tradeSystemVersionId: string, providerId?: string | null) =>
    call<StockReview>('score_stock', {
      stockCode,
      tradeSystemVersionId,
      providerId
    }),
  getStockReviews: (stockCode?: string, tradeSystemVersionId?: string) =>
    call<StockReview[]>('get_stock_reviews', {
      stockCode,
      tradeSystemVersionId
    }),
  runDailyReview: (watchlistId: string, tradeSystemVersionId: string) =>
    call<DailyReviewRun>('run_daily_review', {
      watchlistId,
      tradeSystemVersionId
    }),

  listWatchlists: () => call<Watchlist[]>('list_watchlists'),
  saveWatchlist: (name: string, id?: string) => call<Watchlist>('save_watchlist', { id, name }),
  addWatchlistItem: (watchlistId: string, stockCode: string) =>
    call<WatchlistItem>('add_watchlist_item', {
      watchlistId,
      stockCode
    }),
  removeWatchlistItem: (watchlistId: string, stockCode: string) =>
    call<OkResult>('remove_watchlist_item', {
      watchlistId,
      stockCode
    }),

  getStockMeta: (stockCode: string) =>
    call<StockMeta>('get_stock_meta', { code: stockCode }),

  reorderWatchlistItem: (itemId: string, position: 'top' | 'bottom') =>
    call<null>('reorder_watchlist_item', { itemId, position }),

  moveWatchlistItem: (itemId: string, targetWatchlistId: string) =>
    call<null>('move_watchlist_item', { itemId, targetWatchlistId }),

  copyWatchlistItem: (itemId: string, targetWatchlistId: string) =>
    call<OkResult>('copy_watchlist_item', { itemId, targetWatchlistId }),

  createWatchlistGroup: (name: string) =>
    call<Watchlist>('create_watchlist_group', { name }),

  deleteWatchlistGroup: (watchlistId: string) =>
    call<OkResult>('delete_watchlist_group', { watchlistId }),

  renameWatchlistGroup: (watchlistId: string, newName: string) =>
    call<OkResult>('rename_watchlist_group', { watchlistId, newName }),

  listChartAnnotations: (stockCode: string, tradeSystemVersionId?: string | null) =>
    call<ChartAnnotation[]>('list_chart_annotations', {
      stockCode,
      tradeSystemVersionId
    }),
  saveChartAnnotation: (
    annotation: Omit<ChartAnnotation, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
  ) => call<ChartAnnotation>('save_chart_annotation', { annotation }),
  deleteChartAnnotation: (annotationId: string) =>
    call<OkResult>('delete_chart_annotation', { annotationId }),

  searchSecurities: (keyword: string, limit?: number) =>
    call<SecuritySearchResult[]>('search_securities', { keyword, limit }),

  getDataHealth: () =>
    call<DataHealth>('get_data_health'),

  syncSecuritiesMetadata: () =>
    call<number>('sync_securities_metadata'),
}
