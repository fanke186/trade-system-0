# 证券标识体系 + 数据分层 + K线增强 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一证券标识体系（symbol = code.exchange），分离数据层/视图层，增强 K线图表右侧面板和 tooltip，为 AI 评分信号叠加打基础。

**Architecture:** 不改 symbol 格式（`000001.SZ` 已能区分 SZ/000001.stock 和 SH/000001.index），核心修两件事：(1) watchlist 强制归一化到 symbol，(2) 前端抽取 `useStockViewModel` 解耦数据查询和 UI 渲染。K线增强是纯前端改动。

**Tech Stack:** Rust/Tauri 2 + DuckDB + SQLite, React 18 + TypeScript + klinecharts v9, @tanstack/react-query

---

## 现状诊断

当前 `symbol = code.exchange`（如 `000001.SZ`、`000001.SH`）在数据库层已经能区分不同交易所的同号标的。真正的问题有三处：

1. **watchlist_items.stock_code 未归一化** — `add_watchlist_item` 直接存储用户输入原文，不调 `resolve_symbol`。用户输入 `"000001"` 就存 `"000001"`，导致后续 `getStockMeta("000001")` 走 `resolve_symbol` 的 fallback 优先级（SZ > SH），可能选错标的。

2. **前端数据查询散落各处** — WatchlistSidebar 自己批量拉 meta、自己 merge、自己排序；MyWatchlistPage 又独立拉 meta、bars、annotations。没有统一的 data access layer，每个组件各自拼接数据。

3. **K线右侧面板信息密度低** — StockInfoPanel 只显示价格+涨跌+交易系统评价列表，缺少趋势状态、量能判断、支撑压力、评分等关键决策信息。

---

## Phase 1: 证券标识归一化（后端）

### Task 1.1: watchlist_items 强制归一化到 symbol

**Files:**
- Modify: `src-tauri/src/commands/watchlist.rs`
- Modify: `src-tauri/src/services/watchlist_service.rs`

**改动：** `add_watchlist_item` 命令中，先调 `resolve_symbol` 将用户输入归一化为 `app_symbol`（如 `"000001"` → `"000001.SZ"`），再存入 `stock_code` 字段。同时加一个 `INSERT OR IGNORE` 的幂等保护。

```rust
// src-tauri/src/commands/watchlist.rs — add_watchlist_item
#[tauri::command]
pub fn add_watchlist_item(
    state: State<'_, AppState>,
    watchlist_id: String,
    stock_code: String,
) -> AppResult<WatchlistItem> {
    let duck = state.duckdb.lock().expect("duckdb lock");
    let resolved = resolve_symbol(&duck, &stock_code)?; // 归一化
    drop(duck);
    let sqlite = state.sqlite.lock().expect("sqlite lock");
    watchlist_service::add_watchlist_item(&sqlite, watchlist_id, resolved)
}
```

**重要：** 存量数据迁移。写一个启动时执行的 SQL 修复已存在的非归一化数据：

```sql
-- 对 watchlist_items 中不是 symbol 格式的 stock_code，尝试通过 securities 表修正
UPDATE watchlist_items
SET stock_code = (
    SELECT s.symbol FROM securities s
    WHERE s.code = watchlist_items.stock_code
    ORDER BY CASE s.exchange WHEN 'SZ' THEN 0 WHEN 'SH' THEN 1 WHEN 'BJ' THEN 2 ELSE 3 END
    LIMIT 1
)
WHERE stock_code NOT LIKE '%.%'  -- 不含 '.' 即未归一化
AND EXISTS (SELECT 1 FROM securities s WHERE s.code = watchlist_items.stock_code);
```

此迁移加到 `src-tauri/src/db/sqlite.rs` 的 migration 列表中。

### Task 1.2: 前端全面改用 symbol

**Files:**
- Modify: `src/components/watchlist/WatchlistSidebar.tsx`
- Modify: `src/pages/MyWatchlistPage.tsx`
- Modify: `src/components/watchlist/StockInfoPanel.tsx`
- Modify: `src/pages/KlineDataPage.tsx`

**改动：** 所有 `stockCode` prop/state 变量名保持不变（避免大面积重命名），但确保传递的值始终是归一化后的 symbol。WatchlistSidebar 中 `onStockCodeChange(item.stockCode)` 在 Task 1.1 修复后自然就是 symbol。

关键检查点：`KlineDataPage` 的 `SecuritySearchBox` 中 `onSelect(result.symbol)` 是否正确（当前已正确使用 `result.symbol`）。

---

## Phase 2: 前端数据层抽取

### Task 2.1: 创建 useStockViewModel hook

**Files:**
- Create: `src/lib/useStockViewModel.ts`

**目的：** 把所有"根据 symbol 拉数据、合并、排序"的逻辑集中到一个 hook，各组件只消费结果。

```typescript
// src/lib/useStockViewModel.ts
import { useQueries, useQuery } from '@tanstack/react-query'
import { commands } from './commands'
import type { StockMeta, KlineBar, ChartAnnotation, StockReview } from './types'

export interface StockViewModel {
  symbol: string
  meta: StockMeta | undefined
  metaLoading: boolean
  bars: KlineBar[]
  barsLoading: boolean
  annotations: ChartAnnotation[]
  annotationsLoading: boolean
  reviews: StockReview[]
  reviewsLoading: boolean
  coverage: { daily: { rows: number }; weekly: { rows: number } } | undefined
}

export function useStockViewModel(symbol: string, versionId?: string): StockViewModel {
  // 并行查询 meta, bars, annotations, reviews, coverage
  // 全部 enabled: Boolean(symbol)
}
```

