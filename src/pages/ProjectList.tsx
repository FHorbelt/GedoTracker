import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Plus, FolderOpen, Upload, Trash2, Download } from 'lucide-react'
import { useProjects, deleteProject } from '../hooks/useProjects'
import { Card, CardContent } from '../components/common/Card'
import { Button } from '../components/common/Button'
import { SearchInput } from '../components/common/SearchInput'
import { EmptyState } from '../components/common/EmptyState'
import { Modal } from '../components/common/Modal'
import { PageHeader } from '../components/layout/PageHeader'
import { exportProject, importProject } from '../db/database'
import { saveAs } from 'file-saver'

export function ProjectList() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { projects, isLoading } = useProjects()
  const [searchQuery, setSearchQuery] = useState('')
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [projectToDelete, setProjectToDelete] = useState<string | null>(null)

  const filteredProjects = projects.filter(project => 
    project.projectNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
    project.client.toLowerCase().includes(searchQuery.toLowerCase()) ||
    project.constructionProject.toLowerCase().includes(searchQuery.toLowerCase())
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
          const text = await file.text()
          const newId = await importProject(text)
          navigate(`/projects/${newId}`)
        } catch (error) {
          console.error('Import failed:', error)
        }
      }
    }
    input.click()
  }

  const confirmDelete = (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation()
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
      <PageHeader 
        title={t('projects.title')}
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={handleImport}>
              <Upload className="w-4 h-4 mr-2" />
              {t('projects.import')}
            </Button>
            <Button onClick={() => navigate('/projects/new')}>
              <Plus className="w-4 h-4 mr-2" />
              {t('projects.new')}
            </Button>
          </div>
        }
      />

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
            <Card 
              key={project.id} 
              hoverable 
              onClick={() => navigate(`/projects/${project.id}`)}
            >
              <CardContent className="py-3">
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-slate-900 truncate">{project.projectNumber}</div>
                    <div className="text-sm text-slate-500 truncate">{project.client} - {project.constructionProject}</div>
                    <div className="text-xs text-slate-400 mt-1">{project.date}</div>
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
                      className="p-2 text-red-600 hover:bg-red-50"
                      onClick={(e) => confirmDelete(project.id, e)}
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
