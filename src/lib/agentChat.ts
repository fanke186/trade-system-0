import { commands } from './commands'
import type { ChatMessage, TradeSystemRevisionInput } from './types'

export type AgentChatDraft = {
  markdown: string
  diff: string
  assistantMessage: string
  gapQuestions: string[]
}

export async function sendChatMessage({
  mode,
  name,
  history,
  currentMarkdown,
  requestId,
}: {
  mode: TradeSystemRevisionInput['mode']
  name: string
  history: ChatMessage[]
  currentMarkdown: string
  requestId?: string
}): Promise<AgentChatDraft> {
  const input = { mode, name, currentMarkdown, messages: history }
  const proposal = requestId
    ? await commands.proposeTradeSystemRevisionCancelable(requestId, input)
    : await commands.proposeTradeSystemRevision(input)
  return {
    markdown: proposal.markdown,
    diff: proposal.diff,
    assistantMessage: proposal.assistantMessage,
    gapQuestions: proposal.gapQuestions
  }
}
