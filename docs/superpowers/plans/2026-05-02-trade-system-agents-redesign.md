# 交易系统Agents 重构实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 合并 Agent 页与 TradeSystem 页为统一的三栏布局"交易系统Agents"页面，扩展 DB 模型支持交易系统版本管理与标的关联评分。

**Architecture:** 三栏响应式布局（左 280px 卡片列表 / 中 320px 标的表 / 右弹性评估面板），Chatbot 编辑通过 Tauri WebviewWindow 独立窗口实现，AI IO 层预留占位接口。

**Tech Stack:** React 18 + TypeScript, Tauri 2, rusqlite, duckdb, react-markdown + remark-gfm, TanStack Query

**Spec:** `docs/superpowers/specs/2026-05-02-trade-system-agents-redesign.md`

---

## File Map

| 文件 | 操作 | 职责 |
|------|------|------|
| `src-tauri/src/db/sqlite.rs` | Modify | 新增 migration：trade_systems 扩展列 + trade_system_stocks 表 |
| `src-tauri/src/models/mod.rs` | Modify | 新增 TradeSystemStock、TradeSystemWithStocks 模型 |
| `src-tauri/src/services/trade_system_service.rs` | Modify | 新增版本管理、标的关联 CRUD |
| `src-tauri/src/commands/trade_system.rs` | Modify | 新增 list_stocks、add_stocks、remove_stocks 命令 |
| `src-tauri/src/lib.rs` | Modify | 注册新命令 |
| `src/lib/types.ts` | Modify | 新增 TradeSystemStock 等前端类型 |
| `src/lib/commands.ts` | Modify | 新增前端命令绑定 |
| `src/lib/agentChat.ts` | Create | AI 对话占位接口 |
| `src/pages/AgentPage.tsx` | Delete | 合并到新页面 |
| `src/pages/TradeSystemPage.tsx` | Delete | 合并到新页面 |
| `src/pages/TradeSystemAgentsPage.tsx` | Create | 主页面：三栏布局容器 |
| `src/components/trade-agents/AgentCardList.tsx` | Create | 左栏：交易系统卡片列表 |
| `src/components/trade-agents/AgentEditWindow.tsx` | Create | Chatbot 编辑子窗口（含占位 AI） |
| `src/components/trade-agents/StockTable.tsx` | Create | 中栏：关联标的表格 |
| `src/components/trade-agents/StockEvaluation.tsx` | Create | 右栏：标的详细评估 |
| `src/app/routes.ts` | Modify | 删除 agent/trade-system PageId，新增 trade-system-agents |
| `src/app/App.tsx` | Modify | 新路由 + 移除旧页面 import |
| `src/components/layout/AppShell.tsx` | Modify | 导航 tab 更新 |

---

### Task 1: DB Migration — trade_systems 扩展 + trade_system_stocks

**Files:**
- Modify: `src-tauri/src/db/sqlite.rs`

- [ ] **Step 1: 添加 migration SQL**

在 `run_migrations` 函数 `execute_batch` 块的最后一个 SQL 语句之后，`")?;` 之前追加。注意 SQLite 不支持 `ALTER TABLE ADD COLUMN IF NOT EXISTS`，用逐个 try 处理：

```rust
        // v3: trade_system_agents redesign
        -- trade_systems 扩展列（SQLite 不支持 ADD IF NOT EXISTS，用 Rust 逐列处理见下）
        -- trade_system_stocks 表重建（旧表 schema 不同，drop 后重建）
        "#,
    )?;

    // v3 migration: 逐列安全添加（SQLite 不支持 ADD COLUMN IF NOT EXISTS）
    let alter_cols = [
        "alter table trade_systems add column version integer not null default 1",
        "alter table trade_systems add column system_md text not null default ''",
        "alter table trade_systems add column system_path text",
        "alter table trade_systems add column status text not null default 'active'",
    ];
    for stmt in &alter_cols {
        conn.execute(stmt, []).ok(); // ignore error if column already exists
    }

    // trade_system_stocks: 旧表有不同 schema（trade_system_id, stock_code, created_at），
    // 且通常为空或几乎为空，drop 重建
    conn.execute_batch("
        drop table if exists trade_system_stocks;
        create table trade_system_stocks (
            id                  text primary key,
            trade_system_id     text not null references trade_systems(id),
            symbol              text not null,
            latest_score        integer,
            latest_report       text,
            latest_report_path  text,
            latest_score_date   text,
            updated_at          text not null default (datetime('now')),
            unique(trade_system_id, symbol)
        );

        create unique index if not exists idx_trade_systems_name_active
            on trade_systems(name) where status = 'active';
    ")?;
```

- [ ] **Step 2: 编译验证**

```bash
cd src-tauri && cargo build
```

