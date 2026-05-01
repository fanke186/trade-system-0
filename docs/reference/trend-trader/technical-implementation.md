# 《从零构架交易系统》技术实现文档

> 产品代号: `trade-system-0`  
> 版本: 0.1  
> 日期: 2026-05-01  
> 状态: MVP 技术方案初稿  
> 上游需求: [docs/prd.md](./prd.md)

## 1. 技术目标

本方案用于落地 `trade-system-0` MVP。实现重点是把“交易系统 Markdown”作为单一事实源，围绕它构建专属 Agent、股票评分、K 线本地结构化数据和 KLineChart 图表能力。

关键工程约束：

- 产品形态是可直接打开的桌面应用，不是网页站点。
- K 线数据必须先同步到本地结构化库，评分和图表只读本地库。
- MVP 只实现裸 K / 趋势交易需要的日 K、周 K、月 K，不接入分钟线、实时行情和交易执行。
- Agent 只能基于交易系统 Markdown 和本地 K 线证据输出，不得自由扩展规则。

## 2. 总体架构

### 2.1 技术栈

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 桌面壳 | Tauri 2 | 直接安装打开，跨平台，前端通过 IPC 调用本地能力 |
| 前端 | React + TypeScript + Vite | 页面、表格、编辑器、图表和交互状态 |
| 前端数据 | TanStack Query | 管理 Tauri command 调用、缓存、刷新和 loading 状态 |
| UI 风格 | Tailwind CSS + shadcn/ui 风格组件 | 接近 cc-switch 的工具型桌面应用风格 |
| 图表 | KLineChart | K 线渲染、缩放、悬停、overlay 画线 |
| 本地应用库 | SQLite | 交易系统、Agent、Provider、自选池、评分记录、标注 |
| K 线库 | DuckDB | 结构化保存日/周/月 K，后续可扩展 Parquet 分区 |
| 后端命令层 | Rust Tauri Commands | 文件、数据库、模型调用、K 线同步、评分编排 |
| LLM Provider | DeepSeek、OpenAI / ChatGPT | 通过 OpenAI-compatible 客户端统一调用 |

### 2.2 进程与数据流

```text
React UI
  |
  | invoke("command", payload)
  v
Tauri Commands
  |
  +--> App SQLite: trade systems / agents / providers / reviews / annotations
  |
  +--> DuckDB Kline DB: securities / trade_calendar / bars_1d / bars_1w / bars_1M
  |
  +--> File Storage: uploaded materials / exported Markdown / logs
  |
  +--> LLM Providers: DeepSeek / OpenAI-compatible
  |
  +--> Kline Providers: configurable public data providers / sample fallback
```

### 2.3 本地目录

使用 Tauri 的 app data directory，不硬编码用户目录。

```text
trade-system-0-data/
├── app.sqlite                 # 应用状态库
├── kline.duckdb               # K 线结构化库
├── materials/                 # 上传材料原始文件
├── exports/                   # 导出的交易系统 Markdown
├── logs/                      # 本地日志
└── cache/
    └── provider/              # 数据源临时缓存
```

## 3. 推荐工程结构

```text
trade-system-0/
├── src/                       # React 前端
│   ├── app/
│   │   ├── App.tsx
│   │   ├── routes.tsx
│   │   └── queryClient.ts
│   ├── pages/
│   │   ├── DailyReviewPage.tsx
│   │   ├── TradeSystemPage.tsx
│   │   ├── AgentPage.tsx
│   │   ├── StockReviewPage.tsx
│   │   ├── ChartPage.tsx
│   │   ├── WatchlistPage.tsx
│   │   ├── DataPage.tsx
│   │   └── SettingsPage.tsx
│   ├── components/
│   │   ├── layout/
│   │   ├── trade-system/
│   │   ├── chart/
│   │   ├── watchlist/
│   │   └── shared/
│   ├── lib/
│   │   ├── commands.ts        # Tauri command wrappers
│   │   ├── types.ts
│   │   └── format.ts
│   └── styles/
│
├── src-tauri/
│   ├── src/
│   │   ├── main.rs
│   │   ├── commands/
│   │   │   ├── trade_system.rs
│   │   │   ├── agent.rs
│   │   │   ├── kline.rs
│   │   │   ├── review.rs
│   │   │   ├── watchlist.rs
│   │   │   ├── provider.rs
│   │   │   └── annotation.rs
│   │   ├── services/
│   │   │   ├── trade_system_service.rs
│   │   │   ├── agent_service.rs
│   │   │   ├── kline_sync_service.rs
│   │   │   ├── kline_query_service.rs
│   │   │   ├── review_service.rs
│   │   │   ├── watchlist_service.rs
│   │   │   ├── material_service.rs
│   │   │   └── model_provider_service.rs
│   │   ├── db/
│   │   │   ├── sqlite.rs
│   │   │   ├── duckdb.rs
│   │   │   ├── migrations.rs
│   │   │   └── schema/
│   │   ├── llm/
│   │   │   ├── client.rs
│   │   │   ├── prompts.rs
│   │   │   └── json_guard.rs
│   │   ├── kline/
│   │   │   ├── provider.rs
│   │   │   ├── aggregate.rs
│   │   │   └── sample.rs
│   │   └── models/
│   └── tauri.conf.json
└── docs/
```

