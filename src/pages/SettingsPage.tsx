import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, KeyRound, PlugZap, Plus, Save, Server, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import { Badge } from '../components/shared/Badge'
import { Button } from '../components/shared/Button'
import { Field, Input, Select } from '../components/shared/Field'
import { Panel } from '../components/shared/Panel'
import { commands } from '../lib/commands'
import type { ModelProvider, SaveModelProviderInput } from '../lib/types'
import { toErrorMessage } from '../lib/format'
import { cn } from '../lib/cn'

const deepSeekExtraJson = {
  requestOverrides: {
    thinking: { type: 'enabled' },
    reasoning_effort: 'high'
  }
}

const providerPresets: Array<{
  id: string
  label: string
  detail: string
  tags: string[]
  input: SaveModelProviderInput
}> = [
  {
    id: 'deepseek-pro',
    label: 'DeepSeek Pro',
    detail: 'OpenAI-compatible · quality first',
    tags: ['JSON', '1M context', 'thinking'],
    input: {
      name: 'DeepSeek Pro',
      providerType: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      apiKey: '',
      model: 'deepseek-v4-pro',
      temperature: 0.2,
      maxTokens: 8192,
      enabled: true,
      isActive: true,
      extraJson: deepSeekExtraJson
    }
  },
  {
    id: 'deepseek-flash',
    label: 'DeepSeek Flash',
    detail: 'OpenAI-compatible · faster scoring',
    tags: ['JSON', 'low cost'],
    input: {
      name: 'DeepSeek Flash',
      providerType: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      apiKey: '',
      model: 'deepseek-v4-flash',
      temperature: 0.2,
      maxTokens: 8192,
      enabled: true,
      isActive: false,
      extraJson: { requestOverrides: { thinking: { type: 'disabled' } } }
    }
  },
  {
    id: 'openai-compatible',
    label: 'OpenAI Compatible',
    detail: 'Custom chat completions endpoint',
    tags: ['custom', 'base url'],
    input: {
      name: 'Custom Provider',
      providerType: 'openai_compatible',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-4.1-mini',
      temperature: 0.2,
      maxTokens: 4096,
      enabled: true,
      isActive: false,
      extraJson: {}
    }
  }
]

const providerDefaults = providerPresets[0].input

