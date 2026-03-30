'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import {
  Plus, Trash2, Play, Pause, Pencil, ChevronDown,
  Clock, Heart, Activity, CalendarClock,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  autonomyApi,
  type ScheduleResponse,
  type ScheduleRequest,
  type HeartbeatConfig,
  type HeartbeatConfigRequest,
} from '../api/autonomy'
import { eventsApi, type AgentEvent } from '../api/events'
import EmptyState from '../components/EmptyState'

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function describeCron(expr: string): string {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return expr

  const [min, hour, , , dow] = parts

  // "0 */N * * *" → "Every N hours"
  if (hour.startsWith('*/')) {
    const n = hour.slice(2)
    return `Every ${n} hour${n === '1' ? '' : 's'}`
  }

  // "*/N * * * *" → "Every N minutes"
  if (min.startsWith('*/')) {
    const n = min.slice(2)
    return `Every ${n} minute${n === '1' ? '' : 's'}`
  }

  // Fixed time
  if (/^\d+$/.test(hour) && /^\d+$/.test(min)) {
    const h = Number(hour)
    const m = Number(min)
    const ampm = h >= 12 ? 'PM' : 'AM'
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
    const time = `${h12}:${String(m).padStart(2, '0')} ${ampm}`

    if (dow === '*') return `${time} daily`
    return `${time}, ${dow}`
  }

  return expr
}

function timeAgo(dateStr: string | undefined | null): string {
  if (!dateStr) return 'Never'
  const diff = Date.now() - new Date(dateStr).getTime()
  if (diff < 0) return 'just now'
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hour${hrs > 1 ? 's' : ''} ago`
  const days = Math.floor(hrs / 24)
  return `${days} day${days > 1 ? 's' : ''} ago`
}

/* ------------------------------------------------------------------ */
/*  Badge colors                                                       */
/* ------------------------------------------------------------------ */

const TASK_TYPE_STYLE: Record<string, string> = {
  PORTFOLIO_REVIEW: 'bg-blue-500/15 text-blue-200 border-blue-300/30',
  MARKET_PULSE:     'bg-emerald-500/15 text-emerald-200 border-emerald-300/30',
  BRAIN_REVIEW:     'bg-violet-500/15 text-violet-200 border-violet-300/30',
  HEARTBEAT_WAKEUP: 'bg-red-500/15 text-red-200 border-red-300/30',
}

function eventBadgeStyle(eventType: string): string {
  if (eventType.startsWith('TRADE'))     return 'bg-amber-500/15 text-amber-200 border-amber-300/30'
  if (eventType === 'HEARTBEAT_ALERT')   return 'bg-red-500/15 text-red-200 border-red-300/30'
  if (eventType.startsWith('HEARTBEAT')) return 'bg-emerald-500/15 text-emerald-200 border-emerald-300/30'
  if (eventType.startsWith('SCHEDULE'))  return 'bg-blue-500/15 text-blue-200 border-blue-300/30'
  if (eventType.startsWith('CHAT'))      return 'bg-purple-500/15 text-purple-200 border-purple-300/30'
  if (eventType.startsWith('BRAIN'))     return 'bg-violet-500/15 text-violet-200 border-violet-300/30'
  return 'bg-slate-500/15 text-slate-200 border-slate-400/30'
}

const TASK_TYPES = ['PORTFOLIO_REVIEW', 'MARKET_PULSE', 'BRAIN_REVIEW', 'HEARTBEAT_WAKEUP'] as const

/* ------------------------------------------------------------------ */
/*  Shared components                                                  */
/* ------------------------------------------------------------------ */

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const firstInput = dialogRef.current?.querySelector<HTMLElement>('input, button, select, textarea')
    firstInput?.focus()
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <motion.div
        ref={dialogRef}
        initial={{ scale: 0.97, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.14, ease: 'easeOut' }}
        className="glass-panel w-full max-w-md rounded p-4"
      >
        <h2 className="text-base font-semibold text-[var(--text-primary)] mb-3">{title}</h2>
        {children}
        <button onClick={onClose} className="btn-ghost mt-3 px-3 py-1.5 text-xs">Cancel</button>
      </motion.div>
    </div>
  )
}

function InputField({
  id, label, value, onChange, type = 'text', hint,
}: {
  id: string; label: string; value: string; onChange: (v: string) => void; type?: string; hint?: string
}) {
  return (
    <div>
      <label htmlFor={id} className="field-label">{label}</label>
      <input id={id} type={type} className="field-input" value={value} onChange={e => onChange(e.target.value)} />
      {hint && <p className="text-xs text-[var(--text-muted)] mt-1">{hint}</p>}
    </div>
  )
}

function Badge({ text, className }: { text: string; className: string }) {
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium border ${className}`}>
      {text}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/*  Main page                                                          */
