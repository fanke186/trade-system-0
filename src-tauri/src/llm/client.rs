use crate::error::{AppError, AppResult};
use crate::models::{ChatMessage, ModelProvider};
use reqwest::Client;
use serde::Serialize;

#[derive(Clone)]
pub struct ModelCallOptions {
    pub system_prompt: String,
    pub messages: Vec<ChatMessage>,
    pub response_format: Option<String>,
    pub temperature: Option<f64>,
    pub max_tokens: Option<i64>,
}

#[derive(Serialize)]
struct OpenAiMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Serialize)]
struct OpenAiRequest<'a> {
    model: &'a str,
    messages: Vec<OpenAiMessage<'a>>,
    temperature: f64,
    max_tokens: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    response_format: Option<serde_json::Value>,
}

pub async fn call_model(
    client: &Client,
    provider: &ModelProvider,
    api_key: &str,
    options: ModelCallOptions,
) -> AppResult<String> {
    let mut messages = Vec::with_capacity(options.messages.len() + 1);
    messages.push(OpenAiMessage {
        role: "system",
        content: &options.system_prompt,
    });
    for message in &options.messages {
        messages.push(OpenAiMessage {
            role: &message.role,
            content: &message.content,
        });
    }

    let request = OpenAiRequest {
        model: &provider.model,
        messages,
        temperature: options.temperature.unwrap_or(provider.temperature),
        max_tokens: options.max_tokens.unwrap_or(provider.max_tokens),
        response_format: options
            .response_format
            .map(|kind| serde_json::json!({ "type": kind })),
    };
    let url = completion_url(&provider.base_url);
    let response = client
        .post(url)
        .bearer_auth(api_key)
        .json(&request)
        .send()
        .await?;

    let status = response.status();
    let value: serde_json::Value = response.json().await?;
    if !status.is_success() {
        return Err(AppError::with_detail(
            if status.as_u16() == 401 { "provider_auth_failed" } else { "provider_request_failed" },
            "模型 Provider 返回错误",
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

fn completion_url(base_url: &str) -> String {
    let trimmed = base_url.trim_end_matches('/');
    if trimmed.ends_with("/chat/completions") {
        trimmed.to_string()
    } else {
        format!("{}/chat/completions", trimmed)
    }
}

