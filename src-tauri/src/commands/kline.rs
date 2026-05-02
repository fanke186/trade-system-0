use crate::app_state::AppState;
use crate::error::AppResult;
use crate::models::{KlineBar, KlineCoverage, KlineSyncResult, Security};
use crate::services::{kline_query_service, market_sync_service};
use tauri::{Manager, State};

#[tauri::command]
pub async fn refresh_from_market(app: tauri::AppHandle) -> AppResult<KlineSyncResult> {
    tracing::info!("refresh_from_market 命令被调用");
    tokio::task::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let conn = state
            .duckdb
            .lock()
            .map_err(|_| crate::error::AppError::new("lock_error", "DuckDB 锁被占用", true))?;
        market_sync_service::refresh_from_market(&app, &conn)
    })
    .await
    .map_err(|e| {
        crate::error::AppError::new("refresh_failed", format!("同步任务异常: {e}"), true)
    })?
}

#[tauri::command]
pub fn get_bars(
    state: State<'_, AppState>,
    stock_code: String,
    frequency: String,
    start_date: Option<String>,
    end_date: Option<String>,
    limit: Option<i64>,
    adj: Option<String>,
) -> AppResult<Vec<KlineBar>> {
    let conn = state.duckdb.lock().expect("duckdb lock");
    kline_query_service::get_bars(
        &conn,
        &stock_code,
        &frequency,
        start_date,
        end_date,
        limit,
        adj,
    )
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
