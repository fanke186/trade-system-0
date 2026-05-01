use crate::app_state::AppState;
use crate::error::AppResult;
use crate::models::{DailyReviewRun, StockReview};
use crate::services::review_service;
use tauri::State;

#[tauri::command]
pub async fn score_stock(
    state: State<'_, AppState>,
    stock_code: String,
    trade_system_version_id: String,
    provider_id: Option<String>,
) -> AppResult<StockReview> {
    review_service::score_stock(&state, stock_code, trade_system_version_id, provider_id).await
}

#[tauri::command]
pub fn get_stock_reviews(
    state: State<'_, AppState>,
    stock_code: Option<String>,
    trade_system_version_id: Option<String>,
) -> AppResult<Vec<StockReview>> {
    let conn = state.sqlite.lock().expect("sqlite lock");
    review_service::get_stock_reviews(&conn, stock_code, trade_system_version_id)
}

#[tauri::command]
pub async fn run_daily_review(
    state: State<'_, AppState>,
    watchlist_id: String,
    trade_system_version_id: String,
) -> AppResult<DailyReviewRun> {
    review_service::run_daily_review(&state, watchlist_id, trade_system_version_id).await
}
