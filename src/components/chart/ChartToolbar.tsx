import { Settings } from 'lucide-react'
import { cn } from '../../lib/cn'

type Frequency = '1d' | '1w' | '1M'
type AdjMode = 'pre' | 'post' | 'none'
type DrawingTool = 'horizontal_line' | 'ray' | null
type SubChartType = 'volume' | 'amount'

export function ChartToolbar({
  stockName,
  stockCode,
  frequency,
  onFrequencyChange,
  adjMode,
  onAdjModeChange,
  onSettingsClick,
  settingsOpen,
  drawingTool,
  onDrawingToolChange,
  subChartType,
  onSubChartTypeChange,
}: {
  stockName: string
  stockCode: string
  frequency: Frequency
  onFrequencyChange: (f: Frequency) => void
  adjMode: AdjMode
  onAdjModeChange: (m: AdjMode) => void
  onSettingsClick: () => void
  settingsOpen: boolean
  drawingTool: DrawingTool
  onDrawingToolChange: (t: DrawingTool) => void
  subChartType: SubChartType
  onSubChartTypeChange: (t: SubChartType) => void
}) {
  const freqLabels: Record<Frequency, string> = { '1d': '日K', '1w': '周K', '1M': '月K' }
  const adjLabels: Record<AdjMode, string> = { pre: '前复权', post: '后复权', none: '除权' }

  return (
    <div className="flex h-10 items-center gap-3 border-b border-border bg-panel px-3">
      {/* Stock name + code */}
      <div className="flex items-baseline gap-1.5 whitespace-nowrap">
        <span className="text-sm font-semibold text-foreground">{stockName}</span>
        <span className="text-xs text-muted-foreground font-mono">{stockCode}</span>
      </div>

      <div className="h-4 w-px bg-border" />

      {/* Frequency buttons */}
      <div className="flex gap-0.5">
        {(Object.entries(freqLabels) as [Frequency, string][]).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => onFrequencyChange(key)}
            className={cn(
              'h-7 px-2.5 text-xs font-mono transition',
              frequency === key
                ? 'bg-ring text-panel'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Adj mode select */}
      <select
        value={adjMode}
        onChange={e => onAdjModeChange(e.target.value as AdjMode)}
        className="h-7 border-0 border-b border-border bg-transparent px-1 text-xs text-foreground font-mono outline-none transition-[border-color,border-bottom-width] duration-150 focus:border-b-2 focus:border-ring"
      >
        {(Object.entries(adjLabels) as [AdjMode, string][]).map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>

      <div className="h-4 w-px bg-border" />

      {/* Drawing tool buttons */}
      <div className="flex gap-0.5">
        <button
          type="button"
          onClick={() => onDrawingToolChange(drawingTool === 'horizontal_line' ? null : 'horizontal_line')}
          className={cn(
            'h-7 px-2.5 text-xs font-mono transition',
            drawingTool === 'horizontal_line'
              ? 'bg-ring text-panel'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          横线
        </button>
        <button
          type="button"
          onClick={() => onDrawingToolChange(drawingTool === 'ray' ? null : 'ray')}
          className={cn(
            'h-7 px-2.5 text-xs font-mono transition',
            drawingTool === 'ray'
              ? 'bg-ring text-panel'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          射线
        </button>
      </div>

      <div className="h-4 w-px bg-border" />

      {/* Sub-chart toggle */}
      <div className="flex gap-0.5">
        <button
          type="button"
          onClick={() => onSubChartTypeChange('volume')}
          className={cn(
            'h-7 px-2.5 text-xs font-mono transition',
            subChartType === 'volume'
              ? 'bg-ring text-panel'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          成交量
        </button>
        <button
          type="button"
          onClick={() => onSubChartTypeChange('amount')}
          className={cn(
            'h-7 px-2.5 text-xs font-mono transition',
            subChartType === 'amount'
              ? 'bg-ring text-panel'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          成交额
        </button>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Settings gear */}
      <button
        type="button"
        onClick={onSettingsClick}
        className={cn(
          'flex h-7 w-7 items-center justify-center transition',
          settingsOpen
            ? 'text-ring'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <Settings className="h-4 w-4" />
      </button>
    </div>
  )
}
