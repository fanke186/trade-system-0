import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Check, Send, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '../shared/Button'
import { Field, Input, Textarea } from '../shared/Field'
import { Badge } from '../shared/Badge'
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
  onPublished
}: {
  target: EditorTarget | null
  detail?: TradeSystemDetail
  onClose: () => void
  onPublished: (version: TradeSystemVersion) => void
}) {
  const open = Boolean(target)
  const isCreate = target?.mode === 'create'
  const [name, setName] = useState('')
  const [markdown, setMarkdown] = useState('')
  const [changeSummary, setChangeSummary] = useState('')
  const [userMessage, setUserMessage] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [assistantDraft, setAssistantDraft] = useState<AssistantDraft | null>(null)

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

  const chatMutation = useMutation({
    mutationFn: async () => {
      if (!target) throw new Error('编辑窗口未打开')
      const content = userMessage.trim()
      if (!content) throw new Error('请输入修改需求')
      const nextMessages = [...messages, { role: 'user' as const, content }]
      setMessages(nextMessages)
      setUserMessage('')
      return sendChatMessage({
        mode: target.mode,
        name,
        history: nextMessages,
        currentMarkdown: markdown
      })
    },
    onSuccess: draft => {
      const messageIndex = messages.length + 1
      const questions = draft.gapQuestions.length > 0 ? `\n\n待确认：\n${draft.gapQuestions.map(item => `- ${item}`).join('\n')}` : ''
      const diff = draft.diff ? `\n\n变更：${draft.diff}` : ''
      setMessages(previous => [
        ...previous,
        { role: 'assistant', content: `${draft.assistantMessage}${diff}${questions}` }
      ])
      setAssistantDraft({ messageIndex, markdown: draft.markdown })
    }
  })

  const status = completenessQuery.data

  if (!open || !target) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/70 p-6">
      <div className="mx-auto flex h-full max-w-7xl flex-col border border-border bg-panel shadow-[0_0_60px_rgba(0,0,0,0.45)]">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="truncate font-mono text-sm font-semibold">
                {isCreate ? '新建交易系统 Agent' : '编辑交易系统 Agent'}
              </div>
              <Badge tone={status?.canScore ? 'success' : 'warning'}>{status?.status ?? 'draft'}</Badge>
            </div>
            <div className="mt-1 truncate text-xs text-muted-foreground">
              {isCreate ? '初始版本 V1' : `当前版本 V${target.mode === 'edit' ? target.system.activeVersion ?? 1 : 1}`}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button icon={<Check className="h-4 w-4" />} onClick={() => publishMutation.mutate()} variant="primary">
              发布
            </Button>
            <Button aria-label="关闭" icon={<X className="h-4 w-4" />} onClick={onClose} size="icon" variant="ghost" />
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(360px,42%)_1fr]">
          <section className="min-h-0 overflow-auto border-r border-border bg-background p-5">
            <div className="trade-agent-markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown || ' '}</ReactMarkdown>
            </div>
          </section>

          <section className="grid min-h-0 grid-rows-[auto_minmax(160px,1fr)_minmax(220px,34%)_auto]">
            <div className="grid grid-cols-[220px_1fr] gap-3 border-b border-border p-4">
              <Field label="名称">
                <Input disabled={!isCreate} value={name} onChange={event => setName(event.target.value)} />
              </Field>
              <Field label="变更摘要">
                <Input value={changeSummary} onChange={event => setChangeSummary(event.target.value)} />
              </Field>
            </div>

            <div className="min-h-0 overflow-auto border-b border-border p-4">
              <div className="grid gap-3">
                {messages.map((message, index) => (
                  <div
                    className={
                      message.role === 'assistant'
                        ? 'border border-ring/30 bg-ring/10 p-3'
                        : 'ml-10 border border-border bg-background/70 p-3'
                    }
                    key={`${message.role}-${index}`}
                  >
                    <div className="mb-1 font-mono text-[11px] uppercase text-muted-foreground">{message.role}</div>
                    <div className="whitespace-pre-wrap text-sm leading-6">{message.content}</div>
                    {assistantDraft?.messageIndex === index ? (
                      <div className="mt-3 flex gap-2">
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
                  <div className="border border-border bg-background/70 p-3 text-sm text-muted-foreground">
                    Agent 正在生成修改建议...
                  </div>
                ) : null}
              </div>
            </div>

            <div className="min-h-0 border-b border-border p-4">
              <Textarea
                className="h-full min-h-0 font-mono text-xs leading-5"
                value={markdown}
                onChange={event => setMarkdown(event.target.value)}
              />
            </div>

            <div className="grid grid-cols-[1fr_auto] gap-3 p-4">
              <Input
                placeholder="输入你希望交易系统如何演进..."
                value={userMessage}
                onChange={event => setUserMessage(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') chatMutation.mutate()
                }}
              />
              <Button
                disabled={chatMutation.isPending || !userMessage.trim()}
                icon={<Send className="h-4 w-4" />}
                onClick={() => chatMutation.mutate()}
              >
                发送
              </Button>
            </div>
          </section>
        </div>

        {publishMutation.isError || chatMutation.isError ? (
          <div className="border-t border-border px-4 py-2 text-xs text-danger">
            {toErrorMessage(publishMutation.error || chatMutation.error)}
          </div>
        ) : null}
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
