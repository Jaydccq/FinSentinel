import { BASE, apiFetch } from './client'

export interface RiskFactor {
  category: string
  score: number
  description: string
}

export interface RiskReport {
  riskScore: number
  riskLevel: string
  summary: string
  factors: RiskFactor[]
  actionableAdvice: string[]
}

export interface ChatMessage {
  id: string
  sessionId: string
  role: string
  content: string
  createdAt: string
}

export interface ChatSessionSummary {
  sessionId: string
  firstMessage: string
  messageCount: number
  createdAt: string
  lastMessageAt: string
}

export const chatApi = {
  sessions: (): Promise<ChatSessionSummary[]> =>
    apiFetch('/chat/sessions'),

  assess: (message: string, portfolioId?: string, sessionId?: string): Promise<RiskReport> => {
    const params = new URLSearchParams()
    if (portfolioId) params.set('portfolioId', portfolioId)
    const qs = params.toString() ? `?${params}` : ''
    return apiFetch(`/chat/assess${qs}`, {
      method: 'POST',
      body: JSON.stringify({ message, sessionId }),
    })
  },

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

    try {
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
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
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Connection failed')
    }
  },
}
