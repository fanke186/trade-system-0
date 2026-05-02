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
    scope: Option<String>,
) -> AppResult<KlineSyncResult> {
    tracing::info!(
        stock_code = %stock_code,
        mode = %mode,
        scope = ?scope,
        "sync_kline 命令被调用"
    );

    kline_sync_service::validate_mode(&mode)?;
    let sync_scope = scope.unwrap_or_else(|| {
        if stock_code.is_empty() {
            "incomplete".to_string()
        } else {
            "symbols".to_string()
        }
    });

    tracing::info!(sync_scope = %sync_scope, "sync_kline scope 解析完成");

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
    let s = sync_scope.clone();
    let project_root = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));

    tracing::info!(
        project_root = %project_root.display(),
        data_dir = %project_root.join("../.data/klines/current").display(),
        "sync_kline 项目路径"
    );

    let script_result = tokio::task::spawn_blocking(move || {
        tracing::info!("开始在阻塞线程中执行同步脚本");
        kline_sync_service::run_sync_script(&app_handle, &sc, &m, &s, &project_root)
    })
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "spawn_blocking 失败");
        crate::error::AppError::new(
            "sync_failed",
            format!("脚本执行异常: {e}"),
            true,
        )
    })?;

    tracing::info!(script_ok = script_result.is_ok(), "同步脚本执行完成");

    let result = match script_result {
        Ok(sr) => {
            tracing::info!("开始导入 Parquet 到 DuckDB");
            let conn = state.duckdb.lock().map_err(|_| {
                tracing::error!("获取 DuckDB 锁失败");
                crate::error::AppError::new("lock_error", "DuckDB 锁被占用", true)
            })?;
            let import_result = kline_sync_service::import_and_finalize(&conn, &stock_code, &mode, &sr)?;
            tracing::info!(rows_written = import_result.rows_written, "导入完成");
            import_result
        }
        Err(e) => {
            tracing::error!(error_code = %e.code, error_msg = %e.message, "同步脚本失败");
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
