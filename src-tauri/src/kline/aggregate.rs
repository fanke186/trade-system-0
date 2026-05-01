use crate::error::AppResult;
use crate::kline::provider::DailyBar;
use chrono::Datelike;
use duckdb::Connection;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
enum AggregateKey {
    Week(i32, u32),
    Month(i32, u32),
}

pub fn aggregate_symbol(conn: &Connection, symbol_id: i64, frequency: &str) -> AppResult<i64> {
    let daily = load_daily(conn, symbol_id)?;
    let rows = match frequency {
        "1w" => aggregate_bars(daily, |bar| {
            let week = bar.date.iso_week();
            AggregateKey::Week(week.year(), week.week())
        }),
        "1M" => aggregate_bars(daily, |bar| AggregateKey::Month(bar.date.year(), bar.date.month())),
        _ => return Ok(0),
    };

    let table = if frequency == "1w" { "bars_1w" } else { "bars_1M" };
    conn.execute(&format!("delete from {} where symbol_id = ?1", table), duckdb::params![symbol_id])?;
    for bar in &rows {
        conn.execute(
            &format!(
                r#"
                insert into {} (symbol_id, trade_date, open, high, low, close, volume, amount, turnover, adj_factor, updated_at)
                values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, current_timestamp)
                "#,
                table
            ),
            duckdb::params![
                symbol_id,
                bar.date.to_string(),
                bar.open,
                bar.high,
                bar.low,
                bar.close,
                bar.volume,
                bar.amount,
                bar.turnover,
                bar.adj_factor
            ],
        )?;
    }
    Ok(rows.len() as i64)
}

pub fn aggregate_all(conn: &Connection, symbol_id: i64) -> AppResult<(i64, i64)> {
    let weekly = aggregate_symbol(conn, symbol_id, "1w")?;
    let monthly = aggregate_symbol(conn, symbol_id, "1M")?;
    Ok((weekly, monthly))
}

fn load_daily(conn: &Connection, symbol_id: i64) -> AppResult<Vec<DailyBar>> {
    let mut stmt = conn.prepare(
        r#"
        select cast(trade_date as varchar), open, high, low, close, pre_close, volume, amount,
               turnover, adj_factor, coalesce(source, 'local')
          from bars_1d
         where symbol_id = ?1
         order by trade_date asc
        "#,
    )?;
    let rows = stmt.query_map(duckdb::params![symbol_id], |row| {
        let date: String = row.get(0)?;
        Ok(DailyBar {
            date: chrono::NaiveDate::parse_from_str(&date, "%Y-%m-%d").unwrap(),
            open: row.get(1)?,
            high: row.get(2)?,
            low: row.get(3)?,
            close: row.get(4)?,
            pre_close: row.get(5)?,
            volume: row.get(6)?,
            amount: row.get(7)?,
            turnover: row.get(8)?,
            adj_factor: row.get(9)?,
            source: row.get(10)?,
        })
    })?;
    let mut values = Vec::new();
    for row in rows {
        values.push(row?);
    }
    Ok(values)
}

fn aggregate_bars<F>(daily: Vec<DailyBar>, key_fn: F) -> Vec<DailyBar>
where
    F: Fn(&DailyBar) -> AggregateKey,
{
    let mut groups: BTreeMap<AggregateKey, Vec<DailyBar>> = BTreeMap::new();
    for bar in daily {
        groups.entry(key_fn(&bar)).or_default().push(bar);
    }
    groups
        .into_values()
        .filter_map(|bars| {
            let first = bars.first()?;
            let last = bars.last()?;
            Some(DailyBar {
                date: last.date,
                open: first.open,
                high: bars.iter().map(|bar| bar.high).fold(f64::MIN, f64::max),
                low: bars.iter().map(|bar| bar.low).fold(f64::MAX, f64::min),
                close: last.close,
                pre_close: first.pre_close,
                volume: bars.iter().map(|bar| bar.volume).sum(),
                amount: bars.iter().map(|bar| bar.amount).sum(),
                turnover: average_optional(&bars, |bar| bar.turnover),
                adj_factor: last.adj_factor,
                source: "aggregate".to_string(),
            })
        })
        .collect()
}

fn average_optional<F>(bars: &[DailyBar], value_fn: F) -> Option<f64>
where
    F: Fn(&DailyBar) -> Option<f64>,
{
    let values: Vec<f64> = bars.iter().filter_map(value_fn).collect();
    if values.is_empty() {
        None
    } else {
        Some(values.iter().sum::<f64>() / values.len() as f64)
    }
}

