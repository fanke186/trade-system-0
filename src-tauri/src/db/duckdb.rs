use crate::error::AppResult;
use duckdb::Connection;
use std::path::Path;

pub type DuckConnection = Connection;

pub fn open(path: &Path) -> AppResult<DuckConnection> {
    Ok(Connection::open(path)?)
}

pub fn run_migrations(conn: &DuckConnection) -> AppResult<()> {
    conn.execute_batch(
        r#"
        create table if not exists schema_migrations (
          id text primary key,
          applied_at timestamp not null
        );

        create table if not exists securities (
          symbol_id integer primary key,
          code text not null unique,
          name text not null,
          exchange text not null,
          board text,
          list_date date,
          delist_date date,
          status text not null default 'active'
        );

        create table if not exists trade_calendar (
          trade_date date primary key,
          is_open boolean not null
        );

        create table if not exists bars_1d (
          symbol_id integer not null,
          trade_date date not null,
          open double not null,
          high double not null,
          low double not null,
          close double not null,
          pre_close double,
          volume double not null,
          amount double not null,
          turnover double,
          adj_factor double,
          source text,
          updated_at timestamp not null,
          primary key (symbol_id, trade_date)
        );

        create table if not exists bars_1w (
          symbol_id integer not null,
          trade_date date not null,
          open double not null,
          high double not null,
          low double not null,
          close double not null,
          volume double not null,
          amount double not null,
          turnover double,
          adj_factor double,
          updated_at timestamp not null,
          primary key (symbol_id, trade_date)
        );

        create table if not exists bars_1M (
          symbol_id integer not null,
          trade_date date not null,
          open double not null,
          high double not null,
          low double not null,
          close double not null,
          volume double not null,
          amount double not null,
          turnover double,
          adj_factor double,
          updated_at timestamp not null,
          primary key (symbol_id, trade_date)
        );

        create table if not exists kline_sync_runs (
          id text primary key,
          stock_code text not null,
          mode text not null,
          status text not null,
          started_at timestamp not null,
          finished_at timestamp,
          rows_written integer not null default 0,
          source text,
          error text
        );

        insert or ignore into schema_migrations (id, applied_at)
        values ('0001_initial_duckdb', current_timestamp);
        "#,
    )?;
    seed_defaults(conn)?;
    Ok(())
}

fn seed_defaults(conn: &DuckConnection) -> AppResult<()> {
    for (symbol_id, code, name, exchange, board, list_date) in [
        (1_i64, "002261", "拓维信息", "SZ", "主板", "2008-07-23"),
        (2_i64, "000001", "平安银行", "SZ", "主板", "1991-04-03"),
        (3_i64, "300750", "宁德时代", "SZ", "创业板", "2018-06-11"),
        (4_i64, "600519", "贵州茅台", "SH", "主板", "2001-08-27"),
    ] {
        conn.execute(
            "insert or ignore into securities (symbol_id, code, name, exchange, board, list_date, status)
             values (?1, ?2, ?3, ?4, ?5, cast(?6 as date), 'active')",
            duckdb::params![symbol_id, code, name, exchange, board, list_date],
        )?;
    }
    Ok(())
}
