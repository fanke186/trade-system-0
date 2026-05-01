# 我的自选 — 设计文档

## 概述

合并【自选股票池】和【K 线图表】为【我的自选】页面，置顶为应用首页。三栏布局：自选列表 | K 线图表 | 股票详情。核心理念：在同一页面完成"切换标的→看 K 线→看评价"的闭环，无需跨页跳转。

## 架构决策

### 页面合并后的路由

```
routes:
  我的自选   → my-watchlist  (新首页, 合并 chart + watchlist)
  每日复盘   → daily-review
  交易系统   → trade-system
  Agent     → agent
  股票评分   → stock-review
  数据      → data
  设置      → settings
```

- 移除 `chart` 和 `watchlist` 两个 PageId
- 新增 `my-watchlist` 作为首项，设为默认页
- 新页面命名为 `MyWatchlistPage`

### 数据流

```
App.tsx (stockCode state) 
  → MyWatchlistPage
    ├── WatchlistSidebar    ← listWatchlists / addWatchlistItem / removeWatchlistItem / reorder / move
    ├── KLineChartArea      ← getBars / listChartAnnotations
    │     └── 依赖 chart settings state (MA, 坐标, 复权)
    └── StockInfoPanel      ← getStockMeta / listStockReviews
```

- `stockCode` state 仍在 App.tsx 中，由左侧列表点击切换
- Chart settings（MA 参数、坐标类型、复权模式）作为页面级 state
- 分组信息通过 watchlist CRUD 接口持久化

## 布局规格

```
┌──────────────┬──────────────────────────────────┬──────────────┐
│  160px 左栏   │          flex-1 中栏              │  240px 右栏   │
│  固定宽度     │         自适应填满                │  固定宽度     │
│  不可拖拽     │         不可拖拽                  │  不可拖拽     │
├──────────────┼──────────────────────────────────┼──────────────┤
│ 分组下拉      │ 无标题                            │ 股票元信息    │
│ 排序表头      │ Toolbar: 名称代码 | 周期 | 复权 | ⚙ │ 交易系统评价  │
│ 股票列表      │ K 线图 + 副图                     │              │
│ 右键菜单      │ 悬浮 K 线详情                     │              │
└──────────────┴──────────────────────────────────┴──────────────┘
```

## 左侧：自选列表 (160px)

### 分组选择器

- 顶部下拉选择器，点选展开分组列表
- 默认分组："我的自选"（系统默认创建，不可删除）
- 支持创建/重命名/删除分组（右键分组名称触发）
- 分组信息持久化到 SQLite

### 股票列表

两列信息：

| 列 | 内容 | 说明 |
|----|------|------|
| 名称 | 股票名（大字号） | 点击列头按名称排序 |
| | 代码（小号 mono 灰色） | |
| 涨幅 | 涨跌幅%（红绿着色） | 点击列头按涨幅排序 |
| | 最新价（小号 mono 灰色） | |

- 点击行 → 切换当前股票，中间和右侧刷新
- 当前选中行高亮（`bg-ring/20` 左侧色条）
- 排序支持升序/降序切換，点击同一列头反转方向

### 右键菜单

- 单只右键 → 操作单只；多选后右键 → 批量操作
- 菜单项：
  - **置顶** — 将该股票排到当前分组第一
  - **置底** — 排到最后
  - **从当前分组删除** — 移除
  - **复制到 →** — 二级菜单列出其他分组，点击复制
- 菜单定位在鼠标位置，点击空白处关闭

## 中间：K 线图表 (flex-1)

### Toolbar

一行平铺，从左到右：

```
[同花顺 300033] | [日K] [周K] [月K] | [前复权 ▾] | ............ | [⚙]
```

- 股票名（大字号）+ 代码（小号 mono 灰色）不可编辑
- 周期按钮：选中态实心 accent 色，未选中透明+灰色字
- 复权下拉：`前复权` / `后复权` / `除权`，默认前复权
- ⚙ 齿轮图标按钮，点击展开设置面板（Popover）

