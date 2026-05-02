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

    seed_defaults(conn)?;
    tracing::info!("SQLite 建表迁移完成");
    Ok(())
}

fn seed_defaults(conn: &Connection) -> AppResult<()> {
    conn.execute(
        "insert or ignore into watchlists (id, name, created_at, updated_at) values ('wl_default', '我的自选', datetime('now'), datetime('now'))",
        [],
    )?;
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
