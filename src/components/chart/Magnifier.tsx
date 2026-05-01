import { useEffect, useRef } from 'react'
import type { KlineBar } from '../../lib/types'

export function Magnifier({
  bar,
  position
}: {
  bar: KlineBar
  position: 'top-left' | 'top-right'
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = 'rgba(13,13,13,0.92)'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    ctx.fillStyle = '#eee'
    ctx.font = '10px "DM Mono", monospace'
    ctx.fillText(`开 ${bar.open.toFixed(2)}`, 8, 18)
    ctx.fillText(`高 ${bar.high.toFixed(2)}`, 8, 34)
    ctx.fillText(`低 ${bar.low.toFixed(2)}`, 8, 50)
    ctx.fillText(`收 ${bar.close.toFixed(2)}`, 8, 66)
    if (bar.changePct != null) {
      ctx.fillStyle = bar.changePct >= 0 ? '#0f9f6e' : '#dc2626'
      ctx.fillText(`${bar.changePct > 0 ? '+' : ''}${bar.changePct.toFixed(2)}%`, 90, 18)
    }
  }, [bar])

  const posClass = position === 'top-left' ? 'left-2 top-2' : 'right-2 top-2'

  return (
    <canvas ref={canvasRef} width={160} height={80}
            className={`absolute z-50 ${posClass} border border-border`} />
  )
}
