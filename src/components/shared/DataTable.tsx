import type { ReactNode } from 'react'

type Column =
  | string
  | {
      key: string
      label: ReactNode
      onClick?: () => void
      active?: boolean
      dir?: 'asc' | 'desc'
    }

export function DataTable({
  columns,
  children
}: {
  columns: Column[]
  children: ReactNode
}) {
  return (
    <div className="overflow-hidden border border-border">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="bg-panel text-xs text-muted-foreground">
          <tr>
            {columns.map(column => {
              const value = typeof column === 'string' ? { key: column, label: column } : column
              return (
              <th className="border-b border-border px-3 py-2 font-medium font-mono" key={value.key}>
                {value.onClick ? (
                  <button type="button" onClick={value.onClick} className="text-left transition hover:text-foreground">
                    {value.label}
                    {value.active ? ` ${value.dir === 'asc' ? '▲' : '▼'}` : ''}
                  </button>
                ) : (
                  value.label
                )}
              </th>
            )})}
          </tr>
        </thead>
        <tbody className="divide-y divide-border bg-background">{children}</tbody>
      </table>
    </div>
  )
}

export function Td({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <td className={`px-3 py-2 align-top text-foreground ${className ?? ''}`}>
      {children}
    </td>
  )
}
