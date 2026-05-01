import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, PlugZap, Save } from 'lucide-react'
import { Badge } from '../components/shared/Badge'
import { Button } from '../components/shared/Button'
import { DataTable, Td } from '../components/shared/DataTable'
import { Field, Input, Select } from '../components/shared/Field'
import { Panel } from '../components/shared/Panel'
import { commands } from '../lib/commands'
import type { SaveModelProviderInput } from '../lib/types'
import { toErrorMessage } from '../lib/format'

const providerDefaults: SaveModelProviderInput = {
  name: 'OpenAI',
  providerType: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4.1-mini',
  temperature: 0.2,
  maxTokens: 4096,
  enabled: true,
  isActive: true,
  extraJson: {}
}

export function SettingsPage() {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<SaveModelProviderInput>(providerDefaults)
  const [selectedProviderId, setSelectedProviderId] = useState<string>()
  const providersQuery = useQuery({
    queryKey: ['model-providers'],
    queryFn: commands.listModelProviders
  })
  const selectedProvider = providersQuery.data?.find(provider => provider.id === selectedProviderId)

  useEffect(() => {
    if (!selectedProviderId && providersQuery.data?.[0]) {
      setSelectedProviderId(providersQuery.data[0].id)
    }
  }, [providersQuery.data, selectedProviderId])

  useEffect(() => {
    if (!selectedProvider) return
    setForm({
      id: selectedProvider.id,
      name: selectedProvider.name,
      providerType: selectedProvider.providerType,
      baseUrl: selectedProvider.baseUrl,
      apiKey: '',
      apiKeyRef: selectedProvider.apiKeyRef,
      model: selectedProvider.model,
      temperature: selectedProvider.temperature,
      maxTokens: selectedProvider.maxTokens,
      enabled: selectedProvider.enabled,
      isActive: selectedProvider.isActive,
      extraJson: selectedProvider.extraJson
    })
  }, [selectedProvider])

  const saveMutation = useMutation({
    mutationFn: () => commands.saveModelProvider(form),
    onSuccess: provider => {
      setSelectedProviderId(provider.id)
      void queryClient.invalidateQueries({ queryKey: ['model-providers'] })
    }
  })
  const activeMutation = useMutation({
    mutationFn: (providerId: string) => commands.setActiveModelProvider(providerId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['model-providers'] })
  })
  const testMutation = useMutation({
    mutationFn: (providerId: string) => commands.testModelProvider(providerId)
  })

  return (
    <div className="grid grid-cols-[420px_1fr] gap-4">
      <Panel
        title="Provider 配置"
        action={
          <Button
            icon={<Save className="h-4 w-4" />}
            variant="primary"
            disabled={saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            保存
          </Button>
        }
      >
        <div className="grid gap-3">
          <Field label="名称">
            <Input value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} />
          </Field>
          <Field label="类型">
            <Select
              value={form.providerType}
              onChange={event => setForm({ ...form, providerType: event.target.value })}
            >
              <option value="openai">OpenAI / ChatGPT</option>
              <option value="deepseek">DeepSeek</option>
              <option value="openai_compatible">OpenAI-compatible</option>
            </Select>
          </Field>
          <Field label="Base URL">
            <Input value={form.baseUrl} onChange={event => setForm({ ...form, baseUrl: event.target.value })} />
          </Field>
          <Field label="API Key" hint="保存后写入本地 secrets 文件，SQLite 只保存引用。">
            <Input
              type="password"
              value={form.apiKey ?? ''}
              onChange={event => setForm({ ...form, apiKey: event.target.value })}
            />
          </Field>
          <Field label="Model">
            <Input value={form.model} onChange={event => setForm({ ...form, model: event.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Temperature">
              <Input
                type="number"
                step="0.1"
                value={form.temperature ?? 0.2}
                onChange={event => setForm({ ...form, temperature: Number(event.target.value) })}
              />
            </Field>
            <Field label="Max tokens">
              <Input
                type="number"
                value={form.maxTokens ?? 4096}
                onChange={event => setForm({ ...form, maxTokens: Number(event.target.value) })}
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              checked={Boolean(form.isActive)}
              onChange={event => setForm({ ...form, isActive: event.target.checked })}
              type="checkbox"
            />
            设为活跃 Provider
          </label>
          {saveMutation.isError ? <p className="text-xs text-danger">{toErrorMessage(saveMutation.error)}</p> : null}
        </div>
      </Panel>

      <Panel title="Provider 列表">
        <DataTable columns={['名称', '类型', '模型', '状态', '操作']}>
          {(providersQuery.data ?? []).map(provider => (
            <tr
              className="cursor-pointer hover:bg-muted/50"
              key={provider.id}
              onClick={() => setSelectedProviderId(provider.id)}
            >
              <Td>{provider.name}</Td>
              <Td>{provider.providerType}</Td>
              <Td>{provider.model}</Td>
              <Td>
                <div className="flex gap-2">
                  {provider.enabled ? <Badge tone="success">enabled</Badge> : <Badge>disabled</Badge>}
                  {provider.isActive ? <Badge tone="info">active</Badge> : null}
                </div>
              </Td>
              <Td>
                <div className="flex gap-2">
                  <Button
                    icon={<CheckCircle2 className="h-4 w-4" />}
                    size="icon"
                    variant="ghost"
                    onClick={event => {
                      event.stopPropagation()
                      activeMutation.mutate(provider.id)
                    }}
                  />
                  <Button
                    icon={<PlugZap className="h-4 w-4" />}
                    size="icon"
                    variant="ghost"
                    onClick={event => {
                      event.stopPropagation()
                      testMutation.mutate(provider.id)
                    }}
                  />
                </div>
              </Td>
            </tr>
          ))}
        </DataTable>
        {testMutation.data ? (
          <p className="mt-3 text-xs text-muted-foreground">
            测试结果：{testMutation.data.ok ? 'ok' : 'failed'} / {testMutation.data.latencyMs ?? '-'}ms /{' '}
            {testMutation.data.message}
          </p>
        ) : null}
        {testMutation.isError ? <p className="mt-3 text-xs text-danger">{toErrorMessage(testMutation.error)}</p> : null}
      </Panel>
    </div>
  )
}

