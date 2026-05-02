# trade-system-0 MVP Architecture

本仓库设计时参考了 trend-trader 的实现文档（见 `docs/reference/trend-trader/`）。实现保留文档中的模块边界：

- `src/`：React + TypeScript + Vite 前端。
  - `pages/MyWatchlistPage.tsx` — 首页"我的自选"，三栏布局（自选列表 | K线图表 | 股票详情）。
  - `components/chart/` — K线图表、工具栏、设置面板、悬浮详情。
  - `components/watchlist/` — 自选侧栏（分组/排序/右键菜单）、股票信息面板。
- `src-tauri/src/commands/`：Tauri command IPC 层（含 `stock_meta`、`watchlist_ops` 等命令）。
- `src-tauri/src/services/`：业务编排层（含 `kline_import_service` 负责 Parquet→DuckDB 导入）。
- `src-tauri/src/db/`：SQLite、DuckDB 连接与迁移。
- `src-tauri/src/llm/`：OpenAI-compatible 客户端、Prompt、JSON guard。
- `scripts/sync_kline.py`：Python 同步脚本，通过 TickFlow SDK 批量拉取 A 股+指数 K 线，输出 Parquet。

K 线数据源为 TickFlow（免费 tier `https://free-api.tickflow.org`），Python 脚本负责全量/增量同步、限流重试、进度上报。

评分与图表读取链路：

```text
sync_kline (Python 脚本) -> TickFlow HTTP API -> Parquet -> kline_bars (DuckDB)
get_bars      -> DuckDB only（含复权参数 adj: pre|post|none）
sync_securities_metadata -> eastmoney API -> securities (DuckDB, ~5000只A股)
get_stock_meta -> securities (DuckDB) + kline_bars (DuckDB) -> 最新价/涨跌/陈旧检测
score_stock   -> coverage -> get_bars summaries (1d/1w/1M/1Q/1Y) -> LLM -> stock_reviews
```

DuckDB 核心表：

| 表 | 说明 |
|------|------|
| `securities` | 标的元数据（symbol PK，code、name、exchange、board 等） |
| `kline_bars` | 统一 K 线表（symbol/period/adj_mode/trade_date 复合主键） |
| `trade_calendar` | 交易日历 |
| `kline_sync_runs` | 同步审计日志 |

支持的 K 线周期：`1d`、`1w`、`1M`、`1Q`、`1Y`。
