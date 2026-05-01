import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export function Badge({
  children,
  tone = 'neutral'
}: {
  children: ReactNode
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'accent'
}) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center border px-2 text-xs font-medium',
        tone === 'neutral' && 'border-border bg-muted text-muted-foreground',
        tone === 'success' && 'border-success/20 bg-success/10 text-success',
        tone === 'warning' && 'border-warning/20 bg-warning/10 text-warning',
        tone === 'danger' && 'border-danger/20 bg-danger/10 text-danger',
        tone === 'accent' && 'border-accent/20 bg-accent/10 text-accent'
      )}
    >
      {children}
    </span>
  )
}

