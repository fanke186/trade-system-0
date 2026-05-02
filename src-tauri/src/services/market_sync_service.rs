use crate::db::duckdb::DuckConnection;
use crate::error::{AppError, AppResult};
use crate::models::{FrequencyCoverage, KlineCoverage, KlineSyncResult};
use crate::services::common::new_id;
use std::path::PathBuf;
use std::time::Instant;
use tauri::Emitter;

const DEFAULT_MARKET_DB: &str = "~/.data/duckdb/market/market.duckdb";

pub fn refresh_from_market(
    app: &tauri::AppHandle,
    conn: &DuckConnection,
) -> AppResult<KlineSyncResult> {
    let run_id = new_id("ksr");
    let market_path = market_db_path()?;

    emit_progress(app, "started", 0, "准备读取 market-sync 本地行情仓");

    conn.execute(
        "insert into kline_sync_runs (id, stock_code, mode, status, started_at, rows_written, source)
         values (?1, 'ALL', 'refresh', 'started', current_timestamp, 0, 'market-sync')",
        duckdb::params![run_id],
    )?;

    let result = refresh_inner(app, conn, &market_path);
    match result {
        Ok(rows_written) => {
            cleanup_detach_market(conn);
            conn.execute(
                "update kline_sync_runs
                    set status = 'ok', finished_at = current_timestamp, rows_written = ?1, source = 'market-sync'
                  where id = ?2",
                duckdb::params![rows_written, run_id],
            )?;
            emit_progress(app, "completed", 100, "market-sync 数据同步完成");

            Ok(KlineSyncResult {
                stock_code: "ALL".to_string(),
                mode: "refresh".to_string(),
                status: "ok".to_string(),
                rows_written,
                source: "market-sync".to_string(),
                coverage: global_coverage(conn)?,
            })
        }
        Err(err) => {
            let _ = conn.execute_batch("rollback");
            cleanup_detach_market(conn);
            let _ = conn.execute(
                "update kline_sync_runs
                    set status = 'failed', finished_at = current_timestamp, error = ?1, source = 'market-sync'
                  where id = ?2",
                duckdb::params![err.message.clone(), run_id],
            );
            emit_progress(app, "error", 100, &err.message);
            Err(err)
        }
    }
}

