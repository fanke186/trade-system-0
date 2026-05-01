import { useQuery } from '@tanstack/react-query'
import { commands } from '../../lib/commands'
import { Field, Select } from './Field'

export function TradeSystemVersionSelect({
  value,
  onChange
}: {
  value?: string
  onChange: (versionId: string | undefined) => void
}) {
  const query = useQuery({ queryKey: ['trade-systems'], queryFn: commands.listTradeSystems })
  return (
    <Field label="交易系统版本">
      <Select value={value ?? ''} onChange={event => onChange(event.target.value || undefined)}>
        <option value="">未选择</option>
        {(query.data ?? []).map(system => (
          <option key={system.id} value={system.activeVersionId ?? ''}>
            {system.name} v{system.activeVersion ?? '-'} {system.completenessStatus ?? ''}
          </option>
        ))}
      </Select>
    </Field>
  )
}

export function ProviderSelect({
  value,
  onChange,
  allowEmpty = true
}: {
  value?: string
  onChange: (providerId: string | undefined) => void
  allowEmpty?: boolean
}) {
  const query = useQuery({ queryKey: ['model-providers'], queryFn: commands.listModelProviders })
  return (
    <Field label="模型 Provider">
      <Select value={value ?? ''} onChange={event => onChange(event.target.value || undefined)}>
        {allowEmpty ? <option value="">使用活跃 Provider</option> : null}
        {(query.data ?? []).map(provider => (
          <option key={provider.id} value={provider.id}>
            {provider.name} / {provider.model}
          </option>
        ))}
      </Select>
    </Field>
  )
}

