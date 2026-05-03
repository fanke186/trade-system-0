import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Bot, Check, CircleStop, Loader2, Send, Sparkles, User, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '../shared/Button'
import { Field, Input } from '../shared/Field'
import { Badge } from '../shared/Badge'
import { ProviderTag } from '../shared/ProviderTag'
import { commands } from '../../lib/commands'
import { sendChatMessage } from '../../lib/agentChat'
import { toErrorMessage } from '../../lib/format'
import type { ChatMessage, TradeSystemDetail, TradeSystemSummary, TradeSystemVersion } from '../../lib/types'

type EditorTarget =
  | { mode: 'create'; name: string }
  | { mode: 'edit'; system: TradeSystemSummary }

type AssistantDraft = {
  messageIndex: number
  markdown: string
}

export function AgentEditWindow({
  target,
  detail,
  onClose,
  onPublished,
  onNavigateToSettings,
}: {
  target: EditorTarget | null
  detail?: TradeSystemDetail
  onClose: () => void
  onPublished: (version: TradeSystemVersion) => void
  onNavigateToSettings?: () => void
}) {
  const open = Boolean(target)
  const isCreate = target?.mode === 'create'
  const [name, setName] = useState('')
  const [markdown, setMarkdown] = useState('')
  const [changeSummary, setChangeSummary] = useState('')
  const [userMessage, setUserMessage] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [assistantDraft, setAssistantDraft] = useState<AssistantDraft | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!target) return
    if (target.mode === 'create') {
      setName(target.name)
      setMarkdown(starterMarkdown(target.name))
      setChangeSummary('创建交易系统 Agent')
      setMessages([
        {
          role: 'assistant',
          content: '已创建 V1 草案。可以直接描述你的交易风格、风险约束或评分偏好，我会按模板补齐缺口并给出可确认的 Markdown 修订。'
        }
      ])
      return
    }
    setName(target.system.name)
    setMarkdown('')
    setChangeSummary('')
    setMessages([
      {
        role: 'assistant',
        content: `正在编辑 ${target.system.name} V${target.system.activeVersion ?? 1}。发布后会自动生成新版本。`
      }
    ])
  }, [target])

  useEffect(() => {
    if (!target || target.mode !== 'edit' || !detail) return
    const active =
      detail.versions.find(version => version.id === detail.activeVersionId) ?? detail.versions[0]
    setMarkdown(detail.systemMd || active?.markdown || starterMarkdown(detail.name))
  }, [detail, target])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

  const completenessQuery = useQuery({
    queryKey: ['trade-agent-completeness', markdown],
    queryFn: () => commands.checkTradeSystemCompleteness(markdown),
    enabled: open && markdown.trim().length > 0
  })

  const publishMutation = useMutation({
    mutationFn: () => {
      if (!target) throw new Error('编辑窗口未打开')
      if (!name.trim()) throw new Error('交易系统名称不能为空')
      const nextVersion =
        target.mode === 'edit' ? `V${(target.system.activeVersion ?? 1) + 1}` : 'V1'
      const ok = window.confirm(`将发布 ${name} ${nextVersion}，确认？`)
      if (!ok) throw new Error('已取消发布')
      return commands.saveTradeSystemVersion(
        target.mode === 'edit' ? target.system.id : null,
        name.trim(),
        markdown,
        changeSummary || undefined
      )
    },
    onSuccess: version => {
      onPublished(version)
      onClose()
    }
  })

  const requestIdRef = useRef<string | null>(null)

  const chatMutation = useMutation({
    mutationFn: async () => {
      if (!target) throw new Error('编辑窗口未打开')
      const content = userMessage.trim()
      if (!content) throw new Error('请输入修改需求')
      const nextMessages = [...messages, { role: 'user' as const, content }]
      setMessages(nextMessages)
      setUserMessage('')
      const rid = crypto.randomUUID()
      requestIdRef.current = rid
      return sendChatMessage({
        mode: target.mode,
        name,
        history: nextMessages,
        currentMarkdown: markdown,
        requestId: rid,
      })
    },
    onSuccess: draft => {
      const questions = draft.gapQuestions.length > 0 ? `\n\n待确认：\n${draft.gapQuestions.map(item => `- ${item}`).join('\n')}` : ''
      const diff = draft.diff ? `\n\n变更：${draft.diff}` : ''
      setMessages(previous => {
        const next = [
          ...previous,
          { role: 'assistant' as const, content: `${draft.assistantMessage}${diff}${questions}` }
        ]
        setAssistantDraft({ messageIndex: next.length - 1, markdown: draft.markdown })
        return next
      })
    },
    onError: error => {
      const msg = toErrorMessage(error)
      setMessages(previous => [
        ...previous,
        { role: 'assistant', content: msg.includes('cancelled') || msg.includes('中断') ? '已中断本次请求。' : `调用失败：${msg}` }
      ])
    }
  })

  const handleCancel = () => {
    const rid = requestIdRef.current
    if (rid) {
      commands.cancelLlmRequest(rid).catch(() => {})
      requestIdRef.current = null
    }
    chatMutation.reset()
  }

  const isRunning = chatMutation.isPending
  const status = completenessQuery.data

  if (!open || !target) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/70 p-5">
      <div className="mx-auto grid h-full max-w-[1540px] grid-rows-[64px_minmax(0,1fr)] overflow-hidden border border-border bg-panel shadow-[0_0_70px_rgba(0,0,0,0.55)]">
        <div className="flex shrink-0 items-center justify-between border-b border-border bg-background/40 px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center bg-ring text-panel">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="truncate font-mono text-base font-semibold">
                  {isCreate ? '新建交易系统 Agent' : '编辑交易系统 Agent'}
                </div>
                <Badge tone={status?.canScore ? 'success' : 'warning'}>{status?.status ?? 'draft'}</Badge>
              </div>
              <div className="mt-1 truncate text-xs text-muted-foreground">
                {isCreate ? '初始版本 V1' : `当前版本 V${target.mode === 'edit' ? target.system.activeVersion ?? 1 : 1}`}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button icon={<Check className="h-4 w-4" />} onClick={() => publishMutation.mutate()} variant="primary">
              发布
            </Button>
            <button
              aria-label="关闭"
              className="flex h-9 w-9 items-center justify-center border border-danger/50 bg-danger/10 text-danger transition hover:bg-danger hover:text-panel focus-visible:shadow-focus"
              onClick={onClose}
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="grid min-h-0 grid-cols-[minmax(420px,48%)_minmax(420px,1fr)]">
          <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border-r border-border bg-background">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <div>
                <div className="font-mono text-sm font-semibold">Markdown 预览</div>
                <div className="mt-1 text-xs text-muted-foreground">{name || '未命名交易系统'}</div>
              </div>
              {assistantDraft ? <Badge tone="info">有待确认修订</Badge> : null}
            </div>
            <div className="min-h-0 overflow-auto p-6">
              <div className="trade-agent-markdown max-w-3xl">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown || ' '}</ReactMarkdown>
              </div>
            </div>
          </section>

          <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] bg-panel">
            <div className="grid grid-cols-[240px_1fr] gap-4 border-b border-border p-4">
              <Field label="名称">
                <Input disabled={!isCreate} value={name} onChange={event => setName(event.target.value)} />
              </Field>
              <Field label="变更摘要">
                <Input value={changeSummary} onChange={event => setChangeSummary(event.target.value)} />
              </Field>
            </div>

            <div className="min-h-0 overflow-auto p-5">
              <div className="mx-auto grid max-w-3xl gap-3">
                {messages.map((message, index) => (
                  <div className={message.role === 'assistant' ? 'mr-10' : 'ml-14'} key={`${message.role}-${index}`}>
                    <div
                      className={
                        message.role === 'assistant'
                          ? 'border border-ring/25 bg-ring/10 p-4'
                          : 'border border-border bg-background/70 p-4'
                      }
                    >
                      <div className="mb-2 flex items-center gap-2 font-mono text-[11px] uppercase text-muted-foreground">
                        {message.role === 'assistant' ? <Bot className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
                        {message.role === 'assistant' ? 'Agent' : 'You'}
                      </div>
                      <div className="whitespace-pre-wrap text-sm leading-6">{message.content}</div>
                    </div>
                    {assistantDraft?.messageIndex === index ? (
                      <div className="mt-2 flex gap-2">
                        <Button
                          onClick={() => {
                            setMarkdown(assistantDraft.markdown)
                            setAssistantDraft(null)
                          }}
                          size="sm"
                          variant="primary"
                        >
                          接受
                        </Button>
                        <Button onClick={() => setAssistantDraft(null)} size="sm">
                          拒绝
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ))}
                {chatMutation.isPending ? (
                  <div className="mr-10 border border-ring/25 bg-ring/10 p-4 text-sm text-muted-foreground">
                    <div className="mb-2 flex items-center gap-2 font-mono text-[11px] uppercase">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Agent
                    </div>
                    <div className="grid gap-1.5">
                      <div>正在连接当前 Provider...</div>
                      <div>正在分析交易系统缺口并生成修订建议...</div>
                    </div>
                  </div>
                ) : null}
                <div ref={messagesEndRef} />
              </div>
            </div>

            <div className="border-t border-border bg-background/35 p-4">
              <div className="mb-2">
                <ProviderTag onSettingsClick={onNavigateToSettings} />
              </div>
              <div className="grid grid-cols-[1fr_auto] gap-3">
                <Input
                  disabled={isRunning}
                  placeholder={isRunning ? 'AI 正在回复...' : '输入你希望交易系统如何演进...'}
                  value={userMessage}
                  onChange={event => setUserMessage(event.target.value)}
                  onKeyDown={event => {
                    if (isRunning) return
                    if (event.key === 'Enter' && !event.nativeEvent.isComposing) chatMutation.mutate()
                  }}
                />
                <Button
                  disabled={!isRunning && !userMessage.trim()}
                  icon={isRunning ? <CircleStop className="h-4 w-4" /> : <Send className="h-4 w-4" />}
                  onClick={() => {
                    if (isRunning) handleCancel()
                    else chatMutation.mutate()
                  }}
                >
                  {isRunning ? '中断' : '发送'}
                </Button>
              </div>
            </div>
          </section>
        </div>

      </div>
    </div>
  )
}

function starterMarkdown(name: string) {
  const today = new Date().toISOString().slice(0, 10)
  return `# ${name}

## 1. 系统定位与适用边界

- system_name：${name}
- version：V1
- created_date：${today}
- last_updated：${today}
- 市场与标的：
- 主周期与风格：
- 明确不做：

## 2. 目标、约束与风险预算

- 单笔最大亏损：
- 最大回撤容忍：
- 杠杆上限：
- 约束优先级：

## 3. 市场哲学与机会假设

- 主机会假设：
- 有效市场状态：
- 失效市场状态：
- 风格冲突规则：

## 4. 数据、能力与证据标准

- 必须 K 线周期：日K、周K、月K
- 必须字段：open、high、low、close、volume、amount、turnover、change_pct
- 当前不可用数据：
- 证据等级：

## 5. 术语表与规则语言

| 术语 | 定义 | 判定流程 | 数据来源 | 反例 |
|------|------|----------|----------|------|
| 趋势 |  |  |  |  |
| 突破 |  |  |  |  |
| 回踩 |  |  |  |  |

## 6. 市场状态识别

- 多头状态：
- 震荡状态：
- 空头状态：
- 极端状态：

## 7. 分析模块

- 趋势结构：
- 量价配合：
- 多周期一致性：
- 风险边界：

## 8. 入选条件

- 进入观察池：
- 一票否决：
- 数据不足处理：

## 9. 评分规则

- 趋势结构 35 分：
- 量价配合 25 分：
- 多周期一致性 25 分：
- 风险边界 15 分：
- 评分输出为 0-100 分。

## 10. 交易计划规则

- 观察：
- 入场：
- 仓位：
- 止损：
- 止盈：
- 不交易：

## 11. 风险与组合控制

- 单笔风险：
- 同方向暴露：
- 熔断规则：

## 12. 执行规则

- 成交失败：
- 滑点：
- 调仓：

## 13. 复盘输出格式

Agent 必须输出 JSON，包含 score、rating、overall_evaluation、core_reasons、evidence、trade_plan、chart_annotations、uncertainty。
`
}
