import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md' | 'icon'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: ReactNode
}

export function Button({
  className,
  variant = 'secondary',
  size = 'md',
  icon,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 font-medium font-mono outline-none transition-all duration-150 focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-50',
        size === 'sm' && 'h-8 px-3 text-xs',
        size === 'md' && 'h-9 px-3 text-sm',
        size === 'icon' && 'h-8 w-8 p-0',
        variant === 'primary' &&
          'bg-ring text-panel hover:shadow-glow',
        variant === 'secondary' &&
          'border border-border bg-transparent text-foreground hover:border-ring hover:shadow-glow',
        variant === 'ghost' && 'bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
        variant === 'danger' && 'bg-danger text-panel hover:shadow-glow-danger',
        className
      )}
      type={props.type ?? 'button'}
      {...props}
    >
      {icon}
      {children}
    </button>
  )
}
