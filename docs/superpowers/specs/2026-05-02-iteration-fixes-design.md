# v0.1.1 迭代修复 — 设计文档

## 概述

基于 v0.1.0 "我的自选" 首次实现的用户反馈，进行三轮改进：Bug 修复、UI 打磨、数据板块重构。

---

## A. Bug 修复

### A1. 图表不跟随窗口 resize

**根因**：AppShell 的 `<main className="overflow-auto p-4">` 给 MyWatchlistPage 外层加了 padding 和滚动容器，导致内部 `flex-1` 无法正确计算高度。

**修复**：
- 当 `activePage === 'my-watchlist'` 时，`<main>` 改为 `className="flex-1 min-h-0"`（无 padding、无 overflow）
- 其他页面保持原样
- KLineChartPanel 的 `kline-chart-host` div 确认使用 `w-full h-full`

### A2. MA 均线画成独立副图

**根因**：`createIndicator({name:'MA'...}, true)` 的第二个参数 `true` 表示创建独立 pane。

**修复**：
- 使用 `chart.createIndicator(maConfig, false)` 叠加到 candle_pane
- 或者使用 klinecharts 内置 `chart.addTechnicalIndicator('MA', calcParams)` 方式
- 确保 MA 线叠加在主图蜡烛上
- 设置面板的"删除均线"功能：每条均线旁边加 × 按钮
- 修复均线显示/隐藏开关

### A3. 画线工具重构

**A3.1 去掉标注**：删除底部"保存标注"UI 横条和相关 mutation 逻辑。画线即保存。

**A3.2 精确吸附放大镜**：
- 当用户画线且鼠标移动极慢（连续两次 mousemove 距离 < 3px）时判定为"精确定位"
- 在主图左上角或右上角渲染局部放大视图
- 放大镜取当前鼠标位置 ±5 bar 的 K 线数据，用小 canvas 渲染
- 放大倍率 2x-3x，尺寸约 160×120px

**A3.3 横线价格标签**：
- 射线不显示价格
- 水平线在左端上方显示价格，字体大小与主图技术指标标签一致（约 9-10px mono）
- 固定在横线左端，随横线移动

**A3.4 画线选中工具栏**：
- 点击已画的线 → 显示悬浮工具栏
- 工具栏内容：
  - **5 种预设颜色**：`#4d90fe`（蓝）、`#f0b93b`（琥珀）、`#bb9af7`（紫）、`#7dcfff`（青）、`#ff8c69`（珊瑚橙）— 均与K线红绿区分
  - **撤销按钮**：撤销当前画线的上一个修改动作
  - **拖拽手柄**：可拖拽工具栏到主图任意位置
  - **删除按钮**：删除该画线
- 支持锚点拖拽：线的端点可拖拽，重新吸附到 K 线高低点

### A4. 右侧栏双重渲染

**根因**：AppShell 自带 `<aside>` 右侧栏在所有页面都渲染。MyWatchlistPage 内部又有 StockInfoPanel 作为右侧栏。导致两个右栏同时存在。

**修复**：
- AppShell 的 `<aside>` 仅在 `activePage !== 'my-watchlist'` 时渲染
- my-watchlist 页面使用自带的 StockInfoPanel 作为右侧栏
- AppShell grid 在 my-watchlist 页改为两栏（左导航 | 中+右由 MyWatchlistPage 自行管理）

### A5. 图表切页后消失

**根因**：离开 my-watchlist → dispose 图表 → 回来时重新 init，但此时 bars 数据可能还在 React Query 缓存中未 re-fetch → `bars.length === 0` → 显示空态

**修复**：
- KLineChartPanel 新增 `ref` 保存上次有数据的 bars 长度
- 当 bars.length === 0 但 lastBarCount > 0 时，先显示上次数据（从 ref），等新数据到达再更新
- 或者：MyWatchlistPage 永远不传 `enabled: false`，让查询保持活跃以利用缓存

### A6. K 线详情着色 & 补字段

**着色规则修正**：
- 开盘/最高/最低/收盘：与**上一条 K 线的收盘价**比较，红涨绿跌（不是与当前 bar 的 open 比）
- 涨幅：红涨绿跌平灰

**KlineBar 新增字段**：
```typescript
export type KlineBar = {
  // ... 现有字段
  change?: number | null       // 涨跌额（与 preClose 的差值）
  changePct?: number | null    // 涨跌幅%
  amplitude?: number | null    // 振幅%
}
```

**Rust struct 同步更新**，DuckDB 表 `bars_1d/1w/1M` 新增对应列。

**数据映射**：东方财富 API f58→振幅, f59→涨跌幅, f60→涨跌额。http.rs 中补充映射即可。

### A7. 主图空心红柱

