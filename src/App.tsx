import { Routes, Route } from 'react-router-dom'
import { Layout } from './components/layout/Layout'
import { ActiveRunProvider } from './contexts/ActiveRunContext'
import { Dashboard } from './pages/Dashboard'
import { ProjectList } from './pages/ProjectList'
import { ProjectDetail } from './pages/ProjectDetail'
import { ProjectForm } from './pages/ProjectForm'
import { RunEditor } from './pages/RunEditor'
import { FixedPointManager } from './pages/FixedPointManager'
import { Settings } from './pages/Settings'

function App() {
  return (
    <ActiveRunProvider>
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/projects" element={<ProjectList />} />
        <Route path="/projects/new" element={<ProjectForm />} />
        <Route path="/projects/:id" element={<ProjectDetail />} />
        <Route path="/projects/:id/edit" element={<ProjectForm />} />
        <Route path="/projects/:projectId/runs/new" element={<RunEditor />} />
        <Route path="/projects/:projectId/runs/:runId" element={<RunEditor />} />
        <Route path="/fixedpoints" element={<FixedPointManager />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </Layout>
    </ActiveRunProvider>
  )
}

export default App
