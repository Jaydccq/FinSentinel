'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Send,
  Bot,
  User,
  Sparkles,
  History,
  Plus,
  MessageSquare,
  PanelLeftClose,
  PanelLeft,
  Briefcase,
} from 'lucide-react';
import { toast } from 'sonner';
import { chatApi, type ChatSessionSummary } from '../api/chat';
import { portfolioApi, type PortfolioResponse } from '../api/portfolio';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  timestamp: string;
}

const CURSOR_STYLE_ID = 'finsentinel-cursor-style';
function ensureCursorStyle() {
  if (typeof document !== 'undefined' && !document.getElementById(CURSOR_STYLE_ID)) {
    const style = document.createElement('style');
    style.id = CURSOR_STYLE_ID;
    style.textContent = `
      @keyframes finsentinel-glow-pulse {
        0%, 100% { opacity: 1; box-shadow: 0 0 4px 2px rgba(59,130,246,0.42); }
        50%      { opacity: 0.3; box-shadow: 0 0 2px 1px rgba(59,130,246,0.2); }
      }
      .fs-cursor {
        display: inline-block;
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #3b82f6;
        margin-left: 4px;
        vertical-align: middle;
        animation: finsentinel-glow-pulse 1.2s ease-in-out infinite;
      }
      @media (prefers-reduced-motion: reduce) {
        .fs-cursor {
          animation: none;
        }
      }
    `;
    document.head.appendChild(style);
  }
}

