import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, Bot, User } from 'lucide-react'
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
        0%, 100% { opacity: 1; box-shadow: 0 0 4px 2px rgba(196,163,90,0.6); }
        50%       { opacity: 0.3; box-shadow: 0 0 2px 1px rgba(196,163,90,0.15); }
      }
      .fs-cursor {
        display: inline-block;
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #c4a35a;
        margin-left: 4px;
        vertical-align: middle;
        animation: finsentinel-glow-pulse 1.2s ease-in-out infinite;
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
    const msg = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: msg, timestamp: nowTime() }])
    setStreaming(true)

    setMessages(prev => [...prev, { role: 'assistant', content: '', streaming: true, timestamp: nowTime() }])

    await chatApi.stream(
      msg,
      undefined,
      sessionId,
      (chunk, sid) => {
        if (!sessionId) setSessionId(sid)
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
      }
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-8 py-5 border-b border-zinc-800/50 bg-zinc-900/60">
        <h1 className="text-xl font-display text-stone-50">AI Risk Advisor</h1>
        <p className="text-xs text-zinc-500 mt-0.5">Powered by FinSentinel Agent — SEC Compliant</p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-5">
        {messages.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="flex flex-col items-center justify-center pt-24 text-center select-none"
          >
            <div className="w-16 h-16 rounded-2xl bg-amber-500/8 border border-amber-500/15 flex items-center justify-center mb-5">
              <Bot size={32} className="text-amber-400" />
            </div>
            <p className="text-zinc-300 font-medium text-base">Ask FinSentinel about your portfolio risk...</p>
            <p className="text-zinc-600 text-sm mt-1.5 max-w-xs">
              Market conditions, SEC compliance, risk scores — all in one place.
            </p>
          </motion.div>
        )}

        <AnimatePresence>
          {messages.map((m, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex gap-3 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {/* Bot avatar */}
              {m.role === 'assistant' && (
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center flex-shrink-0 mt-1 ring-1 ring-amber-500/20">
                  <Bot size={14} className="text-zinc-950" />
                </div>
              )}

              <div className="flex flex-col gap-1 max-w-[75%]">
                <div
                  className={`
                    rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap
                    ${m.role === 'user'
                      ? 'bg-gradient-to-br from-amber-600 to-amber-500 text-zinc-950 rounded-br-sm shadow-md shadow-black/20'
                      : 'bg-zinc-800/50 text-stone-50 rounded-bl-sm border-l-2 border-amber-500/25'
                    }
                  `}
                >
                  {m.content}
                  {m.streaming && <span className="fs-cursor" aria-hidden="true" />}
                </div>

                <p className={`text-[11px] text-zinc-600 ${m.role === 'user' ? 'text-right' : 'text-left'}`}>
                  {m.timestamp}
                </p>
              </div>

              {/* User avatar */}
              {m.role === 'user' && (
                <div className="w-7 h-7 rounded-full bg-zinc-800 flex items-center justify-center flex-shrink-0 mt-1 ring-1 ring-zinc-700/50">
                  <User size={14} className="text-zinc-300" />
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="px-8 py-5 border-t border-zinc-800/50 bg-zinc-900/40">
        <div className="flex gap-3">
          <input
            className="
              flex-1 bg-zinc-800/50
              border border-zinc-700/50 rounded-xl px-4 py-2.5
              text-stone-50 text-sm placeholder:text-zinc-600
              focus:outline-none focus:border-amber-500/40 focus:ring-1 focus:ring-amber-500/15
              disabled:opacity-50 transition-all duration-200
            "
            placeholder="Ask about risk, portfolio, SEC regulations..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
            disabled={streaming}
          />
          <button
            onClick={send}
            disabled={streaming || !input.trim()}
            className="
              bg-amber-600 hover:bg-amber-500
              disabled:opacity-40 disabled:cursor-not-allowed
              text-zinc-950 px-4 py-2.5 rounded-xl
              hover:scale-105 active:scale-95
              shadow-md shadow-black/20
              transition-all duration-200
            "
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
