use crate::app_state::AppState;
use crate::error::{AppError, AppResult};
use crate::llm::client::{call_model, ModelCallOptions};
use crate::llm::json_guard::parse_and_validate_stock_review;
use crate::llm::prompts::{build_agent_prompt, build_scoring_user_prompt};
use crate::models::{ChatMessage, DailyReviewItem, DailyReviewRun, StockReview};
use crate::services::annotation_service;
use crate::services::common::{new_id, now_iso, sha256_hex};
use crate::services::kline_query_service::{get_bars, get_data_coverage};
use crate::services::model_provider_service::{get_active_provider, get_provider, resolve_api_key};
use crate::services::trade_system_service::get_version;
use crate::services::watchlist_service::list_items;
use rusqlite::{params, Connection};
use serde_json::Value;

pub async fn score_stock(
    state: &AppState,
    stock_code: String,
    trade_system_version_id: String,
    provider_id: Option<String>,
) -> AppResult<StockReview> {
    let (version, coverage, daily, weekly, monthly, quarterly, yearly, annotations, provider) = {
        let sqlite = state.sqlite.lock().expect("sqlite lock");
        let duck = state.duckdb.lock().expect("duckdb lock");
        let version = get_version(&sqlite, &trade_system_version_id)?;
        if !version.completeness_report.can_score {
            return Ok(data_required_review(
                &stock_code,
                &version.trade_system_id,
                &version.id,
                "invalid_trade_system",
                "undefined_rule",
                "交易系统完整性不足，不能用于正式评分",
                serde_json::to_value(&version.completeness_report)?,
            ));
        }

        let coverage = get_data_coverage(&duck, &stock_code)?;
        if coverage.daily.rows < 60 || coverage.weekly.rows < 12 || coverage.monthly.rows < 6 {
            return Ok(data_required_review(
                &stock_code,
                &version.trade_system_id,
                &version.id,
                "data_required",
                "data_required",
                "本地 K 线覆盖不足，请先同步更多历史数据",
                serde_json::to_value(&coverage)?,
            ));
        }

        let daily = get_bars(&duck, &stock_code, "1d", None, None, Some(160), None)?;
        let weekly = get_bars(&duck, &stock_code, "1w", None, None, Some(80), None)?;
        let monthly = get_bars(&duck, &stock_code, "1M", None, None, Some(60), None)?;
        let quarterly = get_bars(&duck, &stock_code, "1Q", None, None, Some(40), None)
            .unwrap_or_default();
        let yearly = get_bars(&duck, &stock_code, "1Y", None, None, Some(20), None)
            .unwrap_or_default();
        let annotations = annotation_service::list_chart_annotations(
            &sqlite,
            &stock_code,
            Some(version.id.clone()),
        )?;
        let provider = if let Some(provider_id) = provider_id {
            Some(get_provider(&sqlite, &provider_id)?)
        } else {
            get_active_provider(&sqlite)?
        }
        .ok_or_else(|| AppError::new("provider_request_failed", "未配置活跃模型 Provider", true))?;
        (
            version,
            coverage,
            daily,
            weekly,
            monthly,
            quarterly,
            yearly,
            annotations,
            provider,
        )
    };

    let coverage_json = serde_json::to_value(&coverage)?;
    let bars_summary = serde_json::json!({
        "daily": summarize_bars(&daily),
        "weekly": summarize_bars(&weekly),
        "monthly": summarize_bars(&monthly),
        "quarterly": summarize_bars(&quarterly),
        "yearly": summarize_bars(&yearly),
        "recent_daily": daily.iter().rev().take(20).cloned().collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>(),
        "recent_weekly": weekly.iter().rev().take(16).cloned().collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>(),
        "recent_monthly": monthly.iter().rev().take(12).cloned().collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>()
    });
    let annotation_json = serde_json::to_value(&annotations)?;
    let system_prompt = build_agent_prompt(&version);
    let user_prompt =
        build_scoring_user_prompt(&stock_code, &coverage_json, &bars_summary, &annotation_json);
    let prompt_hash = sha256_hex(&format!("{}\n{}", system_prompt, user_prompt));

    let api_key = resolve_api_key(&state.app_dir, &provider)?;
    let content = call_model(
        &state.http,
        &provider,
        &api_key,
        ModelCallOptions {
            system_prompt,
            messages: vec![ChatMessage {
                role: "user".to_string(),
                content: user_prompt,
            }],
            response_format: Some("json_object".to_string()),
            temperature: Some(provider.temperature),
            max_tokens: Some(provider.max_tokens),
        },
    )
    .await?;
    let parsed = parse_and_validate_stock_review(&content)?;
    let review = persist_review(
        state,
        &stock_code,
        &version.trade_system_id,
        &version.id,
        Some(provider.id.clone()),
        parsed,
        coverage_json,
        prompt_hash,
    )?;
    Ok(review)
}

