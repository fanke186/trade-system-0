# 202605030327: AI对话框 + 设置 + K线内存泄漏 修复方案

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修三个模块的 bug——AI 对话框（自动滚动/JSON 解析/关闭按钮）、设置页（配置持久化/Key 脱敏/布局重构）、K线同步（DuckDB 内存限制+详细日志）。

**Architecture:** 改动分散在前后端。AI 对话框纯前端。设置页需前后端配合（后端加脱敏字段、前端重构布局）。K线内存泄漏根因是 DuckDB 未设 memory_limit + ATTACH 大库后 JOIN+窗口函数撑爆缓冲池。

---

## Part A: AI 对话框修复

### Bug A1: 用户发送消息后对话列表不滚动到底

**根因:** `AgentEditWindow.tsx` 的消息容器 `<div className="min-h-0 overflow-auto p-5">` 没有 ref，也没有 `useEffect` 在 `messages` 变化后滚动到底。

**Files:**
- Modify: `src/components/trade-agents/AgentEditWindow.tsx`

**Fix:**

```tsx
// 在组件顶部加
const messagesEndRef = useRef<HTMLDivElement>(null)

// 消息变化后自动滚到底
useEffect(() => {
  messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
}, [messages])

// 消息列表底部加哨兵元素
<div ref={messagesEndRef} />
```

把 `messagesEndRef` 放在消息列表最后一项的后面（加载指示器下面）。

### Bug A2: 模型回复 JSON 解析失败

**根因:** `src-tauri/src/services/trade_system_service.rs` 的 `extract_json_object` 用 `find('{')` + `rfind('}')`，遇到多个 JSON 对象或截断内容时失败。前端显示 "模型已经返回内容，但修订 JSON 不完整或被截断"。

**Files:**
- Modify: `src-tauri/src/services/trade_system_service.rs:530-537`
- Modify: `src-tauri/src/llm/json_guard.rs` (如果存在的话，需要检查)

**Fix:** 增强 JSON 提取逻辑：

```rust
fn extract_json_object(content: &str) -> Option<String> {
    let trimmed = content.trim();
    
    // 尝试1: 去掉 markdown code fences
    let cleaned = trimmed
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();
    
    // 尝试2: 找最外层匹配的 {} 对（处理嵌套和多对象情况）
    if let Some(start) = cleaned.find('{') {
        let mut depth = 0;
        for (i, ch) in cleaned[start..].char_indices() {
            match ch {
                '{' => depth += 1,
                '}' => {
                    depth -= 1;
                    if depth == 0 {
                        return Some(cleaned[start..start + i + 1].to_string());
                    }
                }
            }
        }
    }
    None
}
```

同时在 `parse_revision_response` 中加详细日志，把模型原始输出的前 500 字符打到终端：

```rust
fn parse_revision_response(content: &str, current_markdown: &str) -> AppResult<serde_json::Value> {
    tracing::info!(original_len = content.len(), preview = %&content[..content.len().min(300)], "解析模型修订响应");
    // ... 原有解析逻辑，每个分支加 tracing::warn! 说明失败原因
}
```

### Bug A3: 关闭按钮不够醒目

**Files:**
- Modify: `src/components/trade-agents/AgentEditWindow.tsx:165`

**Fix:** 关闭按钮从 `variant="ghost"` 改为高对比样式：

```tsx
<button
  aria-label="关闭"
  onClick={onClose}
  className="flex h-8 w-8 items-center justify-center border border-border bg-panel text-muted-foreground hover:bg-danger/20 hover:text-danger hover:border-danger/50 transition"
>
  <X className="h-4 w-4" />
</button>
```

不用 Button 组件，直接用原生 button + Tailwind class，确保在深色背景上醒目。

---

## Part B: 设置页修复

### Bug B1: 配置持久化 — 加 YAML 配置文件（双层存储）

**当前状态:** 配置已通过 SQLite + 加密文件持久化。不存在 YAML 配置。

