export type AppError = {
  code: string
  message: string
  detail?: unknown
  recoverable: boolean
}

export type CompletenessReport = {
  status: string
  missingSections: string[]
  warnings: string[]
  canScore: boolean
}

export type TradeSystemSummary = {
  id: string
  name: string
  description?: string | null
  activeVersionId?: string | null
  activeVersion?: number | null
  completenessStatus?: string | null
  stockCount: number
  systemPath?: string | null
  personaPath?: string | null
  updatedAt: string
}

export type TradeSystemVersion = {
  id: string
  tradeSystemId: string
  version: number
  markdown: string
  contentHash: string
  completenessStatus: string
  completenessReport: CompletenessReport
  changeSummary?: string | null
  createdAt: string
}

export type TradeSystemDetail = {
  id: string
  name: string
  description?: string | null
  activeVersionId?: string | null
  activeVersion?: number | null
  systemMd: string
  systemPath?: string | null
  personaMd: string
  personaPath?: string | null
  createdAt: string
  updatedAt: string
  versions: TradeSystemVersion[]
}

export type MaterialRecord = {
  id: string
  tradeSystemId?: string | null
  fileName: string
  filePath: string
  mimeType?: string | null
  extractedText?: string | null
  parseStatus: string
  parseError?: string | null
  createdAt: string
}

export type TradeSystemDraft = {
  markdown: string
  gapQuestions: string[]
  sourceMaterialIds: string[]
}

export type TradeSystemRevisionInput = {
  mode: 'create' | 'edit'
  name: string
  currentMarkdown: string
  messages: ChatMessage[]
}

export type TradeSystemRevisionProposal = {
  assistantMessage: string
  markdown: string
  diff: string
  gapQuestions: string[]
}

