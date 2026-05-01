use crate::app_state::AppState;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, State};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecuritySearchResult {
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
    let limit = limit.unwrap_or(20);
    let pattern = format!("%{}%", keyword);
    let mut stmt = db
        .prepare(
            "SELECT code, name, market_type, stock_type FROM securities
             WHERE (code LIKE ?1 OR name LIKE ?2) AND status = 'active'
             ORDER BY CASE WHEN code LIKE ?1 THEN 0 ELSE 1 END, code
             LIMIT ?3",
        )
        .map_err(|e| e.to_string())?;
    let results: Vec<SecuritySearchResult> = stmt
        .query_map(duckdb::params![pattern, pattern, limit as i64], |row| {
            Ok(SecuritySearchResult {
                code: row.get(0)?,
                name: row.get(1)?,
                market_type: row.get(2)?,
                stock_type: row.get(3)?,
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
pub async fn get_data_health(
    state: State<'_, AppState>,
) -> Result<DataHealth, String> {
    let db = state.duckdb.lock().map_err(|_| "lock busy".to_string())?;
    let total: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM securities WHERE stock_type='stock' AND status='active'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let latest_date: Option<String> = db
        .query_row("SELECT MAX(trade_date) FROM bars_1d", [], |r| r.get(0))
        .ok();

    let complete: i64 = if let Some(ref d) = latest_date {
        db.query_row(
            "SELECT COUNT(DISTINCT b.symbol_id) FROM bars_1d b
             INNER JOIN securities s ON s.symbol_id = b.symbol_id
             WHERE s.stock_type='stock' AND s.status='active' AND b.trade_date = ?1",
            [d.as_str()],
            |r| r.get(0),
        )
        .unwrap_or(0)
    } else {
        0
    };

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
            "SELECT COALESCE(s.market_type,'未知'), COUNT(*),
                    COUNT(DISTINCT CASE WHEN b.symbol_id IS NOT NULL THEN s.symbol_id END)
             FROM securities s
             LEFT JOIN bars_1d b ON s.symbol_id = b.symbol_id AND b.trade_date = (SELECT MAX(trade_date) FROM bars_1d)
             WHERE s.stock_type='stock' AND s.status='active'
             GROUP BY s.market_type ORDER BY COUNT(*) DESC",
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

#[derive(Deserialize)]
struct EastmoneySecItem {
    #[serde(rename = "f12")]
    code: String,
    #[serde(rename = "f13")]
    market: i32,
    #[serde(rename = "f14")]
    name: String,
    #[serde(rename = "f100")]
    industry: Option<String>,
}

#[derive(Deserialize)]
struct EastmoneySecResponse {
    data: Option<EastmoneySecData>,
}

#[derive(Deserialize)]
struct EastmoneySecData {
    diff: Option<Vec<EastmoneySecItem>>,
}

#[tauri::command]
pub async fn sync_securities_metadata(
    app: tauri::AppHandle,
) -> Result<i64, String> {
    app.emit("securities-sync-progress", serde_json::json!({
        "status": "started", "percent": 0
    })).ok();

    let app_handle = app.clone();
    let result: Result<i64, String> = tokio::task::spawn_blocking(move || {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .user_agent("Mozilla/5.0 trade-system-0/0.1")
            .build()
            .map_err(|e| format!("Client build: {e}"))?;

        let mut total_upserted = 0i64;
        let mut max_symbol_id: i64 = 0;

        for page in 1..=3i32 {
            let url = format!(
                "https://push2.eastmoney.com/api/qt/clist/get?pn={page}&pz=5000&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23&fields=f2,f3,f4,f12,f13,f14,f100"
            );
            let resp = client.get(&url)
                .header("Referer", "https://quote.eastmoney.com/")
                .send()
                .map_err(|e| format!("HTTP: {e}"))?;
            let body: EastmoneySecResponse = resp.json()
                .map_err(|e| format!("JSON: {e}"))?;

            let items = match body.data.and_then(|d| d.diff) {
                Some(v) => v,
                None => break,
            };
            if items.is_empty() { break; }

            let rows: Vec<(i64, String, String, String, String, Option<String>)> = items.iter()
                .filter(|item| !item.code.starts_with('9') && item.code.len() <= 6)
                .map(|item| {
                    max_symbol_id += 1;
                    let exchange = if item.market == 1 { "SH" } else { "SZ" };
                    let market_type = if item.code.starts_with("688") { "科创板" }
                        else if item.code.starts_with("300") || item.code.starts_with("301") { "创业板" }
                        else if item.code.starts_with("8") || item.code.starts_with("4") { "北交所" }
                        else { "主板" };
                    (max_symbol_id, item.code.clone(), item.name.clone(), exchange.to_string(), market_type.to_string(), item.industry.clone())
                })
                .collect();

            {
                let app_state = app_handle.state::<AppState>();
                let db = app_state.duckdb.lock().map_err(|_| "lock poisoned".to_string())?;
                for (id, code, name, exchange, market_type, industry) in &rows {
                    db.execute(
                        "insert or replace into securities (symbol_id, code, name, exchange, board, market_type, stock_type, industry, status)
                         values (?1, ?2, ?3, ?4, ?5, ?6, 'stock', ?7, 'active')",
                        duckdb::params![id, code, name, exchange, market_type, market_type, industry],
                    ).ok();
                }
            }
            total_upserted += rows.len() as i64;
            app_handle.emit("securities-sync-progress", serde_json::json!({
                "status": "syncing", "percent": ((page as f64 / 3.0) * 100.0) as i32, "count": total_upserted
            })).ok();
        }

        app_handle.emit("securities-sync-progress", serde_json::json!({
            "status": "completed", "percent": 100, "count": total_upserted
        })).ok();

        Ok(total_upserted)
    }).await.map_err(|e| format!("Join error: {e}"))?;

    result
}
