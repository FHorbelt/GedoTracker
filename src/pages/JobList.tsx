import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Plus, Route, Calendar, Upload } from 'lucide-react'
import { useAllMeasurementJobs, deleteMeasurementJob } from '../hooks/useMeasurementJobs'
import { useProjects } from '../hooks/useProjects'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, analyzeImport, executeImport, ImportAnalysis, ImportDecisions } from '../db/database'
import { Card, CardContent } from '../components/common/Card'
import { Button } from '../components/common/Button'
import { Badge } from '../components/common/Badge'
import { EmptyState } from '../components/common/EmptyState'
import { SearchInput } from '../components/common/SearchInput'
import { Modal } from '../components/common/Modal'
import { SwipeToDelete } from '../components/common/SwipeToDelete'
import { useActiveRun } from '../contexts/ActiveRunContext'

export function JobList() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { jobs, isLoading } = useAllMeasurementJobs()
  const { projects } = useProjects()
  const { isRunActive, activeRun } = useActiveRun()
  const [searchQuery, setSearchQuery] = useState('')
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [jobToDelete, setJobToDelete] = useState<string | null>(null)

  // Import state
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [importAnalysis, setImportAnalysis] = useState<ImportAnalysis | null>(null)
  const [importDecisions, setImportDecisions] = useState<ImportDecisions>({})
  const [isImporting, setIsImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

  const handleImport = async () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (file) {
        try {
          setImportError(null)
          const text = await file.text()
          const analysis = await analyzeImport(text)
          setImportAnalysis(analysis)

          const initialDecisions: ImportDecisions = {}
          analysis.conflicts.forEach(conflict => {
            initialDecisions[`${conflict.type}-${conflict.importId}`] = 'rename'
          })
          setImportDecisions(initialDecisions)

          if (!analysis.hasConflicts) {
            setIsImporting(true)
            const newId = await executeImport(analysis, {})
            setIsImporting(false)
            // Navigate to the imported project/job
            if (analysis.exportType === 'job' && analysis.project) {
              navigate(`/projects/${analysis.project.id}/jobs/${analysis.measurementJobs[0]?.id}`)
            } else if (analysis.project) {
              navigate(`/projects/${newId}`)
            }
          } else {
            setImportModalOpen(true)
          }
        } catch (error) {
          console.error('Import failed:', error)
          setImportError(t('import.error') || 'Import fehlgeschlagen')
        }
      }
    }
    input.click()
  }

  const handleImportConfirm = async () => {
    if (!importAnalysis) return
    setIsImporting(true)
    setImportError(null)
    try {
      const newId = await executeImport(importAnalysis, importDecisions)
      setImportModalOpen(false)
      setImportAnalysis(null)
      setIsImporting(false)
      if (importAnalysis.exportType === 'job' && importAnalysis.project) {
        navigate(`/projects/${importAnalysis.project.id}/jobs/${importAnalysis.measurementJobs[0]?.id}`)
      } else {
        navigate(`/projects/${newId}`)
      }
    } catch (error) {
      console.error('Import failed:', error)
      setImportError(t('import.error') || 'Import fehlgeschlagen')
      setIsImporting(false)
    }
  }

  const confirmDelete = (jobId: string) => {
    setJobToDelete(jobId)
    setDeleteModalOpen(true)
  }

  const handleDelete = async () => {
    if (jobToDelete) {
      await deleteMeasurementJob(jobToDelete)
      setDeleteModalOpen(false)
      setJobToDelete(null)
    }
  }

  // Get run counts per job - use stable deps to avoid infinite re-render
  const jobIds = useMemo(() => jobs.map(j => j.id), [jobs])
  const jobIdsKey = jobIds.join(',')
  const runCounts = useLiveQuery(async () => {
    const counts = new Map<string, number>()
    for (const id of jobIds) {
      const count = await db.runs.where('measurementJobId').equals(id).count()
      counts.set(id, count)
    }
    return counts
  }, [jobIdsKey])

  // Build project lookup
  const projectMap = useMemo(() => {
    const map = new Map<string, typeof projects[0]>()
    for (const p of projects) {
      map.set(p.id, p)
    }
    return map
  }, [projects])

  // Filter jobs by search
  const filteredJobs = useMemo(() => {
    if (!searchQuery.trim()) return jobs
    const q = searchQuery.toLowerCase()
    return jobs.filter(job => {
      const project = projectMap.get(job.projectId)
      return (
        job.jobName.toLowerCase().includes(q) ||
        job.jobDate.includes(q) ||
        (project?.projectNumber?.toLowerCase().includes(q)) ||
        (project?.client?.toLowerCase().includes(q)) ||
        (job.object?.toLowerCase().includes(q))
      )
    })
  }, [jobs, searchQuery, projectMap])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Action Buttons */}
      <div className="flex gap-2">
        <Button variant="secondary" onClick={handleImport} className="flex-1">
          <Upload className="w-4 h-4 mr-2" />
          {t('projects.import') || 'Import'}
        </Button>
        <Button
          onClick={() => navigate('/jobs/new')}
          className="flex-1"
          disabled={isRunActive}
        >
          <Plus className="w-4 h-4 mr-2" />
          {isRunActive ? `${t('runs.active')}: ${activeRun?.runName}` : t('jobs.newJob')}
        </Button>
      </div>

      {importError && (
        <div className="p-3 rounded-lg text-sm" style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
          {importError}
        </div>
      )}

      {/* Search */}
      {jobs.length > 3 && (
        <SearchInput
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t('jobs.searchPlaceholder')}
        />
      )}

      {/* Job List */}
      {filteredJobs.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Route className="w-8 h-8" />}
            title={jobs.length === 0 ? t('jobs.noJobs') : t('jobs.noResults')}
            action={jobs.length === 0 ? (
              <Button onClick={() => navigate('/jobs/new')}>
                {t('jobs.newJob')}
              </Button>
            ) : undefined}
          />
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredJobs.map(job => {
            const project = projectMap.get(job.projectId)
            const runCount = runCounts?.get(job.id) || 0

            return (
              <SwipeToDelete key={job.id} onDelete={() => confirmDelete(job.id)}>
                <Card
                  hoverable
                  onClick={() => navigate(`/projects/${job.projectId}/jobs/${job.id}`)}
                >
                  <CardContent className="py-3">
                    <div className="flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium" style={{ color: 'var(--color-text)' }}>
                          {job.jobName}
                        </div>
                        <div className="text-sm flex items-center gap-2" style={{ color: 'var(--color-text-muted)' }}>
                          <Calendar className="w-3 h-3" />
                          {job.jobDate}
                          {project && (
                            <span> &middot; {project.projectNumber}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="info">{runCount} Runs</Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </SwipeToDelete>
            )
          })}
        </div>
      )}

      <Modal
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title={t('measurementJob.delete')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteModalOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={handleDelete}>
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <p>{t('measurementJob.deleteConfirm')}</p>
      </Modal>

      {/* Import conflict resolution modal */}
      <Modal
        isOpen={importModalOpen}
        onClose={() => { setImportModalOpen(false); setImportAnalysis(null) }}
        title={t('import.importProject') || 'Import'}
        footer={
          <>
            <Button variant="secondary" onClick={() => { setImportModalOpen(false); setImportAnalysis(null) }} disabled={isImporting}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleImportConfirm} disabled={isImporting}>
              {isImporting ? '...' : (t('import.import') || 'Importieren')}
            </Button>
          </>
        }
      >
        {importAnalysis && (
          <div className="space-y-3">
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              <strong>{importAnalysis.exportType === 'job' ? (t('import.importJob') || 'Job-Import') : (t('import.importProject') || 'Projekt-Import')}:</strong>{' '}
              {importAnalysis.project?.projectNumber || '-'}
            </p>
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              {importAnalysis.measurementJobs.length} {t('import.jobs') || 'Jobs'},{' '}
              {importAnalysis.runs.length} {t('import.runs') || 'Runs'}
            </p>
            {importAnalysis.conflicts.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-semibold" style={{ color: '#f59e0b' }}>
                  {t('import.conflicts') || 'Konflikte'}:
                </p>
                {importAnalysis.conflicts.map(conflict => (
                  <div key={`${conflict.type}-${conflict.importId}`} className="p-2 rounded text-sm" style={{ backgroundColor: 'var(--color-bg-input)', border: '1px solid var(--color-border)' }}>
                    <div style={{ color: 'var(--color-text)' }}>{conflict.type}: {conflict.name}</div>
                    <div className="flex gap-2 mt-1">
                      <button
                        className={`px-2 py-1 rounded text-xs ${importDecisions[`${conflict.type}-${conflict.importId}`] === 'rename' ? 'font-bold' : ''}`}
                        style={{
                          backgroundColor: importDecisions[`${conflict.type}-${conflict.importId}`] === 'rename' ? '#3b82f6' : 'var(--color-bg-card)',
                          color: importDecisions[`${conflict.type}-${conflict.importId}`] === 'rename' ? 'white' : 'var(--color-text)'
                        }}
                        onClick={() => setImportDecisions(prev => ({ ...prev, [`${conflict.type}-${conflict.importId}`]: 'rename' }))}
                      >
                        {t('import.rename') || 'Umbenennen'}
                      </button>
                      <button
                        className={`px-2 py-1 rounded text-xs ${importDecisions[`${conflict.type}-${conflict.importId}`] === 'overwrite' ? 'font-bold' : ''}`}
                        style={{
                          backgroundColor: importDecisions[`${conflict.type}-${conflict.importId}`] === 'overwrite' ? '#ef4444' : 'var(--color-bg-card)',
                          color: importDecisions[`${conflict.type}-${conflict.importId}`] === 'overwrite' ? 'white' : 'var(--color-text)'
                        }}
                        onClick={() => setImportDecisions(prev => ({ ...prev, [`${conflict.type}-${conflict.importId}`]: 'overwrite' }))}
                      >
                        {t('import.overwrite') || 'Überschreiben'}
                      </button>
                      <button
                        className={`px-2 py-1 rounded text-xs ${importDecisions[`${conflict.type}-${conflict.importId}`] === 'skip' ? 'font-bold' : ''}`}
                        style={{
                          backgroundColor: importDecisions[`${conflict.type}-${conflict.importId}`] === 'skip' ? '#6b7280' : 'var(--color-bg-card)',
                          color: importDecisions[`${conflict.type}-${conflict.importId}`] === 'skip' ? 'white' : 'var(--color-text)'
                        }}
                        onClick={() => setImportDecisions(prev => ({ ...prev, [`${conflict.type}-${conflict.importId}`]: 'skip' }))}
                      >
                        {t('import.skip') || 'Überspringen'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {importError && (
              <p className="text-sm" style={{ color: '#ef4444' }}>{importError}</p>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
