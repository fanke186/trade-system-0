import { useState, useEffect, useRef, useCallback } from 'react'
import { X } from 'lucide-react'
import { cn } from '../../lib/cn'

export type ChartSettings = {
  maLines: Array<{ period: number; color: string; enabled: boolean }>
  coordType: 'normal' | 'log'
}

const COLOR_PALETTE = [
  '#4d90fe', '#0f9f6e', '#dc2626', '#f0b93b', '#7dcfff', '#bb9af7', '#ff6b35',
]

export function SettingsPopover({
  settings,
  onChange,
  onClose,
}: {
  settings: ChartSettings
  onChange: (settings: ChartSettings) => void
  onClose: () => void
}) {
  const [newPeriod, setNewPeriod] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const toggleMa = useCallback(
    (index: number) => {
      const lines = settings.maLines.map((line, i) =>
        i === index ? { ...line, enabled: !line.enabled } : line,
      )
      onChange({ ...settings, maLines: lines })
    },
    [settings, onChange],
  )

  const addMa = useCallback(() => {
    const period = parseInt(newPeriod, 10)
    if (isNaN(period) || period <= 0) return
    if (settings.maLines.some(line => line.period === period)) return
    const color = COLOR_PALETTE[settings.maLines.length % COLOR_PALETTE.length]
    onChange({
      ...settings,
      maLines: [...settings.maLines, { period, color, enabled: true }],
    })
    setNewPeriod('')
  }, [newPeriod, settings, onChange])

  const setCoordType = useCallback(
    (type: 'normal' | 'log') => {
      onChange({ ...settings, coordType: type })
    },
    [settings, onChange],
  )

  return (
    <div
      ref={ref}
      className="absolute right-0 top-0 z-50 w-56 border border-border bg-panel p-4 shadow-lg"
    >
      {/* MA Lines */}
      <div className="mb-4">
        <div className="mb-2 text-xs font-medium text-muted-foreground font-mono">均线设置</div>
        <div className="grid gap-1.5">
          {settings.maLines.map((line, i) => (
            <div key={line.period} className="flex items-center gap-2 text-xs text-foreground">
              <label className="flex cursor-pointer items-center gap-2 flex-1 min-w-0">
                <input type="checkbox" checked={line.enabled} onChange={() => toggleMa(i)} className="h-3.5 w-3.5 accent-ring" />
                <span className="inline-block h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: line.color }} />
                <span className="font-mono">MA{line.period}</span>
              </label>
              <button onClick={(e) => { e.preventDefault(); onChange({ ...settings, maLines: settings.maLines.filter((_, j) => j !== i) }); }}
                      className="text-muted-foreground hover:text-danger transition shrink-0" title="删除">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Add custom MA */}
      <div className="mb-4">
        <div className="mb-2 flex gap-2">
          <input
            type="number"
            min={1}
            max={999}
            placeholder="周期"
            value={newPeriod}
            onChange={e => setNewPeriod(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') addMa()
            }}
            className="h-7 w-20 border-0 border-b border-border bg-transparent px-0 text-xs text-foreground font-mono outline-none transition-[border-color,border-bottom-width] duration-150 placeholder:text-muted-foreground focus:border-b-2 focus:border-ring"
          />
          <button
            type="button"
            onClick={addMa}
            disabled={!newPeriod}
            className="h-7 px-2 text-xs font-mono text-ring transition hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            + 添加
          </button>
        </div>
      </div>

      {/* Coordinate type */}
      <div>
        <div className="mb-2 text-xs font-medium text-muted-foreground font-mono">坐标类型</div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setCoordType('normal')}
            className={cn(
              'h-7 px-3 text-xs font-mono transition',
              settings.coordType === 'normal'
                ? 'bg-ring text-panel'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            普通坐标
          </button>
          <button
            type="button"
            onClick={() => setCoordType('log')}
            className={cn(
              'h-7 px-3 text-xs font-mono transition',
              settings.coordType === 'log'
                ? 'bg-ring text-panel'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            对数坐标
          </button>
        </div>
      </div>
    </div>
  )
}
