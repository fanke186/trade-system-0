use crate::app_state::AppState;
use crate::error::{AppError, AppResult};
use crate::llm::client::{call_model, ModelCallOptions};
use crate::models::{ModelProvider, ProviderTestResult, SaveModelProviderInput};
use crate::services::common::{bool_to_int, new_id, now_iso};
use base64::Engine;
use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};
use std::path::Path;
use std::time::Instant;

pub fn list_model_providers(conn: &Connection) -> AppResult<Vec<ModelProvider>> {
    let mut stmt = conn.prepare(
        r#"
        select id, name, provider_type, base_url, api_key_ref, model, temperature, max_tokens,
               enabled, is_active, extra_json, created_at, updated_at
          from model_providers
         order by is_active desc, updated_at desc
        "#,
    )?;
    let rows = stmt.query_map([], provider_from_row)?;
    let mut values = Vec::new();
    for row in rows {
        values.push(redact_provider(row?));
    }
    Ok(values)
}

pub fn get_provider(conn: &Connection, provider_id: &str) -> AppResult<ModelProvider> {
    conn.query_row(
        r#"
        select id, name, provider_type, base_url, api_key_ref, model, temperature, max_tokens,
               enabled, is_active, extra_json, created_at, updated_at
          from model_providers
         where id = ?1
        "#,
        params![provider_id],
        provider_from_row,
    )
    .optional()?
    .ok_or_else(|| AppError::new("not_found", "模型 Provider 不存在", true))
}

pub fn get_active_provider(conn: &Connection) -> AppResult<Option<ModelProvider>> {
    conn.query_row(
        r#"
        select id, name, provider_type, base_url, api_key_ref, model, temperature, max_tokens,
               enabled, is_active, extra_json, created_at, updated_at
          from model_providers
         where enabled = 1 and is_active = 1
         limit 1
        "#,
        [],
        provider_from_row,
    )
    .optional()
    .map_err(Into::into)
}

pub fn save_model_provider(
    conn: &Connection,
    app_dir: &Path,
    input: SaveModelProviderInput,
) -> AppResult<ModelProvider> {
    let now = now_iso();
    let id = input.id.unwrap_or_else(|| new_id("mp"));
    let existing_key_ref: Option<String> = conn
        .query_row(
            "select api_key_ref from model_providers where id = ?1",
            params![id],
            |row| row.get(0),
        )
        .optional()?;

    let api_key_ref = if let Some(api_key) = input.api_key.filter(|key| !key.trim().is_empty()) {
        write_local_secret(app_dir, &id, &api_key)?;
        format!("local:{}", id)
    } else if input.api_key_ref.as_deref() == Some("local:***") {
        existing_key_ref
            .filter(|value| value != "local:***")
            .unwrap_or_else(|| format!("local:{}", id))
    } else if let Some(api_key_ref) = input.api_key_ref.filter(|value| !value.trim().is_empty()) {
        api_key_ref
    } else {
        existing_key_ref.unwrap_or_default()
    };

    let provider = ModelProvider {
        id: id.clone(),
        name: input.name,
        provider_type: input.provider_type,
        base_url: input.base_url.trim_end_matches('/').to_string(),
        api_key_ref,
        model: input.model,
        temperature: input.temperature.unwrap_or(0.2),
        max_tokens: input.max_tokens.unwrap_or(4096),
        enabled: input.enabled.unwrap_or(true),
        is_active: input.is_active.unwrap_or(false),
        extra_json: input.extra_json.unwrap_or_else(|| serde_json::json!({})),
        created_at: now.clone(),
        updated_at: now.clone(),
    };

    if provider.is_active {
        conn.execute("update model_providers set is_active = 0", [])?;
    }

    conn.execute(
        r#"
        insert into model_providers
          (id, name, provider_type, base_url, api_key_ref, model, temperature, max_tokens,
           enabled, is_active, extra_json, created_at, updated_at)
        values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
        on conflict(id) do update set
          name = excluded.name,
          provider_type = excluded.provider_type,
          base_url = excluded.base_url,
          api_key_ref = excluded.api_key_ref,
          model = excluded.model,
          temperature = excluded.temperature,
          max_tokens = excluded.max_tokens,
          enabled = excluded.enabled,
          is_active = excluded.is_active,
          extra_json = excluded.extra_json,
          updated_at = excluded.updated_at
        "#,
        params![
            provider.id,
            provider.name,
            provider.provider_type,
            provider.base_url,
            provider.api_key_ref,
            provider.model,
            provider.temperature,
            provider.max_tokens,
            bool_to_int(provider.enabled),
            bool_to_int(provider.is_active),
            serde_json::to_string(&provider.extra_json)?,
            provider.created_at,
            provider.updated_at
        ],
    )?;

    Ok(redact_provider(get_provider(conn, &id)?))
}

