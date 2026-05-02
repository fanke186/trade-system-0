use crate::app_state::AppState;
use crate::db::duckdb::DuckConnection;
use crate::error::{AppError, AppResult};
use crate::llm::client::{call_model, ModelCallOptions};
use crate::models::{
    ChatMessage, CompletenessReport, ExportResult, OkResult, TradeSystemDetail, TradeSystemDraft,
    TradeSystemRevisionInput, TradeSystemRevisionProposal, TradeSystemStock, TradeSystemSummary,
    TradeSystemVersion,
};
use crate::services::common::{new_id, now_iso, sha256_hex};
use crate::services::kline_query_service::resolve_symbol;
use crate::services::model_provider_service::{get_active_provider, resolve_api_key};
use chrono::{Datelike, Duration, Local, Timelike, Weekday};
use duckdb::OptionalExt as DuckOptionalExt;
use rusqlite::{params, Connection, OptionalExtension};
use std::path::{Path, PathBuf};

pub fn list_trade_systems(conn: &Connection) -> AppResult<Vec<TradeSystemSummary>> {
    let mut stmt = conn.prepare(
        r#"
        select ts.id,
               ts.name,
               ts.description,
               ts.active_version_id,
               coalesce(v.version, ts.version),
               v.completeness_status,
               (select count(*)
                  from trade_system_stocks tss
                 where tss.trade_system_id = ts.id) as stock_count,
               ts.system_path,
               ts.persona_path,
               ts.updated_at
          from trade_systems ts
          left join trade_system_versions v on v.id = ts.active_version_id
         where coalesce(ts.status, 'active') = 'active'
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
            stock_count: row.get(6)?,
            system_path: row.get(7)?,
            persona_path: row.get(8)?,
            updated_at: row.get(9)?,
        })
    })?;
    collect_rows(rows)
}

pub fn get_trade_system(conn: &Connection, trade_system_id: &str) -> AppResult<TradeSystemDetail> {
    let mut detail = conn
        .query_row(
            r#"
            select id, name, description, active_version_id, version, system_md, system_path,
                   persona_md, persona_path, created_at, updated_at
              from trade_systems
             where id = ?1 and coalesce(status, 'active') = 'active'
            "#,
            params![trade_system_id],
            |row| {
                Ok(TradeSystemDetail {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    description: row.get(2)?,
                    active_version_id: row.get(3)?,
                    active_version: row.get(4)?,
                    system_md: row.get(5)?,
                    system_path: row.get(6)?,
                    persona_md: row.get(7)?,
                    persona_path: row.get(8)?,
                    created_at: row.get(9)?,
                    updated_at: row.get(10)?,
                    versions: Vec::new(),
                })
            },
        )
        .optional()?
        .ok_or_else(|| AppError::new("not_found", "交易系统不存在", true))?;

    detail.versions = list_versions(conn, trade_system_id)?;
    Ok(detail)
}

