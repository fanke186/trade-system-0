use crate::error::{AppError, AppResult};
use crate::models::{
    AcceptRejectOpsInput, AgentPatchProposal, OkResult, SaveAgentPatchProposalInput,
};
use crate::services::common::{new_id, now_iso};
use rusqlite::{params, Connection};

pub fn save_agent_patch_proposal(
    conn: &Connection,
    input: SaveAgentPatchProposalInput,
) -> AppResult<AgentPatchProposal> {
    let id = input.id.unwrap_or_else(|| new_id("app"));
    let now = now_iso();
    let status = input.status.unwrap_or_else(|| "pending".to_string());
    let patch_json = serde_json::to_string(&input.patch_json)?;
    conn.execute(
        r#"
        insert into agent_patch_proposals
          (id, session_id, trade_system_id, trade_system_version_id, patch_json, status,
           raw_llm_response, error_message, created_at, updated_at)
        values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
        on conflict(id) do update set
          status = excluded.status,
          patch_json = excluded.patch_json,
          raw_llm_response = excluded.raw_llm_response,
          error_message = excluded.error_message,
          updated_at = excluded.updated_at
        "#,
        params![
            id,
            input.session_id,
            input.trade_system_id,
            input.trade_system_version_id,
            patch_json,
            status,
            input.raw_llm_response,
            input.error_message,
            now
        ],
    )?;
    get_agent_patch_proposal(conn, &id)
}

pub fn list_agent_patch_proposals(
    conn: &Connection,
    trade_system_id: Option<&str>,
    status: Option<&str>,
) -> AppResult<Vec<AgentPatchProposal>> {
    let mut sql = String::from(
        r#"
        select id, session_id, trade_system_id, trade_system_version_id, patch_json, status,
               raw_llm_response, error_message, created_at, updated_at
          from agent_patch_proposals
         where 1=1
        "#,
    );
    let mut params_vec: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    if let Some(ts_id) = trade_system_id {
        params_vec.push(Box::new(ts_id.to_string()));
        sql.push_str(&format!(
            " and trade_system_id = ?{}",
            params_vec.len()
        ));
    }
    if let Some(s) = status {
        params_vec.push(Box::new(s.to_string()));
        sql.push_str(&format!(" and status = ?{}", params_vec.len()));
    }
    sql.push_str(" order by created_at desc");

    let mut stmt = conn.prepare(&sql)?;
    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();
    let rows = stmt.query_map(param_refs.as_slice(), proposal_from_row)?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

pub fn accept_agent_patch_ops(
    _conn: &Connection,
    _input: AcceptRejectOpsInput,
) -> AppResult<OkResult> {
    // MVP: mark proposal as accepted, apply ops to current markdown
    // Full implementation in follow-up with session support
    Ok(OkResult { ok: true })
}

pub fn reject_agent_patch_ops(
    conn: &Connection,
    input: AcceptRejectOpsInput,
) -> AppResult<OkResult> {
    conn.execute(
        "update agent_patch_proposals set status = 'rejected', updated_at = ?1 where id = ?2",
        params![now_iso(), input.patch_proposal_id],
    )?;
    Ok(OkResult { ok: true })
}

fn get_agent_patch_proposal(conn: &Connection, id: &str) -> AppResult<AgentPatchProposal> {
    conn.query_row(
        r#"
        select id, session_id, trade_system_id, trade_system_version_id, patch_json, status,
               raw_llm_response, error_message, created_at, updated_at
          from agent_patch_proposals
         where id = ?1
        "#,
        params![id],
        proposal_from_row,
    )
    .map_err(Into::into)
}

fn proposal_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentPatchProposal> {
    let patch_json: String = row.get(4)?;
    Ok(AgentPatchProposal {
        id: row.get(0)?,
        session_id: row.get(1)?,
        trade_system_id: row.get(2)?,
        trade_system_version_id: row.get(3)?,
        patch_json: serde_json::from_str(&patch_json).unwrap_or_default(),
        status: row.get(5)?,
        raw_llm_response: row.get(6)?,
        error_message: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}
