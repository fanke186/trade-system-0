use crate::db::duckdb::DuckConnection;
use crate::error::{AppError, AppResult};
use crate::models::KlineSyncResult;
use crate::services::common::new_id;
use serde::Deserialize;
use std::path::Path;

#[derive(Debug, Deserialize)]
struct CsvRow {
    symbol: String,
    #[serde(default)]
    name: String,
    #[allow(dead_code)]
    timestamp: Option<i64>,
    trade_date: String,
    #[allow(dead_code)]
    trade_time: Option<String>,
    open: f64,
    high: f64,
    low: f64,
    close: f64,
    volume: f64,
    amount: f64,
}

#[derive(Debug)]
struct Bar {
    symbol: String,
    trade_date: String,
    open: f64,
    high: f64,
    low: f64,
    close: f64,
    volume: f64,
    amount: f64,
    pre_close: Option<f64>,
    change: Option<f64>,
    change_pct: Option<f64>,
    amplitude: Option<f64>,
}

/// Scan directory for CSV files matching `{code}_{name}_日K线历史.csv`,
/// parse, compute derived fields, insert into DuckDB.
pub fn import_csv_directory(
    conn: &DuckConnection,
    dir: &Path,
) -> AppResult<KlineSyncResult> {
    if !dir.is_dir() {
        return Err(AppError::new(
            "csv_dir_not_found",
            format!("CSV 目录不存在: {}", dir.display()),
            true,
        ));
    }

    let mut csv_files: Vec<_> = std::fs::read_dir(dir)
        .map_err(|e| AppError::new("csv_read_dir", format!("读取目录失败: {e}"), true))?
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_name()
                .to_string_lossy()
                .ends_with("日K线历史.csv")
        })
        .collect();

    csv_files.sort_by_key(|e| e.file_name());

    tracing::info!(file_count = csv_files.len(), dir = %dir.display(), "开始 CSV 导入");

    let run_id = new_id("ksr");
    conn.execute(
        "insert into kline_sync_runs (id, stock_code, mode, status, started_at, rows_written, source) values (?1, '', 'incremental', 'importing', current_timestamp, 0, 'csv')",
        duckdb::params![run_id],
    )?;

    let mut total_rows: i64 = 0;
    let mut symbol_count = 0i64;

    for entry in &csv_files {
        let path = entry.path();
        let filename = entry.file_name().to_string_lossy().to_string();

        tracing::info!(file = %filename, "导入 CSV");

        let rows = match import_one_csv(conn, &path) {
            Ok(n) => n,
            Err(e) => {
                tracing::warn!(file = %filename, error = %e.message, "CSV 导入跳过");
                continue;
            }
        };

        total_rows += rows;
        symbol_count += 1;
    }

    conn.execute(
        "update kline_sync_runs set status = 'ok', finished_at = current_timestamp, rows_written = ?1, source = 'csv' where id = ?2",
        duckdb::params![total_rows, run_id],
    )?;

    let coverage = global_coverage(conn)?;

    tracing::info!(symbol_count, total_rows, "CSV 导入完成");

    Ok(KlineSyncResult {
        stock_code: String::new(),
        mode: "incremental".into(),
        status: "ok".into(),
        rows_written: total_rows,
        source: "csv".into(),
        coverage,
    })
}

