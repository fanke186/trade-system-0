use crate::db::duckdb::DuckConnection;
use crate::error::{AppError, AppResult};
use crate::models::{FrequencyCoverage, KlineCoverage, KlineSyncResult};
use crate::services::common::new_id;
use crate::services::{kline_import_service, kline_query_service};
use serde_json::Value;
use std::io::BufRead;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::Emitter;

const DEFAULT_DATA_DIR: &str = "../.data/klines/current";
const PERIODS: [&str; 5] = ["1d", "1w", "1M", "1Q", "1Y"];
const ADJ_MODES: [&str; 3] = ["none", "forward", "backward"];

#[derive(Debug, Default)]
pub struct SyncScriptResult {
    pub data_dir: PathBuf,
}

/// Spawn Python script, parse progress JSON from stdout, emit to frontend.
pub fn run_sync_script(
    app: &tauri::AppHandle,
    stock_code: &str,
    mode: &str,
    scope: &str,
    project_root: &std::path::Path,
) -> AppResult<SyncScriptResult> {
    let python = find_python()?;
    let script = find_script(project_root)?;
    let data_dir = project_root.join(DEFAULT_DATA_DIR);

    tracing::info!(
        python = %python,
        script = %script.display(),
        data_dir = %data_dir.display(),
        stock_code,
        mode,
        scope,
        "准备启动同步脚本"
    );

    let mut cmd = Command::new(&python);
    cmd.arg(&script)
        .arg("--data-dir")
        .arg(data_dir.to_string_lossy().to_string())
        .arg("--mode")
        .arg(mode)
        .arg("--scope")
        .arg(if stock_code.is_empty() { scope } else { "symbols" })
        .arg("--periods")
        .arg(PERIODS.join(","))
        .arg("--adj")
        .arg(ADJ_MODES.join(","));

    if !stock_code.is_empty() {
        cmd.arg("--symbols").arg(stock_code);
    }

    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    tracing::info!(cmd = ?cmd, "Python 命令构建完成");

    let _ = app.emit(
        "kline-sync-progress",
        serde_json::json!({
            "stockCode": stock_code,
            "status": "script_started",
            "percent": 0,
            "message": format!("启动同步脚本: {python} {}", script.display()),
        }),
    );

    let mut child = cmd.spawn().map_err(|e| {
        tracing::error!(error = %e, python = %python, script = %script.display(), "无法启动 Python 子进程");
        AppError::with_detail(
            "script_spawn_failed",
            format!("无法启动 Python 脚本: {e}"),
            true,
            serde_json::json!({ "python": python, "script": script.to_string_lossy() }),
        )
    })?;

    tracing::info!(pid = child.id(), "Python 子进程已启动");

    // Drain stderr continuously in a background thread so the pipe buffer never fills.
    // If stderr blocks, the Python process blocks, which deadlocks stdout reading.
    let stderr = child.stderr.take().expect("stderr piped");
    let stderr_lines: Arc<Mutex<Vec<String>>> = Default::default();
    let stderr_captured = stderr_lines.clone();
    std::thread::spawn(move || {
        let reader = std::io::BufReader::new(stderr);
        for line in reader.lines() {
            if let Ok(line) = line {
                if !line.trim().is_empty() {
                    stderr_captured.lock().unwrap().push(line);
                }
            }
        }
    });

    let stdout = child.stdout.take().expect("stdout piped");
    let reader = std::io::BufReader::new(stdout);
    let mut last_progress = 0;
    let mut line_count = 0u64;

    for line in reader.lines() {
        line_count += 1;
        let line = line.map_err(|e| {
            AppError::with_detail(
                "script_read_error",
                format!("读取脚本输出失败: {e}"),
                true,
                serde_json::Value::Null,
            )
        })?;

        if line.trim().is_empty() {
            continue;
        }

        let parsed: Value = serde_json::from_str(&line).unwrap_or_else(|_| {
            serde_json::json!({ "type": "raw", "message": line })
        });

        // Forward progress updates to frontend
        let event_type = parsed["type"].as_str().unwrap_or("");
        match event_type {
            "progress" => {
                let percent = parsed["percent"].as_i64().unwrap_or(0) as i32;
                if percent != last_progress {
                    last_progress = percent;
                }
                let _ = app.emit(
                    "kline-sync-progress",
                    serde_json::json!({
                        "stockCode": stock_code,
                        "status": "syncing",
                        "percent": percent,
                        "period": parsed["period"],
                        "batch": parsed["batch"],
                        "totalBatches": parsed["totalBatches"],
                    }),
                );
            }
            "phase" => {
                let _ = app.emit(
                    "kline-sync-progress",
                    serde_json::json!({
                        "stockCode": stock_code,
                        "status": "script_running",
                        "percent": last_progress,
                        "message": parsed["message"],
                    }),
                );
            }
            "retry" => {
                let _ = app.emit(
                    "kline-sync-progress",
                    serde_json::json!({
                        "stockCode": stock_code,
                        "status": "retrying",
                        "percent": last_progress,
                        "message": format!("限流重试 {}/{}", parsed["attempt"], parsed["maxRetries"]),
                    }),
                );
            }
            "error" => {
                let fatal = parsed["fatal"].as_bool().unwrap_or(false);
                let _ = app.emit(
                    "kline-sync-progress",
                    serde_json::json!({
                        "stockCode": stock_code,
                        "status": if fatal { "error" } else { "warning" },
                        "percent": last_progress,
                        "message": parsed["message"],
                    }),
                );
            }
            "complete" => {
                last_progress = 100;
                let _ = app.emit(
                    "kline-sync-progress",
                    serde_json::json!({
                        "stockCode": stock_code,
                        "status": "script_completed",
                        "percent": 100,
                        "periods": parsed["periods"],
                        "totalBars": parsed["totalBars"],
                    }),
                );
            }
            _ => {
                // Non-JSON or unknown type, log as raw message
                tracing::debug!(line = %line, "sync script stdout");
            }
        }
    }

    tracing::info!(line_count, "stdout 读取完成，等待子进程退出");

    let status = child.wait().map_err(|e| {
        AppError::with_detail(
            "script_wait_failed",
            format!("等待脚本退出失败: {e}"),
            true,
            serde_json::Value::Null,
        )
    })?;

    if !status.success() {
        let captured = stderr_lines.lock().unwrap();
        let stderr_tail: String = captured.iter().rev().take(20).cloned().collect::<Vec<_>>().join("\n");
        tracing::error!(
            exit_code = ?status.code(),
            stderr_lines = captured.len(),
            stderr_tail = %stderr_tail,
            "同步脚本异常退出"
        );
        return Err(AppError::with_detail(
            "script_failed",
            format!("同步脚本异常退出: exit code {}", status.code().unwrap_or(-1)),
            true,
            serde_json::json!({ "stderr": stderr_tail }),
        ));
    }

    // Parse complete event from last line to get result summary
    let result = SyncScriptResult {
        data_dir,
        ..Default::default()
    };

    // If the complete event was already parsed, extract from there
    // We already emitted it above. Re-parse stderr for final stats?
    // Actually, parse the stdout output for the complete line.
    // Simpler: re-read from the last_run metadata or just return defaults.
    // The import service will count rows from Parquet anyway.

    let _ = app.emit(
        "kline-sync-progress",
        serde_json::json!({
            "stockCode": stock_code,
            "status": "importing",
            "percent": 100,
            "message": "正在导入 Parquet 到本地数据库...",
        }),
    );

    Ok(result)
}

