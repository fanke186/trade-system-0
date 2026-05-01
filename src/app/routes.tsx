import {
  Activity,
  BarChart3,
  Bot,
  CalendarDays,
  Database,
  FileText,
  Settings,
  Star
} from 'lucide-react'

export type PageId =
  | 'my-watchlist'
  | 'daily-review'
  | 'trade-system'
  | 'agent'
  | 'stock-review'
  | 'data'
  | 'settings'

export const routes = [
  { id: 'my-watchlist', label: '我的自选', icon: Star },
  { id: 'daily-review', label: '每日复盘', icon: CalendarDays },
  { id: 'trade-system', label: '交易系统', icon: FileText },
  { id: 'agent', label: 'Agent', icon: Bot },
  { id: 'stock-review', label: '股票评分', icon: Activity },
  { id: 'data', label: '数据', icon: Database },
  { id: 'settings', label: '设置', icon: Settings }
] as const satisfies Array<{ id: PageId; label: string; icon: typeof BarChart3 }>

