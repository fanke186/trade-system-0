use crate::app_state::AppState;
use crate::error::AppResult;
use crate::models::{
    AcceptRejectOpsInput, AgentPatchProposal, OkResult, SaveAgentPatchProposalInput,
};
use crate::services::agent_patch_service;
use tauri::State;

#[tauri::command]
pub fn save_agent_patch_proposal(
    state: State<'_, AppState>,
    input: SaveAgentPatchProposalInput,
) -> AppResult<AgentPatchProposal> {
    let conn = state.sqlite.lock().expect("sqlite lock");
    agent_patch_service::save_agent_patch_proposal(&conn, input)
}

#[tauri::command]
pub fn list_agent_patch_proposals(
    state: State<'_, AppState>,
    trade_system_id: Option<String>,
    status: Option<String>,
) -> AppResult<Vec<AgentPatchProposal>> {
    let conn = state.sqlite.lock().expect("sqlite lock");
    agent_patch_service::list_agent_patch_proposals(
        &conn,
        trade_system_id.as_deref(),
        status.as_deref(),
    )
}

#[tauri::command]
pub fn accept_agent_patch_ops(
    state: State<'_, AppState>,
    input: AcceptRejectOpsInput,
) -> AppResult<OkResult> {
    let conn = state.sqlite.lock().expect("sqlite lock");
    agent_patch_service::accept_agent_patch_ops(&conn, input)
}

#[tauri::command]
pub fn reject_agent_patch_ops(
    state: State<'_, AppState>,
    input: AcceptRejectOpsInput,
) -> AppResult<OkResult> {
    let conn = state.sqlite.lock().expect("sqlite lock");
    agent_patch_service::reject_agent_patch_ops(&conn, input)
}
