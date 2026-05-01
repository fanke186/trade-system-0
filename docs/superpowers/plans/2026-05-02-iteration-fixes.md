# v0.1.1 迭代修复 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 21 bugs and UX issues from v0.1.0 feedback: chart resize, MA overlay, drawing tools, duplicate sidebar, data page redesign with async sync, securities table expansion, and UI polish.

**Architecture:** Four parallel workstreams — Rust backend (DB schema + commands), Chart components (KLineChartPanel + drawing + tooltip), Layout (AppShell + icon + titlebar), Data page (KlineDataPage + search + health dashboard). Final integration pass wires everything.

**Tech Stack:** React 19 + TypeScript + Tauri 2 + Tailwind CSS + klinecharts + DuckDB + SQLite

**Spec:** `docs/superpowers/specs/2026-05-02-iteration-fixes-design.md`

---

## Task 1: Rust — DB schema expansion + KlineBar fields + migration

**Files:**
- Modify: `src-tauri/src/models/mod.rs`
- Modify: `src-tauri/src/db/duckdb.rs`
- Modify: `src-tauri/src/kline/http.rs`
- Modify: `src-tauri/src/services/kline_query_service.rs`

**Goal:** Add change/changePct/amplitude to KlineBar, expand securities table, remap eastmoney fields, migrate DuckDB.

### Step 1: Add fields to Rust KlineBar

In `src-tauri/src/models/mod.rs`, add after `adj_factor`:
```rust
pub change: Option<f64>,
pub change_pct: Option<f64>,
pub amplitude: Option<f64>,
```

### Step 2: Add DuckDB migration for bars tables

In `src-tauri/src/db/duckdb.rs`, in `run_migrations`, add after the bars_1d CREATE TABLE:
```sql
alter table bars_1d add column if not exists change double;
alter table bars_1d add column if not exists change_pct double;
alter table bars_1d add column if not exists amplitude double;
alter table bars_1w add column if not exists change double;
alter table bars_1w add column if not exists change_pct double;
alter table bars_1w add column if not exists amplitude double;
alter table bars_1M add column if not exists change double;
alter table bars_1M add column if not exists change_pct double;
alter table bars_1M add column if not exists amplitude double;
```

Expand securities table:
```sql
alter table securities add column if not exists industry text;
alter table securities add column if not exists sub_industry text;
alter table securities add column if not exists area text;
alter table securities add column if not exists market_type text;
alter table securities add column if not exists stock_type text not null default 'stock';
alter table securities add column if not exists total_cap double;
alter table securities add column if not exists pe_ratio double;
```

### Step 3: Update http.rs field mapping

In `src-tauri/src/kline/http.rs`, in the kline parsing function, add fields f58/f59/f60:

Current line format: `f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61` (date,open,close,high,low,volume,amount,amplitude,changePct,change,turnover)

Update the parsing to capture f58 (amplitude), f59 (changePct), f60 (change):
```rust
let amplitude: Option<f64> = parts.get(7).and_then(|s| s.parse().ok());
let change_pct: Option<f64> = parts.get(8).and_then(|s| s.parse().ok());
let change: Option<f64> = parts.get(9).and_then(|s| s.parse().ok());
```

Update the KlineBar construction to include these fields in the INSERT.

### Step 4: Update kline_query_service.rs

Update the SELECT queries in get_bars to include `change, change_pct, amplitude`.

### Step 5: Build check

Run: `cd src-tauri && cargo check 2>&1`

### Step 6: Commit

```bash
git add src-tauri/src/models/mod.rs src-tauri/src/db/duckdb.rs src-tauri/src/kline/http.rs src-tauri/src/services/kline_query_service.rs
git commit -m "feat: add change/changePct/amplitude to KlineBar, expand securities table"
```

---

## Task 2: Rust — async sync_kline + search_securities + data_health + config

**Files:**
- Modify: `src-tauri/src/commands/kline.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Create: `src-tauri/src/commands/data_ops.rs`
- Modify: `src-tauri/tauri.conf.json`

**Goal:** Make sync_kline async with progress events, add search_securities and get_data_health commands, update tauri config.

### Step 1: Async sync_kline with progress

In `src-tauri/src/commands/kline.rs`, modify `sync_kline` to be async and emit progress:

```rust
use tauri::Emitter;