pub fn set_active_model_provider(conn: &Connection, provider_id: &str) -> AppResult<ModelProvider> {
    conn.execute("update model_providers set is_active = 0", [])?;
    let affected = conn.execute(
        "update model_providers set is_active = 1, enabled = 1, updated_at = ?1 where id = ?2",
        params![now_iso(), provider_id],
    )?;
    if affected == 0 {
        return Err(AppError::new("not_found", "模型 Provider 不存在", true));
    }
    Ok(redact_provider(get_provider(conn, provider_id)?))
}

pub async fn test_model_provider(
    state: &AppState,
    provider_id: &str,
) -> AppResult<ProviderTestResult> {
    let provider = {
        let conn = state.sqlite.lock().expect("sqlite lock");
        get_provider(&conn, provider_id)?
    };
    let api_key = resolve_api_key(&state.app_dir, &provider)?;
    let started = Instant::now();
    let content = call_model(
        &state.http,
        &provider,
        &api_key,
        ModelCallOptions {
            system_prompt: "你是连接测试助手，只输出 JSON。".to_string(),
            messages: vec![crate::models::ChatMessage {
                role: "user".to_string(),
                content: "返回 {\"ok\":true}".to_string(),
            }],
            response_format: Some("json_object".to_string()),
            temperature: Some(0.0),
            max_tokens: Some(64),
        },
    )
    .await?;

    Ok(ProviderTestResult {
        ok: content.contains("ok"),
        provider_id: provider.id,
        message: content,
        latency_ms: Some(started.elapsed().as_millis()),
    })
}

pub fn resolve_api_key(app_dir: &Path, provider: &ModelProvider) -> AppResult<String> {
    if provider.api_key_ref.trim().is_empty() {
        return Err(AppError::new(
            "provider_auth_failed",
            "请先填写并保存该 Provider 的 API Key",
            true,
        ));
    }
    if let Some(env_name) = provider.api_key_ref.strip_prefix("env:") {
        return std::env::var(env_name).map_err(|_| {
            AppError::new(
                "provider_auth_failed",
                format!("环境变量 {} 未设置", env_name),
                true,
            )
        });
    }
    if let Some(provider_id) = provider.api_key_ref.strip_prefix("local:") {
        return read_local_secret(app_dir, provider_id);
    }
    Err(AppError::new(
        "provider_auth_failed",
        "Provider API key 引用不可用",
        true,
    ))
}

fn provider_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ModelProvider> {
    let extra_json: String = row.get(10)?;
    Ok(ModelProvider {
        id: row.get(0)?,
        name: row.get(1)?,
        provider_type: row.get(2)?,
        base_url: row.get(3)?,
        api_key_ref: row.get(4)?,
        model: row.get(5)?,
        temperature: row.get(6)?,
        max_tokens: row.get(7)?,
        enabled: row.get::<_, i64>(8)? == 1,
        is_active: row.get::<_, i64>(9)? == 1,
        extra_json: serde_json::from_str(&extra_json).unwrap_or_else(|_| serde_json::json!({})),
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
    })
}

fn redact_provider(mut provider: ModelProvider) -> ModelProvider {
    provider.api_key_ref = if provider.api_key_ref.starts_with("local:") {
        "local:***".to_string()
    } else {
        provider.api_key_ref
    };
    provider
}

fn write_local_secret(app_dir: &Path, provider_id: &str, api_key: &str) -> AppResult<()> {
    let secret_dir = app_dir.join("secrets");
    std::fs::create_dir_all(&secret_dir)?;
    let encrypted = xor_crypt(api_key.as_bytes(), provider_id.as_bytes());
    let encoded = base64::engine::general_purpose::STANDARD.encode(encrypted);
    std::fs::write(secret_dir.join(format!("{}.key", provider_id)), encoded)?;
    Ok(())
}

fn read_local_secret(app_dir: &Path, provider_id: &str) -> AppResult<String> {
    let encoded =
        std::fs::read_to_string(app_dir.join("secrets").join(format!("{}.key", provider_id)))?;
    let encrypted = base64::engine::general_purpose::STANDARD
        .decode(encoded.trim())
        .map_err(|error| {
            AppError::with_detail(
                "provider_auth_failed",
                "本地 API key 解密失败",
                true,
                serde_json::json!({ "error": error.to_string() }),
            )
        })?;
    let decrypted = xor_crypt(&encrypted, provider_id.as_bytes());
    String::from_utf8(decrypted).map_err(|error| {
        AppError::with_detail(
            "provider_auth_failed",
            "本地 API key 解码失败",
            true,
            serde_json::json!({ "error": error.to_string() }),
        )
    })
}

fn xor_crypt(input: &[u8], key_material: &[u8]) -> Vec<u8> {
    let mut digest = Sha256::new();
    digest.update(b"trade-system-0");
    digest.update(key_material);
    let key = digest.finalize();
    input
        .iter()
        .enumerate()
        .map(|(index, byte)| byte ^ key[index % key.len()])
        .collect()
}
