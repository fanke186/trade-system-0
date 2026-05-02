# 交易系统Agents 版面与功能模块重构设计

> 合并现有 Agent 页面与 TradeSystem 页面为一个统一的三栏布局页面，升级交易系统概念为独立 Agent。

## 1. 变更范围

### 合并
- **Agent 页面** (`src/pages/AgentPage.tsx`) — 删除
- **TradeSystem 页面** (`src/pages/TradeSystemPage.tsx`) — 删除
- **新建** `src/pages/TradeSystemAgentsPage.tsx` — 统一入口

### 概念升级
- 一个交易系统 = 一个独立 Agent
- 交易系统的完整框架由 `docs/trading-system-template.md` 定义
- Agent 的知识来源于其关联的 `system.md`

## 2. DB 表模型

### 2.1 `trade_systems` 表（扩展）

```sql
-- 对现有 trade_systems 表扩展
ALTER TABLE trade_systems ADD COLUMN description TEXT;
ALTER TABLE trade_systems ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE trade_systems ADD COLUMN system_md TEXT NOT NULL DEFAULT '';
ALTER TABLE trade_systems ADD COLUMN system_path TEXT;
ALTER TABLE trade_systems ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE trade_systems ADD COLUMN updated_at TIMESTAMP;

-- 活跃名称唯一约束
CREATE UNIQUE INDEX idx_trade_systems_name_active
    ON trade_systems(name) WHERE status = 'active';
```

**设计要点：**
- `name` 全局唯一（仅限 active 记录），软删除后可同名重建
- `version` 当前版本号，每次发布 +1
- `system_md` 直接存交易系统 markdown 正文（SSOT）
- `system_path` 文件路径 `agents/{name}/system.md`，方便删除时定位
- `status` = `active` | `deleted`，逻辑删除不物理删除
- 删除时：改 status → 删 `agents/{name}/` 目录 → 关联表记录保留（标记 deleted）

### 2.2 `trade_system_versions` 表（存量）

现有表已基本满足需求，补一个 `change_summary`：

```sql
ALTER TABLE trade_system_versions ADD COLUMN change_summary TEXT;
```

版本号继续递增规则：同 name 下最大 version +1（跨软删除周期）。

### 2.3 `trade_system_stocks` 表（新建）

```sql
CREATE TABLE trade_system_stocks (
    id                TEXT PRIMARY KEY,
    trade_system_id   TEXT NOT NULL REFERENCES trade_systems(id),
    symbol            TEXT NOT NULL,
    latest_score      INTEGER,
    latest_report     TEXT,
    latest_report_path TEXT,
    latest_score_date TEXT,
    updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(trade_system_id, symbol)
);
```

**评分日期逻辑**（service 层处理）：
- 评分时是交易日 + 收盘后 → 记当天
- 评分时是交易日 + 收盘前 → 记 T-1
- 评分时是非交易日 → 记当天

## 3. 文件目录

```
agents/
├── 趋势交易/
│   └── system.md          # 交易系统 markdown（从 DB 同步写出）
├── 价值交易/
│   └── system.md
└── ...
```

- 发布新版本时：写 `agents/{name}/system.md`（覆盖）
- 删除交易系统时：删除 `agents/{name}/` 整个目录
- 版本历史只在 `trade_system_versions` 表中保存

## 4. 路由变更

`src/app/App.tsx` 和 `src/app/routes.ts`：

| 变更 | 说明 |
|------|------|
| 删除 `agent` 路由 | 合并到 trade-system-agents |
| 删除 `trade-system` 路由 | 合并到 trade-system-agents |
| 新增 `trade-system-agents` 路由 | 新页面，作为第二 tab |

导航栏 tab 变更：
- 删除 "Agent" tab
- 删除 "交易系统" tab
- 新增 "交易系统Agents" tab

## 5. 主页面：三栏布局

```
┌──────────────────────────────────────────────────────────────┐
│ 左栏 280px          中栏 320px         右栏 flex-1            │
│                                                            │
│ [+ 新建交易系统]     关联标的列表         选中标的详细评估       │
│                     代码/名称/涨跌/评分                         │
│ 交易系统卡片×N       可排序、可选中                             │
│ (名称/版本/摘要/编辑)                                          │
└──────────────────────────────────────────────────────────────┘
```

### 5.1 左栏：交易系统卡片列表

**卡片内容：**
- 名称（大字体，mono）
- 版本号（Badge: `V2`）
- 更新时间（`2026-05-02`）
- 一句话摘要（描述列，单行截断）
- 关联标的数（`关联标的: 12`）
- 右上角 ✏️ 编辑按钮

**卡片样式：**
- 默认 `bg-panel border-border`
- 选中态 `border-primary shadow-glow`（与现有设计规范一致）
- 旧版本（非最大版本号）`opacity-60`
- 卡片间距 `gap-2`

**新建按钮：**
- 卡片列表顶部，`+` 图标按钮，`variant="secondary"`
- 点击 → 弹出输入框输入名称 → 幂等检查 → 打开 chatbot 子窗口（空白模板）

### 5.2 中栏：关联标的列表

**表头：** 代码 · 名称 · 涨跌幅 · 评分

**数据来源：** `trade_system_stocks` JOIN `securities` + `kline_bars`（最新价/涨跌）