pub fn list_versions(
    conn: &Connection,
    trade_system_id: &str,
) -> AppResult<Vec<TradeSystemVersion>> {
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
        (
            "数据需求",
            &["数据需求", "k 线", "k线", "日 k", "周 k", "月 k"],
        ),
        ("入选条件", &["入选条件", "选股条件", "入池", "筛选"]),
        ("评分规则", &["评分规则", "评分", "权重", "分值"]),
        (
            "交易计划规则",
            &["交易计划", "入场", "止损", "止盈", "不交易"],
        ),
        ("复盘输出格式", &["复盘输出", "输出格式", "json", "评价"]),
    ];

    let mut missing = Vec::new();
    for (label, needles) in checks {
        if !needles
            .iter()
            .any(|needle| normalized.contains(&needle.to_lowercase()))
        {
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
        .any(|word| markdown.contains(word))
        || (markdown.chars().any(|ch| ch.is_ascii_digit()) && markdown.contains('分'));
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
    app_dir: &Path,
    trade_system_id: Option<String>,
    name: String,
    markdown: String,
    change_summary: Option<String>,
) -> AppResult<TradeSystemVersion> {
    let now = now_iso();
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::new("invalid_input", "交易系统名称不能为空", true));
    }

    let system_id = trade_system_id.unwrap_or_else(|| new_id("ts"));
    let existing: Option<(String, Option<String>)> = conn
        .query_row(
            "select id, status from trade_systems where id = ?1",
            params![system_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;

    if let Some((_, status)) = &existing {
        if status.as_deref() == Some("deleted") {
            return Err(AppError::new(
                "invalid_state",
                "交易系统已删除，不能继续发布版本",
                true,
            ));
        }
    }

    let conflicting_active_id: Option<String> = conn
        .query_row(
            "select id from trade_systems where name = ?1 and coalesce(status, 'active') = 'active' and id <> ?2 limit 1",
            params![name, system_id],
            |row| row.get(0),
        )
        .optional()?;
    if conflicting_active_id.is_some() {
        return Err(AppError::new(
            "duplicate_name",
            "已存在同名交易系统 Agent",
            true,
        ));
    }

    let persona_md = existing_persona(conn, &system_id)?
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| default_persona_markdown(&name));
    let (system_path, persona_path) =
        write_agent_documents(app_dir, &name, &markdown, &persona_md)?;

    if existing.is_none() {
        conn.execute(
            r#"
            insert into trade_systems
              (id, name, description, active_version_id, version, system_md, system_path,
               persona_md, persona_path, status, created_at, updated_at)
            values (?1, ?2, null, null, 1, ?3, ?4, ?5, ?6, 'active', ?7, ?7)
            "#,
            params![
                system_id,
                name,
                markdown,
                system_path.to_string_lossy().to_string(),
                persona_md,
                persona_path.to_string_lossy().to_string(),
                now
            ],
        )?;
    } else {
        conn.execute(
            r#"
            update trade_systems
               set name = ?1,
                   system_md = ?2,
                   system_path = ?3,
                   persona_md = ?4,
                   persona_path = ?5,
                   status = 'active',
                   updated_at = ?6
             where id = ?7
            "#,
            params![
                name,
                markdown,
                system_path.to_string_lossy().to_string(),
                persona_md,
                persona_path.to_string_lossy().to_string(),
                now,
                system_id
            ],
        )?;
    }

    let next_version = if existing.is_some() {
        conn.query_row(
            "select coalesce(max(version), 0) + 1 from trade_system_versions where trade_system_id = ?1",
            params![system_id],
            |row| row.get(0),
        )?
    } else {
        next_version_for_name(conn, &name)?
    };
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
        "update trade_systems set active_version_id = ?1, version = ?2, updated_at = ?3 where id = ?4",
        params![version_id, next_version, now, system_id],
    )?;
    get_version(conn, &version_id)
}

fn next_version_for_name(conn: &Connection, name: &str) -> AppResult<i64> {
    conn.query_row(
        r#"
        select coalesce(max(version), 0) + 1
          from (
            select version
              from trade_systems
             where name = ?1
            union all
            select v.version
              from trade_system_versions v
              join trade_systems ts on ts.id = v.trade_system_id
             where ts.name = ?1
          )
        "#,
        params![name],
        |row| row.get(0),
    )
    .map_err(Into::into)
}

