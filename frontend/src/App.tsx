import { useEffect, useState } from 'react'
import { Routes, Route, useNavigate } from 'react-router-dom'
import { fetchConfig } from './api'
import SetupPage from './pages/SetupPage'
import ScanPage from './pages/ScanPage'
import DashboardPage from './pages/DashboardPage'

export default function App() {
  const navigate = useNavigate()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    fetchConfig()
      .then(config => {
        if (config.last_ingest_id) {
          navigate(`/dashboard/${config.last_ingest_id}`, { replace: true })
        }
      })
      .finally(() => setReady(true))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready) return null

  return (
    <Routes>
      <Route path="/"                    element={<SetupPage />} />
      <Route path="/scan"                element={<ScanPage />} />
      <Route path="/dashboard/:ingestId" element={<DashboardPage />} />
    </Routes>
  )
}
