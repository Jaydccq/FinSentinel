import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, Bot, User } from 'lucide-react'
import { chatApi } from '../api/chat'

interface Message {
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [sessionId, setSessionId] = useState<string | undefined>()
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = async () => {
    if (!input.trim() || streaming) return
    const msg = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: msg }])
    setStreaming(true)

    // Add a streaming placeholder
    setMessages(prev => [...prev, { role: 'assistant', content: '', streaming: true }])

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
      <div className="px-6 py-4 border-b border-gray-800 bg-gray-900">
        <h1 className="text-lg font-semibold text-gray-100">AI Risk Advisor</h1>
        <p className="text-xs text-gray-500">Powered by FinSentinel Agent — SEC Compliant</p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-600 pt-16">
            <Bot size={40} className="mx-auto mb-3 text-gray-700" />
            <p>Ask me about portfolio risk, market conditions, or SEC compliance.</p>
          </div>
        )}
        <AnimatePresence>
          {messages.map((m, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex gap-3 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {m.role === 'assistant' && (
                <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0 mt-1">
                  <Bot size={14} />
                </div>
              )}
              <div
                className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                  m.role === 'user'
                    ? 'bg-blue-600 text-white rounded-br-sm'
                    : 'bg-gray-800 text-gray-100 rounded-bl-sm'
                }`}
              >
                {m.content}
                {m.streaming && (
                  <span className="inline-block w-1.5 h-4 bg-blue-400 ml-0.5 animate-pulse" />
                )}
              </div>
              {m.role === 'user' && (
                <div className="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center flex-shrink-0 mt-1">
                  <User size={14} />
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-6 py-4 border-t border-gray-800 bg-gray-900">
        <div className="flex gap-3">
          <input
            className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-gray-100 text-sm focus:outline-none focus:border-blue-500 disabled:opacity-50"
            placeholder="Ask about risk, portfolio, SEC regulations..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
            disabled={streaming}
          />
          <button
            onClick={send}
            disabled={streaming || !input.trim()}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl transition-colors"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