fn refresh_inner(
    app: &tauri::AppHandle,
    conn: &DuckConnection,
    market_path: &PathBuf,
) -> AppResult<i64> {
    if !market_path.exists() {
        return Err(AppError::with_detail(
            "market_db_not_found",
            "找不到 market-sync DuckDB 文件",
            true,
            serde_json::json!({ "path": market_path.to_string_lossy() }),
        ));
    }

    attach_market(conn, market_path)?;
    emit_progress(app, "syncing", 10, "已连接 market-sync DuckDB");

    run_db_step(conn, "sync_mapping", || sync_mapping(conn))?;
    emit_progress(app, "syncing", 25, "已同步标的映射");

    run_db_step(conn, "sync_securities", || sync_securities(conn))?;
    emit_progress(app, "syncing", 35, "已同步标的元数据");

    let scope = run_db_step(conn, "daily_sync_scope", || daily_sync_scope(conn))?;
    if scope.is_empty() {
        tracing::info!("外部 sync_state 未发现新增日 K，跳过 fact_kline 大表扫描");
        emit_progress(app, "syncing", 90, "本地 K 线已是最新，跳过大表扫描");
        run_db_step(conn, "update_mapping_watermarks", || {
            update_mapping_watermarks(conn)
        })?;
        run_db_step(conn, "refresh_securities_latest", || {
            refresh_securities_latest(conn)
        })?;
        emit_progress(app, "completed", 100, "数据已是最新，无需更新");
        return count_kline_rows(conn);
    }

    let (_daily_new, is_first_sync) = run_db_step(conn, "sync_daily_bars_incremental", || {
        sync_daily_bars_incremental(conn, &scope)
    })?;
    run_db_step(conn, "sync_trade_calendar", || sync_trade_calendar(conn))?;
    emit_progress(app, "syncing", 65, "已同步日 K");

    // Capture changed symbols BEFORE compute_derived_fields fills pre_close
    let changed_symbols = run_db_step(conn, "changed_symbols_since", || {
        changed_symbols_since(conn)
    })?;

    run_db_step(conn, "compute_derived_fields", || {
        compute_derived_fields(conn, is_first_sync)
    })?;
    emit_progress(app, "syncing", 75, "已计算衍生字段");

    if changed_symbols.is_empty() {
        tracing::info!("没有需要重新聚合的标的，跳过聚合步骤");
        emit_progress(app, "syncing", 90, "聚合无变化，跳过");

        // No changes to any data — skip expensive watermarks + securities updates
        emit_progress(app, "syncing", 100, "数据已是最新，无需更新");
    } else {
        tracing::info!(symbol_count = changed_symbols.len(), "开始增量聚合");
        run_db_step(conn, "aggregate_1w", || {
            aggregate_period_incremental(conn, "1w", "week", &changed_symbols)
        })?;
        run_db_step(conn, "aggregate_1M", || {
            aggregate_period_incremental(conn, "1M", "month", &changed_symbols)
        })?;
        run_db_step(conn, "aggregate_1Q", || {
            aggregate_period_incremental(conn, "1Q", "quarter", &changed_symbols)
        })?;
        run_db_step(conn, "aggregate_1Y", || {
            aggregate_period_incremental(conn, "1Y", "year", &changed_symbols)
        })?;
        emit_progress(app, "syncing", 90, "已增量聚合周月季年 K");

        run_db_step(conn, "update_mapping_watermarks", || {
            update_mapping_watermarks(conn)
        })?;
        emit_progress(app, "syncing", 96, "已更新同步水位");

        run_db_step(conn, "refresh_securities_latest", || {
            refresh_securities_latest(conn)
        })?;
        emit_progress(app, "syncing", 98, "已刷新标的最新价");
    }

    let rows_written = run_db_step(conn, "count_kline_rows", || count_kline_rows(conn))?;
    emit_progress(app, "completed", 100, "同步完成");

    Ok(rows_written)
}

fn attach_market(conn: &DuckConnection, market_path: &PathBuf) -> AppResult<()> {
    detach_market_if_attached(conn)?;
    let path = escape_sql_literal(&market_path.to_string_lossy());
    conn.execute_batch(&format!("attach '{path}' as market_db (read_only)"))?;
    Ok(())
}

fn cleanup_detach_market(conn: &DuckConnection) {
    if let Err(error) = detach_market_if_attached(conn) {
        tracing::warn!(
            code = %error.code,
            message = %error.message,
            "market-sync DuckDB detach 清理失败"
        );
    }
}

fn detach_market_if_attached(conn: &DuckConnection) -> AppResult<()> {
    match conn.execute_batch("detach market_db") {
        Ok(()) => Ok(()),
        Err(error) if is_market_db_not_attached(&error) => Ok(()),
        Err(error) => Err(error.into()),
    }
}

fn is_market_db_not_attached(error: &duckdb::Error) -> bool {
    let message = error.to_string().to_lowercase();
    message.contains("database not found") && message.contains("market_db")
}