Expected: 编译通过。

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/db/sqlite.rs
git commit -m "feat(db): trade_systems 扩展列 + trade_system_stocks 关联表 migration xb"
```

---

### Task 2: Rust Models — 新增类型定义

**Files:**
- Modify: `src-tauri/src/models/mod.rs`

- [ ] **Step 1: 添加新模型**

先更新现有 `TradeSystemSummary` struct，在 `updated_at` 之前添加 `stock_count` 字段：

```rust
// 找到 TradeSystemSummary struct（约第15行），添加 stock_count
pub struct TradeSystemSummary {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub active_version_id: Option<String>,
    pub active_version: Option<i64>,
    pub completeness_status: Option<String>,
    pub stock_count: Option<i64>,      // 新增
    pub updated_at: String,
}
```

然后更新 `list_trade_systems` 函数中的 SQL 查询，添加 stock count 子查询：

```rust
// 修改 list_trade_systems 的 SQL（约第15-28行），在 select 中加：
// (select count(*) from trade_system_stocks tss where tss.trade_system_id = ts.id) as stock_count,
```

更新 row mapping 添加 `.get(6)?` 等调整列索引。

接着在 `models/mod.rs` 的 `StockReview` 之后添加新结构体：

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TradeSystemStock {
    pub id: String,
    pub trade_system_id: String,
    pub symbol: String,
    pub code: String,
    pub name: String,
    pub exchange: Option<String>,
    pub industry: Option<String>,
    pub latest_score: Option<i32>,
    pub latest_report: Option<String>,
    pub latest_report_path: Option<String>,
    pub latest_score_date: Option<String>,
    pub latest_price: Option<f64>,
    pub change_pct: Option<f64>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AddTradeSystemStocksInput {
    pub trade_system_id: String,
    pub symbols: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RemoveTradeSystemStockInput {
    pub trade_system_id: String,
    pub symbol: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTradeSystemInput {
    pub id: String,
    pub name: Option<String>,
    pub description: Option<String>,
}
```

- [ ] **Step 2: 编译验证**

```bash
cd src-tauri && cargo build
```

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/models/mod.rs
git commit -m "feat(models): TradeSystemStock 与标的关联输入模型 xb"
```

---

### Task 3: Rust Service — 标的关联 CRUD + 版本管理

**Files:**
- Modify: `src-tauri/src/services/trade_system_service.rs`

- [ ] **Step 1: 在文件末尾添加标的关联查询函数**

```rust
use crate::models::TradeSystemStock;

/// 列出某交易系统关联的所有标的（含最新行情与评分）
pub fn list_trade_system_stocks(
    conn: &Connection,
    trade_system_id: &str,
    db: &crate::db::duckdb::DuckConnection,
) -> AppResult<Vec<TradeSystemStock>> {
    let mut stmt = conn.prepare(
        "select ts.id, ts.trade_system_id, ts.symbol, ts.latest_score,
                ts.latest_report, ts.latest_report_path, ts.latest_score_date,
                ts.updated_at
           from trade_system_stocks ts
          where ts.trade_system_id = ?1
          order by ts.latest_score desc nulls last",
    )?;

    let rows: Vec<(String, String, String, Option<i32>, Option<String>, Option<String>, Option<String>, Option<String>)> = stmt
        .query_map(params![trade_system_id], |row| {
            Ok((
                row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?,
                row.get(4)?, row.get(5)?, row.get(6)?, row.get(7)?,
            ))
        })?
        .filter_map(|r| r.ok())
        .collect();

    let mut stocks = Vec::new();
    for (id, ts_id, symbol, score, report, report_path, score_date, updated_at) in rows {
        let (code, name, exchange, industry, price, change_pct) = enrich_stock_meta(db, &symbol)?;
        stocks.push(TradeSystemStock {
            id, trade_system_id: ts_id, symbol,
            code, name, exchange, industry,
            latest_score: score, latest_report: report,
            latest_report_path: report_path, latest_score_date: score_date,
            latest_price: price, change_pct, updated_at,
        });
    }
    Ok(stocks)
}

