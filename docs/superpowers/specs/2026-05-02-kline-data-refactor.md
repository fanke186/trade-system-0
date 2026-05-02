# K线数据板块重构设计

> 从"trade-system-0 自己拉 K线" 改为"消费 market-sync 已同步好的 DuckDB 仓"。

## 1. 参与方与职责边界

```
TickFlow API（最终数据源）
    │
    │  Python SDK, cron 18:00
    ▼
market-sync（数据仓守护进程）
    │  每日盘后自动执行 sync_daily.py
    │  增量 + 轮转全量 + 聚合 + 维度维护
    │  输出: ~/.data/duckdb/market/market.duckdb
    │
    │  DuckDB ATTACH（只读）
    ▼
trade-system-0（K线消费方）
    只读取 market-sync 的 DuckDB
    不做网络请求
    不做数据拉取
```

**trade-system-0 不再关心 TickFlow**。它只知道 `market-sync` 的 DuckDB 路径。

## 2. market-sync DuckDB 速查

### 路径
```
~/.data/duckdb/market/market.duckdb
```
来源：`~/data/market-sync/config.yaml` → `duckdb.path`

### 核心表

| 表/视图 | 说明 | 关键列 |
|---------|------|--------|
| `fact_kline` | 日线事实表 | symbol(`sh.600000`/`sz.000001`), trade_date, period(`1d`), adjust(`none`/`forward`), O,H,L,C,V, amount, turnover |
| `dim_instrument` | 标的维度 | symbol, name, exchange(`sh`/`sz`/`bj`), type(`stock`/`index`), industry, list_date, is_active |
| `dim_index_common` | 指数白名单 | symbol, name, category |
| `sync_state` | 同步状态 | symbol, adjust, last_inc_sync, last_full_sync, kline_count |
| `sync_run` | 运行记录 | run_type, status, timestamps, counts |
| `v_kline_weekly` | 周线视图 | week_start, O,H,L,C,V, amount, trading_days |
| `v_kline_monthly` | 月线视图 | month_start, O,H,L,C,V, amount, trading_days |
| `v_kline_yearly` | 年线视图 | year_start, O,H,L,C,V, amount, trading_days |

### 与 trade-system-0 的字段差异

| 维度 | market-sync | trade-system-0 (当前) |
|------|------------|----------------------|
| symbol 格式 | `sh.600000` / `sz.000001` | `600000.SH` / `000001.SZ` |
| 季K线 | 无（需新增 VIEW） | 有 `1Q` |
| pre_close | 无 | 有 |
| change / change_pct | 无 | 有 |
| amplitude | 无 | 有 |
| 聚合列名 | week_start / month_start / year_start | trade_date（统一） |
| 聚合 OHLC | FIRST/LAST/MIN/MAX 语义 | 同，列名不同 |
| turnover | fact_kline.turnover | kline_bars.turnover_rate（字段名不同） |

## 3. 架构改造方案

### 3.0 总体思路：只读 ATTACH + 映射表

trade-system-0 自己的 DuckDB 增加一张**映射表** `kline_mapping`，连接 market-sync：

```
trade-system-0 kline.duckdb
├── securities          （保留，标的元数据）
├── kline_bars           （保留，物化后的统一 K 线）
├── kline_mapping        （新增：symbol 格式映射 + 同步水位）
├── trade_calendar       （保留）
├── kline_sync_runs      （保留，审计日志）
├── stock_reviews         （保留）
│
│  ATTACH '~/.data/duckdb/market/market.duckdb' AS market_db (READ_ONLY)
│
└── SQLite app.sqlite    （保留，应用状态）
```

**关键决策：物化而非视图**

不使用 VIEW 直接读 market-sync 的原因：
- 衍生字段（change/amplitude）需要排序计算，视图性能不可控
- symbol 格式需要转换，每次查询时转换浪费 CPU
- trade-system-0 的 `kline_bars` 已有 1Q 周期，market-sync 没有，需要额外聚合
- 物化后所有现有查询零改动

### 3.1 表结构变更

#### 新增 `kline_mapping` 表

```sql
CREATE TABLE kline_mapping (
    trade_symbol   VARCHAR PRIMARY KEY,   -- market-sync 的 symbol（如 'sh.600000'）
    app_symbol     VARCHAR NOT NULL,      -- trade-system-0 的 symbol（如 '600000.SH'）
    code           VARCHAR NOT NULL,      -- 纯代码 '600000'
    exchange       VARCHAR NOT NULL,      -- 'SHSE' / 'SZSE' / 'BSE'
    name           VARCHAR,               -- 标的名称
    stock_type     VARCHAR DEFAULT 'stock',
    last_sync_at   TIMESTAMP,             -- 最近同步时间
    last_kline_date DATE,                 -- market-sync 中该标的最新 K 线日期
    kline_count    INTEGER DEFAULT 0      -- market-sync 中该标的 K 线条数
);
```