**方案:** SQLite 仍为主存储（事务、查询快），额外加一个 YAML 导出层作为**可读备份**。应用启动时从 SQLite 加载到内存（当前已在用 React Query 缓存），YAML 只做导出/导入用途，方便用户手动编辑和迁移。

**Files:**
- Modify: `src-tauri/Cargo.toml` — 加 `serde_yaml` 依赖
- Create: `src-tauri/src/services/config_service.rs`
- Modify: `src-tauri/src/commands/provider.rs` — 加 `export_providers_config` / `import_providers_config` 命令

**实现:**

```rust
// src-tauri/src/services/config_service.rs
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
struct ProvidersConfig {
    version: u32,
    updated_at: String,
    providers: Vec<ProviderConfigEntry>,
}

#[derive(Serialize, Deserialize)]
struct ProviderConfigEntry {
    name: String,
    provider_type: String,
    base_url: String,
    api_key_ref: String,  // 只存引用，不存实际 key
    model: String,
    temperature: f64,
    max_tokens: i64,
    enabled: bool,
    is_active: bool,
    extra_json: serde_json::Value,
}

pub fn export_to_yaml(conn: &Connection, path: &Path) -> AppResult<()> { ... }
pub fn import_from_yaml(conn: &Connection, path: &Path) -> AppResult<Vec<ModelProvider>> { ... }
```

配置 YAML 位置: `{app_dir}/config/providers.yaml`

### Bug B2: API Key 脱敏显示

**根因:** 编辑已有 provider 时，表单中 API key 字段始终清空（`apiKey: ''`）。用户无法知道是否已保存 key。

**Files:**
- Modify: `src-tauri/src/services/model_provider_service.rs` — `redact_provider` 函数
- Modify: `src/pages/SettingsPage.tsx` — API key 输入框

**Fix:** 后端 `redact_provider` 返回脱敏的 key 提示：

```rust
fn redact_provider(mut provider: ModelProvider) -> ModelProvider {
    provider.api_key_ref = if provider.api_key_ref.starts_with("local:") {
        "local:***"  // 保持现有行为
    } else {
        provider.api_key_ref
    };
    // 新增字段: 告诉前端 key 的状态
    // 用 extra_json 传递 key 的脱敏信息
    provider
}
```

前端 API key 输入框：

```tsx
// 编辑已有 provider 时，显示脱敏提示
{selectedProviderId && form.apiKey === '' && (
  <div className="text-[10px] text-muted-foreground mb-1 font-mono">
    API Key 已保存 ****{maskedSuffix}
  </div>
)}
<input type="password" ... placeholder="留空则不修改已保存的 Key" />
```

对于脱敏后缀，从 `apiKeyRef` 判断：如果是 `local:***`，说明 key 已保存，显示 "已保存 (本地加密)"。不需要知道最后几位——当前架构 key 加密存储在文件系统，后端不传任何 key 内容给前端。

### Bug B3: 设置页布局重构（左列表 + 右详情）

**当前状态:** 已经是左右布局（`grid-cols-[360px_minmax(0,1fr)]`），左栏有预设卡片和已保存连接列表，右栏是表单。但存在切换 bug：选中预设后再选已保存的 provider 不会正确切换。

**Files:**
- Modify: `src/pages/SettingsPage.tsx` — 重构

**新布局:**

```
┌──────────────────┬────────────────────────────────────┐
│ 左侧 320px       │ 右侧 flex                          │
│                  │                                    │
│ ┌─ 已保存连接 ──┐│ ┌─ 连接配置 ────────────────── ON ┐│
│ │ ●  DeepSeek V3││ │                                  │
│ │   DeepSeek R1 ││ │ 名称: [DeepSeek V3        ]      │
│ │   OpenAI GPT  ││ │ 类型: [DeepSeek          ▼]      │
│ │               ││ │ URL:  [api.deepseek.com   ]      │
│ │ + 新建连接    ││ │ Key:  [********          ] 已保存 │
│ │               ││ │                                  │
│ └───────────────┘│ │ 模型: [deepseek-chat      ]      │
│                  │ │ Temp: [0.2]  MaxTokens: [4096]   │
│ ┌─ 预设 ────────┐│ │                                  │
│ │ DeepSeek Pro  ││ │ [测试连接]  [保存配置]           │
│ │ DeepSeek Flash││ │                                  │
│ │ OpenAI Compat ││ └──────────────────────────────────┘
│ └───────────────┘│
└──────────────────┴────────────────────────────────────┘
```