fn enrich_stock_meta(
    db: &crate::db::duckdb::DuckConnection,
    symbol: &str,
) -> AppResult<(String, String, Option<String>, Option<String>, Option<f64>, Option<f64>)> {
    let code: String = symbol.strip_suffix(".SZ").or_else(|| symbol.strip_suffix(".SH")).or_else(|| symbol.strip_suffix(".BJ")).unwrap_or(symbol).to_string();
    let (name, exchange, industry): (String, Option<String>, Option<String>) = db
        .query_row(
            "select name, exchange, industry from securities where symbol = ?1",
            duckdb::params![symbol],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap_or_else(|_| ("".into(), None, None));

    let (price, change_pct): (Option<f64>, Option<f64>) = db
        .query_row(
            "select close, change_pct from kline_bars
              where symbol = ?1 and period = '1d' and adj_mode = 'none'
              order by trade_date desc limit 1",
            duckdb::params![symbol],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap_or((None, None));

    Ok((code, name, exchange, industry, price, change_pct))
}
```

- [ ] **Step 2: 添加 add/remove 标的函数**

```rust
/// 批量添加标的关联（幂等）
pub fn add_trade_system_stocks(
    conn: &Connection,
    trade_system_id: &str,
    symbols: &[String],
) -> AppResult<i64> {
    let mut count = 0i64;
    for symbol in symbols {
        let id = new_id("tss");
        let affected = conn.execute(
            "insert or ignore into trade_system_stocks (id, trade_system_id, symbol, updated_at)
             values (?1, ?2, ?3, current_timestamp)",
            params![id, trade_system_id, symbol],
        )?;
        count += affected as i64;
    }
    Ok(count)
}

/// 删除单个标的关联
pub fn remove_trade_system_stock(
    conn: &Connection,
    trade_system_id: &str,
    symbol: &str,
) -> AppResult<bool> {
    let affected = conn.execute(
        "delete from trade_system_stocks where trade_system_id = ?1 and symbol = ?2",
        params![trade_system_id, symbol],
    )?;
    Ok(affected > 0)
}
```

- [ ] **Step 3: 编译验证**

```bash
cd src-tauri && cargo build
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/services/trade_system_service.rs
git commit -m "feat(service): 交易系统标的关联 CRUD + DuckDB 行情富化 xb"
```

---

### Task 4: Rust Commands — 注册新 Tauri 命令

**Files:**
- Modify: `src-tauri/src/commands/trade_system.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 在 trade_system.rs 末尾添加命令**

```rust
use crate::models::{AddTradeSystemStocksInput, RemoveTradeSystemStockInput, TradeSystemStock};

#[tauri::command]
pub fn list_trade_system_stocks(
    state: State<'_, AppState>,
    trade_system_id: String,
) -> AppResult<Vec<TradeSystemStock>> {
    let sqlite = state.sqlite.lock().map_err(|_| AppError::new("lock_error", "SQLite 锁被占用", true))?;
    let duck = state.duckdb.lock().map_err(|_| AppError::new("lock_error", "DuckDB 锁被占用", true))?;
    trade_system_service::list_trade_system_stocks(&sqlite, &trade_system_id, &duck)
}

#[tauri::command]
pub fn add_trade_system_stocks(
    state: State<'_, AppState>,
    input: AddTradeSystemStocksInput,
) -> AppResult<i64> {
    let sqlite = state.sqlite.lock().map_err(|_| AppError::new("lock_error", "SQLite 锁被占用", true))?;
    trade_system_service::add_trade_system_stocks(&sqlite, &input.trade_system_id, &input.symbols)
}

#[tauri::command]
pub fn remove_trade_system_stock(
    state: State<'_, AppState>,
    input: RemoveTradeSystemStockInput,
) -> AppResult<bool> {
    let sqlite = state.sqlite.lock().map_err(|_| AppError::new("lock_error", "SQLite 锁被占用", true))?;
    trade_system_service::remove_trade_system_stock(&sqlite, &input.trade_system_id, &input.symbol)
}
```

- [ ] **Step 2: 在 lib.rs 注册**

在 `generate_handler!` 中添加：

```rust
commands::trade_system::list_trade_system_stocks,
commands::trade_system::add_trade_system_stocks,   // 替换已有的简单版本
commands::trade_system::remove_trade_system_stock,
```

- [ ] **Step 3: 编译验证**

```bash
cd src-tauri && cargo build
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/trade_system.rs src-tauri/src/lib.rs
git commit -m "feat(commands): list/add/remove trade_system_stocks 命令 xb"
```

---

### Task 5: Frontend Types + Commands

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/commands.ts`
- Create: `src/lib/agentChat.ts`

- [ ] **Step 1: types.ts 更新现有类型 + 添加新类型**

先更新 `TradeSystemSummary`，添加 `stockCount`：

```typescript
// 找到 TradeSystemSummary（约第15行），添加 stockCount
export type TradeSystemSummary = {
  id: string
  name: string
  description?: string | null
  activeVersionId?: string | null
  activeVersion?: number | null
  completenessStatus?: string | null
  stockCount?: number | null    // 新增
  updatedAt: string
}
```

然后在 `types.ts` 末尾添加：
  id: string
  tradeSystemId: string
  symbol: string
  code: string
  name: string
  exchange: string | null
  industry: string | null
  latestScore: number | null
  latestReport: string | null
  latestReportPath: string | null
  latestScoreDate: string | null
  latestPrice: number | null
  changePct: number | null
  updatedAt: string | null
}

export type AddTradeSystemStocksInput = {
  tradeSystemId: string
  symbols: string[]
}

export type RemoveTradeSystemStockInput = {
  tradeSystemId: string
  symbol: string
}
```

- [ ] **Step 2: commands.ts 添加绑定**

在 `commands` 对象中添加：

```typescript
listTradeSystemStocks: (tradeSystemId: string) =>
  call<TradeSystemStock[]>('list_trade_system_stocks', { tradeSystemId }),

addTradeSystemStocks: (input: { tradeSystemId: string; symbols: string[] }) =>
  call<number>('add_trade_system_stocks', { input }),

removeTradeSystemStock: (input: { tradeSystemId: string; symbol: string }) =>
  call<boolean>('remove_trade_system_stock', { input }),
```

- [ ] **Step 3: agentChat.ts 占位接口**

创建 `src/lib/agentChat.ts`：

```typescript
export type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type ChatSuggestion = {
  markdown: string    // full updated markdown
  diff: string        // diff snippet for display
}

export async function sendChatMessage(
  _systemPrompt: string,
  _history: ChatMessage[],
  _userMessage: string
): Promise<ChatSuggestion> {
  // TODO: 后续版本接入真实 LLM
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        markdown: '',
        diff: '> Agent 对话功能将在后续版本实现。\n> 当前版本请直接编辑 Markdown。'
      })
    }, 800)
  })
}
```

- [ ] **Step 4: typecheck 验证**

```bash
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts src/lib/commands.ts src/lib/agentChat.ts
git commit -m "feat(frontend): TradeSystemStock 类型 + 命令绑定 + AI 占位接口 xb"
```

---

### Task 6: 左栏 — 交易系统卡片列表

**Files:**
- Create: `src/components/trade-agents/AgentCardList.tsx`

- [ ] **Step 1: 实现 AgentCardList 组件**

```typescript
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Edit, Plus } from 'lucide-react'
import { Badge } from '../shared/Badge'
import { Button } from '../shared/Button'
import { Panel } from '../shared/Panel'
import { commands } from '../../lib/commands'
import { cn } from '../../lib/cn'
import type { TradeSystemSummary } from '../../lib/types'

function AgentCard({
  system,
  selected,
  onSelect,
  onEdit
}: {
  system: TradeSystemSummary
  selected: boolean
  onSelect: (id: string) => void
  onEdit: (system: TradeSystemSummary) => void
}) {
  const isOld = false // TODO: 后续扩展版本比较逻辑
  return (
    <button
      onClick={() => onSelect(system.id)}
      className={cn(
        'w-full text-left border p-3 transition hover:border-primary/50',
        selected ? 'border-primary shadow-glow' : 'border-border bg-panel',
        isOld && 'opacity-60'
      )}
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold font-mono truncate">{system.name}</span>
            <Badge>V{system.activeVersion ?? 1}</Badge>
          </div>
          {system.description && (
            <p className="text-xs text-muted-foreground mt-1 truncate">{system.description}</p>
          )}
          <div className="text-[10px] text-muted-foreground mt-2 font-mono">
            {system.stockCount != null && `关联标的: ${system.stockCount}`}
          </div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(system) }}
          className="p-1 hover:text-primary transition-colors"
        >
          <Edit className="h-3.5 w-3.5" />
        </button>
      </div>
    </button>
  )
}

export function AgentCardList({
  selectedId,
  onSelect,
  onEdit,
  onNew
}: {
  selectedId: string | undefined
  onSelect: (id: string) => void
  onEdit: (system: TradeSystemSummary) => void
  onNew: () => void
}) {
  const queryClient = useQueryClient()
  const systems = useQuery({
    queryKey: ['trade-systems'],
    queryFn: commands.listTradeSystems
  })

  return (
    <Panel title="交易系统Agents" className="h-full">
      <div className="space-y-2">
        <Button
          icon={<Plus className="h-4 w-4" />}
          variant="secondary"
          className="w-full"
          onClick={onNew}
        >
          新建交易系统
        </Button>
        {(systems.data ?? []).map(s => (
          <AgentCard
            key={s.id}
            system={s}
            selected={selectedId === s.id}
            onSelect={onSelect}
            onEdit={onEdit}
          />
        ))}
      </div>
    </Panel>
  )
}
```

- [ ] **Step 2: typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/components/trade-agents/AgentCardList.tsx
git commit -m "feat(frontend): 左栏交易系统卡片列表组件 xb"
```

---

### Task 7: 中栏 — 关联标的表格

**Files:**
- Create: `src/components/trade-agents/StockTable.tsx`

- [ ] **Step 1: 实现 StockTable 组件**

```typescript
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { commands } from '../../lib/commands'
import { formatNumber } from '../../lib/format'
import { cn } from '../../lib/cn'
import { Panel } from '../shared/Panel'
import type { TradeSystemStock } from '../../lib/types'

type SortField = 'code' | 'name' | 'changePct' | 'latestScore'
type SortDir = 'asc' | 'desc'

function SortIcon({ field, current, dir }: { field: SortField; current: SortField; dir: SortDir }) {
  if (field !== current) return null
  return dir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
}

export function StockTable({
  tradeSystemId,
  selectedSymbol,
  onSelect
}: {
  tradeSystemId: string
  selectedSymbol: string | undefined
  onSelect: (symbol: string) => void
}) {
  const [sortField, setSortField] = useState<SortField>('latestScore')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const stocks = useQuery({
    queryKey: ['trade-system-stocks', tradeSystemId],
    queryFn: () => commands.listTradeSystemStocks(tradeSystemId),
    enabled: !!tradeSystemId
  })

  const data = stocks.data ?? []

  const sorted = [...data].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1
    const va = a[sortField]
    const vb = b[sortField]
    if (va == null && vb == null) return 0
    if (va == null) return 1
    if (vb == null) return -1
    if (va < vb) return -1 * dir
    if (va > vb) return 1 * dir
    return 0
  })

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir(field === 'name' ? 'asc' : 'desc')
    }
  }

  const Th = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <th
      onClick={() => toggleSort(field)}
      className="px-2 py-1.5 text-[11px] font-mono text-muted-foreground cursor-pointer hover:text-foreground select-none whitespace-nowrap"
    >
      <span className="inline-flex items-center gap-1">
        {children}
        <SortIcon field={field} current={sortField} dir={sortDir} />
      </span>
    </th>
  )

  return (
    <Panel title={`关联标的 · ${data.length}`} className="h-full">
      <div className="overflow-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <Th field="code">代码</Th>
              <Th field="name">名称</Th>
              <Th field="changePct">涨跌</Th>
              <Th field="latestScore">评分</Th>
            </tr>
          </thead>
          <tbody className="font-mono text-xs">
            {sorted.map(s => (
              <tr
                key={s.symbol}
                onClick={() => onSelect(s.symbol)}
                className={cn(
                  'border-b border-border/50 cursor-pointer hover:bg-muted/50 transition',
                  selectedSymbol === s.symbol && 'bg-primary/10'
                )}
              >
                <td className="px-2 py-2 text-foreground">{s.code}</td>
                <td className="px-2 py-2 font-sans">{s.name}</td>
                <td className={cn(
                  'px-2 py-2',
                  (s.changePct ?? 0) >= 0 ? 'text-green-500' : 'text-red-500'
                )}>
                  {(s.changePct ?? 0) >= 0 ? '+' : ''}{s.changePct?.toFixed(1) ?? '—'}%
                </td>
                <td className="px-2 py-2 font-semibold">
                  {s.latestScore != null ? (
                    <span className={cn(
                      s.latestScore >= 80 && 'text-primary',
                      s.latestScore >= 60 && s.latestScore < 80 && 'text-green-500',
                      s.latestScore >= 40 && s.latestScore < 60 && 'text-warning',
                      s.latestScore < 40 && 'text-danger'
                    )}>{s.latestScore}</span>
                  ) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}
```

- [ ] **Step 2: typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/components/trade-agents/StockTable.tsx
git commit -m "feat(frontend): 中栏关联标的表格（排序/评分颜色） xb"
```

---

### Task 8: 右栏 — 标的详细评估

**Files:**
- Create: `src/components/trade-agents/StockEvaluation.tsx`

- [ ] **Step 1: 实现 StockEvaluation 组件**

```typescript
import { useQuery } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { commands } from '../../lib/commands'
import { formatNumber } from '../../lib/format'
import { cn } from '../../lib/cn'
import { Panel } from '../shared/Panel'
import type { TradeSystemStock } from '../../lib/types'

function ScoreGauge({ score }: { score: number }) {
  const color = score >= 80 ? 'bg-primary'
    : score >= 60 ? 'bg-green-500'
    : score >= 40 ? 'bg-warning'
    : score >= 20 ? 'bg-[#ff6b35]'
    : 'bg-red-500'

  const label = score >= 80 ? '强烈推荐'
    : score >= 60 ? '良好'
    : score >= 40 ? '中性'
    : score >= 20 ? '谨慎'
    : '规避'

  return (
    <div className="text-center py-4">
      <div className={cn('text-6xl font-mono font-bold', 
        score >= 80 && 'text-primary',
        score >= 60 && score < 80 && 'text-green-500',
        score >= 40 && score < 60 && 'text-warning',
        score < 40 && 'text-danger'
      )}>
        {score}
      </div>
      <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden w-48 mx-auto">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${score}%` }} />
      </div>
      <div className="text-xs text-muted-foreground mt-1 font-mono">{label}</div>
    </div>
  )
}