## 4. 数据库设计

### 4.1 SQLite: 应用状态库

SQLite 保存用户可编辑状态和业务记录。字段中较易变化的结构使用 JSON 字段，避免 MVP 阶段频繁迁移。

```sql
create table trade_systems (
  id text primary key,
  name text not null,
  description text,
  active_version_id text,
  created_at text not null,
  updated_at text not null
);

create table trade_system_versions (
  id text primary key,
  trade_system_id text not null references trade_systems(id),
  version integer not null,
  markdown text not null,
  content_hash text not null,
  completeness_status text not null,
  completeness_report_json text not null,
  change_summary text,
  created_at text not null,
  unique(trade_system_id, version)
);

create table model_providers (
  id text primary key,
  name text not null,
  provider_type text not null,       -- deepseek | openai | openai_compatible
  base_url text not null,
  api_key_ref text not null,         -- keychain ref or encrypted config ref
  model text not null,
  temperature real not null default 0.2,
  max_tokens integer not null default 4096,
  enabled integer not null default 1,
  is_active integer not null default 0,
  extra_json text not null default '{}',
  created_at text not null,
  updated_at text not null
);

create table agents (
  id text primary key,
  trade_system_id text not null references trade_systems(id),
  trade_system_version_id text not null references trade_system_versions(id),
  name text not null,
  model_provider_id text references model_providers(id),
  system_prompt text not null,
  output_schema_json text not null,
  created_at text not null,
  updated_at text not null
);

create table materials (
  id text primary key,
  trade_system_id text references trade_systems(id),
  file_name text not null,
  file_path text not null,
  mime_type text,
  extracted_text text,
  parse_status text not null,
  parse_error text,
  created_at text not null
);

create table stocks (
  code text primary key,
  name text,
  exchange text,
  status text not null default 'active',
  updated_at text not null
);

create table watchlists (
  id text primary key,
  name text not null,
  created_at text not null,
  updated_at text not null
);

create table watchlist_items (
  id text primary key,
  watchlist_id text not null references watchlists(id),
  stock_code text not null,
  local_status text not null default 'watch', -- focus | watch | excluded
  note text,
  sort_order integer not null default 0,
  created_at text not null,
  updated_at text not null,
  unique(watchlist_id, stock_code)
);

create table stock_reviews (
  id text primary key,
  stock_code text not null,
  trade_system_id text not null references trade_systems(id),
  trade_system_version_id text not null references trade_system_versions(id),
  model_provider_id text references model_providers(id),
  score integer,
  rating text not null,
  overall_evaluation text not null,
  core_reasons_json text not null,
  evidence_json text not null,
  trade_plan_json text not null,
  chart_annotations_json text not null,
  uncertainty_json text not null,
  kline_coverage_json text not null,
  prompt_hash text not null,
  output_hash text not null,
  created_at text not null
);

create table chart_annotations (
  id text primary key,
  stock_code text not null,
  trade_system_version_id text references trade_system_versions(id),
  review_id text references stock_reviews(id),
  source text not null,              -- user | agent
  annotation_type text not null,     -- horizontal_line | ray
  payload_json text not null,
  created_at text not null,
  updated_at text not null
);
```

### 4.2 DuckDB: K 线结构化库

DuckDB 专门保存 K 线、证券信息和交易日历。评分和图表只能通过查询服务读取这些表，不直接访问外部行情源。

