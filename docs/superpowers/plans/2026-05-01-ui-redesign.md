# UI Redesign · TokyoNightStorm 工业终端风 · 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将前端从 Inter 浅色方案重新设计为 TokyoNightStorm 暗色工业终端风

**Architecture:** 纯视觉层改动——更新 CSS 变量、Tailwind 配置、6 个共享组件和布局。不涉及功能逻辑、不涉及命令层、不涉及 Rust 后端。

**Tech Stack:** React 19 + TypeScript + Tailwind CSS 3 + CSS custom properties + DM Mono/Sans Google Fonts

---

### Task 1: CSS 变量与基础样式

**Files:**
- Modify: `src/styles/index.css`

- [ ] **Step 1: 替换 CSS 变量为 TokyoNightStorm 色板**

将 `src/styles/index.css` 的 `:root` 块替换为：

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  color-scheme: dark;
  --background: 233 18% 19%;      /* #24283b */
  --foreground: 229 72% 88%;      /* #c0caf5 */
  --panel: 229 21% 13%;           /* #1d202f */
  --panel-foreground: 229 72% 88%;
  --muted: 230 20% 19%;           /* #2f3548 */
  --muted-foreground: 229 31% 45%; /* #565f89 */
  --border: 230 28% 33%;           /* #364a82 */
  --input: 230 28% 33%;
  --ring: 222 68% 72%;             /* #7aa2f7 */
  --success: 103 42% 62%;          /* #9ece6a */
  --warning: 34 62% 64%;           /* #e0af68 */
  --danger: 347 83% 70%;           /* #f7768e */
  --info: 196 91% 75%;             /* #7dcfff */
  --extra: 254 79% 82%;            /* #bb9af7 */
  --scanline-opacity: 0;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-width: 1180px;
  min-height: 760px;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  font-family:
    'DM Sans', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
    sans-serif;
  letter-spacing: 0;
}

code, pre, .font-mono, kbd, samp {
  font-family: 'DM Mono', ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, monospace;
}

button,
input,
textarea,
select {
  font: inherit;
}

textarea {
  resize: vertical;
}

.kline-chart-host canvas {
  display: block;
}
```

- [ ] **Step 2: 验证构建**

```bash
cd /Users/yaya/me/workspace/trade-system-0 && npx tsc --noEmit 2>&1
```
Expected: no errors.

- [ ] **Step 3: 提交**

```bash
cd /Users/yaya/me/workspace/trade-system-0
git add src/styles/index.css
git commit -m "style: TokyoNightStorm CSS 变量与基础样式"
```

---

### Task 2: Tailwind 配置同步

**Files:**
- Modify: `tailwind.config.ts`

- [ ] **Step 1: 增加新颜色 token 并更新色板引用**

将 `tailwind.config.ts` 的 `theme.extend.colors` 替换为：

```ts
import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))'
        },
        accent: {
          DEFAULT: 'hsl(var(--ring))',
          foreground: 'hsl(var(--panel))'
        },
        panel: {
          DEFAULT: 'hsl(var(--panel))',
          foreground: 'hsl(var(--panel-foreground))'
        },
        success: 'hsl(var(--success))',
        warning: 'hsl(var(--warning))',
        danger: 'hsl(var(--danger))',
        info: 'hsl(var(--info))',
        extra: 'hsl(var(--extra))'
      },
      fontFamily: {
        sans: ['"DM Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"DM Mono"', 'ui-monospace', 'monospace']
      },
      boxShadow: {
        focus: '0 0 0 2px hsl(var(--ring) / 0.25)',
        glow: '0 0 8px hsl(var(--ring) / 0.35)',
        'glow-success': '0 0 8px hsl(var(--success) / 0.35)',
        'glow-danger': '0 0 8px hsl(var(--danger) / 0.35)'
      }
    }
  },
  plugins: []
}