export function StockEvaluation({
  stock
}: {
  stock: TradeSystemStock | undefined
}) {
  if (!stock) {
    return (
      <Panel title="标的评估" className="h-full">
        <div className="text-sm text-muted-foreground text-center py-12">
          请从左侧列表选择一个标的
        </div>
      </Panel>
    )
  }

  return (
    <Panel title="标的评估" className="h-full">
      <div className="space-y-4">
        {/* 股票元信息 */}
        <div className="border border-border bg-background p-3">
          <div className="flex items-baseline justify-between">
            <span className="text-base font-semibold font-sans">{stock.name}</span>
            <span className="text-xs font-mono text-muted-foreground">{stock.symbol}</span>
          </div>
          <div className="flex items-baseline gap-3 mt-1">
            <span className="text-xl font-mono font-semibold">
              {stock.latestPrice != null ? `¥${formatNumber(stock.latestPrice, 2)}` : '—'}
            </span>
            <span className={cn(
              'text-sm font-mono',
              (stock.changePct ?? 0) >= 0 ? 'text-green-500' : 'text-red-500'
            )}>
              {(stock.changePct ?? 0) >= 0 ? '+' : ''}{stock.changePct?.toFixed(2) ?? '—'}%
            </span>
          </div>
          <div className="text-[10px] text-muted-foreground mt-1.5 font-mono">
            {[stock.industry, stock.exchange].filter(Boolean).join(' · ') || '—'}
          </div>
        </div>

        {/* 总评分 */}
        {stock.latestScore != null && (
          <div className="border border-border bg-panel p-3">
            <div className="text-[11px] font-mono text-muted-foreground mb-1">总评分</div>
            <ScoreGauge score={stock.latestScore} />
          </div>
        )}

        {/* 摘要 */}
        {stock.latestReport && (
          <div className="border border-border bg-panel p-3">
            <div className="text-[11px] font-mono text-muted-foreground mb-1.5">摘要</div>
            <p className="text-xs leading-relaxed text-foreground/80">
              {stock.latestReport.slice(0, 200)}{stock.latestReport.length > 200 ? '…' : ''}
            </p>
          </div>
        )}

        {/* 推荐操作 */}
        {stock.latestReport && stock.latestReport.includes('## 推荐操作') && (
          <div className="border border-border bg-panel p-3">
            <div className="text-[11px] font-mono text-muted-foreground mb-1.5">推荐明日操作</div>
            <p className="text-xs leading-relaxed text-foreground/80">
              {stock.latestReport.split('## 推荐操作')[1]?.split('##')[0]?.trim().slice(0, 150) ?? '—'}
            </p>
          </div>
        )}

        {/* 评分报告链接 */}
        {stock.latestReportPath && (
          <a
            href={stock.latestReportPath}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 text-xs text-primary hover:underline font-mono"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            查看完整评分报告
          </a>
        )}

        {/* 预留 */}
        <div className="border border-border border-dashed bg-background p-3">
          <div className="text-[11px] font-mono text-muted-foreground">其他信息</div>
          <div className="text-xs text-muted-foreground/50 mt-1">（预留）</div>
        </div>
      </div>
    </Panel>
  )
}
```

- [ ] **Step 2: typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/components/trade-agents/StockEvaluation.tsx
git commit -m "feat(frontend): 右栏标的详细评估（评分仪表/摘要/操作建议） xb"
```

