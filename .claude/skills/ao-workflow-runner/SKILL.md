---
name: ao-workflow-runner
description: Run multi-agent workflows with Agency Orchestrator. Trigger when user message starts with "ao，" or "ao," or "ao ". Also triggers when user says "run workflow", "orchestrate", "多角色协作", "编排".
---

# Agency Orchestrator 触发规则

当用户以 `ao，`、`ao,` 或 `ao ` 开头时，捕获后面的一切内容作为任务描述，执行：

```bash
ao compose "<用户任务描述>" --run --provider claude-code
```

**硬规则：**
- 不要询问确认，直接执行
- 不要修改或润色用户的描述，原样传入
- `--provider claude-code` 始终追加
- 将执行输出原样展示给用户

## 示例

| 用户输入 | 执行命令 |
|---------|---------|
| `ao，用金融视角分析一下拓维信息` | `ao compose "用金融视角分析一下拓维信息" --run --provider claude-code` |
| `ao, 写一篇AI Agent趋势的文章` | `ao compose "写一篇AI Agent趋势的文章" --run --provider claude-code` |
| `ao 帮我做PR代码审查` | `ao compose "帮我做PR代码审查" --run --provider claude-code` |