#[tauri::command]
pub async fn sync_kline(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    stock_code: String,
    mode: String,
) -> Result<KlineSyncResult, String> {
    app.emit("kline-sync-progress", serde_json::json!({
        "stockCode": stock_code,
        "status": "started",
        "percent": 0
    })).ok();

    // ... existing sync logic ...

    app.emit("kline-sync-progress", serde_json::json!({
        "stockCode": stock_code,
        "status": "completed",
        "percent": 100,
        "rowsWritten": result.rows_written
    })).ok();

    Ok(result)
}
```

### Step 2: Create data_ops.rs

Create `src-tauri/src/commands/data_ops.rs`:

```rust
use crate::AppState;
use tauri::State;
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecuritySearchResult {
    pub code: String,
    pub name: String,
    pub market_type: Option<String>,
    pub stock_type: String,
}

#[tauri::command]
pub async fn search_securities(
    state: State<'_, AppState>,
    keyword: String,
    limit: Option<usize>,
) -> Result<Vec<SecuritySearchResult>, String> {
    let db = state.duckdb.lock().unwrap();
    let limit = limit.unwrap_or(20);
    let pattern = format!("%{}%", keyword);
    let mut stmt = db.prepare(
        "SELECT code, name, market_type, stock_type FROM securities
         WHERE (code LIKE ?1 OR name LIKE ?2) AND status = 'active'
         ORDER BY CASE WHEN code LIKE ?1 THEN 0 ELSE 1 END, code
         LIMIT ?3"
    ).map_err(|e| e.to_string())?;
    let results = stmt.query_map(
        duckdb::params![pattern, pattern, limit as i64],
        |row| Ok(SecuritySearchResult {
            code: row.get(0)?,
            name: row.get(1)?,
            market_type: row.get(2)?,
            stock_type: row.get(3)?,
        })
    ).map_err(|e| e.to_string())?
    .filter_map(|r| r.ok())
    .collect();
    Ok(results)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataHealth {
    pub total_securities: i64,
    pub complete_count: i64,
    pub incomplete_count: i64,
    pub completeness_pct: f64,
    pub mood: String, // "good" | "ok" | "bad"
    pub by_market: Vec<MarketBreakdown>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketBreakdown {
    pub market_type: String,
    pub total: i64,
    pub complete: i64,
}

#[tauri::command]
pub async fn get_data_health(
    state: State<'_, AppState>,
) -> Result<DataHealth, String> {
    let db = state.duckdb.lock().unwrap();
    let total: i64 = db.query_row(
        "SELECT COUNT(*) FROM securities WHERE stock_type='stock' AND status='active'",
        [], |r| r.get(0)
    ).unwrap_or(0);

    let complete: i64 = db.query_row(
        "SELECT COUNT(DISTINCT s.symbol_id) FROM securities s
         INNER JOIN bars_1d b ON s.symbol_id = b.symbol_id
         WHERE s.stock_type='stock' AND b.trade_date >= (SELECT MAX(trade_date) FROM bars_1d WHERE stock_code = (SELECT code FROM securities LIMIT 1))",
        [], |r| r.get(0)
    ).unwrap_or(0);

    let incomplete = total - complete;
    let completeness_pct = if total > 0 { (complete as f64 / total as f64) * 100.0 } else { 0.0 };
    let mood = if completeness_pct >= 95.0 { "good" } else if completeness_pct >= 70.0 { "ok" } else { "bad" };

    // Breakdown by market
    let mut stmt = db.prepare(
        "SELECT COALESCE(market_type,'未知'), COUNT(*),
                COUNT(DISTINCT CASE WHEN b.symbol_id IS NOT NULL THEN s.symbol_id END)
         FROM securities s
         LEFT JOIN bars_1d b ON s.symbol_id = b.symbol_id AND b.trade_date >= (SELECT MAX(trade_date) FROM bars_1d LIMIT 1)
         WHERE s.stock_type='stock' AND s.status='active'
         GROUP BY market_type ORDER BY COUNT(*) DESC"
    ).map_err(|e| e.to_string())?;
    // ... mapping to MarketBreakdown ...

    Ok(DataHealth { total_securities: total, complete_count: complete, incomplete_count: incomplete, completeness_pct, mood, by_market })
}
```

### Step 3: Register commands + update tauri conf

In `src-tauri/src/lib.rs`:
```rust
mod commands::data_ops;
// register: data_ops::search_securities, data_ops::get_data_health
```

In `tauri.conf.json`:
```json
"windows": [{
  "title": "trade-system-0",
  "width": 1600,
  "height": 1000,
  "decorations": false,
  "titleBarStyle": "Overlay"
}],
"bundle": { "icon": ["icons/32x32.png", "icons/128x128.png", "icons/128x128@2x.png", "icons/icon.icns", "icons/icon.ico"] }
```

### Step 4: Build check + commit

Run: `cd src-tauri && cargo check 2>&1`

```bash
git add src-tauri/src/commands/kline.rs src-tauri/src/commands/data_ops.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs src-tauri/tauri.conf.json
git commit -m "feat: async sync_kline with progress, search_securities, data_health commands"
```

---

## Task 3: Frontend — AppShell fixes (sidebar, header, icon, layout)

**Files:**
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/app/App.tsx`

**Goal:** Conditional right sidebar, header cleanup, app icon, my-watchlist special layout.

### Step 1: Conditional right sidebar + header cleanup

In AppShell.tsx:
- Accept `activePage` prop (already there)
- Right `<aside>` only renders when `activePage !== 'my-watchlist'`
- When `activePage === 'my-watchlist'`, `<main>` has `className="flex-1 min-h-0"` (no overflow-auto, no padding)
- When other pages, `<main>` keeps `className="overflow-auto p-4"`
- Header: remove the right-side `<span>` blocks with Database/Server icons (stock code + coverage rows)
- Import app icon image

### Step 2: App icon in sidebar header

Replace `<CircleDot>` + "trade-system-0" text with:
```tsx
import appIcon from '../../assets/qsgg.png'
// In the sidebar header:
<img src={appIcon} className="h-8 w-8 rounded-md object-cover" alt="QSGG" />
```

The qsgg.png needs to be copied/imported. Place a resized version in `src/assets/qsgg.png`.

### Step 3: Update App.tsx

- Import `KlineDataPage` instead of `DataPage`
- Add `activePage` prop passthrough for AppShell sidebar logic

### Step 4: Type check

Run: `npm run typecheck 2>&1`

### Step 5: Commit

```bash
git add src/components/layout/AppShell.tsx src/app/App.tsx src/assets/qsgg.png
git commit -m "fix: conditional right sidebar, header cleanup, app icon, chart layout"
```

---

## Task 4: Frontend — KLineChartPanel fixes (MA, hollow candles, yAxis, drawing)

**Files:**
- Modify: `src/components/chart/KLineChartPanel.tsx`

**Goal:** Fix MA overlay (no sub-panes), hollow red candles, yAxis labels, drawing tool without save banner.

### Step 1: Fix MA overlay

Change `createIndicator({name:'MA', ...}, true)` to `createIndicator({name:'MA', ...}, false)` so MA overlays on candle_pane instead of creating new panes.

Remove the `getIndicatorByPaneId` + `removeIndicator` logic — instead track created MA indicators by ID and remove/re-create.

### Step 2: Hollow red candles

In chart init styles:
```typescript
candle: {
  bar: {
    upColor: 'rgba(220, 38, 38, 0.12)',
    upBorderColor: '#dc2626',
    upWickColor: '#dc2626',
    downColor: '#0f9f6e',
    downBorderColor: '#0f9f6e',
    downWickColor: '#0f9f6e',
    noChangeColor: '#737373',
    noChangeBorderColor: '#737373',
    noChangeWickColor: '#737373'
  }
}
```

### Step 3: yAxis labels

In chart init styles:
```typescript
yAxis: {
  showRule: true,
  inside: false,
  labels: { fontSize: 9, color: '#888888' }
}
```

### Step 4: Remove save annotation banner from chart area

Remove the `pendingPayload` / `saveMutation` / save button related UI from KLineChartPanel. Drawing completes and saves immediately (call saveChartAnnotation directly in onDrawEnd).

### Step 5: Commit

```bash
git add src/components/chart/KLineChartPanel.tsx
git commit -m "fix: MA overlay on candle_pane, hollow red candles, yAxis labels, auto-save drawings"
```

---

## Task 5: Frontend — Drawing toolbar + Magnifier + Price label

**Files:**
- Create: `src/components/chart/DrawingToolbar.tsx`
- Create: `src/components/chart/Magnifier.tsx`
- Modify: `src/components/chart/KLineChartPanel.tsx`

**Goal:** Floating toolbar on line selection, magnifier on precise placement, price label on horizontal lines.

### Step 1: DrawingToolbar component

Create `src/components/chart/DrawingToolbar.tsx`:

```tsx
import { useState, useRef, useEffect } from 'react'
import { Trash2, Undo2, GripHorizontal } from 'lucide-react'

const COLORS = ['#4d90fe', '#f0b93b', '#bb9af7', '#7dcfff', '#ff8c69']

export function DrawingToolbar({
  position,
  onColorChange,
  onUndo,
  onDelete,
  onDragEnd,
}: {
  position: { x: number; y: number }
  onColorChange: (color: string) => void
  onUndo: () => void
  onDelete: () => void
  onDragEnd: (pos: { x: number; y: number }) => void
}) {
  const [dragging, setDragging] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState(position)

  // Drag logic: mousedown on grip → track movement → onDragEnd on mouseup
  // ... implementation

  return (
    <div ref={ref} className="absolute z-50 flex items-center gap-1 border border-border bg-panel px-2 py-1 shadow-lg"
         style={{ left: pos.x, top: pos.y }}>
      {COLORS.map(c => (
        <button key={c} className="h-4 w-4 rounded-full border border-border/50"
                style={{ backgroundColor: c }} onClick={() => onColorChange(c)} />
      ))}
      <div className="mx-1 h-4 w-px bg-border" />
      <button onClick={onUndo} className="p-0.5 text-muted-foreground hover:text-foreground">
        <Undo2 className="h-3.5 w-3.5" />
      </button>
      <button className="p-0.5 text-muted-foreground hover:text-foreground cursor-grab"
              onMouseDown={handleDragStart}>
        <GripHorizontal className="h-3.5 w-3.5" />
      </button>
      <button onClick={onDelete} className="p-0.5 text-danger hover:text-danger/80">
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
```

### Step 2: Magnifier component

Create `src/components/chart/Magnifier.tsx`:

Renders a small canvas (160×120px) showing the ±5 bars around current mouse position at 2.5x zoom.

```tsx
export function Magnifier({
  bars,
  centerIndex,
  position, // 'top-left' | 'top-right'
}: {
  bars: KlineBar[]
  centerIndex: number
  position: 'top-left' | 'top-right'
}) {
  // Render mini K-line view using canvas
  // Shows ±5 bars around centerIndex at 2.5x scale
  // ... canvas drawing logic
}
```

Activation: In KLineChartPanel, track mouse movement speed. If last 3 mousemove events have delta < 3px, show Magnifier.

### Step 3: Price label on horizontal lines

In the overlay creation for horizontal lines, add `extendData` with formatted price. The klinecharts library should render this. If not, use a custom overlay renderer.

### Step 4: Wire drawingTool into KLineChartPanel

Remove drawingTool prop. Instead, drawing tools live in the chart's own overlay system. When a line is clicked:
- Show DrawingToolbar near the line
- Enable anchor dragging
- Color change updates the overlay style
- Delete removes the overlay

### Step 5: Commit

```bash
git add src/components/chart/DrawingToolbar.tsx src/components/chart/Magnifier.tsx src/components/chart/KLineChartPanel.tsx
git commit -m "feat: drawing toolbar with color/undo/delete, magnifier, horizontal line price label"
```

---

## Task 6: Frontend — CrosshairTooltip fix + SettingsPopover MA delete

**Files:**
- Modify: `src/components/chart/CrosshairTooltip.tsx`
- Modify: `src/components/chart/SettingsPopover.tsx`

### Step 1: Fix CrosshairTooltip coloring

Change the comparison from `bar.close >= bar.open` to comparing against `bar.preClose` (previous bar's close):

```typescript
const prevClose = bar.preClose ?? bar.open
const closeVsPrev = bar.close - prevClose
const isUp = closeVsPrev >= 0
const textColor = isUp ? 'text-[#0f9f6e]' : 'text-[#dc2626]'

// Each OHLC value colored vs preClose
// 涨幅 = close - preClose, colored red/green
// 振幅 = (high - low) / preClose * 100
// 换手率 = bar.turnover (already in data)
```

Show bar.change, bar.changePct, bar.amplitude if available.

### Step 2: SettingsPopover MA delete

Add × button next to each MA line:
```tsx
{settings.maLines.map((line, i) => (
  <label key={line.period} className="flex items-center gap-2">
    <input type="checkbox" checked={line.enabled} onChange={() => toggleMa(i)} />
    <span className="w-2 h-2 rounded-full" style={{backgroundColor: line.color}} />
    <span className="font-mono flex-1">MA{line.period}</span>
    <button onClick={() => removeMa(i)} className="text-muted-foreground hover:text-danger">
      <X className="h-3 w-3" />
    </button>
  </label>
))}
```

`removeMa` filters out the MA at index i.

### Step 3: Commit

```bash
git add src/components/chart/CrosshairTooltip.tsx src/components/chart/SettingsPopover.tsx
git commit -m "fix: CrosshairTooltip colors vs preClose, add MA delete button"
```

---

## Task 7: Frontend — KlineDataPage (rename + search + health dashboard)

**Files:**
- Create: `src/pages/KlineDataPage.tsx`
- Delete: `src/pages/DataPage.tsx`
- Modify: `src/app/routes.tsx`
- Modify: `src/app/App.tsx`

### Step 1: Rename route

In `src/app/routes.tsx`:
```typescript
// Change: 'data' → 'kline-data', label: '数据' → 'K线数据'
export type PageId = 'kline-data' | ...
```

### Step 2: Create KlineDataPage

Create `src/pages/KlineDataPage.tsx`:

**Top: Data Health Dashboard**
```tsx
function DataHealthBanner() {
  const health = useQuery({
    queryKey: ['data-health'],
    queryFn: () => commands.getDataHealth(),
    refetchInterval: 5000,
  })

  const moodEmoji = { good: '😊', ok: '😐', bad: '😞' }
  const h = health.data

  if (!h) return null

  return (
    <div className="flex items-center gap-6 border border-border bg-panel p-4 mb-4">
      <span className="text-3xl">{moodEmoji[h.mood]}</span>
      <div className="flex-1">
        <div className="text-sm font-semibold">
          数据齐整度 · {h.completenessPct.toFixed(1)}% · {h.mood === 'good' ? '良好' : h.mood === 'ok' ? '一般' : '较差'}
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          共 {h.totalSecurities.toLocaleString()} 只标的 · {h.completeCount.toLocaleString()} 只齐全 · {h.incompleteCount.toLocaleString()} 只待同步
        </div>
      </div>
      <Button variant="primary" onClick={/* trigger sync-all */}>
        一键补齐
      </Button>
    </div>
  )
}
```

**Auto-complete Input**
```tsx
function SecurityAutocomplete({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const [input, setInput] = useState('')
  const [results, setResults] = useState<Array<{code:string;name:string}>>([])
  const [open, setOpen] = useState(false)

  // Debounced search on input change
  useEffect(() => {
    if (input.length < 1) { setResults([]); return }
    const timer = setTimeout(async () => {
      const r = await commands.searchSecurities(input, 15)
      setResults(r)
      setOpen(true)
    }, 150)
    return () => clearTimeout(timer)
  }, [input])

  return (
    <div className="relative">
      <div className="flex gap-2">
        <Input placeholder="代码" value={input} onChange={e => setInput(e.target.value)}
               className="w-28" />
        <Input placeholder="名称" value={selectedName} readOnly className="flex-1" />
      </div>
      {open && results.length > 0 && (
        <div className="absolute top-full z-50 mt-1 w-full border border-border bg-panel max-h-48 overflow-y-auto">
          {results.map(r => (
            <button key={r.code} onClick={() => { onChange(r.code); setInput(r.code); setOpen(false) }}
                    className="w-full px-3 py-1.5 text-left text-xs hover:bg-muted font-mono">
              {r.code} — {r.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```

**Securities Search Table**

Table with columns: 代码 | 名称 | 涨幅 | 现价 | 所属行业 | 数据状态
- Each column sortable
- 涨幅/现价 red/green coloring
- Data status: Badge (齐全=success, 缺失=danger, 同步中=warning)
- Search bar at top with autocomplete

### Step 3: Async sync UI

Listen for `kline-sync-progress` events:
```tsx
import { listen } from '@tauri-apps/api/event'

useEffect(() => {
  const unlisten = listen<{stockCode:string; status:string; percent:number}>('kline-sync-progress', (event) => {
    setSyncProgress(event.payload)
  })
  return () => { unlisten.then(fn => fn()) }
}, [])
```

Show progress in the sync button area: spinner + percentage text.

### Step 4: Delete old DataPage + wire up

```bash
rm src/pages/DataPage.tsx
```

In App.tsx, replace `DataPage` import with `KlineDataPage`.

### Step 5: Type check + commit

Run: `npm run typecheck 2>&1`

```bash
git add src/pages/KlineDataPage.tsx src/pages/DataPage.tsx src/app/routes.tsx src/app/App.tsx
git commit -m "feat: rename Data→K线数据, add health dashboard, autocomplete search, async sync UI"
```

---

## Task 8: Frontend — Types + Commands + MyWatchlistPage cleanup

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/commands.ts`
- Modify: `src/pages/MyWatchlistPage.tsx`

### Step 1: Update TS types

In `src/lib/types.ts`, add to KlineBar:
```typescript
change?: number | null
changePct?: number | null
amplitude?: number | null
```

Add new types:
```typescript
export type SecuritySearchResult = {
  code: string
  name: string
  marketType?: string | null
  stockType: string
}

export type DataHealth = {
  totalSecurities: number
  completeCount: number
  incompleteCount: number
  completenessPct: number
  mood: 'good' | 'ok' | 'bad'
  byMarket: Array<{ marketType: string; total: number; complete: number }>
}
```

### Step 2: Add commands

```typescript
searchSecurities: (keyword: string, limit?: number) =>
  call<SecuritySearchResult[]>('search_securities', { keyword, limit }),

getDataHealth: () =>
  call<DataHealth>('get_data_health'),
```

Also update `syncKline` return type handling for progress.

### Step 3: MyWatchlistPage cleanup

- Remove save annotation banner UI
- Remove drawingTool state (moved into chart)
- Remove saveMutation
- Pass correct `activePage` prop for layout

### Step 4: Type check + commit

Run: `npm run typecheck 2>&1`

```bash
git add src/lib/types.ts src/lib/commands.ts src/pages/MyWatchlistPage.tsx
git commit -m "feat: update types and commands for v0.1.1, cleanup MyWatchlistPage"
```

---

## Task 9: Integration — Icons, titlebar, final plumbing, tests

**Files:**
- Create/Move: `src-tauri/icons/` (generated from qsgg.png)
- Modify: `src/app/App.test.tsx`
- Modify: `src/styles/index.css`

### Step 1: Generate app icons

```bash
# Resize qsgg.png to required sizes and place in src-tauri/icons/
# Or use tauri icon generation:
cargo tauri icon reference/qsgg.png
```

### Step 2: Global scrollbar hiding

In `src/styles/index.css`:
```css
* {
  scrollbar-width: thin;
  scrollbar-color: #2a2a2a transparent;
}
*::-webkit-scrollbar { width: 4px; }
*::-webkit-scrollbar-track { background: transparent; }
*::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 2px; }
```

### Step 3: Update test

In `src/app/App.test.tsx`, update mocks and assertions for new route names and page imports.

### Step 4: Final typecheck + tests

```bash
npm run typecheck 2>&1
npm test 2>&1
cd src-tauri && cargo check 2>&1
```

### Step 5: Commit

```bash
git add src-tauri/icons/ src/styles/index.css src/app/App.test.tsx
git commit -m "chore: app icons, scrollbar styling, test updates"
```