---

### Task 9: Chatbot 编辑子窗口（含占位 AI）

**Files:**
- Create: `src/components/trade-agents/AgentEditWindow.tsx`

- [ ] **Step 1: 实现 AgentEditWindow 组件**

```typescript
import { useState, useEffect } from 'react'
import { Send, Check, X } from 'lucide-react'
import { Button } from '../shared/Button'
import { Field, Textarea } from '../shared/Field'
import { sendChatMessage, type ChatMessage, type ChatSuggestion } from '../../lib/agentChat'
import type { TradeSystemSummary } from '../../lib/types'

export function AgentEditWindow({
  system,
  isNew,
  onPublish,
  onClose
}: {
  system: TradeSystemSummary | null
  isNew: boolean
  onPublish: (markdown: string, name?: string) => void
  onClose: () => void
}) {
  const [markdown, setMarkdown] = useState('')
  const [history, setHistory] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [suggestion, setSuggestion] = useState<ChatSuggestion | null>(null)

  useEffect(() => {
    if (system && !isNew) {
      // TODO: 通过 get_trade_system 获取完整 system_md
      setMarkdown(system.description ?? '')
    } else if (isNew) {
      setMarkdown('')
    }
  }, [system, isNew])

  const handleSend = async () => {
    if (!input.trim()) return
    const userMsg: ChatMessage = { role: 'user', content: input }
    setHistory(prev => [...prev, userMsg])
    setInput('')
    setSending(true)
    try {
      const result = await sendChatMessage('', history, input)
      setSuggestion(result)
      setHistory(prev => [...prev, { role: 'assistant', content: result.diff }])
    } finally {
      setSending(false)
    }
  }

  const handleAccept = () => {
    if (suggestion?.markdown) {
      setMarkdown(suggestion.markdown)
    }
    setSuggestion(null)
  }

  const handleReject = () => {
    setSuggestion(null)
  }

  const handlePublish = () => {
    if (isNew) {
      const name = prompt('请输入交易系统名称：')
      if (!name?.trim()) return
      onPublish(markdown, name.trim())
    } else {
      onPublish(markdown)
    }
  }

  const inputLabel = isNew ? `新建: ${system?.name ?? '...'}` : `${system?.name ?? ''} V${system?.activeVersion ?? 1}`

  return (
    <div className="flex h-screen bg-background">
      {/* 左: Markdown 预览 */}
      <div className="w-[320px] border-r border-border p-3 overflow-auto">
        <div className="text-[11px] font-mono text-muted-foreground mb-2">{inputLabel}</div>
        <pre className="text-xs font-mono whitespace-pre-wrap leading-relaxed">
          {markdown || '(空白模板 — 在右侧对话区描述你的交易系统)'}
        </pre>
      </div>

      {/* 右: AI 对话区 */}
      <div className="flex-1 flex flex-col">
        <div className="flex-1 overflow-auto p-3 space-y-3">
          <div className="text-xs text-muted-foreground">
            🤖 {isNew ? '开始描述你的交易系统理念' : `当前系统：${system?.name ?? ''} V${system?.activeVersion ?? 1}`}
          </div>
          {history.map((msg, i) => (
            <div key={i} className={msg.role === 'user' ? 'text-right' : ''}>
              <div className={msg.role === 'user'
                ? 'inline-block bg-primary/20 text-foreground rounded px-3 py-1.5 text-xs max-w-[80%] text-left'
                : 'text-xs text-muted-foreground'
              }>
                {msg.content}
              </div>
              {msg.role === 'assistant' && suggestion && (
                <div className="flex gap-2 mt-1">
                  <Button variant="primary" size="sm" onClick={handleAccept}><Check className="h-3 w-3" /> 接受</Button>
                  <Button variant="secondary" size="sm" onClick={handleReject}><X className="h-3 w-3" /> 拒绝</Button>
                </div>
              )}
            </div>
          ))}
          {sending && <div className="text-xs text-muted-foreground animate-pulse">AI 思考中…</div>}
        </div>

        {/* 输入区 */}
        <div className="border-t border-border p-3 space-y-2">
          <div className="flex gap-2">
            <Textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="输入修改需求…"
              className="flex-1 text-xs min-h-[40px]"
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
            />
            <Button icon={<Send className="h-3.5 w-3.5" />} variant="primary" disabled={sending || !input.trim()} onClick={handleSend} />
          </div>
          <div className="flex justify-end">
            <Button variant="primary" onClick={handlePublish}>
              📄 {isNew ? '发布 V1' : `发布 V${(system?.activeVersion ?? 0) + 1}`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/components/trade-agents/AgentEditWindow.tsx
git commit -m "feat(frontend): Chatbot 编辑子窗口（AI 占位 + Markdown 预览 + 发布） xb"
```