```sql
create table securities (
  symbol_id integer primary key,
  code text not null unique,
  name text not null,
  exchange text not null,
  board text,
  list_date date,
  delist_date date,
  status text not null default 'active'
);

create table trade_calendar (
  trade_date date primary key,
  is_open boolean not null
);

create table bars_1d (
  symbol_id integer not null,
  trade_date date not null,
  open double not null,
  high double not null,
  low double not null,
  close double not null,
  pre_close double,
  volume double not null,
  amount double not null,
  turnover double,
  adj_factor double,
  source text,
  updated_at timestamp not null,
  primary key (symbol_id, trade_date)
);

create table bars_1w (
  symbol_id integer not null,
  trade_date date not null,
  open double not null,
  high double not null,
  low double not null,
  close double not null,
  volume double not null,
  amount double not null,
  turnover double,
  adj_factor double,
  updated_at timestamp not null,
  primary key (symbol_id, trade_date)
);

create table bars_1M (
  symbol_id integer not null,
  trade_date date not null,
  open double not null,
  high double not null,
  low double not null,
  close double not null,
  volume double not null,
  amount double not null,
  turnover double,
  adj_factor double,
  updated_at timestamp not null,
  primary key (symbol_id, trade_date)
);

create table kline_sync_runs (
  id text primary key,
  stock_code text not null,
  mode text not null,
  status text not null,
  started_at timestamp not null,
  finished_at timestamp,
  rows_written integer not null default 0,
  source text,
  error text
);
```

### 4.3 迁移策略

- SQLite 和 DuckDB 分别维护 `schema_migrations` 表。
- 应用启动时运行迁移，失败则阻止进入主界面并显示错误。
- 所有迁移必须幂等，避免重复执行造成数据损坏。
- MVP 不要求自动备份，但每次迁移前应复制 `app.sqlite` 和 `kline.duckdb` 到 `backup/`。

## 5. Tauri Command 接口

所有前端能力通过 Tauri command 调用。命令命名使用 snake_case，返回 JSON 可序列化结构。

### 5.1 交易系统

| Command | 输入 | 输出 | 说明 |
| --- | --- | --- | --- |
| `list_trade_systems` | none | `TradeSystemSummary[]` | 列表 |
| `get_trade_system` | `trade_system_id` | `TradeSystemDetail` | 包含版本列表 |
| `import_material` | `trade_system_id?, file_path` | `MaterialRecord` | 复制文件并提取文本 |
| `generate_trade_system_draft` | `material_ids[], prompt?` | `TradeSystemDraft` | LLM 生成初稿和缺口问题 |
| `check_trade_system_completeness` | `markdown` | `CompletenessReport` | 本地规则 + LLM 辅助 |
| `save_trade_system_version` | `trade_system_id?, name, markdown, change_summary?` | `TradeSystemVersion` | 计算 hash 并保存版本 |
| `export_trade_system_version` | `version_id, target_path` | `ExportResult` | 导出 Markdown |

### 5.2 Provider 和 Agent

| Command | 输入 | 输出 | 说明 |
| --- | --- | --- | --- |
| `list_model_providers` | none | `ModelProvider[]` | 脱敏返回 |
| `save_model_provider` | provider config | `ModelProvider` | API key 写入安全存储或加密配置 |
| `set_active_model_provider` | `provider_id` | `ModelProvider` | 只能有一个 active |
| `test_model_provider` | `provider_id` | `ProviderTestResult` | 测试连通性 |
| `create_agent_from_trade_system` | `version_id, provider_id?` | `Agent` | 生成 system prompt |
| `run_agent_chat` | `agent_id, messages[]` | `AgentChatResult` | 用于澄清和测试问答 |

### 5.3 K 线数据

| Command | 输入 | 输出 | 说明 |
| --- | --- | --- | --- |
| `sync_kline` | `stock_code, mode` | `KlineSyncResult` | 唯一下载入口，`mode=full|incremental` |
| `get_bars` | `stock_code, frequency, start_date?, end_date?, limit?` | `KlineBar[]` | 只读本地库，不触发下载 |
| `get_data_coverage` | `stock_code` | `KlineCoverage` | 返回日/周/月覆盖范围 |
| `list_securities` | `keyword?, limit?` | `Security[]` | 搜索证券基础信息 |
| `aggregate_kline` | `stock_code?, frequency` | `AggregateResult` | 日 K 聚合周/月 K |

