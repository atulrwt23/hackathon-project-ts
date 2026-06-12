import { useState, useEffect, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchConfig, saveConfig } from '../api'
import type { SetupFormData } from '../types'

export default function SetupPage() {
  const navigate = useNavigate()
  const [form, setForm] = useState<SetupFormData>({ repo_path: '', target_dsn: '', schema_filter: 'public' })

  useEffect(() => {
    fetchConfig().then(config => {
      setForm(f => ({
        repo_path: config.repo_path ?? f.repo_path,
        target_dsn: config.target_dsn ?? f.target_dsn,
        schema_filter: config.schema_filter?.join(', ') ?? f.schema_filter,
      }))
    }).catch(() => {})
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    await saveConfig({
      repo_path: form.repo_path,
      target_dsn: form.target_dsn,
      schema_filter: form.schema_filter.split(',').map(s => s.trim()).filter(Boolean),
    })
    navigate('/scan', { state: form })
  }

  function set(key: keyof SetupFormData) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm(f => ({ ...f, [key]: e.target.value }))
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-2">
            <span className="text-indigo-600 text-3xl select-none">◆</span>
            <span className="text-2xl font-bold text-gray-900">BusinessDNA</span>
          </div>
          <p className="text-gray-500 text-sm">Teach AI how your business works</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-4">
          <form onSubmit={handleSubmit} className="space-y-4">

            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">
                Repository Path
              </label>
              <input
                type="text"
                value={form.repo_path}
                onChange={set('repo_path')}
                placeholder="/Users/you/company/ecommerce-app"
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm
                  focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                  placeholder:text-gray-400"
                required
              />
              <p className="text-xs text-gray-400">
                Absolute path to the application codebase to analyze
              </p>
            </div>

            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">
                Database Connection String
              </label>
              <input
                type="text"
                value={form.target_dsn}
                onChange={set('target_dsn')}
                placeholder="postgresql://user:pass@host:5432/mydb"
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm
                  focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                  placeholder:text-gray-400"
                required
              />
              <p className="text-xs text-gray-400">
                Read-only access is sufficient — no data is copied
              </p>
            </div>

            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">
                DB Schema(s) to Scan
              </label>
              <input
                type="text"
                value={form.schema_filter}
                onChange={set('schema_filter')}
                placeholder="public"
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm
                  focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                  placeholder:text-gray-400"
              />
              <p className="text-xs text-gray-400">
                Comma-separated list of schemas to index (e.g. <code className="bg-gray-100 px-1 rounded">public</code> or <code className="bg-gray-100 px-1 rounded">public, app</code>)
              </p>
            </div>

            <button
              type="submit"
              className="w-full bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800
                text-white font-medium py-2.5 rounded-lg text-sm transition-colors cursor-pointer"
            >
              Analyze Business
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">
          Analysis runs locally — nothing leaves your machine except API calls to Anthropic
        </p>
      </div>
    </div>
  )
}