**关键修复:**
1. 左侧配置列表点击 → `setSelectedProviderId(id)` → useEffect 填充表单
2. 当前启用的配置在列表项右上角显示 `ON` badge（`bg-success text-panel text-[9px] font-mono`）
3. 预设点击 → `setSelectedProviderId(undefined)` → 表单填充预设值
4. 名称修改 → 直接改 `form.name` → 保存时更新数据库
5. 类型切换 → 重置表单为对应预设默认值

**切换 bug 修复：** `useEffect` 依赖 `selectedProviderId`，当切换到不同 provider 时重新填充表单。当前代码在 `applyPreset` 中逻辑正确但可能有状态更新时序问题。加 key prop 强制重建表单组件。

---

## Part C: K线同步内存泄漏

### 根因分析

**DuckDB 没有设置 `memory_limit`。** 默认使用系统 RAM 的 80%。`sync_daily_bars_incremental` 中 `INSERT...SELECT` 连接 `market_db.fact_kline`（可能数十亿行）+ `row_number() OVER (PARTITION BY ...)` 窗口函数，即使最终插入 0 行，DuckDB 仍会为排序/哈希分配巨大内部缓冲区。

**日志显示 "rows=0 has_watermarks=true" 但内存飙 5GB** 说明问题不在写入量，而在查询执行过程中的中间结果物化。

### Fix C1: 设置 DuckDB 内存上限

**Files:**
- Modify: `src-tauri/src/db/duckdb.rs` — `open_or_create` 函数

```rust
pub fn open_or_create(path: &Path, run_migrations: bool) -> Result<DuckConnection, duckdb::Error> {
    let conn = Connection::open(path)?;
    // 限制 DuckDB 内存使用为 1GB，防止 ATTACH 大库后查询撑爆内存
    conn.execute_batch("SET memory_limit = '1GB'; SET threads = 2;")?;
    // ...
}
```

1GB 对 3200 万行 kline_bars + ATTACH 的 market.duckdb 的查询足够（大部分是聚合/过滤，不是全表加载）。

### Fix C2: 增加详细性能日志

**Files:**
- Modify: `src-tauri/src/services/market_sync_service.rs` — `refresh_inner` 每个步骤前后

```rust
use std::time::Instant;

fn refresh_inner(app: &tauri::AppHandle, conn: &DuckConnection) -> AppResult<i64> {
    let t0 = Instant::now();
    
    // 记录初始内存 (macOS 用 task_info)
    tracing::info!(step = "attach_market", "开始");
    attach_market(conn, market_path)?;
    tracing::info!(step = "attach_market", elapsed_ms = t0.elapsed().as_millis(), "完成");
    
    let t1 = Instant::now();
    tracing::info!(step = "sync_mapping", "开始");
    sync_mapping(conn)?;
    tracing::info!(step = "sync_mapping", elapsed_ms = t1.elapsed().as_millis(), "完成");
    
    // ... 对 sync_securities, sync_daily_bars_incremental, sync_trade_calendar,
    //     compute_derived_fields, aggregate_period_incremental, update_mapping_watermarks,
    //     refresh_securities_latest 各步骤加同样的计时日志
    
    // 尝试获取 DuckDB 内存使用
    if let Ok(mem_info) = conn.query_row(
        "SELECT value FROM duckdb_memory()",
        [], |row| row.get::<_, String>(0)
    ) {
        tracing::info!(duckdb_memory = %mem_info, "DuckDB 内存使用");
    }
    
    // 记录系统内存 (仅 macOS)
    #[cfg(target_os = "macos")]
    {
        if let Ok(output) = std::process::Command::new("ps")
            .args(["-o", "rss=", "-p", &std::process::id().to_string()])
            .output()
        {
            if let Ok(rss_kb) = String::from_utf8(output.stdout).map(|s| s.trim().parse::<u64>().unwrap_or(0)) {
                tracing::info!(rss_mb = rss_kb / 1024, "进程 RSS");
            }
        }
    }
}
```

