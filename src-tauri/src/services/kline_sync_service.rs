use crate::db::duckdb::DuckConnection;
use crate::error::{AppError, AppResult};
use crate::kline::aggregate;
use crate::kline::http::{EastmoneyDailyBarProvider, TencentDailyBarProvider};
use crate::kline::provider::{DailyBar, KlineProvider};
use crate::kline::sample::SampleKlineProvider;
use crate::models::{AggregateResult, KlineSyncResult};
use crate::services::common::new_id;
use crate::services::kline_query_service::{get_data_coverage, get_symbol_id};
use chrono::{Duration, NaiveDate, Utc};
use duckdb::OptionalExt;

pub fn sync_kline(
    conn: &DuckConnection,
    stock_code: &str,
    mode: &str,
) -> AppResult<KlineSyncResult> {
    if !matches!(mode, "full" | "incremental") {
        return Err(AppError::new(
            "kline_sync_failed",
            "mode 只允许 full 或 incremental",
            true,
        ));
    }

    let run_id = new_id("ksr");
    conn.execute(
        "insert into kline_sync_runs (id, stock_code, mode, status, started_at, rows_written, source) values (?1, ?2, ?3, 'running', current_timestamp, 0, null)",
        duckdb::params![run_id, stock_code, mode],
    )?;

    let result = sync_inner(conn, stock_code, mode);
    match &result {
        Ok(sync) => {
            conn.execute(
                "update kline_sync_runs set status = ?1, finished_at = current_timestamp, rows_written = ?2, source = ?3 where id = ?4",
                duckdb::params![sync.status, sync.rows_written, sync.source, run_id],
            )?;
        }
        Err(error) => {
            conn.execute(
                "update kline_sync_runs set status = 'failed', finished_at = current_timestamp, error = ?1 where id = ?2",
                duckdb::params![serde_json::to_string(error).unwrap_or_else(|_| error.message.clone()), run_id],
            )?;
        }
    }
    result
}

fn sync_inner(conn: &DuckConnection, stock_code: &str, mode: &str) -> AppResult<KlineSyncResult> {
    let symbol_id = ensure_security(conn, stock_code)?;
    let has_sample_rows = has_sample_rows(conn, symbol_id)?;
    let (start_date, end_date) = choose_sync_range(conn, symbol_id, mode, has_sample_rows)?;
    if start_date > end_date {
        let coverage = get_data_coverage(conn, stock_code)?;
        return Ok(KlineSyncResult {
            stock_code: stock_code.to_string(),
            mode: mode.to_string(),
            status: "skipped".to_string(),
            rows_written: 0,
            source: "local".to_string(),
            coverage,
        });
    }

    let (bars, source, is_sample) = fetch_daily_bars_with_chain(stock_code, start_date, end_date)?;
    if !is_sample && (mode == "full" || has_sample_rows) {
        remove_sample_rows(conn, symbol_id)?;
    }
    let rows_written = upsert_daily_bars(conn, symbol_id, &bars)?;
    aggregate::aggregate_all(conn, symbol_id)?;
    let coverage = get_data_coverage(conn, stock_code)?;

    Ok(KlineSyncResult {
        stock_code: stock_code.to_string(),
        mode: mode.to_string(),
        status: "ok".to_string(),
        rows_written,
        source,
        coverage,
    })
}

fn fetch_daily_bars_with_chain(
    stock_code: &str,
    start_date: NaiveDate,
    end_date: NaiveDate,
) -> AppResult<(Vec<DailyBar>, String, bool)> {
    let mut errors = Vec::new();

    match EastmoneyDailyBarProvider::new().and_then(|provider| {
        provider
            .fetch_daily_bars(stock_code, start_date, end_date)
            .map(|bars| (provider.name(), bars))
    }) {
        Ok((source, bars)) if !bars.is_empty() => return Ok((bars, source.to_string(), false)),
        Ok((source, _)) => errors.push(format!("{} returned no bars", source)),
        Err(error) => errors.push(format!("eastmoney: {}", error.message)),
    }

    match TencentDailyBarProvider::new().and_then(|provider| {
        provider
            .fetch_daily_bars(stock_code, start_date, end_date)
            .map(|bars| (provider.name(), bars))
    }) {
        Ok((source, bars)) if !bars.is_empty() => return Ok((bars, source.to_string(), false)),
        Ok((source, _)) => errors.push(format!("{} returned no bars", source)),
        Err(error) => errors.push(format!("tencent: {}", error.message)),
    }

    let provider = SampleKlineProvider;
    let bars = provider.fetch_daily_bars(stock_code, start_date, end_date)?;
    if bars.is_empty() {
        return Err(AppError::with_detail(
            "kline_sync_failed",
            "全部 K 线 Provider 均未返回数据",
            true,
            serde_json::json!({ "errors": errors }),
        ));
    }
    Ok((bars, provider.name().to_string(), true))
}

