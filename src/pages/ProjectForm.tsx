import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '../components/layout/PageHeader'
import { Card, CardContent } from '../components/common/Card'
import { Input } from '../components/common/Input'
import { Select } from '../components/common/Select'
import { Button } from '../components/common/Button'
import { useProject, createProject, updateProject } from '../hooks/useProjects'
import { useLogos, useDefaultLogo, getLogoDataUrl } from '../hooks/useLogos'

export function ProjectForm() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { id } = useParams()
  const isEdit = !!id
  const { project, isLoading } = useProject(id)
  const { logos } = useLogos()
  const { defaultLogo } = useDefaultLogo()

  const [formData, setFormData] = useState({
    projectNumber: '',
    client: '',
    constructionProject: '',
    startDate: new Date().toISOString().split('T')[0],
    logoId: ''
  })

  const [isSaving, setIsSaving] = useState(false)
  const hasAppliedDefaultLogo = useRef(false)

  useEffect(() => {
    if (project && isEdit) {
      setFormData({
        projectNumber: project.projectNumber,
        client: project.client || '',
        constructionProject: project.constructionProject || '',
        startDate: project.startDate,
        logoId: project.logoId || ''
      })
    }
  }, [project, isEdit])

  // Default-Logo setzen für neue Projekte (nur einmal beim ersten Laden)
  useEffect(() => {
    if (!isEdit && defaultLogo && !hasAppliedDefaultLogo.current) {
      hasAppliedDefaultLogo.current = true
      setFormData(prev => ({ ...prev, logoId: defaultLogo.id }))
    }
  }, [defaultLogo, isEdit])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSaving(true)

    try {
      const projectData = {
        projectNumber: formData.projectNumber,
        client: formData.client || undefined,
        constructionProject: formData.constructionProject || undefined,
        startDate: formData.startDate,
        logoId: formData.logoId || undefined
      }

      if (isEdit && id) {
        await updateProject(id, projectData)
      } else {
        await createProject(projectData)
      }

      navigate('/projects')
    } catch (error) {
      console.error('Error saving project:', error)
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title={isEdit ? t('projects.edit') : t('projects.new')}
        onBack={() => navigate('/projects')}
      />

      <form onSubmit={handleSubmit} className="space-y-4">
        <Card>
          <CardContent>
            <h3 className="text-md font-semibold mb-4" style={{ color: 'var(--color-text)' }}>
              {t('projects.basicData') || 'Stammdaten'}
            </h3>
            <div className="space-y-4">
              <Input
                label={t('projects.projectNumber')}
                value={formData.projectNumber}
                onChange={(e) => setFormData({ ...formData, projectNumber: e.target.value })}
                required
                placeholder="A1Pxxxxxxx"
              />

              <Input
                label={t('projects.client')}
                value={formData.client}
                onChange={(e) => setFormData({ ...formData, client: e.target.value })}
                placeholder={t('projects.clientPlaceholder') || 'Auftraggeber'}
              />

              <Input
                label={t('projects.constructionProject')}
                value={formData.constructionProject}
                onChange={(e) => setFormData({ ...formData, constructionProject: e.target.value })}
                placeholder={t('projects.constructionProjectPlaceholder') || 'Bauvorhaben'}
              />

              <Input
                type="date"
                label={t('projects.startDate') || 'Startdatum'}
                value={formData.startDate}
                onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                required
              />
            </div>
          </CardContent>
        </Card>

        {/* Firma / Logo */}
        {logos.length > 0 && (
          <Card>
            <CardContent>
              <h3 className="text-md font-semibold mb-4" style={{ color: 'var(--color-text)' }}>
                {t('projects.company') || 'Firma'}
              </h3>
              <Select
                label={t('projects.selectCompany') || 'Firma auswählen'}
                value={formData.logoId}
                onChange={(e) => setFormData({ ...formData, logoId: e.target.value })}
                options={[
                  { value: '', label: t('projects.noCompany') || 'Keine Firma' },
                  ...logos.map(logo => ({ value: logo.id, label: logo.name + (logo.isDefault ? ' (Standard)' : '') }))
                ]}
              />
              {/* Logo-Vorschau */}
              {formData.logoId && logos.find(l => l.id === formData.logoId) && (
                <div className="mt-4 p-3 rounded-lg" style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
                  <img
                    src={getLogoDataUrl(logos.find(l => l.id === formData.logoId)!)}
                    alt="Logo-Vorschau"
                    className="max-h-16 object-contain"
                  />
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <div className="flex gap-3 pb-6">
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate('/projects')}
            className="flex-1"
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            className="flex-1"
            disabled={isSaving}
          >
            {isSaving ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </form>
    </div>
  )
}