/// Import Parquet files into DuckDB and finalize sync with audit record.
pub fn import_and_finalize(
    conn: &DuckConnection,
    stock_code: &str,
    mode: &str,
    result: &SyncScriptResult,
) -> AppResult<KlineSyncResult> {
    let run_id = new_id("ksr");
    conn.execute(
        "insert into kline_sync_runs (id, stock_code, mode, status, started_at, rows_written, source) values (?1, ?2, ?3, 'importing', current_timestamp, 0, 'tickflow')",
        duckdb::params![run_id, stock_code, mode],
    )?;

    let mut total_rows = kline_import_service::import_securities(conn, &result.data_dir)?;
    for period in PERIODS {
        for adj_mode in ADJ_MODES {
            match kline_import_service::import_parquet(conn, &result.data_dir, period, adj_mode) {
            Ok(rows) => {
                total_rows += rows;
            }
            Err(e) => {
                    tracing::warn!(period = period, adj_mode = adj_mode, error = %e.message, "Parquet import failed for partition");
                }
            }
        }
    }

    conn.execute(
        "update kline_sync_runs set status = ?1, finished_at = current_timestamp, rows_written = ?2, source = 'tickflow' where id = ?3",
        duckdb::params!["ok", total_rows, run_id],
    )?;

    let coverage = if stock_code.is_empty() {
        global_coverage(conn)?
    } else {
        kline_query_service::get_data_coverage(conn, stock_code)?
    };

    Ok(KlineSyncResult {
        stock_code: stock_code.to_string(),
        mode: mode.to_string(),
        status: "ok".to_string(),
        rows_written: total_rows,
        source: "tickflow".to_string(),
        coverage,
    })
}

