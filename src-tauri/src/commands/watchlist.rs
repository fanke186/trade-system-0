use crate::app_state::AppState;
use crate::error::AppResult;
use crate::models::{OkResult, Watchlist, WatchlistItem};
use crate::services::watchlist_service;
use tauri::State;

#[tauri::command]
pub fn list_watchlists(state: State<'_, AppState>) -> AppResult<Vec<Watchlist>> {
    let conn = state.sqlite.lock().expect("sqlite lock");
    watchlist_service::list_watchlists(&conn)
}

#[tauri::command]
pub fn save_watchlist(
    state: State<'_, AppState>,
    id: Option<String>,
    name: String,
) -> AppResult<Watchlist> {
    let conn = state.sqlite.lock().expect("sqlite lock");
    watchlist_service::save_watchlist(&conn, id, name)
}

#[tauri::command]
pub fn add_watchlist_item(
    state: State<'_, AppState>,
    watchlist_id: String,
    stock_code: String,
) -> AppResult<WatchlistItem> {
    let conn = state.sqlite.lock().expect("sqlite lock");
    watchlist_service::add_watchlist_item(&conn, watchlist_id, stock_code)
}

#[tauri::command]
pub fn remove_watchlist_item(
    state: State<'_, AppState>,
    watchlist_id: String,
    stock_code: String,
) -> AppResult<OkResult> {
    let conn = state.sqlite.lock().expect("sqlite lock");
    watchlist_service::remove_watchlist_item(&conn, watchlist_id, stock_code)
}

