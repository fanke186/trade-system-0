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
  currentMarkdown
}: {
  mode: TradeSystemRevisionInput['mode']
  name: string
  history: ChatMessage[]
  currentMarkdown: string
}): Promise<AgentChatDraft> {
  const proposal = await commands.proposeTradeSystemRevision({
    mode,
    name,
    currentMarkdown,
    messages: history
  })
  return {
    markdown: proposal.markdown,
    diff: proposal.diff,
    assistantMessage: proposal.assistantMessage,
    gapQuestions: proposal.gapQuestions
  }
}