fn existing_persona(conn: &Connection, trade_system_id: &str) -> AppResult<Option<String>> {
    let value: Option<Option<String>> = conn
        .query_row(
            "select persona_md from trade_systems where id = ?1",
            params![trade_system_id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(value.flatten())
}

fn default_persona_markdown(name: &str) -> String {
    format!(
        r#"# {name} Agent 人格

你是交易系统「{name}」的执行 Agent。你的任务是严格依据 system.md 中定义的边界、数据能力、评分规则和交易计划规则，对关联标的进行一致、可追溯、可复盘的评估。

## 行为准则

- 不补写 system.md 中不存在的规则。
- 数据不足时明确标记不可评分或需要人工确认。
- 输出必须区分事实、规则命中、推断和不确定性。
- 不承诺收益，不给出脱离风险预算的建议。
"#
    )
}

fn write_agent_documents(
    app_dir: &Path,
    name: &str,
    system_md: &str,
    persona_md: &str,
) -> AppResult<(PathBuf, PathBuf)> {
    let agent_dir = app_dir.join("agents").join(safe_agent_dir_name(name));
    std::fs::create_dir_all(&agent_dir)?;
    let system_path = agent_dir.join("system.md");
    let persona_path = agent_dir.join("persona.md");
    std::fs::write(&system_path, system_md)?;
    std::fs::write(&persona_path, persona_md)?;
    Ok((system_path, persona_path))
}

fn safe_agent_dir_name(name: &str) -> String {
    let sanitized: String = name
        .chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ if ch.is_control() => '_',
            _ => ch,
        })
        .collect();
    let trimmed = sanitized.trim();
    if trimmed.is_empty() {
        "untitled".to_string()
    } else {
        trimmed.to_string()
    }
}

pub fn export_version(
    conn: &Connection,
    version_id: &str,
    target_path: &str,
) -> AppResult<ExportResult> {
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

pub async fn propose_revision(
    state: &AppState,
    input: TradeSystemRevisionInput,
) -> AppResult<TradeSystemRevisionProposal> {
    let provider = {
        let conn = state.sqlite.lock().expect("sqlite lock");
        get_active_provider(&conn)?
            .ok_or_else(|| AppError::new("provider_request_failed", "未配置活跃模型 Provider", true))?
    };
    let api_key = resolve_api_key(&state.app_dir, &provider)?;
    let system_prompt = build_revision_system_prompt(&input.name, &input.current_markdown);
    let mut messages = input.messages;
    if messages.is_empty() {
        messages.push(ChatMessage {
            role: "user".to_string(),
            content: "请检查当前交易系统草稿，并提出下一步需要补齐的问题。".to_string(),
        });
    }
    let content = call_model(
        &state.http,
        &provider,
        &api_key,
        ModelCallOptions {
            system_prompt,
            messages,
            response_format: Some("json_object".to_string()),
            temperature: Some(provider.temperature),
            max_tokens: Some(provider.max_tokens),
        },
    )
    .await?;
    let value: serde_json::Value = serde_json::from_str(&content)?;
    Ok(TradeSystemRevisionProposal {
        assistant_message: value
            .get("assistantMessage")
            .or_else(|| value.get("assistant_message"))
            .and_then(|node| node.as_str())
            .unwrap_or("已生成交易系统修订建议。")
            .to_string(),
        markdown: value
            .get("markdown")
            .and_then(|node| node.as_str())
            .unwrap_or(&input.current_markdown)
            .to_string(),
        diff: value
            .get("diff")
            .and_then(|node| node.as_str())
            .unwrap_or("")
            .to_string(),
        gap_questions: value
            .get("gapQuestions")
            .or_else(|| value.get("gap_questions"))
            .and_then(|node| node.as_array())
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| item.as_str().map(ToString::to_string))
                    .collect()
            })
            .unwrap_or_default(),
    })
}

pub fn add_stocks(
    conn: &Connection,
    duck: &DuckConnection,
    trade_system_id: &str,
    symbols: Vec<String>,
) -> AppResult<OkResult> {
    let exists: Option<String> = conn
        .query_row(
            "select id from trade_systems where id = ?1 and coalesce(status, 'active') = 'active'",
            params![trade_system_id],
            |row| row.get(0),
        )
        .optional()?;
    if exists.is_none() {
        return Err(AppError::new("not_found", "交易系统不存在", true));
    }

    let now = now_iso();
    for symbol in symbols {
        let symbol = resolve_symbol(duck, &symbol)?;
        let id = new_id("tss");
        conn.execute(
            r#"
            insert into trade_system_stocks (id, trade_system_id, symbol, updated_at)
            values (?1, ?2, ?3, ?4)
            on conflict(trade_system_id, symbol) do update set updated_at = excluded.updated_at
            "#,
            params![id, trade_system_id, symbol, now],
        )?;
    }
    Ok(OkResult { ok: true })
}