pub fn get_stock_reviews(
    conn: &Connection,
    stock_code: Option<String>,
    trade_system_version_id: Option<String>,
) -> AppResult<Vec<StockReview>> {
    let mut sql = String::from(
        r#"
        select id, stock_code, trade_system_id, trade_system_version_id, model_provider_id,
               score, rating, overall_evaluation, core_reasons_json, evidence_json,
               trade_plan_json, chart_annotations_json, uncertainty_json, kline_coverage_json,
               prompt_hash, output_hash, created_at
          from stock_reviews
         where 1 = 1
        "#,
    );
    let mut values: Vec<String> = Vec::new();
    if let Some(code) = stock_code {
        sql.push_str(" and stock_code = ?");
        values.push(code);
    }
    if let Some(version_id) = trade_system_version_id {
        sql.push_str(" and trade_system_version_id = ?");
        values.push(version_id);
    }
    sql.push_str(" order by created_at desc limit 200");

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(values), stock_review_from_row)?;
    let mut reviews = Vec::new();
    for row in rows {
        reviews.push(row?);
    }
    Ok(reviews)
}

pub async fn run_daily_review(
    state: &AppState,
    watchlist_id: String,
    trade_system_version_id: String,
) -> AppResult<DailyReviewRun> {
    let items = {
        let conn = state.sqlite.lock().expect("sqlite lock");
        list_items(&conn, &watchlist_id)?
    };
    let total = items.len();
    let mut results = Vec::new();
    for item in items {
        let sync_status = {
            let duck = state.duckdb.lock().expect("duckdb lock");
            match get_data_coverage(&duck, &item.stock_code) {
                Ok(coverage) if coverage.daily.rows > 0 => "ok".to_string(),
                Ok(_) => "no_data".to_string(),
                Err(error) => {
                    results.push(DailyReviewItem {
                        stock_code: item.stock_code.clone(),
                        sync_status: "failed".to_string(),
                        review_status: "skipped".to_string(),
                        score: None,
                        rating: None,
                        message: Some(error.message),
                    });
                    continue;
                }
            }
        };

        match score_stock(
            state,
            item.stock_code.clone(),
            trade_system_version_id.clone(),
            None,
        )
        .await
        {
            Ok(review) => results.push(DailyReviewItem {
                stock_code: item.stock_code,
                sync_status,
                review_status: "ok".to_string(),
                score: review.score,
                rating: Some(review.rating),
                message: Some(review.overall_evaluation),
            }),
            Err(error) => results.push(DailyReviewItem {
                stock_code: item.stock_code,
                sync_status,
                review_status: "failed".to_string(),
                score: None,
                rating: None,
                message: Some(error.message),
            }),
        }
    }

    results.sort_by(|a, b| b.score.unwrap_or(-1).cmp(&a.score.unwrap_or(-1)));
    Ok(DailyReviewRun {
        watchlist_id,
        trade_system_version_id,
        total,
        results,
    })
}