用途：
- symbol 格式双向转换
- 同步水位标记（知道哪些标的需要更新）
- 替代从 `securities` 表 JOIN symbol 格式字段

#### 扩展 `securities` 表

增加 `market_symbol` 列，指向 market-sync 的 symbol：
```sql
ALTER TABLE securities ADD COLUMN market_symbol VARCHAR;
-- 例：trade_symbol='600000.SH' → market_symbol='sh.600000'
```

#### 移除

不再需要的表和模块：
- ~~`bars_1d` / `bars_1w` / `bars_1M` 旧表~~（已是历史遗留，逐步清理）
- ~~`csv_import_service.rs`~~ 整个模块
- ~~`sync_kline` command~~ 改为 `refresh_from_market`
- ~~`scripts/sync_kline.py`~~ 不再调用

### 3.2 数据流

```
market-sync cron (18:00 每日)
    │
    │ 写入 fact_kline / dim_instrument / sync_state
    ▼
~/.data/duckdb/market/market.duckdb
    │
    │ 用户点击"一键补齐"
    ▼
trade-system-0: refresh_from_market()
    │
    │ 1. ATTACH market-sync DuckDB (READ_ONLY)
    │ 2. 同步映射表: dim_instrument → kline_mapping (symbol 格式转换)
    │ 3. 同步标的元数据: dim_instrument → securities (UPSERT)
    │ 4. 同步日 K: fact_kline → kline_bars (计算 pre_close/change/amplitude)
    │ 5. 聚合周/月/季/年 K: kline_bars(1d) → kline_bars(1w/1M/1Q/1Y)
    │ 6. 写入 kline_sync_runs 审计记录
    │ 7. DETACH market-sync
    │
    ▼
kline.duckdb (trade-system-0)
    │
    ├── kline_bars (1d/1w/1M/1Q/1Y, none/forward)
    ├── securities (含 market_symbol)
    ├── kline_mapping (映射+水位)
    └── kline_sync_runs (审计)
```

### 3.3 一键补齐 `refresh_from_market` 详细流程

```
refresh_from_market()
│
├─ 阶段1: ATTACH
│   ATTACH '{market_duckdb_path}' AS market_db (READ_ONLY)
│   进度: 10%
│
├─ 阶段2: 更新映射表
│   INSERT INTO kline_mapping (trade_symbol, app_symbol, code, exchange, name, stock_type)
│   SELECT
│     dim.symbol,
│     CASE WHEN dim.exchange='sh' THEN dim.code || '.SH'
│          WHEN dim.exchange='sz' THEN dim.code || '.SZ'
│          WHEN dim.exchange='bj' THEN dim.code || '.BJ' END,
│     regexp_extract(dim.symbol, '\.(\d+)', 1),
│     CASE dim.exchange WHEN 'sh' THEN 'SHSE' WHEN 'sz' THEN 'SZSE' WHEN 'bj' THEN 'BSE' END,
│     dim.name,
│     dim.type
│   FROM market_db.dim_instrument dim
│   WHERE dim.is_active = TRUE
│   ON CONFLICT(trade_symbol) DO UPDATE SET name=..., last_sync_at=NOW()
│   进度: 20%
│
├─ 阶段3: 同步 securities 元数据
│   INSERT INTO securities (...)
│   SELECT ... FROM kline_mapping m
│   LEFT JOIN market_db.dim_instrument d ON d.symbol = m.trade_symbol
│   ON CONFLICT(symbol) DO UPDATE SET name=..., market_symbol=..., updated_at=NOW()
│   进度: 30%
│
├─ 阶段4: 同步日线数据（核心，带衍生字段计算）
│   -- 使用窗口函数计算 pre_close / change / change_pct / amplitude
│   INSERT OR REPLACE INTO kline_bars
│     (symbol, period, adj_mode, trade_date, open, high, low, close,
│      pre_close, volume, amount, change, change_pct, amplitude,
│      turnover_rate, source, updated_at)
│   SELECT
│     m.app_symbol,
│     f.period,           -- '1d'
│     f.adjust,            -- 'none' / 'forward'
│     f.trade_date,
│     f.open, f.high, f.low, f.close,
│     LAG(f.close) OVER (PARTITION BY m.app_symbol, f.adjust ORDER BY f.trade_date) AS pre_close,
│     f.volume, f.amount,
│     f.close - LAG(f.close) OVER (PARTITION BY m.app_symbol, f.adjust ORDER BY f.trade_date) AS change,
│     CASE WHEN LAG(f.close) OVER (...) != 0
│          THEN (f.close / LAG(f.close) OVER (...) - 1) * 100 END AS change_pct,
│     CASE WHEN LAG(f.close) OVER (...) != 0
│          THEN (f.high - f.low) / LAG(f.close) OVER (...) * 100 END AS amplitude,
│     f.turnover AS turnover_rate,
│     'market-sync',
│     NOW()
│   FROM market_db.fact_kline f
│   JOIN kline_mapping m ON m.trade_symbol = f.symbol AND m.last_kline_date < f.trade_date  -- 只取增量
│   WHERE f.period = '1d'
│   进度: 30% → 60%
│
├─ 阶段5: 更新映射水位
│   UPDATE kline_mapping m
│   SET last_kline_date = (SELECT MAX(trade_date) FROM kline_bars b WHERE b.symbol = m.app_symbol),
│       last_sync_at = NOW(),
│       kline_count = (SELECT COUNT(*) FROM kline_bars b WHERE b.symbol = m.app_symbol)
│   进度: 70%
│
├─ 阶段6: 聚合周/月/季/年 K 线
│   -- 1w: 从 1d 聚合
│   INSERT OR REPLACE INTO kline_bars (symbol, period, adj_mode, trade_date, open, high, low, close, volume, amount, source, updated_at)
│   SELECT
│     symbol, '1w', adj_mode,
│     DATE_TRUNC('week', trade_date)::DATE,
│     FIRST(open ORDER BY trade_date), MAX(high), MIN(low), LAST(close ORDER BY trade_date),
│     SUM(volume), SUM(amount), 'market-sync-agg', NOW()
│   FROM kline_bars WHERE period = '1d'
│   GROUP BY symbol, adj_mode, DATE_TRUNC('week', trade_date)
│
│   -- 1M / 1Q / 1Y 同理，用 DATE_TRUNC('month'/'quarter'/'year', ...)
│   进度: 70% → 90%
│
├─ 阶段7: 审计记录 + DETACH
│   INSERT INTO kline_sync_runs (status='ok', source='market-sync', ...)
│   DETACH market_db
│   进度: 100%
```

