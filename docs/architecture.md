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

## 系统模块架构

```mermaid
graph TB
    subgraph Frontend["Frontend — React + TypeScript + Vite"]
        direction TB
        subgraph Pages["Pages"]
            WL[MyWatchlistPage<br/>三栏布局首页]
            KD[KlineDataPage<br/>数据集市管理]
            SR[StockReviewPage<br/>个股评分]
            DR[DailyReviewPage<br/>每日复盘]
            AP[AgentPage<br/>AI Agent 对话]
            TS[TradeSystemPage<br/>交易系统编辑器]
            SP[SettingsPage<br/>模型/供应商配置]
        end
        subgraph Components["Components"]
            direction LR
            CH[chart/<br/>KLineChart 工具栏 设置面板]
            CW[watchlist/<br/>侧栏 分组排序 右键菜单]
            CL[layout/<br/>窗口标题栏]
            CS[shared/<br/>Badge Button Input Panel DataTable]
        end
    end

    subgraph IPC["Tauri IPC Bridge"]
        INVOKE[@tauri-apps/api invoke]
    end

    subgraph Commands["Commands Layer — src-tauri/src/commands/"]
        direction TB
        CMD_KLINE[kline.rs<br/>sync_kline get_bars<br/>get_data_coverage list_securities]
        CMD_DATA[data_ops.rs<br/>search_securities get_data_health<br/>sync_securities_metadata]
        CMD_META[stock_meta.rs<br/>get_stock_meta]
        CMD_WL[watchlist.rs + watchlist_ops.rs<br/>CRUD 分组 排序 拖拽]
        CMD_REVIEW[review.rs<br/>score_stock get_stock_reviews<br/>run_daily_review]
        CMD_AGENT[agent.rs<br/>create_agent run_agent_chat]
        CMD_PROV[provider.rs<br/>CRUD 模型供应商 测试连接]
        CMD_TSYS[trade_system.rs<br/>导入素材 生成草稿 版本管理]
        CMD_ANNO[annotation.rs<br/>图表标注 CRUD]
    end

    subgraph Services["Services Layer — src-tauri/src/services/"]
        direction TB
        SVC_SYNC[kline_sync_service<br/>Python 脚本编排<br/>进度上报 导入调度]
        SVC_IMPORT[kline_import_service<br/>Parquet → DuckDB<br/>securities + bars + calendar]
        SVC_QUERY[kline_query_service<br/>K线只读查询<br/>覆盖率 标的列表]
        SVC_WL[watchlist_service<br/>自选分组 CRUD<br/>排序 拖拽]
        SVC_REVIEW[review_service<br/>评分 LLM 调用<br/>每日复盘]
        SVC_AGENT[agent_service<br/>Agent 对话编排]
        SVC_TSYS[trade_system_service<br/>Markdown SSOT 管理<br/>素材导入 缺口检测]
        SVC_PROV[model_provider_service<br/>供应商配置 加解密]
        SVC_ANNO[annotation_service<br/>图表标注存储]
        SVC_COMMON[common<br/>ID 生成]
    end

    subgraph LLM["LLM Layer — src-tauri/src/llm/"]
        direction LR
        LLM_CLIENT[client.rs<br/>OpenAI-compatible HTTP]
        LLM_PROMPT[prompts.rs<br/>Prompt 模板]
        LLM_GUARD[json_guard.rs<br/>JSON 解析/修复]
    end

    subgraph DB["Database Layer — src-tauri/src/db/"]
        direction LR
        DUCK[duckdb.rs<br/>DuckDB 连接池<br/>kline_bars securities<br/>trade_calendar kline_sync_runs]
        SQL[sqlite.rs<br/>SQLite 连接<br/>应用状态/配置]
        MIG[migrations.rs<br/>DuckDB DDL 迁移]
    end

    subgraph Python["Python Sync — scripts/sync_kline.py"]
        direction TB
        PY_MAIN[main<br/>参数解析 编排调度]
        PY_DISC[discover_instruments<br/>A股+指数发现]
        PY_SYNC[sync_klines<br/>批量拉取 限流重试<br/>5期×3复权]
        PY_WRITE[write_bars<br/>Parquet 输出]
    end

    subgraph External["External APIs"]
        TF[TickFlow API<br/>free-api.tickflow.org]
        EM[eastmoney API<br/>证券元数据]
        LLM_EXT[LLM Providers<br/>OpenAI / 兼容接口]
    end

    %% Frontend → IPC
    Pages --> INVOKE
    Components --> Pages

    %% IPC → Commands
    INVOKE --> CMD_KLINE
    INVOKE --> CMD_DATA
    INVOKE --> CMD_META
    INVOKE --> CMD_WL
    INVOKE --> CMD_REVIEW
    INVOKE --> CMD_AGENT
    INVOKE --> CMD_PROV
    INVOKE --> CMD_TSYS
    INVOKE --> CMD_ANNO

    %% Commands → Services
    CMD_KLINE --> SVC_SYNC
    CMD_KLINE --> SVC_QUERY
    CMD_DATA --> SVC_SYNC
    CMD_DATA --> SVC_IMPORT
    CMD_DATA --> SVC_QUERY
    CMD_META --> SVC_QUERY
    CMD_WL --> SVC_WL
    CMD_REVIEW --> SVC_REVIEW
    CMD_AGENT --> SVC_AGENT
    CMD_TSYS --> SVC_TSYS
    CMD_PROV --> SVC_PROV
    CMD_ANNO --> SVC_ANNO

    %% Services → LLM
    SVC_REVIEW --> LLM_CLIENT
    SVC_AGENT --> LLM_CLIENT
    SVC_TSYS --> LLM_CLIENT
    LLM_CLIENT --> LLM_PROMPT
    LLM_CLIENT --> LLM_GUARD

    %% Services → DB
    SVC_SYNC --> DUCK
    SVC_IMPORT --> DUCK
    SVC_QUERY --> DUCK
    SVC_WL --> SQL
    SVC_WL --> DUCK
    SVC_REVIEW --> SQL
    SVC_REVIEW --> DUCK
    SVC_AGENT --> SQL
    SVC_TSYS --> SQL
    SVC_PROV --> SQL
    SVC_ANNO --> SQL
    MIG --> DUCK

    %% Python → Services
    SVC_SYNC -- spawns --> PY_MAIN

    %% Python → External
    PY_DISC --> TF
    PY_SYNC --> TF

    %% Services → External
    SVC_IMPORT -.-> EM

    %% LLM → External
    LLM_CLIENT --> LLM_EXT

    %% Styles
    style Frontend fill:#121212,stroke:#4d90fe,color:#e0e0e0
    style IPC fill:#1a1a1a,stroke:#f0b93b,color:#e0e0e0
    style Commands fill:#121212,stroke:#4d90fe,color:#e0e0e0
    style Services fill:#121212,stroke:#ff6b35,color:#e0e0e0
    style LLM fill:#121212,stroke:#f0b93b,color:#e0e0e0
    style DB fill:#121212,stroke:#4d90fe,color:#e0e0e0
    style Python fill:#121212,stroke:#ff6b35,color:#e0e0e0
    style External fill:#1a1a1a,stroke:#2a2a2a,color:#888888
```

