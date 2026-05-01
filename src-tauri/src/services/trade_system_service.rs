use crate::error::{AppError, AppResult};
use crate::models::{
    CompletenessReport, ExportResult, TradeSystemDetail, TradeSystemDraft, TradeSystemSummary,
    TradeSystemVersion,
};
use crate::services::common::{new_id, now_iso, sha256_hex};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use std::path::Path;

pub fn list_trade_systems(conn: &Connection) -> AppResult<Vec<TradeSystemSummary>> {
    let mut stmt = conn.prepare(
        r#"
        select ts.id,
               ts.name,
               ts.description,
               ts.active_version_id,
               v.version,
               v.completeness_status,
               ts.updated_at
          from trade_systems ts
          left join trade_system_versions v on v.id = ts.active_version_id
         order by ts.updated_at desc
        "#,
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(TradeSystemSummary {
            id: row.get(0)?,
            name: row.get(1)?,
            description: row.get(2)?,
            active_version_id: row.get(3)?,
            active_version: row.get(4)?,
            completeness_status: row.get(5)?,
            updated_at: row.get(6)?,
        })
    })?;
    collect_rows(rows)
}

pub fn get_trade_system(conn: &Connection, trade_system_id: &str) -> AppResult<TradeSystemDetail> {
    let mut detail = conn
        .query_row(
            "select id, name, description, active_version_id, created_at, updated_at from trade_systems where id = ?1",
            params![trade_system_id],
            |row| {
                Ok(TradeSystemDetail {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    description: row.get(2)?,
                    active_version_id: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                    versions: Vec::new(),
                })
            },
        )
        .optional()?
        .ok_or_else(|| AppError::new("not_found", "交易系统不存在", true))?;

    detail.versions = list_versions(conn, trade_system_id)?;
    Ok(detail)
}

pub fn list_versions(conn: &Connection, trade_system_id: &str) -> AppResult<Vec<TradeSystemVersion>> {
    let mut stmt = conn.prepare(
        r#"
        select id, trade_system_id, version, markdown, content_hash, completeness_status,
               completeness_report_json, change_summary, created_at
          from trade_system_versions
         where trade_system_id = ?1
         order by version desc
        "#,
    )?;
    let rows = stmt.query_map(params![trade_system_id], |row| version_from_row(row))?;
    collect_rows(rows)
}

pub fn get_version(conn: &Connection, version_id: &str) -> AppResult<TradeSystemVersion> {
    conn.query_row(
        r#"
        select id, trade_system_id, version, markdown, content_hash, completeness_status,
               completeness_report_json, change_summary, created_at
          from trade_system_versions
         where id = ?1
        "#,
        params![version_id],
        |row| version_from_row(row),
    )
    .optional()?
    .ok_or_else(|| AppError::new("not_found", "交易系统版本不存在", true))
}

fn version_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TradeSystemVersion> {
    let report_json: String = row.get(6)?;
    let report = serde_json::from_str(&report_json).unwrap_or_else(|_| CompletenessReport {
        status: "unknown".to_string(),
        missing_sections: vec!["完整性报告无法解析".to_string()],
        warnings: Vec::new(),
        can_score: false,
    });
    Ok(TradeSystemVersion {
        id: row.get(0)?,
        trade_system_id: row.get(1)?,
        version: row.get(2)?,
        markdown: row.get(3)?,
        content_hash: row.get(4)?,
        completeness_status: row.get(5)?,
        completeness_report: report,
        change_summary: row.get(7)?,
        created_at: row.get(8)?,
    })
}

