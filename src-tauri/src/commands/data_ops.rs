use crate::app_state::AppState;
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecuritySearchResult {
    pub symbol: String,
    pub code: String,
    pub name: String,
    pub market_type: Option<String>,
    pub stock_type: String,
}

#[tauri::command]
pub async fn search_securities(
    state: State<'_, AppState>,
    keyword: String,
    limit: Option<usize>,
) -> Result<Vec<SecuritySearchResult>, String> {
    let db = state.duckdb.lock().map_err(|_| "lock busy".to_string())?;
    let limit = limit.unwrap_or(20).clamp(1, 100);
    let keyword = keyword.trim();
    let pattern = format!("%{}%", keyword);
    let mut stmt = db
        .prepare(
            "SELECT symbol, code, name, market_type, stock_type FROM securities
             WHERE (
                    lower(symbol) LIKE lower(?1)
                 OR lower(code) LIKE lower(?1)
                 OR lower(name) LIKE lower(?1)
             )
               AND status = 'active'
             ORDER BY
               CASE
                 WHEN lower(symbol) = lower(?2) THEN 0
                 WHEN lower(code) = lower(?2) THEN 1
                 WHEN lower(code) LIKE lower(?1) THEN 2
                 ELSE 3
               END,
               code,
               exchange
             LIMIT ?3",
        )
        .map_err(|e| e.to_string())?;
    let results: Vec<SecuritySearchResult> = stmt
        .query_map(duckdb::params![pattern, keyword, limit as i64], |row| {
            Ok(SecuritySearchResult {
                symbol: row.get(0)?,
                code: row.get(1)?,
                name: row.get(2)?,
                market_type: row.get(3)?,
                stock_type: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(results)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataHealth {
    pub total_securities: i64,
    pub complete_count: i64,
    pub incomplete_count: i64,
    pub completeness_pct: f64,
    pub mood: String,
    pub by_market: Vec<MarketBreakdown>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketBreakdown {
    pub market_type: String,
    pub total: i64,
    pub complete: i64,
}

#[tauri::command]
pub async fn get_data_health(state: State<'_, AppState>) -> Result<DataHealth, String> {
    let db = state.duckdb.lock().map_err(|_| "lock busy".to_string())?;
    let total: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM securities WHERE stock_type='stock' AND status='active'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let complete: i64 = db
        .query_row(
            "with stock_mapping as (
            select m.app_symbol, m.last_kline_date
              from kline_mapping m
              join securities s on s.symbol = m.app_symbol
             where s.stock_type = 'stock' and s.status = 'active'
          ),
          latest as (
            select max(last_kline_date) as date from stock_mapping
          )
          select count(*)
            from stock_mapping
           where last_kline_date = (select date from latest)",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let incomplete = total - complete;
    let completeness_pct = if total > 0 {
        (complete as f64 / total as f64) * 100.0
    } else {
        0.0
    };
    let mood = if completeness_pct >= 95.0 {
        "good".to_string()
    } else if completeness_pct >= 70.0 {
        "ok".to_string()
    } else {
        "bad".to_string()
    };

    let mut stmt = db
        .prepare(
            "with latest as (
                select max(last_kline_date) as date
                  from kline_mapping m
                  join securities s on s.symbol = m.app_symbol
                 where s.stock_type = 'stock' and s.status = 'active'
             )
             select coalesce(s.market_type, '未知'), count(*),
                    count(case when m.last_kline_date = (select date from latest) then 1 end)
               from securities s
               left join kline_mapping m on m.app_symbol = s.symbol
              where s.stock_type = 'stock' and s.status = 'active'
              group by s.market_type
              order by count(*) desc",
        )
        .map_err(|e| e.to_string())?;
    let by_market: Vec<MarketBreakdown> = stmt
        .query_map([], |row| {
            Ok(MarketBreakdown {
                market_type: row.get(0)?,
                total: row.get(1)?,
                complete: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(DataHealth {
        total_securities: total,
        complete_count: complete,
        incomplete_count: incomplete,
        completeness_pct,
        mood,
        by_market,
    })
}
