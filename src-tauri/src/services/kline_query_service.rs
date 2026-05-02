use crate::db::duckdb::DuckConnection;
use crate::error::{AppError, AppResult};
use crate::models::{FrequencyCoverage, KlineBar, KlineCoverage, Security};
use duckdb::OptionalExt;

pub fn list_securities(
    conn: &DuckConnection,
    keyword: Option<String>,
    limit: Option<i64>,
) -> AppResult<Vec<Security>> {
    let keyword = keyword.unwrap_or_default().trim().to_lowercase();
    let limit = limit.unwrap_or(50).clamp(1, 10000);
    let like = format!("%{}%", keyword);

    let (sql, has_filter) = if keyword.is_empty() {
        (r#"
        select s.symbol, s.code, s.name, s.exchange, s.board, s.industry, coalesce(s.stock_type, 'stock'),
               cast(s.list_date as varchar), s.status, s.latest_price, s.change_pct, s.latest_date,
               case
                 when km.last_kline_date is null then 'missing'
                 when km.last_kline_date = (select max(last_kline_date) from kline_mapping) then 'complete'
                 else 'stale'
               end as data_status
          from securities s
          left join kline_mapping km on km.app_symbol = s.symbol
         where s.status = 'active'
         order by s.code, s.exchange
         limit ?1
        "#.to_string(), false)
    } else {
        (r#"
        select s.symbol, s.code, s.name, s.exchange, s.board, s.industry, coalesce(s.stock_type, 'stock'),
               cast(s.list_date as varchar), s.status, s.latest_price, s.change_pct, s.latest_date,
               case
                 when km.last_kline_date is null then 'missing'
                 when km.last_kline_date = (select max(last_kline_date) from kline_mapping) then 'complete'
                 else 'stale'
               end as data_status
          from securities s
          left join kline_mapping km on km.app_symbol = s.symbol
         where s.status = 'active'
           and (lower(s.code) like ?1 or lower(s.name) like ?1 or lower(s.symbol) like ?1)
         order by s.code, s.exchange
         limit ?2
        "#.to_string(), true)
    };

    let mut stmt = conn.prepare(&sql)?;
    let rows: Vec<Security> = if has_filter {
        stmt.query_map(duckdb::params![like, limit], |row| {
            Ok(Security {
                symbol: row.get(0)?,
                code: row.get(1)?,
                name: row.get(2)?,
                exchange: row.get(3)?,
                board: row.get(4)?,
                industry: row.get(5)?,
                stock_type: row.get(6)?,
                list_date: row.get(7)?,
                status: row.get(8)?,
                latest_price: row.get(9)?,
                change_pct: row.get(10)?,
                latest_date: row.get(11)?,
                data_status: row.get(12)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect()
    } else {
        stmt.query_map(duckdb::params![limit], |row| {
            Ok(Security {
                symbol: row.get(0)?,
                code: row.get(1)?,
                name: row.get(2)?,
                exchange: row.get(3)?,
                board: row.get(4)?,
                industry: row.get(5)?,
                stock_type: row.get(6)?,
                list_date: row.get(7)?,
                status: row.get(8)?,
                latest_price: row.get(9)?,
                change_pct: row.get(10)?,
                latest_date: row.get(11)?,
                data_status: row.get(12)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect()
    };

    Ok(rows)
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
    validate_frequency(frequency)?;
    let symbol = resolve_symbol(conn, stock_code)?;
    let adj_mode = normalize_adj(adj.as_deref());
    let limit = limit.unwrap_or(500).clamp(1, 5000);
    let mut values = query_bars(
        conn,
        &symbol,
        frequency,
        start_date.as_deref(),
        end_date.as_deref(),
        limit,
        adj_mode,
    )?;
    if values.is_empty() && adj_mode != "none" {
        values = query_bars(
            conn,
            &symbol,
            frequency,
            start_date.as_deref(),
            end_date.as_deref(),
            limit,
            "none",
        )?;
    }
    Ok(values)
}

fn query_bars(
    conn: &DuckConnection,
    symbol: &str,
    frequency: &str,
    start_date: Option<&str>,
    end_date: Option<&str>,
    limit: i64,
    adj_mode: &str,
) -> AppResult<Vec<KlineBar>> {
    let mut stmt = conn.prepare(
        r#"
        select *
          from (
            select cast(trade_date as varchar) as trade_date, open, high, low, close,
                   pre_close, volume, amount, turnover_rate, null as adj_factor,
                   change, change_pct, amplitude
             from kline_bars
             where symbol = ?1
               and period = ?2
               and adj_mode = ?3
               and (?4 is null or trade_date >= cast(?4 as date))
               and (?5 is null or trade_date <= cast(?5 as date))
             order by trade_date desc
             limit ?6
          ) t
         order by t.trade_date asc
        "#,
    )?;
    let rows = stmt.query_map(
        duckdb::params![symbol, frequency, adj_mode, start_date, end_date, limit],
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
                change: row.get(10)?,
                change_pct: row.get(11)?,
                amplitude: row.get(12)?,
            })
        },
    )?;
    let mut values: Vec<KlineBar> = Vec::new();
    for row in rows {
        values.push(row?);
    }

    Ok(values)
}

pub fn get_data_coverage(conn: &DuckConnection, stock_code: &str) -> AppResult<KlineCoverage> {
    let symbol = resolve_symbol(conn, stock_code)?;
    let last_sync_at = conn
        .query_row(
            "select cast(max(finished_at) as varchar) from kline_sync_runs where stock_code = ?1 and status = 'ok'",
            duckdb::params![symbol],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()?
        .flatten();

    Ok(KlineCoverage {
        stock_code: symbol.clone(),
        daily: coverage_for(conn, &symbol, "1d")?,
        weekly: coverage_for(conn, &symbol, "1w")?,
        monthly: coverage_for(conn, &symbol, "1M")?,
        quarterly: coverage_for(conn, &symbol, "1Q")?,
        yearly: coverage_for(conn, &symbol, "1Y")?,
        last_sync_at,
    })
}

fn coverage_for(
    conn: &DuckConnection,
    symbol: &str,
    frequency: &str,
) -> AppResult<FrequencyCoverage> {
    conn.query_row(
        "select cast(min(trade_date) as varchar), cast(max(trade_date) as varchar), count(*)
           from kline_bars
          where symbol = ?1 and period = ?2 and adj_mode = 'none'",
        duckdb::params![symbol, frequency],
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

pub fn resolve_symbol(conn: &DuckConnection, input: &str) -> AppResult<String> {
    let normalized = input.trim().to_uppercase();
    conn.query_row(
        r#"
        select symbol
          from securities
         where upper(symbol) = ?1 or code = ?1
         order by case when upper(symbol) = ?1 then 0 when stock_type = 'stock' then 1 else 2 end,
                  case exchange when 'SZ' then 0 when 'SH' then 1 when 'BJ' then 2 else 3 end
         limit 1
        "#,
        duckdb::params![normalized],
        |row| row.get(0),
    )
    .optional()?
    .ok_or_else(|| AppError::new("not_found", "证券不存在，请先同步或检查代码", true))
}

fn normalize_adj(adj: Option<&str>) -> &'static str {
    match adj {
        Some("pre") | Some("forward") => "forward",
        Some("post") | Some("backward") => "backward",
        _ => "none",
    }
}

fn validate_frequency(frequency: &str) -> AppResult<()> {
    match frequency {
        "1d" | "1w" | "1M" | "1Q" | "1Y" => Ok(()),
        _ => Err(AppError::new(
            "invalid_frequency",
            "frequency 只允许 1d、1w、1M、1Q、1Y",
            true,
        )),
    }
}