fn sync_mapping(conn: &DuckConnection) -> AppResult<()> {
    // Insert new symbols only; preserve existing watermarks for already-mapped symbols.
    conn.execute(
        r#"
        insert or ignore into kline_mapping
          (trade_symbol, app_symbol, code, exchange, name, stock_type,
           last_sync_at, last_kline_date, kline_count)
        with normalized as (
          select
            d.symbol as trade_symbol,
            case
              when regexp_matches(split_part(d.symbol, '.', 1), '^[0-9]{6}$')
               and upper(split_part(d.symbol, '.', 2)) in ('SH', 'SZ', 'BJ')
                then split_part(d.symbol, '.', 1) || '.' || upper(split_part(d.symbol, '.', 2))
              when regexp_matches(split_part(d.symbol, '.', 2), '^[0-9]{6}$')
               and upper(split_part(d.symbol, '.', 1)) in ('SH', 'SZ', 'BJ')
                then split_part(d.symbol, '.', 2) || '.' || upper(split_part(d.symbol, '.', 1))
              else null
            end as app_symbol,
            case
              when regexp_matches(split_part(d.symbol, '.', 1), '^[0-9]{6}$')
                then split_part(d.symbol, '.', 1)
              when regexp_matches(split_part(d.symbol, '.', 2), '^[0-9]{6}$')
                then split_part(d.symbol, '.', 2)
              else null
            end as code,
            case
              when regexp_matches(split_part(d.symbol, '.', 1), '^[0-9]{6}$')
                then upper(split_part(d.symbol, '.', 2))
              when regexp_matches(split_part(d.symbol, '.', 2), '^[0-9]{6}$')
                then upper(split_part(d.symbol, '.', 1))
              else null
            end as exchange,
            d.name,
            d.type,
            d.is_active
          from market_db.dim_instrument d
        )
        select
          n.trade_symbol,
          n.app_symbol,
          n.code,
          n.exchange,
          coalesce(n.name, n.trade_symbol),
          coalesce(nullif(n.type, ''), 'stock'),
          current_timestamp,
          null,
          0
        from normalized n
        where n.app_symbol is not null
          and n.code is not null
          and n.exchange in ('SH', 'SZ', 'BJ')
          and coalesce(n.is_active, true)
        "#,
        [],
    )?;

    // Refresh name/type for existing mappings without touching watermarks
    conn.execute(
        r#"
        update kline_mapping
        set
          name = coalesce(d.name, kline_mapping.name),
          stock_type = coalesce(nullif(d.type, ''), kline_mapping.stock_type, 'stock')
        from market_db.dim_instrument d
        where d.symbol = kline_mapping.trade_symbol
        "#,
        [],
    )?;
    Ok(())
}

fn sync_securities(conn: &DuckConnection) -> AppResult<()> {
    conn.execute(
        r#"
        insert into securities
          (symbol, code, name, exchange, board, list_date, delist_date, status,
           industry, market_type, stock_type, market_symbol, updated_at)
        select
          m.app_symbol,
          m.code,
          coalesce(d.name, m.name, m.code),
          m.exchange,
          case
            when coalesce(d.type, m.stock_type, 'stock') = 'index' then '指数'
            when m.exchange = 'BJ' then '北交所'
            when m.code like '688%' then '科创板'
            when m.code like '300%' or m.code like '301%' then '创业板'
            else '主板'
          end,
          d.list_date,
          d.delist_date,
          case when coalesce(d.is_active, true) then 'active' else 'inactive' end,
          d.industry,
          case
            when coalesce(d.type, m.stock_type, 'stock') = 'index' then '指数'
            when m.exchange = 'BJ' then '北交所'
            when m.code like '688%' then '科创板'
            when m.code like '300%' or m.code like '301%' then '创业板'
            else '主板'
          end,
          coalesce(d.type, m.stock_type, 'stock'),
          m.trade_symbol,
          current_timestamp
        from kline_mapping m
        join market_db.dim_instrument d on d.symbol = m.trade_symbol
        on conflict(symbol) do update set
          code = excluded.code,
          name = excluded.name,
          exchange = excluded.exchange,
          board = excluded.board,
          list_date = coalesce(excluded.list_date, securities.list_date),
          delist_date = excluded.delist_date,
          status = excluded.status,
          industry = coalesce(excluded.industry, securities.industry),
          market_type = excluded.market_type,
          stock_type = excluded.stock_type,
          market_symbol = excluded.market_symbol,
          updated_at = excluded.updated_at
        "#,
        [],
    )?;
    Ok(())
}

