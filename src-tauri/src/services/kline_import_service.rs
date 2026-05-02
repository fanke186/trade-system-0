use crate::db::duckdb::DuckConnection;
use crate::error::AppResult;
use std::path::Path;

/// Import securities metadata written by the Python sync script into DuckDB.
pub fn import_securities(conn: &DuckConnection, data_dir: &Path) -> AppResult<i64> {
    let pattern = format!("{}/securities/*.parquet", data_dir.display());
    let rows: i64 = conn
        .query_row(
            &format!("select count(*) from read_parquet('{pattern}')"),
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    if rows == 0 {
        return Ok(0);
    }

    conn.execute(
        &format!(
            r#"
            insert into securities
              (symbol, code, name, exchange, board, list_date, status, industry, sub_industry,
               area, market_type, stock_type, total_shares, float_shares, tick_size,
               limit_up, limit_down, updated_at)
            select
              symbol,
              code,
              name,
              exchange,
              board,
              try_cast(list_date as date),
              coalesce(status, 'active'),
              industry,
              sub_industry,
              area,
              market_type,
              coalesce(stock_type, 'stock'),
              total_shares,
              float_shares,
              tick_size,
              limit_up,
              limit_down,
              current_timestamp
            from read_parquet('{pattern}')
            where symbol is not null
            on conflict(symbol) do update set
              code = excluded.code,
              name = excluded.name,
              exchange = excluded.exchange,
              board = coalesce(excluded.board, securities.board),
              list_date = coalesce(excluded.list_date, securities.list_date),
              status = excluded.status,
              industry = coalesce(excluded.industry, securities.industry),
              sub_industry = coalesce(excluded.sub_industry, securities.sub_industry),
              area = coalesce(excluded.area, securities.area),
              market_type = coalesce(excluded.market_type, securities.market_type),
              stock_type = coalesce(excluded.stock_type, securities.stock_type),
              total_shares = coalesce(excluded.total_shares, securities.total_shares),
              float_shares = coalesce(excluded.float_shares, securities.float_shares),
              tick_size = coalesce(excluded.tick_size, securities.tick_size),
              limit_up = coalesce(excluded.limit_up, securities.limit_up),
              limit_down = coalesce(excluded.limit_down, securities.limit_down),
              updated_at = current_timestamp
            "#
        ),
        [],
    )?;

    Ok(rows)
}

/// Import Parquet files written by the Python sync script into DuckDB.
pub fn import_parquet(
    conn: &DuckConnection,
    data_dir: &Path,
    period: &str,
    adj_mode: &str,
) -> AppResult<i64> {
    validate_period(period)?;
    let pattern = format!("{}/{}/{adj_mode}/*.parquet", data_dir.display(), period);

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
            insert or replace into kline_bars
              (symbol, period, adj_mode, trade_date, open, high, low, close, pre_close, volume,
               amount, change, change_pct, amplitude, turnover_rate, source, updated_at)
            select
              k.symbol,
              k.period,
              k.adj_mode,
              cast(k.trade_date as date),
              k.open, k.high, k.low, k.close, k.pre_close,
              k.volume, k.amount,
              coalesce(k.change, close - pre_close),
              coalesce(k.change_pct, (close / pre_close - 1) * 100),
              coalesce(k.amplitude, (high - low) / pre_close * 100),
              k.turnover_rate,
              'tickflow',
              current_timestamp
            from read_parquet('{pattern}') k
            join securities s on s.symbol = k.symbol
            "#
        ),
        [],
    )?;

    conn.execute(
        "insert or ignore into trade_calendar (trade_date, is_open)
         select distinct trade_date, true from kline_bars where period = '1d'",
        [],
    )?;

    Ok(parquet_rows)
}

pub fn validate_period(period: &str) -> AppResult<()> {
    match period {
        "1d" | "1w" | "1M" | "1Q" | "1Y" => Ok(()),
        _ => Err(crate::error::AppError::new(
            "invalid_frequency",
            "frequency 只允许 1d、1w、1M、1Q、1Y",
            true,
        )),
    }
}