### 3.4 删除清单

| 删除项 | 原因 |
|--------|------|
| `src-tauri/src/services/csv_import_service.rs` | CSV 导入不再需要 |
| `src-tauri/src/services/kline_sync_service.rs` | Python 脚本编排不再需要（仅保留 `find_python`/`find_script` 如需留存备用则不动） |
| `src-tauri/src/services/kline_import_service.rs` | Parquet 导入不再需要 |
| `src-tauri/src/commands/kline.rs` 中的 `sync_kline` | 改为 `refresh_from_market` |
| `scripts/sync_kline.py` | 不再被调用 |
| 前端 `CSV 导入` 按钮 | 删除 |
| 前端证券检索 `同步` 按钮（单只） | 删除 |
| `src/lib/commands.ts` 中 `syncKline` / `importCsvData` | 改为 `refreshFromMarket` |
| `src-tauri/Cargo.toml` 中 `csv` 依赖 | 如需删除csv_import_service则一并删除 |

### 3.5 新增清单

| 新增项 | 说明 |
|--------|------|
| `src-tauri/src/services/market_sync_service.rs` | 新服务：ATTACH market-sync DuckDB → 映射 → 物化到 kline_bars |
| `commands/kline.rs` 中 `refresh_from_market` | 新命令：触发市场数据刷新 |
| `kline_mapping` 表 | DuckDB migration 新增 |
| `securities.market_symbol` 列 | DuckDB migration 新增 |
| 前端 `KlineDataPage` 按钮逻辑 | "一键补齐"改为调用 `refreshFromMarket`，按钮显示进度 |
| 前端证券检索增强 | 模糊搜索(代码+名称)、全列排序、多选+右键菜单 |

## 4. 前端交互改造

### 4.1 数据集市页 (KlineDataPage)

**DataHealthBanner（顶部横幅）：**
```
┌──────────────────────────────────────────────────────────────┐
│ 😊 数据齐整度 · 95.2% · 良好                                   │
│ 共 5,130 只标的 · 4,880 只齐全 · 250 只待同步                    │
│ 上次同步: market-sync 2026-05-02 18:05                          │
│                                        [🔄 一键补齐]           │
└──────────────────────────────────────────────────────────────┘
```
- "一键补齐" 调用 `refreshFromMarket()`，按钮显示 `同步中 45%`

### 4.2 证券检索 (search_securities)