fn build_revision_system_prompt(name: &str, current_markdown: &str) -> String {
    let template = include_str!("../../../docs/trading-system-template.md");
    format!(
        r#"你是 trade-system-0 的交易系统编辑 Agent。你的任务是用缺口问答的方式帮助用户把交易系统补齐到可评分、可复盘、可追溯。

工作规则：
- 必须以仓库模板为准，不要发明模板外的核心结构。
- 优先发现会阻止评分、风控或复盘的缺口，每次最多追问 3 个关键问题。
- 如果用户已经给出足够信息，直接把信息整合进 Markdown。
- 只返回 JSON 对象，不返回 Markdown 代码块。
- JSON 必须包含 assistantMessage、markdown、diff、gapQuestions。
- markdown 是完整交易系统 Markdown，不是片段；如果只需要追问，可以保持原文不变。
- diff 用简短中文说明本轮改动或为什么暂不改。

交易系统名称：{name}

模板：
{template}

当前 Markdown：
{current_markdown}

请严格输出如下 JSON 形状：
{{
  "assistantMessage": "面向用户的一段简短说明或追问",
  "markdown": "完整 Markdown",
  "diff": "本轮变更摘要",
  "gapQuestions": ["问题1", "问题2"]
}}
"#
    )
}

pub fn remove_stock(conn: &Connection, trade_system_id: &str, symbol: &str) -> AppResult<OkResult> {
    conn.execute(
        "delete from trade_system_stocks where trade_system_id = ?1 and symbol = ?2",
        params![trade_system_id, symbol],
    )?;
    Ok(OkResult { ok: true })
}

pub fn delete_trade_system(
    conn: &Connection,
    app_dir: &Path,
    trade_system_id: &str,
) -> AppResult<OkResult> {
    let (name, system_path, persona_path): (String, Option<String>, Option<String>) = conn
        .query_row(
            "select name, system_path, persona_path from trade_systems where id = ?1 and coalesce(status, 'active') = 'active'",
            params![trade_system_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?
        .ok_or_else(|| AppError::new("not_found", "交易系统不存在或已删除", true))?;

    conn.execute(
        "update trade_systems set status = 'deleted', deleted_at = datetime('now'), updated_at = datetime('now') where id = ?1",
        params![trade_system_id],
    )?;

    let agent_root = app_dir.join("agents");
    let dir = system_path
        .as_deref()
        .and_then(|value| Path::new(value).parent().map(Path::to_path_buf))
        .or_else(|| {
            persona_path
                .as_deref()
                .and_then(|value| Path::new(value).parent().map(Path::to_path_buf))
        })
        .unwrap_or_else(|| agent_root.join(safe_agent_dir_name(&name)));

    if dir.starts_with(&agent_root) && dir.exists() {
        std::fs::remove_dir_all(dir)?;
    }

    Ok(OkResult { ok: true })
}

pub fn list_trade_system_stocks(
    conn: &Connection,
    duck: &DuckConnection,
    trade_system_id: &str,
) -> AppResult<Vec<TradeSystemStock>> {
    let mut stmt = conn.prepare(
        r#"
        select id, trade_system_id, symbol, latest_score, previous_report, previous_report_path,
               latest_report, latest_report_path, latest_score_date, updated_at
          from trade_system_stocks
         where trade_system_id = ?1
         order by latest_score desc nulls last, updated_at desc
        "#,
    )?;
    let rows = stmt.query_map(params![trade_system_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, Option<i32>>(3)?,
            row.get::<_, Option<String>>(4)?,
            row.get::<_, Option<String>>(5)?,
            row.get::<_, Option<String>>(6)?,
            row.get::<_, Option<String>>(7)?,
            row.get::<_, Option<String>>(8)?,
            row.get::<_, Option<String>>(9)?,
        ))
    })?;

    let mut values = Vec::new();
    for row in rows {
        let (
            id,
            ts_id,
            symbol,
            latest_score,
            previous_report,
            previous_report_path,
            latest_report,
            latest_report_path,
            latest_score_date,
            updated_at,
        ) = row?;
        let meta = enrich_stock_meta(duck, &symbol)?;
        values.push(TradeSystemStock {
            id,
            trade_system_id: ts_id,
            symbol,
            code: meta.code,
            name: meta.name,
            exchange: meta.exchange,
            industry: meta.industry,
            latest_score,
            previous_report,
            previous_report_path,
            latest_report,
            latest_report_path,
            latest_score_date,
            latest_price: meta.latest_price,
            change_pct: meta.change_pct,
            updated_at,
        });
    }
    Ok(values)
}