export type ModelProvider = {
  id: string
  name: string
  providerType: string
  baseUrl: string
  apiKeyRef: string
  apiKeyHint?: string | null
  model: string
  temperature: number
  maxTokens: number
  enabled: boolean
  isActive: boolean
  extraJson: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type SaveModelProviderInput = {
  id?: string
  name: string
  providerType: string
  baseUrl: string
  apiKey?: string
  apiKeyRef?: string
  model: string
  temperature?: number
  maxTokens?: number
  enabled?: boolean
  isActive?: boolean
  extraJson?: Record<string, unknown>
}

export type ProviderTestResult = {
  ok: boolean
  providerId: string
  message: string
  latencyMs?: number | null
}

export type Agent = {
  id: string
  tradeSystemId: string
  tradeSystemVersionId: string
  name: string
  modelProviderId?: string | null
  systemPrompt: string
  outputSchemaJson: unknown
  createdAt: string
  updatedAt: string
}

export type ChatMessage = {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export type AgentChatResult = {
  agentId: string
  content: string
  rawJson?: unknown
}

export type KlineBar = {
  date: string
  open: number
  high: number
  low: number
  close: number
  preClose?: number | null
  volume: number
  amount: number
  turnover?: number | null
  adjFactor?: number | null
  change?: number | null
  changePct?: number | null
  amplitude?: number | null
  ma?: Record<string, number | null>
}

export type SignalMarker = {
  symbol: string
  tradeDate: string
  type: 'buy' | 'sell' | 'watch' | 'risk'
  price?: number
  label: string
  score?: number
}

export type FrequencyCoverage = {
  frequency: string
  startDate?: string | null
  endDate?: string | null
  rows: number
}

export type KlineCoverage = {
  stockCode: string
  daily: FrequencyCoverage
  weekly: FrequencyCoverage
  monthly: FrequencyCoverage
  quarterly: FrequencyCoverage
  yearly: FrequencyCoverage
  lastSyncAt?: string | null
}

export type KlineSyncResult = {
  stockCode: string
  mode: string
  status: string
  rowsWritten: number
  source: string
  coverage: KlineCoverage
}

export type Security = {
  symbol: string
  code: string
  name: string
  exchange: string
  board?: string | null
  industry?: string | null
  stockType: string
  listDate?: string | null
  status: string
  latestPrice?: number | null
  changePct?: number | null
  latestDate?: string | null
  dataStatus: string
}

export type WatchlistItem = {
  id: string
  watchlistId: string
  stockCode: string
  localStatus: string
  note?: string | null
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export type Watchlist = {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  items: WatchlistItem[]
}

export type StockReview = {
  id: string
  status: string
  stockCode: string
  tradeSystemId: string
  tradeSystemVersionId: string
  modelProviderId?: string | null
  score?: number | null
  rating: 'focus' | 'watch' | 'reject' | 'data_required' | 'undefined_rule'
  overallEvaluation: string
  coreReasons: unknown
  evidence: unknown
  tradePlan: unknown
  chartAnnotations: unknown
  uncertainty: unknown
  klineCoverage: unknown
  promptHash: string
  outputHash: string
  createdAt: string
}

export type TradeSystemStock = {
  id: string
  tradeSystemId: string
  symbol: string
  code: string
  name: string
  exchange?: string | null
  industry?: string | null
  latestScore?: number | null
  previousReport?: string | null
  previousReportPath?: string | null
  latestReport?: string | null
  latestReportPath?: string | null
  latestScoreDate?: string | null
  latestPrice?: number | null
  changePct?: number | null
  updatedAt?: string | null
}

export type DailyReviewRun = {
  watchlistId: string
  tradeSystemVersionId: string
  total: number
  results: DailyReviewItem[]
}

export type DailyReviewItem = {
  stockCode: string
  syncStatus: string
  reviewStatus: string
  score?: number | null
  rating?: string | null
  message?: string | null
}

export type TriggerAiScoreInput = {
  triggerType: 'trade_system_agent' | 'single_stock' | 'watchlist'
  tradeSystemVersionId: string
  providerId?: string | null
  stockSymbol?: string | null
  watchlistId?: string | null
}

export type AiScoreRecordFilter = {
  tradeSystemId?: string | null
  status?: string | null
  keyword?: string | null
  limit?: number | null
}

export type AiScoreRun = {
  id: string
  triggerType: string
  tradeSystemId: string
  tradeSystemVersionId: string
  providerId?: string | null
  status: string
  totalCount: number
  completedCount: number
  failedCount: number
  targetSnapshot: unknown
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
}

export type AiScoreRecord = {
  id: string
  runId: string
  stockSymbol: string
  stockCode: string
  stockName: string
  tradeSystemId: string
  tradeSystemVersionId: string
  providerId?: string | null
  triggerTime: string
  scoreDate: string
  status: string
  score?: number | null
  rating?: string | null
  stockReviewId?: string | null
  reportPath?: string | null
  errorMessage?: string | null
  startedAt?: string | null
  completedAt?: string | null
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
}

export type ChartAnnotation = {
  id: string
  stockCode: string
  period?: '1d' | '1w' | '1M' | '1Q' | '1Y' | null
  tradeSystemVersionId?: string | null
  reviewId?: string | null
  source: 'user' | 'agent'
  annotationType: 'horizontal_line' | 'ray'
  payload: ChartAnnotationPayload
  createdAt: string
  updatedAt: string
}

export type SnapTarget = 'open' | 'high' | 'low' | 'close'

export type ChartAnnotationPayload =
  | {
      type: 'horizontal_line'
      price: number
      label?: string
      reason?: string
      color?: string
      snappedTo?: SnapTarget
    }
  | {
      type: 'ray'
      start: { date: string; price: number; snappedTo?: SnapTarget }
      end: { date: string; price: number; snappedTo?: SnapTarget }
      label?: string
      reason?: string
      snappedTo?: SnapTarget
      color?: string
    }

export type OkResult = {
  ok: boolean
}

export type SecuritySearchResult = {
  symbol: string
  code: string
  name: string
  marketType?: string | null
  stockType: string
}

export type DataHealth = {
  totalSecurities: number
  completeCount: number
  incompleteCount: number
  completenessPct: number
  mood: 'good' | 'ok' | 'bad'
  byMarket: Array<{ marketType: string; total: number; complete: number }>
}

export type StockMeta = {
  symbol: string
  code: string
  name: string
  exchange: string
  board?: string | null
  industry?: string | null
  stockType: string
  listDate?: string | null
  latestPrice?: number | null
  preClose?: number | null
  change?: number | null
  changePct?: number | null
  latestDate?: string | null
  stale: boolean
}
