use crate::app_state::AppState;
use crate::error::AppResult;
use crate::models::{
    AiScoreRecord, AiScoreRecordFilter, AiScoreRun, OkResult, TriggerAiScoreInput,
};
use crate::services::ai_score_service;
use tauri::State;

#[tauri::command]
pub fn trigger_ai_score(
    app: tauri::AppHandle,
    input: TriggerAiScoreInput,
) -> AppResult<AiScoreRun> {
    ai_score_service::trigger_ai_score(&app, input)
}

#[tauri::command]
pub fn list_ai_score_records(
    state: State<'_, AppState>,
    filter: Option<AiScoreRecordFilter>,
) -> AppResult<Vec<AiScoreRecord>> {
    let conn = state.sqlite.lock().expect("sqlite lock");
    ai_score_service::list_ai_score_records(&conn, filter)
}

#[tauri::command]
pub fn delete_ai_score_record(
    state: State<'_, AppState>,
    record_id: String,
) -> AppResult<OkResult> {
    let conn = state.sqlite.lock().expect("sqlite lock");
    ai_score_service::delete_ai_score_record(&conn, &record_id)
}
