# trade-system-0

Tauri 2 桌面应用，帮助用户构建个人交易系统并生成专属 AI Agent 用于复盘、选股评分和交易计划。

## 核心红线

- 交易系统 Markdown 是单一事实源（SSOT），Agent 只能按 Markdown 规则分析，不得自行补充。
- K 线必须先通过 `sync_kline` 写入本地 DuckDB，再供评分和图表只读查询。评分和图表不得隐式下载数据。
- MVP 只实现日 K、周 K、月 K，不接入分钟线、实时行情或交易执行。
- 所有设计决策以当前项目代码和 `docs/architecture.md` 为准。

## 设计规范

**方向：** 工业终端风 — 暗色、高对比、数据密度优先，每个像素都在传递信息。

**配色：**
- 背景 `#0d0d0d`（纯黑），面板 `#121212`，边框 `#2a2a2a`
- 主题色/买入/成功 `#4d90fe`（蓝），卖出/危险 `#ff6b35`（橙红），观望 `#f0b93b`（琥珀）
- CSS 变量统一定义在 `src/styles/index.css`，Tailwind 引用变量名

**字体：**
- 数据/标签/代码/输入框 → DM Mono（等宽）
- 正文/中文 → DM Sans（无衬线）
- 通过 `font-mono` / `font-sans` Tailwind class 使用，不直接写 font-family

**组件风格：**
- Badge：无边框实心色块（`bg-<color>/20 text-<color>`），小写 mono 字体
- Button：直角、hover 时边框变亮 + `shadow-glow`
- Input/Select：底部单下划线，focus 时加宽至 2px 并变色。无四边框
- Panel：`border-border bg-panel`，标题用 mono 字体
- DataTable：表头 bg-panel + mono，tbody bg-background

**动效：** 150ms transition，页面淡入，button hover glow，input/select focus 底线加宽动画

**KLineChart：** 网格线用暗灰 `#2a2a2a`/`#262626`，蜡烛图保持红涨绿跌默认

**新增模块、组件、页面必须遵守以上规范。** 设计文档见 `docs/superpowers/specs/2026-05-01-ui-redesign-design.md`。

## 项目结构

```
src/                      # React + TypeScript 前端
src-tauri/src/commands/   # Tauri command IPC 层
src-tauri/src/services/   # 业务编排层
src-tauri/src/db/         # SQLite 应用状态 + DuckDB K 线
src-tauri/src/kline/      # K 线 Provider、sample fallback、聚合
src-tauri/src/llm/        # OpenAI-compatible 客户端、Prompt、JSON guard
src-tauri/src/models/     # 数据模型
```

## 数据边界

```
sync_kline -> bars_1d -> aggregate bars_1w/bars_1M
get_bars   -> DuckDB only（只读，不触发下载）
score_stock -> coverage check -> get_bars -> LLM -> stock_reviews
```

## 开发命令

```bash
npm install && npm run tauri:dev   # 启动桌面应用
npm run typecheck                  # TypeScript 类型检查
npm test                           # 前端测试
cd src-tauri && cargo test         # Rust 测试
```

## 参考文档

- `docs/trading-system-template.md` — **交易系统模板**（SSOT），定义通用交易系统的三层13章骨架。AI Agent 据此模板引导用户填写、检测缺口、触发追问。
- `docs/reference/trend-trader/` 目录存放 trend-trader 项目的原始设计文档，**不是当前系统的设计文档**，仅供参考。该目录下的 README.md 有详细说明。