export default config
```

- [ ] **Step 2: 验证构建**

```bash
cd /Users/yaya/me/workspace/trade-system-0 && npx tsc --noEmit 2>&1
```
Expected: no errors.

- [ ] **Step 3: 提交**

```bash
cd /Users/yaya/me/workspace/trade-system-0
git add tailwind.config.ts
git commit -m "style: 同步 Tailwind 配置至 TokyoNightStorm 色板"
```

---

### Task 3: Google Fonts 引入

**Files:**
- Modify: `index.html`

- [ ] **Step 1: 在 `<head>` 中加入 DM Mono + DM Sans 字体链接**

将 `index.html` 修改为：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>trade-system-0</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=DM+Mono:ital,wght@0,300;0,400;0,500&family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&display=swap"
      rel="stylesheet"
    />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: 提交**

```bash
cd /Users/yaya/me/workspace/trade-system-0
git add index.html
git commit -m "style: 引入 DM Mono + DM Sans Google Fonts"
```

---

### Task 4: AppShell 布局适配

**Files:**
- Modify: `src/components/layout/AppShell.tsx`

- [ ] **Step 1: 调整三栏宽度并添加暗色适配**

将 `AppShell.tsx` 替换为：

```tsx
import type { ReactNode } from 'react'
import { CircleDot, Database, Server } from 'lucide-react'
import { routes, type PageId } from '../../app/routes'
import type { KlineCoverage, ModelProvider, StockReview, TradeSystemSummary } from '../../lib/types'
import { cn } from '../../lib/cn'
import { Badge } from '../shared/Badge'
import { formatDateTime, formatRows, jsonPreview } from '../../lib/format'

export function AppShell({
  activePage,
  onPageChange,
  tradeSystems,
  activeProvider,
  coverage,
  stockCode,
  selectedVersionId,
  latestReview,
  children
}: {
  activePage: PageId
  onPageChange: (page: PageId) => void
  tradeSystems: TradeSystemSummary[]
  activeProvider?: ModelProvider
  coverage?: KlineCoverage
  stockCode: string
  selectedVersionId?: string
  latestReview?: StockReview
  children: ReactNode
}) {
  const selectedSystem = tradeSystems.find(system => system.activeVersionId === selectedVersionId)

  return (
    <div className="grid h-screen grid-cols-[200px_minmax(680px,1fr)_280px] grid-rows-[48px_1fr] bg-background">
      <aside className="row-span-2 border-r border-border bg-panel">
        <div className="flex h-12 items-center gap-2 border-b border-border px-4">
          <CircleDot className="h-4 w-4 text-ring" />
          <div className="text-sm font-semibold text-foreground font-mono">
            trade-system-0
          </div>
        </div>
        <nav className="p-2">
          {routes.map(route => {
            const Icon = route.icon
            return (
              <button
                className={cn(
                  'mb-1 flex h-9 w-full items-center gap-2 px-3 text-left text-sm transition font-mono',
                  activePage === route.id
                    ? 'bg-ring text-panel'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
                key={route.id}
                onClick={() => onPageChange(route.id)}
                type="button"
              >
                <Icon className="h-4 w-4" />
                {route.label}
              </button>
            )
          })}
        </nav>
      </aside>

      <header className="col-span-2 flex items-center justify-between border-b border-border bg-panel px-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>交易系统</span>
          <Badge tone={selectedVersionId ? 'success' : 'warning'}>
            {selectedSystem
              ? `${selectedSystem.name} v${selectedSystem.activeVersion ?? '-'}`
              : selectedVersionId
                ? selectedVersionId
                : '未选择'}
          </Badge>
          <span>Provider</span>
          <Badge tone={activeProvider ? 'info' : 'warning'}>{activeProvider?.name ?? '未配置'}</Badge>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Database className="h-3.5 w-3.5" />
            {stockCode || '未输入股票'}
          </span>
          <span className="inline-flex items-center gap-1">
            <Server className="h-3.5 w-3.5" />
            日 {formatRows(coverage?.daily.rows)} / 周 {formatRows(coverage?.weekly.rows)} / 月{' '}
            {formatRows(coverage?.monthly.rows)}
          </span>
        </div>
      </header>

      <main className="overflow-auto p-4">{children}</main>

      <aside className="overflow-auto border-l border-border bg-panel">
        <div className="border-b border-border px-4 py-3">
          <div className="text-xs font-medium text-muted-foreground font-mono">当前股票</div>
          <div className="mt-1 text-lg font-semibold text-foreground font-mono">
            {stockCode || '-'}
          </div>
        </div>
        <div className="border-b border-border px-4 py-3">
          <div className="text-xs font-medium text-muted-foreground font-mono">K 线覆盖</div>
          <dl className="mt-2 grid gap-1 text-xs">
            <ContextRow label="日 K" value={coverageText(coverage?.daily)} />
            <ContextRow label="周 K" value={coverageText(coverage?.weekly)} />
            <ContextRow label="月 K" value={coverageText(coverage?.monthly)} />
            <ContextRow label="最近同步" value={formatDateTime(coverage?.lastSyncAt)} />
          </dl>
        </div>
        <div className="px-4 py-3">
          <div className="text-xs font-medium text-muted-foreground font-mono">最近评分</div>
          {latestReview ? (
            <div className="mt-2 grid gap-2 text-xs">
              <div className="flex items-center gap-2">
                <Badge tone={latestReview.score ? 'success' : 'warning'}>
                  {latestReview.score ?? '-'} / 100
                </Badge>
                <Badge tone="info">{latestReview.rating}</Badge>
              </div>
              <p className="leading-5 text-muted-foreground">{latestReview.overallEvaluation}</p>
              <pre className="max-h-64 overflow-auto bg-muted p-2 text-[11px] leading-4 text-foreground font-mono">
                {jsonPreview(latestReview.tradePlan)}
              </pre>
            </div>
          ) : (
            <p className="mt-2 text-xs leading-5 text-muted-foreground">暂无评分记录</p>
          )}
        </div>
      </aside>
    </div>
  )
}

function ContextRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate text-right font-mono text-foreground">{value}</dd>
    </div>
  )
}

