# trade-system-0 MVP Architecture

本仓库设计时参考了 trend-trader 的实现文档（见 `docs/reference/trend-trader/`）。实现保留文档中的模块边界：

- `src/`：React + TypeScript + Vite 前端。
- `src-tauri/src/commands/`：Tauri command IPC 层。
- `src-tauri/src/services/`：业务编排层。
- `src-tauri/src/db/`：SQLite、DuckDB 连接与迁移。
- `src-tauri/src/kline/`：K 线 Provider、sample fallback 与聚合。
- `src-tauri/src/llm/`：OpenAI-compatible 客户端、Prompt、JSON guard。

评分与图表读取链路严格经过本地 DuckDB：

```text
sync_kline -> bars_1d -> aggregate bars_1w/bars_1M
get_bars   -> DuckDB only
score_stock -> coverage -> get_bars summaries -> LLM -> stock_reviews
```

