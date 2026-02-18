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

// Glowing pulsating cursor injected as a global keyframe once
const CURSOR_STYLE_ID = 'finsentinel-cursor-style'
function ensureCursorStyle() {
  if (typeof document !== 'undefined' && !document.getElementById(CURSOR_STYLE_ID)) {
    const style = document.createElement('style')
    style.id = CURSOR_STYLE_ID
    style.textContent = `
      @keyframes finsentinel-glow-pulse {
        0%, 100% { opacity: 1; box-shadow: 0 0 4px 2px rgba(59,130,246,0.7); }
        50%       { opacity: 0.3; box-shadow: 0 0 2px 1px rgba(59,130,246,0.2); }
      }
      .fs-cursor {
        display: inline-block;
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #3b82f6;
        margin-left: 4px;
        vertical-align: middle;
        animation: finsentinel-glow-pulse 1s ease-in-out infinite;
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

  // Inject cursor keyframes on mount
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

    // Add a streaming placeholder for the assistant turn
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
      <div className="px-6 py-4 border-b border-gray-800 bg-gray-900/80 backdrop-blur-sm">
        <h1 className="text-lg font-semibold text-gray-100">AI Risk Advisor</h1>
        <p className="text-xs text-gray-500">Powered by FinSentinel Agent — SEC Compliant</p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {/* Empty state */}
        {messages.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="flex flex-col items-center justify-center pt-24 text-center select-none"
          >
            <div className="w-16 h-16 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mb-4">
              <Bot size={32} className="text-blue-400" />
            </div>
            <p className="text-gray-400 font-medium text-base">Ask FinSentinel about your portfolio risk...</p>
            <p className="text-gray-600 text-sm mt-1 max-w-xs">
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
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center flex-shrink-0 mt-1 ring-1 ring-blue-500/30">
                  <Bot size={14} className="text-white" />
                </div>
              )}

              <div className="flex flex-col gap-1 max-w-[75%]">
                <div
                  className={`
                    rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap
                    ${m.role === 'user'
                      ? 'bg-gradient-to-br from-blue-600 to-blue-500 text-white rounded-br-sm shadow-md shadow-blue-900/30'
                      : 'bg-gray-800/50 text-gray-100 rounded-bl-sm border-l-2 border-blue-500/30'
                    }
                  `}
                >
                  {m.content}
                  {/* Glowing pulsating cursor while streaming */}
                  {m.streaming && <span className="fs-cursor" aria-hidden="true" />}
                </div>

                {/* Timestamp */}
                <p className={`text-[11px] text-gray-600 ${m.role === 'user' ? 'text-right' : 'text-left'}`}>
                  {m.timestamp}
                </p>
              </div>

              {/* User avatar */}
              {m.role === 'user' && (
                <div className="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center flex-shrink-0 mt-1 ring-1 ring-gray-600/50">
                  <User size={14} className="text-gray-300" />
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
        <div ref={bottomRef} />
      </div>

      {/* Input area — glass morphism */}
      <div className="px-6 py-4 border-t border-gray-700/50 bg-gray-800/50 backdrop-blur-sm">
        <div className="flex gap-3">
          <input
            className="
              flex-1 bg-gray-800/50 backdrop-blur-sm
              border border-gray-700/50 rounded-xl px-4 py-2.5
              text-gray-100 text-sm placeholder:text-gray-500
              focus:outline-none focus:border-blue-500/70 focus:ring-1 focus:ring-blue-500/20
              disabled:opacity-50 transition-all
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
              bg-gradient-to-br from-blue-600 to-blue-500
              hover:from-blue-500 hover:to-blue-400
              disabled:opacity-40 disabled:cursor-not-allowed
              text-white px-4 py-2.5 rounded-xl
              hover:scale-105 active:scale-95
              shadow-md shadow-blue-900/30
              transition-all duration-150
            "
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
