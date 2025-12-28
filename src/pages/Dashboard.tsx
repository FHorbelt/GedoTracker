import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { FolderPlus, Upload, FolderOpen, Route } from 'lucide-react'
import { useProjects } from '../hooks/useProjects'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/database'
import { Card, CardContent } from '../components/common/Card'
import { Button } from '../components/common/Button'
import { EmptyState } from '../components/common/EmptyState'

export function Dashboard() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { projects, isLoading } = useProjects()
  
  const totalRuns = useLiveQuery(() => db.runs.count()) || 0

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
            <div className="text-2xl font-bold text-slate-900">{projects.length}</div>
            <div className="text-sm text-slate-500">{t('dashboard.totalProjects')}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="text-center py-6">
            <Route className="w-8 h-8 text-primary-600 mx-auto mb-2" />
            <div className="text-2xl font-bold text-slate-900">{totalRuns}</div>
            <div className="text-sm text-slate-500">{t('dashboard.totalRuns')}</div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="text-lg font-semibold text-slate-900 mb-3">{t('dashboard.quickActions')}</h2>
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
        <h2 className="text-lg font-semibold text-slate-900 mb-3">{t('dashboard.recentProjects')}</h2>
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
              <Card 
                key={project.id} 
                hoverable 
                onClick={() => navigate(`/projects/${project.id}`)}
              >
                <CardContent className="py-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium text-slate-900">{project.projectNumber}</div>
                      <div className="text-sm text-slate-500">{project.client}</div>
                    </div>
                    <div className="text-sm text-slate-400">{project.date}</div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