具体实现：用 `useQueries` 把 5 个查询打包，返回统一视图。

### Task 2.2: 创建 useWatchlistViewModel hook

**Files:**
- Create: `src/lib/useWatchlistViewModel.ts`

```typescript
export interface WatchlistRow {
  item: WatchlistItem       // symbol 已归一化
  meta: StockMeta | undefined
  score: number | undefined
  signal: 'buy' | 'sell' | 'hold' | 'watch' | undefined
}

export function useWatchlistViewModel(watchlistId: string | undefined) {
  // 1. 拉 watchlist → 拿到 items (每个 item.stockCode 已是归一化 symbol)
  // 2. 批量拉 StockMeta (useQueries)
  // 3. 批量拉最新评分 (trade_system_stocks)
  // 4. 合并、排序、返回 WatchlistRow[]
}
```

### Task 2.3: 重构 MyWatchlistPage 使用新 hooks

**Files:**
- Modify: `src/pages/MyWatchlistPage.tsx`

**改动：** 删除页面中散落的 `meta`、`barsQuery`、`annotationsQuery` 等 useQuery 调用，替换为 `useStockViewModel(stockCode, selectedVersionId)` 和 `useWatchlistViewModel`。

WatchlistSidebar 的 props 从 `{ stockCode, onStockCodeChange }` 扩展为：
```typescript
{
  stockCode: string
  onStockCodeChange: (symbol: string) => void
  rows: WatchlistRow[]        // 已合并、已排序
  sortColumn: SortColumn
  sortDir: SortDir
  onToggleSort: (col: SortColumn) => void
}
```

即 WatchlistSidebar 变成纯展示组件，数据由父组件通过 hook 提供。

---

## Phase 3: K线图表增强

### Task 3.1: 增强右侧 StockInfoPanel

**Files:**
- Modify: `src/components/watchlist/StockInfoPanel.tsx`

**改动：** 当前只有价格+评价列表。新增区块：

```txt
┌─────────────────────────┐
│ 平安银行                 │
│ 000001.SZ · SZ · 主板    │
│                         │
│ 11.49         -0.26%    │
│ -0.03         2026-05-02│
│                         │
│ ─── 交易系统评价 ───     │
│ 趋势交易系统    focus    │
│ 短线强势，量能放大...    │
│                         │
│ ─── 数据覆盖 ───         │
│ 日K  2020-01 ~ 2026-05  │
│ 周K  2020-W1 ~ 2026-W17 │
│ 月K  2020-01 ~ 2026-04  │
└─────────────────────────┘
```

新增 coverage 展示（已有查询，加渲染即可）。

### Task 3.2: 增强 K线 tooltip 和十字光标

**Files:**
- Modify: `src/components/chart/KLineChartPanel.tsx`

**改动：** klinecharts 的 crosshair 事件已触发 `onCrosshairBar`，当前只显示 开高低收+量+额。在 `CrosshairTooltip` 组件中增加：

```txt
日期: 2026-04-30
开: 11.52  高: 11.58
低: 11.40  收: 11.49
涨幅: -0.26%  振幅: 1.56%
换手: 0.82%
MA5: 11.53  MA10: 11.47  MA20: 11.38
成交量: 12,345,678
成交额: 1.42亿
```

`KlineBar` 已有 `changePct`、`amplitude`、`turnover` 字段，只需在 CrosshairTooltip 中渲染。

### Task 3.3: 修复日期解析时区问题

**Files:**
- Modify: `src/components/chart/KLineChartPanel.tsx:84`

**当前代码：**
```typescript
timestamp: new Date(`${bar.date}T00:00:00`).getTime()
```

**问题：** 用本地时区午夜，UTC+X 时区会偏移到前一天。

**修复：**
```typescript
timestamp: new Date(`${bar.date}T00:00:00+08:00`).getTime()
```

A股交易日始终是北京时间，指定 `+08:00` 明确时区。

---

## Phase 4: 列表性能（可选，按需实施）

### Task 4.1: 证券列表虚拟滚动

**Files:**
- Modify: `src/pages/KlineDataPage.tsx`

当前分页 15 条/页。如果用户觉得翻页体验不好，可替换为虚拟滚动：

```bash
npm install @tanstack/react-virtual
```

在 SecuritiesTable 中用 `useVirtualizer` 替换手动分页，保留搜索过滤和排序逻辑不变。

---

## 验证

1. **标识归一化验证**
   - 在自选列表中添加 `"000001"` → 数据库 `watchlist_items.stock_code` 应为 `"000001.SZ"`
   - 添加 `"000001.SH"` → 应为 `"000001.SH"`（上证指数）
   - 存量数据：启动应用后检查旧数据是否被迁移脚本修正

2. **数据层验证**
   - `MyWatchlistPage` 打开后 K线/元数据/评价正常加载
   - 从自选切换标的 → K线自动切换
   - 搜索选中标的 → K线自动切换

3. **K线增强验证**
   - 右侧面板显示 coverage 统计
   - 十字光标 tooltip 显示涨幅/振幅/换手/MA
   - 不同时区下 K线日期不偏移

4. **TypeScript 类型检查**
   ```bash
   npm run typecheck
   ```

5. **Rust 编译**
   ```bash
   cd src-tauri && cargo build
   ```
