import { Component, type ReactNode } from 'react'
import { Routes, Route } from 'react-router-dom'
import { Layout } from './components/layout/Layout'
import { UpdatePrompt } from './components/UpdatePrompt'
import { ActiveRunProvider } from './contexts/ActiveRunContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { Dashboard } from './pages/Dashboard'
import { ProjectList } from './pages/ProjectList'
import { ProjectDetail } from './pages/ProjectDetail'
import { ProjectForm } from './pages/ProjectForm'
import { MeasurementJobForm } from './pages/MeasurementJobForm'
import { MeasurementJobDetail } from './pages/MeasurementJobDetail'
import { RunEditor } from './pages/RunEditor'
import { FixedPointManager } from './pages/FixedPointManager'
import { Settings } from './pages/Settings'
import { EmployeeManager } from './pages/EmployeeManager'
import { JobList } from './pages/JobList'
import { MX9Calibration } from './pages/MX9Calibration'

class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error('App Error:', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '2rem',
          textAlign: 'center',
          fontFamily: 'system-ui, sans-serif',
          color: '#1e293b',
          backgroundColor: '#f8fafc',
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1rem',
        }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Ein Fehler ist aufgetreten</h2>
          <p style={{ color: '#64748b', fontSize: '0.875rem', maxWidth: '400px' }}>
            {this.state.error?.message || 'Unbekannter Fehler'}
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
            <button
              onClick={() => { this.setState({ hasError: false, error: null }); window.location.hash = '#/' }}
              style={{
                padding: '0.5rem 1.5rem',
                borderRadius: '0.5rem',
                border: '1px solid #cbd5e1',
                backgroundColor: 'white',
                cursor: 'pointer',
                fontSize: '0.875rem',
              }}
            >
              Zur Startseite
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '0.5rem 1.5rem',
                borderRadius: '0.5rem',
                border: 'none',
                backgroundColor: '#1e40af',
                color: 'white',
                cursor: 'pointer',
                fontSize: '0.875rem',
              }}
            >
              Neu laden
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <ActiveRunProvider>
          <Layout>
            <UpdatePrompt />
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/jobs" element={<JobList />} />
              <Route path="/jobs/new" element={<MeasurementJobForm />} />
              <Route path="/projects" element={<ProjectList />} />
              <Route path="/projects/new" element={<ProjectForm />} />
              <Route path="/projects/:id" element={<ProjectDetail />} />
              <Route path="/projects/:id/edit" element={<ProjectForm />} />

              {/* Messjob-Routen */}
              <Route path="/projects/:projectId/jobs/new" element={<MeasurementJobForm />} />
              <Route path="/projects/:projectId/jobs/:jobId" element={<MeasurementJobDetail />} />
              <Route path="/projects/:projectId/jobs/:jobId/edit" element={<MeasurementJobForm />} />

              {/* Messfahrt-Routen innerhalb von Messjobs (NEU) */}
              <Route path="/projects/:projectId/jobs/:jobId/runs/new" element={<RunEditor />} />
              <Route path="/projects/:projectId/jobs/:jobId/runs/:runId" element={<RunEditor />} />

              {/* Legacy: Messfahrten direkt im Projekt (für Abwärtskompatibilität) */}
              <Route path="/projects/:projectId/runs/new" element={<RunEditor />} />
              <Route path="/projects/:projectId/runs/:runId" element={<RunEditor />} />

              <Route path="/fixedpoints" element={<FixedPointManager />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/settings/employees" element={<EmployeeManager />} />
              <Route path="/settings/mx9-calibration" element={<MX9Calibration />} />
            </Routes>
          </Layout>
        </ActiveRunProvider>
      </ThemeProvider>
    </ErrorBoundary>
  )
}

export default App
