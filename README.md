# trade-system-0

`trade-system-0` 是一个基于 Tauri 2、React、SQLite、DuckDB 和 KLineChart 的桌面交易系统 MVP。

核心约束：

- 交易系统 Markdown 是单一事实源。
- K 线必须先同步到本地 DuckDB，再供评分和图表只读查询。
- MVP 只实现日 K、周 K、月 K，不接入分钟线、实时行情或交易执行。
- Agent 只能基于交易系统 Markdown 与本地 K 线证据输出。

## 开发命令

```bash
npm install
npm run tauri:dev
npm run typecheck
npm test
cd src-tauri && cargo test
```

> 技术实现文档建议使用 `pnpm`。当前仓库脚本也兼容 `npm`，便于没有全局 `pnpm` 的环境直接启动。

## 本地数据目录

桌面运行时使用 Tauri app data directory，结构如下：

```text
trade-system-0-data/
├── app.sqlite
├── kline.duckdb
├── materials/
├── exports/
├── logs/
├── backup/
└── cache/provider/
```

## 已实现模块

- SQLite 应用状态库迁移。
- DuckDB K 线结构化库迁移。
- 交易系统 Markdown 版本管理、完整性检查、导出。
- 材料导入和 `.md`、`.txt`、可提取文本 PDF 解析。
- Model Provider 配置、活跃 Provider、OpenAI-compatible 调用。
- Agent 编译和测试问答。
- K 线同步入口、sample fallback、日/周/月聚合和本地只读查询。
- 单股评分编排、数据不足前置阻断、LLM JSON 输出校验。
- 自选股票池与每日复盘编排。
- KLineChart 图表、日/周/月切换、横线/射线标注保存。