fn import_one_csv(conn: &DuckConnection, path: &Path) -> AppResult<i64> {
    let raw = std::fs::read_to_string(path)
        .map_err(|e| AppError::new("csv_read", format!("读取 CSV 失败: {e}"), true))?;

    // Strip BOM
    let body = raw.strip_prefix('\u{FEFF}').unwrap_or(&raw);

    let mut reader = csv::ReaderBuilder::new()
        .has_headers(true)
        .flexible(true)
        .from_reader(body.as_bytes());

    let mut rows: Vec<CsvRow> = Vec::new();
    for result in reader.deserialize() {
        let row: CsvRow = result.map_err(|e| {
            AppError::new("csv_parse", format!("CSV 解析失败: {e}"), true)
        })?;
        rows.push(row);
    }

    if rows.is_empty() {
        return Ok(0);
    }

    rows.sort_by(|a, b| a.trade_date.cmp(&b.trade_date));

    // Extract symbol info from first row
    let symbol = &rows[0].symbol;
    let code = symbol.strip_suffix(".SZ")
        .or_else(|| symbol.strip_suffix(".SH"))
        .or_else(|| symbol.strip_suffix(".BJ"))
        .unwrap_or(symbol);
    let exchange = if symbol.ends_with(".SZ") {
        "SZSE"
    } else if symbol.ends_with(".SH") {
        "SHSE"
    } else if symbol.ends_with(".BJ") {
        "BSE"
    } else {
        "UNKNOWN"
    };
    let name = &rows[0].name;

    // Upsert security metadata
    conn.execute(
        "insert into securities (symbol, code, name, exchange, stock_type, status, updated_at)
         values (?1, ?2, ?3, ?4, 'stock', 'active', current_timestamp)
         on conflict (symbol) do update set name = excluded.name, exchange = excluded.exchange, updated_at = current_timestamp",
        duckdb::params![symbol, code, name, exchange],
    )?;

    // Compute derived fields
    let bars: Vec<Bar> = rows
        .iter()
        .enumerate()
        .map(|(i, r)| {
            let pre_close = if i > 0 { Some(rows[i - 1].close) } else { None };
            let change = pre_close.map(|pc| r.close - pc);
            let change_pct = pre_close.and_then(|pc| {
                if pc != 0.0 {
                    Some((r.close / pc - 1.0) * 100.0)
                } else {
                    None
                }
            });
            let amplitude = pre_close.and_then(|pc| {
                if pc != 0.0 {
                    Some((r.high - r.low) / pc * 100.0)
                } else {
                    None
                }
            });
            Bar {
                symbol: r.symbol.clone(),
                trade_date: r.trade_date[..10].to_string(),
                open: r.open,
                high: r.high,
                low: r.low,
                close: r.close,
                volume: r.volume,
                amount: r.amount,
                pre_close,
                change,
                change_pct,
                amplitude,
            }
        })
        .collect();

    // Batch insert — 100 rows per statement
    let period = "1d";
    let adj_mode = "forward";
    let source = "csv";
    let chunk_size = 100;

    for chunk in bars.chunks(chunk_size) {
        let mut sql = String::from(
            "insert or replace into kline_bars (symbol, period, adj_mode, trade_date, open, high, low, close, pre_close, volume, amount, change, change_pct, amplitude, source, updated_at) values "
        );
        let mut params: Vec<Box<dyn duckdb::ToSql>> = Vec::new();

        for (j, b) in chunk.iter().enumerate() {
            if j > 0 {
                sql.push_str(", ");
            }
            let base = params.len();
            sql.push_str(&format!(
                "(${}::text, $${}::text, $${}::text, $${}::date, $${}::double, $${}::double, $${}::double, $${}::double, $${}::double, $${}::double, $${}::double, $${}::double, $${}::double, $${}::double, $${}::text, current_timestamp)",
                base + 1, base + 2, base + 3, base + 4, base + 5,
                base + 6, base + 7, base + 8, base + 9, base + 10,
                base + 11, base + 12, base + 13, base + 14, base + 15,
            ));

            params.push(Box::new(b.symbol.clone()));
            params.push(Box::new(period.to_string()));
            params.push(Box::new(adj_mode.to_string()));
            params.push(Box::new(b.trade_date.clone()));
            params.push(Box::new(b.open));
            params.push(Box::new(b.high));
            params.push(Box::new(b.low));
            params.push(Box::new(b.close));
            params.push(Box::new(b.pre_close));
            params.push(Box::new(b.volume));
            params.push(Box::new(b.amount));
            params.push(Box::new(b.change));
            params.push(Box::new(b.change_pct));
            params.push(Box::new(b.amplitude));
            params.push(Box::new(source.to_string()));
        }

        let param_refs: Vec<&dyn duckdb::ToSql> = params.iter().map(|p| p.as_ref()).collect();
        conn.execute(&sql, &param_refs[..])?;
    }

    // Also insert trade_calendar dates
    let dates: Vec<String> = rows.iter().map(|r| r.trade_date[..10].to_string()).collect();
    for chunk in dates.chunks(100) {
        let placeholders: Vec<String> = (0..chunk.len()).map(|i| format!("(${}::date)", i + 1)).collect();
        let sql = format!("insert or ignore into trade_calendar (trade_date) values {}", placeholders.join(", "));
        let params: Vec<Box<dyn duckdb::ToSql>> = chunk.iter().map(|d| Box::new(d.clone()) as Box<dyn duckdb::ToSql>).collect();
        let param_refs: Vec<&dyn duckdb::ToSql> = params.iter().map(|p| p.as_ref()).collect();
        if let Err(e) = conn.execute(&sql, &param_refs[..]) {
            tracing::warn!(error = %e, "插入交易日历失败，忽略");
        }
    }

    tracing::info!(symbol = %symbol, rows = bars.len(), "CSV 导入单文件完成");
    Ok(bars.len() as i64)
}

fn global_coverage(conn: &DuckConnection) -> AppResult<crate::models::KlineCoverage> {
    Ok(crate::models::KlineCoverage {
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

fn global_frequency_coverage(conn: &DuckConnection, frequency: &str) -> AppResult<crate::models::FrequencyCoverage> {
    use crate::models::FrequencyCoverage;
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
