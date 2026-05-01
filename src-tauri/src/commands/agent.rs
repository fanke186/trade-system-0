use crate::app_state::AppState;
use crate::error::AppResult;
use crate::models::{Agent, AgentChatResult, ChatMessage};
use crate::services::agent_service;
use tauri::State;

#[tauri::command]
pub fn create_agent_from_trade_system(
    state: State<'_, AppState>,
    version_id: String,
    provider_id: Option<String>,
) -> AppResult<Agent> {
    let conn = state.sqlite.lock().expect("sqlite lock");
    agent_service::create_agent_from_trade_system(&conn, &version_id, provider_id)
}

#[tauri::command]
pub async fn run_agent_chat(
    state: State<'_, AppState>,
    agent_id: String,
    messages: Vec<ChatMessage>,
) -> AppResult<AgentChatResult> {
    agent_service::run_agent_chat(&state, agent_id, messages).await
}