function nowTime() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [portfolios, setPortfolios] = useState<PortfolioResponse[]>([]);
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string>('');
  const [upgradeRunId, setUpgradeRunId] = useState<string | null>(null);
  const [upgradeReason, setUpgradeReason] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ensureCursorStyle();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Restore sessionId from localStorage after hydration
  useEffect(() => {
    const stored = localStorage.getItem('chat_session_id');
    if (stored) setSessionId(stored);
  }, []);

  // Persist sessionId to localStorage
  useEffect(() => {
    if (sessionId) {
      localStorage.setItem('chat_session_id', sessionId);
    }
  }, [sessionId]);

  // Load sessions list
  const loadSessions = useCallback(() => {
    chatApi
      .sessions()
      .then(setSessions)
      .catch(() => {})
      .finally(() => setSessionsLoading(false));
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    portfolioApi
      .list()
      .then(setPortfolios)
      .catch(() => {});
  }, []);

  // Restore session on mount if sessionId exists
  useEffect(() => {
    if (!sessionId) return;
    chatApi
      .history(sessionId)
      .then((history) => {
        const restored: Message[] = history.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
          timestamp: new Date(m.createdAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          }),
        }));
        setMessages(restored);
      })
      .catch(() => {
        // Session might not exist anymore
        setMessages([]);
      });
    // Only run on mount — not when sessionId changes during conversation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadSession = (sid: string) => {
    setSessionId(sid);
    chatApi
      .history(sid)
      .then((history) => {
        const loaded: Message[] = history.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
          timestamp: new Date(m.createdAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          }),
        }));
        setMessages(loaded);
      })
      .catch(() => toast.error('Failed to load session history.'));
  };

  const newChat = () => {
    setSessionId(undefined);
    setMessages([]);
    localStorage.removeItem('chat_session_id');
  };

  const send = async () => {
    if (!input.trim() || streaming) return;
    const userMessage = input.trim();

    setInput('');
    setUpgradeRunId(null);
    setUpgradeReason(null);
    setMessages((prev) => [...prev, { role: 'user', content: userMessage, timestamp: nowTime() }]);
    setStreaming(true);

    setMessages((prev) => [
      ...prev,
      { role: 'assistant', content: '', streaming: true, timestamp: nowTime() },
    ]);

    try {
      await chatApi.stream(
        userMessage,
        selectedPortfolioId || undefined,
        sessionId,
        (chunk, sid) => {
          setSessionId((prev) => prev ?? sid);
          setMessages((prev) => {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            if (last && last.streaming) {
              copy[copy.length - 1] = { ...last, content: last.content + chunk };
            }
            return copy;
          });
        },
        () => {
          setStreaming(false);
          setMessages((prev) => {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            if (last && last.streaming) {
              copy[copy.length - 1] = { ...last, streaming: false };
            }
            return copy;
          });
          // Refresh sessions list after completing a conversation turn
          loadSessions();
        },
        (err) => {
          setStreaming(false);
          const friendly = err.includes('429')
            ? 'Rate limit reached. Please wait a moment.'
            : `Chat error: ${err}`;
          toast.error(friendly);
          setMessages((prev) => {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            if (last && last.streaming) {
              copy[copy.length - 1] = { ...last, content: friendly, streaming: false };
            }
            return copy;
          });
        },
        (runId: string, reason?: string) => {
          setUpgradeRunId(runId);
          if (reason) setUpgradeReason(reason);
        },
      );
    } finally {
      // Belt-and-suspenders: guarantee streaming resets even if stream() throws unexpectedly
      setStreaming(false);
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last && last.streaming) {
          copy[copy.length - 1] = { ...last, streaming: false };
        }
        return copy;
      });
    }
  };

  return (
    <div className="h-[calc(100vh-7.4rem)] min-h-[36rem] px-4 py-4 md:px-8 md:py-6">
      <div className="h-full flex gap-3">
        {/* Sessions sidebar */}
        <AnimatePresence>
          {sidebarOpen && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 260, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="flex-shrink-0 h-full hidden md:flex flex-col glass-panel rounded overflow-hidden"
            >
              <div className="px-3 py-2.5 border-b border-[color:var(--border-subtle)] flex items-center justify-between">
                <div className="flex items-center gap-2 text-[var(--text-secondary)]">
                  <History size={13} />
                  <span className="text-xs uppercase tracking-[0.1em] font-semibold">Sessions</span>
                </div>
                <button
                  onClick={newChat}
                  className="h-6 w-6 rounded flex items-center justify-center text-blue-200 hover:bg-blue-400/15 transition-colors"
                  aria-label="New chat"
                >
                  <Plus size={13} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-1.5 py-1.5 space-y-0.5">
                {sessionsLoading ? (
                  <div className="px-2 py-3 space-y-1.5">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="bg-slate-700/40 animate-pulse rounded h-12" />
                    ))}
                  </div>
                ) : sessions.length === 0 ? (
                  <p className="text-xs text-[var(--text-muted)] px-2 py-4 text-center">
                    No sessions yet.
                  </p>
                ) : (
                  sessions.map((s) => (
                    <button
                      key={s.sessionId}
                      onClick={() => loadSession(s.sessionId)}
                      className={`w-full text-left rounded px-2.5 py-2 transition-all duration-150 ${
                        sessionId === s.sessionId
                          ? 'bg-blue-400/10 border border-blue-300/25'
                          : 'hover:bg-white/5 border border-transparent'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <MessageSquare
                          size={12}
                          className="text-[var(--text-muted)] mt-0.5 flex-shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-[var(--text-primary)] truncate leading-snug">
                            {s.firstMessage}
                          </p>
                          <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
                            {s.messageCount} msgs · {timeAgo(s.lastMessageAt)}
                          </p>
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Main chat area */}
        <div className="flex-1 min-w-0 h-full grid grid-rows-[auto_1fr_auto] glass-panel rounded overflow-hidden">
          <header className="px-4 py-3 md:px-5 border-b border-[color:var(--border-subtle)] bg-slate-900/25">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setSidebarOpen(!sidebarOpen)}
                  className="hidden md:flex h-7 w-7 rounded items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/5 transition-colors"
                  aria-label={sidebarOpen ? 'Hide sessions' : 'Show sessions'}
                >
                  {sidebarOpen ? <PanelLeftClose size={15} /> : <PanelLeft size={15} />}
                </button>
                <div>
                  <h1 className="text-xl md:text-2xl font-semibold text-[var(--text-primary)]">
                    AI Risk Advisor
                  </h1>
                  <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                    Streaming analysis powered by multi-tool AI agent
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="status-chip bg-cyan-500/10 border-cyan-400/25 text-cyan-100">
                  <Sparkles size={11} />
                  Agent online
                </span>
                {portfolios.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    <Briefcase size={12} className="text-[var(--text-muted)]" />
                    <select
                      value={selectedPortfolioId}
                      onChange={(e) => setSelectedPortfolioId(e.target.value)}
                      className="bg-slate-800/60 border border-[color:var(--border-subtle)] rounded text-xs text-[var(--text-secondary)] py-1 px-2 max-w-[160px] focus:outline-none focus:border-blue-400/40"
                    >
                      <option value="">No portfolio context</option>
                      {portfolios.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>
          </header>

          <section className="overflow-y-auto px-4 py-4 md:px-5" aria-live="polite">
            {upgradeRunId && (
              <div className="glass-panel rounded p-3 my-2 flex items-center justify-between">
                <span className="text-sm">
                  This chat was upgraded to a tracked run
                  {upgradeReason ? ` (${upgradeReason})` : ''}.
                </span>
                <a
                  className="btn-primary px-3 py-1 text-xs"
                  href={`/analysis?runId=${upgradeRunId}`}
                >
                  Open Run
                </a>
              </div>
            )}
            {messages.length === 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="h-full flex flex-col items-center justify-center text-center px-4"
              >
                <div className="h-14 w-14 rounded bg-blue-400/12 border border-blue-400/25 flex items-center justify-center mb-3">
                  <Bot size={26} className="text-blue-200" aria-hidden="true" />
                </div>
                <p className="text-base font-semibold text-[var(--text-primary)]">
                  Ask FinSentinel anything about your portfolio risk.
                </p>
                <p className="mt-1 text-sm text-[var(--text-secondary)] max-w-md">
                  Try: concentration risk, macro event exposure, or sector rotation strategies.
                </p>
              </motion.div>
            )}

            <AnimatePresence>
              {messages.map((message, i) => (
                <motion.div
                  key={`${message.timestamp}-${i}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className={`flex gap-2.5 mb-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {message.role === 'assistant' && (
                    <div className="h-7 w-7 rounded bg-blue-400/20 border border-blue-300/25 text-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Bot size={13} aria-hidden="true" />
                    </div>
                  )}

                  <div
                    className={`max-w-[85%] md:max-w-[70%] ${message.role === 'user' ? 'items-end' : 'items-start'} flex flex-col gap-0.5`}
                  >
                    <div
                      className={`rounded px-3 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                        message.role === 'user'
                          ? 'bg-blue-500/15 text-blue-100 rounded-br-none'
                          : 'surface-panel text-[var(--text-primary)] rounded-bl-none'
                      }`}
                    >
                      {message.content}
                      {message.streaming && <span className="fs-cursor" aria-hidden="true" />}
                    </div>
                    <p className="text-[10px] text-[var(--text-muted)]">{message.timestamp}</p>
                  </div>

                  {message.role === 'user' && (
                    <div className="h-7 w-7 rounded bg-slate-700/40 border border-[color:var(--border-subtle)] text-slate-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <User size={13} aria-hidden="true" />
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>

            <div ref={bottomRef} />
          </section>

          <footer className="px-4 py-3 md:px-5 border-t border-[color:var(--border-subtle)] bg-slate-900/25">
            <div className="flex gap-2">
              <input
                className="field-input"
                placeholder="Ask about factor risk, scenario impact, sector concentration..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()}
                disabled={streaming}
              />
              <button
                onClick={send}
                disabled={streaming || !input.trim()}
                className="btn-primary px-3"
                aria-label="Send message"
              >
                <Send size={15} />
              </button>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
