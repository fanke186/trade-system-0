use crate::app_state::AppState;
use crate::error::{AppError, AppResult};
use crate::llm::client::{call_model, ModelCallOptions};
use crate::llm::prompts::{build_agent_prompt, scoring_output_schema};
use crate::models::{Agent, AgentChatResult, ChatMessage};
use crate::services::common::{new_id, now_iso};
use crate::services::model_provider_service::{get_active_provider, get_provider, resolve_api_key};
use crate::services::trade_system_service::get_version;
use rusqlite::{params, Connection, OptionalExtension};

pub fn create_agent_from_trade_system(
    conn: &Connection,
    version_id: &str,
    provider_id: Option<String>,
) -> AppResult<Agent> {
    let version = get_version(conn, version_id)?;
    let now = now_iso();
    let id = new_id("agent");
    let prompt = build_agent_prompt(&version);
    let schema = scoring_output_schema();
    let name = format!("{} v{} Agent", version.trade_system_id, version.version);
    conn.execute(
        r#"
        insert into agents
          (id, trade_system_id, trade_system_version_id, name, model_provider_id, system_prompt,
           output_schema_json, created_at, updated_at)
        values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
        "#,
        params![
            id,
            version.trade_system_id,
            version.id,
            name,
            provider_id,
            prompt,
            serde_json::to_string(&schema)?,
            now
        ],
    )?;
    get_agent(conn, &id)
}

pub fn get_agent(conn: &Connection, agent_id: &str) -> AppResult<Agent> {
    conn.query_row(
        r#"
        select id, trade_system_id, trade_system_version_id, name, model_provider_id,
               system_prompt, output_schema_json, created_at, updated_at
          from agents
         where id = ?1
        "#,
        params![agent_id],
        |row| {
            let schema_json: String = row.get(6)?;
            Ok(Agent {
                id: row.get(0)?,
                trade_system_id: row.get(1)?,
                trade_system_version_id: row.get(2)?,
                name: row.get(3)?,
                model_provider_id: row.get(4)?,
                system_prompt: row.get(5)?,
                output_schema_json: serde_json::from_str(&schema_json)
                    .unwrap_or_else(|_| serde_json::json!({})),
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        },
    )
    .optional()?
    .ok_or_else(|| AppError::new("not_found", "Agent 不存在", true))
}

pub async fn run_agent_chat(
    state: &AppState,
    agent_id: String,
    messages: Vec<ChatMessage>,
) -> AppResult<AgentChatResult> {
    let (agent, provider) = {
        let conn = state.sqlite.lock().expect("sqlite lock");
        let agent = get_agent(&conn, &agent_id)?;
        let provider = if let Some(provider_id) = &agent.model_provider_id {
            Some(get_provider(&conn, provider_id)?)
        } else {
            get_active_provider(&conn)?
        }
        .ok_or_else(|| AppError::new("provider_request_failed", "未配置活跃模型 Provider", true))?;
        (agent, provider)
    };

    let api_key = resolve_api_key(&state.app_dir, &provider)?;
    let content = call_model(
        &state.http,
        &provider,
        &api_key,
        ModelCallOptions {
            system_prompt: agent.system_prompt.clone(),
            messages,
            response_format: None,
            temperature: Some(provider.temperature),
            max_tokens: Some(provider.max_tokens),
        },
    )
    .await?;

    Ok(AgentChatResult {
        agent_id,
        content,
        raw_json: None,
    })
}
