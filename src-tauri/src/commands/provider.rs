use crate::app_state::AppState;
use crate::error::AppResult;
use crate::models::{ModelProvider, ProviderTestResult, SaveModelProviderInput};
use crate::services::model_provider_service;
use tauri::State;

#[tauri::command]
pub fn list_model_providers(state: State<'_, AppState>) -> AppResult<Vec<ModelProvider>> {
    let conn = state.sqlite.lock().expect("sqlite lock");
    model_provider_service::list_model_providers(&conn, &state.app_dir)
}

#[tauri::command]
pub fn save_model_provider(
    state: State<'_, AppState>,
    provider: SaveModelProviderInput,
) -> AppResult<ModelProvider> {
    let conn = state.sqlite.lock().expect("sqlite lock");
    model_provider_service::save_model_provider(&conn, &state.app_dir, provider)
}

#[tauri::command]
pub fn set_active_model_provider(
    state: State<'_, AppState>,
    provider_id: String,
) -> AppResult<ModelProvider> {
    let conn = state.sqlite.lock().expect("sqlite lock");
    model_provider_service::set_active_model_provider(&conn, &state.app_dir, &provider_id)
}

#[tauri::command]
pub async fn test_model_provider(
    state: State<'_, AppState>,
    provider_id: String,
) -> AppResult<ProviderTestResult> {
    model_provider_service::test_model_provider(&state, &provider_id).await
}
