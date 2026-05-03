use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CompletenessReport {
    pub status: String,
    pub missing_sections: Vec<String>,
    pub warnings: Vec<String>,
    pub can_score: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TradeSystemSummary {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub active_version_id: Option<String>,
    pub active_version: Option<i64>,
    pub completeness_status: Option<String>,
    pub stock_count: i64,
    pub system_path: Option<String>,
    pub persona_path: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TradeSystemVersion {
    pub id: String,
    pub trade_system_id: String,
    pub version: i64,
    pub markdown: String,
    pub content_hash: String,
    pub completeness_status: String,
    pub completeness_report: CompletenessReport,
    pub change_summary: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TradeSystemDetail {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub active_version_id: Option<String>,
    pub active_version: Option<i64>,
    pub system_md: String,
    pub system_path: Option<String>,
    pub persona_md: String,
    pub persona_path: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub versions: Vec<TradeSystemVersion>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MaterialRecord {
    pub id: String,
    pub trade_system_id: Option<String>,
    pub file_name: String,
    pub file_path: String,
    pub mime_type: Option<String>,
    pub extracted_text: Option<String>,
    pub parse_status: String,
    pub parse_error: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TradeSystemDraft {
    pub markdown: String,
    pub gap_questions: Vec<String>,
    pub source_material_ids: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TradeSystemRevisionInput {
    pub mode: String,
    pub name: String,
    pub current_markdown: String,
    pub messages: Vec<ChatMessage>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TradeSystemRevisionProposal {
    pub assistant_message: String,
    pub markdown: String,
    pub diff: String,
    pub gap_questions: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RevisionPatch {
    pub assistant_message: String,
    pub ops: Vec<RevisionPatchOp>,
    pub diff: String,
    pub gap_questions: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum RevisionPatchOp {
    #[serde(rename = "replace_section")]
    ReplaceSection {
        heading: String,
        content: String,
        reason: String,
    },
    #[serde(rename = "append_to_section")]
    AppendToSection {
        heading: String,
        content: String,
        reason: String,
    },
    #[serde(rename = "ask_question")]
    AskQuestion {
        question: String,
        severity: String,
        reason: String,
    },
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub version_id: String,
    pub target_path: String,
    pub bytes_written: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelProvider {
    pub id: String,
    pub name: String,
    pub provider_type: String,
    pub base_url: String,
    pub api_key_ref: String,
    pub api_key_hint: Option<String>,
    pub model: String,
    pub temperature: f64,
    pub max_tokens: i64,
    pub enabled: bool,
    pub is_active: bool,
    pub extra_json: Value,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SaveModelProviderInput {
    pub id: Option<String>,
    pub name: String,
    pub provider_type: String,
    pub base_url: String,
    pub api_key: Option<String>,
    pub api_key_ref: Option<String>,
    pub model: String,
    pub temperature: Option<f64>,
    pub max_tokens: Option<i64>,
    pub enabled: Option<bool>,
    pub is_active: Option<bool>,
    pub extra_json: Option<Value>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTestResult {
    pub ok: bool,
    pub provider_id: String,
    pub message: String,
    pub latency_ms: Option<u128>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Agent {
    pub id: String,
    pub trade_system_id: String,
    pub trade_system_version_id: String,
    pub name: String,
    pub model_provider_id: Option<String>,
    pub system_prompt: String,
    pub output_schema_json: Value,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentChatResult {
    pub agent_id: String,
    pub content: String,
    pub raw_json: Option<Value>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Security {
    pub symbol: String,
    pub code: String,
    pub name: String,
    pub exchange: String,
    pub board: Option<String>,
    pub industry: Option<String>,
    pub stock_type: String,
    pub list_date: Option<String>,
    pub status: String,
    pub latest_price: Option<f64>,
    pub change_pct: Option<f64>,
    pub latest_date: Option<String>,
    pub data_status: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KlineBar {
    pub date: String,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub pre_close: Option<f64>,
    pub volume: f64,
    pub amount: f64,
    pub turnover: Option<f64>,
    pub adj_factor: Option<f64>,
    pub change: Option<f64>,
    pub change_pct: Option<f64>,
    pub amplitude: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FrequencyCoverage {
    pub frequency: String,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub rows: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KlineCoverage {
    pub stock_code: String,
    pub daily: FrequencyCoverage,
    pub weekly: FrequencyCoverage,
    pub monthly: FrequencyCoverage,
    pub quarterly: FrequencyCoverage,
    pub yearly: FrequencyCoverage,
    pub last_sync_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KlineSyncResult {
    pub stock_code: String,
    pub mode: String,
    pub status: String,
    pub rows_written: i64,
    pub source: String,
    pub coverage: KlineCoverage,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Watchlist {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
    pub items: Vec<WatchlistItem>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WatchlistItem {
    pub id: String,
    pub watchlist_id: String,
    pub stock_code: String,
    pub local_status: String,
    pub note: Option<String>,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StockReview {
    pub id: String,
    pub status: String,
    pub stock_code: String,
    pub trade_system_id: String,
    pub trade_system_version_id: String,
    pub model_provider_id: Option<String>,
    pub score: Option<i64>,
    pub rating: String,
    pub overall_evaluation: String,
    pub core_reasons: Value,
    pub evidence: Value,
    pub trade_plan: Value,
    pub chart_annotations: Value,
    pub uncertainty: Value,
    pub kline_coverage: Value,
    pub prompt_hash: String,
    pub output_hash: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TradeSystemStock {
    pub id: String,
    pub trade_system_id: String,
    pub symbol: String,
    pub code: String,
    pub name: String,
    pub exchange: Option<String>,
    pub industry: Option<String>,
    pub latest_score: Option<i32>,
    pub previous_report: Option<String>,
    pub previous_report_path: Option<String>,
    pub latest_report: Option<String>,
    pub latest_report_path: Option<String>,
    pub latest_score_date: Option<String>,
    pub latest_price: Option<f64>,
    pub change_pct: Option<f64>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DailyReviewRun {
    pub watchlist_id: String,
    pub trade_system_version_id: String,
    pub total: usize,
    pub results: Vec<DailyReviewItem>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DailyReviewItem {
    pub stock_code: String,
    pub sync_status: String,
    pub review_status: String,
    pub score: Option<i64>,
    pub rating: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TriggerAiScoreInput {
    pub trigger_type: String,
    pub trade_system_version_id: String,
    pub provider_id: Option<String>,
    pub stock_symbol: Option<String>,
    pub watchlist_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiScoreRecordFilter {
    pub trade_system_id: Option<String>,
    pub status: Option<String>,
    pub keyword: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiScoreRun {
    pub id: String,
    pub trigger_type: String,
    pub trade_system_id: String,
    pub trade_system_version_id: String,
    pub provider_id: Option<String>,
    pub status: String,
    pub total_count: i64,
    pub completed_count: i64,
    pub failed_count: i64,
    pub target_snapshot: Value,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiScoreRecord {
    pub id: String,
    pub run_id: String,
    pub stock_symbol: String,
    pub stock_code: String,
    pub stock_name: String,
    pub trade_system_id: String,
    pub trade_system_version_id: String,
    pub provider_id: Option<String>,
    pub trigger_time: String,
    pub score_date: String,
    pub status: String,
    pub score: Option<i64>,
    pub rating: Option<String>,
    pub stock_review_id: Option<String>,
    pub report_path: Option<String>,
    pub error_message: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChartAnnotation {
    pub id: String,
    pub stock_code: String,
    pub period: Option<String>,
    pub trade_system_version_id: Option<String>,
    pub review_id: Option<String>,
    pub source: String,
    pub annotation_type: String,
    pub payload: Value,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SaveChartAnnotationInput {
    pub id: Option<String>,
    pub stock_code: String,
    pub period: Option<String>,
    pub trade_system_version_id: Option<String>,
    pub review_id: Option<String>,
    pub source: Option<String>,
    pub annotation_type: String,
    pub payload: Value,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StockMeta {
    pub symbol: String,
    pub code: String,
    pub name: String,
    pub exchange: String,
    pub board: Option<String>,
    pub industry: Option<String>,
    pub stock_type: String,
    pub list_date: Option<String>,
    pub latest_price: Option<f64>,
    pub pre_close: Option<f64>,
    pub change: Option<f64>,
    pub change_pct: Option<f64>,
    pub latest_date: Option<String>,
    pub stale: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OkResult {
    pub ok: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentSession {
    pub id: String,
    pub trade_system_id: Option<String>,
    pub trade_system_version_id: Option<String>,
    pub purpose: String,
    pub title: Option<String>,
    pub summary: Option<String>,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessage {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub metadata_json: Value,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentPatchProposal {
    pub id: String,
    pub session_id: Option<String>,
    pub trade_system_id: Option<String>,
    pub trade_system_version_id: Option<String>,
    pub patch_json: Value,
    pub status: String,
    pub raw_llm_response: Option<String>,
    pub error_message: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SaveAgentPatchProposalInput {
    pub id: Option<String>,
    pub session_id: Option<String>,
    pub trade_system_id: Option<String>,
    pub trade_system_version_id: Option<String>,
    pub patch_json: Value,
    pub status: Option<String>,
    pub raw_llm_response: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AcceptRejectOpsInput {
    pub patch_proposal_id: String,
    pub accepted_op_indexes: Vec<usize>,
    pub edits: Option<Value>,
}