fn persist_review(
    state: &AppState,
    stock_code: &str,
    trade_system_id: &str,
    trade_system_version_id: &str,
    model_provider_id: Option<String>,
    parsed: Value,
    coverage_json: Value,
    prompt_hash: String,
) -> AppResult<StockReview> {
    let review_id = new_id("rev");
    let output_hash = sha256_hex(&serde_json::to_string(&parsed)?);
    let now = now_iso();
    let score = parsed.get("score").and_then(|node| node.as_i64());
    let rating = parsed
        .get("rating")
        .and_then(|node| node.as_str())
        .unwrap_or("undefined_rule")
        .to_string();
    let overall = parsed
        .get("overall_evaluation")
        .and_then(|node| node.as_str())
        .unwrap_or("")
        .to_string();
    let core_reasons = parsed
        .get("core_reasons")
        .cloned()
        .unwrap_or_else(|| serde_json::json!([]));
    let evidence = parsed
        .get("evidence")
        .cloned()
        .unwrap_or_else(|| serde_json::json!([]));
    let trade_plan = parsed
        .get("trade_plan")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
    let chart_annotations = parsed
        .get("chart_annotations")
        .cloned()
        .unwrap_or_else(|| serde_json::json!([]));
    let uncertainty = parsed
        .get("uncertainty")
        .cloned()
        .unwrap_or_else(|| serde_json::json!([]));

    let conn = state.sqlite.lock().expect("sqlite lock");
    conn.execute(
        r#"
        insert into stock_reviews
          (id, stock_code, trade_system_id, trade_system_version_id, model_provider_id,
           score, rating, overall_evaluation, core_reasons_json, evidence_json,
           trade_plan_json, chart_annotations_json, uncertainty_json, kline_coverage_json,
           prompt_hash, output_hash, created_at)
        values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
        "#,
        params![
            review_id,
            stock_code,
            trade_system_id,
            trade_system_version_id,
            model_provider_id,
            score,
            rating,
            overall,
            serde_json::to_string(&core_reasons)?,
            serde_json::to_string(&evidence)?,
            serde_json::to_string(&trade_plan)?,
            serde_json::to_string(&chart_annotations)?,
            serde_json::to_string(&uncertainty)?,
            serde_json::to_string(&coverage_json)?,
            prompt_hash,
            output_hash,
            now
        ],
    )?;

    if let Some(items) = chart_annotations.as_array() {
        for item in items {
            if let Some(annotation_type) = item.get("type").and_then(|node| node.as_str()) {
                let normalized_type = match annotation_type {
                    "horizontal_line" => "horizontal_line",
                    "ray" => "ray",
                    _ => continue,
                };
                let _ = annotation_service::save_chart_annotation(
                    &conn,
                    crate::models::SaveChartAnnotationInput {
                        id: None,
                        stock_code: stock_code.to_string(),
                        trade_system_version_id: Some(trade_system_version_id.to_string()),
                        review_id: Some(review_id.clone()),
                        source: Some("agent".to_string()),
                        annotation_type: normalized_type.to_string(),
                        payload: item.clone(),
                    },
                );
            }
        }
    }

    conn.query_row(
        r#"
        select id, stock_code, trade_system_id, trade_system_version_id, model_provider_id,
               score, rating, overall_evaluation, core_reasons_json, evidence_json,
               trade_plan_json, chart_annotations_json, uncertainty_json, kline_coverage_json,
               prompt_hash, output_hash, created_at
          from stock_reviews
         where id = ?1
        "#,
        params![review_id],
        stock_review_from_row,
    )
    .map_err(Into::into)
}

fn data_required_review(
    stock_code: &str,
    trade_system_id: &str,
    version_id: &str,
    status: &str,
    rating: &str,
    message: &str,
    coverage: Value,
) -> StockReview {
    StockReview {
        id: "unsaved".to_string(),
        status: status.to_string(),
        stock_code: stock_code.to_string(),
        trade_system_id: trade_system_id.to_string(),
        trade_system_version_id: version_id.to_string(),
        model_provider_id: None,
        score: None,
        rating: rating.to_string(),
        overall_evaluation: message.to_string(),
        core_reasons: serde_json::json!([message]),
        evidence: serde_json::json!([]),
        trade_plan: serde_json::json!({
            "setup": null,
            "entry": null,
            "stop_loss": null,
            "take_profit": null,
            "invalidation": message
        }),
        chart_annotations: serde_json::json!([]),
        uncertainty: serde_json::json!([message]),
        kline_coverage: coverage,
        prompt_hash: String::new(),
        output_hash: String::new(),
        created_at: now_iso(),
    }
}

fn summarize_bars(bars: &[crate::models::KlineBar]) -> Value {
    if bars.is_empty() {
        return serde_json::json!({ "rows": 0 });
    }
    let first = bars.first().unwrap();
    let last = bars.last().unwrap();
    let highest = bars.iter().map(|bar| bar.high).fold(f64::MIN, f64::max);
    let lowest = bars.iter().map(|bar| bar.low).fold(f64::MAX, f64::min);
    let total_volume: f64 = bars.iter().map(|bar| bar.volume).sum();
    serde_json::json!({
        "rows": bars.len(),
        "start": first.date,
        "end": last.date,
        "first_close": first.close,
        "last_close": last.close,
        "highest_high": highest,
        "lowest_low": lowest,
        "total_volume": total_volume,
        "change_pct": if first.close != 0.0 { Some((last.close / first.close - 1.0) * 100.0) } else { None }
    })
}

fn stock_review_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<StockReview> {
    let parse = |index: usize| {
        let raw: String = row.get(index)?;
        Ok::<Value, rusqlite::Error>(
            serde_json::from_str(&raw).unwrap_or_else(|_| serde_json::json!({})),
        )
    };
    Ok(StockReview {
        id: row.get(0)?,
        status: "ok".to_string(),
        stock_code: row.get(1)?,
        trade_system_id: row.get(2)?,
        trade_system_version_id: row.get(3)?,
        model_provider_id: row.get(4)?,
        score: row.get(5)?,
        rating: row.get(6)?,
        overall_evaluation: row.get(7)?,
        core_reasons: parse(8)?,
        evidence: parse(9)?,
        trade_plan: parse(10)?,
        chart_annotations: parse(11)?,
        uncertainty: parse(12)?,
        kline_coverage: parse(13)?,
        prompt_hash: row.get(14)?,
        output_hash: row.get(15)?,
        created_at: row.get(16)?,
    })
}