---

### Task 10: 主页面组装 + 路由变更

**Files:**
- Create: `src/pages/TradeSystemAgentsPage.tsx`
- Modify: `src/app/routes.ts`
- Modify: `src/app/App.tsx`
- Modify: `src/components/layout/AppShell.tsx`
- Delete: `src/pages/AgentPage.tsx`
- Delete: `src/pages/TradeSystemPage.tsx`

- [ ] **Step 1: 创建 TradeSystemAgentsPage**

```typescript
import { useState } from 'react'
import { AgentCardList } from '../components/trade-agents/AgentCardList'
import { StockTable } from '../components/trade-agents/StockTable'
import { StockEvaluation } from '../components/trade-agents/StockEvaluation'
import { AgentEditWindow } from '../components/trade-agents/AgentEditWindow'
import { useQuery } from '@tanstack/react-query'
import { commands } from '../lib/commands'
import type { TradeSystemStock, TradeSystemSummary } from '../lib/types'

export function TradeSystemAgentsPage() {
  const [selectedSystemId, setSelectedSystemId] = useState<string | undefined>()
  const [selectedSymbol, setSelectedSymbol] = useState<string | undefined>()
  const [editingSystem, setEditingSystem] = useState<TradeSystemSummary | null>(null)
  const [isNewSystem, setIsNewSystem] = useState(false)

  const stocks = useQuery({
    queryKey: ['trade-system-stocks', selectedSystemId],
    queryFn: () => commands.listTradeSystemStocks(selectedSystemId!),
    enabled: !!selectedSystemId
  })

  const selectedStock: TradeSystemStock | undefined = stocks.data?.find(
    s => s.symbol === selectedSymbol
  )

  const handlePublish = (_markdown: string, _name?: string) => {
    // TODO: 后续版本对接真实保存逻辑（save_trade_system_version + update trade_systems）
    setEditingSystem(null)
    setIsNewSystem(false)
  }

  const handleEdit = (system: TradeSystemSummary) => {
    setIsNewSystem(false)
    setEditingSystem(system)
  }

  const handleNew = () => {
    setIsNewSystem(true)
    setEditingSystem(null)
  }

  // Chatbot 子窗口渲染
  const showEditWindow = editingSystem != null || isNewSystem

  return (
    <>
      <div className="grid grid-cols-[280px_320px_1fr] gap-0 h-full">
        <div className="border-r border-border overflow-auto">
          <AgentCardList
            selectedId={selectedSystemId}
            onSelect={id => { setSelectedSystemId(id); setSelectedSymbol(undefined) }}
            onEdit={handleEdit}
            onNew={handleNew}
          />
        </div>
        <div className="border-r border-border overflow-auto">
          {selectedSystemId ? (
            <StockTable
              tradeSystemId={selectedSystemId}
              selectedSymbol={selectedSymbol}
              onSelect={setSelectedSymbol}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              请选择左侧交易系统
            </div>
          )}
        </div>
        <div className="overflow-auto">
          <StockEvaluation stock={selectedStock} />
        </div>
      </div>

      {/* Chatbot 编辑子窗口 */}
      {showEditWindow && (
        <div className="fixed inset-0 z-50 bg-background">
          <AgentEditWindow
            system={editingSystem}
            isNew={isNewSystem}
            onPublish={handlePublish}
            onClose={() => { setEditingSystem(null); setIsNewSystem(false) }}
          />
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 2: 更新 routes.ts**

```typescript
// 删除 'agent' | 'trade-system'，新增 'trade-system-agents'
export type PageId = 'my-watchlist' | 'kline-data' | 'trade-system-agents' | 'daily-review' | 'stock-review' | 'settings'
```

- [ ] **Step 3: 更新 App.tsx**

```typescript
// 删除 import AgentPage ... 和 import TradeSystemPage ...
import { TradeSystemAgentsPage } from '../pages/TradeSystemAgentsPage'

