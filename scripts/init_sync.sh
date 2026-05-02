#!/usr/bin/env bash
#
# init_sync.sh — 初次同步：从 market-sync DuckDB 灌入 trade-system-0 DuckDB
#
# 用法:
#   chmod +x scripts/init_sync.sh
#   ./scripts/init_sync.sh
#
# 环境变量（可选）:
#   APP_DB     trade-system-0 kline.duckdb 路径（默认自动检测）
#   MARKET_DB  market-sync market.duckdb 路径（默认 ~/.data/duckdb/market/market.duckdb）
#
set -euo pipefail

APP_DB="${APP_DB:-}"
MARKET_DB="${MARKET_DB:-$HOME/.data/duckdb/market/market.duckdb}"

# ── 自动检测 app duckdb 路径 ──────────────────────────────
if [[ -z "$APP_DB" ]]; then
  # Tauri dev 模式: 项目根下的 trade-system-0-data/kline.duckdb
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
  CANDIDATES=(
    "$PROJECT_ROOT/trade-system-0-data/kline.duckdb"
    "$HOME/Library/Application Support/com.local.tradesystem0/kline.duckdb"
  )
  for candidate in "${CANDIDATES[@]}"; do
    if [[ -f "$candidate" ]]; then
      APP_DB="$candidate"
      break
    fi
  done
  # 如果都不存在，用第一个作为默认（首次初始化）
  if [[ -z "$APP_DB" ]]; then
    APP_DB="${CANDIDATES[0]}"
    mkdir -p "$(dirname "$APP_DB")"
  fi
fi

# ── 颜色 ─────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

ok()   { echo -e "${GREEN}  ✓${RESET} $*"; }
step() { echo -e "\n${BOLD}${CYAN}▸${RESET} ${BOLD}$*${RESET}"; }
info() { echo -e "  ${DIM}$*${RESET}"; }
err()  { echo -e "${RED}  ✗ $*${RESET}" >&2; }

elapsed_since() {
  local start=$1
  local now
  now=$(date +%s)
  echo $((now - start))
}

# ── 前置检查 ─────────────────────────────────────────────
echo ""
echo -e "${BOLD}══════════════════════════════════════════════════${RESET}"
echo -e "${BOLD}  trade-system-0 · 初次同步${RESET}"
echo -e "${BOLD}══════════════════════════════════════════════════${RESET}"
echo ""

START_TIME=$(date +%s)

if ! command -v duckdb &>/dev/null; then
  err "未找到 duckdb CLI，请先安装: brew install duckdb"
  exit 1
fi

if [[ ! -f "$MARKET_DB" ]]; then
  err "market-sync DuckDB 不存在: $MARKET_DB"
  info "请确保 market-sync 已运行过至少一次 sync_daily.py"
  exit 1
fi

info "APP_DB    = $APP_DB"
info "MARKET_DB = $MARKET_DB"
info "duckdb    = $(duckdb --version)"

