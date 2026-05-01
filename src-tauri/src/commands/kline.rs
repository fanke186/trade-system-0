use crate::app_state::AppState;
use crate::error::AppResult;
use crate::models::{AggregateResult, KlineBar, KlineCoverage, KlineSyncResult, Security};
use crate::services::{kline_query_service, kline_sync_service};
use tauri::State;

#[tauri::command]
pub fn sync_kline(
    state: State<'_, AppState>,
    stock_code: String,
    mode: String,
) -> AppResult<KlineSyncResult> {
    let conn = state.duckdb.lock().expect("duckdb lock");
    kline_sync_service::sync_kline(&conn, &stock_code, &mode)
}

#[tauri::command]
pub fn get_bars(
    state: State<'_, AppState>,
    stock_code: String,
    frequency: String,
    start_date: Option<String>,
    end_date: Option<String>,
    limit: Option<i64>,
) -> AppResult<Vec<KlineBar>> {
    let conn = state.duckdb.lock().expect("duckdb lock");
    kline_query_service::get_bars(&conn, &stock_code, &frequency, start_date, end_date, limit)
}

#[tauri::command]
pub fn get_data_coverage(
    state: State<'_, AppState>,
    stock_code: String,
) -> AppResult<KlineCoverage> {
    let conn = state.duckdb.lock().expect("duckdb lock");
    kline_query_service::get_data_coverage(&conn, &stock_code)
}

#[tauri::command]
pub fn list_securities(
    state: State<'_, AppState>,
    keyword: Option<String>,
    limit: Option<i64>,
) -> AppResult<Vec<Security>> {
    let conn = state.duckdb.lock().expect("duckdb lock");
    kline_query_service::list_securities(&conn, keyword, limit)
}

#[tauri::command]
pub fn aggregate_kline(
    state: State<'_, AppState>,
    stock_code: Option<String>,
    frequency: String,
) -> AppResult<AggregateResult> {
    let conn = state.duckdb.lock().expect("duckdb lock");
    kline_sync_service::aggregate_kline(&conn, stock_code, &frequency)
}