`KlineBar` 标准结构：

```ts
type KlineBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  preClose?: number;
  volume: number;
  amount: number;
  turnover?: number;
  adjFactor?: number;
};
```

### 5.4 评分、复盘和股票池

| Command | 输入 | 输出 | 说明 |
| --- | --- | --- | --- |
| `score_stock` | `stock_code, trade_system_version_id, provider_id?` | `StockReview` | 先检查覆盖范围，再读本地 K 线 |
| `get_stock_reviews` | `stock_code?, trade_system_version_id?` | `StockReview[]` | 历史评分 |
| `list_watchlists` | none | `Watchlist[]` | 股票池 |
| `save_watchlist` | `name` | `Watchlist` | 新建/改名 |
| `add_watchlist_item` | `watchlist_id, stock_code` | `WatchlistItem` | 加入股票 |
| `remove_watchlist_item` | `watchlist_id, stock_code` | `Ok` | 移除 |
| `run_daily_review` | `watchlist_id, trade_system_version_id` | `DailyReviewRun` | 先同步，再批量评分 |

### 5.5 图表标注

| Command | 输入 | 输出 | 说明 |
| --- | --- | --- | --- |
| `list_chart_annotations` | `stock_code, trade_system_version_id?` | `ChartAnnotation[]` | 读取用户和 Agent 标注 |
| `save_chart_annotation` | annotation payload | `ChartAnnotation` | 保存横线/射线 |
| `delete_chart_annotation` | `annotation_id` | `Ok` | 删除 |

## 6. 服务模块设计

### 6.1 `TradeSystemService`

职责：

- 管理交易系统和版本。
- 计算 Markdown 内容哈希。
- 执行完整性检查。
- 输出 Agent 编译所需的规范化上下文。

完整性检查规则：

- 必须包含系统定位、数据需求、入选条件、评分规则、交易计划规则、复盘输出格式。
- 评分规则必须能落到维度、权重或默认分值。
- 交易计划必须包含观察、入场、止损、止盈或不交易规则。
- 如果存在“永远”“必须”等绝对描述但没有量化或图表依据，标记为不可落地。

### 6.2 `MaterialService`

职责：

- 将用户上传文件复制到 app data directory。
- 提取 `.md`、`.txt` 文本。
- PDF 第一版只支持可提取文本 PDF；扫描件 OCR 作为后续能力。
- 保存原文件路径和提取文本，供生成交易系统草案使用。

### 6.3 `ModelProviderService`

职责：

- 管理 DeepSeek、OpenAI / ChatGPT 和 OpenAI-compatible Provider。
- API key 不直接写入普通 SQLite 字段，字段中只保存引用或加密值。
- `test_model_provider` 使用短 prompt 验证 base URL、model、key 和 JSON 输出能力。

Provider 统一请求结构：

```ts
type ModelRequest = {
  providerId: string;
  systemPrompt: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  responseFormat?: "json_object" | "text";
  temperature: number;
  maxTokens: number;
};
```

### 6.4 `AgentService`

职责：

- 从交易系统版本生成 Agent system prompt。
- 将“系统规则”和“模型推断”写入 prompt 边界。
- 对 Agent 输出做 JSON schema 校验。
- 对缺失规则和数据不足输出明确错误或 `uncertainty`。

评分 prompt 必须包含：

- 交易系统 Markdown 原文或压缩结构化摘要。
- K 线覆盖范围。
- 日/周/月 K 摘要和必要的最近 bars。
- 用户保存的相关图表标注。
- 固定 JSON 输出 schema。

禁止项：

- 不允许输出实盘买卖指令。
- 不允许引用未同步入库的行情。
- 不允许把交易系统未定义规则当成确定结论。

### 6.5 `KlineSyncService`

职责：

- 实现 `sync_kline(stock_code, mode)`。
- 从配置的数据源拉取日 K。
- 写入 `securities`、`trade_calendar`、`bars_1d`。
- 写入后调用聚合逻辑生成 `bars_1w`、`bars_1M`。
- 记录 `kline_sync_runs`。

同步伪流程：