klinecharts 配置：
```json
{
  "candle": {
    "bar": {
      "upColor": "rgba(220, 38, 38, 0.15)",
      "upBorderColor": "#dc2626",
      "downColor": "#0f9f6e",
      "downBorderColor": "#0f9f6e"
    }
  }
}
```
上涨柱：红色边框 + 浅红半透明填充（空心感），下跌柱：绿色实心。

### A8. 滚动条清理

- 全局：除 textarea 外，`overflow: hidden` 或 `overflow: clip`
- 列表区域（左侧自选列表、右侧交易系统评价）使用 `overflow-y: auto` + 自定义细滚动条样式（4px 宽，颜色 `#2a2a2a`）

---

## B. UI 打磨

### B1. 顶栏精简

删除 AppShell header 右侧的：
- `[股票代码]` 信息行
- `日 X / 周 X / 月 X` K线覆盖行

保留左侧交易系统 + Provider badge。

### B2. 应用图标

**图标文件**：`reference/qsgg.png`（4.7MB PNG）

**Tauri 图标生成**：
- 使用 `cargo tauri icon qsgg.png` 或手动生成多尺寸
- 输出到 `src-tauri/icons/` 目录
- bundle.icon 配置指向新图标

**界面展示**：
- 左侧导航栏顶部（原 `trade-system-0` 文字位置）
- 图标裁切为 32×32px，圆角 6px
- 右侧保留小号应用名或直接去掉
- 用 `<img>` 替换 `<CircleDot>` icon

### B3. 隐藏原生标题栏

`tauri.conf.json`：
```json
"windows": [{
  "decorations": false,
  "titleBarStyle": "Overlay"
}]
```
- 去掉白色标题栏
- macOS 上可能需要额外处理 traffic lights 位置
- 创建自定义标题栏（简易：左侧留出 traffic lights 空间即可）

### B4. 坐标轴刻度

klinecharts yAxis 配置启用左右刻度显示：
```json
{
  "yAxis": {
    "showRule": true,
    "inside": false,
    "position": "left",
    "labels": { "fontSize": 9 }
  }
}
```
- 主图左侧/右侧显示价格刻度
- 副图左侧/右侧显示成交量或成交额刻度

### B5. 初始窗口尺寸

```json
"width": 1600, "height": 1000
```

---

## C. K 线数据板块重构

### C1. 改名

- PageId: `data` → `kline-data`
- 路由标签: "数据" → "K线数据"
- 文件名: `DataPage.tsx` → `KlineDataPage.tsx`

### C2. securities 表重设计

**新增字段**（DuckDB）：
```sql
ALTER TABLE securities ADD COLUMN industry TEXT;        -- 申万一级行业
ALTER TABLE securities ADD COLUMN sub_industry TEXT;    -- 申万二级行业
ALTER TABLE securities ADD COLUMN area TEXT;            -- 地区
ALTER TABLE securities ADD COLUMN market_type TEXT;     -- 主板/创业板/科创板/北交所
ALTER TABLE securities ADD COLUMN stock_type TEXT NOT NULL DEFAULT 'stock';  -- stock/index/etf
ALTER TABLE securities ADD COLUMN total_cap REAL;       -- 总市值（亿）
ALTER TABLE securities ADD COLUMN pe_ratio REAL;        -- 市盈率
ALTER TABLE securities ADD COLUMN list_date DATE;       -- 保留
ALTER TABLE securities ADD COLUMN update_date TEXT;     -- 元数据更新时间
```

**纳入索引**（seed_defaults 增加）：
- 上证指数 (000001.SH, stock_type='index')
- 深证成指 (399001.SZ, stock_type='index')
- 创业板指 (399006.SZ, stock_type='index')
- 科创50 (000688.SH, stock_type='index')
- 沪深300 (000300.SH, stock_type='index')
- 中证500 (000905.SH, stock_type='index')

**全量A股元数据**：首次启动或手动触发时，从东方财富获取全量股票列表（约 5000+ 只）写入 securities。

### C3. KlineBar 补字段

**DuckDB 表变更**（需要 migration）：
```sql
ALTER TABLE bars_1d ADD COLUMN change REAL;
ALTER TABLE bars_1d ADD COLUMN change_pct REAL;
ALTER TABLE bars_1d ADD COLUMN amplitude REAL;
-- 同样对 bars_1w, bars_1M
```

**http.rs 字段映射更新**：
```
f52 → open, f53 → close, f54 → high, f55 → low
f56 → volume, f57 → amount, f58 → amplitude
f59 → changePct, f60 → change, f61 → turnover
```

**Rust KlineBar struct 新增**：`change: Option<f64>, change_pct: Option<f64>, amplitude: Option<f64>`
**TS KlineBar type 新增**：同上

### C4. 异步下载 + 进度

**后端 async 化**：
- `sync_kline` 改为 `async` command
- HTTP 请求在 tauri::async_runtime 中执行
- 通过 `app_handle.emit("kline-sync-progress", payload)` 推送实时进度

