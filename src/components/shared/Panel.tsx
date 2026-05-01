import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export function Panel({
  title,
  action,
  children,
  className
}: {
  title?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('border border-border bg-panel', className)}>
      {title || action ? (
        <div className="flex min-h-11 items-center justify-between border-b border-border px-4">
          {title ? (
            <h2 className="text-sm font-semibold text-foreground font-mono">{title}</h2>
          ) : (
            <span />
          )}
          {action}
        </div>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  )
}

export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center border border-dashed border-border bg-muted/30 px-6 text-center">
      <div className="text-sm font-medium text-foreground">{title}</div>
      {detail ? (
        <div className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">{detail}</div>
      ) : null}
    </div>
  )
}
