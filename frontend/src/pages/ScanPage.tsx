import { useEffect, useState, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { streamScan, saveConfig } from '../api'
import type { ScanProgress, ScanResult, SetupFormData } from '../types'

const PHASES: { key: ScanProgress['phase']; label: string }[] = [
  { key: 'discovering',  label: 'Discovering source files'  },
  { key: 'extracting',   label: 'Extracting business concepts' },
  { key: 'consolidating',label: 'Consolidating definitions' },
  { key: 'ingesting',    label: 'Indexing schema & context' },
  { key: 'done',         label: 'Complete'                  },
]

function phaseIndex(phase: ScanProgress['phase'] | undefined) {
  return phase ? PHASES.findIndex(p => p.key === phase) : -1
}

export default function ScanPage() {
  const location  = useLocation()
  const navigate  = useNavigate()
  const form      = location.state as SetupFormData | null
  const started   = useRef(false)

  const [progress, setProgress] = useState<ScanProgress | null>(null)
  const [recentFiles, setRecentFiles] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const logsEnd = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!form || started.current) return
    started.current = true;

    (async () => {
      try {
        for await (const evt of streamScan({ repo_path: form.repo_path, target_dsn: form.target_dsn, schema_filter: form.schema_filter })) {
          if (evt.event === 'progress') {
            const p = evt.data as ScanProgress
            setProgress(p)
            if (p.current_file) {
              setRecentFiles(prev => [...prev.slice(-49), p.current_file!])
            }
          } else if (evt.event === 'result') {
            const result = evt.data as ScanResult
            await saveConfig({ last_ingest_id: result.ingest_id })
            navigate('/dashboard/' + result.ingest_id, { state: result })
          } else if (evt.event === 'error') {
            setError((evt.data as { message: string }).message)
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    logsEnd.current?.scrollIntoView({ behavior: 'smooth' })
  }, [recentFiles])

  // Guard: if navigated here without state, go back to setup
  if (!form) {
    navigate('/', { replace: true })
    return null
  }

  const current = phaseIndex(progress?.phase ?? undefined)

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-2">
            <span className="text-indigo-600 text-2xl select-none">◆</span>
            <span className="text-xl font-bold text-gray-900">BusinessDNA</span>
          </div>
          <p className="text-gray-500 text-sm">
            {error ? 'Analysis failed' : 'Analyzing your codebase…'}
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-5">
          {error ? (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <p className="text-red-700 text-sm font-medium mb-1">Something went wrong</p>
              <p className="text-red-600 text-sm">{error}</p>
              <button
                onClick={() => navigate('/')}
                className="mt-3 text-sm text-red-700 underline cursor-pointer"
              >
                ← Back to setup
              </button>
            </div>
          ) : (
            <>
              {/* Phase stepper */}
              <div className="space-y-3">
                {PHASES.map(({ key, label }, i) => {
                  const state = i < current ? 'done' : i === current ? 'active' : 'pending'
                  return (
                    <div key={key} className="flex items-center gap-3">
                      {/* step indicator */}
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 transition-colors
                        ${state === 'done'   ? 'bg-green-500 text-white'
                        : state === 'active' ? 'bg-indigo-600 text-white'
                        :                      'bg-gray-100 text-gray-300'}`}>
                        {state === 'done' ? '✓' : i + 1}
                      </div>
                      {/* label */}
                      <span className={`text-sm transition-colors
                        ${state === 'active' ? 'font-medium text-gray-900'
                        : state === 'done'   ? 'text-gray-400'
                        :                      'text-gray-200'}`}>
                        {label}
                      </span>
                      {/* progress bar for active step */}
                      {state === 'active' && progress && progress.files_total > 0 && (
                        <div className="ml-auto h-1.5 w-24 bg-gray-100 rounded-full overflow-hidden flex-shrink-0">
                          <div
                            className="h-full bg-indigo-500 rounded-full transition-all duration-300"
                            style={{ width: `${Math.min(100, (progress.files_processed / progress.files_total) * 100)}%` }}
                          />
                        </div>
                      )}
                      {state === 'active' && (!progress || progress.files_total === 0) && (
                        <div className="ml-auto h-1.5 w-24 bg-indigo-100 rounded-full overflow-hidden flex-shrink-0">
                          <div className="h-full w-1/2 bg-indigo-400 rounded-full animate-pulse" />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Live stats */}
              {progress && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-gray-50 rounded-xl p-3">
                    <p className="text-xs text-gray-400 mb-0.5">Files processed</p>
                    <p className="text-lg font-semibold text-gray-900">
                      {progress.files_processed}
                      {progress.files_total > 0 && (
                        <span className="text-sm font-normal text-gray-400">
                          {' '}/ {progress.files_total}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="bg-indigo-50 rounded-xl p-3">
                    <p className="text-xs text-indigo-400 mb-0.5">Concepts found</p>
                    <p className="text-lg font-semibold text-indigo-700">
                      {progress.concepts_found}
                    </p>
                  </div>
                </div>
              )}

              {/* File log */}
              {recentFiles.length > 0 && (
                <div className="bg-gray-950 rounded-xl p-3 h-32 overflow-y-auto">
                  {recentFiles.map((file, i) => (
                    <p key={i} className="font-mono text-xs text-gray-400 leading-5">
                      <span className="text-indigo-400 mr-2">›</span>{file}
                    </p>
                  ))}
                  <div ref={logsEnd} />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
