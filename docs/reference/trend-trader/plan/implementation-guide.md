# trend-trader 实现指引

> 版本: 1.0 | 日期: 2026-04-30 | 状态: Phase 0-5 已实现, Phase 6 部分完成

本文档是编码实现的详细指引，包含环境搭建、配置管理实现、各模块的文件级实现细节、测试策略。

**前置阅读**: [架构设计与模块规约](./architecture-design.md)

---

## 目录

1. [Phase 0: 环境搭建与前端基础设施](#phase-0-环境搭建与前端基础设施)
2. [Phase 1: Bug修复 + Agent工具调用闭环](#phase-1-bug修复--agent工具调用闭环)
3. [Phase 2: 策略通用执行器 + AI释义](#phase-2-策略通用执行器--ai释义)
4. [Phase 3: Chat-First布局 + 视图联动](#phase-3-chat-first-布局--视图联动)
5. [Phase 4: 股票池 + 监控页](#phase-4-股票池--监控页)
6. [Phase 5: 定时任务 + 设置 + 回测入口 + 基础设施](#phase-5-定时任务--设置--回测入口--基础设施)
7. [Phase 6: 高级功能](#phase-6-高级功能)

---

## Phase 0: 环境搭建与前端基础设施

### 0.1 前端依赖安装

在 `frontend/` 目录执行:

```bash
# Tailwind CSS 4 + Vite 插件
npm install -D tailwindcss @tailwindcss/vite

# shadcn/ui 初始化 (交互式)
npx shadcn@latest init
# 选择:
# - TypeScript: yes
# - Style: Default
# - Base color: Neutral
# - CSS variables: yes (for dark mode)

# 核心依赖
npm install react-router-dom lightweight-charts recharts lucide-react

# 开发依赖
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom
```

### 0.2 Tailwind 配置

文件: `frontend/tailwind.config.ts`

```typescript
import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: { 950: "#02040a", 900: "#0a0d14", 850: "#131720", 800: "#1a1f2e" },
        up: "#00d4aa",
        down: "#ff4757",
        warn: "#fbbf24",
        info: "#38bdf8",
        primary: { DEFAULT: "#00d4aa", foreground: "#02040a" },
        accent: { DEFAULT: "#6c5ce7", foreground: "#ffffff" },
      },
      fontFamily: {
        sans: ["Inter", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
```

### 0.3 全局 CSS 入口

文件: `frontend/src/index.css`

```css
@import "tailwindcss";
@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap");

@layer base {
  * { @apply border-base-800; }
  body {
    @apply bg-base-950 text-neutral-200 font-sans antialiased;
    margin: 0;
  }
  /* 自定义滚动条 */
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: #0a0d14; }
  ::-webkit-scrollbar-thumb { background: #1a1f2e; border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: #2a3040; }
}

@layer components {
  /* 指标卡片 */
  .metric-card {
    @apply bg-base-900 rounded-lg p-4 border border-base-800;
    @apply hover:border-primary/30 transition-colors duration-200;
  }

  /* 霓虹发光文字 */
  .text-glow-up {
    text-shadow: 0 0 12px rgba(0, 212, 170, 0.4);
  }
  .text-glow-down {
    text-shadow: 0 0 12px rgba(255, 71, 87, 0.4);
  }
}
```

### 0.4 布局骨架组件

文件: `frontend/src/components/Layout.tsx`

```tsx
import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { ChatInput } from "./ChatInput";
import { ContextPanel } from "./ContextPanel";
import { StatusIndicator } from "./StatusIndicator";
import { useState } from "react";

export function Layout() {
  const [contextOpen, setContextOpen] = useState(true);

  return (
    <div className="h-screen flex flex-col bg-base-950">
      {/* Topbar */}
      <header className="h-12 flex items-center justify-between px-4
                        bg-base-900/80 backdrop-blur-xl border-b border-base-800 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="font-mono text-sm text-primary font-bold">trend-trader</h1>
          <span className="text-xs text-neutral-500">v0.2</span>
        </div>
        <div className="flex items-center gap-4 text-xs text-neutral-400">
          <StatusIndicator />
          <span id="clock">--:--:--</span>
          <span>飞书 ✓</span>
          <span>交易: 模拟</span>
        </div>
      </header>

      {/* Main area */}
      <div className="flex-1 flex min-h-0">
        <Sidebar />
        <main className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 overflow-auto p-4">
            <Outlet />  {/* 主内容区, 根据路由切换 */}
          </div>
          {/* Chat 始终可见 */}
          <div className="shrink-0 border-t border-base-800 bg-base-900/60 backdrop-blur">
            <ChatInput />
          </div>
        </main>
        {contextOpen && <ContextPanel onClose={() => setContextOpen(false)} />}
      </div>
    </div>
  );
}
```

### 0.5 路由配置

文件: `frontend/src/App.tsx` (重写为路由入口)

```tsx
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout";
import { AIPage } from "./pages/AIPage";
import { ReviewPage } from "./pages/ReviewPage";
import { StrategyPage } from "./pages/StrategyPage";
import { PoolPage } from "./pages/PoolPage";
import { MonitorPage } from "./pages/MonitorPage";
import { SchedulePage } from "./pages/SchedulePage";
import { SettingsPage } from "./pages/SettingsPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<AIPage />} />
          <Route path="review" element={<ReviewPage />} />
          <Route path="review/:symbol" element={<ReviewPage />} />
          <Route path="strategy" element={<StrategyPage />} />
          <Route path="strategy/:id" element={<StrategyPage />} />
          <Route path="pool" element={<PoolPage />} />
          <Route path="monitor" element={<MonitorPage />} />
          <Route path="schedule" element={<SchedulePage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
```

### 0.6 后端配置模块

文件: `backend/app/config/__init__.py`

```python
from app.config.loader import ConfigLoader
```

文件: `backend/app/config/loader.py`

```python
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import yaml  # pip install pyyaml (可能已在依赖中)


class ConfigLoader:
    """配置加载器: YAML + 环境变量覆盖

    加载顺序: config.yaml → 环境变量 TREND_TRADER_<section>_<key> (大写转小写)
    用法:
        config = ConfigLoader(Path(".data/config.yaml"))
        profile = config.get_active_ai_profile()
        channel, quote_cfg = config.get_active_quote_channel()
    """

    def __init__(self, config_path: Path) -> None:
        if not config_path.exists():
            raise FileNotFoundError(
                f"配置文件不存在: {config_path}\n"
                f"请复制 config.yaml.example 并修改"
            )
        self._path = config_path
        with open(config_path, "r", encoding="utf-8") as f:
            self._data: dict[str, Any] = yaml.safe_load(f) or {}
        self._apply_env_overrides()

    def _apply_env_overrides(self) -> None:
        prefix = "TREND_TRADER_"
        for key, value in os.environ.items():
            if not key.startswith(prefix):
                continue
            rest = key[len(prefix):].lower()
            if "__" in rest:
                continue
            parts = rest.split("_", 1)
            if len(parts) == 2 and parts[0] in self._data:
                section, subkey = parts
                if isinstance(self._data[section], dict):
                    self._data[section][subkey] = value

    def get_active_ai_profile(self) -> dict[str, Any]:
        active = self._data.get("active", {})
        name = active.get("ai_profile", "deepseek")
        for p in self._data.get("ai", {}).get("profiles", []):
            if p.get("name") == name and p.get("active", True):
                return dict(p)
        available = [p["name"] for p in self._data.get("ai", {}).get("profiles", [])]
        raise ValueError(f"未找到激活的AI配置 '{name}', 可用: {available}")

    def get_active_quote_channel(self) -> tuple[str, dict[str, Any]]:
        active = self._data.get("active", {})
        channel = active.get("quote_channel", "mootdx")
        cfg = self._data.get("quote", {}).get(channel, {})
        if not cfg or not cfg.get("enabled", True):
            raise ValueError(f"行情通道 '{channel}' 未启用或不存在")
        return channel, dict(cfg)

    @property
    def raw(self) -> dict[str, Any]:
        return dict(self._data)

    @property
    def trading(self) -> dict[str, Any]:
        return self._data.get("trading", {})

    @property
    def notify(self) -> dict[str, Any]:
        return self._data.get("notify", {})

    @property
    def kline_db(self) -> dict[str, Any]:
        return self._data.get("kline_db", {})
```

### 0.7 配置文件示例

文件: `config.yaml.example` (放在项目根目录)

提供完整的 YAML 配置模板 (内容同架构设计文档 §2.2)。

---

## Phase 1: Bug修复 + Agent工具调用闭环

### 1.1 修复 crosses_above / crosses_below

文件: `backend/app/services.py`, 方法 `_eval_condition` → 重命名/重构为 `ConditionEvaluator`

当前代码问题: `crosses_above` 实现为 `left >= right`, 与 `gte` 完全相同。

修复: 需要传入历史 context (前一次的价格), 判断"前值 < 阈值且当前值 >= 阈值"。

文件: `backend/app/monitoring/condition_evaluator.py` (新建)

```python
from __future__ import annotations

from typing import Any


class ConditionEvaluator:
    """条件表达式求值器

    支持算子:
    - 逻辑: all, any, not
    - 比较: gte, lte, gt, lt, eq
    - 交叉: crosses_above (前值<阈值 且 当前>=阈值),
             crosses_below (前值>阈值 且 当前<=阈值)
    """

    ALLOWED_OPS = {
        "all", "any", "not",
        "gte", "lte", "gt", "lt", "eq",
        "crosses_above", "crosses_below",
    }

    def __init__(self) -> None:
        self._previous_prices: dict[str, float] = {}

    def evaluate(
        self, condition: dict[str, Any], context: dict[str, Any]
    ) -> bool:
        op = condition.get("op", "")
        if op not in self.ALLOWED_OPS:
            raise ValueError(f"不支持的算子: {op}")

        if op == "all":
            return all(
                self.evaluate(dict(c), context)
                for c in condition.get("conditions", [])
            )
        if op == "any":
            return any(
                self.evaluate(dict(c), context)
                for c in condition.get("conditions", [])
            )
        if op == "not":
            return not self.evaluate(
                dict(condition.get("condition", {})), context
            )

        left = self._resolve(condition.get("left"), context)
        right = self._resolve(condition.get("right"), context)

        if op == "gte":
            return left >= right
        if op == "lte":
            return left <= right
        if op == "gt":
            return left > right
        if op == "lt":
            return left < right
        if op == "eq":
            return abs(left - right) < 0.0001
        if op == "crosses_above":
            prev = self._resolve_previous(condition.get("left"), context)
            return prev < right and left >= right
        if op == "crosses_below":
            prev = self._resolve_previous(condition.get("left"), context)
            return prev > right and left <= right

        return False

    def _resolve(self, operand: Any, context: dict[str, Any]) -> float:
        if isinstance(operand, dict) and "var" in operand:
            return float(context.get(str(operand["var"]), 0) or 0)
        return float(operand or 0)

    def _resolve_previous(self, operand: Any, context: dict[str, Any]) -> float:
        """获取前值 (用于交叉判断)"""
        var_name = str(operand.get("var", "")) if isinstance(operand, dict) else ""
        prev_key = f"prev_{var_name}"
        if prev_key in context:
            return float(context[prev_key] or 0)
        # 使用缓存的上一次值
        return self._previous_prices.get(var_name, float(context.get(var_name, 0)))

    def update_previous(self, var_name: str, value: float) -> None:
        """更新前值缓存"""
        self._previous_prices[var_name] = value
```

### 1.2 事务包装 save_analysis

文件: `backend/app/storage/repository.py`, 方法 `save_analysis`

```python
def save_analysis(self, analysis: StrategyAnalysis) -> None:
    payload = analysis.model_dump_json()
    now = datetime.utcnow().isoformat()
    with self._connect() as conn:
        conn.execute("begin")
        try:
            conn.execute(
                """insert into analyses(symbol, strategy_name, as_of, score, status, payload, created_at)
                   values (?, ?, ?, ?, ?, ?, ?)""",
                (analysis.symbol, analysis.strategy_name, analysis.as_of.isoformat(),
                 analysis.score, analysis.status, payload, now),
            )
            if analysis.trade_plan:
                plan = analysis.trade_plan
                conn.execute(
                    """insert into plans(symbol, strategy_name, status, entry_price,
                       stop_loss, take_profit, risk_reward_ratio, payload, created_at)
                       values (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (plan.symbol, plan.strategy_name, plan.status, plan.entry_price,
                     plan.stop_loss, plan.take_profit, plan.risk_reward_ratio,
                     plan.model_dump_json(), plan.created_at.isoformat()),
                )
            conn.execute("commit")
        except Exception:
            conn.execute("rollback")
            raise
```

### 1.3 validate_workflow 引用完整性检查

文件: `backend/app/services.py`, 方法 `validate_workflow`

在现有检查的基础上添加:

```python
def validate_workflow(self, workflow: WorkflowScript | dict[str, Any]) -> WorkflowScript:
    # ... 现有 step_type 和 tool_name 检查 ...

    # [NEW] 检查 agent_id / team_id 引用完整性
    agent_ids = {int(a["id"]) for a in self.repository.list_generic("agents")}
    team_ids = {int(t["id"]) for t in self.repository.list_generic("agent_teams")}

    for step in workflow_data.get("steps", []):
        step = step if isinstance(step, dict) else step.model_dump(mode="json")
        step_args = step.get("arguments", {})

        if step.get("type") == "agent":
            aid = int(step_args.get("agent_id") or 0)
            if aid and aid not in agent_ids:
                raise ValueError(f"workflow 引用了不存在的 agent_id={aid}")
        if step.get("type") == "team":
            tid = int(step_args.get("team_id") or 0)
            if tid and tid not in team_ids:
                raise ValueError(f"workflow 引用了不存在的 team_id={tid}")

    return workflow_obj
```

### 1.4 Agent 工具调用循环

文件: `backend/app/agent/__init__.py`

```python
from app.agent.tool_loop import AgentToolLoop
```

文件: `backend/app/agent/tool_loop.py`

```python
from __future__ import annotations

import json
import os
from typing import Any

from app.tools import ToolRegistry


class AgentToolLoop:
    """Agent 工具调用循环

    将 LLM 的 tool_calls 与 ToolRegistry 桥接:
    1. 构建包含 tools 定义的 messages
    2. 调用 LLM API
    3. 如果响应中有 tool_calls → 逐个调用 ToolRegistry.invoke()
       → 追加 tool_result 到 messages → 回到步骤 2
    4. 如果响应中有 content → 返回最终文本
    5. 最多 max_turns 轮
    """

    MAX_TOOL_RESULT_LENGTH = 2000

    def __init__(self, tool_registry: ToolRegistry) -> None:
        self._tools = tool_registry

    def _build_tool_defs(self, allowed_names: list[str]) -> list[dict[str, Any]]:
        """构建 OpenAI 格式的 tools 定义"""
        all_tools = {t.name: t for t in self._tools.list_definitions()}
        defs = []
        for name in allowed_names:
            if name not in all_tools:
                continue
            tool = all_tools[name]
            defs.append({
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": {
                        "type": "object",
                        "properties": {
                            k: {"type": v}
                            for k, v in tool.input_schema.items()
                        },
                        "required": list(tool.input_schema.keys()),
                        "additionalProperties": False,
                    } if tool.input_schema else {"type": "object", "properties": {}},
                },
            })
        return defs

    def _build_system_prompt(self, agent: dict[str, Any], tool_defs: list[dict]) -> str:
        base = agent.get("system_prompt", "")
        if not tool_defs:
            return base
        tool_desc = "\n".join(
            f"- {td['function']['name']}: {td['function']['description']}"
            for td in tool_defs
        )
        return (
            f"{base}\n\n"
            f"你可以调用以下工具来操作系统:\n{tool_desc}\n\n"
            f"当需要获取分析数据、查询信息或执行操作时，务必调用对应的工具。"
            f"收到工具返回的数据后，用自然语言向用户解释结果。"
        )

    def run(
        self,
        agent: dict[str, Any],
        prompt: str,
        context: dict[str, Any],
        llm_caller,  # 注入 LLM 调用函数
    ) -> dict[str, Any]:
        """执行 Agent 对话

        Args:
            agent: Agent 配置字典 (含 system_prompt, tools_allowed, max_turns)
            prompt: 用户输入
            context: 额外上下文
            llm_caller: LLM API 调用函数, 签名:
                (messages: list[dict], tools: list[dict] | None) -> dict
                返回 OpenAI 格式的 response

        Returns:
            {"text": "最终回复", "tool_calls": [{"turn": 0, "tool": "...",
             "args": {...}, "result": {...}}, ...]}
        """
        tool_defs = self._build_tool_defs(agent.get("tools_allowed", []))
        messages = [
            {"role": "system", "content": self._build_system_prompt(agent, tool_defs)},
            {"role": "user", "content": prompt},
        ]

        tool_calls_log: list[dict[str, Any]] = []
        max_turns = agent.get("max_turns", 8)

        for turn in range(max_turns):
            response = llm_caller(messages, tool_defs if tool_defs else None)
            choice = response.get("choices", [{}])[0]
            finish_reason = choice.get("finish_reason", "")
            message = choice.get("message", {})

            # 检查是否有 tool_calls
            if finish_reason == "tool_calls" or message.get("tool_calls"):
                tool_calls = message.get("tool_calls", [])
                messages.append(message)

                for tc in tool_calls:
                    func = tc.get("function", {})
                    tool_name = func.get("name", "")
                    try:
                        tool_args = json.loads(func.get("arguments", "{}"))
                    except json.JSONDecodeError:
                        tool_args = {}

                    result = self._tools.invoke(
                        tool_name, tool_args, source="agent", confirmed=True
                    )
                    result_dict = result.model_dump(mode="json")
                    tool_calls_log.append({
                        "turn": turn,
                        "tool": tool_name,
                        "args": tool_args,
                        "result": result_dict,
                    })

                    result_text = json.dumps(result_dict, ensure_ascii=False)
                    if len(result_text) > self.MAX_TOOL_RESULT_LENGTH:
                        result_text = result_text[:self.MAX_TOOL_RESULT_LENGTH] + "..."
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc.get("id", f"call_{turn}"),
                        "content": result_text,
                    })
                continue

            # 没有 tool_calls → 最终回复
            return {
                "text": message.get("content", ""),
                "tool_calls": tool_calls_log,
                "finish_reason": finish_reason,
            }

        # 超出最大轮次
        return {
            "text": "已达到最大对话轮次，请简化你的需求。",
            "tool_calls": tool_calls_log,
            "finish_reason": "max_turns",
        }
```

### 1.5 修改 run_agent() 使用 ToolLoop

文件: `backend/app/services.py`, 方法 `run_agent`

```python
def run_agent(self, agent_id: int, prompt: str, context: dict[str, Any] | None = None) -> AgentRunResult:
    context = context or {}
    agent = self.repository.get_generic("agents", agent_id)

    # 获取 LLM 配置
    profile = None
    provider = None
    if agent.get("model_profile_id"):
        profile = self.repository.get_generic("model_profiles", int(agent["model_profile_id"]))
        provider = self.repository.get_generic("model_providers", int(profile["provider_id"]))

    status = "ok"
    output: dict[str, Any]
    try:
        if provider and profile and (
            os.getenv(str(provider.get("api_key_env") or "")) or
            provider.get("provider_type") == "ollama"
        ):
            # [NEW] 使用 ToolLoop
            from app.agent.tool_loop import AgentToolLoop

            def llm_caller(messages, tools):
                return self._call_llm_raw(provider, profile, messages, tools)

            loop = AgentToolLoop(self.tools)
            output = loop.run(agent, prompt, context, llm_caller)
            output["mode"] = "model"
            output["model"] = profile.get("model")
            output["provider"] = provider.get("name")
        else:
            output = {
                "text": self._local_agent_response(agent, prompt, context),
                "mode": "local",
                "reason": "未配置可用 API Key",
                "tool_calls": [],
            }
    except Exception as exc:
        status = "error"
        output = {
            "error": str(exc),
            "text": self._local_agent_response(agent, prompt, context),
            "mode": "fallback",
            "tool_calls": [],
        }

    run_id = self.repository.save_ai_run(agent_id, None, status, {"prompt": prompt, "context": context}, output)
    return AgentRunResult(id=run_id, agent_id=agent_id, status=status, input={"prompt": prompt, "context": context}, output=output)
```

### 1.6 新增 _call_llm_raw 方法

文件: `backend/app/services.py` (在 `_call_openai_compatible` 旁边新增)

```python
def _call_llm_raw(
    self,
    provider: dict[str, Any],
    profile: dict[str, Any],
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """调用 LLM API，返回原始响应 JSON (支持 tools)"""
    base_url = str(provider.get("base_url") or "").rstrip("/")
    if not base_url:
        raise ValueError("provider base_url is empty")
    api_key = os.getenv(str(provider.get("api_key_env") or ""), "")

    payload: dict[str, Any] = {
        "model": profile["model"],
        "messages": messages,
        "temperature": float(profile.get("temperature") or 0.2),
        "max_tokens": int(profile.get("max_tokens") or 4096),
    }
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"
    payload.update(dict(profile.get("extra") or {}))

    url = f"{base_url}/chat/completions"
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key or 'ollama'}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=int(profile.get("timeout_seconds") or 60)) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"LLM API error {exc.code}: {detail[:500]}") from exc
```

---

## Phase 2: 策略通用执行器 + AI释义

### 2.1 策略引擎

文件: `backend/app/strategies/engine.py`

```python
from __future__ import annotations

from dataclasses import dataclass, field
from statistics import mean
from typing import Any, Callable

from app.models import (
    ChartOverlay, ChartPoint, DailyBar, StrategyAnalysis,
    StrategySpec, TradePlan,
)


@dataclass
class Pivot:
    index: int
    price: float
    kind: str  # "high" | "low"


class StrategyEngine:
    """通用策略执行引擎

    输入: StrategySpec + list[DailyBar]
    输出: StrategyAnalysis

    执行流程:
    1. feature 计算: 遍历 spec.features, 调用对应的 FeatureBuilder
    2. filter 应用: 遍历 spec.filters, 不满足则返回 no_setup
    3. scoring 计算: 遍历 spec.scoring, 调用对应的 ScoringRule, 按权重加权
    4. overlay 生成: 遍历 spec.overlays, 生成 ChartOverlay
    5. trade_plan 生成: 根据 spec.trade_plan_template 和 feature 结果
    """

    def __init__(self) -> None:
        self._feature_builders: dict[str, FeatureBuilder] = {
            "pivot_high_low": _build_pivot_features,
            "support_resistance_lines": _build_sr_lines,
            "volume_ratio_20d": _build_volume_ratio,
            "ma_cross": _build_ma_cross,
            "rsi": _build_rsi,
            "macd": _build_macd,
        }
        self._scoring_rules: dict[str, ScoringRule] = {
            "structure": _score_structure,
            "breakout": _score_breakout,
            "volume": _score_volume,
            "risk_reward": _score_risk_reward,
            "trend": _score_trend,
            "momentum": _score_momentum,
        }
        self._filter_rules: dict[str, FilterRule] = {
            "manual_review_required": lambda features, params: True,
            "volume_min": _filter_volume_min,
            "price_above_ma": _filter_price_above_ma,
        }

    def execute(self, spec: StrategySpec, bars: list[DailyBar]) -> StrategyAnalysis:
        if len(bars) < 40:
            return self._no_setup(spec, bars, "数据不足 (至少需要 40 根 K 线)")

        # Step 1: 计算 features
        features: dict[str, Any] = {}
        for f_def in spec.features:
            name = f_def.get("name", "")
            params = f_def.get("params", {})
            builder = self._feature_builders.get(name)
            if builder:
                features[name] = builder(bars, params)

        # Step 2: 应用 filters
        for f_def in spec.filters:
            op = f_def.get("op", "")
            rule = self._filter_rules.get(op)
            if rule and not rule(features, f_def.get("params", {})):
                return self._no_setup(spec, bars, f"不满足筛选条件: {op}")

        # Step 3: 计算评分
        score_breakdown: dict[str, float] = {}
        total_score = 0.0
        for s_def in spec.scoring:
            name = s_def.get("name", "")
            weight = float(s_def.get("weight", 0))
            rule = self._scoring_rules.get(name)
            if rule:
                raw = rule(features)
                weighted = raw * weight / 100.0
                score_breakdown[name] = round(weighted, 2)
                total_score += weighted

        total_score = round(min(100, total_score), 2)

        # Step 4: 生成 overlays
        overlays = self._build_overlays(spec, bars, features)

        # Step 5: 生成 trade_plan
        trade_plan = self._build_trade_plan(spec, bars, features, total_score)

        # Step 6: 确定状态
        has_plan = bool(trade_plan and trade_plan.entry_price and trade_plan.stop_loss)
        breakout = features.get("breakout", {}).get("confirmed", False) if isinstance(features.get("breakout"), dict) else False
        status = "triggered" if breakout else ("watch" if has_plan and total_score >= 35 else "no_setup")

        return StrategyAnalysis(
            symbol=bars[-1].symbol,
            strategy_name=spec.name,
            as_of=bars[-1].date,
            score=total_score,
            status=status,
            bars=bars,
            score_breakdown=score_breakdown,
            metrics=self._build_metrics(features, bars),
            overlays=overlays,
            trade_plan=trade_plan,
        )

    def _no_setup(self, spec: StrategySpec, bars: list[DailyBar], reason: str) -> StrategyAnalysis:
        return StrategyAnalysis(
            symbol=bars[-1].symbol if bars else "",
            strategy_name=spec.name,
            as_of=bars[-1].date if bars else None,
            score=0,
            status="no_setup",
            bars=bars,
            score_breakdown={},
            metrics={"reason": reason},
            overlays=[],
            trade_plan=None,
        )

    def _build_trade_plan(self, spec: StrategySpec, bars: list[DailyBar],
                          features: dict[str, Any], score: float) -> TradePlan | None:
        template = spec.trade_plan_template
        if not template:
            return None

        entry = features.get("entry_price")
        stop = features.get("stop_loss")
        target = features.get("take_profit")
        rr = None
        if entry and stop and entry > stop:
            rr = (target - entry) / (entry - stop) if target else None

        return TradePlan(
            symbol=bars[-1].symbol,
            strategy_name=spec.name,
            status="watch" if score >= 35 else "no_setup",
            entry_price=round(entry, 3) if entry else None,
            entry_reason=template.get("entry_reason", ""),
            stop_loss=round(stop, 3) if stop else None,
            take_profit=round(target, 3) if target else None,
            risk_reward_ratio=round(rr, 2) if rr else None,
            invalidated_if=template.get("invalidated_if", ""),
        )

    def _build_overlays(self, spec: StrategySpec, bars: list[DailyBar],
                        features: dict[str, Any]) -> list[ChartOverlay]:
        overlays: list[ChartOverlay] = []
        last_date = bars[-1].date
        first_idx = 0
        last_idx = len(bars) - 1

        for o_def in spec.overlays:
            kind = o_def.get("kind", "")
            if kind == "support_line":
                sr = features.get("support_resistance_lines", {})
                if sr.get("support"):
                    s = sr["support"]
                    overlays.append(ChartOverlay(
                        id="support", kind="trend_line", name="segment",
                        label="支撑线",
                        points=[
                            ChartPoint(date=bars[s["p1"].index].date, value=round(s["p1"].price, 3)),
                            ChartPoint(date=last_date, value=round(s["slope"] * last_idx + s["intercept"], 3)),
                        ],
                        styles={"line": {"color": "#1f9d55", "size": 2}},
                    ))

            if kind == "resistance_line":
                sr = features.get("support_resistance_lines", {})
                if sr.get("resistance"):
                    r = sr["resistance"]
                    overlays.append(ChartOverlay(
                        id="resistance", kind="trend_line", name="segment",
                        label="压力线",
                        points=[
                            ChartPoint(date=bars[r["p1"].index].date, value=round(r["p1"].price, 3)),
                            ChartPoint(date=last_date, value=round(r["slope"] * last_idx + r["intercept"], 3)),
                        ],
                        styles={"line": {"color": "#d64545", "size": 2}},
                    ))

            if kind == "entry_marker" and features.get("entry_price"):
                overlays.append(ChartOverlay(
                    id="entry", kind="entry", name="priceLine", label="买点",
                    points=[ChartPoint(date=last_date, value=round(features["entry_price"], 3))],
                    styles={"line": {"color": "#0f7bf2", "size": 1.5}},
                ))

            if kind == "stop_marker" and features.get("stop_loss"):
                overlays.append(ChartOverlay(
                    id="stop", kind="stop", name="priceLine", label="止损",
                    points=[ChartPoint(date=last_date, value=round(features["stop_loss"], 3))],
                    styles={"line": {"color": "#e05656", "size": 1.5}},
                ))

        return overlays

    def _build_metrics(self, features: dict[str, Any], bars: list[DailyBar]) -> dict[str, Any]:
        latest = bars[-1]
        metrics: dict[str, Any] = {
            "latest_close": latest.close,
            "bar_count": len(bars),
        }
        for name, value in features.items():
            if isinstance(value, (int, float, str, bool)):
                metrics[name] = value
            elif isinstance(value, dict):
                for k, v in value.items():
                    if isinstance(v, (int, float, str, bool)):
                        metrics[f"{name}.{k}"] = v
        return metrics


# ─── Feature Builders ────────────────────────────────────

FeatureBuilder = Callable[[list[DailyBar], dict[str, Any]], Any]


def _build_pivot_features(bars: list[DailyBar], params: dict) -> dict[str, Any]:
    window = int(params.get("window", 3))
    highs, lows = _find_pivots(bars, window)
    return {"highs": highs, "lows": lows, "count_high": len(highs), "count_low": len(lows)}


def _build_sr_lines(bars: list[DailyBar], params: dict) -> dict[str, Any]:
    window = int(params.get("window", 3))
    highs, lows = _find_pivots(bars, window)
    resistance = _line_from_pivots(highs[-5:], bars)
    support = _line_from_pivots(lows[-5:], bars)
    return {
        "resistance": resistance,
        "support": support,
        "resistance_touches": resistance["touches"] if resistance else 0,
        "support_touches": support["touches"] if support else 0,
    }


def _build_volume_ratio(bars: list[DailyBar], params: dict) -> dict[str, Any]:
    period = int(params.get("period", 20))
    latest = bars[-1].volume
    avg = mean(b.volume for b in bars[-period:])
    return {
        "ratio": round(latest / avg, 2) if avg else 0,
        "latest_volume": latest,
        "avg_volume": round(avg, 2),
    }


def _build_ma_cross(bars: list[DailyBar], params: dict) -> dict[str, Any]:
    fast = int(params.get("fast", 5))
    slow = int(params.get("slow", 20))
    if len(bars) < slow + 1:
        return {"crossed_up": False, "crossed_down": False}

    def ma(data, period):
        return mean(b.close for b in data[-period:])

    prev_fast = ma(bars[:-1], fast)
    prev_slow = ma(bars[:-1], slow)
    curr_fast = ma(bars, fast)
    curr_slow = ma(bars, slow)

    return {
        "ma_fast": round(curr_fast, 3),
        "ma_slow": round(curr_slow, 3),
        "crossed_up": prev_fast <= prev_slow and curr_fast > curr_slow,
        "crossed_down": prev_fast >= prev_slow and curr_fast < curr_slow,
    }


def _build_rsi(bars: list[DailyBar], params: dict) -> dict[str, Any]:
    period = int(params.get("period", 14))
    if len(bars) < period + 1:
        return {"value": 50}
    gains = 0.0
    losses = 0.0
    for i in range(-period, 0):
        change = bars[i].close - bars[i-1].close
        if change > 0:
            gains += change
        else:
            losses -= change
    avg_gain = gains / period
    avg_loss = losses / period
    if avg_loss == 0:
        return {"value": 100.0}
    rs = avg_gain / avg_loss
    return {"value": round(100 - 100 / (1 + rs), 2)}


def _build_macd(bars: list[DailyBar], params: dict) -> dict[str, Any]:
    fast = int(params.get("fast", 12))
    slow = int(params.get("slow", 26))
    signal = int(params.get("signal", 9))
    if len(bars) < slow + signal:
        return {"macd": 0, "signal": 0, "histogram": 0}

    def ema(data, period):
        k = 2 / (period + 1)
        result = data[0]
        for val in data[1:]:
            result = val * k + result * (1 - k)
        return result

    closes = [b.close for b in bars]
    ema_fast = ema(closes, fast)
    ema_slow = ema(closes, slow)
    macd_line = ema_fast - ema_slow
    # signal line 简化
    return {"macd": round(macd_line, 4), "signal": 0, "histogram": round(macd_line, 4)}


# ─── Scoring Rules ───────────────────────────────────────

ScoringRule = Callable[[dict[str, Any]], float]


def _score_structure(features: dict[str, Any]) -> float:
    sr = features.get("support_resistance_lines", {})
    score = 0.0
    if sr.get("support_touches", 0) >= 2:
        score += 50
    if sr.get("resistance_touches", 0) >= 2:
        score += 50
    return min(100, score)


def _score_breakout(features: dict[str, Any]) -> float:
    sr = features.get("support_resistance_lines", {})
    resistance = sr.get("resistance", {})
    if not resistance:
        return 0
    return 100 if features.get("breakout_confirmed") else 50


def _score_volume(features: dict[str, Any]) -> float:
    vol = features.get("volume_ratio_20d", {})
    ratio = vol.get("ratio", 0)
    return min(100, max(0, (ratio - 0.6) * 60))


def _score_risk_reward(features: dict[str, Any]) -> float:
    rr = features.get("risk_reward_ratio", 0)
    return min(100, max(0, rr * 25))


def _score_trend(features: dict[str, Any]) -> float:
    ma = features.get("ma_cross", {})
    if ma.get("crossed_up"):
        return 100
    if ma.get("ma_fast", 0) > ma.get("ma_slow", 0):
        return 70
    return 20


def _score_momentum(features: dict[str, Any]) -> float:
    rsi = features.get("rsi", {}).get("value", 50)
    if 40 <= rsi <= 70:
        return 80
    return 40


# ─── Filter Rules ────────────────────────────────────────

FilterRule = Callable[[dict[str, Any], dict[str, Any]], bool]


def _filter_volume_min(features: dict[str, Any], params: dict) -> bool:
    vol = features.get("volume_ratio_20d", {})
    min_ratio = float(params.get("min_ratio", 0.8))
    return vol.get("ratio", 0) >= min_ratio


def _filter_price_above_ma(features: dict[str, Any], params: dict) -> bool:
    ma = features.get("ma_cross", {})
    ma_val = ma.get("ma_slow", 0)
    latest = features.get("latest_close", 0)
    return latest > ma_val


# ─── Helpers ────────────────────────────────────────────

def _find_pivots(bars: list[DailyBar], window: int) -> tuple[list[Pivot], list[Pivot]]:
    highs: list[Pivot] = []
    lows: list[Pivot] = []
    values_high = [b.high for b in bars]
    values_low = [b.low for b in bars]
    for i in range(window, len(bars) - window):
        h = values_high[i]
        if h == max(values_high[i-window:i+window+1]) and h > max(values_high[i-window:i]) and h >= max(values_high[i+1:i+window+1]):
            highs.append(Pivot(i, h, "high"))
        lo = values_low[i]
        if lo == min(values_low[i-window:i+window+1]) and lo < min(values_low[i-window:i]) and lo <= min(values_low[i+1:i+window+1]):
            lows.append(Pivot(i, lo, "low"))
    return highs, lows


def _line_from_pivots(pivots: list[Pivot], bars: list[DailyBar]) -> dict | None:
    if len(pivots) < 2:
        return None
    p1, p2 = pivots[-2], pivots[-1]
    if p1.index == p2.index:
        return None
    slope = (p2.price - p1.price) / (p2.index - p1.index)
    intercept = p1.price - slope * p1.index
    touches = 0
    for p in pivots:
        expected = slope * p.index + intercept
        if abs(p.price - expected) / max(p.price, 0.01) < 0.035:
            touches += 1
    return {"p1": p1, "p2": p2, "slope": slope, "intercept": intercept, "touches": touches}
```

### 2.2 策略释义器

文件: `backend/app/strategies/interpreter.py`

```python
from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Any

from app.models import StrategySpec


class StrategyInterpreter:
    """策略释义器: 将 StrategySpec 结构化数据转为稳定的自然语言

    核心机制:
    1. 对 spec 的 JSON 表示计算 SHA256 哈希
    2. 哈希相同 → 返回缓存的释义 (保证稳定性)
    3. 哈希不同 → 调用 LLM 生成新释义 → 缓存

    释义输出:
    - 策略概述 (1-2 句)
    - 特征列表 (每个特征: 名称 + 计算方法 + 参数)
    - 筛选条件 (每个条件: 描述)
    - 评分体系 (每个维度: 权重 + 计算方法)
    - 交易计划生成逻辑 (入场/止损/止盈)
    """

    def __init__(self, llm_caller) -> None:
        self._llm = llm_caller
        self._cache: dict[str, str] = {}

    def _hash_spec(self, spec: StrategySpec) -> str:
        data = json.dumps(
            {
                "features": spec.features,
                "filters": spec.filters,
                "scoring": spec.scoring,
                "overlays": spec.overlays,
                "trade_plan_template": spec.trade_plan_template,
            },
            ensure_ascii=False, sort_keys=True,
        )
        return hashlib.sha256(data.encode()).hexdigest()[:16]

    def explain(self, spec: StrategySpec) -> str:
        spec_hash = self._hash_spec(spec)

        # 缓存命中 → 直接返回
        if spec_hash in self._cache:
            return self._cache[spec_hash]

        # 调用 LLM 生成释义
        prompt = self._build_explanation_prompt(spec)
        response = self._llm(
            messages=[
                {
                    "role": "system",
                    "content": (
                        "你是一个量化策略分析师。请用中文详细解释以下策略的每个组成部分。"
                        "输出要结构化、精确、稳定（对于相同的输入，输出应该基本一致）。"
                        "不要添加主观评价，只描述策略本身。"
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            tools=None,
        )
        explanation = response["choices"][0]["message"]["content"]
        self._cache[spec_hash] = explanation
        return explanation

    def _build_explanation_prompt(self, spec: StrategySpec) -> str:
        return f"""
策略名称: {spec.name}
策略描述: {spec.description}

特征 (features):
{json.dumps(spec.features, ensure_ascii=False, indent=2)}

筛选条件 (filters):
{json.dumps(spec.filters, ensure_ascii=False, indent=2)}

评分体系 (scoring):
{json.dumps(spec.scoring, ensure_ascii=False, indent=2)}

覆盖层 (overlays):
{json.dumps(spec.overlays, ensure_ascii=False, indent=2)}

交易计划模板:
{json.dumps(spec.trade_plan_template, ensure_ascii=False, indent=2)}

请按以下结构输出释义:
## 策略概述
## 特征计算
## 筛选条件
## 评分体系
## 交易计划生成
"""
```

### 2.3 新增工具

文件: `backend/app/tools.py`, 在 `_register_defaults` 中添加:

```python
# strategy.generate — AI 生成策略
self.register(
    "strategy.generate",
    "从自然语言描述生成一个策略 JSON。需要传入 description (自然语言描述) 和 name (策略名称)。由 LLM 分析意图后生成对应的 features/filters/scoring 结构。",
    self._strategy_generate,
    {"name": "string", "description": "string"},
    category="strategy",
)

# strategy.explain — 策略释义
self.register(
    "strategy.explain",
    "对指定策略生成详细的自然语言释义，多次调用输出保持稳定。",
    self._strategy_explain,
    {"strategy_id": "number"},
    category="strategy",
)

# condition_order.ai_create — AI 创建条件单
self.register(
    "condition_order.ai_create",
    "从自然语言描述创建一个条件单。AI 会自动解析意图并生成条件表达式。",
    self._condition_order_ai_create,
    {"symbol": "string", "description": "string"},
    category="condition_order",
)
```

---

## Phase 3: Chat-First 布局 + 视图联动

### 3.1 关键前端组件实现指引

#### ChatInput.tsx (全局聊天输入)

```tsx
// 核心功能:
// - 始终固定在 Layout 底部
// - /tool 命令自动补全 (列出所有已注册工具)
// - @Agent 切换
// - Enter 发送, Shift+Enter 换行
// - 输入历史 (上下箭头)

import { useState, useEffect, useRef, KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { fetchTools } from "../api";
import type { ToolDefinition } from "../types";

interface Props {
  agentId: number | null;
  sessionId: number | null;
  onSend: (content: string) => void;
}

export function ChatInput({ agentId, sessionId, onSend }: Props) {
  const [input, setInput] = useState("");
  const [tools, setTools] = useState<ToolDefinition[]>([]);
  const [showTools, setShowTools] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const navigate = useNavigate();

  // 加载工具列表 (用于 / 补全)
  useEffect(() => { fetchTools().then(setTools).catch(() => {}); }, []);

  // 处理 /tool 命令补全
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (input.trim()) {
        onSend(input.trim());
        setInput("");
      }
    }
    if (e.key === "Tab" && input.startsWith("/")) {
      e.preventDefault();
      setShowTools(true);
    }
  };

  return (
    <div className="p-3">
      {showTools && (
        <div className="mb-2 flex flex-wrap gap-1">
          {tools.map(t => (
            <button
              key={t.name}
              className="text-xs px-2 py-1 rounded bg-base-850 text-neutral-300 hover:bg-base-800"
              onClick={() => { setInput(`/tool ${t.name} `); setShowTools(false); inputRef.current?.focus(); }}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2 items-end">
        <textarea
          ref={inputRef}
          className="flex-1 bg-base-850 border border-base-800 rounded-lg p-2 text-sm
                     text-neutral-200 placeholder-neutral-500 resize-none focus:outline-none
                     focus:border-primary/50 font-mono"
          rows={2}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入指令或自然语言...  /tool  查看工具  @  切换Agent"
        />
        <button
          onClick={() => { if (input.trim()) { onSend(input.trim()); setInput(""); } }}
          className="px-4 py-2 bg-primary text-base-950 font-semibold rounded-lg
                     hover:opacity-90 transition-opacity text-sm"
        >
          发送
        </button>
      </div>
    </div>
  );
}
```

### 3.2 视图联动实现

核心: 使用 `useNavigate` + `useSearchParams` 实现跨视图跳转。

```tsx
// 在聊天消息中渲染内联操作按钮
function ChatMessage({ message }: { message: ChatMessage }) {
  const navigate = useNavigate();

  // 检测消息中是否包含 tool_result (策略分析结果)
  const handleViewKLine = (symbol: string) => {
    navigate(`/review/${symbol}`);
  };
  const handleAddMonitor = (symbol: string, price: number) => {
    // 跳转监控页并预填条件单
    navigate(`/monitor?symbol=${symbol}&price=${price}&action=create-condition`);
  };

  return (
    <div className={`chat-message ${message.role}`}>
      {/* ... 消息内容渲染 ... */}
      {/* 如果是 tool_result 且包含分析数据, 渲染操作按钮 */}
      {message.payload?.output?.analysis && (
        <div className="flex gap-2 mt-2">
          <button onClick={() => handleViewKLine(message.payload.output.analysis.symbol)}
                  className="text-xs px-2 py-1 bg-base-850 rounded hover:bg-base-800">
            📈 查看K线图
          </button>
          <button onClick={() => handleAddMonitor(
            message.payload.output.analysis.symbol,
            message.payload.output.analysis.trade_plan?.entry_price
          )} className="text-xs px-2 py-1 bg-base-850 rounded hover:bg-base-800">
            🔔 加入监控
          </button>
        </div>
      )}
    </div>
  );
}
```

---

## Phase 4: 股票池 + 监控页

### 4.1 股票池页 (同花顺式)

文件: `frontend/src/pages/PoolPage.tsx`

核心要点:
- 分组 Tab 切换 (`flex gap-2 overflow-x-auto`)
- 表格支持点击列头排序 (用 `useState` 存排序状态 `{key, direction}`)
- 涨跌颜色: 正 `text-up` / 负 `text-down`
- 行点击跳转 `/review/:symbol`
- 点击行展开迷你 K 线图

### 4.2 行情自动订阅后端

文件: `backend/app/monitoring/quote_stream.py`

```python
"""行情自动订阅模块

支持 mootdx (免费) 和 jvQuant (付费) 两种通道, 通过 config.yaml 切换。

只拉取有生效中条件单的个股行情 (按需订阅)。
"""

# ... 实现 MootdxQuoteProvider, JvQuantQuoteProvider, QuoteManager
# 架构设计文档中已有详细接口定义
```

### 4.3 监控页

文件: `frontend/src/pages/MonitorPage.tsx`

三区布局:
- 左: 实时行情表 (WebSocket 订阅, 自动更新)
- 右: 条件单列表
- 下: 事件中心

---

## Phase 5: 定时任务 + 设置 + 回测入口 + 基础设施

### 5.1 Docker 化

文件: `Dockerfile` (项目根目录)

```dockerfile
# 后端
FROM python:3.11-slim AS backend
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install -r requirements.txt
COPY backend/ .
EXPOSE 8001
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
```

文件: `docker-compose.yml` (项目根目录)

```yaml
version: "3.8"
services:
  backend:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "8001:8001"
    volumes:
      - ./backend/.data:/app/.data
    environment:
      - TREND_TRADER_HERMES_SEND=0
  worker:
    build:
      context: .
      dockerfile: Dockerfile
    command: python -m app.cli worker start
    volumes:
      - ./backend/.data:/app/.data
  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    ports:
      - "5173:5173"
```

### 5.2 数据库迁移

文件: `backend/app/storage/migrations.py`

```python
"""简单的版本化迁移

在 repository._init_schema() 之后调用:
    MigrationRunner(db_path).run()

迁移记录表:
    create table if not exists schema_migrations (
        version integer primary key,
        applied_at text not null
    );
"""
```

### 5.3 事件日志清理

文件: `backend/app/storage/repository.py`, 新增方法:

```python
def cleanup_events(self, max_days: int = 30, max_count: int = 10000) -> int:
    """清理旧事件"""
    with self._connect() as conn:
        cutoff = (datetime.utcnow() - timedelta(days=max_days)).isoformat()
        deleted = conn.execute(
            "delete from events where created_at < ?", (cutoff,)
        ).rowcount
        # 如果还超过最大数量，删最旧的
        count = conn.execute("select count(*) from events").fetchone()[0]
        if count > max_count:
            excess = count - max_count
            conn.execute(
                "delete from events where id in (select id from events order by created_at asc limit ?)",
                (excess,),
            )
        return deleted
```

---

## Phase 6: 高级功能

### 6.1 Agent 分层记忆

文件: `backend/app/agent/memory.py`

```python
"""Agent 分层记忆系统

短期记忆: 当前会话的所有消息 (已通过 messages 数组实现)
中期记忆: 按日期存储的关键事件摘要 (agent_memories 表, memory_type="medium_term")
长期记忆: 手动提炼的经验规则 (agent_memories 表, memory_type="long_term")

中期记忆自动生成: 当日会话结束时 (或每日收盘后), 由 LLM 总结当日关键决策和结果。
"""
```

### 6.2 K线数据自动更新定时任务

文件: `backend/app/services.py`, 新增方法:

```python
def update_kline_db(self) -> dict:
    """更新K线数据库 (每日盘后调用)"""
    today = date.today()
    if not self.kline_db.is_trade_day(today):
        return {"status": "skipped", "reason": f"{today} 不是交易日"}

    updated = 0
    for symbol_info in self.kline_db.get_all_symbols():
        try:
            bars = self.provider.fetch_daily_bars(symbol_info["code"], end=today)
            if bars:
                self.kline_db.update_bars("1d", bars)
                updated += 1
        except Exception as exc:
            logger.warning(f"更新 {symbol_info['code']} 失败: {exc}")

    # 聚合周K/月K
    self.kline_db.aggregate_weekly(today)
    self.kline_db.aggregate_monthly(today)

    return {"status": "ok", "updated": updated, "date": today.isoformat()}
```

同时在 `_seed_default_schedules` 中添加:

```python
{
    "name": "K线数据更新",
    "description": "每个交易日 15:30 自动更新全市场K线数据",
    "trigger": {"type": "cron", "cron": "30 15 * * 1-5", "timezone": "Asia/Shanghai"},
    "workflow": {
        "version": 1,
        "description": "Update kline database after market close.",
        "steps": [{"type": "tool", "name": "kline.update", "arguments": {}}],
    },
    "status": "enabled",
},
```

---

## 验证清单

每个 Phase 完成后, 必须通过以下验证:

| Phase | 验证项 |
|-------|--------|
| 0 | `npm run dev` 正常启动, 页面渲染正常, 路由切换正常 |
| 0 | `python -m app.cli tool list` 列出所有工具 |
| 1 | `python -m unittest discover -s tests` 全部通过 |
| 1 | 前端聊天输入 "帮我分析 002261" → Agent 自动调用 strategy.analyze → 返回分析结果 |
| 1 | 手动测试 crosses 条件单: 前价 18.0, 现价 18.5, 阈值 18.3 → crosses_above 触发 |
| 2 | 前端策略页创建策略 → 用引擎执行 → 返回与硬编码版本一致的结果 |
| 2 | 点击策略释义 → 返回稳定释义 (两次调用输出相同) |
| 3 | 聊天中 [查看K线图] → 自动跳转复盘页 |
| 3 | 聊天输入框始终可见, 不受页面切换影响 |
| 4 | 股票池页显示实时价格 + 涨跌颜色 |
| 4 | 条件单触发后飞书收到通知 |
| 5 | `docker-compose up` 一键启动 |
| 5 | `npm test` 前端组件测试通过 |
| 5 | 事件日志超过 30 天自动清理 |
