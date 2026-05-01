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
- 我的自选（首页）：合并自选池与 K 线图表，三栏布局，含分组管理、排序、右键菜单、MA 均线、对数坐标、复权、画线吸附、十字光标详情。
- 每日复盘编排：批量跑自选分组中所有股票的评分。
- 全 A 股元数据同步：启动时异步拉取 ~5000 只标的元信息（代码/名称/行业等）。

## 关键文档

| 文档 | 说明 |
|------|------|
| `docs/architecture.md` | 系统架构与模块边界 |
| `docs/trading-system-template.md` | 通用交易系统模板（三层13章骨架），AI Agent 据此引导用户构建交易系统 |
| `docs/reference/trend-trader/` | trend-trader 参考文档（只读，非当前系统设计） |
| `.claude/skills/` | 项目级 Claude Code 自定义 skill |

