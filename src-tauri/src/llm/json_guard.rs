use crate::error::{AppError, AppResult};
use serde_json::Value;

pub fn parse_and_validate_stock_review(content: &str) -> AppResult<Value> {
    let value: Value = serde_json::from_str(content).map_err(|error| {
        AppError::with_detail(
            "invalid_llm_output",
            "LLM 输出不是合法 JSON",
            true,
            serde_json::json!({ "error": error.to_string(), "content": content }),
        )
    })?;

    let rating = value
        .get("rating")
        .and_then(|node| node.as_str())
        .ok_or_else(|| invalid("缺少 rating"))?;
    if !matches!(
        rating,
        "focus" | "watch" | "reject" | "data_required" | "undefined_rule"
    ) {
        return Err(invalid("rating 不在允许枚举内"));
    }

    if let Some(score) = value.get("score") {
        if !score.is_null() {
            let score = score.as_i64().ok_or_else(|| invalid("score 必须是整数或 null"))?;
            if !(0..=100).contains(&score) {
                return Err(invalid("score 必须在 0-100"));
            }
        }
    } else {
        return Err(invalid("缺少 score"));
    }

    let core_reasons = value
        .get("core_reasons")
        .and_then(|node| node.as_array())
        .ok_or_else(|| invalid("缺少 core_reasons"))?;
    if core_reasons.is_empty() {
        return Err(invalid("core_reasons 至少 1 条"));
    }

    let trade_plan = value
        .get("trade_plan")
        .and_then(|node| node.as_object())
        .ok_or_else(|| invalid("缺少 trade_plan"))?;
    for key in ["setup", "entry", "stop_loss", "take_profit", "invalidation"] {
        if !trade_plan.contains_key(key) {
            return Err(invalid(format!("trade_plan 缺少 {}", key)));
        }
    }

    for key in ["overall_evaluation", "evidence", "chart_annotations", "uncertainty"] {
        if !value.as_object().is_some_and(|object| object.contains_key(key)) {
            return Err(invalid(format!("缺少 {}", key)));
        }
    }

    Ok(value)
}

fn invalid(message: impl Into<String>) -> AppError {
    AppError::new("invalid_llm_output", message, true)
}

#[cfg(test)]
mod tests {
    use super::parse_and_validate_stock_review;

    #[test]
    fn rejects_out_of_range_score() {
        let content = r#"{
          "score": 120,
          "rating": "focus",
          "overall_evaluation": "x",
          "core_reasons": ["x"],
          "evidence": [],
          "trade_plan": {
            "setup": "x",
            "entry": "x",
            "stop_loss": "x",
            "take_profit": "x",
            "invalidation": "x"
          },
          "chart_annotations": [],
          "uncertainty": []
        }"#;
        assert!(parse_and_validate_stock_review(content).is_err());
    }

    #[test]
    fn accepts_valid_review_json() {
        let content = r#"{
          "score": 88,
          "rating": "watch",
          "overall_evaluation": "结构可观察",
          "core_reasons": ["周线趋势向上"],
          "evidence": [],
          "trade_plan": {
            "setup": "回踩观察",
            "entry": "规则确认",
            "stop_loss": "结构低点",
            "take_profit": "前高",
            "invalidation": "跌破支撑"
          },
          "chart_annotations": [],
          "uncertainty": []
        }"#;
        assert!(parse_and_validate_stock_review(content).is_ok());
    }
}
