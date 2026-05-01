# trade-system-0 MVP Architecture

本仓库设计时参考了 trend-trader 的实现文档（见 `docs/reference/trend-trader/`）。实现保留文档中的模块边界：

- `src/`：React + TypeScript + Vite 前端。
  - `pages/MyWatchlistPage.tsx` — 首页"我的自选"，三栏布局（自选列表 | K线图表 | 股票详情）。
  - `components/chart/` — K线图表、工具栏、设置面板、悬浮详情。
  - `components/watchlist/` — 自选侧栏（分组/排序/右键菜单）、股票信息面板。
- `src-tauri/src/commands/`：Tauri command IPC 层（含 `stock_meta`、`watchlist_ops` 等新命令）。
- `src-tauri/src/services/`：业务编排层。
- `src-tauri/src/db/`：SQLite、DuckDB 连接与迁移。
- `src-tauri/src/kline/`：K 线 Provider、sample fallback 与聚合。
- `src-tauri/src/llm/`：OpenAI-compatible 客户端、Prompt、JSON guard。

评分与图表读取链路严格经过本地 DuckDB：

```text
sync_kline    -> bars_1d -> aggregate bars_1w/bars_1M
get_bars      -> DuckDB only（含复权参数 adj: pre|post|none）
get_stock_meta -> securities(SQLite) + bars_1d(DuckDB) -> 最新价/涨跌/陈旧检测
score_stock   -> coverage -> get_bars summaries -> LLM -> stock_reviews
```