/// Incremental: only insert rows where trade_date > last_kline_date from mapping.
/// On first sync (kline_mapping is empty or has no watermarks), falls back to full import.
/// Returns (rows_inserted, is_first_sync).
fn daily_sync_scope(conn: &DuckConnection) -> AppResult<Vec<String>> {
    let mut stmt = conn.prepare(
        r#"
        select distinct m.trade_symbol
          from kline_mapping m
          join market_db.sync_state ss
            on ss.symbol = m.trade_symbol
           and ss.adjust in ('none', 'forward')
         where ss.last_kline_date is not null
           and ss.last_kline_date > coalesce(m.last_kline_date, date '1970-01-01')
        "#,
    )?;
    let symbols = stmt
        .query_map([], |row| row.get::<_, String>(0))?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();
    tracing::info!(symbol_count = symbols.len(), "日 K 水位检查完成");
    Ok(symbols)
}

fn sync_daily_bars_incremental(
    conn: &DuckConnection,
    changed_trade_symbols: &[String],
) -> AppResult<(i64, bool)> {
    // Check if this is a first sync (no mapping watermarks)
    let has_watermarks: bool = conn
        .query_row(
            "select count(*) > 0 from kline_mapping where last_kline_date is not null",
            [],
            |row| row.get(0),
        )
        .unwrap_or(false);

    if changed_trade_symbols.is_empty() {
        tracing::info!(has_watermarks, "无新增外部水位，跳过日 K 增量同步");
        return Ok((0, false));
    }

    let placeholders = changed_trade_symbols
        .iter()
        .enumerate()
        .map(|(index, _)| format!("?{}", index + 1))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        r#"
        insert or replace into kline_bars
          (symbol, period, adj_mode, trade_date, open, high, low, close, pre_close,
           volume, amount, change, change_pct, amplitude, turnover_rate, source, updated_at)
        with source_rows as (
          select
            m.app_symbol as symbol,
            f.period,
            f.adjust as adj_mode,
            f.trade_date,
            f.open,
            f.high,
            f.low,
            f.close,
            cast(coalesce(f.volume, 0) as double) as volume,
            coalesce(f.amount, 0) as amount,
            f.turnover as turnover_rate,
            f.updated_at as source_updated_at
          from market_db.fact_kline f
          join kline_mapping m on m.trade_symbol = f.symbol
          where f.period = '1d'
            and f.adjust in ('none', 'forward')
            and f.open is not null
            and f.high is not null
            and f.low is not null
            and f.close is not null
            and f.symbol in ({})
            and f.trade_date > coalesce(m.last_kline_date, '1970-01-01')
        ),
        deduped as (
          select * exclude (rn)
          from (
            select
              *,
              row_number() over (
                partition by symbol, period, adj_mode, trade_date
                order by source_updated_at desc nulls last
              ) as rn
            from source_rows
          )
          where rn = 1
        )
        select
          symbol,
          period,
          adj_mode,
          trade_date,
          open,
          high,
          low,
          close,
          null as pre_close,
          volume,
          amount,
          null as change,
          null as change_pct,
          null as amplitude,
          turnover_rate,
          'market-sync',
          current_timestamp
        from deduped
        "#,
        placeholders
    );
    let params = changed_trade_symbols
        .iter()
        .map(|symbol| symbol as &dyn duckdb::ToSql)
        .collect::<Vec<_>>();
    let rows = conn.execute(&sql, &params[..])?;

    tracing::info!(rows, has_watermarks, "日 K 增量同步完成");
    Ok((rows as i64, !has_watermarks))
}

