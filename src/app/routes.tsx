import {
  Activity,
  BarChart3,
  Bot,
  CalendarDays,
  Database,
  FileText,
  LineChart,
  ListChecks,
  Settings
} from 'lucide-react'

export type PageId =
  | 'daily-review'
  | 'trade-system'
  | 'agent'
  | 'stock-review'
  | 'chart'
  | 'watchlist'
  | 'data'
  | 'settings'

export const routes = [
  { id: 'daily-review', label: '每日复盘', icon: CalendarDays },
  { id: 'trade-system', label: '交易系统', icon: FileText },
  { id: 'agent', label: 'Agent', icon: Bot },
  { id: 'stock-review', label: '股票评分', icon: Activity },
  { id: 'chart', label: 'K 线图表', icon: LineChart },
  { id: 'watchlist', label: '自选股票池', icon: ListChecks },
  { id: 'data', label: '数据', icon: Database },
  { id: 'settings', label: '设置', icon: Settings }
] as const satisfies Array<{ id: PageId; label: string; icon: typeof BarChart3 }>

