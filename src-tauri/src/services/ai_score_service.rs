use crate::app_state::AppState;
use crate::db::duckdb::DuckConnection;
use crate::error::{AppError, AppResult};
use crate::models::{
    AiScoreRecord, AiScoreRecordFilter, AiScoreRun, OkResult, StockReview, TriggerAiScoreInput,
};
use crate::services::common::{new_id, now_iso};
use crate::services::kline_query_service::resolve_symbol;
use crate::services::model_provider_service::{get_active_provider, get_provider};
use crate::services::review_service;
use crate::services::trade_system_service::{get_version, score_date_for_now};
use crate::services::watchlist_service::list_items;
use chrono::Local;
use duckdb::OptionalExt as DuckOptionalExt;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::Value;
use tauri::{Emitter, Manager};

#[derive(Debug, Clone)]
struct PendingAiScoreRecord {
    id: String,
    run_id: String,
    stock_symbol: String,
    trade_system_id: String,
    trade_system_version_id: String,
    provider_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiScoreTarget {
    symbol: String,
    code: String,
    name: String,
}

pub fn trigger_ai_score(
    app: &tauri::AppHandle,
    input: TriggerAiScoreInput,
) -> AppResult<AiScoreRun> {
    let state = app.state::<AppState>();
    let run = {
        let conn = state.sqlite.lock().expect("sqlite lock");
        let duck = state.duckdb.lock().expect("duckdb lock");
        create_run(&conn, &duck, input)?
    };
    spawn_ai_score_worker_if_needed(app);
    Ok(run)
}

pub fn list_ai_score_records(
    conn: &Connection,
    filter: Option<AiScoreRecordFilter>,
) -> AppResult<Vec<AiScoreRecord>> {
    let filter = filter.unwrap_or(AiScoreRecordFilter {
        trade_system_id: None,
        status: None,
        keyword: None,
        limit: None,
    });
    let mut sql = String::from(
        r#"
        select id, run_id, stock_symbol, stock_code, stock_name, trade_system_id,
               trade_system_version_id, provider_id, trigger_time, score_date, status, score,
               rating, stock_review_id, report_path, error_message, started_at, completed_at,
               created_at, updated_at, deleted_at
          from ai_score_records
         where deleted_at is null
        "#,
    );
    let mut values = Vec::new();
    if let Some(trade_system_id) = filter
        .trade_system_id
        .filter(|value| !value.trim().is_empty())
    {
        sql.push_str(" and trade_system_id = ?");
        values.push(trade_system_id);
    }
    if let Some(status) = filter.status.filter(|value| !value.trim().is_empty()) {
        sql.push_str(" and status = ?");
        values.push(status);
    }
    if let Some(keyword) = filter.keyword.filter(|value| !value.trim().is_empty()) {
        sql.push_str(
            " and (lower(stock_symbol) like lower(?) or lower(stock_code) like lower(?) or lower(stock_name) like lower(?))",
        );
        let pattern = format!("%{}%", keyword.trim());
        values.push(pattern.clone());
        values.push(pattern.clone());
        values.push(pattern);
    }
    let limit = filter.limit.unwrap_or(200).clamp(1, 500);
    sql.push_str(&format!(" order by created_at desc limit {}", limit));

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(values), ai_score_record_from_row)?;
    collect_rows(rows)
}

pub fn delete_ai_score_record(conn: &Connection, record_id: &str) -> AppResult<OkResult> {
    let now = now_iso();
    conn.execute(
        "update ai_score_records set deleted_at = ?1, updated_at = ?1 where id = ?2",
        params![now, record_id],
    )?;
    Ok(OkResult { ok: true })
}

pub fn resume_pending_runs(app: &tauri::AppHandle) {
    let result = (|| -> AppResult<bool> {
        let state = app.state::<AppState>();
        let conn = state.sqlite.lock().expect("sqlite lock");
        let now = now_iso();
        conn.execute(
            r#"
            update ai_score_records
               set status = 'pending', started_at = null, updated_at = ?1
             where status in ('pending', 'running')
               and deleted_at is null
            "#,
            params![now],
        )?;
        conn.execute(
            r#"
            update ai_score_runs
               set status = 'pending', updated_at = ?1
             where status in ('pending', 'running')
               and deleted_at is null
            "#,
            params![now],
        )?;
        has_pending_records(&conn)
    })();

    match result {
        Ok(true) => spawn_ai_score_worker_if_needed(app),
        Ok(false) => {}
        Err(error) => tracing::warn!(?error, "恢复 AI 评分任务失败"),
    }
}

