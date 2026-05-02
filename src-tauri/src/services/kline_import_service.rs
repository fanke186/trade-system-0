use crate::db::duckdb::DuckConnection;
use crate::error::AppResult;
use std::path::Path;

/// Import Parquet files written by the Python sync script into DuckDB.
/// Requires securities table to already have the symbols (via sync_securities_metadata).
pub fn import_parquet(conn: &DuckConnection, data_dir: &Path, period: &str) -> AppResult<i64> {
    let table = table_for(period)?;
    let pattern = format!("{}/{}/*.parquet", data_dir.display(), period);

    let parquet_rows: i64 = conn
        .query_row(
            &format!("select count(*) from read_parquet('{pattern}')"),
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    if parquet_rows == 0 {
        return Ok(0);
    }

    conn.execute(
        &format!(
            r#"
            insert or replace into {table}
              (symbol_id, trade_date, open, high, low, close, pre_close, volume, amount,
               turnover, adj_factor, change, change_pct, amplitude, source, updated_at)
            select
              s.symbol_id,
              cast(k.trade_date as date),
              k.open, k.high, k.low, k.close, k.pre_close,
              k.volume, k.amount, k.turnover, k.adj_factor,
              coalesce(k.change, close - pre_close),
              coalesce(k.change_pct, (close / pre_close - 1) * 100),
              coalesce(k.amplitude, (high - low) / pre_close * 100),
              'tickflow',
              current_timestamp
            from read_parquet('{pattern}') k
            join securities s on s.code = regexp_extract(k.symbol, '^([^.]+)', 1)
            "#
        ),
        [],
    )?;

    conn.execute(
        &format!(
            "insert or ignore into trade_calendar (trade_date, is_open)
             select distinct trade_date, true from {table}"
        ),
        [],
    )?;

    Ok(parquet_rows)
}

pub fn table_for(period: &str) -> AppResult<&'static str> {
    match period {
        "1d" => Ok("bars_1d"),
        "1w" => Ok("bars_1w"),
        "1M" => Ok("bars_1M"),
        "1Q" => Ok("bars_1Q"),
        "1Y" => Ok("bars_1Y"),
        _ => Err(crate::error::AppError::new(
            "invalid_frequency",
            "frequency 只允许 1d、1w、1M、1Q、1Y",
            true,
        )),
    }
}
