import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Bot, MessageSquare, Play } from 'lucide-react'
import { Badge } from '../components/shared/Badge'
import { Button } from '../components/shared/Button'
import { Field, Textarea } from '../components/shared/Field'
import { Panel } from '../components/shared/Panel'
import { ProviderSelect, TradeSystemVersionSelect } from '../components/shared/Selectors'
import { commands } from '../lib/commands'
import type { Agent, ChatMessage } from '../lib/types'
import { toErrorMessage } from '../lib/format'

export function AgentPage({ selectedVersionId }: { selectedVersionId?: string }) {
  const [versionId, setVersionId] = useState<string | undefined>(selectedVersionId)
  const [providerId, setProviderId] = useState<string | undefined>()
  const [agent, setAgent] = useState<Agent | null>(null)
  const [message, setMessage] = useState('请说明这套交易系统在数据不足时应该如何输出。')
  const [messages, setMessages] = useState<ChatMessage[]>([])

  const createMutation = useMutation({
    mutationFn: () => {
      const targetVersionId = versionId ?? selectedVersionId
      if (!targetVersionId) throw new Error('请先选择交易系统版本')
      return commands.createAgentFromTradeSystem(targetVersionId, providerId)
    },
    onSuccess: setAgent
  })
  const chatMutation = useMutation({
    mutationFn: () => {
      if (!agent) throw new Error('请先创建 Agent')
      const next = [...messages, { role: 'user' as const, content: message }]
      setMessages(next)
      return commands.runAgentChat(agent.id, next)
    },
    onSuccess: result => {
      setMessages(previous => [...previous, { role: 'assistant', content: result.content }])
      setMessage('')
    }
  })

  return (
    <div className="grid grid-cols-[360px_1fr] gap-4">
      <Panel
        title="Agent 编译"
        action={
          <Button
            icon={<Bot className="h-4 w-4" />}
            variant="primary"
            disabled={createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            创建 Agent
          </Button>
        }
      >
        <div className="grid gap-3">
          <TradeSystemVersionSelect value={versionId ?? selectedVersionId} onChange={setVersionId} />
          <ProviderSelect value={providerId} onChange={setProviderId} />
          {agent ? (
            <div className="grid gap-2 border border-border bg-muted/40 p-3 text-xs">
              <div className="flex items-center gap-2">
                <Badge tone="success">{agent.name}</Badge>
                <Badge>{agent.id.slice(0, 12)}</Badge>
              </div>
              <div className="text-muted-foreground">Provider: {agent.modelProviderId ?? 'active'}</div>
            </div>
          ) : null}
          {createMutation.isError ? <p className="text-xs text-danger">{toErrorMessage(createMutation.error)}</p> : null}
        </div>
      </Panel>

      <div className="grid gap-4">
        <Panel title="System Prompt 预览">
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap border border-border bg-muted/40 p-3 text-xs leading-5">
            {agent?.systemPrompt ?? '创建 Agent 后显示 system prompt。'}
          </pre>
        </Panel>

        <Panel
          title="测试问答"
          action={
            <Button
              icon={<Play className="h-4 w-4" />}
              disabled={!agent || !message || chatMutation.isPending}
              onClick={() => chatMutation.mutate()}
            >
              发送
            </Button>
          }
        >
          <Field label="消息">
            <Textarea value={message} onChange={event => setMessage(event.target.value)} />
          </Field>
          <div className="mt-3 grid gap-2">
            {messages.map((item, index) => (
              <div
                className={`border p-3 text-sm leading-6 ${
                  item.role === 'assistant' ? 'border-accent/30 bg-accent/5' : 'border-border bg-muted/40'
                }`}
                key={`${item.role}-${index}`}
              >
                <div className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <MessageSquare className="h-3.5 w-3.5" />
                  {item.role}
                </div>
                {item.content}
              </div>
            ))}
          </div>
          {chatMutation.isError ? <p className="mt-2 text-xs text-danger">{toErrorMessage(chatMutation.error)}</p> : null}
        </Panel>
      </div>
    </div>
  )
}