pub fn update_trade_system_stock_review(
    conn: &Connection,
    trade_system_id: &str,
    symbol: &str,
    latest_score: Option<i64>,
    latest_report: String,
    latest_report_path: Option<String>,
) -> AppResult<()> {
    let now = now_iso();
    let score_date = score_date_for_now();
    let id = new_id("tss");
    conn.execute(
        r#"
        insert into trade_system_stocks
          (id, trade_system_id, symbol, latest_score, latest_report, latest_report_path,
           latest_score_date, updated_at)
        values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        on conflict(trade_system_id, symbol) do update set
          previous_report = trade_system_stocks.latest_report,
          previous_report_path = trade_system_stocks.latest_report_path,
          latest_score = excluded.latest_score,
          latest_report = excluded.latest_report,
          latest_report_path = excluded.latest_report_path,
          latest_score_date = excluded.latest_score_date,
          updated_at = excluded.updated_at
        "#,
        params![
            id,
            trade_system_id,
            symbol,
            latest_score,
            latest_report,
            latest_report_path,
            score_date,
            now
        ],
    )?;
    Ok(())
}

struct StockMetaSnapshot {
    code: String,
    name: String,
    exchange: Option<String>,
    industry: Option<String>,
    latest_price: Option<f64>,
    change_pct: Option<f64>,
}

fn enrich_stock_meta(duck: &DuckConnection, symbol: &str) -> AppResult<StockMetaSnapshot> {
    let fallback_code = symbol.split('.').next().unwrap_or(symbol).to_string();
    let row = duck
        .query_row(
            r#"
            with latest as (
              select symbol, max(trade_date) as latest_date
                from kline_bars
               where symbol = ?1 and period = '1d' and adj_mode = 'none'
               group by symbol
            ),
            latest_bar as (
              select b.symbol, b.close, b.change_pct
                from kline_bars b
                join latest l on l.symbol = b.symbol and l.latest_date = b.trade_date
               where b.period = '1d' and b.adj_mode = 'none'
            )
            select s.code, s.name, s.exchange, s.industry, lb.close, lb.change_pct
              from securities s
              left join latest_bar lb on lb.symbol = s.symbol
             where s.symbol = ?1
             limit 1
            "#,
            duckdb::params![symbol],
            |row| {
                Ok(StockMetaSnapshot {
                    code: row.get(0)?,
                    name: row.get(1)?,
                    exchange: row.get(2)?,
                    industry: row.get(3)?,
                    latest_price: row.get(4)?,
                    change_pct: row.get(5)?,
                })
            },
        )
        .optional()?;

    Ok(row.unwrap_or(StockMetaSnapshot {
        code: fallback_code.clone(),
        name: fallback_code,
        exchange: None,
        industry: None,
        latest_price: None,
        change_pct: None,
    }))
}

pub fn score_date_for_now() -> String {
    let now = Local::now();
    let today = now.date_naive();
    let is_weekday = !matches!(today.weekday(), Weekday::Sat | Weekday::Sun);
    if !is_weekday {
        return today.format("%Y-%m-%d").to_string();
    }

    if now.hour() >= 15 {
        return today.format("%Y-%m-%d").to_string();
    }

    let mut day = today - Duration::days(1);
    while matches!(day.weekday(), Weekday::Sat | Weekday::Sun) {
        day -= Duration::days(1);
    }
    day.format("%Y-%m-%d").to_string()
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

    let user_prompt =
        prompt.unwrap_or_else(|| "请整理成可评分、可执行的趋势交易系统。".to_string());
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