/// Compute derived fields only for rows with null pre_close.
/// Scopes the window function to affected symbols only, avoiding a full 32M-row scan.
fn compute_derived_fields(conn: &DuckConnection, _is_first_sync: bool) -> AppResult<()> {
    conn.execute(
        r#"
        with affected as (
          select distinct symbol, period, adj_mode
          from kline_bars
          where source = 'market-sync' and pre_close is null
        ),
        computed as (
          select
            b.symbol, b.period, b.adj_mode, b.trade_date,
            lag(b.close) over (
              partition by b.symbol, b.period, b.adj_mode
              order by b.trade_date
            ) as calc_pre_close
          from kline_bars b
          join affected a on b.symbol = a.symbol
            and b.period = a.period
            and b.adj_mode = a.adj_mode
          where b.source = 'market-sync'
        )
        update kline_bars
        set
          pre_close = c.calc_pre_close,
          change = close - c.calc_pre_close,
          change_pct = case
            when c.calc_pre_close is null or c.calc_pre_close = 0 then null
            else (close / c.calc_pre_close - 1) * 100
          end,
          amplitude = case
            when c.calc_pre_close is null or c.calc_pre_close = 0 then null
            else (high - low) / c.calc_pre_close * 100
          end,
          updated_at = current_timestamp
        from computed c
        where kline_bars.symbol = c.symbol
          and kline_bars.period = c.period
          and kline_bars.adj_mode = c.adj_mode
          and kline_bars.trade_date = c.trade_date
          and kline_bars.source = 'market-sync'
          and kline_bars.pre_close is null
        "#,
        [],
    )?;

    tracing::info!("衍生字段计算完成");
    Ok(())
}

/// Get symbols that have new (un-derived) rows since last sync — used to scope
/// aggregate recalculation to only affected symbols.
fn changed_symbols_since(conn: &DuckConnection) -> AppResult<Vec<String>> {
    let mut stmt = conn.prepare(
        "select distinct symbol from kline_bars
          where source = 'market-sync' and pre_close is null and period = '1d'",
    )?;
    let symbols: Vec<String> = stmt
        .query_map([], |row| row.get(0))?
        .filter_map(|r| r.ok())
        .collect();
    Ok(symbols)
}

fn sync_trade_calendar(conn: &DuckConnection) -> AppResult<()> {
    conn.execute(
        "insert or ignore into trade_calendar (trade_date, is_open)
         select distinct trade_date, true
           from kline_bars
          where period = '1d'
            and trade_date > coalesce(
                  (select max(trade_date) from trade_calendar), '1970-01-01'
                )",
        [],
    )?;
    Ok(())
}

/// Re-aggregate period bars only for changed symbols. On first sync (empty
/// changed_symbols list), falls back to aggregating all symbols.
fn aggregate_period_incremental(
    conn: &DuckConnection,
    period: &str,
    date_part: &str,
    changed_symbols: &[String],
) -> AppResult<i64> {
    // Delete existing aggregate rows for changed symbols before re-inserting
    if !changed_symbols.is_empty() {
        let placeholders: Vec<String> = changed_symbols
            .iter()
            .enumerate()
            .map(|(i, _)| format!("?{}", i + 1))
            .collect();
        let sql = format!(
            "delete from kline_bars where period = '{}' and symbol in ({})",
            period,
            placeholders.join(", ")
        );
        let params: Vec<&dyn duckdb::ToSql> = changed_symbols
            .iter()
            .map(|s| s as &dyn duckdb::ToSql)
            .collect();
        conn.execute(&sql, &params[..])?;
    }

    let symbol_filter = if changed_symbols.is_empty() {
        String::new()
    } else {
        let placeholders: Vec<String> = changed_symbols
            .iter()
            .enumerate()
            .map(|(i, _)| format!("?{}", i + 1))
            .collect();
        format!("and symbol in ({})", placeholders.join(", "))
    };

    let sql = format!(
        r#"
        insert or replace into kline_bars
          (symbol, period, adj_mode, trade_date, open, high, low, close, pre_close,
           volume, amount, change, change_pct, amplitude, turnover_rate, source, updated_at)
        with agg as (
          select
            symbol,
            '{}' as period,
            adj_mode,
            date_trunc('{}', trade_date)::date as trade_date,
            first(open order by trade_date asc) as open,
            max(high) as high,
            min(low) as low,
            last(close order by trade_date asc) as close,
            sum(volume) as volume,
            sum(amount) as amount,
            avg(turnover_rate) as turnover_rate
          from kline_bars
          where period = '1d'
            {}
          group by symbol, adj_mode, date_trunc('{}', trade_date)
        ),
        calc as (
          select
            *,
            lag(close) over (
              partition by symbol, adj_mode
              order by trade_date
            ) as pre_close
          from agg
        )
        select
          symbol,
          period,
          adj_mode,
          trade_date,
          open,
          high,
          low,
          close,
          pre_close,
          volume,
          amount,
          case when pre_close is null then null else close - pre_close end,
          case when pre_close is null or pre_close = 0 then null else (close / pre_close - 1) * 100 end,
          case when pre_close is null or pre_close = 0 then null else (high - low) / pre_close * 100 end,
          turnover_rate,
          'market-sync-agg',
          current_timestamp
        from calc
        "#,
        period, date_part, symbol_filter, date_part
    );

    let rows = if changed_symbols.is_empty() {
        conn.execute(&sql, [])?
    } else {
        let params: Vec<&dyn duckdb::ToSql> = changed_symbols
            .iter()
            .map(|s| s as &dyn duckdb::ToSql)
            .collect();
        conn.execute(&sql, &params[..])?
    };

    Ok(rows as i64)
}