### 设置面板（Popover）

点击 ⚙ 弹出，包含：

**均线设置**
- 多条均线，每条可独立启用/关闭
- 默认提供 MA5、MA10、MA20、MA60，均可开关
- 每条均线显示颜色标识
- 支持添加自定义周期均线（输入框 + 加号按钮）

**坐标类型**
- 普通坐标（线性）
- 对数坐标（默认选中）

### 复权

- 位于齿轮左侧，下拉选择
- 前复权 / 后复权 / 除权
- 切换后重新计算并渲染 K 线数据
- 复权计算在 Rust 后端完成（get_bars 新增 adj 参数）

### 画线工具

- 两种模式：水平线、射线
- Toolbar 中放置两个按钮（横线 / 射线），与当前图表页画线逻辑一致
- **吸附功能**：画线时自动吸附最近 K 线的最高价或最低价（阈值 8% 振幅范围）
- 画线完成后弹出保存标注提示（沿用现有逻辑）

### K 线悬浮详情

- 跟随鼠标移动，显示当前十字光标所在 K 线的详细信息
- 单列 k-v 格式，紧凑排列：

```
日期     2026-04-30
开盘     125.80
最高     130.20  ← 涨绿跌红
最低     124.50  ← 涨绿跌红
收盘     128.50  ← 涨绿跌红
涨幅     +3.21%  ← 涨绿跌红
振幅     4.56%
成交量   12,500万
成交额   158.2亿
换手率   2.35%
```

- 数字着色规则：收盘 > 开盘 → 绿色，收盘 < 开盘 → 红色，平盘 → 灰色
- 最高最低不单独着色（跟随蜡烛颜色逻辑）
- 位置避让：鼠标在图表左 1/4 区 → 详情显示在右上角；右 1/4 区 → 左上角
- 半透明背景 `rgba(13,13,13,0.88)`，边框 `#2a2a2a`

### 副图

- 底部固定高度约 100px
- 支持切换：成交量（手） / 成交额（元）
- 切换按钮放在副图左上角，中文标注
- 柱状图着色与主图 K 线一致（涨红跌绿，沿用 klinecharts 库默认）

### 图表自身

- 无标题栏，无滚动条
- 图表大小随窗口 resize，通过 CSS flex 填满中间区域
- 只画一个图表（当前画了两个的 bug 修复）
- 网格线沿用现有暗色配置 `#2a2a2a` / `#262626`

## 右侧：股票详情 (240px)

### 股票元信息卡

```
┌──────────────────────────┐
│ 同花顺            [更新] │  ← 名称最大，tag 可点击
│ 300033 · 创业板           │  ← 代码 + 交易所
│                          │
│ 128.50                   │  ← 最新价大字号，涨绿跌红
│ +3.99 (+3.21%)           │  ← 涨跌额(涨跌幅)，涨绿跌红
│ 2026-05-01               │  ← 日期
└──────────────────────────┘
```

- 名称使用 DM Sans，最大化显示（约 18-20px）
- "更新" tag：当 K 线数据不是最新时显示在名称旁
  - "不是最新"的判断：当日日 K 数据缺失（交易日判断：非周末且数据截止日期 < 昨天）
  - 点击 tag 触发 `sync_kline(stockCode, 'incremental')`
  - 同步中 tag 显示"同步中..."并 disabled
- 最新价格：涨绿跌红平灰，等宽数字字体
- 元信息来源：复用现有的 `securities` 表（已有 symbol_id, code, name, exchange 字段），价格变动信息从最新 K 线计算

### 交易系统评价

- 标题"交易系统评价"（小号 mono）
- 列表项，每项显示：
  - 交易系统名称 + 版本
  - 评价标签（买入/观望/卖出等，使用现有 Badge 组件）
  - 简短评价文字
