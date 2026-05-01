---
name: smart-commit
description: >
  当用户说"commit"、"提交"、"保存进度"、"收尾"、"wrap up"、"存一下"，或任何暗示想把当前修改
  整理成提交的语句时触发。扫描未提交修改，按逻辑拆分成 1~5 个 commit，执行提交，接着运行
  /neat-freak 同步文档后再提交一次（如有修改），最后询问是否 push。不要对纯 git 问题
  （如"git怎么回滚"、"commit message 怎么写好"）触发——那些是普通提问。
---

# 智能分批提交

把零散的未提交修改，按逻辑拆成 1~5 个语义清晰的 commit。目的是让每个 commit
队友 30 秒就能看懂——而不是一大坨 `git add -A && git commit -m "update"`。

## 整体流程

```
扫描修改 → 逻辑分组 → 展示方案 → 逐组提交 → neat-freak → 提交同步变更 → 询问push
```

---

## 第一步：扫描

并行执行以下命令，获取全貌：

- `git status` — 看看有哪些文件被改、新增、删除
- `git diff` — 未暂存的修改内容
- `git diff --cached` — 已暂存的修改内容
- `git log --oneline -10` — 最近的 commit message 风格（用于模仿格式和提取尾部签名字符串如 `xb`）

---

## 第二步：分组

把每个改动文件归入一个组。最多 5 组。如果天然超过 5 组，把最不重要的合并到 `chore` 兜底组。

### 分组优先级

**第一层——按变更性质：**

| 类型 | 含义 | 示例 |
|------|------|------|
| `feat` | 新功能、新能力 | 新增 HTTP K线 Provider |
| `fix` | 修 bug、改错误 | 修复空数据下评分的 panic |
| `refactor` | 重构，不改变行为 | 提取连接池到共享模块 |
| `docs` | 文档、注释、CLAUDE.md | 更新架构图、补充模板 |
| `chore` | 配置、依赖、构建、格式化 | bump tauri 版本、改 eslint |

**第二层——在同性质内，按模块/目录拆分：**
- `src-tauri/` — Rust 后端
- `src/` — TypeScript 前端
- `docs/` — 文档
- 根目录配置文件 — `package.json`、`Cargo.toml` 等

**第三层——依赖关系：**
- 如果改动 A 依赖改动 B，放同组
- 如果 B 必须先于 A 被 review，B 排前面

### 何时合并（减少组数）

- 总共不到 3 个文件改动，且没有明显不相关 → 1 组
- 所有改动集中在单一目录、单一目的 → 1 组
- 某组只有 1 个 trivial 文件（纯空格、一行注释）→ 合并到邻近组

### 何时拆分（增加组数）

- 某组混了 4 个以上互不相关的目录
- 某组同时混了 `feat`、`fix`、`refactor`，reviewer 会看糊涂

---

## 第三步：展示方案

在动手之前，用表格呈现给用户：

```
| # | 类型 | 消息 | 涉及文件 |
|---|------|------|----------|
| 1 | feat | feat(kline): 新增 HTTP provider，支持超时重试 | kline/http.rs, kline/mod.rs |
| 2 | fix | fix(review): 修复空 bar 列表导致的评分 panic | review.rs |
| 3 | docs | docs: 补充交易系统模板，更新架构说明 | docs/trading-system-template.md, CLAUDE.md |
```

消息格式：`类型(范围): 一句话描述`，类型取 `feat|fix|refactor|docs|chore|test`。

查看 `git log` 中项目已有的尾部签名（通常是 `xb`），在每个 commit body 末尾附上。

**询问用户：** "按这个方案执行？可以调整分组、重排顺序或修改消息。"

用户不同意就调整后重新展示，直到确认才进入下一步。

---

## 第四步：逐组提交

对每组按顺序执行：

1. `git add <该组的具体文件列表>` — 绝不用 `git add -A` 或 `git add .`
2. 用 heredoc 写多行 commit message：
   ```bash
   git commit -m "$(cat <<'EOF'
   类型(范围): 一句话描述

     - 具体改动点 1
     - 具体改动点 2
   xb
   EOF
   )"
   ```
3. 验证：`git status` 确认提交成功、文件已从暂存区移除

若某个 commit 失败（hook 拦截、冲突、空暂存区）：
- 把错误信息展示给用户
- 停下来问用户怎么处理
- 绝不用 `--no-verify` 绕过 hook

---

## 第五步：运行 neat-freak

所有分组提交做完后，调用 `neat-freak` skill。它会扫描项目文档（CLAUDE.md、docs/ 等）和 agent memory，对比当前代码状态，修正过时内容。

等待 neat-freak 执行完毕。

---

## 第六步：处理 neat-freak 产生的修改

执行 `git status`。如果 neat-freak 改动或新增了文件：

1. 展示差异：`git diff`
2. 将这些改动作为一个独立 commit 提交：`docs: neat-freak 同步项目文档与记忆`
3. 验证提交成功

如果 neat-freak 没有产生任何改动：跳过。

---

## 第七步：询问 push

> "所有提交完成。要推送到远程吗？"

- **推送** → `git push origin <当前分支>`，报告成功或失败
- **不推送** → "提交已保存在本地。稍后可用 `git push` 推送。"
- **强制推送？** → 如果是 main/master 分支，警告用户。只有用户明确确认才执行。

---

## 边界情况

- **没有改动**: 报告 "工作区干净，无需提交。" 并停止。
- **只有 1 个逻辑组**: 仍然展示方案（单行表格），等用户确认后再提交，然后继续 neat-freak。
- **正处于 merge/rebase 冲突中**: 报告当前 git 状态并停止，不提交。
- **pre-commit hook 失败**: 展示 hook 输出，询问用户是修复重试还是跳过。
- **大文件警告**: 如果要添加的文件 > 1MB，警告用户并请求确认。
- **敏感文件**: 检测到 `.env`、`credentials.json`、`*.pem`、`*.key` 等敏感文件时，明确标记并询问用户是否真的要提交。
