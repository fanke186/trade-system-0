use crate::app_state::AppState;
use crate::error::AppResult;
use crate::models::{OkResult, Watchlist};
use crate::services::watchlist_service;
use tauri::State;

#[tauri::command]
pub fn reorder_watchlist_item(
    state: State<'_, AppState>,
    item_id: String,
    position: String,
) -> AppResult<OkResult> {
    let conn = state.sqlite.lock().expect("sqlite lock");
    watchlist_service::reorder_watchlist_item(&conn, &item_id, &position)
}

#[tauri::command]
pub fn move_watchlist_item(
    state: State<'_, AppState>,
    item_id: String,
    target_watchlist_id: String,
) -> AppResult<OkResult> {
    let conn = state.sqlite.lock().expect("sqlite lock");
    watchlist_service::move_watchlist_item(&conn, &item_id, &target_watchlist_id)
}

#[tauri::command]
pub fn copy_watchlist_item(
    state: State<'_, AppState>,
    item_id: String,
    target_watchlist_id: String,
) -> AppResult<OkResult> {
    let conn = state.sqlite.lock().expect("sqlite lock");
    watchlist_service::copy_watchlist_item(&conn, &item_id, &target_watchlist_id)
}

#[tauri::command]
pub fn create_watchlist_group(
    state: State<'_, AppState>,
    name: String,
) -> AppResult<Watchlist> {
    let conn = state.sqlite.lock().expect("sqlite lock");
    watchlist_service::create_watchlist_group(&conn, &name)
}

#[tauri::command]
pub fn delete_watchlist_group(
    state: State<'_, AppState>,
    watchlist_id: String,
) -> AppResult<OkResult> {
    let conn = state.sqlite.lock().expect("sqlite lock");
    watchlist_service::delete_watchlist_group(&conn, &watchlist_id)
}

#[tauri::command]
pub fn rename_watchlist_group(
    state: State<'_, AppState>,
    watchlist_id: String,
    new_name: String,
) -> AppResult<OkResult> {
    let conn = state.sqlite.lock().expect("sqlite lock");
    watchlist_service::rename_watchlist_group(&conn, &watchlist_id, &new_name)
}
