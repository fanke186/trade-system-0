import { useEffect, useState, useCallback } from 'react'
import { Minus, Square, X, Copy } from 'lucide-react'

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    let cancelled = false
    const init = async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window')
        if (cancelled) return
        const appWindow = getCurrentWindow()
        appWindow.isMaximized().then(v => !cancelled && setIsMaximized(v)).catch(() => {})
        const unlisten = await appWindow.onResized(() => {
          appWindow.isMaximized().then(v => !cancelled && setIsMaximized(v)).catch(() => {})
        })
        if (cancelled) unlisten()
      } catch {
        // Not running in Tauri (e.g., tests, browser)
      }
    }
    init()
    return () => { cancelled = true }
  }, [])

  const handleMinimize = useCallback(async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      getCurrentWindow().minimize()
    } catch { /* not in Tauri */ }
  }, [])

  const handleToggleMaximize = useCallback(async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      getCurrentWindow().toggleMaximize()
    } catch { /* not in Tauri */ }
  }, [])

  const handleClose = useCallback(async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      getCurrentWindow().close()
    } catch { /* not in Tauri */ }
  }, [])

  return (
    <div className="flex h-full items-center shrink-0">
      <WindowButton onClick={handleMinimize} title="最小化">
        <Minus className="h-3 w-3" />
      </WindowButton>
      <WindowButton onClick={handleToggleMaximize} title={isMaximized ? '还原' : '最大化'}>
        {isMaximized ? (
          <Copy className="h-3 w-3 rotate-180" />
        ) : (
          <Square className="h-3 w-3" />
        )}
      </WindowButton>
      <WindowButton onClick={handleClose} title="关闭" isClose>
        <X className="h-3.5 w-3.5" />
      </WindowButton>
    </div>
  )
}

function WindowButton({
  onClick,
  title,
  isClose,
  children,
}: {
  onClick: () => void
  title: string
  isClose?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={
        'inline-flex h-full w-10 items-center justify-center text-muted-foreground transition hover:bg-muted hover:text-foreground' +
        (isClose ? ' hover:bg-danger hover:text-white' : '')
      }
    >
      {children}
    </button>
  )
}