/* ------------------------------------------------------------------ */

export default function AutonomyPage() {
  /* --- Schedules state --- */
  const [schedules, setSchedules] = useState<ScheduleResponse[]>([])
  const [schedulesLoading, setSchedulesLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingSchedule, setEditingSchedule] = useState<ScheduleResponse | null>(null)
  const [form, setForm] = useState<ScheduleRequest>({
    name: '', cronExpression: '', taskType: 'PORTFOLIO_REVIEW', payload: {}, enabled: true,
  })
  const [tickersInput, setTickersInput] = useState('')

  /* --- Heartbeat state --- */
  const [heartbeat, setHeartbeat] = useState<HeartbeatConfig | null>(null)
  const [hbForm, setHbForm] = useState<HeartbeatConfigRequest>({ enabled: false, intervalSeconds: 300, drawdownAlertPct: 5 })
  const [hbLoading, setHbLoading] = useState(true)

  /* --- Events state --- */
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [eventsLoading, setEventsLoading] = useState(true)
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null)
  const [hasMoreEvents, setHasMoreEvents] = useState(true)

  /* ---- Loaders ---- */
  const refreshSchedules = () =>
    autonomyApi.listSchedules().then(setSchedules).catch(() => toast.error('Failed to load schedules.')).finally(() => setSchedulesLoading(false))

  const loadHeartbeat = () =>
    autonomyApi.getHeartbeat()
      .then(cfg => { setHeartbeat(cfg); setHbForm({ enabled: cfg.enabled, intervalSeconds: cfg.intervalSeconds, drawdownAlertPct: cfg.drawdownAlertPct }) })
      .catch(() => { /* first-time users may 404 */ })
      .finally(() => setHbLoading(false))

  const loadEvents = (afterSeq?: number) => {
    eventsApi.list(afterSeq, 20)
      .then(data => {
        if (data.length < 20) setHasMoreEvents(false)
        setEvents(prev => afterSeq !== undefined ? [...prev, ...data] : data)
      })
      .catch(() => toast.error('Failed to load events.'))
      .finally(() => setEventsLoading(false))
  }

  useEffect(() => {
    refreshSchedules()
    loadHeartbeat()
    loadEvents()
  }, [])

  /* ---- Schedule CRUD ---- */
  const openCreate = () => {
    setEditingSchedule(null)
    setForm({ name: '', cronExpression: '', taskType: 'PORTFOLIO_REVIEW', payload: {}, enabled: true })
    setTickersInput('')
    setShowModal(true)
  }

  const openEdit = (s: ScheduleResponse) => {
    setEditingSchedule(s)
    setForm({ name: s.name, cronExpression: s.cronExpression, taskType: s.taskType, payload: s.payload, enabled: s.enabled })
    setTickersInput(s.payload?.tickers ? (s.payload.tickers as string[]).join(', ') : '')
    setShowModal(true)
  }

  const submitSchedule = async () => {
    const payload: Record<string, unknown> = { ...form.payload }
    if (form.taskType === 'MARKET_PULSE' && tickersInput.trim()) {
      payload.tickers = tickersInput.split(',').map(t => t.trim()).filter(Boolean)
    }
    const req: ScheduleRequest = { ...form, payload }

    try {
      if (editingSchedule) {
        await autonomyApi.updateSchedule(editingSchedule.id, req)
        toast.success(`Schedule "${req.name}" updated.`)
      } else {
        await autonomyApi.createSchedule(req)
        toast.success(`Schedule "${req.name}" created.`)
      }
      setShowModal(false)
      refreshSchedules()
    } catch {
      toast.error(`Failed to ${editingSchedule ? 'update' : 'create'} schedule.`)
    }
  }

  const togglePause = async (s: ScheduleResponse) => {
    try {
      if (s.enabled) {
        await autonomyApi.pauseSchedule(s.id)
        toast.success(`"${s.name}" paused.`)
      } else {
        await autonomyApi.resumeSchedule(s.id)
        toast.success(`"${s.name}" resumed.`)
      }
      refreshSchedules()
    } catch {
      toast.error('Failed to update schedule.')
    }
  }

  const deleteSchedule = async (s: ScheduleResponse) => {
    if (!confirm(`Delete schedule "${s.name}"?`)) return
    try {
      await autonomyApi.deleteSchedule(s.id)
      toast.success('Schedule deleted.')
      refreshSchedules()
    } catch {
      toast.error('Failed to delete schedule.')
    }
  }

  /* ---- Heartbeat save ---- */
  const saveHeartbeat = async () => {
    try {
      const updated = await autonomyApi.updateHeartbeat(hbForm)
      setHeartbeat(updated)
      toast.success('Heartbeat config saved.')
    } catch {
      toast.error('Failed to save heartbeat config.')
    }
  }

  /* ---- Events load more ---- */
  const loadMoreEvents = () => {
    if (events.length === 0) return
    const lastSeq = events[events.length - 1].seqNo
    loadEvents(lastSeq)
  }

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */

  return (
    <div className="px-4 py-4 md:px-6 md:py-4 space-y-4">
      {/* --- Page Header --- */}
      <section className="glass-panel rounded p-3 md:p-4">
        <h1 className="page-title">Agent Autonomy</h1>
        <p className="page-subtitle">Manage scheduled tasks, heartbeat monitoring, and audit events.</p>
      </section>

      {/* ============================================================ */}
      {/*  Section 1: Scheduled Tasks                                   */}
      {/* ============================================================ */}
      <section className="glass-panel rounded p-3 md:p-4">
        <div className="flex items-center justify-between gap-4 mb-3">
          <div className="flex items-center gap-2">
            <CalendarClock size={16} className="text-blue-400" />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Scheduled Tasks</h2>
          </div>
          <button onClick={openCreate} className="btn-primary px-3 py-1.5 text-xs">
            <Plus size={13} /> New Schedule
          </button>
        </div>

        {schedulesLoading ? (
          <div className="space-y-2">
            {[1, 2].map(i => (
              <div key={i} className="surface-panel rounded h-16 animate-pulse" />
            ))}
          </div>
        ) : schedules.length === 0 ? (
          <EmptyState
            icon={<CalendarClock size={24} />}
            title="No scheduled tasks yet"
            description="Create one to automate portfolio reviews, market scans, or heartbeat checks."
          />
        ) : (
          <div className="space-y-1.5">
            {schedules.map(s => (
              <motion.div
                key={s.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="surface-panel rounded px-3 py-2.5 flex items-center justify-between gap-3 flex-wrap"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="min-w-0">
                    <p className="font-semibold text-[var(--text-primary)] truncate text-sm">{s.name}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <Badge
                        text={s.taskType.replace(/_/g, ' ')}
                        className={TASK_TYPE_STYLE[s.taskType] ?? 'bg-slate-500/15 text-slate-200 border-slate-400/30'}
                      />
                      <span className="text-xs text-[var(--text-muted)] font-data">{describeCron(s.cronExpression)}</span>
                      <span className={`text-xs font-medium ${s.enabled ? 'text-emerald-400' : 'text-[var(--text-muted)]'}`}>
                        {s.enabled ? 'Active' : 'Paused'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 text-xs text-[var(--text-muted)] flex-wrap">
                  <span title="Last run">Last: {timeAgo(s.lastRunAt)}</span>
                  <span title="Next run">Next: {s.nextRunAt ? timeAgo(s.nextRunAt) : '-'}</span>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => togglePause(s)}
                    aria-label={s.enabled ? 'Pause' : 'Resume'}
                    className="h-7 w-7 rounded flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/5 transition-colors"
                  >
                    {s.enabled ? <Pause size={13} /> : <Play size={13} />}
                  </button>
                  <button
                    onClick={() => openEdit(s)}
                    aria-label="Edit"
                    className="h-7 w-7 rounded flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/5 transition-colors"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={() => deleteSchedule(s)}
                    aria-label="Delete"
                    className="h-7 w-7 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-red-300 hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </section>

      {/* ============================================================ */}
      {/*  Section 2: Heartbeat Configuration                           */}
      {/* ============================================================ */}
      <section className="glass-panel rounded p-3 md:p-4">
        <div className="flex items-center gap-2 mb-3">
          {/* Heart is a warning/health indicator — amber is appropriate here */}
          <Heart size={16} className="text-amber-400" />
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Heartbeat Configuration</h2>
        </div>

        {hbLoading ? (
          <div className="surface-panel rounded h-28 animate-pulse" />
        ) : (
          <div className="surface-panel rounded px-4 py-3 space-y-3">
            {/* Enabled toggle */}
            <div className="flex items-center justify-between">
              <label className="text-sm text-[var(--text-secondary)]">Enabled</label>
              <button
                onClick={() => setHbForm(f => ({ ...f, enabled: !f.enabled }))}
                className={`relative w-10 h-5 rounded transition-colors ${hbForm.enabled ? 'bg-blue-500/70' : 'bg-[var(--border-strong)]'}`}
                aria-label="Toggle heartbeat"
              >
                <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded bg-white transition-transform ${hbForm.enabled ? 'translate-x-5' : ''}`} />
              </button>
            </div>

            {/* Interval */}
            <div>
              <label className="field-label">Interval ({Math.round((hbForm.intervalSeconds ?? 300) / 60)} min)</label>
              <input
                type="range"
                min={60}
                max={3600}
                step={60}
                value={hbForm.intervalSeconds ?? 300}
                onChange={e => setHbForm(f => ({ ...f, intervalSeconds: Number(e.target.value) }))}
                className="w-full accent-blue-400"
              />
              <div className="flex justify-between text-xs text-[var(--text-muted)] mt-0.5">
                <span>1 min</span>
                <span>60 min</span>
              </div>
            </div>

            {/* Drawdown alert — amber here is correct: it's a warning threshold */}
            <div>
              <label htmlFor="hb-drawdown" className="field-label">
                Drawdown Alert Threshold (%)
                <span className="ml-1.5 text-amber-400 text-xs font-normal">warning trigger</span>
              </label>
              <input
                id="hb-drawdown"
                type="number"
                min={0.1}
                max={95}
                step={0.1}
                className="field-input w-28"
                value={hbForm.drawdownAlertPct ?? 5}
                onChange={e => setHbForm(f => ({ ...f, drawdownAlertPct: Number(e.target.value) }))}
              />
            </div>

            {/* Last beat */}
            {heartbeat?.lastBeatAt && (
              <p className="text-xs text-[var(--text-muted)] flex items-center gap-1.5">
                <Clock size={11} /> Last heartbeat: {timeAgo(heartbeat.lastBeatAt)}
              </p>
            )}

            <button onClick={saveHeartbeat} className="btn-primary px-3.5 py-1.5 text-xs">Save</button>
          </div>
        )}
      </section>

      {/* ============================================================ */}
      {/*  Section 3: Event Timeline                                    */}
      {/* ============================================================ */}
      <section className="glass-panel rounded p-3 md:p-4">
        <div className="flex items-center gap-2 mb-3">
          <Activity size={16} className="text-blue-400" />
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Event Timeline</h2>
        </div>

        {eventsLoading ? (
          <div className="space-y-1.5">
            {[1, 2, 3].map(i => (
              <div key={i} className="surface-panel rounded h-11 animate-pulse" />
            ))}
          </div>
        ) : events.length === 0 ? (
          <EmptyState
            icon={<Activity size={24} />}
            title="No events yet"
            description="Agent events will appear here once tasks run."
          />
        ) : (
          <div className="space-y-1">
            {events.map(evt => (
              <motion.div
                key={evt.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="surface-panel rounded overflow-hidden"
              >
                <button
                  onClick={() => setExpandedEvent(expandedEvent === evt.id ? null : evt.id)}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-white/[0.03] transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    <span className="text-xs text-[var(--text-muted)] font-data tabular-nums w-8 shrink-0">#{evt.seqNo}</span>
                    <Badge text={evt.eventType.replace(/_/g, ' ')} className={eventBadgeStyle(evt.eventType)} />
                    <span className="text-xs text-[var(--text-muted)]">{evt.aggregateType}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-[var(--text-muted)]">{timeAgo(evt.createdAt)}</span>
                    <ChevronDown
                      size={13}
                      className="text-[var(--text-muted)] transition-transform duration-150"
                      style={{ transform: expandedEvent === evt.id ? 'rotate(180deg)' : 'rotate(0deg)' }}
                    />
                  </div>
                </button>

                {expandedEvent === evt.id && (
                  <div className="border-t border-[color:var(--border-subtle)] px-3 py-2.5">
                    <pre className="text-xs text-[var(--text-secondary)] font-data whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
                      {JSON.stringify(evt.payload, null, 2)}
                    </pre>
                  </div>
                )}
              </motion.div>
            ))}

            {hasMoreEvents && (
              <button onClick={loadMoreEvents} className="btn-ghost w-full py-2 text-xs mt-1">
                Load More
              </button>
            )}
          </div>
        )}
      </section>

      {/* ============================================================ */}
      {/*  Schedule Modal                                               */}
      {/* ============================================================ */}
      {showModal && (
        <Modal
          title={editingSchedule ? 'Edit Schedule' : 'New Schedule'}
          onClose={() => setShowModal(false)}
        >
          <div className="space-y-3">
            <InputField
              id="sched-name"
              label="Name"
              value={form.name}
              onChange={v => setForm(f => ({ ...f, name: v }))}
            />

            <div>
              <label htmlFor="sched-type" className="field-label">Task Type</label>
              <select
                id="sched-type"
                className="field-input"
                value={form.taskType}
                onChange={e => setForm(f => ({ ...f, taskType: e.target.value }))}
              >
                {TASK_TYPES.map(t => (
                  <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>

            <InputField
              id="sched-cron"
              label="Cron Expression"
              value={form.cronExpression}
              onChange={v => setForm(f => ({ ...f, cronExpression: v }))}
              hint='e.g., 0 9 * * MON-FRI'
            />

            {form.taskType === 'MARKET_PULSE' && (
              <InputField
                id="sched-tickers"
                label="Tickers"
                value={tickersInput}
                onChange={setTickersInput}
                hint="Comma-separated, e.g. AAPL, MSFT, GOOGL"
              />
            )}

            {/* Enabled toggle */}
            <div className="flex items-center justify-between">
              <label className="text-sm text-[var(--text-secondary)]">Enabled</label>
              <button
                onClick={() => setForm(f => ({ ...f, enabled: !f.enabled }))}
                className={`relative w-10 h-5 rounded transition-colors ${form.enabled ? 'bg-blue-500/70' : 'bg-[var(--border-strong)]'}`}
                aria-label="Toggle enabled"
              >
                <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded bg-white transition-transform ${form.enabled ? 'translate-x-5' : ''}`} />
              </button>
            </div>

            <button
              onClick={submitSchedule}
              disabled={!form.name || !form.cronExpression}
              className="btn-primary w-full py-2 text-sm disabled:opacity-40"
            >
              {editingSchedule ? 'Update' : 'Create'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