pub fn aggregate_kline(
    conn: &DuckConnection,
    stock_code: Option<String>,
    frequency: &str,
) -> AppResult<AggregateResult> {
    if !matches!(frequency, "1w" | "1M") {
        return Err(AppError::new(
            "invalid_frequency",
            "聚合只允许 1w 或 1M",
            true,
        ));
    }
    let stock_code = stock_code.unwrap_or_else(|| "all".to_string());
    let mut total = 0;
    if stock_code == "all" {
        let mut stmt = conn.prepare("select symbol_id from securities order by symbol_id")?;
        let rows = stmt.query_map([], |row| row.get::<_, i64>(0))?;
        for row in rows {
            total += aggregate::aggregate_symbol(conn, row?, frequency)?;
        }
    } else {
        let symbol_id = get_symbol_id(conn, &stock_code)?;
        total = aggregate::aggregate_symbol(conn, symbol_id, frequency)?;
    }
    Ok(AggregateResult {
        stock_code,
        frequency: frequency.to_string(),
        rows_written: total,
    })
}

fn ensure_security(conn: &DuckConnection, stock_code: &str) -> AppResult<i64> {
    if let Ok(symbol_id) = get_symbol_id(conn, stock_code) {
        return Ok(symbol_id);
    }
    let next_id = conn.query_row(
        "select coalesce(max(symbol_id), 0) + 1 from securities",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    let exchange = if stock_code.starts_with('6') {
        "SH"
    } else {
        "SZ"
    };
    conn.execute(
        "insert into securities (symbol_id, code, name, exchange, board, list_date, status) values (?1, ?2, ?3, ?4, null, cast('2020-01-01' as date), 'active')",
        duckdb::params![next_id, stock_code, format!("股票 {}", stock_code), exchange],
    )?;
    Ok(next_id)
}

fn choose_sync_range(
    conn: &DuckConnection,
    symbol_id: i64,
    mode: &str,
    has_sample_rows: bool,
) -> AppResult<(NaiveDate, NaiveDate)> {
    let today = Utc::now().date_naive();
    if mode == "full" {
        let list_date = conn
            .query_row(
                "select cast(coalesce(list_date, cast('2020-01-01' as date)) as varchar) from securities where symbol_id = ?1",
                duckdb::params![symbol_id],
                |row| row.get::<_, String>(0),
            )?;
        let parsed = NaiveDate::parse_from_str(&list_date, "%Y-%m-%d")
            .unwrap_or_else(|_| NaiveDate::from_ymd_opt(2020, 1, 1).unwrap());
        return Ok((parsed, today));
    }

    if has_sample_rows {
        let sample_start = conn
            .query_row(
                "select cast(min(trade_date) as varchar) from bars_1d where symbol_id = ?1 and source = 'sample_fallback'",
                duckdb::params![symbol_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()?
            .flatten();
        if let Some(sample_start) = sample_start {
            if let Ok(parsed) = NaiveDate::parse_from_str(&sample_start, "%Y-%m-%d") {
                return Ok((parsed, today));
            }
        }
    }

    let last_date = conn
        .query_row(
            "select cast(max(trade_date) as varchar) from bars_1d where symbol_id = ?1",
            duckdb::params![symbol_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()?
        .flatten();
    let start = last_date
        .and_then(|date| NaiveDate::parse_from_str(&date, "%Y-%m-%d").ok())
        .map(|date| date + Duration::days(1))
        .unwrap_or_else(|| NaiveDate::from_ymd_opt(2020, 1, 1).unwrap());
    Ok((start, today))
}

fn upsert_daily_bars(conn: &DuckConnection, symbol_id: i64, bars: &[DailyBar]) -> AppResult<i64> {
    for bar in bars {
        conn.execute(
            "insert into trade_calendar (trade_date, is_open) values (?1, true) on conflict(trade_date) do update set is_open = excluded.is_open",
            duckdb::params![bar.date.to_string()],
        )?;
        conn.execute(
            r#"
            insert into bars_1d
              (symbol_id, trade_date, open, high, low, close, pre_close, volume, amount,
               turnover, adj_factor, source, updated_at)
            values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, current_timestamp)
            on conflict(symbol_id, trade_date) do update set
              open = excluded.open,
              high = excluded.high,
              low = excluded.low,
              close = excluded.close,
              pre_close = excluded.pre_close,
              volume = excluded.volume,
              amount = excluded.amount,
              turnover = excluded.turnover,
              adj_factor = excluded.adj_factor,
              source = excluded.source,
              updated_at = excluded.updated_at
            "#,
            duckdb::params![
                symbol_id,
                bar.date.to_string(),
                bar.open,
                bar.high,
                bar.low,
                bar.close,
                bar.pre_close,
                bar.volume,
                bar.amount,
                bar.turnover,
                bar.adj_factor,
                bar.source
            ],
        )?;
    }
    Ok(bars.len() as i64)
}

fn remove_sample_rows(conn: &DuckConnection, symbol_id: i64) -> AppResult<()> {
    conn.execute(
        "delete from bars_1d where symbol_id = ?1 and source = 'sample_fallback'",
        duckdb::params![symbol_id],
    )?;
    Ok(())
}

fn has_sample_rows(conn: &DuckConnection, symbol_id: i64) -> AppResult<bool> {
    let count = conn.query_row(
        "select count(*) from bars_1d where symbol_id = ?1 and source = 'sample_fallback'",
        duckdb::params![symbol_id],
        |row| row.get::<_, i64>(0),
    )?;
    Ok(count > 0)
}
