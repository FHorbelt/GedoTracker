import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Plus, Edit, Trash2, Download, Briefcase, Upload,
  Calendar, AlertTriangle, FileText, Users, MapPin, Image, List, LayoutList
} from 'lucide-react'
import { useProject, deleteProject } from '../hooks/useProjects'
import { useMeasurementJobs, deleteMeasurementJob } from '../hooks/useMeasurementJobs'
import { useActiveRun } from '../contexts/ActiveRunContext'
import { Card, CardContent, CardHeader } from '../components/common/Card'
import { Button } from '../components/common/Button'
import { EmptyState } from '../components/common/EmptyState'
import { Modal } from '../components/common/Modal'
import { Badge } from '../components/common/Badge'
import { SwipeToDelete } from '../components/common/SwipeToDelete'
import { exportProject } from '../utils/export'
import { useSettings } from '../hooks/useSettings'
import { useLogo } from '../hooks/useLogos'
import { db, analyzeImport, executeImport, ImportAnalysis, ImportConflict, ConflictResolution, ImportDecisions } from '../db/database'
import { useLiveQuery } from 'dexie-react-hooks'

export function ProjectDetail() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { project, isLoading: projectLoading } = useProject(id)
  const { jobs, isLoading: jobsLoading } = useMeasurementJobs(id)
  const { settings, currentLanguage, updateSettings } = useSettings()
  const isCompact = settings?.compactView ?? false

  const toggleCompactView = () => {
    updateSettings({ compactView: !isCompact })
  }
  const { logo: companyLogo } = useLogo(project?.logoId)
  const { isRunActive } = useActiveRun()

  // Job IDs als stabiler Key für die Dependency
  const jobIds = jobs.map(j => j.id).join(',')

  // Zähle Runs pro Job
  const runCounts = useLiveQuery(async () => {
    if (!id) return {}
    const allJobs = await db.measurementJobs.where('projectId').equals(id).toArray()
    if (allJobs.length === 0) return {}
    const counts: Record<string, number> = {}
    for (const job of allJobs) {
      counts[job.id] = await db.runs.where('measurementJobId').equals(job.id).count()
    }
    return counts
  }, [id, jobIds])

  const [deleteProjectModal, setDeleteProjectModal] = useState(false)
  const [deleteJobModal, setDeleteJobModal] = useState(false)
  const [jobToDelete, setJobToDelete] = useState<string | null>(null)
  const [exportModalOpen, setExportModalOpen] = useState(false)

  // Import state
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [importAnalysis, setImportAnalysis] = useState<ImportAnalysis | null>(null)
  const [importDecisions, setImportDecisions] = useState<ImportDecisions>({})
  const [isImporting, setIsImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

  const isLoading = projectLoading || jobsLoading

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    )
  }

  if (!project) {
    return (
      <EmptyState
        icon={<Briefcase className="w-8 h-8" />}
        title={t('common.noData')}
        action={<Button onClick={() => navigate('/projects')}>{t('common.back')}</Button>}
      />
    )
  }

  const handleDeleteProject = async () => {
    await deleteProject(project.id)
    navigate('/projects')
  }

  const handleDeleteJob = async () => {
    if (jobToDelete) {
      await deleteMeasurementJob(jobToDelete)
      setDeleteJobModal(false)
      setJobToDelete(null)
    }
  }

  const handleExport = async (format: 'pdf' | 'excel' | 'json') => {
    if (!project) return

    // Alle Runs für alle Jobs dieses Projekts laden
    const jobIds = jobs.map(j => j.id)
    const allRuns = jobIds.length > 0
      ? await db.runs.where('measurementJobId').anyOf(jobIds).toArray()
      : []

    await exportProject({
      format,
      project,
      jobs,
      runs: allRuns,
      language: currentLanguage as 'de' | 'en'
    })
    setExportModalOpen(false)
  }

  // === Job Import Functions ===
  const handleImportJob = async () => {
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

          // Remove project conflict since we're adding to existing project
          const filteredConflicts = analysis.conflicts.filter(c => c.type !== 'project')
          const modifiedAnalysis = {
            ...analysis,
            conflicts: filteredConflicts,
            hasConflicts: filteredConflicts.length > 0
          }

          setImportAnalysis(modifiedAnalysis)

          // Initialize decisions
          const initialDecisions: ImportDecisions = {}
          filteredConflicts.forEach(conflict => {
            initialDecisions[`${conflict.type}-${conflict.importId}`] = 'rename'
          })
          setImportDecisions(initialDecisions)

          if (!modifiedAnalysis.hasConflicts) {
            // No conflicts, import directly into this project
            setIsImporting(true)
            await importJobToProject(modifiedAnalysis)
            setIsImporting(false)
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

  const importJobToProject = async (analysis: ImportAnalysis) => {
    if (!project || !id) return

    // Import supporting data (employees, fixedPointFields, logo) with conflict resolution
    await db.transaction('rw', [db.measurementJobs, db.runs, db.fixedPointFields, db.employees, db.logos], async () => {
      const employeeIdMap = new Map<string, string>()
      const fieldIdMap = new Map<string, string>()

      // Process employees
      for (const emp of analysis.employees) {
        const decision = importDecisions[`employee-${emp.id}`]
        if (decision === 'skip') {
          const existing = await db.employees.filter(e => e.name === emp.name).first()
          if (existing) employeeIdMap.set(emp.id, existing.id)
          continue
        }

        const newId = decision === 'overwrite'
          ? (await db.employees.filter(e => e.name === emp.name).first())?.id || crypto.randomUUID()
          : crypto.randomUUID()

        employeeIdMap.set(emp.id, newId)

        const empToSave = {
          ...emp,
          id: newId,
          name: decision === 'rename' ? `${emp.name} (Import)` : emp.name
        }

        const existing = await db.employees.get(newId)
        if (existing) {
          await db.employees.update(newId, empToSave)
        } else {
          await db.employees.add(empToSave)
        }
      }

      // Process fixed point fields
      for (const field of analysis.fixedPointFields) {
        const decision = importDecisions[`fixedPointField-${field.id}`]
        if (decision === 'skip') {
          const existing = await db.fixedPointFields.filter(f => f.name === field.name).first()
          if (existing) fieldIdMap.set(field.id, existing.id)
          continue
        }

        const newId = decision === 'overwrite'
          ? (await db.fixedPointFields.filter(f => f.name === field.name).first())?.id || crypto.randomUUID()
          : crypto.randomUUID()

        fieldIdMap.set(field.id, newId)

        const fieldToSave = {
          ...field,
          id: newId,
          name: decision === 'rename' ? `${field.name} (Import)` : field.name
        }

        const existing = await db.fixedPointFields.get(newId)
        if (existing) {
          await db.fixedPointFields.update(newId, fieldToSave)
        } else {
          await db.fixedPointFields.add(fieldToSave)
        }
      }

      // Import jobs into this project
      const jobIdMap = new Map<string, string>()
      for (const job of analysis.measurementJobs) {
        const newJobId = crypto.randomUUID()
        jobIdMap.set(job.id, newJobId)

        const updatedEmployeeIds = (job.employeeIds || []).map(empId => employeeIdMap.get(empId) || empId)
        const updatedFieldId = job.fixedPointFieldId ? (fieldIdMap.get(job.fixedPointFieldId) || job.fixedPointFieldId) : undefined

        await db.measurementJobs.add({
          ...job,
          id: newJobId,
          projectId: id, // Use current project ID
          employeeIds: updatedEmployeeIds,
          fixedPointFieldId: updatedFieldId
        })
      }

      // Import runs
      for (const run of analysis.runs) {
        await db.runs.add({
          ...run,
          id: crypto.randomUUID(),
          projectId: id,
          measurementJobId: jobIdMap.get(run.measurementJobId) || run.measurementJobId
        })
      }
    })
  }

  const handleImportConfirm = async () => {
    if (!importAnalysis) return

    setIsImporting(true)
    setImportError(null)

    try {
      await importJobToProject(importAnalysis)
      setImportModalOpen(false)
      setImportAnalysis(null)
      setImportDecisions({})
    } catch (error) {
      console.error('Import failed:', error)
      setImportError(t('import.error') || 'Import fehlgeschlagen')
    } finally {
      setIsImporting(false)
    }
  }

  const handleImportCancel = () => {
    setImportModalOpen(false)
    setImportAnalysis(null)
    setImportDecisions({})
    setImportError(null)
  }

  const setConflictDecision = (conflict: ImportConflict, decision: ConflictResolution) => {
    setImportDecisions(prev => ({
      ...prev,
      [`${conflict.type}-${conflict.importId}`]: decision
    }))
  }

  const getConflictIcon = (type: ImportConflict['type']) => {
    switch (type) {
      case 'project': return <FileText className="w-4 h-4" />
      case 'fixedPointField': return <MapPin className="w-4 h-4" />
      case 'employee': return <Users className="w-4 h-4" />
      case 'logo': return <Image className="w-4 h-4" />
    }
  }

  const getConflictTypeLabel = (type: ImportConflict['type']) => {
    switch (type) {
      case 'project': return t('import.conflictType.project') || 'Projekt'
      case 'fixedPointField': return t('import.conflictType.fixedPointField') || 'Festpunktfeld'
      case 'employee': return t('import.conflictType.employee') || 'Mitarbeiter'
      case 'logo': return t('import.conflictType.logo') || 'Firmenlogo'
    }
  }

  // Gesamtanzahl der Runs berechnen
  const totalRuns = runCounts ? Object.values(runCounts).reduce((sum, count) => sum + count, 0) : 0

  return (
    <div className="space-y-4">
      {/* Project Info */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <h2 className="text-lg font-semibold truncate" style={{ color: 'var(--color-text)' }}>{project.projectNumber}</h2>
            {isCompact && (
              <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                • {jobs.length} Jobs / {totalRuns} Runs
              </span>
            )}
          </div>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleCompactView}
              title={isCompact ? (t('common.expandView') || 'Erweiterte Ansicht') : (t('common.compactView') || 'Kompakte Ansicht')}
            >
              {isCompact ? <LayoutList className="w-4 h-4" /> : <List className="w-4 h-4" />}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setExportModalOpen(true)}>
              <Download className="w-4 h-4" />
            </Button>
            {!isCompact && (
              <Button variant="ghost" size="sm" onClick={() => navigate(`/projects/${id}/edit`)}>
                <Edit className="w-4 h-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="text-red-600"
              onClick={() => setDeleteProjectModal(true)}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </CardHeader>
        {!isCompact && (
          <CardContent className="space-y-3">
            {companyLogo && (
              <div>
                <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{t('projects.company')}</div>
                <div className="font-medium" style={{ color: 'var(--color-text)' }}>{companyLogo.name}</div>
              </div>
            )}
            {project.client && (
              <div>
                <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{t('projects.client')}</div>
                <div className="font-medium" style={{ color: 'var(--color-text)' }}>{project.client}</div>
              </div>
            )}
            {project.constructionProject && (
              <div>
                <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{t('projects.constructionProject')}</div>
                <div className="font-medium" style={{ color: 'var(--color-text)' }}>{project.constructionProject}</div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{t('projects.startDate') || 'Startdatum'}</div>
                <div className="flex items-center gap-1" style={{ color: 'var(--color-text)' }}>
                  <Calendar className="w-4 h-4" style={{ color: 'var(--color-text-muted)' }} />
                  <span>{project.startDate}</span>
                </div>
              </div>
              <div>
                <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{t('projects.summary') || 'Zusammenfassung'}</div>
                <div style={{ color: 'var(--color-text)' }}>
                  {jobs.length} {t('measurementJob.jobs')} / {totalRuns} {t('runs.title')}
                </div>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Messjobs */}
      <div>
        <h2 className="text-lg font-semibold mb-3" style={{ color: 'var(--color-text)' }}>
          {t('measurementJob.jobs')} ({jobs.length})
        </h2>

        <div className="flex gap-2 mb-3">
          <Button
            variant="secondary"
            onClick={handleImportJob}
            className="flex-1"
          >
            <Upload className="w-4 h-4 mr-2" />
            {t('measurementJob.import') || 'Job importieren'}
          </Button>
          <Button
            onClick={() => navigate(`/projects/${id}/jobs/new`)}
            className="flex-1"
          >
            <Plus className="w-4 h-4 mr-2" />
            {t('measurementJob.new')}
          </Button>
        </div>

        {jobs.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Briefcase className="w-8 h-8" />}
              title={t('measurementJob.noJobs') || 'Keine Messjobs vorhanden'}
              action={
                <Button onClick={() => navigate(`/projects/${id}/jobs/new`)}>
                  {t('measurementJob.new')}
                </Button>
              }
            />
          </Card>
        ) : (
          <div className="space-y-2">
            {jobs.map(job => {
              const runCount = runCounts?.[job.id] || 0
              return (
                <SwipeToDelete key={job.id} onDelete={() => {
                  setJobToDelete(job.id)
                  setDeleteJobModal(true)
                }}>
                  <Card
                    hoverable
                    onClick={() => navigate(`/projects/${id}/jobs/${job.id}`)}
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
      </div>

      {/* Delete Project Modal */}
      <Modal
        isOpen={deleteProjectModal}
        onClose={() => setDeleteProjectModal(false)}
        title={t('projects.delete')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteProjectModal(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={handleDeleteProject}>
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <p>{t('projects.deleteConfirm')}</p>
        {jobs.length > 0 && (
          <p className="mt-2 text-sm text-red-600">
            {t('projects.deleteJobsWarning', { count: jobs.length }) || `Es werden auch alle ${jobs.length} Messjobs gelöscht!`}
          </p>
        )}
      </Modal>

      {/* Delete Job Modal */}
      <Modal
        isOpen={deleteJobModal}
        onClose={() => setDeleteJobModal(false)}
        title={t('measurementJob.delete')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteJobModal(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={handleDeleteJob}>
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <p>{t('measurementJob.deleteConfirm')}</p>
      </Modal>

      {/* Export Modal */}
      <Modal
        isOpen={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
        title={t('export.title')}
      >
        <div className="grid grid-cols-3 gap-3">
          <Button variant="secondary" onClick={() => handleExport('pdf')}>
            {t('export.pdf')}
          </Button>
          <Button variant="secondary" onClick={() => handleExport('excel')}>
            {t('export.excel')}
          </Button>
          <Button variant="secondary" onClick={() => handleExport('json')}>
            {t('export.json')}
          </Button>
        </div>
      </Modal>

      {/* Import Job Modal */}
      <Modal
        isOpen={importModalOpen}
        onClose={handleImportCancel}
        title={t('import.conflictTitle') || 'Import-Konflikte'}
        footer={
          <>
            <Button variant="secondary" onClick={handleImportCancel} disabled={isImporting}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleImportConfirm} disabled={isImporting}>
              {isImporting ? (t('import.importing') || 'Importiere...') : (t('import.confirm') || 'Importieren')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {/* Import Summary */}
          {importAnalysis && (
            <div className="p-3 rounded-lg text-sm" style={{
              backgroundColor: 'var(--color-bg)',
              border: '1px solid var(--color-border)'
            }}>
              <p style={{ color: 'var(--color-text)' }}>
                <strong>{t('import.importJob') || 'Job-Import'}:</strong>{' '}
                {importAnalysis.measurementJobs[0]?.jobName || '-'}
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                {importAnalysis.measurementJobs.length} {t('import.jobs') || 'Jobs'},{' '}
                {importAnalysis.runs.length} {t('import.runs') || 'Fahrten'},{' '}
                {importAnalysis.fixedPointFields.length} {t('import.fixedPointFields') || 'Festpunktfelder'}
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                → {t('import.intoProject') || 'In Projekt'}: <strong>{project?.projectNumber}</strong>
              </p>
            </div>
          )}

          {/* Conflicts */}
          {importAnalysis?.conflicts && importAnalysis.conflicts.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                <AlertTriangle className="w-4 h-4 text-yellow-500" />
                <span>{t('import.conflictsFound') || 'Folgende Elemente existieren bereits:'}</span>
              </div>

              {importAnalysis.conflicts.map((conflict) => (
                <div
                  key={`${conflict.type}-${conflict.importId}`}
                  className="p-3 rounded-lg"
                  style={{
                    backgroundColor: 'var(--color-bg)',
                    border: '1px solid var(--color-border)'
                  }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    {getConflictIcon(conflict.type)}
                    <span className="text-xs px-2 py-0.5 rounded" style={{
                      backgroundColor: 'rgba(59, 130, 246, 0.2)',
                      color: '#3b82f6'
                    }}>
                      {getConflictTypeLabel(conflict.type)}
                    </span>
                    <span className="font-medium" style={{ color: 'var(--color-text)' }}>
                      {conflict.name}
                    </span>
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setConflictDecision(conflict, 'overwrite')}
                      className="flex-1 py-1.5 px-2 rounded text-xs font-medium transition-colors"
                      style={{
                        backgroundColor: importDecisions[`${conflict.type}-${conflict.importId}`] === 'overwrite'
                          ? '#ef4444' : 'var(--color-bg-input)',
                        color: importDecisions[`${conflict.type}-${conflict.importId}`] === 'overwrite'
                          ? 'white' : 'var(--color-text)',
                        border: `1px solid ${importDecisions[`${conflict.type}-${conflict.importId}`] === 'overwrite'
                          ? '#ef4444' : 'var(--color-border-input)'}`
                      }}
                    >
                      {t('import.overwrite') || 'Überschreiben'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConflictDecision(conflict, 'rename')}
                      className="flex-1 py-1.5 px-2 rounded text-xs font-medium transition-colors"
                      style={{
                        backgroundColor: importDecisions[`${conflict.type}-${conflict.importId}`] === 'rename'
                          ? '#3b82f6' : 'var(--color-bg-input)',
                        color: importDecisions[`${conflict.type}-${conflict.importId}`] === 'rename'
                          ? 'white' : 'var(--color-text)',
                        border: `1px solid ${importDecisions[`${conflict.type}-${conflict.importId}`] === 'rename'
                          ? '#3b82f6' : 'var(--color-border-input)'}`
                      }}
                    >
                      {t('import.rename') || 'Umbenennen'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConflictDecision(conflict, 'skip')}
                      className="flex-1 py-1.5 px-2 rounded text-xs font-medium transition-colors"
                      style={{
                        backgroundColor: importDecisions[`${conflict.type}-${conflict.importId}`] === 'skip'
                          ? '#6b7280' : 'var(--color-bg-input)',
                        color: importDecisions[`${conflict.type}-${conflict.importId}`] === 'skip'
                          ? 'white' : 'var(--color-text)',
                        border: `1px solid ${importDecisions[`${conflict.type}-${conflict.importId}`] === 'skip'
                          ? '#6b7280' : 'var(--color-border-input)'}`
                      }}
                    >
                      {t('import.skip') || 'Überspringen'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Error Message */}
          {importError && (
            <div className="p-3 rounded-lg text-sm text-red-600" style={{
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)'
            }}>
              {importError}
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}