fn create_run(
    conn: &Connection,
    duck: &DuckConnection,
    input: TriggerAiScoreInput,
) -> AppResult<AiScoreRun> {
    let version = get_version(conn, &input.trade_system_version_id)?;
    let provider_id = match input
        .provider_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        Some(provider_id) => Some(get_provider(conn, provider_id)?.id),
        None => Some(
            get_active_provider(conn)?
                .ok_or_else(|| {
                    AppError::new("provider_request_failed", "未配置活跃模型 Provider", true)
                })?
                .id,
        ),
    };
    let targets = resolve_targets(conn, duck, &version.trade_system_id, &input)?;
    if targets.is_empty() {
        return Err(AppError::new("invalid_input", "没有可评分标的", true));
    }

    let run_id = new_id("aisr");
    let now = now_iso();
    let trigger_time = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let score_date = score_date_for_now();
    let snapshot_json = serde_json::to_string(&targets)?;

    conn.execute(
        r#"
        insert into ai_score_runs
          (id, trigger_type, trade_system_id, trade_system_version_id, provider_id, status,
           total_count, completed_count, failed_count, target_snapshot_json, created_at, updated_at)
        values (?1, ?2, ?3, ?4, ?5, 'pending', ?6, 0, 0, ?7, ?8, ?8)
        "#,
        params![
            run_id,
            input.trigger_type,
            version.trade_system_id,
            version.id,
            provider_id,
            targets.len() as i64,
            snapshot_json,
            now
        ],
    )?;

    for target in &targets {
        conn.execute(
            r#"
            insert into ai_score_records
              (id, run_id, stock_symbol, stock_code, stock_name, trade_system_id,
               trade_system_version_id, provider_id, trigger_time, score_date, status,
               created_at, updated_at)
            values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'pending', ?11, ?11)
            "#,
            params![
                new_id("ais"),
                run_id,
                target.symbol,
                target.code,
                target.name,
                version.trade_system_id,
                version.id,
                provider_id,
                trigger_time,
                score_date,
                now
            ],
        )?;
    }

    get_run(conn, &run_id)
}

fn resolve_targets(
    conn: &Connection,
    duck: &DuckConnection,
    trade_system_id: &str,
    input: &TriggerAiScoreInput,
) -> AppResult<Vec<AiScoreTarget>> {
    match input.trigger_type.as_str() {
        "trade_system_agent" => {
            let mut stmt = conn.prepare(
                r#"
                select symbol
                  from trade_system_stocks
                 where trade_system_id = ?1
                 order by updated_at desc
                "#,
            )?;
            let rows = stmt.query_map(params![trade_system_id], |row| row.get::<_, String>(0))?;
            let mut values = Vec::new();
            for row in rows {
                values.push(resolve_target(duck, &row?)?);
            }
            Ok(values)
        }
        "single_stock" => {
            let stock_symbol = input
                .stock_symbol
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| AppError::new("invalid_input", "请选择单只标的", true))?;
            Ok(vec![resolve_target(duck, stock_symbol)?])
        }
        "watchlist" => {
            let watchlist_id = input
                .watchlist_id
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| AppError::new("invalid_input", "请选择自选分组", true))?;
            let items = list_items(conn, watchlist_id)?;
            let mut values = Vec::new();
            for item in items {
                values.push(resolve_target(duck, &item.stock_code)?);
            }
            Ok(values)
        }
        _ => Err(AppError::new(
            "invalid_input",
            "triggerType 只允许 trade_system_agent、single_stock、watchlist",
            true,
        )),
    }
}

fn resolve_target(duck: &DuckConnection, input: &str) -> AppResult<AiScoreTarget> {
    let symbol = resolve_symbol(duck, input)?;
    let row = duck
        .query_row(
            "select symbol, code, name from securities where symbol = ?1 limit 1",
            duckdb::params![symbol],
            |row| {
                Ok(AiScoreTarget {
                    symbol: row.get(0)?,
                    code: row.get(1)?,
                    name: row.get(2)?,
                })
            },
        )
        .optional()?;

    Ok(row.unwrap_or_else(|| {
        let code = symbol.split('.').next().unwrap_or(&symbol).to_string();
        AiScoreTarget {
            symbol,
            code: code.clone(),
            name: code,
        }
    }))
}

fn spawn_ai_score_worker_if_needed(app: &tauri::AppHandle) {
    let should_spawn = {
        let state = app.state::<AppState>();
        let mut running = state
            .ai_score_worker_running
            .lock()
            .expect("ai score worker lock");
        if *running {
            false
        } else {
            *running = true;
            true
        }
    };

    if !should_spawn {
        return;
    }

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        worker_loop(app).await;
    });
}