### Fix C3: 跳过无意义的 ATTACH + 查询

**Files:**
- Modify: `src-tauri/src/services/market_sync_service.rs:61-100` — `refresh_inner`

**优化:** 在 ATTACH 之前先检查是否需要同步：

```rust
fn refresh_inner(app: &tauri::AppHandle, conn: &DuckConnection) -> AppResult<i64> {
    // 快速检查：所有 symbol 的水位是否都已经是最新
    let needs_sync: bool = conn.query_row(
        "select count(*) > 0 from kline_mapping
         where last_kline_date is null
            or last_kline_date < (select max(last_kline_date) from kline_mapping)",
        [], |row| row.get(0),
    )?;
    
    if !needs_sync {
        tracing::info!("所有标的水位已是最新，跳过 ATTACH 和同步");
        return Ok(count_kline_rows(conn)?);
    }
    
    // 原有 ATTACH + 同步逻辑
    // ...
}
```

如果已经有 5000+ 标的且 90%+ 齐整度，大部分水印应该已是最新，直接跳过 ATTACH 避免加载 market.duckdb 的元数据。

### Fix C4: 优化 sync_daily_bars_incremental 查询

**Files:**
- Modify: `src-tauri/src/services/market_sync_service.rs:291-354`

**优化:** 当所有水印都已存在且没有新数据时，窗口函数 `row_number()` 完全不必要。加一个快速 COUNT 检查：

```rust
fn sync_daily_bars_incremental(conn: &DuckConnection) -> AppResult<(i64, bool)> {
    let has_watermarks: bool = /* 现有检查 */;
    
    // 快速路径：先检查是否有新数据
    let new_data_count: i64 = conn.query_row(
        "select count(*) from market_db.fact_kline f
         join kline_mapping m on m.trade_symbol = f.symbol
         where f.period = '1d' and f.adjust in ('none', 'forward')
           and f.open is not null
           and f.trade_date > coalesce(m.last_kline_date, '1970-01-01')",
        [], |row| row.get(0),
    )?;
    
    if new_data_count == 0 {
        tracing::info!("market-sync 无新数据，跳过日K同步 (has_watermarks={})", has_watermarks);
        return Ok((0, !has_watermarks));
    }
    
    tracing::info!(new_rows = new_data_count, "market-sync 有 {} 行新日K待同步", new_data_count);
    // 执行原有的 INSERT...SELECT + window function
    // ...
}
```

这个 COUNT 查询比带窗口函数的 INSERT 轻量得多，不会触发排序/分区内存分配。

---

## 验证

1. **AI 对话框**
   - 发送消息 → 消息列表自动滚到底，能看到 Agent 回复
   - 终端日志显示模型原始输出的前 300 字符 + 解析结果
   - JSON 解析失败时终端有 `tracing::warn!` 说明原因
   - 关闭按钮在深色背景上清晰可见

2. **设置页**
   - 编辑已有 provider → API key 字段显示 "已保存 (本地加密)" 提示
   - 切换左侧配置列表 → 右侧表单正确更新
   - 修改名称 → 保存 → 列表中名称已更新
   - 启用的配置显示 ON badge
   - `{app_dir}/config/providers.yaml` 有 YAML 导出

3. **K线同步**
   - 终端日志每步有 `elapsed_ms`
   - 显示 DuckDB 内存使用量
   - 一键同步时若无需同步 → 日志显示 "跳过 ATTACH 和同步"，内存不飙升
   - `memory_limit = '1GB'` 生效，DuckDB 不会超过 1GB

4. **编译/类型检查**
   ```bash
   npm run typecheck
   cd src-tauri && cargo build
   ```