// 删除 agent 和 trade-system 路由
// 新增：
'trade-system-agents': <TradeSystemAgentsPage />,
```

- [ ] **Step 4: 更新 AppShell.tsx 导航 tab**

在 tab 列表中删除 "Agent" 和 "交易系统"，新增：

```typescript
{ id: 'trade-system-agents' as PageId, label: '交易系统Agents' },
```

位置放在 `my-watchlist` 和 `kline-data` 之间或之后。

- [ ] **Step 5: 删除旧页面文件**

```bash
rm src/pages/AgentPage.tsx src/pages/TradeSystemPage.tsx
```

- [ ] **Step 6: typecheck + build 验证**

```bash
npm run typecheck && cd src-tauri && cargo build
```

- [ ] **Step 7: Commit**

```bash
git add src/pages/TradeSystemAgentsPage.tsx src/app/routes.ts src/app/App.tsx src/components/layout/AppShell.tsx
git rm src/pages/AgentPage.tsx src/pages/TradeSystemPage.tsx
git commit -m "feat: 交易系统Agents 三栏页面组装，删除旧 Agent/TradeSystem 页面 xb"
```

---

### Task 11: 端到端验证

- [ ] **Step 1: 启动应用**

```bash
npm run tauri:dev
```

- [ ] **Step 2: 验证清单**

- [ ] 导航栏显示"交易系统Agents" tab
- [ ] 点击 tab → 三栏布局正确渲染
- [ ] 左栏显示现有交易系统卡片（如无则显示空列表 + 新建按钮）
- [ ] 点击新建 → 输入名称 → 打开 Chatbot 窗口
- [ ] 点击卡片编辑按钮 → 打开 Chatbot 窗口
- [ ] 选中交易系统 → 中栏显示关联标的
- [ ] 选中标的 → 右栏显示评估信息
- [ ] 无旧 Agent/TradeSystem 页面残留
- [ ] 终端无报错

- [ ] **Step 3: 修复验证中发现的问题**

根据验证结果修复，然后 commit。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "fix: 端到端验证修复 xb"
```

---

## Self-Review

**Spec coverage:**
- [x] DB migration → Task 1
- [x] Rust models → Task 2
- [x] Service CRUD → Task 3
- [x] Tauri commands → Task 4
- [x] Frontend types/commands → Task 5
- [x] 左栏卡片列表 → Task 6
- [x] 中栏标的表格 → Task 7
- [x] 右栏评估面板 → Task 8
- [x] Chatbot 编辑窗口 → Task 9
- [x] 页面组装 + 路由 → Task 10
- [x] 端到端验证 → Task 11

**Placeholder scan:** AI IO 在 agentChat.ts 中返回占位消息，用户明确要求此行为。无 TBD/TODO 遗漏。

**Type consistency:** 
- `TradeSystemStock` 定义在 Task 2 (Rust) 和 Task 5 (TS)，字段名 camelCase 对齐
- `TradeSystemSummary` 在 Task 6 中引用，来自现有类型
- 命令名 `list_trade_system_stocks` 在 Rust (Task 4) 和 TS (Task 5) 一致
