import { invoke } from '@tauri-apps/api/core'
import type {
  Agent,
  AgentChatResult,
  ChartAnnotation,
  ChatMessage,
  CompletenessReport,
  DailyReviewRun,
  KlineBar,
  KlineCoverage,
  KlineSyncResult,
  MaterialRecord,
  ModelProvider,
  OkResult,
  ProviderTestResult,
  SaveModelProviderInput,
  Security,
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
    call<TradeSystemDetail>('get_trade_system', { trade_system_id: tradeSystemId }),
  importMaterial: (tradeSystemId: string | null, filePath: string) =>
    call<MaterialRecord>('import_material', {
      trade_system_id: tradeSystemId,
      file_path: filePath
    }),
  generateTradeSystemDraft: (materialIds: string[], prompt?: string) =>
    call<TradeSystemDraft>('generate_trade_system_draft', {
      material_ids: materialIds,
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
      trade_system_id: tradeSystemId,
      name,
      markdown,
      change_summary: changeSummary
    }),
  exportTradeSystemVersion: (versionId: string, targetPath: string) =>
    call<{ versionId: string; targetPath: string; bytesWritten: number }>(
      'export_trade_system_version',
      { version_id: versionId, target_path: targetPath }
    ),

  listModelProviders: () => call<ModelProvider[]>('list_model_providers'),
  saveModelProvider: (provider: SaveModelProviderInput) =>
    call<ModelProvider>('save_model_provider', { provider }),
  setActiveModelProvider: (providerId: string) =>
    call<ModelProvider>('set_active_model_provider', { provider_id: providerId }),
  testModelProvider: (providerId: string) =>
    call<ProviderTestResult>('test_model_provider', { provider_id: providerId }),

  createAgentFromTradeSystem: (versionId: string, providerId?: string | null) =>
    call<Agent>('create_agent_from_trade_system', {
      version_id: versionId,
      provider_id: providerId
    }),
  runAgentChat: (agentId: string, messages: ChatMessage[]) =>
    call<AgentChatResult>('run_agent_chat', { agent_id: agentId, messages }),

  syncKline: (stockCode: string, mode: 'full' | 'incremental') =>
    call<KlineSyncResult>('sync_kline', { stock_code: stockCode, mode }),
  getBars: (
    stockCode: string,
    frequency: '1d' | '1w' | '1M',
    startDate?: string,
    endDate?: string,
    limit?: number
  ) =>
    call<KlineBar[]>('get_bars', {
      stock_code: stockCode,
      frequency,
      start_date: startDate,
      end_date: endDate,
      limit
    }),
  getDataCoverage: (stockCode: string) =>
    call<KlineCoverage>('get_data_coverage', { stock_code: stockCode }),
  listSecurities: (keyword?: string, limit?: number) =>
    call<Security[]>('list_securities', { keyword, limit }),
  aggregateKline: (stockCode: string | null, frequency: '1w' | '1M') =>
    call<{ stockCode: string; frequency: string; rowsWritten: number }>('aggregate_kline', {
      stock_code: stockCode,
      frequency
    }),

  scoreStock: (stockCode: string, tradeSystemVersionId: string, providerId?: string | null) =>
    call<StockReview>('score_stock', {
      stock_code: stockCode,
      trade_system_version_id: tradeSystemVersionId,
      provider_id: providerId
    }),
  getStockReviews: (stockCode?: string, tradeSystemVersionId?: string) =>
    call<StockReview[]>('get_stock_reviews', {
      stock_code: stockCode,
      trade_system_version_id: tradeSystemVersionId
    }),
  runDailyReview: (watchlistId: string, tradeSystemVersionId: string) =>
    call<DailyReviewRun>('run_daily_review', {
      watchlist_id: watchlistId,
      trade_system_version_id: tradeSystemVersionId
    }),

  listWatchlists: () => call<Watchlist[]>('list_watchlists'),
  saveWatchlist: (name: string, id?: string) => call<Watchlist>('save_watchlist', { id, name }),
  addWatchlistItem: (watchlistId: string, stockCode: string) =>
    call<WatchlistItem>('add_watchlist_item', {
      watchlist_id: watchlistId,
      stock_code: stockCode
    }),
  removeWatchlistItem: (watchlistId: string, stockCode: string) =>
    call<OkResult>('remove_watchlist_item', {
      watchlist_id: watchlistId,
      stock_code: stockCode
    }),

  listChartAnnotations: (stockCode: string, tradeSystemVersionId?: string | null) =>
    call<ChartAnnotation[]>('list_chart_annotations', {
      stock_code: stockCode,
      trade_system_version_id: tradeSystemVersionId
    }),
  saveChartAnnotation: (
    annotation: Omit<ChartAnnotation, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
  ) => call<ChartAnnotation>('save_chart_annotation', { annotation }),
  deleteChartAnnotation: (annotationId: string) =>
    call<OkResult>('delete_chart_annotation', { annotation_id: annotationId })
}