```text
sync_kline(stock_code, mode)
  1. resolve security and ensure securities row
  2. read local coverage from bars_1d
  3. choose date range:
     - full: list_date or provider max history start to today
     - incremental: last local trade_date + 1 to today
  4. if today is known non-trade day and range is empty, return skipped
  5. fetch daily bars from configured provider chain
  6. normalize numeric fields and dates
  7. upsert bars_1d by (symbol_id, trade_date)
  8. aggregate weekly and monthly bars
  9. return coverage and rows_written
```

数据源策略：

- MVP 先定义 `KlineProvider` trait，不把具体数据源写死在业务服务里。
- Provider 链可配置；当前可参考 trend-trader 的公开数据源降级思路。
- 所有 Provider 返回统一 `DailyBar`。
- Provider 失败时记录错误，只有全部失败才使用 sample fallback。

### 6.6 `KlineQueryService`

职责：

- 实现 `get_bars(...)` 和 `get_data_coverage(...)`。
- 只访问 DuckDB，不访问外部数据源。
- 查询结果按时间升序返回给前端。
- 查询为空时返回空数组和明确状态，由 UI 显示同步提示。

查询约束：

- `frequency` 只允许 `1d`、`1w`、`1M`。
- 默认 `limit=500`，图表可显式请求更长历史。
- 不在查询服务中做全量技术指标计算；MVP 只返回 K 线基础字段。

### 6.7 `ReviewService`

职责：

- 编排 `score_stock` 和 `run_daily_review`。
- 评分前必须调用 `get_data_coverage`。
- 数据不足时返回 `status=data_required`，不调用 LLM。
- 数据充足时读取本地 K 线，构造评分上下文，调用 Agent。
- 验证 LLM JSON 输出，保存 `stock_reviews`。

`score_stock` 状态：

| 状态 | 含义 |
| --- | --- |
| `ok` | 评分成功 |
| `data_required` | 本地 K 线缺失或覆盖不足 |
| `invalid_trade_system` | 交易系统规则不完整 |
| `provider_error` | 模型 Provider 调用失败 |
| `invalid_output` | 模型输出不符合 schema |

### 6.8 `ChartAnnotationService`

职责：

- 保存用户手动画线。
- 保存 Agent 评分生成的图表标注。
- 标注和 `stock_code + trade_system_version_id + review_id` 关联。

标注 payload：

```ts
type ChartAnnotationPayload =
  | {
      type: "horizontal_line";
      price: number;
      label?: string;
      reason?: string;
    }
  | {
      type: "ray";
      start: { date: string; price: number };
      end: { date: string; price: number };
      label?: string;
      reason?: string;
      snappedTo?: "high" | "low";
    };
```

## 7. 前端实现设计

### 7.1 布局

采用工具型桌面应用布局：

- 左侧导航：每日复盘、交易系统、Agent、股票评分、K 线图表、自选股票池、数据、设置。
- 顶部状态栏：当前交易系统版本、当前 Provider、K 线库状态、最近同步时间。
- 中间主工作区：当前页面。
- 右侧上下文面板：当前股票、评分摘要、交易计划、标注列表。

### 7.2 页面职责

| 页面 | 关键组件 | Command |
| --- | --- | --- |
| DailyReviewPage | 股票池选择、交易系统选择、批量进度、评分表 | `run_daily_review` |
| TradeSystemPage | Markdown 编辑器、材料列表、缺口报告、版本列表 | `import_material`、`generate_trade_system_draft`、`save_trade_system_version` |
| AgentPage | Provider 选择、Agent 测试对话、system prompt 预览 | `create_agent_from_trade_system`、`run_agent_chat` |
| StockReviewPage | 股票输入、评分结果、交易计划、证据列表 | `score_stock`、`get_stock_reviews` |
| ChartPage | KLineChart、周期切换、坐标切换、画线工具 | `get_bars`、`list_chart_annotations`、`save_chart_annotation` |
| WatchlistPage | 股票池 CRUD、股票列表、最近评分 | `list_watchlists`、`add_watchlist_item` |
| DataPage | 单股同步、覆盖范围、同步历史 | `sync_kline`、`get_data_coverage` |
| SettingsPage | Provider 配置、数据源配置、本地目录 | `save_model_provider`、`test_model_provider` |

### 7.3 KLineChart 集成

图表输入只来自 `get_bars(...)`。

实现要求：

