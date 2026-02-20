import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, Bot, User, Sparkles } from 'lucide-react'
import { chatApi } from '../api/chat'

interface Message {
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
  timestamp: string
}

const CURSOR_STYLE_ID = 'finsentinel-cursor-style'
function ensureCursorStyle() {
  if (typeof document !== 'undefined' && !document.getElementById(CURSOR_STYLE_ID)) {
    const style = document.createElement('style')
    style.id = CURSOR_STYLE_ID
    style.textContent = `
      @keyframes finsentinel-glow-pulse {
        0%, 100% { opacity: 1; box-shadow: 0 0 4px 2px rgba(245,158,11,0.42); }
        50%      { opacity: 0.3; box-shadow: 0 0 2px 1px rgba(245,158,11,0.2); }
      }
      .fs-cursor {
        display: inline-block;
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #f59e0b;
        margin-left: 4px;
        vertical-align: middle;
        animation: finsentinel-glow-pulse 1.2s ease-in-out infinite;
      }
      @media (prefers-reduced-motion: reduce) {
        .fs-cursor {
          animation: none;
        }
      }
    `
    document.head.appendChild(style)
  }
}

function nowTime() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [sessionId, setSessionId] = useState<string | undefined>()
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => { ensureCursorStyle() }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = async () => {
    if (!input.trim() || streaming) return
    const userMessage = input.trim()

    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: userMessage, timestamp: nowTime() }])
    setStreaming(true)

    setMessages(prev => [...prev, { role: 'assistant', content: '', streaming: true, timestamp: nowTime() }])

    await chatApi.stream(
      userMessage,
      undefined,
      sessionId,
      (chunk, sid) => {
        setSessionId(prev => prev ?? sid)
        setMessages(prev => {
          const copy = [...prev]
          const last = copy[copy.length - 1]
          if (last && last.streaming) {
            copy[copy.length - 1] = { ...last, content: last.content + chunk }
          }
          return copy
        })
      },
      () => {
        setStreaming(false)
        setMessages(prev => {
          const copy = [...prev]
          const last = copy[copy.length - 1]
          if (last && last.streaming) {
            copy[copy.length - 1] = { ...last, streaming: false }
          }
          return copy
        })
      },
      (err) => {
        setStreaming(false)
        setMessages(prev => {
          const copy = [...prev]
          const last = copy[copy.length - 1]
          if (last && last.streaming) {
            copy[copy.length - 1] = { ...last, content: `Error: ${err}`, streaming: false }
          }
          return copy
        })
      },
    )
  }

  return (
    <div className="h-[calc(100vh-7.4rem)] min-h-[36rem] px-4 py-6 md:px-8 md:py-8">
      <div className="h-full grid grid-rows-[auto_1fr_auto] glass-panel rounded-3xl overflow-hidden">
        <header className="px-5 py-4 md:px-6 border-b border-[color:var(--border-subtle)] bg-slate-900/25">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl md:text-3xl font-display text-[var(--text-primary)]">AI Risk Advisor</h1>
              <p className="text-sm text-[var(--text-secondary)] mt-0.5">Streaming analysis for portfolio risk and SEC-aware constraints</p>
            </div>
            <span className="status-chip bg-cyan-500/10 border-cyan-400/25 text-cyan-100">
              <Sparkles size={12} />
              Agent online
            </span>
          </div>
        </header>

        <section className="overflow-y-auto px-4 py-5 md:px-6 md:py-6" aria-live="polite">
          {messages.length === 0 && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="h-full flex flex-col items-center justify-center text-center px-4"
            >
              <div className="h-16 w-16 rounded-2xl bg-amber-400/12 border border-amber-400/25 flex items-center justify-center mb-4">
                <Bot size={30} className="text-amber-200" aria-hidden="true" />
              </div>
              <p className="text-base font-semibold text-[var(--text-primary)]">Ask FinSentinel anything about your portfolio risk.</p>
              <p className="mt-1.5 text-sm text-[var(--text-secondary)] max-w-md">Try: concentration risk, macro event exposure, or compliance-sensitive rebalancing options.</p>
            </motion.div>
          )}

          <AnimatePresence>
            {messages.map((message, i) => (
              <motion.div
                key={`${message.timestamp}-${i}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex gap-3 mb-4 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {message.role === 'assistant' && (
                  <div className="h-8 w-8 rounded-xl bg-amber-400/20 border border-amber-300/25 text-amber-100 flex items-center justify-center flex-shrink-0 mt-1">
                    <Bot size={14} aria-hidden="true" />
                  </div>
                )}

                <div className={`max-w-[85%] md:max-w-[70%] ${message.role === 'user' ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
                  <div
                    className={`rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                      message.role === 'user'
                        ? 'bg-gradient-to-br from-amber-300 to-amber-500 text-[#1d1302] rounded-br-md shadow-lg shadow-amber-900/20'
                        : 'surface-panel text-[var(--text-primary)] rounded-bl-md'
                    }`}
                  >
                    {message.content}
                    {message.streaming && <span className="fs-cursor" aria-hidden="true" />}
                  </div>
                  <p className="text-[11px] text-[var(--text-muted)]">{message.timestamp}</p>
                </div>

                {message.role === 'user' && (
                  <div className="h-8 w-8 rounded-xl bg-slate-700/40 border border-[color:var(--border-subtle)] text-slate-100 flex items-center justify-center flex-shrink-0 mt-1">
                    <User size={14} aria-hidden="true" />
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>

          <div ref={bottomRef} />
        </section>

        <footer className="px-4 py-4 md:px-6 border-t border-[color:var(--border-subtle)] bg-slate-900/25">
          <div className="flex gap-3">
            <input
              className="field-input"
              placeholder="Ask about factor risk, scenario impact, sector concentration..."
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
              disabled={streaming}
            />
            <button
              onClick={send}
              disabled={streaming || !input.trim()}
              className="btn-primary px-4"
              aria-label="Send message"
            >
              <Send size={16} />
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
