import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Plus, FolderOpen, Upload, Trash2, Download, AlertTriangle, FileText, Users, MapPin, Image } from 'lucide-react'
import { useProjects, deleteProject } from '../hooks/useProjects'
import { Card, CardContent } from '../components/common/Card'
import { Button } from '../components/common/Button'
import { SearchInput } from '../components/common/SearchInput'
import { EmptyState } from '../components/common/EmptyState'
import { Modal } from '../components/common/Modal'
import { SwipeToDelete } from '../components/common/SwipeToDelete'
import { exportProject, analyzeImport, executeImport, ImportAnalysis, ImportConflict, ConflictResolution, ImportDecisions } from '../db/database'
import { saveAs } from 'file-saver'

export function ProjectList() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { projects, isLoading } = useProjects()
  const [searchQuery, setSearchQuery] = useState('')
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [projectToDelete, setProjectToDelete] = useState<string | null>(null)

  // Import state
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [importAnalysis, setImportAnalysis] = useState<ImportAnalysis | null>(null)
  const [importDecisions, setImportDecisions] = useState<ImportDecisions>({})
  const [isImporting, setIsImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

  const filteredProjects = projects.filter(project =>
    project.projectNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (project.client || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (project.constructionProject || '').toLowerCase().includes(searchQuery.toLowerCase())
  )

  const handleDelete = async () => {
    if (projectToDelete) {
      await deleteProject(projectToDelete)
      setDeleteModalOpen(false)
      setProjectToDelete(null)
    }
  }

  const handleExport = async (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      const json = await exportProject(projectId)
      const blob = new Blob([json], { type: 'application/json' })
      const project = projects.find(p => p.id === projectId)
      saveAs(blob, `${project?.projectNumber || 'project'}_export.json`)
    } catch (error) {
      console.error('Export failed:', error)
    }
  }

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

          // Analyze import for conflicts
          const analysis = await analyzeImport(text)
          setImportAnalysis(analysis)

          // Initialize decisions to 'rename' for all conflicts
          const initialDecisions: ImportDecisions = {}
          analysis.conflicts.forEach(conflict => {
            initialDecisions[`${conflict.type}-${conflict.importId}`] = 'rename'
          })
          setImportDecisions(initialDecisions)

          // If no conflicts, import directly
          if (!analysis.hasConflicts) {
            setIsImporting(true)
            const newId = await executeImport(analysis, {})
            setIsImporting(false)
            navigate(`/projects/${newId}`)
          } else {
            // Show conflict resolution dialog
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
      setImportDecisions({})
      navigate(`/projects/${newId}`)
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
      case 'project':
        return <FileText className="w-4 h-4" />
      case 'fixedPointField':
        return <MapPin className="w-4 h-4" />
      case 'employee':
        return <Users className="w-4 h-4" />
      case 'logo':
        return <Image className="w-4 h-4" />
    }
  }

  const getConflictTypeLabel = (type: ImportConflict['type']) => {
    switch (type) {
      case 'project':
        return t('import.conflictType.project') || 'Projekt'
      case 'fixedPointField':
        return t('import.conflictType.fixedPointField') || 'Festpunktfeld'
      case 'employee':
        return t('import.conflictType.employee') || 'Mitarbeiter'
      case 'logo':
        return t('import.conflictType.logo') || 'Firmenlogo'
    }
  }

  const confirmDelete = (projectId: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    setProjectToDelete(projectId)
    setDeleteModalOpen(true)
  }

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
          {t('projects.import')}
        </Button>
        <Button onClick={() => navigate('/projects/new')} className="flex-1">
          <Plus className="w-4 h-4 mr-2" />
          {t('projects.new')}
        </Button>
      </div>

      <SearchInput
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        onClear={() => setSearchQuery('')}
        placeholder={t('common.search')}
      />

      {filteredProjects.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FolderOpen className="w-8 h-8" />}
            title={searchQuery ? t('common.noData') : t('dashboard.noProjects')}
            action={!searchQuery && (
              <Button onClick={() => navigate('/projects/new')}>
                {t('projects.new')}
              </Button>
            )}
          />
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredProjects.map(project => (
            <SwipeToDelete key={project.id} onDelete={() => confirmDelete(project.id)}>
              <Card
                hoverable
                onClick={() => navigate(`/projects/${project.id}`)}
              >
                <CardContent className="py-3">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate" style={{ color: 'var(--color-text)' }}>{project.projectNumber}</div>
                      <div className="text-sm truncate" style={{ color: 'var(--color-text-muted)' }}>
                        {project.client || project.constructionProject || '-'}
                        {project.client && project.constructionProject && ` • ${project.constructionProject}`}
                      </div>
                      <div className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>{project.startDate}</div>
                    </div>
                    <div className="flex items-center gap-1 ml-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="p-2"
                        onClick={(e) => handleExport(project.id, e)}
                      >
                        <Download className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="p-2 text-red-600"
                        onClick={(e) => confirmDelete(project.id, e)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </SwipeToDelete>
          ))}
        </div>
      )}

      <Modal
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title={t('projects.delete')}
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
        <p>{t('projects.deleteConfirm')}</p>
      </Modal>

      {/* Import Conflict Resolution Modal */}
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
                <strong>{importAnalysis.exportType === 'job' ? (t('import.importJob') || 'Job-Import') : (t('import.importProject') || 'Projekt-Import')}:</strong>{' '}
                {importAnalysis.project?.projectNumber}
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                {importAnalysis.measurementJobs.length} {t('import.jobs') || 'Jobs'},{' '}
                {importAnalysis.runs.length} {t('import.runs') || 'Fahrten'},{' '}
                {importAnalysis.fixedPointFields.length} {t('import.fixedPointFields') || 'Festpunktfelder'}
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

              {importAnalysis.conflicts.map((conflict, index) => (
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
