# 我的自选 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge Watchlist + K-line chart pages into "我的自选" home page with three-column layout (160px | flex-1 | 240px).

**Architecture:** New MyWatchlistPage composes three sub-components: WatchlistSidebar (stock list + groups + context menu), KLineChartArea (chart + toolbar + crosshair + settings), StockInfoPanel (stock metadata + trade system evaluations). Backend gains stock meta query, watchlist reorder/move/group operations, and adj factor support in get_bars.

**Tech Stack:** React 19 + TypeScript + Tauri 2 + Tailwind CSS + klinecharts + DuckDB + SQLite

**Spec:** `docs/superpowers/specs/2026-05-01-my-watchlist-design.md`

---

## Task 1: Rust — StockMeta model + get_stock_meta command

**Files:**
- Modify: `src-tauri/src/models/mod.rs`
- Create: `src-tauri/src/commands/stock_meta.rs`
- Modify: `src-tauri/src/main.rs` (register command)

- [ ] **Step 1: Add StockMeta struct to models**

In `src-tauri/src/models/mod.rs`, append:

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StockMeta {
    pub code: String,
    pub name: String,
    pub exchange: String,
    pub board: Option<String>,
    pub list_date: Option<String>,
    pub latest_price: Option<f64>,
    pub pre_close: Option<f64>,
    pub change: Option<f64>,
    pub change_pct: Option<f64>,
    pub latest_date: Option<String>,
    pub stale: bool,
}
```

- [ ] **Step 2: Create stock_meta command**

Create `src-tauri/src/commands/stock_meta.rs`:

```rust
use crate::models::StockMeta;
use crate::AppState;
use tauri::State;

#[tauri::command]
pub async fn get_stock_meta(
    state: State<'_, AppState>,
    stock_code: String,
) -> Result<StockMeta, String> {
    let db = state.duckdb.lock().unwrap();

    // Get security info
    let sec = db.query_row(
        "SELECT symbol_id, code, name, exchange, board, list_date, status FROM securities WHERE code = ?1",
        rusqlite::params![stock_code],
        |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, String>(6)?,
            ))
        },
    ).map_err(|e| format!("Security not found: {e}"))?;

    // Get latest bar from DuckDB bars_1d
    let bar = db.query_row(
        "SELECT date, open, high, low, close, pre_close, volume, amount
         FROM bars_1d WHERE stock_code = ?1 ORDER BY date DESC LIMIT 1",
        [stock_code.as_str()],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, f64>(1)?,
                row.get::<_, f64>(2)?,
                row.get::<_, f64>(3)?,
                row.get::<_, f64>(4)?,
                row.get::<_, Option<f64>>(5)?,
                row.get::<_, f64>(6)?,
                row.get::<_, f64>(7)?,
            ))
        },
    ).ok();

    let (latest_price, pre_close, change, change_pct, latest_date, stale) =
        if let Some((date, _open, _high, _low, close, pc, _vol, _amt)) = bar {
            let pc = pc.unwrap_or(close);
            let chg = close - pc;
            let chg_pct = if pc != 0.0 { (chg / pc) * 100.0 } else { 0.0 };
            let stale = is_stale_today(&date);
            (Some(close), Some(pc), Some(chg), Some(chg_pct), Some(date), stale)
        } else {
            (None, None, None, None, None, true)
        };

    Ok(StockMeta {
        code: sec.1,
        name: sec.2,
        exchange: sec.3,
        board: sec.4,
        list_date: sec.5,
        latest_price,
        pre_close,
        change,
        change_pct,
        latest_date,
        stale,
    })
}

fn is_stale_today(latest_date: &str) -> bool {
    use chrono::{Local, NaiveDate, Weekday};
    let today = Local::now().date_naive();
    if matches!(today.weekday(), Weekday::Sat | Weekday::Sun) {
        return latest_date < &today.format("%Y-%m-%d").to_string();
    }
    let yesterday = today - chrono::Duration::days(1);
    let cutoff = if matches!(yesterday.weekday(), Weekday::Sat | Weekday::Sun) {
        today - chrono::Duration::days(3)
    } else {
        yesterday
    };
    latest_date < &cutoff.format("%Y-%m-%d").to_string()
}
```

- [ ] **Step 3: Register command in main.rs**

In `src-tauri/src/main.rs`, add `mod commands::stock_meta;` and register:
```rust
stock_meta::get_stock_meta,
```

- [ ] **Step 4: Build check**

Run: `cd src-tauri && cargo check 2>&1`
Expected: Compiles successfully (may need chrono dependency)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/models/mod.rs src-tauri/src/commands/stock_meta.rs src-tauri/src/main.rs
git commit -m "feat: add StockMeta model and get_stock_meta command"
```

---

## Task 2: Rust — Watchlist group operations + reorder/move items

