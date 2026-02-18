import { BASE, authHeaders } from './client'
import { apiFetch } from './client'

export interface RiskFactor {
  category: string
  score: number
  description: string
}

export interface ComplianceNote {
  disclaimer: string
  regulatoryFramework: string
  isCompliant: boolean
}

export interface RiskReport {
  riskScore: number
  riskLevel: string
  summary: string
  factors: RiskFactor[]
  actionableAdvice: string[]
  complianceNote: ComplianceNote
}

export interface ChatMessage {
  id: string
  sessionId: string
  role: string
  content: string
  createdAt: string
}

export const chatApi = {
  assess: (message: string, portfolioId?: string, sessionId?: string): Promise<RiskReport> =>
    apiFetch('/chat/assess', {
      method: 'POST',
      body: JSON.stringify({ message, sessionId, portfolioId }),
    }),

  history: (sessionId: string): Promise<ChatMessage[]> =>
    apiFetch(`/chat/sessions/${sessionId}`),

  stream: async (
    message: string,
    portfolioId: string | undefined,
    sessionId: string | undefined,
    onChunk: (text: string, sessionId: string) => void,
    onDone: () => void,
    onError: (err: string) => void
  ): Promise<void> => {
    const url = portfolioId
      ? `${BASE}/chat/stream?portfolioId=${portfolioId}`
      : `${BASE}/chat/stream`

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...authHeaders(),
      },
      body: JSON.stringify({ message, sessionId }),
    })

    if (!res.ok) {
      onError(`HTTP ${res.status}`)
      return
    }

    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      let eventName = ''
      for (const line of lines) {
        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim()
        } else if (line.startsWith('data:')) {
          const data = line.slice(5).trim()
          if (eventName === 'done') {
            onDone()
          } else if (eventName === 'error') {
            try { onError(JSON.parse(data).message) } catch { onError(data) }
          } else if (eventName === 'message') {
            try {
              const parsed = JSON.parse(data)
              onChunk(parsed.content ?? '', parsed.sessionId ?? '')
            } catch { /* ignore malformed */ }
          }
        } else if (line === '') {
          eventName = ''
        }
      }
    }
  },
}
