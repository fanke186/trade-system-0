use crate::app_state::AppState;
use crate::error::AppResult;
use crate::models::{ChartAnnotation, OkResult, SaveChartAnnotationInput};
use crate::services::annotation_service;
use tauri::State;

#[tauri::command]
pub fn list_chart_annotations(
    state: State<'_, AppState>,
    stock_code: String,
    trade_system_version_id: Option<String>,
) -> AppResult<Vec<ChartAnnotation>> {
    let conn = state.sqlite.lock().expect("sqlite lock");
    annotation_service::list_chart_annotations(&conn, &stock_code, trade_system_version_id)
}

#[tauri::command]
pub fn save_chart_annotation(
    state: State<'_, AppState>,
    annotation: SaveChartAnnotationInput,
) -> AppResult<ChartAnnotation> {
    let conn = state.sqlite.lock().expect("sqlite lock");
    annotation_service::save_chart_annotation(&conn, annotation)
}

#[tauri::command]
pub fn delete_chart_annotation(
    state: State<'_, AppState>,
    annotation_id: String,
) -> AppResult<OkResult> {
    let conn = state.sqlite.lock().expect("sqlite lock");
    annotation_service::delete_chart_annotation(&conn, &annotation_id)
}