**Files:**
- Modify: `src-tauri/src/db/sqlite.rs`
- Create: `src-tauri/src/commands/watchlist_ops.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Add SQL methods to SQLite db**

In `src-tauri/src/db/sqlite.rs`, add to the `impl` block:

```rust
pub fn reorder_watchlist_item(
    &self,
    item_id: &str,
    position: &str, // "top" | "bottom"
) -> Result<(), String> {
    let max_sort = self.conn.query_row(
        "SELECT COALESCE(MAX(sort_order), 0) FROM watchlist_items",
        [],
        |row| row.get::<_, i64>(0),
    ).unwrap_or(0);
    let new_order = match position {
        "top" => -1i64,
        "bottom" => max_sort + 1,
        _ => return Err("Invalid position".into()),
    };
    self.conn.execute(
        "UPDATE watchlist_items SET sort_order = ?1, updated_at = datetime('now') WHERE id = ?2",
        rusqlite::params![new_order, item_id],
    ).map_err(|e| format!("Reorder failed: {e}"))?;
    Ok(())
}

pub fn move_watchlist_item(
    &self,
    item_id: &str,
    target_watchlist_id: &str,
) -> Result<(), String> {
    self.conn.execute(
        "UPDATE watchlist_items SET watchlist_id = ?1, updated_at = datetime('now') WHERE id = ?2",
        rusqlite::params![target_watchlist_id, item_id],
    ).map_err(|e| format!("Move failed: {e}"))?;
    Ok(())
}

pub fn create_watchlist_group(&self, name: &str) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();
    self.conn.execute(
        "INSERT INTO watchlists (id, name, created_at, updated_at) VALUES (?1, ?2, datetime('now'), datetime('now'))",
        rusqlite::params![id, name],
    ).map_err(|e| format!("Create group failed: {e}"))?;
    Ok(id)
}

pub fn delete_watchlist_group(&self, watchlist_id: &str) -> Result<(), String> {
    // Prevent deleting default group
    let name: String = self.conn.query_row(
        "SELECT name FROM watchlists WHERE id = ?1",
        rusqlite::params![watchlist_id],
        |row| row.get(0),
    ).map_err(|e| format!("Group not found: {e}"))?;
    if name == "我的自选" {
        return Err("Cannot delete default group".into());
    }
    self.conn.execute("DELETE FROM watchlist_items WHERE watchlist_id = ?1", rusqlite::params![watchlist_id])
        .map_err(|e| format!("{e}"))?;
    self.conn.execute("DELETE FROM watchlists WHERE id = ?1", rusqlite::params![watchlist_id])
        .map_err(|e| format!("Delete group failed: {e}"))?;
    Ok(())
}

pub fn rename_watchlist_group(&self, watchlist_id: &str, new_name: &str) -> Result<(), String> {
    self.conn.execute(
        "UPDATE watchlists SET name = ?1, updated_at = datetime('now') WHERE id = ?2",
        rusqlite::params![new_name, watchlist_id],
    ).map_err(|e| format!("Rename failed: {e}"))?;
    Ok(())
}
```

- [ ] **Step 2: Create Tauri commands**

Create `src-tauri/src/commands/watchlist_ops.rs`:

```rust
use crate::AppState;
use tauri::State;

#[tauri::command]
pub async fn reorder_watchlist_item(
    state: State<'_, AppState>,
    item_id: String,
    position: String,
) -> Result<(), String> {
    let db = state.sqlite.lock().unwrap();
    db.reorder_watchlist_item(&item_id, &position)
}

#[tauri::command]
pub async fn move_watchlist_item(
    state: State<'_, AppState>,
    item_id: String,
    target_watchlist_id: String,
) -> Result<(), String> {
    let db = state.sqlite.lock().unwrap();
    db.move_watchlist_item(&item_id, &target_watchlist_id)
}

#[tauri::command]
pub async fn create_watchlist_group(
    state: State<'_, AppState>,
    name: String,
) -> Result<String, String> {
    let db = state.sqlite.lock().unwrap();
    db.create_watchlist_group(&name)
}

#[tauri::command]
pub async fn delete_watchlist_group(
    state: State<'_, AppState>,
    watchlist_id: String,
) -> Result<(), String> {
    let db = state.sqlite.lock().unwrap();
    db.delete_watchlist_group(&watchlist_id)
}