# ── 1. 确保 app DB 有基础表结构 ──────────────────────────
step "1/8 检查表结构"
if ! duckdb -c "select count(*) from kline_mapping" "$APP_DB" &>/dev/null; then
  info "kline_mapping 表不存在，正在创建..."
  duckdb "$APP_DB" <<'SQL'
    create table if not exists kline_mapping (
        trade_symbol    varchar primary key,
        app_symbol      varchar not null,
        code            varchar not null,
        exchange        varchar not null,
        name            varchar,
        stock_type      varchar default 'stock',
        last_sync_at    timestamp,
        last_kline_date date,
        kline_count     integer default 0
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
    create table if not exists trade_calendar (
        trade_date date primary key,
        is_open boolean not null
    );
    create table if not exists kline_sync_runs (
        id text primary key,
        stock_code text,
        mode text,
        status text,
        started_at timestamp,
        finished_at timestamp,
        rows_written bigint,
        source text,
        error text
    );
SQL
  ok "表结构已创建"
else
  ok "表结构已存在"
fi

# ── 2. 同步映射表 ────────────────────────────────────────
step "2/8 同步标的映射"
duckdb "$APP_DB" <<SQL
attach '${MARKET_DB}' as market_db (read_only);

insert or replace into kline_mapping
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
  n.trade_symbol, n.app_symbol, n.code, n.exchange,
  coalesce(n.name, n.trade_symbol),
  coalesce(nullif(n.type, ''), 'stock'),
  current_timestamp,
  ss.last_kline_date,
  coalesce(ss.kline_count, 0)
from normalized n
left join market_db.sync_state ss
  on ss.symbol = n.trade_symbol and ss.adjust = 'none'
where n.app_symbol is not null
  and n.code is not null
  and n.exchange in ('SH', 'SZ', 'BJ')
  and coalesce(n.is_active, true);

detach market_db;
SQL

MAPPING_COUNT=$(duckdb -csv -noheader -c "select count(*) from kline_mapping" "$APP_DB")
ok "映射完成，共 ${MAPPING_COUNT} 只标的"
info "耗时 $(elapsed_since $START_TIME)s"

# ── 3. 同步证券元数据 ────────────────────────────────────
step "3/8 同步证券元数据 (dim_instrument → securities)"
D1=$(date +%s)

duckdb "$APP_DB" <<SQL
attach '${MARKET_DB}' as market_db (read_only);

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
  updated_at = excluded.updated_at;

detach market_db;
SQL

SEC_COUNT=$(duckdb -csv -noheader -c "select count(*) from securities where status = 'active'" "$APP_DB")
D2=$(date +%s)
ok "证券元数据完成，共 ${SEC_COUNT} 只活跃标的"
info "耗时 $((D2 - D1))s"

# ── 4. 同步日 K ──────────────────────────────────────────
step "4/8 同步日 K 线 (fact_kline → kline_bars)"
info "首次同步需导入全量历史数据，可能需要几分钟..."

PRE_COUNT=$(duckdb -csv -noheader -c "select count(*) from kline_bars" "$APP_DB")
D1=$(date +%s)

duckdb "$APP_DB" <<SQL
attach '${MARKET_DB}' as market_db (read_only);

insert or replace into kline_bars
  (symbol, period, adj_mode, trade_date, open, high, low, close, pre_close,
   volume, amount, change, change_pct, amplitude, turnover_rate, source, updated_at)
with source_rows as (
  select
    m.app_symbol as symbol,
    f.period,
    f.adjust as adj_mode,
    f.trade_date,
    f.open, f.high, f.low, f.close,
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
    and f.trade_date > coalesce(m.last_kline_date, '1970-01-01')
),
deduped as (
  select * exclude (rn)
  from (
    select *, row_number() over (
      partition by symbol, period, adj_mode, trade_date
      order by source_updated_at desc nulls last
    ) as rn
    from source_rows
  )
  where rn = 1
)
select
  symbol, period, adj_mode, trade_date,
  open, high, low, close, null as pre_close,
  volume, amount, null as change, null as change_pct, null as amplitude,
  turnover_rate, 'market-sync', current_timestamp
from deduped;

detach market_db;
SQL

POST_COUNT=$(duckdb -csv -noheader -c "select count(*) from kline_bars" "$APP_DB")
DAILY_NEW=$((POST_COUNT - PRE_COUNT))
D2=$(date +%s)
ok "日 K 完成，新增 ${DAILY_NEW} 行（共 ${POST_COUNT} 行）"
info "耗时 $((D2 - D1))s"

# ── 4. 计算衍生字段 ──────────────────────────────────────
step "5/8 计算衍生字段 (pre_close/change/amplitude)"
D1=$(date +%s)

duckdb "$APP_DB" <<'SQL'
with computed as (
  select
    symbol, period, adj_mode, trade_date,
    lag(close) over (
      partition by symbol, period, adj_mode
      order by trade_date
    ) as calc_pre_close
  from kline_bars
  where source = 'market-sync'
)
update kline_bars
set
  pre_close   = c.calc_pre_close,
  change      = close - c.calc_pre_close,
  change_pct  = case
    when c.calc_pre_close is null or c.calc_pre_close = 0 then null
    else (close / c.calc_pre_close - 1) * 100
  end,
  amplitude   = case
    when c.calc_pre_close is null or c.calc_pre_close = 0 then null
    else (high - low) / c.calc_pre_close * 100
  end,
  updated_at  = current_timestamp
from computed c
where kline_bars.symbol    = c.symbol
  and kline_bars.period    = c.period
  and kline_bars.adj_mode  = c.adj_mode
  and kline_bars.trade_date = c.trade_date
  and kline_bars.source    = 'market-sync'
  and kline_bars.pre_close is null;
SQL

D2=$(date +%s)
ok "衍生字段计算完成"
info "耗时 $((D2 - D1))s"

# ── 5. 聚合周/月/季/年 K ─────────────────────────────────
step "6/8 聚合周/月/季/年 K 线"

for period_info in "1w:week" "1M:month" "1Q:quarter" "1Y:year"; do
  PERIOD="${period_info%%:*}"
  PART="${period_info##*:}"
  D1=$(date +%s)

  duckdb "$APP_DB" <<SQL
insert or replace into kline_bars
  (symbol, period, adj_mode, trade_date, open, high, low, close, pre_close,
   volume, amount, change, change_pct, amplitude, turnover_rate, source, updated_at)
with agg as (
  select
    symbol, '${PERIOD}' as period, adj_mode,
    date_trunc('${PART}', trade_date)::date as trade_date,
    first(open order by trade_date asc) as open,
    max(high) as high,
    min(low) as low,
    last(close order by trade_date asc) as close,
    sum(volume) as volume,
    sum(amount) as amount,
    avg(turnover_rate) as turnover_rate
  from kline_bars
  where period = '1d'
  group by symbol, adj_mode, date_trunc('${PART}', trade_date)
),
calc as (
  select *, lag(close) over (
    partition by symbol, adj_mode order by trade_date
  ) as pre_close
  from agg
)
select
  symbol, period, adj_mode, trade_date,
  open, high, low, close, pre_close, volume, amount,
  case when pre_close is null then null else close - pre_close end,
  case when pre_close is null or pre_close = 0 then null else (close / pre_close - 1) * 100 end,
  case when pre_close is null or pre_close = 0 then null else (high - low) / pre_close * 100 end,
  turnover_rate, 'market-sync-agg', current_timestamp
from calc;
SQL

  COUNT=$(duckdb -csv -noheader -c "select count(*) from kline_bars where period = '${PERIOD}'" "$APP_DB")
  D2=$(date +%s)
  ok "  ${PERIOD}  · ${COUNT} 行 · $((D2 - D1))s"
done

# ── 6. 交易日历 ──────────────────────────────────────────
step "7/8 同步交易日历"
duckdb "$APP_DB" <<'SQL'
insert or ignore into trade_calendar (trade_date, is_open)
select distinct trade_date, true
  from kline_bars
 where period = '1d'
   and trade_date > coalesce((select max(trade_date) from trade_calendar), '1970-01-01');
SQL

CAL_COUNT=$(duckdb -csv -noheader -c "select count(*) from trade_calendar" "$APP_DB")
ok "交易日历完成，共 ${CAL_COUNT} 天"

# ── 7. 回写最新价到 securities ──────────────────────────
step "7/8 回写标的最新价到 securities"
D1=$(date +%s)

duckdb "$APP_DB" <<'SQL'
update securities
set
  latest_price = lb.close,
  change_pct   = lb.change_pct,
  latest_date  = cast(lb.trade_date as varchar)
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
where securities.symbol = lb.symbol;
SQL

D2=$(date +%s)
ok "最新价回写完成"
info "耗时 $((D2 - D1))s"

# ── 8. 更新水位 + 审计记录 ───────────────────────────────
step "8/8 更新同步水位与审计记录"

TOTAL=$(duckdb -csv -noheader -c "select count(*) from kline_bars" "$APP_DB")

duckdb "$APP_DB" <<SQL
update kline_mapping
set last_sync_at    = current_timestamp,
    last_kline_date = coalesce((
      select max(trade_date) from kline_bars b
       where b.symbol = kline_mapping.app_symbol
         and b.period = '1d' and b.adj_mode = 'none'
    ), (select max(trade_date) from kline_bars where period = '1d' and adj_mode = 'none')),
    kline_count = coalesce((
      select count(*) from kline_bars b
       where b.symbol = kline_mapping.app_symbol
         and b.period = '1d' and b.adj_mode = 'none'
    ), 0);

insert into kline_sync_runs (id, stock_code, mode, status, started_at, finished_at, rows_written, source)
values ('ksr-init-' || strftime(current_timestamp, '%Y%m%d%H%M%S'), 'ALL', 'refresh', 'ok',
        current_timestamp, current_timestamp, ${TOTAL}, 'init-script');
SQL

ok "水位与审计记录已更新"
info "耗时 $(elapsed_since $START_TIME)s"

# ── 完成 ─────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}══════════════════════════════════════════════════${RESET}"
echo -e "${GREEN}${BOLD}  初次同步完成${RESET}"
echo -e "${GREEN}${BOLD}══════════════════════════════════════════════════${RESET}"
echo ""
echo -e "  总 K 线条数:  ${BOLD}${TOTAL}${RESET}"
echo -e "  标的总数:    ${BOLD}${MAPPING_COUNT}${RESET}"
echo -e "  总耗时:      ${BOLD}$(elapsed_since $START_TIME)s${RESET}"
echo -e "  应用 DB:     ${DIM}${APP_DB}${RESET}"
echo ""
echo -e "  ${DIM}后续增量同步可在应用中点击"一键补齐"完成。${RESET}"
echo ""
