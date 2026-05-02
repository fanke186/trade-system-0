use crate::error::AppResult;
use duckdb::Connection;
use std::path::Path;

pub type DuckConnection = Connection;

pub fn open(path: &Path) -> AppResult<DuckConnection> {
    tracing::info!(path = %path.display(), "打开 DuckDB 连接");
    let conn = Connection::open(path).inspect_err(|e| {
        tracing::error!(error = %e, path = %path.display(), "DuckDB 连接失败");
    })?;
    Ok(conn)
}

pub fn run_migrations(conn: &DuckConnection) -> AppResult<()> {
    tracing::info!("执行 DuckDB 建表迁移");
    conn.execute_batch(
        r#"
        create table if not exists schema_migrations (
          id text primary key,
          applied_at timestamp not null
        );

        create table if not exists securities (
          symbol text primary key,
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

        create table if not exists bars_1Q (
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
          change double,
          change_pct double,
          amplitude double,
          source text,
          updated_at timestamp not null,
          primary key (symbol_id, trade_date)
        );

        create table if not exists bars_1Y (
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
          change double,
          change_pct double,
          amplitude double,
          source text,
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

        create table if not exists kline_bars (
          symbol text not null,
          period text not null,
          adj_mode text not null,
          trade_date date not null,
          open double not null,
          high double not null,
          low double not null,
          close double not null,
          pre_close double,
          volume double not null,
          amount double not null,
          change double,
          change_pct double,
          amplitude double,
          turnover_rate double,
          source text,
          updated_at timestamp not null,
          primary key (symbol, period, adj_mode, trade_date)
        );

        alter table bars_1d add column if not exists change double;
        alter table bars_1d add column if not exists change_pct double;
        alter table bars_1d add column if not exists amplitude double;
        alter table bars_1w add column if not exists change double;
        alter table bars_1w add column if not exists change_pct double;
        alter table bars_1w add column if not exists amplitude double;
        alter table bars_1w add column if not exists pre_close double;
        alter table bars_1M add column if not exists pre_close double;
        alter table bars_1M add column if not exists change double;
        alter table bars_1M add column if not exists change_pct double;
        alter table bars_1M add column if not exists amplitude double;

        alter table securities add column if not exists industry text;
        alter table securities add column if not exists sub_industry text;
        alter table securities add column if not exists area text;
        alter table securities add column if not exists market_type text;
        alter table securities add column if not exists stock_type text default 'stock';
        alter table securities add column if not exists symbol text;
        alter table securities add column if not exists total_shares double;
        alter table securities add column if not exists float_shares double;
        alter table securities add column if not exists tick_size double;
        alter table securities add column if not exists limit_up double;
        alter table securities add column if not exists limit_down double;
        alter table securities add column if not exists updated_at timestamp;
        alter table securities add column if not exists total_cap double;
        alter table securities add column if not exists pe_ratio double;

        update securities set stock_type = 'stock' where stock_type is null;
        update securities
           set symbol = code || '.' || exchange
         where symbol is null and exchange in ('SH', 'SZ', 'BJ');

        insert or ignore into schema_migrations (id, applied_at)
        values ('0003_add_bars_1Q_1Y', current_timestamp);
        insert or ignore into schema_migrations (id, applied_at)
        values ('0002_add_kline_fields', current_timestamp);
        insert or ignore into schema_migrations (id, applied_at)
        values ('0001_initial_duckdb', current_timestamp);
        "#,
    )?;
    rebuild_securities_table(conn)?;
    seed_defaults(conn)?;
    tracing::info!("DuckDB 建表迁移完成");
    Ok(())
}

fn rebuild_securities_table(conn: &DuckConnection) -> AppResult<()> {
    conn.execute_batch(
        r#"
        create table securities_rebuilt (
          symbol text primary key,
          code text not null,
          name text not null,
          exchange text not null,
          board text,
          list_date date,
          delist_date date,
          status text not null default 'active',
          industry text,
          sub_industry text,
          area text,
          market_type text,
          stock_type text not null default 'stock',
          total_shares double,
          float_shares double,
          tick_size double,
          limit_up double,
          limit_down double,
          total_cap double,
          pe_ratio double,
          updated_at timestamp
        );

        insert or replace into securities_rebuilt
          (symbol, code, name, exchange, board, list_date, delist_date, status,
           industry, sub_industry, area, market_type, stock_type, total_shares,
           float_shares, tick_size, limit_up, limit_down, total_cap, pe_ratio, updated_at)
        select
          coalesce(nullif(symbol, ''), code || '.' || exchange),
          code,
          name,
          exchange,
          board,
          list_date,
          delist_date,
          coalesce(status, 'active'),
          industry,
          sub_industry,
          area,
          market_type,
          coalesce(stock_type, 'stock'),
          total_shares,
          float_shares,
          tick_size,
          limit_up,
          limit_down,
          total_cap,
          pe_ratio,
          coalesce(updated_at, current_timestamp)
        from securities
        where coalesce(nullif(symbol, ''), code || '.' || exchange) is not null;

        drop table securities;
        alter table securities_rebuilt rename to securities;
        create index if not exists idx_securities_code_name on securities(code, name);
        create index if not exists idx_kline_bars_lookup on kline_bars(symbol, period, adj_mode, trade_date);
        "#,
    )?;
    Ok(())
}

fn seed_defaults(conn: &DuckConnection) -> AppResult<()> {
    for (symbol, code, name, exchange, board, list_date) in [
        ("002261.SZ", "002261", "拓维信息", "SZ", "主板", "2008-07-23"),
        ("000001.SZ", "000001", "平安银行", "SZ", "主板", "1991-04-03"),
        ("300750.SZ", "300750", "宁德时代", "SZ", "创业板", "2018-06-11"),
        ("600519.SH", "600519", "贵州茅台", "SH", "主板", "2001-08-27"),
    ] {
        conn.execute(
            "insert or ignore into securities (symbol, code, name, exchange, board, list_date, market_type, stock_type, status, updated_at)
             values (?1, ?2, ?3, ?4, ?5, cast(?6 as date), ?5, 'stock', 'active', current_timestamp)",
            duckdb::params![symbol, code, name, exchange, board, list_date],
        )?;
    }

    for (symbol, code, name, exchange, stock_type) in [
        ("000001.SH", "000001", "上证指数", "SH", "index"),
        ("399001.SZ", "399001", "深证成指", "SZ", "index"),
        ("399006.SZ", "399006", "创业板指", "SZ", "index"),
        ("000688.SH", "000688", "科创50", "SH", "index"),
        ("000300.SH", "000300", "沪深300", "SH", "index"),
        ("000905.SH", "000905", "中证500", "SH", "index"),
        ("899050.BJ", "899050", "北证50", "BJ", "index"),
    ] {
        conn.execute(
            "insert or ignore into securities (symbol, code, name, exchange, stock_type, status, updated_at) values (?1, ?2, ?3, ?4, ?5, 'active', current_timestamp)",
            duckdb::params![symbol, code, name, exchange, stock_type],
        )?;
    }
    Ok(())
}