#[tauri::command]
pub async fn rename_watchlist_group(
    state: State<'_, AppState>,
    watchlist_id: String,
    new_name: String,
) -> Result<(), String> {
    let db = state.sqlite.lock().unwrap();
    db.rename_watchlist_group(&watchlist_id, &new_name)
}
```

- [ ] **Step 3: Register in main.rs**

```rust
mod commands::watchlist_ops;
// in invoke_handler:
watchlist_ops::reorder_watchlist_item,
watchlist_ops::move_watchlist_item,
watchlist_ops::create_watchlist_group,
watchlist_ops::delete_watchlist_group,
watchlist_ops::rename_watchlist_group,
```

- [ ] **Step 4: Build check**

Run: `cd src-tauri && cargo check 2>&1`
Expected: Compiles

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db/sqlite.rs src-tauri/src/commands/watchlist_ops.rs src-tauri/src/main.rs
git commit -m "feat: add watchlist group operations and item reorder/move"
```

---

## Task 3: Rust — Adj factor support in get_bars

**Files:**
- Modify: `src-tauri/src/services/kline_query_service.rs`

- [ ] **Step 1: Add adj parameter to get_bars query service**

In `src-tauri/src/services/kline_query_service.rs`, modify the `get_bars` function signature to accept `adj: Option<String>`. When adj is `"pre"`, apply pre-adjustment using adj_factor; when `"post"`, apply post-adjustment:

```rust
pub fn get_bars(
    db: &duckdb::Connection,
    stock_code: &str,
    frequency: &str,
    start_date: Option<&str>,
    end_date: Option<&str>,
    limit: Option<usize>,
    adj: Option<&str>,
) -> Result<Vec<KlineBar>, String> {
    // ... existing query ...
    let mut bars: Vec<KlineBar> = /* existing mapping */;

    // Apply adj factor
    match adj.unwrap_or("none") {
        "pre" => {
            // Pre-adjustment: adjust historical prices backward from latest
            if let Some(last) = bars.last() {
                let ref_factor = last.adj_factor.unwrap_or(1.0);
                for bar in &mut bars {
                    let f = bar.adj_factor.unwrap_or(1.0);
                    if f != 0.0 {
                        let ratio = ref_factor / f;
                        bar.open *= ratio;
                        bar.high *= ratio;
                        bar.low *= ratio;
                        bar.close *= ratio;
                    }
                }
            }
        }
        "post" => {
            // Post-adjustment: adjust subsequent prices forward from first
            if let Some(first) = bars.first() {
                let ref_factor = first.adj_factor.unwrap_or(1.0);
                for bar in &mut bars {
                    let f = bar.adj_factor.unwrap_or(1.0);
                    if f != 0.0 {
                        let ratio = f / ref_factor;
                        bar.open *= ratio;
                        bar.high *= ratio;
                        bar.low *= ratio;
                        bar.close *= ratio;
                    }
                }
            }
        }
        _ => {}
    }

    Ok(bars)
}
```

Also update the Tauri command `get_bars` in `src-tauri/src/commands/` to accept and pass the `adj` parameter.

- [ ] **Step 2: Build check**

Run: `cd src-tauri && cargo check 2>&1`
Expected: Compiles

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/services/kline_query_service.rs
git commit -m "feat: add adj factor support in get_bars"
```

---

## Task 4: Frontend — Types and Commands update

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/commands.ts`

- [ ] **Step 1: Add StockMeta type and extend Watchlist types**

In `src/lib/types.ts`, add:

```typescript
export type StockMeta = {
  code: string
  name: string
  exchange: string
  board?: string | null
  listDate?: string | null
  latestPrice?: number | null
  preClose?: number | null
  change?: number | null
  changePct?: number | null
  latestDate?: string | null
  stale: boolean
}
```

- [ ] **Step 2: Add new command functions**

In `src/lib/commands.ts`, add:

```typescript
getStockMeta: (stockCode: string) =>
  call<StockMeta>('get_stock_meta', { stockCode }),

reorderWatchlistItem: (itemId: string, position: 'top' | 'bottom') =>
  call<null>('reorder_watchlist_item', { itemId, position }),

moveWatchlistItem: (itemId: string, targetWatchlistId: string) =>
  call<null>('move_watchlist_item', { itemId, targetWatchlistId }),

createWatchlistGroup: (name: string) =>
  call<string>('create_watchlist_group', { name }),

deleteWatchlistGroup: (watchlistId: string) =>
  call<null>('delete_watchlist_group', { watchlistId }),

renameWatchlistGroup: (watchlistId: string, newName: string) =>
  call<null>('rename_watchlist_group', { watchlistId, newName }),
```

Also update `getBars` to accept optional `adj`:
```typescript
getBars: (
  stockCode: string,
  frequency: '1d' | '1w' | '1M',
  startDate?: string,
  endDate?: string,
  limit?: number,
  adj?: 'pre' | 'post' | 'none'
) =>
  call<KlineBar[]>('get_bars', {
    stockCode, frequency, startDate, endDate, limit, adj
  }),
```

- [ ] **Step 3: Type check**

