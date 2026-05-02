use crate::error::{AppError, AppResult};
use crate::models::{ChatMessage, ModelProvider};
use reqwest::Client;
use serde_json::{Map, Value};

#[derive(Clone)]
pub struct ModelCallOptions {
    pub system_prompt: String,
    pub messages: Vec<ChatMessage>,
    pub response_format: Option<String>,
    pub temperature: Option<f64>,
    pub max_tokens: Option<i64>,
}

pub async fn call_model(
    client: &Client,
    provider: &ModelProvider,
    api_key: &str,
    options: ModelCallOptions,
) -> AppResult<String> {
    let mut messages = Vec::with_capacity(options.messages.len() + 1);
    messages.push(serde_json::json!({
        "role": "system",
        "content": options.system_prompt
    }));
    for message in &options.messages {
        messages.push(serde_json::json!({
            "role": &message.role,
            "content": &message.content
        }));
    }

    let mut request = Map::new();
    request.insert("model".to_string(), Value::String(provider.model.clone()));
    request.insert("messages".to_string(), Value::Array(messages));
    request.insert(
        "temperature".to_string(),
        serde_json::json!(options.temperature.unwrap_or(provider.temperature)),
    );
    request.insert(
        "max_tokens".to_string(),
        serde_json::json!(options.max_tokens.unwrap_or(provider.max_tokens)),
    );
    if let Some(kind) = options.response_format {
        request.insert(
            "response_format".to_string(),
            serde_json::json!({ "type": kind }),
        );
    }
    merge_request_overrides(&mut request, &provider.extra_json);

    let url = completion_url(&provider.base_url);
    let response = client
        .post(url)
        .bearer_auth(api_key)
        .json(&Value::Object(request))
        .send()
        .await?;

    let status = response.status();
    let body = response.text().await?;
    let value: serde_json::Value =
        serde_json::from_str(&body).unwrap_or_else(|_| serde_json::json!({ "raw": body }));
    if !status.is_success() {
        let (code, message) = provider_error(status.as_u16());
        return Err(AppError::with_detail(
            code,
            message,
            true,
            serde_json::json!({ "status": status.as_u16(), "response": value }),
        ));
    }

    value
        .pointer("/choices/0/message/content")
        .and_then(|node| node.as_str())
        .map(|content| content.to_string())
        .ok_or_else(|| {
            AppError::with_detail(
                "provider_request_failed",
                "模型 Provider 响应缺少 choices[0].message.content",
                true,
                value,
            )
        })
}

fn merge_request_overrides(request: &mut Map<String, Value>, extra_json: &Value) {
    let Some(overrides) = extra_json.get("requestOverrides").and_then(|node| node.as_object()) else {
        return;
    };
    for (key, value) in overrides {
        if value.is_null() {
            request.remove(key);
        } else {
            request.insert(key.clone(), value.clone());
        }
    }
}

fn provider_error(status: u16) -> (&'static str, &'static str) {
    match status {
        401 => ("provider_auth_failed", "模型 Provider 认证失败，请检查 API Key"),
        402 => ("provider_quota_insufficient", "模型 Provider 余额不足"),
        429 => ("provider_rate_limited", "模型 Provider 请求速率达到上限"),
        503 => ("provider_unavailable", "模型 Provider 暂时繁忙，请稍后重试"),
        _ => ("provider_request_failed", "模型 Provider 返回错误"),
    }
}

fn completion_url(base_url: &str) -> String {
    let trimmed = base_url.trim_end_matches('/');
    if trimmed.ends_with("/chat/completions") {
        trimmed.to_string()
    } else {
        format!("{}/chat/completions", trimmed)
    }
}
