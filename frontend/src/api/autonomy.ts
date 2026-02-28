import { apiFetch } from './client'

export interface ScheduleRequest {
  name: string
  cronExpression: string
  taskType: string
  payload?: Record<string, any>
  enabled?: boolean
}

export interface ScheduleResponse {
  id: string
  name: string
  cronExpression: string
  taskType: string
  payload: Record<string, any>
  enabled: boolean
  lastRunAt?: string
  nextRunAt?: string
  createdAt: string
  updatedAt: string
}

export interface HeartbeatConfig {
  enabled: boolean
  intervalSeconds: number
  drawdownAlertPct: number
  lastBeatAt?: string
  updatedAt?: string
}

export interface HeartbeatConfigRequest {
  enabled?: boolean
  intervalSeconds?: number
  drawdownAlertPct?: number
}

export const autonomyApi = {
  listSchedules: () =>
    apiFetch<ScheduleResponse[]>('/schedules'),

  createSchedule: (data: ScheduleRequest) =>
    apiFetch<ScheduleResponse>('/schedules', { method: 'POST', body: JSON.stringify(data) }),

  updateSchedule: (id: string, data: ScheduleRequest) =>
    apiFetch<ScheduleResponse>(`/schedules/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  pauseSchedule: (id: string) =>
    apiFetch<void>(`/schedules/${id}/pause`, { method: 'POST' }),

  resumeSchedule: (id: string) =>
    apiFetch<void>(`/schedules/${id}/resume`, { method: 'POST' }),

  deleteSchedule: (id: string) =>
    apiFetch<void>(`/schedules/${id}`, { method: 'DELETE' }),

  getHeartbeat: () =>
    apiFetch<HeartbeatConfig>('/heartbeat'),

  updateHeartbeat: (data: HeartbeatConfigRequest) =>
    apiFetch<HeartbeatConfig>('/heartbeat', { method: 'PUT', body: JSON.stringify(data) }),
}
