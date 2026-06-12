import { useState, useEffect, useRef, type FormEvent } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { fetchGlossary, sendQuery, saveConfig } from '../api'
import type { GlossaryEntry, QueryResponse, ScanResult } from '../types'

// ─── result visualisation ────────────────────────────────────────────────────

type ChartKind = 'kpi' | 'bar' | 'line' | 'table'

function detectChart(rows: Record<string, unknown>[]): ChartKind {
  if (rows.length === 0) return 'table'
  const cols = Object.keys(rows[0]!)
  if (rows.length === 1 && cols.length === 1) return 'kpi'
  if (cols.length === 2) {
    const vals = rows.map(r => Number(r[cols[1]!]))
    if (vals.every(v => !isNaN(v))) {
      // if first column looks like a date / sequential → line chart
      const firstKey = String(rows[0]![cols[0]!] ?? '')
      return /\d{4}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|q[1-4]/i.test(firstKey)
        ? 'line'
        : 'bar'
    }
  }
  return 'table'
}

function ResultView({ result }: { result: QueryResponse }) {
  const [showSql, setShowSql] = useState(false)
  const kind = detectChart(result.rows)

  const chartData = result.rows.map(r => {
    const [labelKey, valueKey] = Object.keys(r)
    return { name: String(r[labelKey!] ?? ''), value: Number(r[valueKey!]) }
  })

  return (
    <div className="space-y-3">

      {kind === 'kpi' && (
        <div className="bg-indigo-50 rounded-xl p-6 text-center">
          <p className="text-4xl font-bold text-indigo-700">
            {String(Object.values(result.rows[0]!)[0] ?? '')}
          </p>
          <p className="text-sm text-indigo-400 mt-1">
            {Object.keys(result.rows[0]!)[0]}
          </p>
        </div>
      )}

      {kind === 'bar' && (
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#9ca3af' }} />
              <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
              />
              <Bar dataKey="value" fill="#6366f1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {kind === 'line' && (
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#9ca3af' }} />
              <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="#6366f1"
                strokeWidth={2}
                dot={{ fill: '#6366f1', r: 3 }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {kind === 'table' && result.rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-100">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                {Object.keys(result.rows[0]!).map(col => (
                  <th key={col} className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {result.rows.slice(0, 100).map((row, i) => (
                <tr key={i} className="hover:bg-gray-50 transition-colors">
                  {Object.values(row).map((v, j) => (
                    <td key={j} className="px-3 py-2 text-gray-700">
                      {v === null ? <span className="text-gray-300 italic">null</span> : String(v)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {result.truncated && (
            <p className="px-3 py-2 text-xs text-gray-400 bg-gray-50 border-t border-gray-100">
              Showing first {result.rows.length} rows
            </p>
          )}
        </div>
      )}

      {kind === 'table' && result.rows.length === 0 && (
        <p className="text-sm text-gray-400 italic">No rows returned</p>
      )}

      {/* SQL toggle */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setShowSql(s => !s)}
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
        >
          {showSql ? 'Hide SQL ▲' : 'Show SQL ▼'}
        </button>
        <span className="text-xs text-gray-300">{result.latency_ms}ms · {result.row_count} rows</span>
      </div>

      {showSql && (
        <pre className="bg-gray-950 text-green-400 text-xs p-4 rounded-xl overflow-x-auto leading-relaxed">
          {result.sql}
        </pre>
      )}
    </div>
  )
}

// ─── chat message ────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  question?: string
  result?: QueryResponse
  error?: string
}

const SUGGESTIONS = [
  'Show top customers by revenue',
  'Monthly revenue trend this year',
  'Which products are underperforming?',
  'How many active users do we have?',
]

// ─── main page ───────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { ingestId }  = useParams<{ ingestId: string }>()
  const location      = useLocation()
  const navigate      = useNavigate()
  const scanResult    = location.state as ScanResult | null

  const [tab, setTab]         = useState<'overview' | 'chat'>('overview')
  const [glossary, setGlossary] = useState<GlossaryEntry[]>([])
  const [loadingGlossary, setLoadingGlossary] = useState(true)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [question, setQuestion] = useState('')
  const [querying, setQuerying] = useState(false)
  const inputRef   = useRef<HTMLInputElement>(null)
  const messagesEnd = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ingestId) return
    fetchGlossary(ingestId)
      .then(setGlossary)
      .finally(() => setLoadingGlossary(false))
  }, [ingestId])

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, querying])

  async function handleQuestion(q: string) {
    if (!q.trim() || !ingestId || querying) return
    setQuestion('')
    setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'user', question: q }])
    setQuerying(true)
    try {
      const result = await sendQuery({ ingest_id: ingestId, question: q })
      setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'assistant', result }])
    } catch (e) {
      setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'assistant', error: e instanceof Error ? e.message : String(e) }])
    } finally {
      setQuerying(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    handleQuestion(question)
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">

      {/* ── Header ─────────────────────────────────────────── */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex-shrink-0">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-indigo-600 text-lg select-none">◆</span>
            <span className="font-bold text-gray-900 text-sm">BusinessDNA</span>
            {ingestId && (
              <span className="text-xs text-gray-400 font-mono ml-2 hidden sm:block">
                {ingestId}
              </span>
            )}
          </div>
          <nav className="flex items-center gap-1">
            <button
              onClick={async () => {
                await saveConfig({ last_ingest_id: null })
                navigate('/')
              }}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors cursor-pointer mr-2"
            >
              ← Rescan
            </button>
            {(['overview', 'chat'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors capitalize cursor-pointer
                  ${tab === t
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
              >
                {t}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* ── Content ────────────────────────────────────────── */}
      <main className="flex-1 max-w-5xl w-full mx-auto p-6 flex flex-col">

        {/* ── Overview tab ──────────────────────────────── */}
        {tab === 'overview' && (
          <div className="space-y-6">

            {/* Stats grid */}
            {scanResult && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: 'Files Scanned',   value: scanResult.files_scanned,   accent: false },
                  { label: 'Concepts Found',  value: scanResult.concepts_found,  accent: true  },
                  { label: 'DB Tables',       value: scanResult.tables_indexed,  accent: false },
                  { label: 'Glossary Terms',  value: scanResult.glossary_terms,  accent: true  },
                ].map(({ label, value, accent }) => (
                  <div key={label} className="bg-white rounded-xl border border-gray-200 p-4">
                    <p className="text-xs text-gray-400 mb-1">{label}</p>
                    <p className={`text-2xl font-bold ${accent ? 'text-indigo-600' : 'text-gray-900'}`}>
                      {value ?? '—'}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Business Glossary */}
            <div>
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Business Glossary
              </h2>

              {loadingGlossary ? (
                <div className="grid md:grid-cols-2 gap-3">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="bg-white rounded-xl border border-gray-100 p-4 animate-pulse">
                      <div className="h-4 bg-gray-100 rounded w-1/3 mb-2" />
                      <div className="h-3 bg-gray-100 rounded w-full mb-1" />
                      <div className="h-3 bg-gray-100 rounded w-2/3" />
                    </div>
                  ))}
                </div>
              ) : glossary.length === 0 ? (
                <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
                  <p className="text-gray-400 text-sm">No glossary terms found</p>
                  <p className="text-gray-300 text-xs mt-1">
                    Business concepts will appear here after scanning
                  </p>
                </div>
              ) : (
                <div className="grid md:grid-cols-2 gap-3">
                  {glossary.map(({ term, definition }) => (
                    <div key={term} className="bg-white rounded-xl border border-gray-200 p-4 hover:border-indigo-200 transition-colors">
                      <p className="font-medium text-gray-900 text-sm mb-1">{term}</p>
                      <p className="text-xs text-gray-500 leading-relaxed">{definition}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Chat tab ──────────────────────────────────── */}
        {tab === 'chat' && (
          <div className="flex flex-col flex-1" style={{ height: 'calc(100vh - 120px)' }}>

            {/* Messages area */}
            <div className="flex-1 overflow-y-auto pb-4 space-y-4">

              {/* Empty state */}
              {messages.length === 0 && (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center max-w-sm">
                    <div className="text-indigo-300 text-5xl mb-4 select-none">◆</div>
                    <p className="text-gray-500 text-sm mb-6">
                      Ask a business question in plain English
                    </p>
                    <div className="flex flex-wrap gap-2 justify-center">
                      {SUGGESTIONS.map(s => (
                        <button
                          key={s}
                          onClick={() => handleQuestion(s)}
                          className="text-xs bg-indigo-50 text-indigo-700 px-3 py-1.5 rounded-full
                            hover:bg-indigo-100 transition-colors cursor-pointer"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Message list */}
              {messages.map(msg => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {msg.role === 'user' ? (
                    <div className="bg-indigo-600 text-white rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm max-w-md shadow-sm">
                      {msg.question}
                    </div>
                  ) : (
                    <div className="bg-white rounded-2xl rounded-tl-sm border border-gray-200 p-4 max-w-2xl w-full shadow-sm">
                      {msg.error ? (
                        <p className="text-red-500 text-sm">{msg.error}</p>
                      ) : msg.result ? (
                        <ResultView result={msg.result} />
                      ) : null}
                    </div>
                  )}
                </div>
              ))}

              {/* Typing indicator */}
              {querying && (
                <div className="flex justify-start">
                  <div className="bg-white rounded-2xl border border-gray-200 px-4 py-3 shadow-sm">
                    <div className="flex gap-1 items-center">
                      {[0, 1, 2].map(i => (
                        <div
                          key={i}
                          className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"
                          style={{ animationDelay: `${i * 150}ms` }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEnd} />
            </div>

            {/* Input bar */}
            <div className="flex-shrink-0 pt-3 border-t border-gray-200">
              <form onSubmit={handleSubmit} className="flex gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={question}
                  onChange={e => setQuestion(e.target.value)}
                  placeholder="Ask a business question…"
                  className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm
                    focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                    placeholder:text-gray-400"
                  disabled={querying}
                />
                <button
                  type="submit"
                  disabled={!question.trim() || querying}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40
                    text-white px-5 py-2.5 rounded-xl text-sm font-medium transition-colors cursor-pointer"
                >
                  Ask
                </button>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
