import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Plus, Edit, Trash2, Download, Route,
  User, Cloud, Calendar, Settings2, MapPin
} from 'lucide-react'
import { useProjectWithRuns, deleteProject } from '../hooks/useProjects'
import { useFixedPointField } from '../hooks/useFixedPoints'
import { deleteRun } from '../hooks/useRuns'
import { useActiveRun } from '../contexts/ActiveRunContext'
import { Card, CardContent, CardHeader } from '../components/common/Card'
import { Button } from '../components/common/Button'
import { Badge } from '../components/common/Badge'
import { EmptyState } from '../components/common/EmptyState'
import { Modal } from '../components/common/Modal'
import { exportProject } from '../utils/export'
import { useSettings } from '../hooks/useSettings'

export function ProjectDetail() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { project, runs, isLoading } = useProjectWithRuns(id)
  const { field: fixedPointField } = useFixedPointField(project?.fixedPointFieldId)
  const { currentLanguage } = useSettings()
  const { isRunActive, activeRun } = useActiveRun()
  
  const [deleteProjectModal, setDeleteProjectModal] = useState(false)
  const [deleteRunModal, setDeleteRunModal] = useState(false)
  const [runToDelete, setRunToDelete] = useState<string | null>(null)
  const [exportModalOpen, setExportModalOpen] = useState(false)

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
        icon={<Route className="w-8 h-8" />}
        title={t('common.noData')}
        action={<Button onClick={() => navigate('/projects')}>{t('common.back')}</Button>}
      />
    )
  }

  const handleDeleteProject = async () => {
    await deleteProject(project.id)
    navigate('/projects')
  }

  const handleDeleteRun = async () => {
    if (runToDelete) {
      await deleteRun(runToDelete)
      setDeleteRunModal(false)
      setRunToDelete(null)
    }
  }

  const handleExport = async (format: 'pdf' | 'excel' | 'csv' | 'json') => {
    await exportProject({
      format,
      project,
      runs,
      language: currentLanguage
    })
    setExportModalOpen(false)
  }

  const weatherLabels = {
    sunny: t('weather.sunny'),
    cloudy: t('weather.cloudy'),
    rainy: t('weather.rainy'),
    outdoor: t('weather.outdoor'),
    covered: t('weather.covered')
  }

  return (
    <div className="space-y-4">
      {/* Project Info */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <h2 className="text-lg font-semibold">{project.projectNumber}</h2>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={() => setExportModalOpen(true)}>
              <Download className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => navigate(`/projects/${id}/edit`)}>
              <Edit className="w-4 h-4" />
            </Button>
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
        <CardContent className="space-y-3">
          <div>
            <div className="text-sm text-slate-500">{t('projects.client')}</div>
            <div className="font-medium">{project.client}</div>
          </div>
          <div>
            <div className="text-sm text-slate-500">{t('projects.constructionProject')}</div>
            <div className="font-medium">{project.constructionProject}</div>
          </div>
          <div>
            <div className="text-sm text-slate-500">{t('projects.object')}</div>
            <div className="font-medium">{project.object}</div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-sm text-slate-500">{t('projects.date')}</div>
              <div className="flex items-center gap-1">
                <Calendar className="w-4 h-4 text-slate-400" />
                <span>{project.date}</span>
              </div>
            </div>
            <div>
              <div className="text-sm text-slate-500">{t('projects.scannerType')}</div>
              <div className="flex items-center gap-1">
                <Settings2 className="w-4 h-4 text-slate-400" />
                <span>{project.scannerType} ({project.scannerOrientation})</span>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-sm text-slate-500">{t('projects.withTower')}</div>
              <div>
                {project.withTower
                  ? `${t('common.yes')} (${project.towerHeight}mm)`
                  : t('common.no')}
              </div>
            </div>
            <div>
              <div className="text-sm text-slate-500">{t('projects.weather')}</div>
              <div className="flex items-center gap-1">
                <Cloud className="w-4 h-4 text-slate-400" />
                <span>{weatherLabels[project.weather.condition]}</span>
              </div>
            </div>
          </div>
          <div>
            <div className="text-sm text-slate-500">{t('projects.employees')}</div>
            <div className="flex flex-wrap gap-1 mt-1">
              {project.employees.map((emp, i) => (
                <Badge key={i} variant="info">
                  <User className="w-3 h-3 mr-1" />
                  {emp}
                </Badge>
              ))}
            </div>
          </div>
          {fixedPointField && (
            <div>
              <div className="text-sm text-slate-500">{t('projects.fixedPointField')}</div>
              <div className="flex items-center gap-1">
                <MapPin className="w-4 h-4 text-slate-400" />
                <span>{fixedPointField.name} ({fixedPointField.points.length} Punkte)</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Measurement Runs */}
      <div>
        <h2 className="text-lg font-semibold mb-3">{t('projects.runs')}</h2>

        <Button
          onClick={() => navigate(`/projects/${id}/runs/new`)}
          className="w-full mb-3"
          disabled={isRunActive}
        >
          <Plus className="w-4 h-4 mr-2" />
          {isRunActive ? `Run aktiv: ${activeRun?.runName}` : t('runs.new')}
        </Button>

        {runs.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Route className="w-8 h-8" />}
              title={t('projects.noRuns')}
            />
          </Card>
        ) : (
          <div className="space-y-2">
            {runs.map(run => (
              <Card
                key={run.id}
                hoverable
                onClick={() => navigate(`/projects/${id}/runs/${run.id}`)}
              >
                <CardContent className="py-3">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-slate-900">{run.runName}</div>
                      <div className="text-sm text-slate-500">
                        {run.track} • {t(`runs.${run.direction}`)} • {run.length}m
                      </div>
                      <div className="text-xs text-slate-400 mt-1">
                        {run.pointNumberFrom} → {run.pointNumberTo}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="p-2 text-red-600"
                      onClick={(e) => {
                        e.stopPropagation()
                        setRunToDelete(run.id)
                        setDeleteRunModal(true)
                      }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
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
      </Modal>

      {/* Delete Run Modal */}
      <Modal
        isOpen={deleteRunModal}
        onClose={() => setDeleteRunModal(false)}
        title={t('runs.delete')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteRunModal(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={handleDeleteRun}>
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <p>{t('runs.deleteConfirm')}</p>
      </Modal>

      {/* Export Modal */}
      <Modal
        isOpen={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
        title={t('export.title')}
      >
        <div className="grid grid-cols-2 gap-3">
          <Button variant="secondary" onClick={() => handleExport('pdf')}>
            {t('export.pdf')}
          </Button>
          <Button variant="secondary" onClick={() => handleExport('excel')}>
            {t('export.excel')}
          </Button>
          <Button variant="secondary" onClick={() => handleExport('csv')}>
            {t('export.csv')}
          </Button>
          <Button variant="secondary" onClick={() => handleExport('json')}>
            {t('export.json')}
          </Button>
        </div>
      </Modal>
    </div>
  )
}