**功能：**
- 点击列头切换升序/降序（默认按评分降序）
- 点击行 → 选中该标的 → 右栏更新
- 选中行高亮 `bg-primary/10`

**涨跌幅颜色：** 正数 `#22c55e`，负数沿用涨跌配色

### 5.3 右栏：标的详细评估

| 板块 | 说明 | 数据来源 |
|------|------|---------|
| 股票元信息 | 名称/代码/最新价/涨跌幅/行业/交易所 | securities + kline_bars |
| 总评分 | 0-100 大字体 + 颜色条 | trade_system_stocks.latest_score |
| 摘要 | 2-3 句话评分总结 | trade_system_stocks.latest_report |
| 推荐明日操作 | 操作建议段落 | 从 latest_report 中提取 |
| 评分报告链接 | 📄 超链接，点击浏览器打开 | latest_report_path |
| 其他 | 预留空白区域 | — |

### 5.4 总评分颜色方案

| 分数段 | 颜色 | CSS |
|--------|------|-----|
| 80-100 | `#4d90fe` | text-primary |
| 60-79  | `#22c55e` | text-green-500 |
| 40-59  | `#f0b93b` | text-warning |
| 20-39  | `#ff6b35` | text-danger |
| 0-19   | `#ef4444` | text-red-500 |

渲染：大号 mono 数字（`text-6xl font-mono`）+ 下方颜色进度条 + 文字标签。

## 6. Chatbot 编辑子窗口

### 6.1 窗口结构

Tauri `WebviewWindow` 独立窗口，标题 `QSGG — 编辑交易系统`。

```
┌──────────────────────┬─────────────────────────────────────┐
│ Markdown 实时预览     │ AI 对话区                           │
│ (320px)              │                                    │
│                      │ 对话历史                            │
│ react-markdown       │ 逐条展示用户输入和 AI diff 建议      │
│ + remark-gfm         │ 每条 AI 消息下方有 [接受] [拒绝]    │
│                      │                                    │
│                      │ 底部输入框 + 发送按钮               │
│                      │ 最底部 [📄 发布新版本] 按钮         │
└──────────────────────┴─────────────────────────────────────┘
```

### 6.2 AI IO 占位符

**本次版本不实现真实 AI 调用**。预留接口：

```typescript
// src/lib/agentChat.ts — 占位，后续版本接入真实 LLM
async function sendChatMessage(
  systemPrompt: string,  // 包含交易系统模板 + 当前 markdown
  history: ChatMessage[],
  userMessage: string
): Promise<{ markdown: string; diff: string }> {
  // TODO: 对接真实的 LLM provider
  throw new Error('Agent chat 尚未实现')
}
```

占位期间行为：
- 发送消息后显示 loading 状态 2 秒
- 返回占位回复："Agent 对话功能将在后续版本实现。当前版本请直接编辑 Markdown。"

### 6.3 交互流程

1. **编辑已有系统**：打开窗口 → 加载当前 system_md 到左面板 → 聊天区显示系统提示
2. **对话修改**：用户输入修改需求 → AI 返回 diff → 用户接受/拒绝 → 左面板更新
3. **发布新版本**：
   - 弹出确认框："将发布 V{N+1}，确认？"
   - 保存：`trade_system_versions` 插入新记录 → `trade_systems` 更新 version、system_md、updated_at → 写出 `agents/{name}/system.md`
4. **新建交易系统**：
   - 先弹输入框：输入名称 → 幂等检查（同名 active 是否存在）
   - 通过后打开 chatbot 窗口，system_md 初始值为模板骨架

## 7. 旧代码清理清单

| 文件 | 操作 |
|------|------|
| `src/pages/AgentPage.tsx` | 删除 |
| `src/pages/TradeSystemPage.tsx` | 删除 |
| `src/app/App.tsx` | 删除 agent/trade-system 路由，新增 trade-system-agents |
| `src/app/routes.ts` | 调整 PageId 和导航配置 |
| `src/components/layout/AppShell.tsx` | 调整 tab 列表 |
| `src-tauri/src/commands/agent.rs` | 保留（create_agent_from_trade_system/run_agent_chat 后续版本用） |
| `src-tauri/src/commands/trade_system.rs` | 扩展：新增 add_trade_system_stocks（已有），新增版本管理接口 |
| `src-tauri/src/db/sqlite.rs` | 新增 trade_systems 扩展列 migration + trade_system_stocks DDL |

## 8. 实现顺序

| 步骤 | 内容 | 依赖 |
|------|------|------|
| 1 | DB migration: trade_systems 扩展列 + trade_system_stocks 表 | — |
| 2 | Rust service: trade_system 版本管理 CRUD 补全 | 1 |
| 3 | Rust command: trade_system_stocks 关联/解绑/评分读写 | 1 |
| 4 | 前端: TradeSystemAgentsPage 三栏布局骨架 | — |
| 5 | 前端: 左栏交易系统卡片列表 + 新建按钮 | 2, 4 |
| 6 | 前端: chatbot 编辑子窗口（含占位 AI） | 2, 4 |
| 7 | 前端: 中栏关联标的列表 | 3, 4 |
| 8 | 前端: 右栏标的详细评估面板 | 3, 4 |
| 9 | 路由变更: 删除旧页面，新增 tab | 5-8 |
| 10 | 端到端验证 | 全部 |

## 9. 依赖

```bash
npm install react-markdown remark-gfm  # Markdown 预览
```