Run: `npm run typecheck 2>&1`
Expected: No errors related to new types

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts src/lib/commands.ts
git commit -m "feat: add StockMeta type and new Tauri command wrappers"
```

---

## Task 5: Routes + App.tsx + AppShell update

**Files:**
- Modify: `src/app/routes.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/components/layout/AppShell.tsx`

- [ ] **Step 1: Update routes**

In `src/app/routes.tsx`:

```typescript
import { Star } from 'lucide-react' // add import

export type PageId =
  | 'my-watchlist'
  | 'daily-review'
  | 'trade-system'
  | 'agent'
  | 'stock-review'
  | 'data'
  | 'settings'
// Remove: 'chart' | 'watchlist'

export const routes = [
  { id: 'my-watchlist', label: '我的自选', icon: Star },
  { id: 'daily-review', label: '每日复盘', icon: CalendarDays },
  // ... rest unchanged
  { id: 'settings', label: '设置', icon: Settings }
] as const
```

- [ ] **Step 2: Update App.tsx**

```typescript
// Replace imports:
// Remove: import { ChartPage } from '../pages/ChartPage'
// Remove: import { WatchlistPage } from '../pages/WatchlistPage'
// Add: import { MyWatchlistPage } from '../pages/MyWatchlistPage'

const [activePage, setActivePage] = useState<PageId>('my-watchlist')

// In page mapping, replace chart + watchlist with:
'my-watchlist': (
  <MyWatchlistPage
    selectedVersionId={activeVersionId}
    stockCode={stockCode}
    onStockCodeChange={setStockCode}
  />
),
```

- [ ] **Step 3: Simplify AppShell right sidebar**

In `src/components/layout/AppShell.tsx`, remove the K-line coverage section from the right sidebar (lines 99-107). Keep only the stock code display and latest review sections. The new StockInfoPanel inside MyWatchlistPage will handle stock details.

- [ ] **Step 4: Type check**

Run: `npm run typecheck 2>&1`
Expected: Errors for missing MyWatchlistPage (expected)

- [ ] **Step 5: Commit**

```bash
git add src/app/routes.tsx src/app/App.tsx src/components/layout/AppShell.tsx
git commit -m "feat: add my-watchlist route, set as default page"
```

---

## Task 6: MyWatchlistPage skeleton

**Files:**
- Create: `src/pages/MyWatchlistPage.tsx`

- [ ] **Step 1: Create page with three-column layout**

Create `src/pages/MyWatchlistPage.tsx`:

```tsx
import type { ChartAnnotationPayload } from '../lib/types'