async fn worker_loop(app: tauri::AppHandle) {
    loop {
        match process_next_record(&app).await {
            Ok(true) => continue,
            Ok(false) => break,
            Err(error) => {
                tracing::error!(?error, "AI 评分 worker 异常退出");
                break;
            }
        }
    }

    {
        let state = app.state::<AppState>();
        let mut running = state
            .ai_score_worker_running
            .lock()
            .expect("ai score worker lock");
        *running = false;
    }
    let has_pending = {
        let state = app.state::<AppState>();
        let conn = state.sqlite.lock().expect("sqlite lock");
        has_pending_records(&conn).unwrap_or(false)
    };
    if has_pending {
        spawn_ai_score_worker_if_needed(&app);
    }
}

async fn process_next_record(app: &tauri::AppHandle) -> AppResult<bool> {
    let pending = {
        let state = app.state::<AppState>();
        let conn = state.sqlite.lock().expect("sqlite lock");
        next_pending_record(&conn)?
    };

    let Some(record) = pending else {
        let state = app.state::<AppState>();
        let conn = state.sqlite.lock().expect("sqlite lock");
        finalize_open_runs(&conn)?;
        return Ok(false);
    };

    mark_record_running(app, &record)?;
    let result = score_with_retry(app, &record).await;
    match result {
        Ok(review) => mark_record_completed(app, &record, review)?,
        Err(error) => mark_record_failed(app, &record, error.message)?,
    }
    Ok(true)
}

async fn score_with_retry(
    app: &tauri::AppHandle,
    record: &PendingAiScoreRecord,
) -> AppResult<StockReview> {
    let state = app.state::<AppState>();
    let first = review_service::score_stock(
        &state,
        record.stock_symbol.clone(),
        record.trade_system_version_id.clone(),
        record.provider_id.clone(),
    )
    .await;

    match first {
        Ok(review) => Ok(review),
        Err(error)
            if matches!(
                error.code.as_str(),
                "invalid_json" | "provider_request_failed"
            ) =>
        {
            review_service::score_stock(
                &state,
                record.stock_symbol.clone(),
                record.trade_system_version_id.clone(),
                record.provider_id.clone(),
            )
            .await
        }
        Err(error) => Err(error),
    }
}

fn next_pending_record(conn: &Connection) -> AppResult<Option<PendingAiScoreRecord>> {
    conn.query_row(
        r#"
        select id, run_id, stock_symbol, trade_system_id, trade_system_version_id, provider_id
          from ai_score_records
         where status = 'pending'
           and deleted_at is null
         order by created_at asc
         limit 1
        "#,
        [],
        |row| {
            Ok(PendingAiScoreRecord {
                id: row.get(0)?,
                run_id: row.get(1)?,
                stock_symbol: row.get(2)?,
                trade_system_id: row.get(3)?,
                trade_system_version_id: row.get(4)?,
                provider_id: row.get(5)?,
            })
        },
    )
    .optional()
    .map_err(Into::into)
}

fn mark_record_running(app: &tauri::AppHandle, record: &PendingAiScoreRecord) -> AppResult<()> {
    let state = app.state::<AppState>();
    let conn = state.sqlite.lock().expect("sqlite lock");
    let now = now_iso();
    conn.execute(
        r#"
        update ai_score_records
           set status = 'running', started_at = ?1, updated_at = ?1
         where id = ?2
        "#,
        params![now, record.id],
    )?;
    conn.execute(
        "update ai_score_runs set status = 'running', updated_at = ?1 where id = ?2",
        params![now, record.run_id],
    )?;
    emit_progress(app, &record.run_id, &record.id, "running");
    Ok(())
}

fn mark_record_completed(
    app: &tauri::AppHandle,
    record: &PendingAiScoreRecord,
    review: StockReview,
) -> AppResult<()> {
    let state = app.state::<AppState>();
    let conn = state.sqlite.lock().expect("sqlite lock");
    let now = now_iso();
    let stock_review_id = if review.id == "unsaved" {
        None
    } else {
        Some(review.id.clone())
    };
    let report_path = latest_report_path(&conn, &record.trade_system_id, &record.stock_symbol)?;
    let error_message = if review.status == "ok" {
        None
    } else {
        Some(review.overall_evaluation.clone())
    };
    conn.execute(
        r#"
        update ai_score_records
           set status = 'completed',
               score = ?1,
               rating = ?2,
               stock_review_id = ?3,
               report_path = ?4,
               error_message = ?5,
               completed_at = ?6,
               updated_at = ?6
         where id = ?7
        "#,
        params![
            review.score,
            review.rating,
            stock_review_id,
            report_path,
            error_message,
            now,
            record.id
        ],
    )?;
    update_run_counts(&conn, &record.run_id)?;
    emit_progress(app, &record.run_id, &record.id, "completed");
    Ok(())
}

