use crate::db::duckdb::DuckConnection;
use crate::error::{AppError, AppResult};
use crate::models::{FrequencyCoverage, KlineBar, KlineCoverage, Security};
use duckdb::OptionalExt;

pub fn list_securities(
    conn: &DuckConnection,
    keyword: Option<String>,
    limit: Option<i64>,
) -> AppResult<Vec<Security>> {
    let keyword = keyword.unwrap_or_default();
    let limit = limit.unwrap_or(50).clamp(1, 200);
    let like = format!("%{}%", keyword);
    let mut stmt = conn.prepare(
        r#"
        select symbol_id, code, name, exchange, board, cast(list_date as varchar), status
          from securities
         where code like ?1 or name like ?1
         order by code
         limit ?2
        "#,
    )?;
    let rows = stmt.query_map(duckdb::params![like, limit], |row| {
        Ok(Security {
            symbol_id: row.get(0)?,
            code: row.get(1)?,
            name: row.get(2)?,
            exchange: row.get(3)?,
            board: row.get(4)?,
            list_date: row.get(5)?,
            status: row.get(6)?,
        })
    })?;
    let mut values = Vec::new();
    for row in rows {
        values.push(row?);
    }
    Ok(values)
}

pub fn get_bars(
    conn: &DuckConnection,
    stock_code: &str,
    frequency: &str,
    start_date: Option<String>,
    end_date: Option<String>,
    limit: Option<i64>,
    adj: Option<String>,
) -> AppResult<Vec<KlineBar>> {
    let table = frequency_table(frequency)?;
    let symbol_id = get_symbol_id(conn, stock_code)?;
    let limit = limit.unwrap_or(500).clamp(1, 5000);
    let mut stmt = conn.prepare(&format!(
        r#"
        select *
          from (
            select cast(trade_date as varchar) as trade_date, open, high, low, close,
                   null as pre_close, volume, amount, turnover, adj_factor
              from {table}
             where symbol_id = ?1
               and (?2 is null or trade_date >= cast(?2 as date))
               and (?3 is null or trade_date <= cast(?3 as date))
             order by trade_date desc
             limit ?4
          ) t
         order by t.trade_date asc
        "#
    ))?;
    let rows = stmt.query_map(
        duckdb::params![symbol_id, start_date, end_date, limit],
        |row| {
            Ok(KlineBar {
                date: row.get(0)?,
                open: row.get(1)?,
                high: row.get(2)?,
                low: row.get(3)?,
                close: row.get(4)?,
                pre_close: row.get(5)?,
                volume: row.get(6)?,
                amount: row.get(7)?,
                turnover: row.get(8)?,
                adj_factor: row.get(9)?,
            })
        },
    )?;
    let mut values: Vec<KlineBar> = Vec::new();
    for row in rows {
        values.push(row?);
    }

    // Apply adjustment factor if requested
    if let Some(adj_mode) = adj {
        match adj_mode.as_str() {
            "pre" => apply_pre_adj(&mut values),
            "post" => apply_post_adj(&mut values),
            _ => {} // unknown mode, return unadjusted
        }
    }

    Ok(values)
}

fn apply_pre_adj(bars: &mut [KlineBar]) {
    if bars.is_empty() {
        return;
    }
    let last_adj = bars.last().and_then(|b| b.adj_factor).unwrap_or(1.0);
    if last_adj == 0.0 {
        return;
    }
    for bar in bars.iter_mut() {
        if let Some(factor) = bar.adj_factor {
            if factor != 0.0 {
                let ratio = last_adj / factor;
                bar.open *= ratio;
                bar.high *= ratio;
                bar.low *= ratio;
                bar.close *= ratio;
                bar.pre_close = bar.pre_close.map(|v| v * ratio);
                bar.volume /= ratio;
                bar.amount /= ratio;
            }
        }
    }
}

fn apply_post_adj(bars: &mut [KlineBar]) {
    if bars.is_empty() {
        return;
    }
    let first_adj = bars.first().and_then(|b| b.adj_factor).unwrap_or(1.0);
    if first_adj == 0.0 {
        return;
    }
    for bar in bars.iter_mut() {
        if let Some(factor) = bar.adj_factor {
            if factor != 0.0 {
                let ratio = factor / first_adj;
                bar.open *= ratio;
                bar.high *= ratio;
                bar.low *= ratio;
                bar.close *= ratio;
                bar.pre_close = bar.pre_close.map(|v| v * ratio);
                bar.volume /= ratio;
                bar.amount /= ratio;
            }
        }
    }
}

pub fn get_data_coverage(conn: &DuckConnection, stock_code: &str) -> AppResult<KlineCoverage> {
    let symbol_id = get_symbol_id(conn, stock_code)?;
    let last_sync_at = conn
        .query_row(
            "select cast(max(finished_at) as varchar) from kline_sync_runs where stock_code = ?1 and status = 'ok'",
            duckdb::params![stock_code],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()?
        .flatten();

    Ok(KlineCoverage {
        stock_code: stock_code.to_string(),
        daily: coverage_for(conn, symbol_id, "bars_1d", "1d")?,
        weekly: coverage_for(conn, symbol_id, "bars_1w", "1w")?,
        monthly: coverage_for(conn, symbol_id, "bars_1M", "1M")?,
        last_sync_at,
    })
}

pub fn get_symbol_id(conn: &DuckConnection, stock_code: &str) -> AppResult<i64> {
    conn.query_row(
        "select symbol_id from securities where code = ?1",
        duckdb::params![stock_code],
        |row| row.get(0),
    )
    .optional()?
    .ok_or_else(|| AppError::new("not_found", "证券不存在，请先同步或检查代码", true))
}

fn coverage_for(
    conn: &DuckConnection,
    symbol_id: i64,
    table: &str,
    frequency: &str,
) -> AppResult<FrequencyCoverage> {
    conn.query_row(
        &format!(
            "select cast(min(trade_date) as varchar), cast(max(trade_date) as varchar), count(*) from {} where symbol_id = ?1",
            table
        ),
        duckdb::params![symbol_id],
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

fn frequency_table(frequency: &str) -> AppResult<&'static str> {
    match frequency {
        "1d" => Ok("bars_1d"),
        "1w" => Ok("bars_1w"),
        "1M" => Ok("bars_1M"),
        _ => Err(AppError::new(
            "invalid_frequency",
            "frequency 只允许 1d、1w、1M",
            true,
        )),
    }
}
