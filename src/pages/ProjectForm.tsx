import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '../components/layout/PageHeader'
import { Card, CardContent } from '../components/common/Card'
import { Input } from '../components/common/Input'
import { Select } from '../components/common/Select'
import { Toggle } from '../components/common/Toggle'
import { Button } from '../components/common/Button'
import { useProject, createProject, updateProject } from '../hooks/useProjects'
import { useEmployees, addEmployee } from '../hooks/useEmployees'
import { useFixedPointFields } from '../hooks/useFixedPoints'
import { ScannerType, ScannerAlignment, WeatherCondition, Environment } from '../db/models'
import { Plus, X } from 'lucide-react'

export function ProjectForm() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { id } = useParams()
  const isEdit = !!id
  const { project, isLoading } = useProject(id)
  const { employees } = useEmployees()
  const { fields } = useFixedPointFields()

  const [formData, setFormData] = useState({
    projectNumber: '',
    client: '',
    constructionProject: '',
    object: '',
    date: new Date().toISOString().split('T')[0],
    scannerType: 'GX50' as ScannerType,
    scannerOrientation: '80°/80°' as ScannerAlignment,
    withTower: false,
    towerHeight: 300,
    employees: [] as string[],
    weatherCondition: 'sunny' as WeatherCondition,
    environment: 'outdoor' as Environment,
    fixedPointFieldId: ''
  })

  const [newEmployeeName, setNewEmployeeName] = useState('')
  const [showAddEmployee, setShowAddEmployee] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (project && isEdit) {
      setFormData({
        projectNumber: project.projectNumber,
        client: project.client,
        constructionProject: project.constructionProject,
        object: project.object,
        date: project.date,
        scannerType: project.scannerType,
        scannerOrientation: project.scannerOrientation,
        withTower: project.withTower,
        towerHeight: project.towerHeight || 0,
        employees: project.employees,
        weatherCondition: project.weather.condition,
        environment: project.weather.environment,
        fixedPointFieldId: project.fixedPointFieldId || ''
      })
    }
  }, [project, isEdit])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSaving(true)

    try {
      const projectData = {
        projectNumber: formData.projectNumber,
        client: formData.client,
        constructionProject: formData.constructionProject,
        object: formData.object,
        date: formData.date,
        scannerType: formData.scannerType,
        scannerOrientation: formData.scannerOrientation,
        withTower: formData.withTower,
        towerHeight: formData.withTower ? formData.towerHeight : undefined,
        employees: formData.employees,
        weather: {
          condition: formData.weatherCondition,
          environment: formData.environment
        },
        fixedPointFieldId: formData.fixedPointFieldId || undefined
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

  const handleAddEmployee = async () => {
    if (!newEmployeeName.trim()) return

    try {
      await addEmployee(newEmployeeName.trim())
      setFormData({ ...formData, employees: [...formData.employees, newEmployeeName.trim()] })
      setNewEmployeeName('')
      setShowAddEmployee(false)
    } catch (error) {
      console.error('Error adding employee:', error)
    }
  }

  const toggleEmployee = (name: string) => {
    if (formData.employees.includes(name)) {
      setFormData({ ...formData, employees: formData.employees.filter(e => e !== name) })
    } else {
      setFormData({ ...formData, employees: [...formData.employees, name] })
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
            <h3 className="text-md font-semibold text-slate-900 mb-4">Stammdaten</h3>
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
                required
                placeholder="Auftraggeber"
              />

              <Input
                label={t('projects.constructionProject')}
                value={formData.constructionProject}
                onChange={(e) => setFormData({ ...formData, constructionProject: e.target.value })}
                required
                placeholder="Bauvorhaben"
              />

              <Input
                label={t('projects.object')}
                value={formData.object}
                onChange={(e) => setFormData({ ...formData, object: e.target.value })}
                required
                placeholder="Objekt"
              />

              <Input
                type="date"
                label={t('projects.date')}
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                required
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <h3 className="text-md font-semibold text-slate-900 mb-4">Scanner</h3>
            <div className="space-y-4">
              <Select
                label={t('projects.scannerType')}
                value={formData.scannerType}
                onChange={(e) => setFormData({ ...formData, scannerType: e.target.value as ScannerType })}
                options={[
                  { value: 'GX50', label: 'GX50' },
                  { value: 'TX8', label: 'TX8' }
                ]}
                required
              />

              <Select
                label={t('projects.scannerOrientation')}
                value={formData.scannerOrientation}
                onChange={(e) => setFormData({ ...formData, scannerOrientation: e.target.value as ScannerAlignment })}
                options={[
                  { value: '80°/80°', label: '80°/80°' },
                  { value: '90°/90°', label: '90°/90°' }
                ]}
                required
              />

              <div className="space-y-2">
                <Toggle
                  checked={formData.withTower}
                  onChange={(checked) => setFormData({ ...formData, withTower: checked, towerHeight: checked ? 300 : 0 })}
                  label="Mit Turm"
                />

                {formData.withTower && (
                  <Input
                    type="number"
                    label="Turmhöhe (mm)"
                    value={formData.towerHeight}
                    onChange={(e) => setFormData({ ...formData, towerHeight: parseInt(e.target.value) || 300 })}
                    placeholder="Höhe in Millimeter"
                    step="1"
                    min="0"
                  />
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <h3 className="text-md font-semibold text-slate-900 mb-4">{t('projects.employees')}</h3>
            <div className="space-y-2">
              {employees.map((emp) => (
                <label key={emp.id} className="flex items-center gap-2 p-2 rounded hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={formData.employees.includes(emp.name)}
                    onChange={() => toggleEmployee(emp.name)}
                    className="w-4 h-4 text-primary-600 rounded focus:ring-primary-500"
                  />
                  <span className="text-sm text-slate-700">{emp.name}</span>
                </label>
              ))}

              {showAddEmployee ? (
                <div className="flex gap-2 mt-2">
                  <Input
                    value={newEmployeeName}
                    onChange={(e) => setNewEmployeeName(e.target.value)}
                    placeholder="Name des Mitarbeiters"
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddEmployee())}
                  />
                  <Button type="button" onClick={handleAddEmployee} size="sm">
                    <Plus className="w-4 h-4" />
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setShowAddEmployee(false)} size="sm">
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setShowAddEmployee(true)}
                  className="w-full"
                  size="sm"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Mitarbeiter hinzufügen
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <h3 className="text-md font-semibold text-slate-900 mb-4">{t('projects.weather')}</h3>
            <div className="space-y-4">
              <Select
                label="Wetterbedingungen"
                value={formData.weatherCondition}
                onChange={(e) => setFormData({ ...formData, weatherCondition: e.target.value as WeatherCondition })}
                options={[
                  { value: 'sunny', label: 'Sonnig' },
                  { value: 'cloudy', label: 'Bewölkt' },
                  { value: 'rainy', label: 'Regnerisch' }
                ]}
                required
              />

              <Select
                label={t('projects.environment')}
                value={formData.environment}
                onChange={(e) => setFormData({ ...formData, environment: e.target.value as Environment })}
                options={[
                  { value: 'outdoor', label: 'Im Freien' },
                  { value: 'covered', label: 'Überdacht/Tunnel' }
                ]}
                required
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <h3 className="text-md font-semibold text-slate-900 mb-4">{t('projects.fixedPointField')}</h3>
            <Select
              label="Festpunktfeld auswählen"
              value={formData.fixedPointFieldId}
              onChange={(e) => setFormData({ ...formData, fixedPointFieldId: e.target.value })}
              options={[
                { value: '', label: 'Kein Festpunktfeld' },
                ...fields.map(field => ({ value: field.id, label: `${field.name} (${field.points.length} Punkte)` }))
              ]}
              placeholder="Optional"
            />
          </CardContent>
        </Card>

        <div className="flex gap-3 pb-6">
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate('/projects')}
            className="flex-1"
          >
            {t('projects.cancel')}
          </Button>
          <Button
            type="submit"
            className="flex-1"
            disabled={isSaving}
          >
            {isSaving ? 'Speichern...' : t('projects.save')}
          </Button>
        </div>
      </form>
    </div>
  )
}
