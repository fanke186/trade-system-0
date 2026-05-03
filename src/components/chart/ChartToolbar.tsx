import { Minus, MoveUpRight, Settings } from 'lucide-react'
import { cn } from '../../lib/cn'

type Frequency = '1d' | '1w' | '1M' | '1Q' | '1Y'
type AdjMode = 'pre' | 'none'
type DrawingTool = 'horizontal_line' | 'ray' | null

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
}) {
  const freqLabels: Record<Frequency, string> = { '1d': '日K', '1w': '周K', '1M': '月K', '1Q': '季K', '1Y': '年K' }
  const adjLabels: Record<AdjMode, string> = { pre: '前复权', none: '除权' }

  return (
    <div className="flex h-10 items-center gap-4 bg-panel/65 px-3 shadow-[0_1px_0_rgba(255,255,255,0.03)]">
      {/* Stock name + code */}
      <div className="flex items-baseline gap-1.5 whitespace-nowrap">
        <span className="text-sm font-semibold text-foreground">{stockName}</span>
        <span className="text-xs text-muted-foreground font-mono">{stockCode}</span>
      </div>

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
        className="h-7 border-0 bg-muted/40 px-2 text-xs text-foreground font-mono outline-none transition focus:bg-muted"
      >
        {(Object.entries(adjLabels) as [AdjMode, string][]).map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>

      {/* Drawing tool buttons */}
      <div className="flex items-center gap-0.5">
        <span className="mr-1 text-[11px] text-muted-foreground font-mono">画线</span>
        <button
          type="button"
          onClick={() => onDrawingToolChange(drawingTool === 'horizontal_line' ? null : 'horizontal_line')}
          className={cn(
            'h-7 w-7 flex items-center justify-center transition',
            drawingTool === 'horizontal_line'
              ? 'bg-ring text-panel'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
          title="横线"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onDrawingToolChange(drawingTool === 'ray' ? null : 'ray')}
          className={cn(
            'h-7 w-7 flex items-center justify-center transition',
            drawingTool === 'ray'
              ? 'bg-ring text-panel'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
          title="射线"
        >
          <MoveUpRight className="h-3.5 w-3.5" />
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