- 周期切换时重新调用 `get_bars(stock_code, frequency)`。
- 如果返回空数据，显示空状态，不调用 `sync_kline`。
- 横线使用 KLineChart 内置或自定义 horizontal overlay。
- 射线使用 ray overlay。
- 吸附逻辑在前端完成：鼠标坐标转换为附近 K 线索引，在可配置像素阈值内取最近 high/low。
- 对数坐标优先使用 KLineChart 支持能力；如库能力不足，MVP 标为技术风险并先禁用该开关。
- 保存标注时写入原始价格和日期，不保存屏幕坐标。

## 8. 核心流程实现

### 8.1 交易系统生成

```text
用户上传材料
  -> import_material
  -> MaterialService 提取文本
  -> generate_trade_system_draft
  -> AgentService 调用 LLM 生成 Markdown + 缺口问题
  -> 用户编辑确认
  -> save_trade_system_version
  -> CompletenessReport + hash + version
  -> create_agent_from_trade_system
```

失败处理：

- 文件无法解析：保存材料记录，`parse_status=failed`，UI 显示错误。
- LLM 失败：保留已上传材料，允许用户手动编辑 Markdown。
- 完整性不足：允许保存草稿，但不能用于正式评分，除非用户显式标记为允许测试。

### 8.2 K 线同步与查询

```text
用户在 Data 页点击同步
  -> sync_kline(stock_code, full|incremental)
  -> KlineSyncService 拉取日 K
  -> upsert bars_1d
  -> aggregate bars_1w / bars_1M
  -> get_data_coverage
  -> UI 显示覆盖范围

图表或评分读取数据
  -> get_bars(stock_code, frequency, range)
  -> KlineQueryService 只读 DuckDB
  -> 返回 bars 或空状态
```

关键约束：

- `get_bars` 永远不触发 `sync_kline`。
- 图表和评分发现数据不足时，只引导用户同步。
- 每日复盘可以显式调用 `sync_kline`，但同步完成后评分仍通过 `get_bars` 读取本地库。

### 8.3 单股评分

```text
score_stock(stock_code, trade_system_version_id)
  -> load trade system version
  -> check completeness
  -> get_data_coverage(stock_code)
  -> if insufficient: return data_required
  -> get_bars 1d/1w/1M
  -> load chart annotations
  -> build scoring prompt
  -> call model provider
  -> validate JSON output
  -> save stock_reviews
  -> save agent chart annotations
  -> return StockReview
```

LLM 输出校验：

- `score` 必须为 0-100 整数或 null。
- `rating` 必须为 `focus | watch | reject | data_required | undefined_rule` 之一。
- `core_reasons` 至少 1 条，且每条应引用规则或证据。
- `trade_plan` 必须包含 setup、entry、stop_loss、take_profit、invalidation。
- 如果交易系统规则不足，返回 `undefined_rule`，不能生成假计划。

### 8.4 每日复盘

```text
run_daily_review(watchlist_id, trade_system_version_id)
  -> load watchlist items
  -> for each stock: sync_kline(stock, incremental)
  -> for each stock: score_stock(stock, version)
  -> persist each review
  -> return sorted summary by score desc
```

UI 要求：

- 展示同步进度和评分进度。
- 单只股票失败不阻断整个批次。
- 每行显示最近同步时间、评分状态、分数、核心原因摘要。

## 9. 错误处理与日志

### 9.1 错误模型

所有 command 返回统一错误结构：

```ts
type AppError = {
  code: string;
  message: string;
  detail?: unknown;
  recoverable: boolean;
};
```

常见错误码：

| code | 场景 |
| --- | --- |
| `material_parse_failed` | 文件解析失败 |
| `provider_auth_failed` | 模型 Provider key 错误 |
| `provider_request_failed` | 模型调用失败 |
| `kline_sync_failed` | K 线同步失败 |
| `kline_data_required` | 本地 K 线不足 |
| `trade_system_incomplete` | 交易系统不满足评分要求 |
| `invalid_llm_output` | LLM 输出不符合 schema |
| `database_error` | SQLite 或 DuckDB 错误 |

### 9.2 日志

- Rust 后端写本地 rolling log。
- 日志中不得打印 API key。
- LLM prompt 默认不写入日志；调试模式可写脱敏 prompt hash。
- K 线同步记录写 `kline_sync_runs`，供 UI 展示。

