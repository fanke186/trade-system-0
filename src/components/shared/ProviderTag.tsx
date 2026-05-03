import { useQuery } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { commands } from '../../lib/commands'
import { Badge } from '../shared/Badge'

type ProviderTagProps = {
  compact?: boolean
  onSettingsClick?: () => void
}

export function ProviderTag({ compact, onSettingsClick }: ProviderTagProps) {
  const query = useQuery({
    queryKey: ['model-providers'],
    queryFn: commands.listModelProviders,
    staleTime: 30_000,
  })
  const active = query.data?.find(p => p.isActive)

  if (compact) {
    return (
      <div className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground">
        <Badge tone={active ? 'info' : 'warning'}>
          {active ? `${active.model}` : '未配置'}
        </Badge>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground">
      <span>当前 Provider</span>
      <Badge tone={active ? 'info' : 'warning'}>
        {active ? `${active.name} / ${active.model}` : '未配置'}
      </Badge>
      {active?.maxTokens ? (
        <span className="text-[10px]">{active.maxTokens} tokens</span>
      ) : null}
      {onSettingsClick ? (
        <button
          type="button"
          onClick={onSettingsClick}
          className="inline-flex items-center gap-1 text-[10px] text-ring transition hover:text-foreground"
        >
          <ExternalLink className="h-3 w-3" />
          设置
        </button>
      ) : null}
    </div>
  )
}
