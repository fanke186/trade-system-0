use crate::app_state::AppState;
use crate::error::AppResult;
use crate::models::{
    CompletenessReport, ExportResult, MaterialRecord, OkResult, TradeSystemDetail,
    TradeSystemDraft, TradeSystemRevisionInput, TradeSystemRevisionProposal, TradeSystemStock,
    TradeSystemSummary, TradeSystemVersion,
};
use crate::services::{material_service, trade_system_service};
use tauri::State;

#[tauri::command]
pub fn list_trade_systems(state: State<'_, AppState>) -> AppResult<Vec<TradeSystemSummary>> {
    let conn = state.sqlite.lock().expect("sqlite lock");
    trade_system_service::list_trade_systems(&conn)
}

#[tauri::command]
pub fn get_trade_system(
    state: State<'_, AppState>,
    trade_system_id: String,
) -> AppResult<TradeSystemDetail> {
    let conn = state.sqlite.lock().expect("sqlite lock");
    trade_system_service::get_trade_system(&conn, &trade_system_id)
}

#[tauri::command]
pub fn import_material(
    state: State<'_, AppState>,
    trade_system_id: Option<String>,
    file_path: String,
) -> AppResult<MaterialRecord> {
    let conn = state.sqlite.lock().expect("sqlite lock");
    material_service::import_material(&conn, &state.app_dir, trade_system_id, file_path)
}

#[tauri::command]
pub fn generate_trade_system_draft(
    state: State<'_, AppState>,
    material_ids: Vec<String>,
    prompt: Option<String>,
) -> AppResult<TradeSystemDraft> {
    let conn = state.sqlite.lock().expect("sqlite lock");
    trade_system_service::generate_draft_from_materials(&conn, material_ids, prompt)
}

#[tauri::command]
pub async fn propose_trade_system_revision(
    state: State<'_, AppState>,
    input: TradeSystemRevisionInput,
) -> AppResult<TradeSystemRevisionProposal> {
    trade_system_service::propose_revision(&state, input).await
}

#[tauri::command]
pub fn check_trade_system_completeness(markdown: String) -> AppResult<CompletenessReport> {
    Ok(trade_system_service::check_completeness(&markdown))
}

#[tauri::command]
pub fn save_trade_system_version(
    state: State<'_, AppState>,
    trade_system_id: Option<String>,
    name: String,
    markdown: String,
    change_summary: Option<String>,
) -> AppResult<TradeSystemVersion> {
    let conn = state.sqlite.lock().expect("sqlite lock");
    trade_system_service::save_version(
        &conn,
        &state.app_dir,
        trade_system_id,
        name,
        markdown,
        change_summary,
    )
}

#[tauri::command]
pub fn export_trade_system_version(
    state: State<'_, AppState>,
    version_id: String,
    target_path: String,
) -> AppResult<ExportResult> {
    let conn = state.sqlite.lock().expect("sqlite lock");
    trade_system_service::export_version(&conn, &version_id, &target_path)
}

#[tauri::command]
pub fn add_trade_system_stocks(
    state: State<'_, AppState>,
    trade_system_id: String,
    symbols: Vec<String>,
) -> AppResult<OkResult> {
    let conn = state.sqlite.lock().expect("sqlite lock");
    let duck = state.duckdb.lock().expect("duckdb lock");
    trade_system_service::add_stocks(&conn, &duck, &trade_system_id, symbols)
}

#[tauri::command]
pub fn remove_trade_system_stock(
    state: State<'_, AppState>,
    trade_system_id: String,
    symbol: String,
) -> AppResult<OkResult> {
    let conn = state.sqlite.lock().expect("sqlite lock");
    trade_system_service::remove_stock(&conn, &trade_system_id, &symbol)
}

#[tauri::command]
pub fn list_trade_system_stocks(
    state: State<'_, AppState>,
    trade_system_id: String,
) -> AppResult<Vec<TradeSystemStock>> {
    let conn = state.sqlite.lock().expect("sqlite lock");
    let duck = state.duckdb.lock().expect("duckdb lock");
    trade_system_service::list_trade_system_stocks(&conn, &duck, &trade_system_id)
}

#[tauri::command]
pub fn delete_trade_system(
    state: State<'_, AppState>,
    trade_system_id: String,
) -> AppResult<OkResult> {
    let conn = state.sqlite.lock().expect("sqlite lock");
    trade_system_service::delete_trade_system(&conn, &state.app_dir, &trade_system_id)
}
