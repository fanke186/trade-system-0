import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export function Badge({
  children,
  tone = 'neutral'
}: {
  children: ReactNode
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'extra'
}) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center px-2 text-xs font-medium font-mono',
        tone === 'neutral' && 'bg-muted text-muted-foreground',
        tone === 'success' && 'bg-success/20 text-success',
        tone === 'warning' && 'bg-warning/20 text-warning',
        tone === 'danger' && 'bg-danger/20 text-danger',
        tone === 'info' && 'bg-info/20 text-info',
        tone === 'extra' && 'bg-extra/20 text-extra'
      )}
    >
      {children}
    </span>
  )
}
