import type { ReactNode } from 'react'

export function DataTable({
  columns,
  children
}: {
  columns: string[]
  children: ReactNode
}) {
  return (
    <div className="overflow-auto border border-border">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="bg-muted/70 text-xs text-muted-foreground">
          <tr>
            {columns.map(column => (
              <th className="border-b border-border px-3 py-2 font-medium" key={column}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border bg-panel">{children}</tbody>
      </table>
    </div>
  )
}

export function Td({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={`px-3 py-2 align-top ${className ?? ''}`}>{children}</td>
}