fn mark_record_failed(
    app: &tauri::AppHandle,
    record: &PendingAiScoreRecord,
    error_message: String,
) -> AppResult<()> {
    let state = app.state::<AppState>();
    let conn = state.sqlite.lock().expect("sqlite lock");
    let now = now_iso();
    conn.execute(
        r#"
        update ai_score_records
           set status = 'failed',
               error_message = ?1,
               completed_at = ?2,
               updated_at = ?2
         where id = ?3
        "#,
        params![error_message, now, record.id],
    )?;
    update_run_counts(&conn, &record.run_id)?;
    emit_progress(app, &record.run_id, &record.id, "failed");
    Ok(())
}

fn update_run_counts(conn: &Connection, run_id: &str) -> AppResult<()> {
    let (total, completed, failed): (i64, i64, i64) = conn.query_row(
        r#"
        select count(*),
               count(case when status = 'completed' then 1 end),
               count(case when status = 'failed' then 1 end)
          from ai_score_records
         where run_id = ?1
           and deleted_at is null
        "#,
        params![run_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
    let status = if completed + failed >= total {
        if failed > 0 && completed == 0 {
            "failed"
        } else if failed > 0 {
            "partial"
        } else {
            "completed"
        }
    } else {
        "running"
    };
    conn.execute(
        r#"
        update ai_score_runs
           set status = ?1,
               total_count = ?2,
               completed_count = ?3,
               failed_count = ?4,
               updated_at = ?5
         where id = ?6
        "#,
        params![status, total, completed, failed, now_iso(), run_id],
    )?;
    Ok(())
}

fn finalize_open_runs(conn: &Connection) -> AppResult<()> {
    let mut stmt = conn.prepare(
        "select id from ai_score_runs where status in ('pending', 'running') and deleted_at is null",
    )?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    for row in rows {
        update_run_counts(conn, &row?)?;
    }
    Ok(())
}

fn latest_report_path(
    conn: &Connection,
    trade_system_id: &str,
    stock_symbol: &str,
) -> AppResult<Option<String>> {
    conn.query_row(
        r#"
        select latest_report_path
          from trade_system_stocks
         where trade_system_id = ?1
           and symbol = ?2
        "#,
        params![trade_system_id, stock_symbol],
        |row| row.get(0),
    )
    .optional()
    .map_err(Into::into)
}

fn has_pending_records(conn: &Connection) -> AppResult<bool> {
    let count: i64 = conn.query_row(
        "select count(*) from ai_score_records where status = 'pending' and deleted_at is null",
        [],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

fn get_run(conn: &Connection, run_id: &str) -> AppResult<AiScoreRun> {
    conn.query_row(
        r#"
        select id, trigger_type, trade_system_id, trade_system_version_id, provider_id, status,
               total_count, completed_count, failed_count, target_snapshot_json, created_at,
               updated_at, deleted_at
          from ai_score_runs
         where id = ?1
        "#,
        params![run_id],
        ai_score_run_from_row,
    )
    .map_err(Into::into)
}

fn ai_score_run_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AiScoreRun> {
    let raw_snapshot: String = row.get(9)?;
    Ok(AiScoreRun {
        id: row.get(0)?,
        trigger_type: row.get(1)?,
        trade_system_id: row.get(2)?,
        trade_system_version_id: row.get(3)?,
        provider_id: row.get(4)?,
        status: row.get(5)?,
        total_count: row.get(6)?,
        completed_count: row.get(7)?,
        failed_count: row.get(8)?,
        target_snapshot: serde_json::from_str(&raw_snapshot)
            .unwrap_or_else(|_| Value::Array(vec![])),
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
        deleted_at: row.get(12)?,
    })
}

fn ai_score_record_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AiScoreRecord> {
    Ok(AiScoreRecord {
        id: row.get(0)?,
        run_id: row.get(1)?,
        stock_symbol: row.get(2)?,
        stock_code: row.get(3)?,
        stock_name: row.get(4)?,
        trade_system_id: row.get(5)?,
        trade_system_version_id: row.get(6)?,
        provider_id: row.get(7)?,
        trigger_time: row.get(8)?,
        score_date: row.get(9)?,
        status: row.get(10)?,
        score: row.get(11)?,
        rating: row.get(12)?,
        stock_review_id: row.get(13)?,
        report_path: row.get(14)?,
        error_message: row.get(15)?,
        started_at: row.get(16)?,
        completed_at: row.get(17)?,
        created_at: row.get(18)?,
        updated_at: row.get(19)?,
        deleted_at: row.get(20)?,
    })
}

fn emit_progress(app: &tauri::AppHandle, run_id: &str, record_id: &str, status: &str) {
    let _ = app.emit(
        "ai-score-progress",
        serde_json::json!({
            "runId": run_id,
            "recordId": record_id,
            "status": status,
        }),
    );
}

fn collect_rows<T, F>(rows: rusqlite::MappedRows<'_, F>) -> AppResult<Vec<T>>
where
    F: FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<T>,
{
    let mut values = Vec::new();
    for row in rows {
        values.push(row?);
    }
    Ok(values)
}