## 10. 安全与隐私

- API key 优先使用系统 Keychain / Credential Manager；如果跨平台实现成本过高，MVP 可以先使用本地加密配置，但必须在 UI 中明确。
- 上传材料默认只存本地，不自动上传到除所选 LLM Provider 以外的服务。
- 调用 LLM 前 UI 应说明将发送交易系统 Markdown 和必要 K 线摘要。
- 导出 Markdown 不包含 API key 和本地路径。

## 11. 测试计划

### 11.1 Rust 单元测试

- Markdown hash 和版本号生成稳定。
- 完整性检查能识别缺失章节。
- `sync_kline` 的 full / incremental 范围计算正确。
- 周 K、月 K 聚合口径正确，周期日期为最后交易日。
- `get_bars` 只读本地库，不调用 Provider。
- `score_stock` 在 K 线不足时返回 `data_required`。
- LLM JSON 校验能拒绝缺字段和越界分数。

### 11.2 前端组件测试

- 交易系统编辑器保存后刷新版本列表。
- Data 页同步状态和覆盖范围展示正确。
- Chart 页空数据时显示“数据未就绪/请先同步”。
- KLineChart 接收本地 bars 后渲染主图和成交量。
- 横线/射线保存 payload 不包含屏幕坐标。
- Daily Review 批量过程显示单股失败状态。

### 11.3 集成测试

- 从 sample K 线同步到 DuckDB，再通过 `get_bars` 查询。
- 创建交易系统版本，生成 Agent，运行单股评分。
- 断网或禁用 Provider 时，已同步 K 线仍可打开图表。
- 每日复盘对多个股票执行同步、评分、排序。

### 11.4 手工验收场景

1. 上传 `.md` 交易笔记，生成并保存 `my_trade_system.md`。
2. 配置 DeepSeek 或 OpenAI Provider，测试连通性。
3. 输入一只股票，执行全量 K 线同步。
4. 打开图表，切换日/周/月 K，验证缩放、悬停、成交量、成交额。
5. 手动画横线和射线，验证吸附最高/最低点并保存。
6. 对该股票评分，确认输出分数、评价、核心原因、交易计划和图表标注。
7. 创建自选股票池，批量每日复盘，确认先同步再评分。

## 12. 实施阶段

| 阶段 | 交付 | 验收 |
| --- | --- | --- |
| Phase 0 | Tauri 项目、布局、SQLite 连接、迁移框架 | 应用可打开，设置页可读写 Provider 草稿 |
| Phase 1 | 交易系统 Markdown、材料上传、版本管理 | 可生成/编辑/保存/导出 Markdown |
| Phase 2 | Provider 调用、Agent 编译、完整性检查 | 可基于交易系统生成 Agent 并测试问答 |
| Phase 3 | DuckDB K 线库、同步、查询、覆盖范围 | 可同步单股日 K，查询日/周/月 K |
| Phase 4 | KLineChart、画线、标注保存 | 图表只读本地库，支持横线/射线和吸附 |
| Phase 5 | 单股评分、结果保存、Agent 标注 | 数据不足不评分，数据充足输出结构化结果 |
| Phase 6 | 自选股票池、每日复盘、批量评分 | 股票池先同步后评分，按分数排序 |

## 13. 技术风险

| 风险 | 影响 | 处理 |
| --- | --- | --- |
| KLineChart 对数坐标能力不足 | 无法满足 PRD 坐标切换 | 先验证库能力；不足时封装开关并记录限制 |
| Rust 侧 DuckDB 依赖打包复杂 | 桌面构建失败或体积增加 | Phase 3 前做最小 PoC，必要时 MVP 改 SQLite K 线表 |
| A 股公开 K 线数据源不稳定 | 同步失败 | Provider trait + 多源降级 + sample fallback |
| LLM 输出不稳定 | 评分不可复现 | 低温度、固定 schema、JSON 校验、输出 hash |
| Markdown 规则过于模糊 | Agent 无法稳定评分 | 完整性检查阻止正式评分，要求用户补规则 |

## 14. 开发命令建议

```bash
# 初始化依赖
pnpm install

# 开发运行
pnpm tauri dev

# 前端类型检查
pnpm typecheck

# 前端测试
pnpm test

# Rust 测试
cd src-tauri && cargo test

# 构建桌面应用
pnpm tauri build
```
