import {
  Activity,
  Bot,
  CalendarDays,
  Database,
  Settings,
  Star
} from 'lucide-react'

export type PageId =
  | 'my-watchlist'
  | 'daily-review'
  | 'trade-system-agents'
  | 'stock-review'
  | 'kline-data'
  | 'settings'

export const routes = [
  { id: 'my-watchlist', label: '我的自选', icon: Star },
  { id: 'daily-review', label: 'AI 评分', icon: CalendarDays },
  { id: 'trade-system-agents', label: '交易系统Agents', icon: Bot },
  { id: 'stock-review', label: '股票评分', icon: Activity },
  { id: 'kline-data', label: 'K线数据', icon: Database },
  { id: 'settings', label: '设置', icon: Settings }
] as const
