import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Plus, Edit, Trash2, Download, Route,
  User, Cloud, Calendar, Settings2, MapPin, Truck, Navigation, List, LayoutList
} from 'lucide-react'
import { useProject } from '../hooks/useProjects'
import { useMeasurementJobWithRuns, deleteMeasurementJob } from '../hooks/useMeasurementJobs'
import { useFixedPointField } from '../hooks/useFixedPoints'
import { useEmployees } from '../hooks/useEmployees'
import { deleteRun } from '../hooks/useRuns'
import { useActiveRun } from '../contexts/ActiveRunContext'
import { Card, CardContent, CardHeader } from '../components/common/Card'
import { Button } from '../components/common/Button'
import { Badge } from '../components/common/Badge'
import { EmptyState } from '../components/common/EmptyState'
import { Modal } from '../components/common/Modal'
import { useSettings } from '../hooks/useSettings'
import { exportJob } from '../utils/export'
import { exportRunTrajectoryToKML, exportProjectTrajectoriesToKML, downloadKML } from '../utils/trajectoryExport'
import { db } from '../db/database'
import type { ReferenceTrajectory } from '../db/models'

export function MeasurementJobDetail() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { projectId, jobId } = useParams<{ projectId: string; jobId: string }>()
  const { project } = useProject(projectId)
  const { job, runs, isLoading } = useMeasurementJobWithRuns(jobId)
  const { field: fixedPointField } = useFixedPointField(job?.fixedPointFieldId)
  const { employees } = useEmployees()
  const { settings, currentLanguage, updateSettings } = useSettings()
  const isCompact = settings?.compactView ?? false

  const toggleCompactView = () => {
    updateSettings({ compactView: !isCompact })
  }
  const { isRunActive, activeRun } = useActiveRun()

  const [deleteJobModal, setDeleteJobModal] = useState(false)
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

  if (!job) {
    return (
      <EmptyState
        icon={<Route className="w-8 h-8" />}
        title={t('common.noData')}
        action={<Button onClick={() => navigate(`/projects/${projectId}`)}>{t('common.back')}</Button>}
      />
    )
  }

  const handleDeleteJob = async () => {
    await deleteMeasurementJob(job.id)
    navigate(`/projects/${projectId}`)
  }

  const handleDeleteRun = async () => {
    if (runToDelete) {
      await deleteRun(runToDelete)
      setDeleteRunModal(false)
      setRunToDelete(null)
    }
  }

  const handleExport = async (format: 'pdf' | 'excel' | 'json') => {
    if (!project || !job) return

    await exportJob({
      format,
      project,
      job,
      runs,
      language: currentLanguage as 'de' | 'en'
    })
    setExportModalOpen(false)
  }

  const handleExportAllGpsKML = async () => {
    if (!project || !job) return
    try {
      // Collect all unique referenceTrajectoryIds from runs
      const trajectoryIds = new Set<string>()
      for (const run of runs) {
        if (run.referenceTrajectoryId) trajectoryIds.add(run.referenceTrajectoryId)
      }

      // Load trajectories from DB
      const trajectoryMap = new Map<string, ReferenceTrajectory>()
      for (const id of trajectoryIds) {
        const traj = await db.referenceTrajectories.get(id)
        if (traj) trajectoryMap.set(id, traj)
      }

      const kml = exportProjectTrajectoriesToKML(
        `${project.projectNumber} - ${job.jobName}`,
        runs,
        trajectoryMap.size > 0 ? trajectoryMap : undefined
      )
      downloadKML(kml, `${project.projectNumber}_${job.jobName}_GPS.kml`)
      setExportModalOpen(false)
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Export fehlgeschlagen')
    }
  }

  const handleExportRunGpsKML = async (run: typeof runs[0]) => {
    try {
      // Load reference trajectory if the run has one
      let trajectory: ReferenceTrajectory | undefined
      if (run.referenceTrajectoryId) {
        trajectory = await db.referenceTrajectories.get(run.referenceTrajectoryId)
      }

      const kml = exportRunTrajectoryToKML(run, trajectory)
      downloadKML(kml, `${run.runName}_GPS.kml`)
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Export fehlgeschlagen')
    }
  }

  // Count runs with GPS data
  const runsWithGps = runs.filter(r => r.gpsTrack && r.gpsTrack.length > 0)

  // Mitarbeiter-Namen aus IDs auflösen
  const jobEmployees = job.employeeIds
    .map(id => employees.find(e => e.id === id))
    .filter(Boolean)

  const weatherLabels = {
    sunny: t('weather.sunny'),
    cloudy: t('weather.cloudy'),
    rainy: t('weather.rainy'),
    outdoor: t('environment.outdoor'),
    covered: t('environment.covered')
  }

  return (
    <div className="space-y-4">
      {/* Breadcrumb / Kontext */}
      {project && (
        <div
          className="p-3 rounded-lg cursor-pointer"
          style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}
          onClick={() => navigate(`/projects/${projectId}`)}
        >
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {t('measurementJob.project')}: <span style={{ color: 'var(--color-text)' }}>{project.projectNumber}{project.client ? ` - ${project.client}` : ''}</span>
          </p>
        </div>
      )}

      {/* Job Info */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <h2 className="text-lg font-semibold truncate" style={{ color: 'var(--color-text)' }}>{job.jobName}</h2>
            {isCompact && (
              <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                • {runs.length} {t('measurementJob.runs')}
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
              <Button variant="ghost" size="sm" onClick={() => navigate(`/projects/${projectId}/jobs/${jobId}/edit`)}>
                <Edit className="w-4 h-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="text-red-600"
              onClick={() => setDeleteJobModal(true)}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </CardHeader>
        {!isCompact && (
          <CardContent className="space-y-3">
            {/* Datum */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{t('measurementJob.jobDate')}</div>
                <div className="flex items-center gap-1" style={{ color: 'var(--color-text)' }}>
                  <Calendar className="w-4 h-4" style={{ color: 'var(--color-text-muted)' }} />
                  <span>{job.jobDate}</span>
                </div>
              </div>
              {job.object && (
                <div>
                  <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{t('measurementJob.object')}</div>
                  <div style={{ color: 'var(--color-text)' }}>{job.object}</div>
                </div>
              )}
            </div>

            {/* Equipment */}
            <div className="grid grid-cols-2 gap-3">
              {job.trolleySerialNumber && (
                <div>
                  <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{t('measurementJob.trolley')}</div>
                  <div className="flex items-center gap-1" style={{ color: 'var(--color-text)' }}>
                    <Truck className="w-4 h-4" style={{ color: 'var(--color-text-muted)' }} />
                    <span>{job.trolleySerialNumber}</span>
                  </div>
                </div>
              )}
              {job.scannerSerialNumber && (
                <div>
                  <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{t('measurementJob.scanner')}</div>
                  <div className="flex items-center gap-1" style={{ color: 'var(--color-text)' }}>
                    <Settings2 className="w-4 h-4" style={{ color: 'var(--color-text-muted)' }} />
                    <span>{job.scannerSerialNumber}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Scanner-Einstellungen */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{t('measurementJob.scannerType')}</div>
                <div className="flex items-center gap-1" style={{ color: 'var(--color-text)' }}>
                  <Settings2 className="w-4 h-4" style={{ color: 'var(--color-text-muted)' }} />
                  <span>{job.scannerType} {job.scannerAlignment && `(${job.scannerAlignment})`}</span>
                </div>
              </div>
              <div>
                <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{t('measurementJob.withTower')}</div>
                <div style={{ color: 'var(--color-text)' }}>
                  {job.withTower
                    ? `${t('common.yes')} (${job.towerHeight}mm)`
                    : t('common.no')}
                </div>
              </div>
            </div>

            {/* Wetter */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{t('measurementJob.weatherCondition')}</div>
                <div className="flex items-center gap-1" style={{ color: 'var(--color-text)' }}>
                  <Cloud className="w-4 h-4" style={{ color: 'var(--color-text-muted)' }} />
                  <span>{weatherLabels[job.weather.condition]}</span>
                </div>
              </div>
              <div>
                <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{t('measurementJob.environment')}</div>
                <div style={{ color: 'var(--color-text)' }}>
                  {weatherLabels[job.weather.environment]}
                </div>
              </div>
            </div>

            {/* Mitarbeiter */}
            {jobEmployees.length > 0 && (
              <div>
                <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{t('measurementJob.employees')}</div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {jobEmployees.map((emp) => emp && (
                    <Badge key={emp.id} variant="info">
                      <User className="w-3 h-3 mr-1" />
                      {emp.name}{emp.company ? ` (${emp.company})` : ''}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Festpunktfeld */}
            {fixedPointField && (
              <div>
                <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{t('measurementJob.fixedPointField')}</div>
                <div className="flex items-center gap-1" style={{ color: 'var(--color-text)' }}>
                  <MapPin className="w-4 h-4" style={{ color: 'var(--color-text-muted)' }} />
                  <span>{fixedPointField.name} ({fixedPointField.points.length} {t('measurementJob.points')})</span>
                </div>
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* Messfahrten */}
      <div>
        <h2 className="text-lg font-semibold mb-3" style={{ color: 'var(--color-text)' }}>
          {t('measurementJob.runs')} ({runs.length})
        </h2>

        <Button
          onClick={() => navigate(`/projects/${projectId}/jobs/${jobId}/runs/new`)}
          className="w-full mb-3"
          disabled={isRunActive}
        >
          <Plus className="w-4 h-4 mr-2" />
          {isRunActive ? `${t('runs.active')}: ${activeRun?.runName}` : t('runs.new')}
        </Button>

        {runs.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Route className="w-8 h-8" />}
              title={t('measurementJob.noRuns')}
            />
          </Card>
        ) : (
          <div className="space-y-2">
            {runs.map(run => (
              <Card
                key={run.id}
                hoverable
                onClick={() => navigate(`/projects/${projectId}/jobs/${jobId}/runs/${run.id}`)}
              >
                <CardContent className="py-3">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium" style={{ color: 'var(--color-text)' }}>{run.runName}</div>
                      <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                        {run.routeNumber} • {run.trackType} • {t(`runs.${run.direction}`)} • {run.length || 0}m
                      </div>
                      <div className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                        {run.pointNumberFrom || '-'} → {run.pointNumberTo || '-'}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {run.gpsTrack && run.gpsTrack.length > 0 && (
                        <span title={`${run.gpsTrack.length} GPS-Punkte`}>
                          <Badge variant="info">
                            <Navigation className="w-3 h-3" />
                          </Badge>
                        </span>
                      )}
                      <Badge variant={run.isCompleted ? 'success' : 'warning'}>
                        {run.isCompleted ? t('runs.completed') : t('runs.inProgress')}
                      </Badge>
                      {run.gpsTrack && run.gpsTrack.length > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="p-2"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleExportRunGpsKML(run)
                          }}
                          title="GPS-Trajektorie exportieren"
                        >
                          <Download className="w-4 h-4" />
                        </Button>
                      )}
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
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

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
        {runs.length > 0 && (
          <p className="mt-2 text-sm text-red-600">
            {t('measurementJob.deleteWarning', { count: runs.length })}
          </p>
        )}
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
        <div className="space-y-4">
          <div>
            <p className="text-sm font-medium mb-2" style={{ color: 'var(--color-text)' }}>Protokoll</p>
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
          </div>

          <div>
            <p className="text-sm font-medium mb-2" style={{ color: 'var(--color-text)' }}>GPS-Trajektorien (KML)</p>
            {runsWithGps.length > 0 ? (
              <Button
                variant="secondary"
                onClick={handleExportAllGpsKML}
                className="w-full"
              >
                <Navigation className="w-4 h-4 mr-2" />
                Alle GPS-Trajektorien ({runsWithGps.length} Fahrten)
              </Button>
            ) : (
              <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                Keine Messfahrten mit GPS-Daten vorhanden
              </p>
            )}
          </div>
        </div>
      </Modal>
    </div>
  )
}