export function SettingsPage() {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<SaveModelProviderInput>(providerDefaults)
  const [selectedProviderId, setSelectedProviderId] = useState<string>()
  const [selectedPresetId, setSelectedPresetId] = useState('deepseek-pro')

  const providersQuery = useQuery({
    queryKey: ['model-providers'],
    queryFn: commands.listModelProviders
  })
  const providers = providersQuery.data ?? []
  const selectedProvider = providers.find(provider => provider.id === selectedProviderId)
  const activeProvider = providers.find(provider => provider.isActive)
  const activePreset = useMemo(
    () => providerPresets.find(preset => preset.id === selectedPresetId) ?? providerPresets[0],
    [selectedPresetId]
  )

  useEffect(() => {
    if (!selectedProviderId && providers[0]) {
      setSelectedProviderId(providers[0].id)
    }
  }, [providers, selectedProviderId])

  useEffect(() => {
    if (!selectedProvider) return
    setForm({
      id: selectedProvider.id,
      name: selectedProvider.name,
      providerType: selectedProvider.providerType,
      baseUrl: selectedProvider.baseUrl,
      apiKey: '',
      apiKeyRef: selectedProvider.apiKeyRef.startsWith('env:') ? '' : selectedProvider.apiKeyRef,
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
    onSuccess: provider => {
      setSelectedProviderId(provider.id)
      void queryClient.invalidateQueries({ queryKey: ['model-providers'] })
    }
  })
  const testMutation = useMutation({
    mutationFn: (providerId: string) => commands.testModelProvider(providerId)
  })

  const applyPreset = (presetId: string) => {
    const preset = providerPresets.find(item => item.id === presetId) ?? providerPresets[0]
    setSelectedPresetId(preset.id)
    setSelectedProviderId(undefined)
    setForm({ ...preset.input, id: undefined })
  }

  const updateProviderType = (providerType: string) => {
    if (providerType === 'deepseek') {
      setForm({
        ...providerPresets[0].input,
        id: form.id,
        name: form.name || providerPresets[0].input.name,
        apiKey: form.apiKey,
        apiKeyRef: form.apiKeyRef
      })
      return
    }
    setForm({ ...form, providerType })
  }

  return (
    <div className="grid min-h-full grid-cols-[360px_minmax(0,1fr)] gap-4">
      <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-4">
        <Panel
          title="Provider Presets"
          action={
            <Button icon={<Plus className="h-4 w-4" />} size="sm" onClick={() => applyPreset(activePreset.id)}>
              新建
            </Button>
          }
        >
          <div className="grid gap-2">
            {providerPresets.map(preset => (
              <button
                className={cn(
                  'border p-3 text-left transition hover:border-ring hover:bg-muted/35',
                  selectedPresetId === preset.id ? 'border-ring bg-ring/10' : 'border-border bg-background/45'
                )}
                key={preset.id}
                onClick={() => applyPreset(preset.id)}
                type="button"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="font-mono text-sm font-semibold">{preset.label}</div>
                  <Server className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{preset.detail}</div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {preset.tags.map(tag => (
                    <Badge key={tag} tone={tag === 'thinking' ? 'extra' : 'info'}>
                      {tag}
                    </Badge>
                  ))}
                </div>
              </button>
            ))}
          </div>
        </Panel>

        <Panel
          title="Provider Connections"
          action={<Badge tone={activeProvider ? 'success' : 'warning'}>{activeProvider?.name ?? '未配置'}</Badge>}
          className="min-h-0"
        >
          <div className="grid max-h-[calc(100vh-368px)] gap-2 overflow-auto pr-1">
            {providers.map(provider => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                selected={provider.id === selectedProviderId}
                onSelect={() => setSelectedProviderId(provider.id)}
                onActivate={() => activeMutation.mutate(provider.id)}
                onTest={() => testMutation.mutate(provider.id)}
              />
            ))}
            {providers.length === 0 ? (
              <div className="border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                暂无连接
              </div>
            ) : null}
          </div>
        </Panel>
      </section>

      <Panel
        title="Connection Config"
        action={
          <div className="flex items-center gap-2">
            {form.id ? (
              <Button
                icon={<PlugZap className="h-4 w-4" />}
                onClick={() => testMutation.mutate(form.id!)}
                disabled={testMutation.isPending}
              >
                测试
              </Button>
            ) : null}
            <Button
              icon={<Save className="h-4 w-4" />}
              variant="primary"
              disabled={saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              保存
            </Button>
          </div>
        }
      >
        <div className="grid gap-6">
          <section>
            <div className="mb-3 flex items-center gap-2 font-mono text-xs text-muted-foreground">
              <KeyRound className="h-4 w-4" />
              基础连接
            </div>
            <div className="grid gap-4">
              <div className="grid grid-cols-[1fr_220px] gap-4">
                <Field label="名称">
                  <Input value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} />
                </Field>
                <Field label="类型">
                  <Select value={form.providerType} onChange={event => updateProviderType(event.target.value)}>
                    <option value="deepseek">DeepSeek</option>
                    <option value="openai">OpenAI / ChatGPT</option>
                    <option value="openai_compatible">OpenAI-compatible</option>
                  </Select>
                </Field>
              </div>
              <Field label="Base URL">
                <Input value={form.baseUrl} onChange={event => setForm({ ...form, baseUrl: event.target.value })} />
              </Field>
              <div className="grid gap-4">
                <Field label="API Key">
                  <Input
                    type="password"
                    value={form.apiKey ?? ''}
                    placeholder={form.apiKeyRef?.startsWith('local:') ? '已保存到本地 secrets；重新输入可替换' : '输入后保存到本地 secrets'}
                    onChange={event => setForm({ ...form, apiKey: event.target.value })}
                  />
                </Field>
              </div>
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-center gap-2 font-mono text-xs text-muted-foreground">
              <SlidersHorizontal className="h-4 w-4" />
              调用参数
            </div>
            <div className="grid gap-4">
              <Field label="Model">
                <Input value={form.model} onChange={event => setForm({ ...form, model: event.target.value })} />
              </Field>
              <div className="grid grid-cols-3 gap-4">
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
                <Field label="Reasoning">
                  <Select
                    value={reasoningEffort(form.extraJson)}
                    onChange={event =>
                      setForm({
                        ...form,
                        extraJson: withReasoningEffort(form.extraJson, event.target.value)
                      })
                    }
                  >
                    <option value="">default</option>
                    <option value="high">high</option>
                    <option value="max">max</option>
                  </Select>
                </Field>
              </div>
              <div className="flex flex-wrap gap-4 border border-border bg-background/40 p-3">
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input
                    checked={Boolean(form.enabled ?? true)}
                    onChange={event => setForm({ ...form, enabled: event.target.checked })}
                    type="checkbox"
                  />
                  enabled
                </label>
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input
                    checked={Boolean(form.isActive)}
                    onChange={event => setForm({ ...form, isActive: event.target.checked })}
                    type="checkbox"
                  />
                  active
                </label>
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input
                    checked={thinkingEnabled(form.extraJson)}
                    onChange={event =>
                      setForm({
                        ...form,
                        extraJson: withThinking(form.extraJson, event.target.checked)
                      })
                    }
                    type="checkbox"
                  />
                  thinking
                </label>
              </div>
            </div>
          </section>

          <section className="border border-border bg-background/40 p-4">
            <div className="mb-2 flex items-center gap-2 font-mono text-xs text-muted-foreground">
              <ShieldCheck className="h-4 w-4" />
              状态
            </div>
            <div className="grid gap-2 text-xs leading-5 text-muted-foreground">
              <div>当前选中：{selectedProvider?.name ?? '新连接'}</div>
              <div>Key 来源：{form.apiKey || form.apiKeyRef?.startsWith('local:') ? '本地 secrets' : '未保存'}</div>
              {testMutation.data ? (
                <div className={testMutation.data.ok ? 'text-success' : 'text-danger'}>
                  测试结果：{testMutation.data.ok ? 'ok' : 'failed'} / {testMutation.data.latencyMs ?? '-'}ms /{' '}
                  {testMutation.data.message}
                </div>
              ) : null}
              {saveMutation.isError ? <div className="text-danger">{toErrorMessage(saveMutation.error)}</div> : null}
              {testMutation.isError ? <div className="text-danger">{toErrorMessage(testMutation.error)}</div> : null}
            </div>
          </section>
        </div>
      </Panel>
    </div>
  )
}

function ProviderCard({
  provider,
  selected,
  onSelect,
  onActivate,
  onTest
}: {
  provider: ModelProvider
  selected: boolean
  onSelect: () => void
  onActivate: () => void
  onTest: () => void
}) {
  return (
    <div
      className={cn(
        'border p-3 text-left transition hover:border-ring hover:bg-muted/35',
        selected ? 'border-ring bg-ring/10' : 'border-border bg-background/45'
      )}
      onClick={onSelect}
      onKeyDown={event => {
        if (event.key === 'Enter') onSelect()
      }}
      role="button"
      tabIndex={0}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-mono text-sm font-semibold">{provider.name}</div>
          <div className="mt-1 truncate text-xs text-muted-foreground">{provider.model}</div>
        </div>
        <div className="flex shrink-0 gap-1">
          {provider.isActive ? <Badge tone="info">active</Badge> : null}
          {provider.enabled ? <Badge tone="success">on</Badge> : <Badge>off</Badge>}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="truncate text-xs text-muted-foreground">{provider.providerType}</div>
        <div className="flex gap-1">
          <button
            className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground transition hover:bg-muted hover:text-foreground"
            onClick={event => {
              event.stopPropagation()
              onActivate()
            }}
            type="button"
          >
            <CheckCircle2 className="h-4 w-4" />
          </button>
          <button
            className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground transition hover:bg-muted hover:text-foreground"
            onClick={event => {
              event.stopPropagation()
              onTest()
            }}
            type="button"
          >
            <PlugZap className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

function requestOverrides(extraJson: Record<string, unknown> | undefined) {
  const overrides = extraJson?.requestOverrides
  return typeof overrides === 'object' && overrides !== null ? (overrides as Record<string, unknown>) : {}
}

function thinkingEnabled(extraJson: Record<string, unknown> | undefined) {
  const thinking = requestOverrides(extraJson).thinking
  return typeof thinking === 'object' && thinking !== null
    ? (thinking as Record<string, unknown>).type !== 'disabled'
    : false
}

function reasoningEffort(extraJson: Record<string, unknown> | undefined) {
  const value = requestOverrides(extraJson).reasoning_effort
  return typeof value === 'string' ? value : ''
}

function withThinking(extraJson: Record<string, unknown> | undefined, enabled: boolean) {
  return {
    ...(extraJson ?? {}),
    requestOverrides: {
      ...requestOverrides(extraJson),
      thinking: { type: enabled ? 'enabled' : 'disabled' }
    }
  }
}

function withReasoningEffort(extraJson: Record<string, unknown> | undefined, value: string) {
  const overrides = { ...requestOverrides(extraJson) }
  if (value) {
    overrides.reasoning_effort = value
  } else {
    delete overrides.reasoning_effort
  }
  return {
    ...(extraJson ?? {}),
    requestOverrides: overrides
  }
}
