use serde::Serialize;
use serde_json::Value;

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<Value>,
    pub recoverable: bool,
}

impl AppError {
    pub fn new(code: impl Into<String>, message: impl Into<String>, recoverable: bool) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            detail: None,
            recoverable,
        }
    }

    pub fn with_detail(
        code: impl Into<String>,
        message: impl Into<String>,
        recoverable: bool,
        detail: Value,
    ) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            detail: Some(detail),
            recoverable,
        }
    }

    pub fn database(error: impl ToString) -> Self {
        Self::with_detail(
            "database_error",
            "本地数据库操作失败",
            true,
            serde_json::json!({ "error": error.to_string() }),
        )
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(value: rusqlite::Error) -> Self {
        Self::database(value)
    }
}

impl From<duckdb::Error> for AppError {
    fn from(value: duckdb::Error) -> Self {
        Self::database(value)
    }
}

impl From<std::io::Error> for AppError {
    fn from(value: std::io::Error) -> Self {
        Self::with_detail(
            "filesystem_error",
            "本地文件操作失败",
            true,
            serde_json::json!({ "error": value.to_string() }),
        )
    }
}

impl From<reqwest::Error> for AppError {
    fn from(value: reqwest::Error) -> Self {
        Self::with_detail(
            "provider_request_failed",
            "模型 Provider 请求失败",
            true,
            serde_json::json!({ "error": value.to_string() }),
        )
    }
}

impl From<serde_json::Error> for AppError {
    fn from(value: serde_json::Error) -> Self {
        Self::with_detail(
            "invalid_json",
            "JSON 解析失败",
            true,
            serde_json::json!({ "error": value.to_string() }),
        )
    }
}

impl From<anyhow::Error> for AppError {
    fn from(value: anyhow::Error) -> Self {
        Self::with_detail(
            "internal_error",
            "应用内部错误",
            true,
            serde_json::json!({ "error": value.to_string() }),
        )
    }
}