**前端非阻塞**：
- 同步按钮处显示 spinner + 进度
- `listen("kline-sync-progress", callback)` 更新进度 state
- 同步完成后 Toast 提示"同步完成：写入 X 行"

### C5. 代码/名称自动补全

**新命令**：`search_securities(keyword: &str) -> Vec<SecuritySearchResult>`

- 模糊匹配 code 或 name（`WHERE code LIKE '%kw%' OR name LIKE '%kw%'`）
- 返回前 20 条：code, name, market_type, stock_type
- 前端首次加载时全量拉取 securities 到内存 Map（约 5000 条，～200KB）用于即时搜索
- Input 输入时：下拉候选列表，点选自动填入代码和名称

### C6. 删除覆盖范围子板块

DataPage 中当前显示 K 线覆盖范围的子板块删除。相关功能已由右侧 StockInfoPanel 的"更新" tag 覆盖。

### C7. 数据齐整度仪表盘

放在 K 线数据页顶部：

**计算逻辑**：
```sql
-- 全市场标的数
SELECT COUNT(*) FROM securities WHERE stock_type = 'stock' AND status = 'active';
-- 有今日数据的标的数（实际检查最新数据日期）
SELECT COUNT(DISTINCT symbol_id) FROM bars_1d WHERE trade_date >= '最新交易日';
-- 完备率 = 有数据 / 总标的
```

**三档表情**：
- 😊 ≥ 95%
- 😐 70%–95%
- 😞 < 70%

**UI**：一行卡片，显示表情 + 完备率数字 + 缺失数量 + 分布（按 market_type 分组）+ [一键补齐] 按钮

**一键补齐**：后台逐个 async sync 不完备标的，更新进度和面板

### C8. 证券搜索增强

重构 DataPage 表格：

| 列 | 数据来源 | 排序 | 着色 |
|----|---------|------|------|
| 代码 | securities.code | ✓ | — |
| 名称 | securities.name | ✓ | — |
| 涨幅 | bars_1d change_pct（最新） | ✓ | 涨红跌绿 |
| 现价 | bars_1d close（最新） | ✓ | 对比前日涨红跌绿 |
| 所属行业 | securities.industry | ✓ | — |
| 数据状态 | 检查 bars_1d 最新日期 | ✓ | 齐全/缺失/同步中 badge |

---

## 不改

- 不换数据源（东方财富 API 已覆盖所需全部字段，只需正确映射）
- 不新增第三方依赖
- 不修改交易系统、Agent、评分等其他模块的核心逻辑
- 不动 klinecharts 库内部

## 文件变更

### 修改
| 文件 | 改动 |
|------|------|
| `src/app/AppShell.tsx` | 右侧栏条件渲染、my-watchlist 特殊布局、顶栏精简、图标替换 |
| `src/pages/MyWatchlistPage.tsx` | 去标注UI、resize修复 |
| `src/components/chart/KLineChartPanel.tsx` | MA修复、空心柱、坐标轴、画线重构、放大镜、补字段 |
| `src/components/chart/CrosshairTooltip.tsx` | 着色修正（vs preClose）、新字段显示 |
| `src/components/chart/SettingsPopover.tsx` | MA 删除按钮 |
| `src/components/chart/ChartToolbar.tsx` | 去画线按钮（画线工具栏移到图上悬浮） |
| `src/components/watchlist/StockInfoPanel.tsx` | 新字段显示、stale 检测 |
| `src/lib/types.ts` | KlineBar 新增 change/changePct/amplitude |
| `src/lib/commands.ts` | 新命令 |
| `src/app/routes.tsx` | data→kline-data |
| `src/app/App.tsx` | 页面映射更新 |
| `src-tauri/src/models/mod.rs` | KlineBar 新字段、SecuritySearchResult |
| `src-tauri/src/kline/http.rs` | f58/f59/f60 映射 |
| `src-tauri/src/db/duckdb.rs` | securities/bars 表 migration、全量 A 股元数据 seed |
| `src-tauri/src/services/kline_query_service.rs` | bars 新字段 |
| `src-tauri/src/commands/kline.rs` | async sync_kline + progress emit |
| `src-tauri/src/commands/` | search_securities、get_data_health |
| `src-tauri/tauri.conf.json` | decorations false、窗口尺寸、图标路径 |

### 新建
| 文件 | 说明 |
|------|------|
| `src/components/chart/DrawingToolbar.tsx` | 画线悬浮工具栏 |
| `src/components/chart/Magnifier.tsx` | 精确吸附放大镜 |
| `src/pages/KlineDataPage.tsx` | 重构后的数据页 |

### 删除
| 文件 | 说明 |
|------|------|
| `src/pages/DataPage.tsx` | 重构为 KlineDataPage |
