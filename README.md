# trade-system-0

`trade-system-0` 是一个基于 Tauri 2、React、SQLite、DuckDB 和 KLineChart 的桌面交易系统 MVP。

核心约束：

- 交易系统 Markdown 是单一事实源。
- K 线必须先同步到本地 DuckDB，再供评分和图表只读查询。
- 支持日 K、周 K、月 K、季 K、年 K（1d/1w/1M/1Q/1Y），不接入分钟线、实时行情或交易执行。
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
- 交易系统Agents：三栏布局管理交易系统与关联标的，Chatbot 编辑窗口。
- K 线同步（market-sync 自动仓 + refresh_from_market 一键补齐）、多周期本地只读查询。
- 单股评分编排、数据不足前置阻断、LLM JSON 输出校验。
- 我的自选（首页）：合并自选池与 K 线图表，三栏布局，含分组管理、排序、右键菜单、MA 均线(5/10/20/30)、对数坐标、复权、画线(横线/射线)吸附+局部放大+改色+撤销+删除、按symbol+period持久化、十字光标详情、自定义标题栏窗口控制。
- AI 评分：三种触发模式（交易系统agent/单只标的/自选分组），评分历史记录与 HTML 报告。
- 全市场元数据同步：从 market-sync DuckDB 读取标的维度信息。
- 证券检索：代码/名称模糊搜索，全列升降序排序，多选右键菜单（添加到分组/交易系统）。

## 关键文档

| 文档 | 说明 |
|------|------|
| `docs/architecture.md` | 系统架构与模块边界 |
| `docs/trading-system-template.md` | 通用交易系统模板（三层13章骨架），AI Agent 据此引导用户构建交易系统 |
| `docs/reference/trend-trader/` | trend-trader 参考文档（只读，非当前系统设计） |
| `~/.claude/agents/` | 211 个 AI 专家角色（agency-agents-zh） |
| `docs/superpowers/specs/2026-05-02-kline-data-refactor.md` | K线数据板块重构设计文档 |