**搜索框增强：**
```
┌─────────────────────────────────────────────┐
│ 🔍 [  输入代码或名称...                  ] │
└─────────────────────────────────────────────┘
```
- 模糊搜索同时匹配 `code` 和 `name`

**表格增强：**
```
┌──────────┬──────────┬──────────┬──────────┬──────────┐
│ 代码  ▲▼ │ 名称  ▲▼ │ 交易所▲▼ │ 行业  ▲▼ │ 状态  ▲▼ │
├──────────┼──────────┼──────────┼──────────┼──────────┤
│ ☐ 600000│ 浦发银行  │ SHSE     │ 银行     │ active   │
│ ☐ 000001│ 平安银行  │ SZSE     │ 银行     │ active   │
│ ☐ 002261│ 拓维信息  │ SZSE     │ 计算机   │ active   │
└──────────┴──────────┴──────────┴──────────┴──────────┘
```
- 所有列头可点击切换升序/降序（默认按 code 升序）
- 每行最前面有 checkbox 支持多选
- 右键菜单：
  ```
  ┌─────────────────────┐
  │ 添加到分组  ▸       │  ← 二级菜单：分组列表
  │ 添加到交易系统 ▸    │  ← 二级菜单：交易系统列表
  └─────────────────────┘
  ```

**删除：**
- 每行不再有"同步"按钮

## 5. DuckDB Migration

```sql
-- Migration V3: market-sync 集成

-- 新增映射表
CREATE TABLE IF NOT EXISTS kline_mapping (
    trade_symbol   VARCHAR PRIMARY KEY,
    app_symbol     VARCHAR NOT NULL,
    code           VARCHAR NOT NULL,
    exchange       VARCHAR NOT NULL,
    name           VARCHAR,
    stock_type     VARCHAR DEFAULT 'stock',
    last_sync_at   TIMESTAMP,
    last_kline_date DATE,
    kline_count    INTEGER DEFAULT 0
);

-- securities 增加 market_symbol 列
ALTER TABLE securities ADD COLUMN IF NOT EXISTS market_symbol VARCHAR;

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_kline_mapping_app ON kline_mapping(app_symbol);
CREATE INDEX IF NOT EXISTS idx_securities_market_sym ON securities(market_symbol);
```

## 6. 配置

在 `src-tauri/src/services/market_sync_service.rs` 中，market-sync DuckDB 路径通过环境变量读取，带默认值：

```rust
const DEFAULT_MARKET_DB: &str = "~/.data/duckdb/market/market.duckdb";

fn market_db_path() -> PathBuf {
    std::env::var("MARKET_DB_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| shellexpand::tilde(DEFAULT_MARKET_DB).into_owned().into())
}
```

如需支持 `~` 展开，添加 `shellexpand` 依赖，或用 `dirs::home_dir()` 手动展开。

## 7. 数据齐整度计算（更新）

原有齐整度依赖 trade-system-0 自己的 `kline_bars` 和 `sync_state`。改造后：

```sql
-- 总标的数
SELECT COUNT(*) FROM securities WHERE stock_type='stock' AND status='active';

-- 齐全标的数（最新 trade_date = market-sync 中全市场最新 trade_date）
SELECT COUNT(DISTINCT km.app_symbol)
FROM kline_mapping km
WHERE km.last_kline_date = (
    SELECT MAX(last_kline_date) FROM kline_mapping WHERE stock_type = 'stock'
);
```

直接从 `kline_mapping` 的水位判断齐整度，不需要 JOIN market-sync。

## 8. 迁移步骤

| 步骤 | 内容 | 风险 |
|------|------|------|
| 1 | 添加 `csv` crate 依赖（如果还没删的话留着，后面再清） | 低 |
| 2 | DuckDB migration：创建 `kline_mapping` + `securities.market_symbol` | 低 |
| 3 | 实现 `market_sync_service.rs` | 中 |
| 4 | 添加 `refresh_from_market` 命令并注册 | 低 |
| 5 | 更新前端：修改"一键补齐"调用 | 低 |
| 6 | 更新前端：证券检索增强（模糊搜索+排序+多选+右键） | 中 |
| 7 | 删除 `csv_import_service.rs`、`csv_import` 命令、CSV 按钮 | 低 |
| 8 | 删除 Python 脚本调用链路（`sync_kline` 命令、`kline_sync_service`、`kline_import_service`） | 中 |
| 9 | 删除 `sync_kline.py` 不再引用的路径 | 低 |
| 10 | 清理 `Cargo.toml` 无用依赖（`csv` 等） | 低 |
| 11 | 端到端测试：启动 → 一键补齐 → K线图表 → 评分 | 高 |
