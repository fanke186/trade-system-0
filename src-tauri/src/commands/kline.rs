use crate::app_state::AppState;
use crate::error::AppResult;
use crate::models::{KlineBar, KlineCoverage, KlineSyncResult, Security};
use crate::services::{kline_query_service, kline_sync_service};
use serde_json::json;
use std::path::PathBuf;
use tauri::{Emitter, State};

#[tauri::command]
pub async fn sync_kline(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    stock_code: String,
    mode: String,
) -> AppResult<KlineSyncResult> {
    kline_sync_service::validate_mode(&mode)?;

    let _ = app.emit(
        "kline-sync-progress",
        json!({
            "stockCode": stock_code,
            "status": "started",
            "percent": 0,
        }),
    );

    let app_handle = app.clone();
    let sc = stock_code.clone();
    let m = mode.clone();
    let project_root = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));

    let script_result = tokio::task::spawn_blocking(move || {
        kline_sync_service::run_sync_script(&app_handle, &sc, &m, &project_root)
    })
    .await
    .map_err(|e| {
        crate::error::AppError::new(
            "sync_failed",
            format!("脚本执行异常: {e}"),
            true,
        )
    })?;

    let result = match script_result {
        Ok(sr) => {
            let conn = state.duckdb.lock().map_err(|_| {
                crate::error::AppError::new("lock_error", "DuckDB 锁被占用", true)
            })?;
            kline_sync_service::import_and_finalize(&conn, &stock_code, &mode, &sr)?
        }
        Err(e) => {
            if let Ok(conn) = state.duckdb.lock() {
                let _ = conn.execute(
                    "insert into kline_sync_runs (id, stock_code, mode, status, started_at, rows_written, source, error) values (?1, ?2, ?3, 'failed', current_timestamp, 0, null, ?4)",
                    duckdb::params![
                        crate::services::common::new_id("ksr"),
                        stock_code,
                        mode,
                        e.message.clone()
                    ],
                );
            }
            return Err(e);
        }
    };

    let _ = app.emit(
        "kline-sync-progress",
        json!({
            "stockCode": stock_code,
            "status": "completed",
            "percent": 100,
        }),
    );

    Ok(result)
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
    kline_query_service::get_bars(&conn, &stock_code, &frequency, start_date, end_date, limit, adj)
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