pub fn check_completeness(markdown: &str) -> CompletenessReport {
    let normalized = markdown.to_lowercase();
    let checks: [(&str, &[&str]); 6] = [
        ("系统定位", &["系统定位", "交易系统定位", "定位"]),
        ("数据需求", &["数据需求", "k 线", "k线", "日 k", "周 k", "月 k"]),
        ("入选条件", &["入选条件", "选股条件", "入池", "筛选"]),
        ("评分规则", &["评分规则", "评分", "权重", "分值"]),
        ("交易计划规则", &["交易计划", "入场", "止损", "止盈", "不交易"]),
        ("复盘输出格式", &["复盘输出", "输出格式", "json", "评价"]),
    ];

    let mut missing = Vec::new();
    for (label, needles) in checks {
        if !needles.iter().any(|needle| normalized.contains(&needle.to_lowercase())) {
            missing.push(label.to_string());
        }
    }

    let mut warnings = Vec::new();
    if ["永远", "必须", "绝不", "一定"]
        .iter()
        .any(|word| markdown.contains(word))
        && !["百分比", "%", "均线", "高点", "低点", "成交量", "价格"]
            .iter()
            .any(|word| markdown.contains(word))
    {
        warnings.push("存在绝对化表述，但缺少量化或图表依据，可能不可落地".to_string());
    }
    if normalized.contains("凭感觉") || normalized.contains("看情况") {
        warnings.push("存在模糊规则，需要补充可观测条件".to_string());
    }

    let has_score_shape = ["权重", "分值", "默认分", "0-100", "100分"]
        .iter()
        .any(|word| markdown.contains(word));
    if !has_score_shape {
        warnings.push("评分规则没有明确维度、权重或默认分值".to_string());
    }

    let has_plan_shape = ["观察", "入场", "止损", "止盈", "不交易"]
        .iter()
        .filter(|word| markdown.contains(**word))
        .count()
        >= 3;
    if !has_plan_shape {
        warnings.push("交易计划没有覆盖观察、入场、止损、止盈或不交易规则中的至少三类".to_string());
    }

    let can_score = missing.is_empty() && warnings.is_empty() && has_score_shape && has_plan_shape;
    CompletenessReport {
        status: if can_score { "complete" } else { "incomplete" }.to_string(),
        missing_sections: missing,
        warnings,
        can_score,
    }
}

pub fn save_version(
    conn: &Connection,
    trade_system_id: Option<String>,
    name: String,
    markdown: String,
    change_summary: Option<String>,
) -> AppResult<TradeSystemVersion> {
    let now = now_iso();
    let system_id = trade_system_id.unwrap_or_else(|| new_id("ts"));
    let existing: Option<String> = conn
        .query_row("select id from trade_systems where id = ?1", params![system_id], |row| row.get(0))
        .optional()?;

    if existing.is_none() {
        conn.execute(
            "insert into trade_systems (id, name, description, active_version_id, created_at, updated_at) values (?1, ?2, null, null, ?3, ?3)",
            params![system_id, name, now],
        )?;
    } else {
        conn.execute(
            "update trade_systems set name = ?1, updated_at = ?2 where id = ?3",
            params![name, now, system_id],
        )?;
    }

    let next_version: i64 = conn
        .query_row(
            "select coalesce(max(version), 0) + 1 from trade_system_versions where trade_system_id = ?1",
            params![system_id],
            |row| row.get(0),
        )?;
    let report = check_completeness(&markdown);
    let report_json = serde_json::to_string(&report)?;
    let version_id = new_id("tsv");
    let hash = sha256_hex(&markdown);

    conn.execute(
        r#"
        insert into trade_system_versions
          (id, trade_system_id, version, markdown, content_hash, completeness_status, completeness_report_json, change_summary, created_at)
        values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        "#,
        params![
            version_id,
            system_id,
            next_version,
            markdown,
            hash,
            report.status,
            report_json,
            change_summary,
            now
        ],
    )?;
    conn.execute(
        "update trade_systems set active_version_id = ?1, updated_at = ?2 where id = ?3",
        params![version_id, now, system_id],
    )?;
    get_version(conn, &version_id)
}

pub fn export_version(conn: &Connection, version_id: &str, target_path: &str) -> AppResult<ExportResult> {
    let version = get_version(conn, version_id)?;
    let path = Path::new(target_path);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, &version.markdown)?;
    Ok(ExportResult {
        version_id: version_id.to_string(),
        target_path: target_path.to_string(),
        bytes_written: version.markdown.as_bytes().len(),
    })
}