fn update_mapping_watermarks(conn: &DuckConnection) -> AppResult<()> {
    conn.execute(
        r#"
        with symbol_stats as (
          select symbol, max(trade_date) as max_date, count(*) as cnt
            from kline_bars
           where period = '1d' and adj_mode = 'none'
           group by symbol
        ),
        global_max as (
          select max(trade_date) as date
            from kline_bars
           where period = '1d' and adj_mode = 'none'
        )
        update kline_mapping
           set last_sync_at   = current_timestamp,
               last_kline_date = coalesce(s.max_date, g.date),
               kline_count     = coalesce(s.cnt, 0)
          from symbol_stats s, global_max g
         where kline_mapping.app_symbol = s.symbol
        "#,
        [],
    )?;

    // Fill watermarks for symbols without kline data (e.g. newly listed, no trades yet)
    conn.execute(
        r#"
        update kline_mapping
           set last_sync_at   = current_timestamp,
               last_kline_date = (select max(trade_date) from kline_bars where period = '1d' and adj_mode = 'none'),
               kline_count     = 0
         where last_kline_date is null
        "#,
        [],
    )?;

    Ok(())
}

/// Write latest price / change_pct / trade_date from kline_bars into securities
/// so list queries don't need to JOIN the 32M-row kline_bars table.
fn refresh_securities_latest(conn: &DuckConnection) -> AppResult<()> {
    conn.execute(
        r#"
        update securities
        set
          latest_price  = lb.close,
          change_pct    = lb.change_pct,
          latest_date   = cast(lb.trade_date as varchar)
        from (
          select symbol, close, change_pct, trade_date
          from kline_bars
          where period = '1d' and adj_mode = 'none'
            and (symbol, trade_date) in (
              select symbol, max(trade_date)
              from kline_bars
              where period = '1d' and adj_mode = 'none'
              group by symbol
            )
        ) lb
        where securities.symbol = lb.symbol
        "#,
        [],
    )?;
    Ok(())
}

fn count_kline_rows(conn: &DuckConnection) -> AppResult<i64> {
    conn.query_row("select count(*) from kline_bars", [], |row| row.get(0))
        .map_err(Into::into)
}