function coverageText(item?: KlineCoverage['daily']) {
  if (!item || item.rows === 0) return '无数据'
  return `${item.startDate ?? '-'} 至 ${item.endDate ?? '-'} (${formatRows(item.rows)})`
}
```

关键改动：
- grid 列宽: `[220px_minmax(680px,1fr)_320px]` → `[200px_minmax(680px,1fr)_280px]`
- `text-accent` → `text-ring`（logo 图标）
- 导航按钮: `bg-accent text-accent-foreground` → `bg-ring text-panel`
- 导航按钮字体: 加 `font-mono`
- Provider badge: `tone="accent"` → `tone="info"`
- rating badge: `tone="info"` 替代默认值
- 右边栏 label: 加 `font-mono`
- stockCode 大字: 加 `font-mono`
- jsonPreview pre: 加 `text-foreground font-mono`

- [ ] **Step 2: 验证 TypeScript**

```bash
cd /Users/yaya/me/workspace/trade-system-0 && npx tsc --noEmit 2>&1
```
Expected: no errors.

- [ ] **Step 3: 提交**

```bash
cd /Users/yaya/me/workspace/trade-system-0
git add src/components/layout/AppShell.tsx
git commit -m "style: AppShell 适配 TokyoNightStorm + 三栏收窄"
```

---

### Task 5: Badge 组件重设计

**Files:**
- Modify: `src/components/shared/Badge.tsx`

- [ ] **Step 1: 实心色块风格**

将 Badge 组件替换为：

```tsx
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export function Badge({
  children,
  tone = 'neutral'
}: {
  children: ReactNode
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'extra'
}) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center px-2 text-xs font-medium font-mono',
        tone === 'neutral' && 'bg-muted text-muted-foreground',
        tone === 'success' && 'bg-success/20 text-success',
        tone === 'warning' && 'bg-warning/20 text-warning',
        tone === 'danger' && 'bg-danger/20 text-danger',
        tone === 'info' && 'bg-info/20 text-info',
        tone === 'extra' && 'bg-extra/20 text-extra'
      )}
    >
      {children}
    </span>
  )
}
```

改动：去掉 `border`、改为纯 `bg-<color>/20` 背景 + `<color>` 文字，色块感。

- [ ] **Step 2: 提交**

```bash
cd /Users/yaya/me/workspace/trade-system-0
git add src/components/shared/Badge.tsx
git commit -m "style: Badge 改为无边框实心色块风格"
```

---

### Task 6: Button 组件重设计

**Files:**
- Modify: `src/components/shared/Button.tsx`

- [ ] **Step 1: 直角 + hover glow**

将 Button 组件替换为：

```tsx
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md' | 'icon'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: ReactNode
}

