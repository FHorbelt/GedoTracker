import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { FolderPlus, Upload, FolderOpen, Route, Briefcase } from 'lucide-react'
import { useProjects, deleteProject } from '../hooks/useProjects'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/database'
import { Card, CardContent } from '../components/common/Card'
import { Button } from '../components/common/Button'
import { EmptyState } from '../components/common/EmptyState'
import { Modal } from '../components/common/Modal'
import { SwipeToDelete } from '../components/common/SwipeToDelete'

export function Dashboard() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { projects, isLoading } = useProjects()

  const totalRuns = useLiveQuery(() => db.runs.count()) || 0
  const totalJobs = useLiveQuery(() => db.measurementJobs.count()) || 0
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [projectToDelete, setProjectToDelete] = useState<string | null>(null)

  const confirmDelete = (projectId: string) => {
    setProjectToDelete(projectId)
    setDeleteModalOpen(true)
  }

  const handleDelete = async () => {
    if (projectToDelete) {
      await deleteProject(projectToDelete)
      setDeleteModalOpen(false)
      setProjectToDelete(null)
    }
  }

  const recentProjects = projects.slice(0, 5)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="text-center py-6">
            <FolderOpen className="w-8 h-8 text-primary-600 mx-auto mb-2" />
            <div className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>{projects.length}</div>
            <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{t('dashboard.totalProjects')}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="text-center py-6">
            <Route className="w-8 h-8 text-primary-600 mx-auto mb-2" />
            <div className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>{totalRuns}</div>
            <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{t('dashboard.totalRuns')}</div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="text-lg font-semibold mb-3" style={{ color: 'var(--color-text)' }}>{t('dashboard.quickActions')}</h2>
        <div className="grid grid-cols-2 gap-3">
          <Button
            onClick={() => navigate('/projects/new')}
            className="flex flex-col items-center gap-2 h-auto py-4"
          >
            <FolderPlus className="w-6 h-6" />
            <span className="text-sm">{t('dashboard.newProject')}</span>
          </Button>
          <Button
            variant="secondary"
            onClick={() => navigate('/fixedpoints')}
            className="flex flex-col items-center gap-2 h-auto py-4"
          >
            <Upload className="w-6 h-6" />
            <span className="text-sm">{t('dashboard.importFixedPoints')}</span>
          </Button>
        </div>
      </div>

      {/* Recent Projects */}
      <div>
        <h2 className="text-lg font-semibold mb-3" style={{ color: 'var(--color-text)' }}>{t('dashboard.recentProjects')}</h2>
        {recentProjects.length === 0 ? (
          <Card>
            <EmptyState
              icon={<FolderOpen className="w-8 h-8" />}
              title={t('dashboard.noProjects')}
              action={
                <Button onClick={() => navigate('/projects/new')}>
                  {t('dashboard.newProject')}
                </Button>
              }
            />
          </Card>
        ) : (
          <div className="space-y-2">
            {recentProjects.map(project => (
              <SwipeToDelete key={project.id} onDelete={() => confirmDelete(project.id)}>
                <Card
                  hoverable
                  onClick={() => navigate(`/projects/${project.id}`)}
                >
                  <CardContent className="py-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium" style={{ color: 'var(--color-text)' }}>{project.projectNumber}</div>
                        <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{project.client}</div>
                      </div>
                      <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{project.startDate}</div>
                    </div>
                  </CardContent>
                </Card>
              </SwipeToDelete>
            ))}
          </div>
        )}
      </div>

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
    </div>
  )
}