fn global_coverage(conn: &DuckConnection) -> AppResult<KlineCoverage> {
    Ok(KlineCoverage {
        stock_code: "ALL".to_string(),
        daily: global_frequency_coverage(conn, "1d")?,
        weekly: global_frequency_coverage(conn, "1w")?,
        monthly: global_frequency_coverage(conn, "1M")?,
        quarterly: global_frequency_coverage(conn, "1Q")?,
        yearly: global_frequency_coverage(conn, "1Y")?,
        last_sync_at: conn
            .query_row(
                "select cast(max(finished_at) as varchar)
                   from kline_sync_runs
                  where status = 'ok' and source = 'market-sync'",
                [],
                |row| row.get::<_, Option<String>>(0),
            )
            .ok()
            .flatten(),
    })
}

fn global_frequency_coverage(
    conn: &DuckConnection,
    frequency: &str,
) -> AppResult<FrequencyCoverage> {
    conn.query_row(
        "select cast(min(trade_date) as varchar), cast(max(trade_date) as varchar), count(*)
           from kline_bars
          where period = ?1 and adj_mode = 'none'",
        duckdb::params![frequency],
        |row| {
            Ok(FrequencyCoverage {
                frequency: frequency.to_string(),
                start_date: row.get(0)?,
                end_date: row.get(1)?,
                rows: row.get(2)?,
            })
        },
    )
    .map_err(Into::into)
}

fn market_db_path() -> AppResult<PathBuf> {
    let raw = std::env::var("MARKET_DB_PATH").unwrap_or_else(|_| DEFAULT_MARKET_DB.to_string());
    Ok(expand_tilde(&raw))
}

fn expand_tilde(path: &str) -> PathBuf {
    if path == "~" {
        return home_dir().unwrap_or_else(|| PathBuf::from(path));
    }
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(path)
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

fn escape_sql_literal(value: &str) -> String {
    value.replace('\'', "''")
}

fn emit_progress(app: &tauri::AppHandle, status: &str, percent: i32, message: &str) {
    let _ = app.emit(
        "kline-sync-progress",
        serde_json::json!({
            "stockCode": "",
            "status": status,
            "percent": percent,
            "message": message,
        }),
    );
}

fn run_db_step<T>(
    conn: &DuckConnection,
    step: &str,
    f: impl FnOnce() -> AppResult<T>,
) -> AppResult<T> {
    log_memory(conn, step, "start");
    let started = Instant::now();
    let result = f();
    match &result {
        Ok(_) => tracing::info!(
            step,
            elapsed_ms = started.elapsed().as_millis(),
            "market-sync 步骤完成"
        ),
        Err(error) => tracing::warn!(
            step,
            elapsed_ms = started.elapsed().as_millis(),
            code = %error.code,
            message = %error.message,
            "market-sync 步骤失败"
        ),
    }
    log_memory(conn, step, "end");
    result
}

fn log_memory(conn: &DuckConnection, step: &str, phase: &str) {
    #[cfg(target_os = "macos")]
    if let Some(rss_mb) = process_rss_mb() {
        tracing::info!(step, phase, rss_mb, "进程内存快照");
    }
    if let Some((duckdb_memory_mb, duckdb_temp_mb)) = duckdb_memory_mb(conn) {
        tracing::info!(
            step,
            phase,
            duckdb_memory_mb,
            duckdb_temp_mb,
            "DuckDB 内存快照"
        );
    }
}

fn duckdb_memory_mb(conn: &DuckConnection) -> Option<(i64, i64)> {
    conn.query_row(
        "select
           cast(coalesce(sum(memory_usage_bytes), 0) / 1024 / 1024 as bigint),
           cast(coalesce(sum(temporary_storage_bytes), 0) / 1024 / 1024 as bigint)
         from duckdb_memory()",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .ok()
}

#[cfg(target_os = "macos")]
fn process_rss_mb() -> Option<u64> {
    let output = std::process::Command::new("ps")
        .args(["-o", "rss=", "-p", &std::process::id().to_string()])
        .output()
        .ok()?;
    let text = String::from_utf8(output.stdout).ok()?;
    let rss_kb = text.trim().parse::<u64>().ok()?;
    Some(rss_kb / 1024)
}