export function Button({
  className,
  variant = 'secondary',
  size = 'md',
  icon,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 font-medium font-mono outline-none transition-all duration-150 focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-50',
        size === 'sm' && 'h-8 px-3 text-xs',
        size === 'md' && 'h-9 px-3 text-sm',
        size === 'icon' && 'h-8 w-8 p-0',
        variant === 'primary' &&
          'bg-ring text-panel hover:shadow-glow',
        variant === 'secondary' &&
          'border border-border bg-transparent text-foreground hover:border-ring hover:shadow-glow',
        variant === 'ghost' && 'bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
        variant === 'danger' && 'bg-danger text-panel hover:shadow-glow-danger',
        className
      )}
      type={props.type ?? 'button'}
      {...props}
    >
      {icon}
      {children}
    </button>
  )
}
```

改动：
- 去掉 `border` 通用修饰，改为各 variant 自己管理
- primary: `ring` 底 + `panel` 字 + hover `shadow-glow`
- secondary: 透明底 + `border-border` + hover `border-ring shadow-glow`
- ghost: 不变，只加 `font-mono`
- danger: `danger` 底 + hover `shadow-glow-danger`
- 加 `font-mono`、`transition-all`、`duration-150`

- [ ] **Step 2: 提交**

```bash
cd /Users/yaya/me/workspace/trade-system-0
git add src/components/shared/Button.tsx
git commit -m "style: Button 改为直角 + hover glow 风格"
```

---

### Task 7: Panel 组件重设计

**Files:**
- Modify: `src/components/shared/Panel.tsx`

- [ ] **Step 1: 暗色边框 + 字体升级**

将 Panel 替换为：

```tsx
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export function Panel({
  title,
  action,
  children,
  className
}: {
  title?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('border border-border bg-panel', className)}>
      {title || action ? (
        <div className="flex min-h-11 items-center justify-between border-b border-border px-4">
          {title ? (
            <h2 className="text-sm font-semibold text-foreground font-mono">{title}</h2>
          ) : (
            <span />
          )}
          {action}
        </div>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  )
}

export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center border border-dashed border-border bg-muted/30 px-6 text-center">
      <div className="text-sm font-medium text-foreground">{title}</div>
      {detail ? (
        <div className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">{detail}</div>
      ) : null}
    </div>
  )
}
```

改动：标题 `h2` 加 `font-mono`，其余不变（bg-panel 已自动跟随 CSS 变量）。

- [ ] **Step 2: 提交**

```bash
cd /Users/yaya/me/workspace/trade-system-0
git add src/components/shared/Panel.tsx
git commit -m "style: Panel 标题改为等宽字体"
```

---

### Task 8: DataTable 组件重设计

**Files:**
- Modify: `src/components/shared/DataTable.tsx`

- [ ] **Step 1: 暗色行 hover + 等宽字体**

```tsx
import type { ReactNode } from 'react'

