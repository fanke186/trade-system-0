use crate::error::AppResult;
use rusqlite::Connection;
use std::path::Path;

pub fn open(path: &Path) -> AppResult<Connection> {
    tracing::info!(path = %path.display(), "打开 SQLite 连接");
    let conn = Connection::open(path).inspect_err(|e| {
        tracing::error!(error = %e, path = %path.display(), "SQLite 连接失败");
    })?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    Ok(conn)
}

pub fn run_migrations(conn: &Connection) -> AppResult<()> {
    tracing::info!("执行 SQLite 建表迁移");
    conn.execute_batch(
        r#"
        create table if not exists schema_migrations (
          id text primary key,
          applied_at text not null
        );

        create table if not exists trade_systems (
          id text primary key,
          name text not null,
          description text,
          active_version_id text,
          version integer not null default 1,
          system_md text not null default '',
          system_path text,
          persona_md text not null default '',
          persona_path text,
          status text not null default 'active',
          deleted_at text,
          created_at text not null,
          updated_at text not null
        );

        create table if not exists trade_system_versions (
          id text primary key,
          trade_system_id text not null references trade_systems(id),
          version integer not null,
          markdown text not null,
          content_hash text not null,
          completeness_status text not null,
          completeness_report_json text not null,
          change_summary text,
          created_at text not null,
          unique(trade_system_id, version)
        );

        create table if not exists model_providers (
          id text primary key,
          name text not null,
          provider_type text not null,
          base_url text not null,
          api_key_ref text not null,
          model text not null,
          temperature real not null default 0.2,
          max_tokens integer not null default 4096,
          enabled integer not null default 1,
          is_active integer not null default 0,
          extra_json text not null default '{}',
          created_at text not null,
          updated_at text not null
        );

        create table if not exists agents (
          id text primary key,
          trade_system_id text not null references trade_systems(id),
          trade_system_version_id text not null references trade_system_versions(id),
          name text not null,
          model_provider_id text references model_providers(id),
          system_prompt text not null,
          output_schema_json text not null,
          created_at text not null,
          updated_at text not null
        );

        create table if not exists materials (
          id text primary key,
          trade_system_id text references trade_systems(id),
          file_name text not null,
          file_path text not null,
          mime_type text,
          extracted_text text,
          parse_status text not null,
          parse_error text,
          created_at text not null
        );

        create table if not exists stocks (
          code text primary key,
          name text,
          exchange text,
          status text not null default 'active',
          updated_at text not null
        );

        create table if not exists watchlists (
          id text primary key,
          name text not null,
          created_at text not null,
          updated_at text not null
        );

        create table if not exists watchlist_items (
          id text primary key,
          watchlist_id text not null references watchlists(id),
          stock_code text not null,
          local_status text not null default 'watch',
          note text,
          sort_order integer not null default 0,
          created_at text not null,
          updated_at text not null,
          unique(watchlist_id, stock_code)
        );

        create table if not exists stock_reviews (
          id text primary key,
          stock_code text not null,
          trade_system_id text not null references trade_systems(id),
          trade_system_version_id text not null references trade_system_versions(id),
          model_provider_id text references model_providers(id),
          score integer,
          rating text not null,
          overall_evaluation text not null,
          core_reasons_json text not null,
          evidence_json text not null,
          trade_plan_json text not null,
          chart_annotations_json text not null,
          uncertainty_json text not null,
          kline_coverage_json text not null,
          prompt_hash text not null,
          output_hash text not null,
          created_at text not null
        );

        create table if not exists ai_score_runs (
          id text primary key,
          trigger_type text not null,
          trade_system_id text not null references trade_systems(id),
          trade_system_version_id text not null references trade_system_versions(id),
          provider_id text references model_providers(id),
          status text not null,
          total_count integer not null default 0,
          completed_count integer not null default 0,
          failed_count integer not null default 0,
          target_snapshot_json text not null default '[]',
          created_at text not null,
          updated_at text not null,
          deleted_at text
        );

        create table if not exists ai_score_records (
          id text primary key,
          run_id text not null references ai_score_runs(id),
          stock_symbol text not null,
          stock_code text not null,
          stock_name text not null,
          trade_system_id text not null references trade_systems(id),
          trade_system_version_id text not null references trade_system_versions(id),
          provider_id text references model_providers(id),
          trigger_time text not null,
          score_date text not null,
          status text not null,
          score integer,
          rating text,
          stock_review_id text references stock_reviews(id),
          report_path text,
          error_message text,
          started_at text,
          completed_at text,
          created_at text not null,
          updated_at text not null,
          deleted_at text
        );

        create table if not exists trade_system_stocks (
          id text primary key,
          trade_system_id text not null references trade_systems(id),
          symbol text not null,
          latest_score integer,
          previous_report text,
          previous_report_path text,
          latest_report text,
          latest_report_path text,
          latest_score_date text,
          updated_at text not null default (datetime('now')),
          unique(trade_system_id, symbol)
        );

        create table if not exists chart_annotations (
          id text primary key,
          stock_code text not null,
          trade_system_version_id text references trade_system_versions(id),
          review_id text references stock_reviews(id),
          source text not null,
          annotation_type text not null,
          payload_json text not null,
          created_at text not null,
          updated_at text not null
        );

        insert or ignore into schema_migrations (id, applied_at)
        values ('0001_initial_sqlite', datetime('now'));

        update watchlists set name = '我的自选', updated_at = datetime('now')
         where id = 'wl_default' and name in ('默认自选', '自选股票池');
        "#,
    )?;

    migrate_trade_system_agents(conn)?;
    seed_defaults(conn)?;
    tracing::info!("SQLite 建表迁移完成");
    Ok(())
}

