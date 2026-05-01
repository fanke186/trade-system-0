import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

export function Field({
  label,
  children,
  hint
}: {
  label: string
  children: ReactNode
  hint?: string
}) {
  return (
    <label className="grid gap-1.5 text-xs font-medium text-muted-foreground font-mono">
      <span>{label}</span>
      {children}
      {hint ? <span className="text-[11px] font-normal text-muted-foreground">{hint}</span> : null}
    </label>
  )
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-9 w-full border-0 border-b border-border bg-transparent px-0 text-sm text-foreground font-mono outline-none transition-[border-color,border-bottom-width] duration-150 placeholder:text-muted-foreground focus:border-b-2 focus:border-ring',
        className
      )}
      {...props}
    />
  )
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'min-h-24 w-full border border-border bg-muted/40 px-3 py-2 text-sm leading-6 text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:shadow-focus',
        className
      )}
      {...props}
    />
  )
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'h-9 w-full border-0 border-b border-border bg-transparent px-0 text-sm text-foreground font-mono outline-none transition-[border-color,border-bottom-width] duration-150 focus:border-b-2 focus:border-ring',
        className
      )}
      {...props}
    />
  )
}