export function DataTable({
  columns,
  children
}: {
  columns: string[]
  children: ReactNode
}) {
  return (
    <div className="overflow-auto border border-border">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="bg-panel text-xs text-muted-foreground">
          <tr>
            {columns.map(column => (
              <th className="border-b border-border px-3 py-2 font-medium font-mono" key={column}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border bg-background">{children}</tbody>
      </table>
    </div>
  )
}

export function Td({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <td className={`px-3 py-2 align-top text-foreground ${className ?? ''}`}>
      {children}
    </td>
  )
}
```

改动：
- 表头底色: `bg-muted/70` → `bg-panel`，加 `font-mono`
- tbody 底色: `bg-panel` → `bg-background`
- Td 加 `text-foreground` 确保暗色可读

- [ ] **Step 2: 提交**

```bash
cd /Users/yaya/me/workspace/trade-system-0
git add src/components/shared/DataTable.tsx
git commit -m "style: DataTable 暗色适配 + 表头等宽"
```

---

### Task 9: Field / Input / Textarea / Select 重设计

**Files:**
- Modify: `src/components/shared/Field.tsx`

- [ ] **Step 1: 下划线式表单控件**

```tsx
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

export function Field({
  label,
  children,
  hint
}: {
  label: string
  children: ReactNode
  hint?: string
}) {
  return (
    <label className="grid gap-1.5 text-xs font-medium text-muted-foreground font-mono">
      <span>{label}</span>
      {children}
      {hint ? <span className="text-[11px] font-normal text-muted-foreground">{hint}</span> : null}
    </label>
  )
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-9 w-full border-0 border-b border-border bg-transparent px-0 text-sm text-foreground font-mono outline-none transition-[border-color,border-bottom-width] duration-150 placeholder:text-muted-foreground focus:border-b-2 focus:border-ring',
        className
      )}
      {...props}
    />
  )
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'min-h-24 w-full border border-border bg-muted/40 px-3 py-2 text-sm leading-6 text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:shadow-focus',
        className
      )}
      {...props}
    />
  )
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'h-9 w-full border-0 border-b border-border bg-transparent px-0 text-sm text-foreground font-mono outline-none transition-[border-color,border-bottom-width] duration-150 focus:border-b-2 focus:border-ring',
        className
      )}
      {...props}
    />
  )
}
```

改动：
- Field label: 加 `font-mono`
- Input: 去掉四边框，改为底部单线 `border-b`，无色背景，focus 时加宽至 2px 并变色，加 `font-mono`
- Select: 同 Input 的下划线风格
- Textarea: 保留四边框（需要滚动区域），改为暗色底 `bg-muted/40`

- [ ] **Step 2: 验证 TypeScript**

```bash
cd /Users/yaya/me/workspace/trade-system-0 && npx tsc --noEmit 2>&1
```
Expected: no errors.

- [ ] **Step 3: 提交**

```bash
cd /Users/yaya/me/workspace/trade-system-0
git add src/components/shared/Field.tsx
git commit -m "style: Input/Select 改为下划线式 + 等宽字体"
```

---

### Task 10: 验证与收尾

- [ ] **Step 1: TypeScript 类型检查**

```bash
cd /Users/yaya/me/workspace/trade-system-0 && npx tsc --noEmit 2>&1
```
Expected: no errors.

- [ ] **Step 2: 运行已有测试**

```bash
cd /Users/yaya/me/workspace/trade-system-0 && npx vitest run 2>&1
```
Expected: App smoke test passes ("renders the desktop shell").

- [ ] **Step 3: 启动开发服务器验证视觉效果**

```bash
cd /Users/yaya/me/workspace/trade-system-0 && npm run tauri:dev
```
Manual check: 所有 8 个页面在 TokyoNightStorm 暗色方案下显示正常，无对比度问题，无布局错乱。

- [ ] **Step 4: 如发现页面需微调，修复并提交**

- [ ] **Step 5: 最终提交**

```bash
cd /Users/yaya/me/workspace/trade-system-0
git add -A
git commit -m "style: UI redesign 收尾——页面级暗色适配微调"
```