- 数据来源：`getStockReviews(stockCode)`，取各系统最新一条
- 无评价时显示空态："暂无交易系统纳入"

## 后端变更

### 股票元信息

- 复用现有 `securities` 表，无需新建
- 新增接口 `get_stock_meta(stockCode)`：
  - 从 securities 表取 name, exchange, board, list_date
  - 从 bars_1d 取最新一条 bar，计算 latest_price, change, change_pct
  - 返回 `StockMeta` 结构

### 自选分组操作

新增 Tauri command：

| Command | 功能 |
|---------|------|
| `reorder_watchlist_item` | 置顶/置底：修改 sort_order |
| `move_watchlist_item` | 移入其他分组：改 watchlist_id |
| `create_watchlist_group` | 新建分组 |
| `delete_watchlist_group` | 删除分组（禁止删除默认分组） |
| `rename_watchlist_group` | 重命名分组 |

### K 线复权

- `get_bars` 接口新增可选参数 `adj: 'pre' | 'post' | 'none'`
- 后端根据 adj 类型计算复权价：
  - 前复权：以最新日为基准，向前调整历史价格
  - 后复权：以首日为基准，向后调整后续价格
- 复权因子从 bars_1d 的 adj_factor 字段读取

### 图表设置持久化

- 均线设置、坐标类型、副图类型作为前端 localStorage 存储，不持久化到后端
- 复权类型属于图表显示设置，同样 localStorage

## 改动文件清单

### 新建

| 文件 | 说明 |
|------|------|
| `src/pages/MyWatchlistPage.tsx` | 新页面组件，组合三栏 |
| `src/components/watchlist/WatchlistSidebar.tsx` | 左侧自选列表 |
| `src/components/watchlist/StockInfoPanel.tsx` | 右侧股票详情 |
| `src/components/chart/ChartToolbar.tsx` | 图表工具栏 |
| `src/components/chart/CrosshairTooltip.tsx` | 悬浮 K 线详情 |
| `src/components/chart/SettingsPopover.tsx` | 设置弹出面板 |

### 修改

| 文件 | 改动 |
|------|------|
| `src/app/routes.tsx` | 移除 chart/watchlist，新增 my-watchlist，设为默认 |
| `src/app/App.tsx` | 替换 page 映射，新增 my-watchlist 页面 |
| `src/components/layout/AppShell.tsx` | 导航更新，右侧栏简化（移除 K 线覆盖区） |
| `src/components/chart/KLineChartPanel.tsx` | 单图模式、中文标签、副图切换、悬浮详情、画线吸附 |
| `src/lib/commands.ts` | 新增命令函数 |
| `src/lib/types.ts` | 新增 StockMeta 类型 |
| `src-tauri/src/models/mod.rs` | 新增 StockMeta、WatchlistOp 等结构体 |
| `src-tauri/src/commands/` | 新增 stock_meta、watchlist 操作命令 |
| `src-tauri/src/db/sqlite.rs` | 新增 watchlist 相关 SQL |
| `src-tauri/src/services/` | 新增 stock_meta 服务、复权计算服务 |

### 移除

| 文件 | 说明 |
|------|------|
| `src/pages/ChartPage.tsx` | 功能合并到 MyWatchlistPage |
| `src/pages/WatchlistPage.tsx` | 功能合并到 MyWatchlistPage |

## 不做

- 不接入实时行情（仍然基于本地 DuckDB）
- 不支持拖拽调整面板宽度
- 不支持自定义分组颜色/图标
- 不新增第三方依赖
- K 线图表库内部渲染不动（只改容器、标签、配置）
- 设置不跨设备同步（localStorage 即可）

## 设计规范遵守

- 配色、字体、组件风格严格遵循 CLAUDE.md 设计规范
- 所有新组件使用 DM Mono / DM Sans 字体
- 按钮直角、hover glow
- Input/Select 下划线风格
- Badge 实心色块
- 暗色高对比色板