fn global_coverage(conn: &DuckConnection) -> AppResult<KlineCoverage> {
    Ok(KlineCoverage {
        stock_code: "ALL".to_string(),
        daily: global_frequency_coverage(conn, "1d")?,
        weekly: global_frequency_coverage(conn, "1w")?,
        monthly: global_frequency_coverage(conn, "1M")?,
        quarterly: global_frequency_coverage(conn, "1Q")?,
        yearly: global_frequency_coverage(conn, "1Y")?,
        last_sync_at: conn
            .query_row(
                "select cast(max(finished_at) as varchar) from kline_sync_runs where status = 'ok'",
                [],
                |row| row.get::<_, Option<String>>(0),
            )
            .ok()
            .flatten(),
    })
}

fn global_frequency_coverage(conn: &DuckConnection, frequency: &str) -> AppResult<FrequencyCoverage> {
    conn.query_row(
        "select cast(min(trade_date) as varchar), cast(max(trade_date) as varchar), count(*)
           from kline_bars
          where period = ?1 and adj_mode = 'none'",
        duckdb::params![frequency],
        |row| {
            Ok(FrequencyCoverage {
                frequency: frequency.to_string(),
                start_date: row.get(0)?,
                end_date: row.get(1)?,
                rows: row.get(2)?,
            })
        },
    )
    .map_err(Into::into)
}

fn find_python() -> AppResult<String> {
    if let Ok(path) = std::env::var("PYTHON_BIN") {
        if !path.is_empty() {
            tracing::info!(python = %path, source = "PYTHON_BIN", "找到 Python");
            return Ok(path);
        }
    }
    for candidate in &["python3", "python"] {
        if Command::new(candidate)
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok()
        {
            tracing::info!(python = %candidate, "找到 Python");
            return Ok(candidate.to_string());
        }
    }
    tracing::error!("未找到 Python 运行环境");
    Err(AppError::new(
        "python_not_found",
        "未找到 Python 运行环境，请安装 Python 3 或设置 PYTHON_BIN 环境变量",
        true,
    ))
}

fn find_script(project_root: &std::path::Path) -> AppResult<PathBuf> {
    if let Ok(path) = std::env::var("SYNC_SCRIPT_PATH") {
        let p = PathBuf::from(&path);
        if p.exists() {
            tracing::info!(script = %p.display(), source = "SYNC_SCRIPT_PATH", "找到同步脚本");
            return Ok(p);
        }
    }
    let candidates = [
        project_root.join("scripts/sync_kline.py"),
        project_root.join("../scripts/sync_kline.py"),
        PathBuf::from("./scripts/sync_kline.py"),
    ];
    for candidate in &candidates {
        let exists = candidate.exists();
        tracing::debug!(path = %candidate.display(), exists, "检查脚本路径");
        if exists {
            tracing::info!(script = %candidate.display(), "找到同步脚本");
            return Ok(candidate.clone());
        }
    }
    tracing::error!(
        project_root = %project_root.display(),
        "找不到 sync_kline.py"
    );
    Err(AppError::new(
        "script_not_found",
        "找不到 sync_kline.py，请设置 SYNC_SCRIPT_PATH 环境变量",
        true,
    ))
}

/// Validate sync mode.
pub fn validate_mode(mode: &str) -> AppResult<()> {
    if !matches!(mode, "full" | "incremental") {
        return Err(AppError::new(
            "kline_sync_failed",
            "mode 只允许 full 或 incremental",
            true,
        ));
    }
    Ok(())
}