## 数据流

```mermaid
sequenceDiagram
    participant U as 用户
    participant FE as React 前端
    participant CMD as Tauri Command
    participant SVC as Service
    participant PY as Python 脚本
    participant TF as TickFlow API
    participant DUCK as DuckDB
    participant LLM as LLM Provider

    rect rgb(18, 18, 18)
        Note over U,DUCK: K线同步链路
        U->>FE: 点击"一键补齐"
        FE->>CMD: invoke sync_kline('', 'incremental', 'incomplete')
        CMD->>SVC: run_sync_script()
        SVC->>PY: spawn python3 sync_kline.py
        PY->>TF: TickFlow.klines.batch()
        TF-->>PY: K线 JSON 数据
        PY->>PY: enrich_bars → Parquet
        PY-->>SVC: stdout JSON 进度事件
        SVC-->>CMD: SyncScriptResult
        CMD->>SVC: import_and_finalize()
        SVC->>DUCK: INSERT kline_bars FROM Parquet
        CMD-->>FE: KlineSyncResult
        FE->>FE: invalidate queries
    end

    rect rgb(18, 18, 18)
        Note over U,LLM: 评分链路
        U->>FE: 点击"评分"
        FE->>CMD: invoke score_stock(symbol)
        CMD->>SVC: score_stock()
        SVC->>DUCK: get_bars (coverage check)
        SVC->>DUCK: get_bars summaries (1d/1w/1M/1Q/1Y)
        SVC->>LLM: Chat Completions (scoring prompt)
        LLM-->>SVC: 评分 JSON
        SVC->>SQL: INSERT stock_reviews
        SVC-->>CMD: StockReview
        CMD-->>FE: 评分结果
    end
```
