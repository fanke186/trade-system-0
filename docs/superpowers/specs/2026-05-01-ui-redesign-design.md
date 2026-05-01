# UI Redesign · 暗色高对比工业终端风

## 概述

将 trade-system-0 前端从通用浅色 Inter 配合蓝色点缀的方案，重新设计为基于暗色高对比色板 + DM Mono/Sans 字体的工业终端风格。核心理念：**"每个像素都在传递信息"** ——颜色是语义信号系统，字体定义信息层级，不纯为装饰。

## 设计决策

### 配色方案：暗色高对比

黑底高对比，色彩饱和、信号明确，适合交易工具的数据密度需求。

| Token | Hex | 用途 |
|-------|-----|------|
| `--background` | `#0d0d0d` | 页面底色 |
| `--panel` | `#121212` | 侧栏、面板底色 |
| `--border` | `#2a2a2a` | 边框、分隔线 |
| `--foreground` | `#eeeeee` | 主文字色 |
| `--muted` | `#1f1f1f` | 次要背景 |
| `--muted-foreground` | `#888888` | 次要文字 |
| `--ring` / `--success` / buy | `#4d90fe` | 买入信号、成功状态、主强调色 |
| `--danger` / sell | `#ff6b35` | 卖出信号、危险操作 |
| `--warning` / hold | `#f0b93b` | 观望、警告状态 |
| `--info` | `#7dcfff` | 信息色（时间戳、链接） |
| `--extra` | `#bb9af7` | 辅助强调（特殊标记） |

### 字体系统：DM Mono + DM Sans

| 用途 | 字体 | 说明 |
|------|------|------|
| 数据/代码/标签/按钮/输入 | DM Mono | 等宽终端感，数字天然对齐 |
| 正文/中文/长文 | DM Sans | 可变无衬线，阅读舒适，中文渲染好 |

两者同属 DM 家族，视觉统一。备选回退：系统等宽 / 系统无衬线。

### 布局

保持三栏网格（`200px | 1fr | 280px`）：
- **左侧** 200px：导航栏，比之前收窄 20px
- **中间** 自适应：主工作区
- **右侧** 280px：信号面板，比之前收窄 40px

### 组件设计规范

| 组件 | 视觉特征 |
|------|---------|
| **Badge** | 填充背景色替代透明底+边框，色块感。实心用于主要状态，半透明底用于标签 |
| **Button** | 直角、1px 边框。primary 填充 accent 色，secondary 透明底 + border 色边框。hover 时边框变亮色并加微弱 glow |
| **Panel** | 1px border 色边框，顶部标题栏与内容区间用 border 分隔 |
| **DataTable** | 表头用 panel 底 + muted-foreground 文字。行间细线分隔。hover 行背景微亮。数字列等宽右对齐 |
| **Input/Select** | 透明底 + 底部 1px muted 线。focus 时底线变 accent 色并加宽至 2px。无整框边框 |
| **EmptyState** | 居中排列，使用 dotted 边框的 panel 底 + muted-foreground |
| **KLineChart** | 网格线暗灰 `#2a2a2a`/`#262626`，蜡烛图保持红涨绿跌默认 |

### 动效

| 场景 | 效果 |
|------|------|
| 页面切换 | 150ms opacity 淡入，不闪白 |
| Button hover | 边框颜色变亮 + 微弱 box-shadow glow |
| 数据更新 | 数字值变化时 200ms 短暂闪烁（opacity 脉冲） |
| Select/Input focus | 底线加宽动画（border-bottom-width transition） |

## 实现范围

### 改动的文件

| 文件 | 改动 |
|------|------|
| `src/styles/index.css` | 新 CSS 变量、字体引入、基础样式 |
| `tailwind.config.ts` | 新颜色 token、新字体栈 |
| `index.html` | Google Fonts 引入（DM Mono + DM Sans） |
| `src/components/layout/AppShell.tsx` | 布局改为 200px/1fr/280px，暗色适配 |
| `src/components/shared/Badge.tsx` | 实心色块风格 |
| `src/components/shared/Button.tsx` | 直角 + hover glow |
| `src/components/shared/Panel.tsx` | 暗色边框 |
| `src/components/shared/DataTable.tsx` | 暗色适配 + 表头 mono |
| `src/components/shared/Field.tsx` | 下划线式 input/select/textarea |
| `src/components/chart/KLineChartPanel.tsx` | 网格线适配暗色背景 |
| `src/pages/SettingsPage.tsx` | Badge accent→info 修复 |
| `CLAUDE.md` | 新增设计规范章节 |
| `.gitignore` | 加 .superpowers/ reference/ |

### 不做的

- 不动 KLineChart 图表库内部渲染（第三方库，只改容器和网格线颜色）
- 不加新依赖（Tailwind 现有配置足够，仅引入 Google Fonts）
- 不改功能逻辑，纯视觉层
