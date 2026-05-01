use crate::models::TradeSystemVersion;

pub fn scoring_output_schema() -> serde_json::Value {
    serde_json::json!({
      "type": "object",
      "required": [
        "score",
        "rating",
        "overall_evaluation",
        "core_reasons",
        "evidence",
        "trade_plan",
        "chart_annotations",
        "uncertainty"
      ],
      "properties": {
        "score": { "type": ["integer", "null"], "minimum": 0, "maximum": 100 },
        "rating": { "enum": ["focus", "watch", "reject", "data_required", "undefined_rule"] },
        "overall_evaluation": { "type": "string" },
        "core_reasons": { "type": "array", "minItems": 1 },
        "evidence": { "type": "array" },
        "trade_plan": {
          "type": "object",
          "required": ["setup", "entry", "stop_loss", "take_profit", "invalidation"]
        },
        "chart_annotations": { "type": "array" },
        "uncertainty": { "type": "array" }
      }
    })
}

pub fn build_agent_prompt(version: &TradeSystemVersion) -> String {
    format!(
        r#"你是 trade-system-0 的专属交易系统 Agent。

边界：
- 只能使用下方交易系统 Markdown 和用户提供的本地 K 线证据。
- 不允许引用未同步入库的行情。
- 不允许输出实盘买卖指令，只能输出研究、观察和计划结构。
- 如果交易系统没有定义某项规则，必须标记 undefined_rule 或写入 uncertainty，不能自行补规则。
- 若 K 线证据不足，必须返回 data_required。

交易系统版本: {}
内容哈希: {}

交易系统 Markdown:

{}
"#,
        version.version, version.content_hash, version.markdown
    )
}

pub fn build_scoring_user_prompt(
    stock_code: &str,
    coverage: &serde_json::Value,
    bars_summary: &serde_json::Value,
    annotations: &serde_json::Value,
) -> String {
    format!(
        r#"请基于交易系统 Markdown 和本地 K 线证据，对股票 {} 做结构化评分。

要求：
- 只引用 coverage、bars_summary、annotations 中存在的证据。
- score 必须是 0-100 整数或 null。
- rating 只能是 focus、watch、reject、data_required、undefined_rule。
- trade_plan 必须包含 setup、entry、stop_loss、take_profit、invalidation。
- 不得输出实盘买卖指令。
- 只输出 JSON 对象，不输出 Markdown。

coverage:
{}

bars_summary:
{}

annotations:
{}
"#,
        stock_code,
        serde_json::to_string_pretty(coverage).unwrap_or_else(|_| "{}".to_string()),
        serde_json::to_string_pretty(bars_summary).unwrap_or_else(|_| "{}".to_string()),
        serde_json::to_string_pretty(annotations).unwrap_or_else(|_| "[]".to_string()),
    )
}
