use crate::app_state::AppState;
use crate::db::duckdb::DuckConnection;
use crate::error::AppResult;
use crate::models::StockMeta;
use chrono::{Datelike, NaiveDate, Weekday};
use duckdb::OptionalExt;
use tauri::State;

#[tauri::command]
pub fn get_stock_meta(state: State<'_, AppState>, code: String) -> AppResult<StockMeta> {
    let duck = state.duckdb.lock().expect("duckdb lock");

    // Query security info from DuckDB securities table
    let mut stmt = duck.prepare(
        r#"
        select symbol_id, code, name, exchange, board, cast(list_date as varchar), status
          from securities
         where code = ?1
        "#,
    )?;
    let (symbol_id, sec_code, name, exchange, board, list_date, status): (
        i64,
        String,
        String,
        String,
        Option<String>,
        Option<String>,
        String,
    ) = stmt
        .query_row(duckdb::params![code], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get(6)?,
            ))
        })
        .optional()?
        .ok_or_else(|| {
            crate::error::AppError::new("not_found", "证券不存在，请先同步或检查代码", true)
        })?;

    if status != "active" {
        return Ok(StockMeta {
            code: sec_code,
            name,
            exchange,
            board,
            list_date,
            latest_price: None,
            pre_close: None,
            change: None,
            change_pct: None,
            latest_date: None,
            stale: true,
        });
    }

    // Query latest bar from bars_1d
    let latest = query_latest_bar(&duck, symbol_id)?;

    let (latest_price, pre_close_val, change, change_pct, latest_date, stale) =
        if let Some((close, pre_close, trade_date)) = latest {
            let change_val = close - pre_close;
            let change_pct_val = if pre_close != 0.0 {
                (change_val / pre_close) * 100.0
            } else {
                0.0
            };
            let stale = is_stale(&trade_date);
            (
                Some(close),
                Some(pre_close),
                Some(change_val),
                Some(change_pct_val),
                Some(trade_date),
                stale,
            )
        } else {
            (None, None, None, None, None, true)
        };

    Ok(StockMeta {
        code: sec_code,
        name,
        exchange,
        board,
        list_date,
        latest_price,
        pre_close: pre_close_val,
        change,
        change_pct,
        latest_date,
        stale,
    })
}

fn query_latest_bar(
    conn: &DuckConnection,
    symbol_id: i64,
) -> AppResult<Option<(f64, f64, String)>> {
    let mut stmt = conn.prepare(
        r#"
        select close, pre_close, cast(trade_date as varchar)
          from bars_1d
         where symbol_id = ?1 and pre_close is not null
         order by trade_date desc
         limit 1
        "#,
    )?;
    let result = stmt
        .query_row(duckdb::params![symbol_id], |row| {
            Ok((row.get::<_, f64>(0)?, row.get::<_, f64>(1)?, row.get::<_, String>(2)?))
        })
        .optional()?;
    Ok(result)
}

fn is_stale(latest_date_str: &str) -> bool {
    let Ok(latest_date) = NaiveDate::parse_from_str(latest_date_str, "%Y-%m-%d") else {
        return true;
    };
    let today = chrono::Utc::now()
        .date_naive();
    let boundary = match today.weekday() {
        Weekday::Mon => today - chrono::Duration::days(3), // compare against Fri
        Weekday::Sat | Weekday::Sun => today,               // compare against today
        _ => today - chrono::Duration::days(1),             // compare against yesterday
    };
    latest_date < boundary
}
