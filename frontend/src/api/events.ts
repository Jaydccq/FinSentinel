import { apiFetch } from './client'

export interface AgentEvent {
  id: string
  seqNo: number
  aggregateType: string
  aggregateId?: string
  eventType: string
  payload: Record<string, any>
  createdAt: string
}

export const eventsApi = {
  list: (afterSeq?: number, limit = 50) => {
    const params = new URLSearchParams()
    if (afterSeq !== undefined) params.set('afterSeq', String(afterSeq))
    params.set('limit', String(limit))
    return apiFetch<AgentEvent[]>(`/events?${params.toString()}`)
  },
}