export function MyWatchlistPage({
  stockCode,
  selectedVersionId,
  onStockCodeChange
}: {
  stockCode: string
  selectedVersionId?: string
  onStockCodeChange: (code: string) => void
}) {
  return (
    <div className="flex h-full gap-0 bg-background">
      {/* LEFT — 160px */}
      <div className="w-[160px] min-w-[160px] border-r border-border bg-panel flex flex-col">
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-xs font-mono">
          WatchlistSidebar
        </div>
      </div>

      {/* CENTER — flex-1 */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-xs font-mono">
          KLineChartArea
        </div>
      </div>

      {/* RIGHT — 240px */}
      <div className="w-[240px] min-w-[240px] border-l border-border bg-panel flex flex-col">
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-xs font-mono">
          StockInfoPanel
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify typecheck passes for the page file itself**

Run: `npm run typecheck 2>&1`
Expected: App.tsx typecheck passes (page exists now)

- [ ] **Step 3: Commit**

```bash
git add src/pages/MyWatchlistPage.tsx
git commit -m "feat: create MyWatchlistPage skeleton with three-column layout"
```

---

## Task 7: WatchlistSidebar component

**Files:**
- Create: `src/components/watchlist/WatchlistSidebar.tsx`

- [ ] **Step 1: Implement WatchlistSidebar**

Create `src/components/watchlist/WatchlistSidebar.tsx` with:
- Group selector dropdown at top (reads watchlists, shows selected)
- Stock list with 2 columns: 名称/代码 | 涨幅/最新价
- Column headers clickable to toggle sort (asc/desc/none)
- Active row highlighted with left accent border
- Right-click context menu (置顶, 置底, 删除, 复制到→二级菜单)
- Multi-select support via Ctrl+Click / Shift+Click

Key code structure:
```tsx
import { useState, useMemo, useRef, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { commands } from '../../lib/commands'
import { cn } from '../../lib/cn'
import type { Watchlist, WatchlistItem } from '../../lib/types'

type SortKey = 'name' | 'changePct'
type SortDir = 'asc' | 'desc'

export function WatchlistSidebar({
  stockCode,
  onStockCodeChange
}: {
  stockCode: string
  onStockCodeChange: (code: string) => void
}) {
  const queryClient = useQueryClient()
  const [selectedGroupId, setSelectedGroupId] = useState<string>()
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [contextMenu, setContextMenu] = useState<{x: number; y: number; items: WatchlistItem[]} | null>(null)
  // ... full implementation

  const watchlists = useQuery({ queryKey: ['watchlists'], queryFn: commands.listWatchlists })
  const metaQueries = /* fetch StockMeta for each item */;

  // Sort logic
  const sortedItems = useMemo(() => {
    // ... sort by sortKey + sortDir
  }, [watchlists.data, selectedGroupId, sortKey, sortDir])

  return (
    <div className="flex flex-col h-full select-none">
      {/* Group selector */}
      <div className="p-2 border-b border-border">
        {/* dropdown */}
      </div>
      {/* Column headers */}
      <div className="flex px-2 py-1.5 text-[10px] font-mono text-muted-foreground border-b border-border/50">
        <button className="flex-1 text-left" onClick={() => toggleSort('name')}>
          名称{sortKey === 'name' ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
        </button>
        <button className="w-[60px] text-right" onClick={() => toggleSort('changePct')}>
          涨幅{sortKey === 'changePct' ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
        </button>
      </div>
      {/* Stock list */}
      <div className="flex-1 overflow-y-auto">
        {sortedItems.map(item => (
          <div
            key={item.id}
            className={cn(
              'px-2 py-1.5 border-b border-border/30 cursor-pointer',
              stockCode === item.stockCode && 'border-l-2 border-l-ring bg-ring/10'
            )}
            onClick={() => onStockCodeChange(item.stockCode)}
            onContextMenu={e => handleContextMenu(e, item)}
          >
            {/* 2-column row: name+code | change%+price */}
          </div>
        ))}
      </div>
      {/* Context menu */}
      {contextMenu && <ContextMenuPortal /* ... */ />}
    </div>
  )
}
```

- [ ] **Step 2: Wire into MyWatchlistPage**

Update `MyWatchlistPage.tsx` left panel to render `<WatchlistSidebar>` instead of placeholder.

- [ ] **Step 3: Type check**

Run: `npm run typecheck 2>&1`

- [ ] **Step 4: Commit**

```bash
git add src/components/watchlist/WatchlistSidebar.tsx src/pages/MyWatchlistPage.tsx
git commit -m "feat: implement WatchlistSidebar with groups, sorting, and context menu"
```

---

## Task 8: ChartToolbar + SettingsPopover components

**Files:**
- Create: `src/components/chart/ChartToolbar.tsx`
- Create: `src/components/chart/SettingsPopover.tsx`

- [ ] **Step 1: Implement ChartToolbar**

Create `src/components/chart/ChartToolbar.tsx`:

```tsx
import { Settings } from 'lucide-react'
import { cn } from '../../lib/cn'

type Frequency = '1d' | '1w' | '1M'
type AdjMode = 'pre' | 'post' | 'none'

export function ChartToolbar({
  stockName,
  stockCode,
  frequency,
  onFrequencyChange,
  adjMode,
  onAdjModeChange,
  onSettingsClick,
  settingsOpen
}: {
  stockName: string
  stockCode: string
  frequency: Frequency
  onFrequencyChange: (f: Frequency) => void
  adjMode: AdjMode
  onAdjModeChange: (m: AdjMode) => void
  onSettingsClick: () => void
  settingsOpen: boolean
}) {
  const freqLabel = { '1d': '日K', '1w': '周K', '1M': '月K' } as const
  const adjLabel = { 'pre': '前复权', 'post': '后复权', 'none': '除权' } as const

  return (
    <div className="flex items-center gap-2.5 px-3 py-1.5 border-b border-border bg-panel shrink-0">
      <span className="font-semibold text-sm">{stockName}</span>
      <span className="text-muted-foreground font-mono text-[11px]">{stockCode}</span>
      <span className="text-border">|</span>
      {(Object.entries(freqLabel) as [Frequency, string][]).map(([key, label]) => (
        <button
          key={key}
          className={cn(
            'px-1.5 py-0.5 text-[11px] font-mono transition-all',
            frequency === key
              ? 'bg-ring text-panel'
              : 'text-muted-foreground hover:text-foreground'
          )}
          onClick={() => onFrequencyChange(key)}
        >{label}</button>
      ))}
      <span className="text-border">|</span>
      <select
        className="text-[11px] font-mono bg-transparent border-0 border-b border-border text-muted-foreground focus:text-foreground focus:border-ring px-0 py-0.5"
        value={adjMode}
        onChange={e => onAdjModeChange(e.target.value as AdjMode)}
      >
        {Object.entries(adjLabel).map(([val, label]) => (
          <option key={val} value={val}>{label}</option>
        ))}
      </select>
      <div className="flex-1" />
      <button
        className={cn('p-1 transition-all', settingsOpen ? 'text-ring' : 'text-muted-foreground hover:text-foreground')}
        onClick={onSettingsClick}
      >
        <Settings className="h-4 w-4" />
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Implement SettingsPopover**

Create `src/components/chart/SettingsPopover.tsx`:

```tsx
import { useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '../shared/Button'
import { Field, Input } from '../shared/Field'
import { cn } from '../../lib/cn'

type CoordType = 'normal' | 'log'

const DEFAULT_MA = [
  { period: 5, color: '#f0b93b', enabled: true },
  { period: 10, color: '#7dcfff', enabled: true },
  { period: 20, color: '#bb9af7', enabled: true },
  { period: 60, color: '#ff6b35', enabled: false },
]

export type ChartSettings = {
  maLines: Array<{ period: number; color: string; enabled: boolean }>
  coordType: CoordType
}

export function SettingsPopover({
  settings,
  onChange,
  onClose
}: {
  settings: ChartSettings
  onChange: (s: ChartSettings) => void
  onClose: () => void
}) {
  const [customPeriod, setCustomPeriod] = useState('')

  return (
    <div className="absolute top-full right-2 mt-1 z-50 w-56 bg-panel border border-border p-3 shadow-lg">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-mono font-medium">图表设置</span>
        <button onClick={onClose}><X className="h-3.5 w-3.5 text-muted-foreground" /></button>
      </div>

      {/* MA settings */}
      <div className="mb-3">
        <div className="text-[10px] font-mono text-muted-foreground mb-2">均线</div>
        {settings.maLines.map(ma => (
          <label key={ma.period} className="flex items-center gap-2 mb-1 text-[11px] font-mono cursor-pointer">
            <input
              type="checkbox"
              checked={ma.enabled}
              onChange={() => {
                const updated = settings.maLines.map(m =>
                  m.period === ma.period ? { ...m, enabled: !m.enabled } : m
                )
                onChange({ ...settings, maLines: updated })
              }}
              className="accent-ring"
            />
            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: ma.color }} />
            <span className="text-foreground">MA{ma.period}</span>
          </label>
        ))}
        <div className="flex items-center gap-1 mt-1">
          <Input
            value={customPeriod}
            onChange={e => setCustomPeriod(e.target.value)}
            placeholder="+周期"
            className="flex-1 text-[10px] h-5"
          />
          <Button
            size="icon"
            variant="ghost"
            className="h-5 w-5"
            onClick={() => {
              const n = parseInt(customPeriod)
              if (n && n > 0 && !settings.maLines.find(m => m.period === n)) {
                onChange({
                  ...settings,
                  maLines: [...settings.maLines, { period: n, color: '#888888', enabled: true }]
                })
                setCustomPeriod('')
              }
            }}
          >+</Button>
        </div>
      </div>

      {/* Coordinate type */}
      <div>
        <div className="text-[10px] font-mono text-muted-foreground mb-2">坐标类型</div>
        <div className="flex gap-1">
          {(['normal', 'log'] as const).map(t => (
            <button
              key={t}
              className={cn(
                'flex-1 px-2 py-1 text-[10px] font-mono transition-all',
                settings.coordType === t
                  ? 'bg-ring text-panel'
                  : 'text-muted-foreground border border-border hover:text-foreground'
              )}
              onClick={() => onChange({ ...settings, coordType: t })}
            >{t === 'normal' ? '普通坐标' : '对数坐标'}</button>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Type check**

Run: `npm run typecheck 2>&1`

- [ ] **Step 4: Commit**

```bash
git add src/components/chart/ChartToolbar.tsx src/components/chart/SettingsPopover.tsx
git commit -m "feat: add ChartToolbar and SettingsPopover components"
```

---

## Task 9: KLineChartPanel updates

**Files:**
- Modify: `src/components/chart/KLineChartPanel.tsx`

- [ ] **Step 1: Refactor KLineChartPanel**

Modify to support:
1. Single chart (remove duplicate chart creation)
2. Chinese labels in tooltip: 日期/开盘/最高/最低/收盘/成交量/成交额
3. Sub-chart toggle: 成交量(手) / 成交额(元)
4. Chart fills container via CSS (remove fixed h-[560px])
5. Crosshair tooltip with 1/4 region avoidance
6. Drawing tool magnetic snap to high/low
7. Support adj-aware bar data
8. MA overlay support based on settings

Key changes to `KLineChartPanel.tsx`:

```tsx
// Props accept new settings
type Props = {
  bars: KlineBar[]
  annotations: ChartAnnotation[]
  drawingTool: 'horizontal_line' | 'ray' | null
  onDrawComplete: (payload: ChartAnnotationPayload) => void
  subChartType: 'volume' | 'amount'
  maLines: Array<{ period: number; color: string; enabled: boolean }>
  coordType: 'normal' | 'log'
  onCrosshairBar?: (bar: KlineBar | null) => void
}

// Chart init: set Y axis to log if coordType === 'log'
// Tooltip labels in Chinese
// Crosshair event: emit current bar info to parent for tooltip display
```

- [ ] **Step 2: Wire into MyWatchlistPage center panel**

Update center panel to compose ChartToolbar + KLineChartPanel + CrosshairTooltip.

- [ ] **Step 3: Build and visual check**

Run: `npm run tauri:dev` — verify chart renders with new settings.

- [ ] **Step 4: Commit**

```bash
git add src/components/chart/KLineChartPanel.tsx src/pages/MyWatchlistPage.tsx
git commit -m "feat: update KLineChartPanel with Chinese labels, MA, log coord, crosshair, sub-chart toggle"
```

---

## Task 10: CrosshairTooltip component

**Files:**
- Create: `src/components/chart/CrosshairTooltip.tsx`

- [ ] **Step 1: Implement CrosshairTooltip**

Create `src/components/chart/CrosshairTooltip.tsx`:

A positioned floating panel that shows K-line bar details in compact single-column k-v format. Numbers colored red/green based on close vs open.

```tsx
import type { KlineBar } from '../../lib/types'
import { cn } from '../../lib/cn'

export function CrosshairTooltip({
  bar,
  position
}: {
  bar: KlineBar | null
  position: 'top-left' | 'top-right'
}) {
  if (!bar) return null

  const isUp = bar.close >= bar.open
  const closeColor = isUp ? 'text-[#0f9f6e]' : 'text-[#dc2626]'
  const change = bar.preClose ? bar.close - bar.preClose : 0
  const changePct = bar.preClose ? (change / bar.preClose) * 100 : 0
  const amplitude = ((bar.high - bar.low) / (bar.preClose || bar.close)) * 100
  const changeColor = change > 0 ? 'text-[#0f9f6e]' : change < 0 ? 'text-[#dc2626]' : 'text-foreground'

  const posClass = position === 'top-left'
    ? 'top-2 left-2'
    : 'top-2 right-2'

  return (
    <div className={cn(
      'absolute z-50 bg-background/90 border border-border px-2.5 py-2 font-mono text-[10px] leading-relaxed min-w-[120px]',
      posClass
    )}>
      <Row label="日期" value={bar.date} />
      <Row label="开盘" value={fmt(bar.open)} />
      <Row label="最高" value={fmt(bar.high)} color={closeColor} />
      <Row label="最低" value={fmt(bar.low)} color={closeColor} />
      <Row label="收盘" value={fmt(bar.close)} color={closeColor} />
      <Row label="涨幅" value={`${change > 0 ? '+' : ''}${changePct.toFixed(2)}%`} color={changeColor} />
      <Row label="振幅" value={`${amplitude.toFixed(2)}%`} />
      <Row label="成交量" value={fmtVolume(bar.volume)} />
      <Row label="成交额" value={fmtAmount(bar.amount)} />
      {bar.turnover != null && <Row label="换手率" value={`${bar.turnover.toFixed(2)}%`} />}
    </div>
  )
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className={color || 'text-foreground'}>{value}</span>
    </div>
  )
}

function fmt(n: number) { return n.toFixed(2) }
function fmtVolume(v: number) {
  if (v >= 1e8) return `${(v / 1e8).toFixed(2)}亿`
  if (v >= 1e4) return `${(v / 1e4).toFixed(0)}万`
  return v.toString()
}
function fmtAmount(a: number) {
  if (a >= 1e8) return `${(a / 1e8).toFixed(2)}亿`
  if (a >= 1e4) return `${(a / 1e4).toFixed(0)}万`
  return a.toString()
}
```

- [ ] **Step 2: Type check**

Run: `npm run typecheck 2>&1`

- [ ] **Step 3: Commit**

```bash
git add src/components/chart/CrosshairTooltip.tsx
git commit -m "feat: add CrosshairTooltip with Chinese labels and red/green coloring"
```

---

## Task 11: StockInfoPanel component

**Files:**
- Create: `src/components/watchlist/StockInfoPanel.tsx`

- [ ] **Step 1: Implement StockInfoPanel**

Create `src/components/watchlist/StockInfoPanel.tsx`:

```tsx
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { commands } from '../../lib/commands'
import { Badge } from '../shared/Badge'
import { cn } from '../../lib/cn'

export function StockInfoPanel({
  stockCode,
  selectedVersionId
}: {
  stockCode: string
  selectedVersionId?: string
}) {
  const queryClient = useQueryClient()

  const meta = useQuery({
    queryKey: ['stock-meta', stockCode],
    queryFn: () => commands.getStockMeta(stockCode),
    enabled: Boolean(stockCode)
  })

  const reviews = useQuery({
    queryKey: ['stock-reviews', stockCode, selectedVersionId],
    queryFn: () => commands.getStockReviews(stockCode, selectedVersionId),
    enabled: Boolean(stockCode)
  })

  const syncMutation = /* trigger sync_kline */;

  const m = meta.data
  const priceColor = !m?.change ? 'text-foreground'
    : m.change > 0 ? 'text-[#0f9f6e]' : 'text-[#dc2626]'
  const changeStr = m?.change != null
    ? `${m.change > 0 ? '+' : ''}${m.change.toFixed(2)} (${m.changePct != null ? (m.changePct > 0 ? '+' : '') + m.changePct.toFixed(2) + '%' : ''})`
    : ''

  return (
    <div className="flex flex-col h-full">
      {/* Stock metadata card */}
      <div className="p-3 border-b border-border">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-base font-semibold">{m?.name || stockCode}</span>
          {m?.stale && (
            <button
              className="px-1.5 py-0.5 bg-ring/20 text-ring font-mono text-[9px] hover:bg-ring hover:text-panel transition-all"
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
            >
              {syncMutation.isPending ? '同步中...' : '更新'}
            </button>
          )}
        </div>
        <div className="text-[10px] font-mono text-muted-foreground mb-2">
          {stockCode}{m?.exchange ? ` · ${m.exchange}` : ''}
        </div>
        {m?.latestPrice != null ? (
          <>
            <div className={cn('text-xl font-bold font-mono', priceColor)}>
              {m.latestPrice.toFixed(2)}
            </div>
            <div className={cn('font-mono text-[11px]', priceColor)}>
              {changeStr}
            </div>
          </>
        ) : (
          <div className="text-muted-foreground text-xs">暂无行情数据</div>
        )}
        {m?.latestDate && (
          <div className="text-[10px] font-mono text-muted-foreground mt-1">{m.latestDate}</div>
        )}
      </div>

      {/* Trade system evaluations */}
      <div className="flex-1 overflow-y-auto p-3">
        <div className="text-[10px] font-mono text-muted-foreground mb-2">交易系统评价</div>
        {(reviews.data ?? []).length > 0 ? (
          reviews.data!.map(review => (
            <div key={review.id} className="mb-1.5 p-2 bg-muted/40 border border-border text-xs">
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-[11px]">交易系统</span>
                <Badge tone={review.rating === 'focus' ? 'success' : review.rating === 'reject' ? 'danger' : 'warning'}>
                  {review.rating}
                </Badge>
              </div>
              <p className="text-[10px] text-muted-foreground leading-relaxed line-clamp-3">
                {review.overallEvaluation}
              </p>
            </div>
          ))
        ) : (
          <p className="text-[10px] text-muted-foreground">暂无交易系统纳入</p>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire into MyWatchlistPage**

Replace right panel placeholder with `<StockInfoPanel>`.

- [ ] **Step 3: Type check + commit**

Run: `npm run typecheck 2>&1`

```bash
git add src/components/watchlist/StockInfoPanel.tsx src/pages/MyWatchlistPage.tsx
git commit -m "feat: add StockInfoPanel with metadata card and trade system evaluations"
```

---

## Task 12: Remove old pages, final integration

**Files:**
- Remove: `src/pages/ChartPage.tsx`
- Remove: `src/pages/WatchlistPage.tsx`
- Modify: `src/pages/MyWatchlistPage.tsx` (final wiring)

- [ ] **Step 1: Delete old pages**

```bash
rm src/pages/ChartPage.tsx src/pages/WatchlistPage.tsx
```

- [ ] **Step 2: Finalize MyWatchlistPage with full integration**

Update `MyWatchlistPage.tsx` to integrate all sub-components with proper state lifting and data flow. Key state:
- `frequency`, `adjMode`, `subChartType`, `chartSettings` (ChartSettings), `settingsOpen`
- `drawingTool`, `pendingPayload` (same as old ChartPage)
- `crosshairBar` for tooltip display
- MA lines applied to KLineChartPanel based on settings

- [ ] **Step 3: Type check entire project**

Run: `npm run typecheck 2>&1`

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: remove old ChartPage and WatchlistPage, complete MyWatchlistPage integration"
```

---

## Task 13: Final verification and edge case handling

- [ ] **Step 1: Verify app starts**

Run: `npm run tauri:dev`
Expected: App launches, "我的自选" is default page

- [ ] **Step 2: Test key flows**
  - Click stock in left list → chart + right panel update
  - Switch frequency → chart reloads
  - Change adj mode → prices adjust
  - Toggle MA lines → lines appear/disappear
  - Drawing tools snap to high/low
  - Crosshair tooltip shows correct data with 1/4 avoidance
  - Context menu operations work
  - Stock meta stale tag appears when data not current

- [ ] **Step 3: Commit any fixes**

```bash
git add -A && git commit -m "fix: edge case handling for MyWatchlistPage"
```
