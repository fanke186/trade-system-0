import { useState, useRef, useCallback } from 'react'
import { Trash2, Undo2, GripHorizontal } from 'lucide-react'

const COLORS = ['#4d90fe', '#f0b93b', '#bb9af7', '#7dcfff', '#ff8c69']

export function DrawingToolbar({
  position,
  onColorChange,
  onUndo,
  onDelete,
}: {
  position: { x: number; y: number }
  onColorChange: (color: string) => void
  onUndo: () => void
  onDelete: () => void
}) {
  const [pos, setPos] = useState(position)
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef({ startX: 0, startY: 0, origX: 0, origY: 0 })

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setDragging(true)
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y }
    const onMove = (ev: MouseEvent) => {
      setPos({
        x: dragRef.current.origX + ev.clientX - dragRef.current.startX,
        y: dragRef.current.origY + ev.clientY - dragRef.current.startY,
      })
    }
    const onUp = () => {
      setDragging(false)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [pos])

  return (
    <div className="absolute z-50 flex items-center gap-1 border border-border bg-panel px-2 py-1 shadow-lg"
         style={{ left: pos.x, top: pos.y, cursor: dragging ? 'grabbing' : 'default' }}>
      {COLORS.map(c => (
        <button key={c} className="h-4 w-4 rounded-full border border-white/20 hover:scale-125 transition"
                style={{ backgroundColor: c }} onClick={() => onColorChange(c)} />
      ))}
      <div className="mx-1 h-4 w-px bg-border" />
      <button onClick={onUndo} className="p-0.5 text-muted-foreground hover:text-foreground transition" title="撤销">
        <Undo2 className="h-3.5 w-3.5" />
      </button>
      <button className="p-0.5 text-muted-foreground hover:text-foreground transition cursor-grab active:cursor-grabbing"
              title="拖拽移动" onMouseDown={handleMouseDown}>
        <GripHorizontal className="h-3.5 w-3.5" />
      </button>
      <button onClick={onDelete} className="p-0.5 text-danger hover:text-danger/80 transition" title="删除">
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