fn migrate_trade_system_agents(conn: &Connection) -> AppResult<()> {
    for stmt in [
        "alter table trade_systems add column version integer not null default 1",
        "alter table trade_systems add column system_md text not null default ''",
        "alter table trade_systems add column system_path text",
        "alter table trade_systems add column persona_md text not null default ''",
        "alter table trade_systems add column persona_path text",
        "alter table trade_systems add column status text not null default 'active'",
        "alter table trade_systems add column deleted_at text",
    ] {
        let _ = conn.execute(stmt, []);
    }

    if !table_has_column(conn, "trade_system_stocks", "symbol")? {
        conn.execute_batch(
            r#"
            alter table trade_system_stocks rename to trade_system_stocks_legacy;

            create table trade_system_stocks (
              id text primary key,
              trade_system_id text not null references trade_systems(id),
              symbol text not null,
              latest_score integer,
              previous_report text,
              previous_report_path text,
              latest_report text,
              latest_report_path text,
              latest_score_date text,
              updated_at text not null default (datetime('now')),
              unique(trade_system_id, symbol)
            );

            insert or ignore into trade_system_stocks (id, trade_system_id, symbol, updated_at)
            select 'tss_' || lower(hex(randomblob(12))),
                   trade_system_id,
                   stock_code,
                   coalesce(created_at, datetime('now'))
              from trade_system_stocks_legacy;

            drop table trade_system_stocks_legacy;
            "#,
        )?;
    }

    conn.execute_batch(
        r#"
        update trade_systems
           set version = coalesce((
                 select v.version
                   from trade_system_versions v
                  where v.id = trade_systems.active_version_id
               ), version),
               system_md = coalesce(nullif(system_md, ''), (
                 select v.markdown
                   from trade_system_versions v
                  where v.id = trade_systems.active_version_id
               ), '')
         where coalesce(status, 'active') = 'active';

        create index if not exists idx_trade_system_stocks_system
            on trade_system_stocks(trade_system_id);

        create index if not exists idx_ai_score_records_status
            on ai_score_records(status, created_at) where deleted_at is null;

        create index if not exists idx_ai_score_records_run
            on ai_score_records(run_id) where deleted_at is null;

        create index if not exists idx_ai_score_records_system
            on ai_score_records(trade_system_id, created_at) where deleted_at is null;
        "#,
    )?;

    if let Err(error) = conn.execute_batch(
        r#"
        create unique index if not exists idx_trade_systems_name_active
            on trade_systems(name) where status = 'active';
        "#,
    ) {
        tracing::warn!(%error, "无法创建活跃交易系统名称唯一索引，可能存在历史重名数据");
    }

    Ok(())
}

fn table_has_column(conn: &Connection, table: &str, column: &str) -> AppResult<bool> {
    let mut stmt = conn.prepare(&format!("pragma table_info({})", table))?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
    for row in rows {
        if row? == column {
            return Ok(true);
        }
    }
    Ok(false)
}

fn seed_defaults(conn: &Connection) -> AppResult<()> {
    conn.execute(
        "insert or ignore into watchlists (id, name, created_at, updated_at) values ('wl_default', '我的自选', datetime('now'), datetime('now'))",
        [],
    )?;
    let provider_count: i64 =
        conn.query_row("select count(*) from model_providers", [], |row| row.get(0))?;
    if provider_count == 0 {
        conn.execute(
            r#"
            insert into model_providers
              (id, name, provider_type, base_url, api_key_ref, model, temperature, max_tokens,
               enabled, is_active, extra_json, created_at, updated_at)
            values (
              'mp_deepseek_default',
              'DeepSeek Pro',
              'deepseek',
              'https://api.deepseek.com',
              'env:DEEPSEEK_API_KEY',
              'deepseek-v4-pro',
              0.2,
              8192,
              1,
              1,
              '{"requestOverrides":{"thinking":{"type":"enabled"},"reasoning_effort":"high"}}',
              datetime('now'),
              datetime('now')
            )
            "#,
            [],
        )?;
    }
    for (code, name, exchange) in [
        ("002261", "拓维信息", "SZ"),
        ("000001", "平安银行", "SZ"),
        ("300750", "宁德时代", "SZ"),
        ("600519", "贵州茅台", "SH"),
    ] {
        conn.execute(
            "insert or ignore into stocks (code, name, exchange, updated_at) values (?1, ?2, ?3, datetime('now'))",
            rusqlite::params![code, name, exchange],
        )?;
    }
    Ok(())
}
