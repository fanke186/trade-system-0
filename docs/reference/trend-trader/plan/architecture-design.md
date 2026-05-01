# trend-trader 架构设计与模块规约

> 版本: 1.0 | 日期: 2026-04-30 | 状态: Phase 0-5 已实现, Phase 6 部分完成

本文件包含系统架构、模块设计、数据库表设计、API 设计、交互流设计、前端设计和风格规约。

---

## 目录

1. [系统架构](#一系统架构)
2. [配置管理](#二配置管理)
3. [数据库设计](#三数据库设计)
4. [模块设计](#四模块设计)
5. [API 设计](#五api-设计)
6. [交互流设计](#六交互流设计)
7. [前端设计](#七前端设计)
8. [风格规约](#八风格规约)

---

## 一、系统架构

### 1.1 部署拓扑

```
┌─ Mac 本地 (主力) ──────────────────────────────────────────┐
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │ FastAPI   │  │ Worker   │  │ DuckDB   │  │ SQLite     │  │
│  │ :8001     │  │ (APS)    │  │ K线库    │  │ 业务库     │  │
│  └─────┬─────┘  └────┬─────┘  └──────────┘  └───────────┘  │
│        │             │                                       │
│  ┌─────┴─────────────┴─────┐  ┌─────────────────────────┐  │
│  │ React SPA :5173          │  │ CLI (trend-trader)      │  │
│  └──────────────────────────┘  └─────────────────────────┘  │
│                                                             │
│  行情通道: mootdx (免费) / jvQuant (付费, 可切换)            │
│  通知通道: Hermes 飞书 (已有)                                │
│                                                             │
└─────────────────────────────────────────────────────────────┘

┌─ Windows 小主机 (交易网关) ────────────────────────────────┐
│                                                             │
│  ┌──────────────────┐     ┌─────────────────────────────┐  │
│  │ MiniQMT 客户端    │◀──▶│ xtquant 交易网关 (Python)    │  │
│  │ (券商登录态)      │     │ - xtdata: 行情              │  │
│  └──────────────────┘     │ - xttrader: 下单/撤单/查询  │  │
│                           └──────────┬──────────────────┘  │
│                                      │ HTTP API             │
│                                      │ :8800               │
└──────────────────────────────────────┼──────────────────────┘
                                       │
                          Mac ←──→ Windows (局域网 HTTP)
```

### 1.2 进程模型

| 进程 | 职责 | 启动方式 |
|------|------|---------|
| **FastAPI** (`uvicorn`) | REST API + WebSocket | `./trend-trader serve` 或 `uvicorn app.main:app --port 8001` |
| **Worker** (`APScheduler`) | 定时任务执行 | `./trend-trader worker start` 独立进程 |
| **Trading Gateway** | 接收 Mac 的 HTTP 下单请求，转发给 MiniQMT | Windows 上的独立 Python 进程 |
| **Frontend Dev** (`Vite`) | 前端开发服务器 | `npm run dev` (端口 :5173) |

### 1.3 目录结构

```
trend-trader/
├── backend/
│   ├── app/
│   │   ├── main.py                  # FastAPI 应用，全部路由 + WebSocket
│   │   ├── models.py                # Pydantic 模型 (全部)
│   │   ├── services.py              # TrendTraderService 编排层
│   │   ├── tools.py                 # ToolRegistry 统一工具入口
│   │   ├── cli.py                   # argparse CLI 分发
│   │   ├── worker.py                # APScheduler 独立进程
│   │   │
│   │   ├── config/                  # [NEW] 配置管理
│   │   │   ├── __init__.py
│   │   │   ├── loader.py            # 配置加载器 (YAML/JSON)
│   │   │   └── models.py            # 配置 Pydantic 模型
│   │   │
│   │   ├── strategies/              # 策略系统
│   │   │   ├── __init__.py
│   │   │   ├── base.py              # StrategyPlugin + StrategyRegistry
│   │   │   ├── trend_trading.py     # 内置策略
│   │   │   ├── engine.py            # [NEW] 通用策略执行引擎
│   │   │   └── interpreter.py       # [NEW] 策略释义器
│   │   │
│   │   ├── data/                    # 数据层
│   │   │   ├── providers.py         # 历史K线提供者 (QUANTAXIS → sample)
│   │   │   ├── realtime.py          # 实时行情提供者
│   │   │   ├── cache.py             # BarCache (文件缓存)
│   │   │   └── kline_db.py          # [NEW] DuckDB K线数据库
│   │   │
│   │   ├── monitoring/              # [NEW] 监控模块
│   │   │   ├── __init__.py
│   │   │   ├── quote_stream.py      # 行情自动订阅 (mootdx / jvQuant)
│   │   │   ├── condition_evaluator.py # 条件单自动求值
│   │   │   └── alert_bus.py         # 事件分发 (飞书等)
│   │   │
│   │   ├── trading/                 # [NEW] 交易模块
│   │   │   ├── __init__.py
│   │   │   ├── gateway.py           # 交易网关抽象
│   │   │   ├── miniqmt_gateway.py   # MiniQMT HTTP 网关客户端
│   │   │   └── models.py            # 订单/持仓/成交模型
│   │   │
│   │   ├── agent/                   # [NEW] Agent 模块
│   │   │   ├── __init__.py
│   │   │   └── tool_loop.py         # Agent 工具调用循环
│   │   │
│   │   └── storage/                 # 持久化
│   │       ├── repository.py        # SQLite 仓库
│   │       └── migrations.py        # [NEW] 数据库迁移
│   │
│   ├── tests/
│   │   ├── test_trend_trading.py
│   │   ├── test_repository.py
│   │   ├── test_api.py              # [NEW] API 测试
│   │   ├── test_config.py           # [NEW] 配置测试
│   │   └── test_kline_db.py         # [NEW] K线DB测试
│   │
│   └── .data/                       # 运行时数据 (gitignore)
│       ├── config.yaml              # 配置文件 (用户编辑)
│       ├── trend_trader.sqlite3     # 业务数据库
│       ├── scheduler.sqlite3        # 调度器数据库
│       ├── kline.duckdb             # [NEW] K线数据库
│       ├── kline_parquet/           # [NEW] Parquet 文件
│       └── bars/                    # 缓存 (现有)
│
├── frontend/
│   ├── src/
│   │   ├── App.tsx                  # 路由入口 (精简)
│   │   ├── main.tsx                 # Vite 入口
│   │   ├── api.ts                   # API 封装
│   │   ├── types.ts                 # TypeScript 类型
│   │   │
│   │   ├── components/              # [NEW] 共享组件
│   │   │   ├── Layout.tsx           # 整体布局骨架
│   │   │   ├── Sidebar.tsx          # 左侧导航
│   │   │   ├── ChatInput.tsx        # 底部聊天输入 (全局)
│   │   │   ├── ContextPanel.tsx     # 右侧上下文面板
│   │   │   ├── StatusIndicator.tsx  # 连接状态灯
│   │   │   ├── DataTable.tsx        # 可排序数据表
│   │   │   ├── PriceDisplay.tsx     # 价格显示 (颜色+格式化)
│   │   │   └── MetricCard.tsx       # 指标卡片
│   │   │
│   │   ├── pages/                   # [NEW] 各页面
│   │   │   ├── AIPage.tsx           # AI 对话 (默认首页)
│   │   │   ├── ReviewPage.tsx       # 复盘 (K线+分析+选股)
│   │   │   ├── StrategyPage.tsx     # 策略管理
│   │   │   ├── PoolPage.tsx         # 股票池 (同花顺式)
│   │   │   ├── MonitorPage.tsx      # 监控 (行情+条件单+事件)
│   │   │   ├── SchedulePage.tsx     # 定时任务
│   │   │   └── SettingsPage.tsx     # 设置
│   │   │
│   │   ├── hooks/                   # [NEW] 自定义 Hooks
│   │   │   ├── useWebSocket.ts      # WebSocket 连接
│   │   │   ├── useQuotes.ts         # 实时行情订阅
│   │   │   └── usePolling.ts        # 轮询 Hook
│   │   │
│   │   └── KLinePanel.tsx           # K线面板 (重写为 lightweight-charts)
│   │
│   └── index.css                    # Tailwind + 自定义样式
│
├── trading-gateway/                 # [NEW] Windows 交易网关
│   ├── server.py                    # Flask/FastAPI HTTP 服务
│   ├── xt_client.py                 # xtquant 封装
│   ├── requirements.txt
│   └── README.md
│
├── docs/plan/                       # 设计文档
│   ├── architecture-design.md       # 本文件
│   └── implementation-guide.md      # 实现指引
│
├── config.yaml.example              # 配置文件示例
└── CLAUDE.md
```

---

## 二、配置管理

### 2.1 设计理念

**类 cc-switch 的多套配置切换**：所有外部依赖（AI 模型/行情/交易/通知）均支持配置多套凭据，通过 `active` 字段或环境变量切换。

### 2.2 配置文件格式

文件路径: `backend/.data/config.yaml`

```yaml
# trend-trader 配置文件
# 环境变量覆盖规则: TREND_TRADER_<SECTION>_<KEY> (例如 TREND_TRADER_QUOTE_CHANNEL)

# 当前激活的配置 (可被环境变量覆盖)
active:
  quote_channel: mootdx       # mootdx | jvquant
  trade_mode: dry_run         # dry_run | paper | live
  notify_channel: hermes      # hermes | wechat | dingtalk | console
  ai_profile: deepseek        # 默认 AI 模型配置名称

# AI 模型渠道配置
ai:
  profiles:
    - name: deepseek
      provider: deepseek
      base_url: https://api.deepseek.com
      api_key_env: DEEPSEEK_API_KEY
      model: deepseek-v4-pro
      temperature: 0.2
      max_tokens: 4096
      timeout_seconds: 60
      extra:
        reasoning_effort: high
      active: true

    - name: glm
      provider: glm
      base_url: https://open.bigmodel.cn/api/paas/v4
      api_key_env: ZAI_API_KEY
      model: glm-5.1
      temperature: 0.2
      max_tokens: 4096
      active: false

    - name: openai
      provider: openai
      base_url: https://api.openai.com/v1
      api_key_env: OPENAI_API_KEY
      model: gpt-5
      temperature: 0.2
      max_tokens: 4096
      active: false

    - name: kimi
      provider: kimi
      base_url: https://api.moonshot.cn/v1
      api_key_env: MOONSHOT_API_KEY
      model: kimi-latest
      temperature: 0.2
      max_tokens: 4096
      active: false

    - name: qwen
      provider: qwen
      base_url: https://dashscope.aliyuncs.com/compatible-mode/v1
      api_key_env: DASHSCOPE_API_KEY
      model: qwen-plus
      temperature: 0.2
      max_tokens: 4096
      active: false

    - name: openrouter
      provider: openrouter
      base_url: https://openrouter.ai/api/v1
      api_key_env: OPENROUTER_API_KEY
      model: openai/gpt-5
      temperature: 0.2
      max_tokens: 4096
      active: false

    - name: local_ollama
      provider: ollama
      base_url: http://localhost:11434/v1
      api_key_env: OLLAMA_API_KEY
      model: qwen3
      temperature: 0.2
      max_tokens: 4096
      active: false

    - name: local_litellm
      provider: litellm
      base_url: http://localhost:4000/v1
      api_key_env: LITELLM_API_KEY
      model: gpt-5
      temperature: 0.2
      max_tokens: 4096
      active: false

# 行情通道配置
quote:
  # 通道 1: mootdx (免费, 通达信逆向)
  mootdx:
    enabled: true
    market: std              # std=标准市场 ext=扩展市场
    multithread: true
    heartbeat: true
    # 超时配置
    timeout_seconds: 5
    retry: 3

  # 通道 2: jvQuant (按量付费, 商业级)
  jvquant:
    enabled: true
    token_env: JVQUANT_TOKEN         # 环境变量名
    # 订阅级别: lv1 | lv2
    default_level: lv1
    # 分配服务器 API
    alloc_url: https://jvquant.com/alloc
    # 超时配置
    timeout_seconds: 10
    reconnect_seconds: 3

# 交易配置
trading:
  mode: dry_run               # dry_run | paper | live

  # MiniQMT (Windows 网关)
  miniqmt:
    gateway_url: http://192.168.1.100:8800   # Windows 小主机地址
    timeout_seconds: 10
    retry: 3
    # 风控参数
    max_position_pct: 0.3     # 单票最大仓位 30%
    max_daily_loss: 5000      # 单日最大亏损 5000 元
    max_consecutive_loss: 3   # 连续亏损 3 次暂停

  # 模拟交易 (paper trading)
  paper:
    initial_cash: 100000
    commission_rate: 0.00025  # 万2.5
    stamp_duty: 0.001         # 千1 (仅卖出)
    min_commission: 5         # 最低 5 元

# 通知配置
notify:
  # 飞书 (Hermes)
  hermes:
    enabled: true
    binary: /Users/yaya/.local/bin/hermes
    send_env: TREND_TRADER_HERMES_SEND  # 设置为 "1" 启用真实发送

  # 微信机器人 (预留)
  wechat:
    enabled: false
    webhook_url_env: WECHAT_WEBHOOK_URL

  # 钉钉机器人 (预留)
  dingtalk:
    enabled: false
    webhook_url_env: DINGTALK_WEBHOOK_URL
    secret_env: DINGTALK_SECRET

# K线数据库配置
kline_db:
  # DuckDB 数据库路径 (相对于 .data/)
  db_path: kline.duckdb
  # Parquet 存储路径 (相对于 .data/)
  parquet_dir: kline_parquet
  # 数据范围
  years_back: 15
  # 周期: 1d, 1w, 1M
  frequencies: [1d, 1w, 1M]
  # 自动更新: 每个交易日盘后
  auto_update_after: "15:30"
```

### 2.3 配置加载器实现规约

```python
# backend/app/config/loader.py

from pathlib import Path
from typing import Any
import os
import yaml

class ConfigLoader:
    """配置加载器，支持 YAML + 环境变量覆盖
    
    加载顺序: config.yaml → 环境变量 TREND_TRADER_* → 代码默认值
    """

    def __init__(self, config_path: Path) -> None:
        self._config_path = config_path
        self._data: dict[str, Any] = {}
        self._load()

    def _load(self) -> None:
        if self._config_path.exists():
            with open(self._config_path) as f:
                self._data = yaml.safe_load(f) or {}
        self._apply_env_overrides()

    def _apply_env_overrides(self) -> None:
        """TREND_TRADER_SECTION_KEY=value 覆盖配置"""
        for key, value in os.environ.items():
            if not key.startswith("TREND_TRADER_"):
                continue
            parts = key[len("TREND_TRADER_"):].lower().split("_", 1)
            if len(parts) == 2:
                section, subkey = parts
                if section in self._data:
                    self._data[section][subkey] = value

    def get_active_ai_profile(self) -> dict[str, Any]:
        """获取当前激活的 AI 模型配置"""
        active_name = self._data.get("active", {}).get("ai_profile", "deepseek")
        for p in self._data.get("ai", {}).get("profiles", []):
            if p["name"] == active_name and p.get("active", True):
                return p
        raise ValueError(f"Active AI profile '{active_name}' not found or inactive")

    def get_active_quote_channel(self) -> tuple[str, dict[str, Any]]:
        """返回 (channel_name, channel_config)"""
        channel = self._data.get("active", {}).get("quote_channel", "mootdx")
        config = self._data.get("quote", {}).get(channel, {})
        return channel, config

    @property
    def trading(self) -> dict[str, Any]:
        return self._data.get("trading", {})

    @property
    def notify(self) -> dict[str, Any]:
        return self._data.get("notify", {})

    @property
    def kline_db(self) -> dict[str, Any]:
        return self._data.get("kline_db", {})
```

---

## 三、数据库设计

### 3.1 SQLite 业务数据库 (trend_trader.sqlite3)

#### 通用实体表 (id, name, enabled, status, payload JSON)

| 表名 | 用途 | payload 关键字段 |
|------|------|-----------------|
| `model_providers` | AI 模型渠道 | provider_type, base_url, api_key_env, notes |
| `model_profiles` | AI 模型配置 | provider_id, model, temperature, max_tokens, timeout_seconds, supports_json, supports_stream, supports_tools, extra |
| `skills` | 技能定义 | description, instructions, references[], tools_allowed[], version |
| `agents` | AI Agent | role, system_prompt, model_profile_id, skill_ids[], tools_allowed[], output_schema, max_turns, allow_sub_agents |
| `agent_teams` | Agent 团队 | mode, agent_ids[], coordinator_agent_id, description |
| `strategy_specs` | 策略规格 | description, source_prompt, version, universe, features[], filters[], scoring[], overlays[], trade_plan_template, explanation |
| `condition_orders` | 条件单 | symbol, order_type, condition, action, strategy_name, last_triggered_at, dedupe_key |
| `schedules` | 定时任务 | description, trigger{type, cron, every_seconds, run_at, timezone}, workflow{version, steps[]}, next_run_at |

**通用表 DDL**:
```sql
create table if not exists {table} (
    id integer primary key autoincrement,
    name text not null unique,
    enabled integer not null default 1,
    status text not null default 'active',
    payload text not null,
    created_at text not null,
    updated_at text not null
);
```

#### 定型表

```sql
-- 分析记录
create table analyses (
    id integer primary key autoincrement,
    symbol text not null,
    strategy_name text not null,
    as_of text not null,
    score real not null,
    status text not null,
    payload text not null,
    created_at text not null
);

-- 交易计划
create table plans (
    id integer primary key autoincrement,
    symbol text not null,
    strategy_name text not null,
    status text not null,
    entry_price real,
    stop_loss real,
    take_profit real,
    risk_reward_ratio real,
    payload text not null,
    created_at text not null
);

-- 盘中监控
create table watchlist (
    id integer primary key autoincrement,
    symbol text not null,
    strategy_name text not null,
    entry_price real,
    stop_loss real,
    take_profit real,
    status text not null,
    plan_payload text not null,
    created_at text not null,
    unique(symbol, strategy_name)
);

-- 提醒事件
create table alerts (
    id integer primary key autoincrement,
    symbol text not null,
    strategy_name text not null,
    trigger_type text not null,
    price real not null,
    message text not null,
    created_at text not null,
    delivered_channels text not null default '[]',
    unique(symbol, strategy_name, trigger_type)
);

-- 股票池
create table stock_pools (
    id integer primary key autoincrement,
    name text not null unique,
    description text not null default '',
    enabled integer not null default 1,
    payload text not null,
    created_at text not null,
    updated_at text not null
);

-- 股票池明细
create table stock_pool_items (
    id integer primary key autoincrement,
    pool_id integer not null,
    symbol text not null,
    name text not null default '',
    group_name text not null default '默认',
    tags text not null default '[]',
    notes text not null default '',
    review_enabled integer not null default 1,
    monitor_enabled integer not null default 1,
    sort_order integer not null default 0,
    payload text not null,
    created_at text not null,
    updated_at text not null,
    unique(pool_id, symbol)
);

-- 事件中心
create table events (
    id integer primary key autoincrement,
    category text not null,
    source text not null,
    title text not null,
    message text not null,
    status text not null,
    payload text not null,
    created_at text not null
);

-- 工具调用日志
create table tool_invocations (
    id integer primary key autoincrement,
    tool_name text not null,
    source text not null,
    status text not null,
    requires_confirmation integer not null default 0,
    arguments text not null,
    output text not null,
    error text,
    created_at text not null
);

-- AI 运行记录
create table ai_runs (
    id integer primary key autoincrement,
    agent_id integer,
    team_id integer,
    status text not null,
    input text not null,
    output text not null,
    created_at text not null
);

-- 聊天会话
create table chat_sessions (
    id integer primary key autoincrement,
    title text not null,
    agent_id integer,
    model_profile_id integer,
    payload text not null,
    created_at text not null,
    updated_at text not null
);

-- 聊天消息
create table chat_messages (
    id integer primary key autoincrement,
    session_id integer not null,
    role text not null,
    content text not null,
    payload text not null,
    created_at text not null
);

-- 定时任务运行历史
create table schedule_runs (
    id integer primary key autoincrement,
    schedule_id integer not null,
    status text not null,
    output text not null,
    error text,
    started_at text not null,
    finished_at text
);

-- [NEW] 策略回测记录
create table backtest_runs (
    id integer primary key autoincrement,
    strategy_spec_id integer not null,
    symbol text not null,
    start_date text not null,
    end_date text not null,
    status text not null,
    payload text not null,
    created_at text not null
);

-- [NEW] Agent 分层记忆
create table agent_memories (
    id integer primary key autoincrement,
    agent_id integer,
    session_id text not null,
    memory_type text not null,      -- short_term | medium_term | long_term
    content text not null,
    created_at text not null
);

-- [NEW] 交易订单记录 (模拟/实盘)
create table trade_orders (
    id integer primary key autoincrement,
    order_type text not null,       -- buy | sell
    symbol text not null,
    price real,
    volume integer,
    status text not null,           -- pending | submitted | filled | cancelled | rejected
    mode text not null,             -- dry_run | paper | live
    entrust_no text,
    filled_price real,
    filled_volume integer,
    condition_order_id integer,
    payload text not null,
    created_at text not null,
    updated_at text not null
);

-- [NEW] 持仓记录
create table positions (
    id integer primary key autoincrement,
    symbol text not null,
    volume integer not null,
    avg_cost real not null,
    market_value real,
    unrealized_pnl real,
    mode text not null,
    updated_at text not null,
    unique(symbol, mode)
);
```

### 3.2 DuckDB K线数据库 (kline.duckdb)

#### DDL

```sql
-- 证券基础信息
create table securities (
    symbol_id integer primary key,
    code text not null unique,        -- 000001
    name text not null,               -- 平安银行
    exchange text not null,           -- SSE | SZSE | BSE
    board text,                       -- 主板 | 创业板 | 科创板
    list_date date,
    delist_date date,
    status text not null default 'active'
);

-- 交易日历
create table trade_calendar (
    trade_date date primary key,
    is_open boolean not null
);

-- 日K线
create table bars_1d (
    symbol_id integer not null,
    trade_date date not null,
    open real not null,
    high real not null,
    low real not null,
    close real not null,
    pre_close real,
    volume real not null,
    amount real not null,
    turnover real,                   -- 换手率 %
    adj_factor real,                 -- 复权因子
    limit_up real,
    limit_down real,
    is_st boolean default false,
    primary key (symbol_id, trade_date)
);

-- 周K线
create table bars_1w (
    symbol_id integer not null,
    trade_date date not null,        -- 该周最后一个交易日
    open real not null,
    high real not null,
    low real not null,
    close real not null,
    volume real not null,
    amount real not null,
    turnover real,
    adj_factor real,
    primary key (symbol_id, trade_date)
);

-- 月K线
create table bars_1M (
    symbol_id integer not null,
    trade_date date not null,        -- 该月最后一个交易日
    open real not null,
    high real not null,
    low real not null,
    close real not null,
    volume real not null,
    amount real not null,
    turnover real,
    adj_factor real,
    primary key (symbol_id, trade_date)
);
```

#### 查询接口

```python
# backend/app/data/kline_db.py

from typing import Optional
from datetime import date
import duckdb
from app.models import DailyBar

class KlineDatabase:
    """DuckDB K线数据库，按年分区存储 Parquet 文件"""

    def __init__(self, db_path: str, parquet_dir: str) -> None:
        self._conn = duckdb.connect(db_path)
        self._parquet_dir = parquet_dir
        self._init_schema()

    def _init_schema(self) -> None:
        """初始化 DuckDB schema"""
        # 执行上述 DDL
        ...

    def get_bars(
        self,
        symbol: str,
        frequency: str = "1d",
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        limit: int = 500,
    ) -> list[DailyBar]:
        """获取K线数据

        主查询路径: where symbol_id=? and trade_date between ? and ? order by trade_date
        """
        table = {"1d": "bars_1d", "1w": "bars_1w", "1M": "bars_1M"}[frequency]
        symbol_id = self._get_symbol_id(symbol)

        query = f"""
            select b.*, s.code, s.exchange
            from {table} b
            join securities s on b.symbol_id = s.symbol_id
            where b.symbol_id = ?
        """
        params = [symbol_id]

        if start_date:
            query += " and b.trade_date >= ?"
            params.append(start_date)
        if end_date:
            query += " and b.trade_date <= ?"
            params.append(end_date)

        query += " order by b.trade_date desc limit ?"
        params.append(limit)

        rows = self._conn.execute(query, params).fetchall()
        return [_row_to_bar(row) for row in reversed(rows)]

    def get_all_symbols(self) -> list[dict]:
        """获取全部证券列表"""
        return self._conn.execute(
            "select * from securities where status = 'active' order by code"
        ).fetchdf().to_dict("records")

    def is_trade_day(self, d: date) -> bool:
        """判断是否为交易日"""
        row = self._conn.execute(
            "select is_open from trade_calendar where trade_date = ?", [d]
        ).fetchone()
        return bool(row[0]) if row else False

    def update_bars(self, frequency: str, bars: list[DailyBar]) -> None:
        """批量插入/更新K线"""
        table = {"1d": "bars_1d", "1w": "bars_1w", "1M": "bars_1M"}[frequency]
        # INSERT OR REPLACE
        ...
```

#### 数据分区

Parquet 文件按 `{frequency}/{year}/{month}.parquet` 组织:

```
.data/kline_parquet/
├── 1d/
│   ├── 2011/
│   │   ├── 01.parquet
│   │   ├── 02.parquet
│   │   └── ...
│   ├── 2012/
│   └── ...
├── 1w/
└── 1M/
```

---

## 四、模块设计

### 4.1 行情模块 (monitoring/)

#### 4.1.1 抽象接口

```python
# backend/app/monitoring/quote_stream.py

from abc import ABC, abstractmethod
from typing import Protocol

class QuoteProvider(Protocol):
    """行情提供者协议"""
    def fetch_quotes(self, symbols: list[str]) -> dict[str, Quote]:
        ...

@dataclass
class Quote:
    symbol: str
    name: str
    price: float
    change_pct: float      # 涨跌幅 %
    volume: float           # 成交量
    amount: float           # 成交额
    high: float
    low: float
    open: float
    pre_close: float
    bid_prices: list[float] # 买五档
    bid_volumes: list[int]
    ask_prices: list[float] # 卖五档
    ask_volumes: list[int]
    timestamp: float        # Unix 时间戳
```

#### 4.1.2 mootdx 实现

```python
class MootdxQuoteProvider:
    """基于 mootdx 的免费行情

    原理: 通过 mootdx.quotes.Quotes 连接通达信行情服务器
    获取方式: 轮询 (默认每3秒拉取一次)
    """

    def __init__(self, config: dict) -> None:
        from mootdx.quotes import Quotes
        self._client = Quotes.factory(
            market=config.get("market", "std"),
            multithread=config.get("multithread", True),
            heartbeat=config.get("heartbeat", True),
        )

    def fetch_quotes(self, symbols: list[str]) -> dict[str, Quote]:
        """拉取最新行情

        mootdx 行情返回格式 (通达信标准):
        - 对于单只股票, 调用 client.bars(symbol, frequency=9, offset=1) 获取最新 bar
        - 对于批量行情, 可以调用 client.quotes(symbols) (如果支持)
        """
        results = {}
        for symbol in symbols:
            try:
                # frequency=9 表示日线, offset=1 表示最近1根
                bar = self._client.bars(symbol=symbol, frequency=9, offset=1)
                if bar:
                    results[symbol] = self._parse_bar_to_quote(symbol, bar)
            except Exception as exc:
                logger.warning(f"mootdx fetch failed for {symbol}: {exc}")
        return results
```

#### 4.1.3 jvQuant 实现

```python
class JvQuantQuoteProvider:
    """基于 jvQuant 的付费行情

    原理: WebSocket 连接 jvQuant, 订阅 lv1 行情
    数据格式: lv1_{code}={推送时间},{名称},{最新价},{涨幅},{成交量},{成交额},买五档...,卖五档...
    获取方式: WebSocket 推送 (实时)
    """

    def __init__(self, config: dict) -> None:
        self._token = os.getenv(config["token_env"], "")
        self._level = config.get("default_level", "lv1")
        self._ws: Optional[WebSocket] = None
        self._quotes: dict[str, Quote] = {}
        self._subscribed: set[str] = set()

    async def connect(self) -> None:
        """连接 jvQuant WebSocket"""
        # 1. 分配服务器
        server = await self._alloc_server()
        # 2. WebSocket 连接
        self._ws = await websockets.connect(f"ws://{server}")
        # 3. 登录 (token)
        ...

    async def subscribe(self, symbols: list[str]) -> None:
        """订阅行情
        发送: add=lv1_000001,lv1_002261,...
        """
        codes = ",".join(f"{self._level}_{s}" for s in symbols)
        await self._ws.send(f"add={codes}")
        self._subscribed.update(symbols)

    async def unsubscribe(self, symbols: list[str]) -> None:
        """取消订阅"""
        codes = ",".join(f"{self._level}_{s}" for s in symbols)
        await self._ws.send(f"del={codes}")
        self._subscribed.difference_update(symbols)

    async def listen(self) -> AsyncIterator[Quote]:
        """监听行情推送，返回 Quote 异步迭代器"""
        while True:
            data = await self._ws.recv()
            # 解压二进制 → 字符串 → 按 \n 分割 → 解析 lv1_xxx=... 行
            for quote in self._parse_frame(data):
                self._quotes[quote.symbol] = quote
                yield quote

    def get_cached_quote(self, symbol: str) -> Optional[Quote]:
        """获取缓存的行情 (不发起请求)"""
        return self._quotes.get(symbol)
```

#### 4.1.4 行情管理器 (统一入口)

```python
class QuoteManager:
    """行情管理器: 按配置切换 mootdx/jvQuant, 只拉取有生效中条件单的个股"""

    def __init__(self, config_loader: ConfigLoader) -> None:
        self._config = config_loader
        channel_name, channel_config = config_loader.get_active_quote_channel()
        if channel_name == "jvquant":
            self._provider = JvQuantQuoteProvider(channel_config)
        else:
            self._provider = MootdxQuoteProvider(channel_config)
        self._active_symbols: set[str] = set()

    def set_active_symbols(self, symbols: set[str]) -> None:
        """设置需要监控的股票 (从活跃条件单中提取)"""
        self._active_symbols = symbols

    async def start(self) -> None:
        """启动行情流"""
        if isinstance(self._provider, JvQuantQuoteProvider):
            await self._provider.connect()
            await self._provider.subscribe(list(self._active_symbols))
            async for quote in self._provider.listen():
                self._on_quote(quote)
        else:
            # mootdx 轮询模式
            while True:
                quotes = self._provider.fetch_quotes(list(self._active_symbols))
                for quote in quotes.values():
                    self._on_quote(quote)
                await asyncio.sleep(3)

    def _on_quote(self, quote: Quote) -> None:
        """行情更新回调 → 条件单求值"""
        from app.services import TrendTraderService
        service = TrendTraderService.get_instance()
        service.evaluate_condition_orders(quote.symbol, quote.price)
        # 通过 WebSocket 推送到前端
        service.broadcast_quote(quote)
```

### 4.2 交易模块 (trading/)

#### 4.2.1 抽象接口

```python
# backend/app/trading/gateway.py

from abc import ABC, abstractmethod

class TradingGateway(ABC):
    """交易网关抽象基类"""

    @abstractmethod
    def connect(self, config: dict) -> bool:
        """连接交易网关, 返回是否成功"""
        ...

    @abstractmethod
    def query_asset(self) -> dict:
        """查询资金: {total_asset, market_value, cash, frozen_cash}"""
        ...

    @abstractmethod
    def query_positions(self) -> list[dict]:
        """查询持仓: [{symbol, volume, avg_cost, market_value, unrealized_pnl}]"""
        ...

    @abstractmethod
    def query_orders(self, today_only: bool = True) -> list[dict]:
        """查询委托: [{order_id, symbol, type, price, volume, traded_volume, status}]"""
        ...

    @abstractmethod
    def place_order(self, symbol: str, side: str, price: float, volume: int) -> dict:
        """下单: {entrust_no, status}"""
        ...

    @abstractmethod
    def cancel_order(self, entrust_no: str) -> bool:
        """撤单: 返回是否成功"""
        ...

    @abstractmethod
    def disconnect(self) -> None:
        """断开连接"""
        ...
```

#### 4.2.2 MiniQMT HTTP 网关

Mac 端的客户端，通过 HTTP 调用 Windows 小主机上的交易网关。

```python
# backend/app/trading/miniqmt_gateway.py

class MiniQmtGateway(TradingGateway):
    """MiniQMT 交易网关 (HTTP 客户端)

    Windows 端运行 trading-gateway/server.py 提供 HTTP API,
    Mac 端通过局域网 HTTP 调用。

    注意: MiniQMT 客户端需要先在 Windows 上登录,
         trading-gateway 通过 xtquant 连接已登录的 MiniQMT。
    """

    def __init__(self, base_url: str) -> None:
        self._base_url = base_url.rstrip("/")

    def connect(self, config: dict) -> bool:
        resp = requests.post(f"{self._base_url}/connect", json=config, timeout=10)
        return resp.json().get("success", False)

    def place_order(self, symbol: str, side: str, price: float, volume: int) -> dict:
        resp = requests.post(f"{self._base_url}/order", json={
            "symbol": symbol,
            "side": side,       # buy | sell
            "price": price,
            "volume": volume,
            "price_type": "limit",  # limit | market
        }, timeout=10)
        return resp.json()

    def query_positions(self) -> list[dict]:
        resp = requests.get(f"{self._base_url}/positions", timeout=10)
        return resp.json().get("positions", [])

    # ... 其他方法类似
```

#### 4.2.3 Windows 交易网关 (trading-gateway/)

```python
# trading-gateway/server.py

"""
Windows 端交易网关, 运行在 Windows 小主机上。

启动: python server.py --port 8800 --miniqmt-path "D:\国金证券QMT交易端\userdata_mini"

提供 HTTP API:
  POST /connect      - 连接 MiniQMT
  GET  /positions    - 查询持仓
  GET  /asset        - 查询资金
  GET  /orders       - 查询委托
  POST /order        - 下单
  POST /cancel       - 撤单
"""

from xtquant import xtdata, xttrader, xtconstant
from flask import Flask, request, jsonify

app = Flask(__name__)
_trader = None
_account = None

@app.route("/connect", methods=["POST"])
def connect():
    global _trader, _account
    data = request.json
    path = data["miniqmt_path"]
    account_id = data.get("stock_account", "")

    session_id = random.randint(100000, 999999)
    _trader = xttrader.XtQuantTrader(path, session_id)
    _trader.start()
    result = _trader.connect()
    if result != 0:
        return jsonify({"success": False, "message": f"connect failed: {result}"})

    _account = xttrader.StockAccount(account_id) if account_id else None
    _trader.subscribe(_account)
    return jsonify({"success": True})

@app.route("/order", methods=["POST"])
def place_order():
    data = request.json
    order_type = xtconstant.STOCK_BUY if data["side"] == "buy" else xtconstant.STOCK_SELL
    price_type = xtconstant.FIX_PRICE if data.get("price_type") == "limit" else xtconstant.MARKET_PEER_PRICE_FIRST

    order_id = _trader.order_stock(
        account=_account,
        stock_code=f"{data['symbol']}.{_get_exchange(data['symbol'])}",
        order_type=order_type,
        order_volume=data["volume"],
        price_type=price_type,
        price=data.get("price", 0),
    )
    return jsonify({"entrust_no": order_id, "status": "submitted"})

# ... /positions, /asset, /orders, /cancel 类似

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8800)
```

#### 4.2.4 模拟交易 (Paper Trading)

```python
# backend/app/trading/paper_gateway.py

class PaperTradingGateway(TradingGateway):
    """模拟交易: 内存撮合, 按行情价格成交"""

    def __init__(self, config: dict) -> None:
        self._cash = config.get("initial_cash", 100000)
        self._positions: dict[str, dict] = {}
        self._orders: list[dict] = []
        self._commission_rate = config.get("commission_rate", 0.00025)
        self._stamp_duty = config.get("stamp_duty", 0.001)
```

#### 4.2.5 交易管理器

```python
class TradeManager:
    """交易管理器: 根据配置切换 dry_run / paper / live"""

    def __init__(self, config_loader: ConfigLoader) -> None:
        mode = config_loader.trading.get("mode", "dry_run")
        if mode == "live":
            miniqmt_config = config_loader.trading.get("miniqmt", {})
            self._gateway = MiniQmtGateway(miniqmt_config["gateway_url"])
        elif mode == "paper":
            self._gateway = PaperTradingGateway(config_loader.trading.get("paper", {}))
        else:
            self._gateway = DryRunGateway()  # 只记录日志, 不实际交易

    def execute_condition_trade(self, order: ConditionOrder) -> dict:
        """条件单触发时执行交易 (仅由条件单触发, 不在前端暴露下单)"""
        if self._gateway.mode == "dry_run":
            return {"status": "dry_run", "message": "dry run mode, order not placed"}

        # 风控检查
        if not self._risk_check(order):
            return {"status": "blocked", "message": "risk check failed"}

        return self._gateway.place_order(
            symbol=order.symbol,
            side=order.action.get("side", "buy"),
            price=order.action.get("price", 0),
            volume=order.action.get("volume", 100),
        )
```

### 4.3 K线数据模块 (data/kline_db.py)

#### 4.3.1 数据同步流程

```
1. 初始化: 检查 DuckDB 是否有最近 15 年数据
   ├─ 缺失 → 从 QUANTAXIS (优先) 或 mootdx 下载全量历史数据
   └─ 已有 → 增量更新 (最近 N 天)
   
2. 增量更新: 每个交易日 15:30 之后
   ├─ 检查 trade_calendar 今天是否为交易日
   ├─ 从 QUANTAXIS (优先) 或 mootdx 拉取最新日K
   ├─ 写入 bars_1d
   ├─ 聚合生成 bars_1w (按周最后交易日)
   └─ 聚合生成 bars_1M (按月最后交易日)

3. 定时任务: 新增一个 schedule "K线数据更新"
   触发: 15 30 * * 1-5
   步骤: kline_db.update_all()
```

#### 4.3.2 数据来源: QUANTAXIS 优先, mootdx 补充

```python
def download_history(self, symbol: str, start_year: int) -> list[DailyBar]:
    """下载历史K线"""
    # 优先 QUANTAXIS
    try:
        from QUANTAXIS import QA_fetch_stock_day_adv
        data = QA_fetch_stock_day_adv(symbol, f"{start_year}-01-01", date.today().isoformat())
        if data is not None and not data.data.empty:
            return _qa_to_bars(data)
    except Exception:
        pass

    # 降级 mootdx
    try:
        from mootdx.quotes import Quotes
        client = Quotes.factory(market="std")
        # frequency=9 for daily bars
        bars_data = client.bars(symbol=symbol, frequency=9, offset=4000)  # ~15 years
        return _mootdx_to_bars(bars_data)
    except Exception:
        pass

    # 最终降级 sample
    return SampleDailyBarProvider().fetch_daily_bars(symbol)
```

### 4.4 Agent 工具调用循环 (agent/tool_loop.py)

```python
class AgentToolLoop:
    """Agent 工具调用循环

    执行流程:
    1. 构建 messages: [system(agent.system_prompt + tools_def)] + [user(prompt)]
    2. 调用 LLM API (with tools)
    3. 如果 LLM 返回 tool_calls → 逐个调用 ToolRegistry.invoke()
       → 追加 tool_result messages → 回到步骤 2
    4. 如果 LLM 返回 text → 返回最终回复
    5. 最多 agent.max_turns 轮 (默认 8)

    前端展示: 每个 tool_call/tool_result 作为聊天消息中的可折叠块
    """

    def __init__(self, service: TrendTraderService) -> None:
        self._service = service

    async def run(self, agent: dict, prompt: str, context: dict) -> AgentRunResult:
        tool_defs = self._build_openai_tool_defs(agent["tools_allowed"])
        messages = [
            {"role": "system", "content": self._build_system_prompt(agent, tool_defs)},
            {"role": "user", "content": prompt},
        ]

        tool_calls_log = []
        for turn in range(agent.get("max_turns", 8)):
            response = await self._call_llm(agent, messages, tool_defs)
            choice = response["choices"][0]

            if choice["finish_reason"] == "tool_calls":
                for tc in choice["message"]["tool_calls"]:
                    tool_name = tc["function"]["name"]
                    tool_args = json.loads(tc["function"]["arguments"])
                    result = self._service.tools.invoke(tool_name, tool_args, source="agent", confirmed=True)
                    tool_calls_log.append({
                        "turn": turn, "tool": tool_name,
                        "args": tool_args, "result": result.model_dump(mode="json"),
                    })
                    messages.append(choice["message"])
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc["id"],
                        "content": json.dumps(result.model_dump(mode="json"), ensure_ascii=False),
                    })
                continue

            return AgentRunResult(
                output={"text": choice["message"]["content"], "tool_calls": tool_calls_log},
                status="ok",
            )

        return AgentRunResult(
            output={"text": "达到最大对话轮次", "tool_calls": tool_calls_log},
            status="max_turns",
        )
```

### 4.5 策略通用执行引擎 (strategies/engine.py)

详见实现指引文档。

---

## 五、API 设计

### 5.1 REST 端点 (全部)

| 方法 | 路径 | 用途 | 变更 |
|------|------|------|------|
| GET | `/api/health` | 健康检查 | 现有 |
| POST | `/api/analyze` | 单股分析 | 现有 |
| POST | `/api/screener/run` | 批量选股 | 现有 |
| GET | `/api/strategies` | 策略列表 | 现有 |
| POST | `/api/strategies` | 保存策略 | 现有 |
| POST | `/api/strategies/draft` | AI 生成策略 | 现有 |
| **POST** | **`/api/strategies/{id}/explain`** | **[NEW] 策略释义** | |
| **POST** | **`/api/strategies/{id}/backtest`** | **[NEW] 回测 (入口)** | |
| **GET** | **`/api/strategies/{id}/backtests`** | **[NEW] 回测列表** | |
| GET | `/api/pools` | 股票池列表 | 现有 |
| POST | `/api/pools` | 保存股票池 | 现有 |
| POST | `/api/pools/{id}/items` | 添加股票 | 现有 |
| GET | `/api/condition-orders` | 条件单列表 | 现有 |
| POST | `/api/condition-orders` | 创建条件单 | 现有 |
| **POST** | **`/api/condition-orders/ai-create`** | **[NEW] AI 创建条件单** | |
| POST | `/api/condition-orders/{id}/enable` | 启用条件单 | 现有 |
| POST | `/api/condition-orders/{id}/disable` | 停用条件单 | 现有 |
| GET | `/api/schedules` | 定时任务列表 | 现有 |
| POST | `/api/schedules` | 创建定时任务 | 现有 |
| POST | `/api/schedules/{id}/run` | 执行定时任务 | 现有 |
| GET | `/api/events` | 事件列表 | 现有 |
| GET | `/api/monitor/quotes` | 实时行情 (REST) | 现有 |
| **GET** | **`/api/monitor/quotes/stream`** | **[NEW] 行情 WebSocket** | |
| GET | `/api/alerts` | 提醒列表 | 现有 |
| POST | `/api/watchlist/sync` | 同步监控 | 现有 |
| POST | `/api/watchlist/tick` | 推送价格 | 现有 |
| **GET** | **`/api/kline/{symbol}`** | **[NEW] 获取K线 (从 DuckDB)** | |
| **GET** | **`/api/kline/symbols`** | **[NEW] 证券列表** | |
| **GET** | **`/api/trading/status`** | **[NEW] 交易状态 (资产/持仓)** | |
| GET | `/api/ai/providers` | 模型渠道列表 | 现有 |
| POST | `/api/ai/providers` | 保存渠道 | 现有 |
| GET | `/api/ai/model-profiles` | 模型配置列表 | 现有 |
| POST | `/api/ai/model-profiles` | 保存配置 | 现有 |
| POST | `/api/ai/model-profiles/{id}/test` | 测试模型 | 现有 |
| GET | `/api/ai/skills` | 技能列表 | 现有 |
| POST | `/api/ai/skills` | 保存技能 | 现有 |
| GET | `/api/ai/agents` | Agent 列表 | 现有 |
| POST | `/api/ai/agents` | 保存 Agent | 现有 |
| POST | `/api/ai/agents/{id}/run` | 运行 Agent | 现有 (重构为 tool_loop) |
| GET | `/api/ai/teams` | 团队列表 | 现有 |
| POST | `/api/ai/teams/{id}/run` | 运行团队 | 现有 |
| GET | `/api/tools` | 工具列表 | 现有 |
| POST | `/api/tools/invoke` | 调用工具 | 现有 |
| GET | `/api/chat/sessions` | 聊天会话 | 现有 |
| POST | `/api/chat/sessions/{id}/messages` | 发送消息 | 现有 |
| **GET** | **`/api/config`** | **[NEW] 查看当前配置 (脱敏)** | |
| **POST** | **`/api/config/reload`** | **[NEW] 重新加载配置** | |

### 5.2 WebSocket 端点

| 路径 | 用途 | 变更 |
|------|------|------|
| `/ws/alerts` | 提醒推送 | 现有 |
| `/ws/chat/{session_id}` | 聊天 | 现有 |
| **`/ws/quotes`** | **[NEW] 实时行情推送** | |

**`/ws/quotes` 消息格式**:
```json
{
  "type": "quote",
  "data": {
    "symbol": "002261",
    "price": 18.20,
    "change_pct": -1.19,
    "high": 18.90,
    "low": 18.00,
    "volume": 12345678,
    "timestamp": 1714459200
  }
}
```

---

## 六、交互流设计

### 6.1 核心交互流: AI 对话驱动分析

```
用户 (前端聊天)                    Agent (ToolLoop)                    ToolRegistry
      │                                │                                  │
      │ "分析002261近期趋势"            │                                  │
      │──────────────────────────────▶│                                  │
      │                                │ LLM 决定调用 strategy.analyze    │
      │                                │──────────────────────────────▶│
      │                                │                                 │ invoke("strategy.analyze",
      │                                │                                 │   {symbol:"002261", strategy:"trend_trading"})
      │                                │                                 │ → StrategyAnalysis
      │                                │◀──────────────────────────────│
      │                                │ LLM 收到 tool_result,            │
      │                                │ 生成自然语言解读                  │
      │                                │                                 │
      │ 聊天回复 (含评分卡片 +          │                                 │
      │  [查看K线图] [加入监控] 按钮)   │                                 │
      │◀──────────────────────────────│                                 │
      │                                │                                 │
      │ 点击 [查看K线图]               │                                 │
      │──────▶ 前端路由跳转到           │                                 │
      │        /review/002261          │                                 │
```

### 6.2 盘中监控流

```
QuoteManager (后台轮询)             ConditionEvaluator              NotifyBus
      │                                    │                            │
      │ 每3秒拉取活跃股票行情                │                            │
      │ (只拉有生效中条件单的个股)           │                            │
      │                                    │                            │
      │ quote(symbol="002261", price=18.52)│                            │
      │──────────────────────────────────▶│                            │
      │                                    │ 求值所有 002261 的条件单     │
      │                                    │                            │
      │                                    │ 条件 "002261 ≥ 18.50" 触发  │
      │                                    │──────────────────────────▶│
      │                                    │                            │ notify_hermes(消息)
      │                                    │                            │ → 飞书消息已发送
      │                                    │                            │
      │                                    │ 写入 events 表              │
      │                                    │ 写入 trade_orders 表         │
      │                                    │ (如果 order_type="order")    │
      │                                    │                            │
      │                                    │ WebSocket 推送 alert        │
      │                                    │ 前端监控页实时更新           │
```

### 6.3 条件单生命周期

```
AI 对话                         条件单持久化                    盘中监控
   │                                │                              │
   │ "002261突破18.5时通知我"        │                              │
   │────────────────────▶           │                              │
   │ condition_order.ai_create      │                              │
   │ → AI 解析意图                  │                              │
   │ → 生成条件 DSL:                │                              │
   │   {op: "gte",                   │                              │
   │    left: {var: "last_price"},   │                              │
   │    right: 18.5}                 │                              │
   │ → 保存到 condition_orders 表    │                              │
   │                                │ 启用状态: active              │
   │                                │                              │
   │                                │              QuoteManager 推送行情
   │                                │              price = 18.52    │
   │                                │──────────────────────────────▶│
   │                                │              条件满足!        │
   │                                │              ─────────        │
   │                                │              1. 写入 event    │
   │                                │              2. Hermes 飞书   │
   │                                │              3. 如 order_type │
   │                                │                 = "order"     │
   │                                │                 → TradeManager│
   │                                │              4. 记录 last_    │
   │                                │                 triggered_at  │
   │                                │              5. 今日去重      │
```

### 6.4 策略 AI 创建流

```
用户 (前端策略页)                  Agent (ToolLoop)              策略引擎
      │                                │                            │
      │ "创建一个5日线上穿20日线       │                            │
      │  且放量的买入策略"              │                            │
      │──────────────────────────────▶│                            │
      │                                │ strategy.generate           │
      │                                │──────────────────────────▶│
      │                                │                            │
      │                                │   LLM 分析需求 →            │
      │                                │   生成 StrategySpec JSON:   │
      │                                │   {                         │
      │                                │     features: [             │
      │                                │       {name: "ma_cross",    │
      │                                │        params: {fast:5,     │
      │                                │                 slow:20}},  │
      │                                │       {name: "volume_ratio",│
      │                                │        params: {period:20,  │
      │                                │                 min:1.5}}   │
      │                                │     ],                      │
      │                                │     scoring: [              │
      │                                │       {name: "trend",       │
      │                                │        weight: 40},         │
      │                                │       {name: "volume",      │
      │                                │        weight: 30},         │
      │                                │       {name: "risk_reward", │
      │                                │        weight: 30}          │
      │                                │     ]                       │
      │                                │   }                         │
      │                                │                            │
      │                                │   引擎验证:                  │
      │                                │   - feature 算子存在?       │
      │                                │   - scoring 权重和=100?     │
      │                                │   - filter 算子存在?        │
      │                                │   → 通过, 持久化            │
      │                                │◀──────────────────────────│
      │                                │                            │
      │  策略卡片 (含释义 +             │                            │
      │  [回测] [运行选股] 按钮)       │                            │
      │◀──────────────────────────────│                            │
```

---

## 七、前端设计

### 7.1 布局: Chat-First 指挥中心

```
┌──────────────────────────────────────────────────────────────┐
│  topbar: trend-trader · [14:35:28 CST] · [飞书✓] · [交易:模拟]  │
├────────┬──────────────────────────────────────┬──────────────┤
│        │                                      │              │
│  NAV   │         主内容区                      │  上下文面板   │
│        │  (当前视图切换)                       │  (可折叠)     │
│  💬    │                                      │              │
│  📈    │  ┌────────────────────────────────┐  │  当前股票     │
│  🎯    │  │  K线 / 表格 / 策略卡片          │  │  002261      │
│  📦    │  │                                │  │  评分 72     │
│  📡    │  │  根据左侧导航切换视图            │  │  [详情]      │
│  ⏰    │  │                                │  │              │
│  ⚙    │  └────────────────────────────────┘  │  AI 调用      │
│        │                                      │  记录         │
│  ◎     │  ┌────────────────────────────────┐  │              │
│ 连接   │  │  ▸ 聊 天 输 入 区 (始终可见)    │  │  最近事件     │
│ 状态   │  │  [@Agent▼] [/tool▼]     [发送]  │  │              │
│        │  └────────────────────────────────┘  │              │
└────────┴──────────────────────────────────────┴──────────────┘
```

**关键规则**:
- 聊天输入区始终固定在底部，不受视图切换影响
- 上下文面板默认展开，可折叠
- 左侧导航 7 个图标: 💬AI对话 📈复盘 🎯策略 📦股票池 📡监控 ⏰任务 ⚙设置

### 7.2 视图设计 (6 个主视图)

详见架构设计文档四章（已在前一版本中详细描述）。

### 7.3 视图联动

| 触发 | 来源视图 | 目标视图 | 动作 |
|------|---------|---------|------|
| 聊天中 [查看K线图] 按钮 | AI | 复盘 | `navigate('/review/002261')` |
| 策略卡片 [运行选股] | 策略 | 复盘 | `navigate('/review?strategy=xxx&screener=true')` |
| 复盘分析 [加入监控] | 复盘 | 监控 | 自动创建条件单 → `navigate('/monitor')` |
| 点击股票池行 | 股票池 | 复盘 | `navigate('/review/000001')` |
| 点击监控事件 | 监控 | 复盘 | 点击事件中的股票代码→跳转K线 |
| 导航切换 | 任意 | 任意 | 聊天输入区不丢失状态 |

### 7.4 路由设计

```
/                        → AI 对话 (默认首页)
/review                  → 复盘
/review/:symbol          → 复盘 (指定股票, 自动分析)
/review?strategy=&screener=true → 复盘 (批量选股模式)
/strategy                → 策略列表
/strategy/:id            → 策略详情 (释义/编辑/回测入口)
/pool                    → 股票池
/monitor                 → 监控 (行情+条件单+事件)
/schedule                → 定时任务
/settings                → 设置 (模型/Agent/Skill/配置管理)
```

### 7.5 技术选型

| 层 | 选型 | 说明 |
|----|------|------|
| 框架 | React 19 + TypeScript 5 | 现有 |
| 构建 | Vite 6 | 现有 |
| 样式 | Tailwind CSS 4 + shadcn/ui | [NEW] |
| 图表-K线 | lightweight-charts 4 (TradingView) | [NEW] 替换 klinecharts |
| 图表-数据 | Recharts 2 | [NEW] |
| 路由 | React Router 7 | [NEW] |
| 图标 | Lucide React | [NEW] |
| 状态 | React Context + useReducer | [NEW] 替换纯 useState |
| 测试 | Vitest + Testing Library | [NEW] |

---

## 八、风格规约

### 8.1 设计理念

**「指挥中心」**: 融合 Bloomberg 终端的数据密度与现代 AI 产品的对话式交互。

### 8.2 色彩系统

```css
/* 背景层 */
--base-950:    #02040a;  /* 最深背景 (主画布) */
--base-900:    #0a0d14;  /* 卡片/面板背景 */
--base-850:    #131720;  /* 悬浮/hover 状态 */
--base-800:    #1a1f2e;  /* 边框/分割线 */

/* 数据色 */
--up-gain:     #00d4aa;  /* 上涨/盈利 (青绿 neon) */
--down-loss:   #ff4757;  /* 下跌/亏损 (珊瑚红) */
--warn:        #fbbf24;  /* 警告/关注 (琥珀) */
--info:        #38bdf8;  /* 信息/中性 (天蓝) */

/* 语义色 */
--buy-long:    #00d4aa;  /* 买入/做多 */
--sell-short:  #ff4757;  /* 卖出/做空 */
--neutral:     #94a3b8;  /* 无信号 */
--triggered:   #fbbf24;  /* 条件触发 */

/* 品牌色 */
--primary:     #00d4aa;  /* 主色调 (青绿) */
--accent:      #6c5ce7;  /* 强调色 (紫罗兰) */
--surface:     rgba(255,255,255,0.04);  /* 微妙的表面纹理 */
```

### 8.3 视觉效果

- **Glassmorphism**: 顶部导航和弹出面板使用 `backdrop-blur-xl` + `bg-base-900/80`
- **Neon glow**: 关键数据使用 `box-shadow: 0 0 15px rgba(0,212,170,0.3)` 实现霓虹发光
- **微动画**: 数字变化用 `transition-all duration-300`; 加载态用 `animate-pulse` 骨架屏
- **数据密度可调**: 紧凑模式 `text-xs` / 舒适模式 `text-sm`

### 8.4 字体

| 用途 | 字体 | Tailwind Class |
|------|------|---------------|
| 价格 (大) | JetBrains Mono | `font-mono text-2xl font-bold` |
| 涨跌幅 | JetBrains Mono | `font-mono text-base font-semibold` |
| 标题 | Inter | `font-sans text-lg font-semibold` |
| 正文 | Inter | `font-sans text-sm` |
| 辅助文字 | Inter | `font-sans text-xs text-neutral-400` |
| 表格数据 | JetBrains Mono | `font-mono text-sm` |

### 8.5 Tailwind 配置

```typescript
// tailwind.config.ts
export default {
  darkMode: "class",  // 始终暗色模式
  theme: {
    extend: {
      colors: {
        base: {
          950: "#02040a",
          900: "#0a0d14",
          850: "#131720",
          800: "#1a1f2e",
        },
        up: "#00d4aa",
        down: "#ff4757",
        warn: "#fbbf24",
        info: "#38bdf8",
        primary: "#00d4aa",
        accent: "#6c5ce7",
      },
      fontFamily: {
        sans: ["Inter", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
    },
  },
};
```

### 8.6 组件风格示例

**价格显示组件**:
```tsx
// 涨: 绿色 + ↑; 跌: 红色 + ↓; 平: 灰色
function PriceDisplay({ price, change }: { price: number; change?: number }) {
  const color = !change ? "text-neutral-400" : change > 0 ? "text-up" : "text-down";
  const arrow = !change ? "" : change > 0 ? "↑" : "↓";
  return (
    <span className={`font-mono ${color}`}>
      {price.toFixed(2)} {arrow}
    </span>
  );
}
```

**指标卡片**:
```tsx
function MetricCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-base-900 rounded-lg p-4 border border-base-800 hover:border-primary/30 transition-colors">
      <div className="text-xs text-neutral-400 mb-1">{label}</div>
      <div className={`font-mono text-2xl font-bold ${color} drop-shadow-[0_0_8px_rgba(0,212,170,0.3)]`}>
        {value.toFixed(1)}
      </div>
    </div>
  );
}
```

**数据表**:
```tsx
// 支持点击表头排序，升序↑降序↓
// 行 hover 高亮，点击行触发 onRowClick
// 数据列: 价格列右对齐 + 颜色标记涨跌
```

### 8.7 前端代码规约

1. **组件拆分**: 页面组件放 `pages/`, 可复用组件放 `components/`
2. **类型优先**: 所有 props 必须声明 TypeScript 接口
3. **无 any**: 禁止使用 `any` 类型，用 `unknown` + 类型守卫替代
4. **样式优先 Tailwind**: 禁止 inline style 和 CSS Module (除非动画/复杂样式)
5. **颜色用 token**: 涨跌颜色一律用 `text-up` / `text-down` 等语义 token
6. **数字格式化**: 价格保留 2 位小数, 涨跌幅保留 2 位小数 + % 符号