pub fn generate_draft_from_materials(
    conn: &Connection,
    material_ids: Vec<String>,
    prompt: Option<String>,
) -> AppResult<TradeSystemDraft> {
    let mut material_text = Vec::new();
    let mut stmt = conn.prepare("select file_name, extracted_text from materials where id = ?1")?;
    for material_id in &material_ids {
        if let Some((file_name, text)) = stmt
            .query_row(params![material_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
            })
            .optional()?
        {
            material_text.push(format!(
                "## 来源: {}\n{}",
                file_name,
                text.unwrap_or_else(|| "材料没有可提取文本".to_string())
            ));
        }
    }

    let user_prompt = prompt.unwrap_or_else(|| "请整理成可评分、可执行的趋势交易系统。".to_string());
    let body = material_text.join("\n\n");
    let markdown = format!(
        r#"# 我的趋势交易系统

## 系统定位

基于用户材料整理的裸 K / 趋势交易系统。{}

## 数据需求

- 日 K、周 K、月 K。
- 仅使用已同步到本地结构化库的 open、high、low、close、volume、amount、turnover。

## 入选条件

- 趋势结构清晰。
- 周期共振优先。
- 排除缺少本地 K 线覆盖的股票。

## 评分规则

- 趋势结构 35 分：高低点抬升、突破有效性、回撤强度。
- 量价配合 25 分：突破放量、回调缩量、异常量风险。
- 多周期一致性 25 分：日 K、周 K、月 K 方向一致。
- 风险边界 15 分：止损距离、支撑位明确度、无效条件。

## 交易计划规则

- 观察：价格接近关键突破位或回踩支撑位时进入观察。
- 入场：满足交易系统定义的结构条件后才允许给出计划。
- 止损：以最近结构低点或规则定义失效点为准。
- 止盈：按前高、趋势延伸和风险收益比拆分。
- 不交易：规则不足、数据不足或结构矛盾时不生成买卖计划。

## 复盘输出格式

Agent 必须输出 JSON，包含 score、rating、overall_evaluation、core_reasons、evidence、trade_plan、chart_annotations、uncertainty。

## 材料摘要

{}
"#,
        user_prompt, body
    );

    Ok(TradeSystemDraft {
        markdown,
        gap_questions: vec![
            "请确认入场条件是否需要明确突破幅度或收盘确认。".to_string(),
            "请补充止损点与仓位风险之间的关系。".to_string(),
            "请确认量价评分中放量/缩量的量化阈值。".to_string(),
        ],
        source_material_ids: material_ids,
    })
}

fn collect_rows<T, F>(rows: rusqlite::MappedRows<'_, F>) -> AppResult<Vec<T>>
where
    F: FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<T>,
{
    let mut values = Vec::new();
    for row in rows {
        values.push(row?);
    }
    Ok(values)
}

pub fn value_to_string(value: &Value) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "{}".to_string())
}

#[cfg(test)]
mod tests {
    use super::check_completeness;

    #[test]
    fn completeness_reports_missing_sections() {
        let report = check_completeness("# 系统定位\n趋势交易。");
        assert_eq!(report.status, "incomplete");
        assert!(report.missing_sections.contains(&"评分规则".to_string()));
        assert!(!report.can_score);
    }

    #[test]
    fn completeness_accepts_scoring_shape_and_trade_plan() {
        let markdown = r#"
# 系统
## 系统定位
趋势交易。
## 数据需求
日 K、周 K、月 K。
## 入选条件
趋势结构清晰。
## 评分规则
趋势结构 35 分，量价配合 25 分，多周期一致性 25 分，风险边界 15 分。
## 交易计划规则
观察、入场、止损、止盈、不交易。
## 复盘输出格式
输出 JSON。
"#;
        let report = check_completeness(markdown);
        assert_eq!(report.status, "complete");
        assert!(report.can_score);
    }
}
