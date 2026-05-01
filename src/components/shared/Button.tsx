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
        'inline-flex items-center justify-center gap-2 border font-medium outline-none transition focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-50',
        size === 'sm' && 'h-8 px-3 text-xs',
        size === 'md' && 'h-9 px-3 text-sm',
        size === 'icon' && 'h-8 w-8 p-0',
        variant === 'primary' &&
          'border-accent bg-accent text-accent-foreground hover:bg-accent/90',
        variant === 'secondary' &&
          'border-border bg-panel text-foreground hover:border-accent/40 hover:bg-muted/60',
        variant === 'ghost' && 'border-transparent bg-transparent hover:bg-muted',
        variant === 'danger' && 'border-danger bg-danger text-white hover:bg-danger/90',
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

