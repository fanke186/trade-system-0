# 202605030327: AI 对话框 + 设置 + K线同步内存 修复执行计划

**Goal:** 修复 AI 对话框交互、Provider 设置持久化/切换、K线同步 rows=0 仍暴涨内存与前端进度卡住的问题。

**Architecture:** AI 对话框保持当前预览+聊天布局；设置继续以 SQLite/secrets 为主存储，新增 YAML 镜像文件方便持久化可见；K线同步不做盲目全量扫描，改为 ATTACH 后先读 `market_db.sync_state` 小表对比水位，只有确有新增日 K 时才触碰 `fact_kline` 大表和窗口函数。

---

## Part A: AI 对话框

- `AgentEditWindow.tsx` 给消息滚动容器加 ref，`messages` 或 pending 状态变化后滚到底，用户发送后立即能看到最新上下文和思考中状态。
- 增强关闭按钮：使用高对比原生 button，danger hover，扩大视觉权重。
- `trade_system_service.rs` 改进模型修订 JSON 解析：
  - 先解析完整 JSON；
  - 再剥离 markdown code fence；
  - 再用字符串感知的括号配对提取首个完整 JSON object，避免字符串中的 `{}` 干扰；
  - 如果只有自然语言回复，就把自然语言作为 assistantMessage，不再误报“JSON 不完整”；
  - 记录响应长度、预览、解析失败原因，方便在 `npm run start:desktop` 终端排查。

## Part B: 设置页

- 新增 Provider YAML 镜像文件：`{app_dir}/config/providers.yaml`。
  - 保存、启用 Provider 后自动导出 YAML；
  - YAML 不保存真实 key，只保存 `api_key_ref` 和脱敏提示；
  - SQLite + secrets 仍是运行时主存储，React Query 继续作为内存缓存。
- API key 展示修复：
  - 后端本地 key 返回 `apiKeyHint`，格式为 `已保存 ****1234`；无法读取尾号时显示 `已保存到本地 secrets`；
  - 前端编辑已有 Provider 时输入框为空但显示已保存提示，留空保存不覆盖旧 key。
- 设置布局修复：
  - 左侧先显示已保存连接，右上角用醒目的 `ON` tag 标出当前启用配置；
  - 右侧只显示当前选中的配置详情；
  - 点击预设进入“新建配置”模式，不弹窗；
  - 切换配置、修改名称、切换 provider 类型后，表单状态必须同步到当前选中项。

## Part C: K线同步内存与进度

### 根因判断

日志 `rows=0 has_watermarks=true` 但内存飙升，说明不是写入行数造成，而是 `sync_daily_bars_incremental` 的 `INSERT ... SELECT` 在 `market_db.fact_kline` 上做 JOIN + `row_number()` 窗口去重。即使最终 0 行，DuckDB 仍可能为扫描、排序、窗口分区分配大量内存。前端按钮停在 65% 则说明后端完成日志和最终 progress/result 没有形成一致的 settled 状态，或最终 coverage 查询仍在阻塞。

### 修复策略

- DuckDB 连接启动时设置：
  - `memory_limit = '1GB'`
  - `threads = 2`
  - `preserve_insertion_order = false`
  - `temp_directory` 指向应用 cache 目录，允许大查询溢写而不是吃满 RSS。
- 同步流程增加阶段日志：
  - 每步记录 `elapsed_ms`、进程 RSS、DuckDB memory tag；
  - 日志覆盖 attach、mapping、securities、水位检查、daily sync、calendar、derived、aggregate、watermark、latest、coverage。
- 新增快速水位检查：
  - ATTACH 后先同步 mapping/securities；
  - 只查 `market_db.sync_state` 与本地 `kline_mapping.last_kline_date`；
  - 若外部 daily `none/forward` 水位均未超过本地水位，跳过 `fact_kline` 大表、跳过窗口函数、跳过聚合；
  - 仍刷新 mapping watermarks/latest，并立即 emit 100%。
- `sync_daily_bars_incremental` 内部保留二次保护：
  - 先用 `sync_state` 估算有变化的 `trade_symbol`；
  - 只对变化标的执行 `fact_kline` 查询；
  - 没变化直接返回 `(0, false)`。
- 前端 `DataHealthBanner`：
  - `onSettled` 强制进度归零/完成态；
  - 收到 `completed/error` 事件直接显示 100，避免停在 65%。

## 验证

- `npm run typecheck`
- `cargo check`
- `npm test`
- `npm run build`
- 手动检查：
  - Agent 发送一句话后自动滚到底；
  - 模型返回自然语言或 JSON code fence 都能显示有效回复；
  - 设置页切换配置、改名保存、ON tag、key 脱敏正常；
  - 一键同步无新增数据时日志显示跳过 `fact_kline`，RSS 不再飙升，按钮最终回到可点击。
