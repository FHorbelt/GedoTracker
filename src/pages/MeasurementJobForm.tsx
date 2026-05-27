import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '../components/layout/PageHeader'
import { Card, CardContent } from '../components/common/Card'
import { Input } from '../components/common/Input'
import { Select } from '../components/common/Select'
import { Toggle } from '../components/common/Toggle'
import { Button } from '../components/common/Button'
import { RunMap } from '../components/common/RunMap'
import { useProject, useProjects, createProject } from '../hooks/useProjects'
import { db } from '../db/database'
import { useMeasurementJob, createMeasurementJob, updateMeasurementJob, getLastMeasurementJob } from '../hooks/useMeasurementJobs'
import { useEmployees, addEmployee, updateEmployee, deleteEmployee } from '../hooks/useEmployees'
import { useFixedPointFields } from '../hooks/useFixedPoints'
import { useSettings } from '../hooks/useSettings'
import { buildBaseSpline, filterPointsBySide, setStationTolerance, setSmoothingPasses, getBaseSplineCoordinates, reverseSpline, generateDragPoints, mergeDragPoints, BaseSpline } from '../utils/pointSuggestion'
import { RefreshCw } from 'lucide-react'
import {
  ScannerType,
  ScannerAlignment,
  WeatherCondition,
  Environment,
  TROLLEY_SERIAL_NUMBERS,
  SCANNER_SERIAL_NUMBERS,
  TrolleySerialNumber,
  ScannerSerialNumber,
  TrackSide,
  DraggedTrajectoryPoint
} from '../db/models'
import { Plus, X, Edit, Check, Trash2, MapPin, ChevronDown, Search } from 'lucide-react'

export function MeasurementJobForm() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { projectId, jobId } = useParams()
  const isEdit = !!jobId
  const { project } = useProject(projectId)
  const { projects: allProjects } = useProjects()
  const { job, isLoading } = useMeasurementJob(jobId)
  const { employees } = useEmployees()
  const { fields } = useFixedPointFields()
  const { settings } = useSettings()
  const betaSplineEnabled = settings?.betaSplineEnabled ?? false

  // Selected project for /jobs/new route (no projectId in URL)
  const [selectedProjectId, setSelectedProjectId] = useState<string>(projectId || '')

  const [formData, setFormData] = useState({
    jobName: '',
    jobDate: new Date().toISOString().split('T')[0],
    object: '',
    trolleySerialNumber: '' as TrolleySerialNumber | '',
    scannerSerialNumber: '' as ScannerSerialNumber | '',
    scannerType: 'GX50' as ScannerType,
    scannerAlignment: '80°/80°' as ScannerAlignment,
    withTower: false,
    towerHeight: 300,
    employeeIds: [] as string[],
    weatherCondition: 'sunny' as WeatherCondition,
    environment: 'outdoor' as Environment,
    fixedPointFieldId: '',
    // Trajektorie-Einstellungen
    stationTolerance: 25,
    smoothingPasses: 0,
    trackSide: 'all' as TrackSide,
    isReversed: false
  })

  const [newEmployeeName, setNewEmployeeName] = useState('')
  const [showAddEmployee, setShowAddEmployee] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null)
  const [editingEmployeeName, setEditingEmployeeName] = useState('')
  const [employeeDropdownOpen, setEmployeeDropdownOpen] = useState(false)
  const [employeeSearch, setEmployeeSearch] = useState('')
  const employeeDropdownRef = useRef<HTMLDivElement>(null)

  // Ziehbare Punkte für Trajektorie-Korrektur
  const [dragPoints, setDragPoints] = useState<DraggedTrajectoryPoint[]>([])
  const [showDragPoints, setShowDragPoints] = useState(false)

  // Get selected fixed point field
  const selectedField = useMemo(() => {
    return fields.find(f => f.id === formData.fixedPointFieldId)
  }, [fields, formData.fixedPointFieldId])

  // Update global spline settings when form values change
  useEffect(() => {
    setStationTolerance(formData.stationTolerance)
    setSmoothingPasses(formData.smoothingPasses)
  }, [formData.stationTolerance, formData.smoothingPasses])

  // Get only the modified drag points
  const modifiedDragPoints = useMemo(() => {
    return dragPoints.filter(
      dp => dp.adjustedLat !== dp.originalLat || dp.adjustedLon !== dp.originalLon
    )
  }, [dragPoints])

  // Build ORIGINAL spline from ALL fixed points WITHOUT drag adjustments
  // This is used ONLY for generating initial drag points - never includes user adjustments
  // to avoid circular dependency where adjustments would change the original points
  const originalSpline = useMemo<BaseSpline | null>(() => {
    if (!selectedField || selectedField.points.length < 2) {
      return null
    }
    // NO drag adjustments here - this is the pure original spline
    return buildBaseSpline(selectedField.points)
  }, [selectedField, formData.stationTolerance, formData.smoothingPasses])

  // Build reference spline from ALL fixed points WITH drag adjustments (for side filtering)
  // This ensures left/right filtering works correctly even after trajectory adjustments
  const referenceSpline = useMemo<BaseSpline | null>(() => {
    if (!selectedField || selectedField.points.length < 2) {
      return null
    }
    // Include drag point adjustments so filtering uses the adjusted trajectory
    return buildBaseSpline(selectedField.points, modifiedDragPoints.length > 0 ? modifiedDragPoints : undefined)
  }, [selectedField, formData.stationTolerance, formData.smoothingPasses, modifiedDragPoints])

  // Build display spline with track side filter applied
  const baseSpline = useMemo<BaseSpline | null>(() => {
    if (!selectedField || selectedField.points.length < 2) {
      return null
    }

    let pointsToUse = selectedField.points

    // If a side is selected and we have a reference spline, filter points
    // When direction is reversed, swap left/right to maintain consistency
    if (formData.trackSide !== 'all' && referenceSpline) {
      const effectiveSide = formData.isReversed
        ? (formData.trackSide === 'left' ? 'right' : 'left')
        : formData.trackSide
      pointsToUse = filterPointsBySide(selectedField.points, referenceSpline, effectiveSide)
      // Need at least 2 points for a spline
      if (pointsToUse.length < 2) {
        pointsToUse = selectedField.points // Fallback to all points
      }
    }

    // Build spline - if filtering by side, we still need to apply drag adjustments
    // The drag points will be matched by coordinates, so even with filtered points it should work
    const spline = buildBaseSpline(pointsToUse, modifiedDragPoints.length > 0 ? modifiedDragPoints : undefined)
    // Apply direction reversal if needed
    return spline && formData.isReversed ? reverseSpline(spline) : spline
  }, [selectedField, referenceSpline, formData.trackSide, formData.stationTolerance, formData.smoothingPasses, formData.isReversed, modifiedDragPoints])

  // Get track info for map visualization
  const trackInfo = useMemo(() => {
    if (!baseSpline) return null
    return {
      bearing: baseSpline.startBearing,
      startPosition: { latitude: baseSpline.points[0].lat, longitude: baseSpline.points[0].lon },
      estimatedPosition: { latitude: baseSpline.points[0].lat, longitude: baseSpline.points[0].lon },
      upcomingPoints: [],
      splineCoordinates: getBaseSplineCoordinates(baseSpline)
    }
  }, [baseSpline])

  // Generate drag points from ORIGINAL spline (without user adjustments)
  // This ensures drag points stay consistent when user drags them
  // Using originalSpline (not referenceSpline) avoids circular dependency
  useEffect(() => {
    if (originalSpline) {
      const newDragPoints = generateDragPoints(originalSpline)
      // Merge with existing drag points to preserve user adjustments
      const mergedPoints = mergeDragPoints(newDragPoints, dragPoints)
      // Only update if the points actually changed (to prevent infinite loops)
      if (JSON.stringify(mergedPoints) !== JSON.stringify(dragPoints)) {
        setDragPoints(mergedPoints)
      }
    }
  }, [originalSpline])

  // Beim Laden eines bestehenden Jobs oder beim Erstellen eines neuen
  useEffect(() => {
    if (job && isEdit) {
      // Bearbeiten: Daten vom Job laden
      setFormData({
        jobName: job.jobName,
        jobDate: job.jobDate,
        object: job.object || '',
        trolleySerialNumber: job.trolleySerialNumber || '',
        scannerSerialNumber: job.scannerSerialNumber || '',
        scannerType: job.scannerType,
        scannerAlignment: job.scannerAlignment || '80°/80°',
        withTower: job.withTower || false,
        towerHeight: job.towerHeight || 300,
        employeeIds: job.employeeIds || [],
        weatherCondition: job.weather.condition,
        environment: job.weather.environment,
        fixedPointFieldId: job.fixedPointFieldId || '',
        // Trajektorie-Einstellungen
        stationTolerance: job.trajectorySettings?.stationTolerance ?? 25,
        smoothingPasses: job.trajectorySettings?.smoothingPasses ?? 0,
        trackSide: job.trajectorySettings?.trackSide ?? 'all',
        isReversed: job.trajectorySettings?.isReversed ?? false
      })
      // Ziehbare Punkte laden (falls vorhanden)
      if (job.trajectorySettings?.draggedPoints) {
        setDragPoints(job.trajectorySettings.draggedPoints)
      }
    } else if (!isEdit) {
      // Neuer Job: Daten vom letzten Job übernehmen (falls vorhanden)
      loadLastJobSettings()
    }
  }, [job, isEdit, projectId])

  const loadLastJobSettings = async () => {
    // Try to load from the specific project, or from any recent job
    let lastJob = null
    if (projectId) {
      lastJob = await getLastMeasurementJob(projectId)
    }
    if (!lastJob) {
      // Fallback: get the most recent job from any project
      const allJobs = await db.measurementJobs.orderBy('createdAt').reverse().limit(1).toArray()
      lastJob = allJobs[0] || null
    }
    if (lastJob) {
      setFormData(prev => ({
        ...prev,
        // Scanner-Einstellungen vom letzten Job übernehmen
        trolleySerialNumber: lastJob.trolleySerialNumber || '',
        scannerSerialNumber: lastJob.scannerSerialNumber || '',
        scannerType: lastJob.scannerType,
        scannerAlignment: lastJob.scannerAlignment || '80°/80°',
        withTower: lastJob.withTower || false,
        towerHeight: lastJob.towerHeight || 300,
        // Festpunktfeld auch übernehmen
        fixedPointFieldId: lastJob.fixedPointFieldId || '',
        // Trajektorie-Einstellungen vom letzten Job übernehmen
        stationTolerance: lastJob.trajectorySettings?.stationTolerance ?? 25,
        smoothingPasses: lastJob.trajectorySettings?.smoothingPasses ?? 0,
        trackSide: lastJob.trajectorySettings?.trackSide ?? 'all',
        isReversed: lastJob.trajectorySettings?.isReversed ?? false
      }))
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSaving(true)

    try {
      // Determine which project to use
      let effectiveProjectId = projectId || selectedProjectId

      // If no project selected, create a quick project
      if (!effectiveProjectId) {
        const today = new Date().toISOString().split('T')[0]
        effectiveProjectId = await createProject({
          projectNumber: `Schnellprojekt ${today}`,
          startDate: today
        })
      }

      const jobData = {
        jobName: formData.jobName,
        jobDate: formData.jobDate,
        object: formData.object || undefined,
        trolleySerialNumber: formData.trolleySerialNumber || undefined,
        scannerSerialNumber: formData.scannerSerialNumber || undefined,
        scannerType: formData.scannerType,
        scannerAlignment: formData.scannerAlignment,
        withTower: formData.withTower,
        towerHeight: formData.withTower ? formData.towerHeight : undefined,
        employeeIds: formData.employeeIds,
        weather: {
          condition: formData.weatherCondition,
          environment: formData.environment
        },
        fixedPointFieldId: formData.fixedPointFieldId || undefined,
        // Trajektorie-Einstellungen nur speichern wenn Festpunktfeld ausgewählt
        trajectorySettings: formData.fixedPointFieldId ? {
          stationTolerance: formData.stationTolerance,
          smoothingPasses: formData.smoothingPasses,
          trackSide: formData.trackSide,
          isReversed: formData.isReversed,
          // Nur modifizierte Ziehpunkte speichern
          draggedPoints: dragPoints.filter(
            dp => dp.adjustedLat !== dp.originalLat || dp.adjustedLon !== dp.originalLon
          ).length > 0 ? dragPoints.filter(
            dp => dp.adjustedLat !== dp.originalLat || dp.adjustedLon !== dp.originalLon
          ) : undefined
        } : undefined
      }

      if (isEdit && jobId) {
        await updateMeasurementJob(jobId, jobData)
        navigate(`/projects/${effectiveProjectId}/jobs/${jobId}`)
      } else {
        const newJobId = await createMeasurementJob(effectiveProjectId, jobData)
        navigate(`/projects/${effectiveProjectId}/jobs/${newJobId}`)
      }
    } catch (error) {
      console.error('Error saving measurement job:', error)
    } finally {
      setIsSaving(false)
    }
  }

  const handleAddEmployee = async () => {
    if (!newEmployeeName.trim()) return

    try {
      const newEmpId = await addEmployee(newEmployeeName.trim())
      setFormData({ ...formData, employeeIds: [...formData.employeeIds, newEmpId] })
      setNewEmployeeName('')
      setShowAddEmployee(false)
    } catch (error) {
      console.error('Error adding employee:', error)
    }
  }

  const toggleEmployee = (empId: string) => {
    if (formData.employeeIds.includes(empId)) {
      setFormData({ ...formData, employeeIds: formData.employeeIds.filter(id => id !== empId) })
    } else {
      setFormData({ ...formData, employeeIds: [...formData.employeeIds, empId] })
    }
  }

  const handleUpdateEmployee = async (id: string) => {
    if (!editingEmployeeName.trim()) return
    // Preserve existing company/location when editing only the name
    const emp = employees.find(e => e.id === id)
    await updateEmployee(id, editingEmployeeName.trim(), emp?.company, emp?.location)
    setEditingEmployeeId(null)
    setEditingEmployeeName('')
  }

  const handleDeleteEmployee = async (id: string, name: string) => {
    if (confirm(t('settings.deleteEmployee') + `: "${name}"?`)) {
      // Remove from selection if selected
      if (formData.employeeIds.includes(id)) {
        setFormData({ ...formData, employeeIds: formData.employeeIds.filter(eid => eid !== id) })
      }
      await deleteEmployee(id)
    }
  }

  const startEditingEmployee = (id: string, name: string) => {
    setEditingEmployeeId(id)
    setEditingEmployeeName(name)
  }

  const cancelEditingEmployee = () => {
    setEditingEmployeeId(null)
    setEditingEmployeeName('')
  }

  // Close employee dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (employeeDropdownRef.current && !employeeDropdownRef.current.contains(e.target as Node)) {
        setEmployeeDropdownOpen(false)
        setEmployeeSearch('')
      }
    }
    if (employeeDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [employeeDropdownOpen])

  const filteredEmployees = useMemo(() => {
    if (!employeeSearch.trim()) return employees
    const q = employeeSearch.toLowerCase()
    return employees.filter(emp => emp.name.toLowerCase().includes(q))
  }, [employees, employeeSearch])

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
        title={isEdit ? t('measurementJob.edit') : t('measurementJob.new')}
        onBack={() => projectId ? navigate(`/projects/${projectId}`) : navigate('/jobs')}
      />

      {project && (
        <div className="mb-4 p-3 rounded-lg" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {t('measurementJob.forProject')}: <span style={{ color: 'var(--color-text)' }}>{project.projectNumber}{project.client ? ` - ${project.client}` : ''}</span>
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Basis-Daten */}
        <Card>
          <CardContent>
            <h3 className="text-md font-semibold mb-4" style={{ color: 'var(--color-text)' }}>
              {t('measurementJob.basicData')}
            </h3>
            <div className="space-y-4">
              <Input
                label={t('measurementJob.jobName')}
                value={formData.jobName}
                onChange={(e) => setFormData({ ...formData, jobName: e.target.value })}
                required
                placeholder={t('measurementJob.jobNamePlaceholder')}
              />

              <Input
                type="date"
                label={t('measurementJob.jobDate')}
                value={formData.jobDate}
                onChange={(e) => setFormData({ ...formData, jobDate: e.target.value })}
                required
              />

              {/* Project selection - only when no projectId in URL */}
              {!projectId && !isEdit && (
                <Select
                  label={t('jobs.project')}
                  value={selectedProjectId}
                  onChange={(e) => setSelectedProjectId(e.target.value)}
                  options={[
                    { value: '', label: t('jobs.noProject') },
                    ...allProjects.map(p => ({
                      value: p.id,
                      label: `${p.projectNumber}${p.client ? ` - ${p.client}` : ''}`
                    }))
                  ]}
                />
              )}

              <Input
                label={t('measurementJob.object')}
                value={formData.object}
                onChange={(e) => setFormData({ ...formData, object: e.target.value })}
                placeholder={t('measurementJob.objectPlaceholder')}
              />
            </div>
          </CardContent>
        </Card>

        {/* Trolley & Scanner */}
        <Card>
          <CardContent>
            <h3 className="text-md font-semibold mb-4" style={{ color: 'var(--color-text)' }}>
              {t('measurementJob.equipment')}
            </h3>
            <div className="space-y-4">
              <Select
                label={t('measurementJob.trolleySerialNumber')}
                value={formData.trolleySerialNumber}
                onChange={(e) => setFormData({ ...formData, trolleySerialNumber: e.target.value as TrolleySerialNumber | '' })}
                options={[
                  { value: '', label: t('measurementJob.noSelection') },
                  ...TROLLEY_SERIAL_NUMBERS.map(sn => ({ value: sn, label: sn }))
                ]}
              />

              <Select
                label={t('measurementJob.scannerSerialNumber')}
                value={formData.scannerSerialNumber}
                onChange={(e) => setFormData({ ...formData, scannerSerialNumber: e.target.value as ScannerSerialNumber | '' })}
                options={[
                  { value: '', label: t('measurementJob.noSelection') },
                  ...SCANNER_SERIAL_NUMBERS.map(sn => ({ value: sn, label: sn }))
                ]}
              />

              <Select
                label={t('measurementJob.scannerType')}
                value={formData.scannerType}
                onChange={(e) => setFormData({ ...formData, scannerType: e.target.value as ScannerType })}
                options={[
                  { value: 'GX50', label: 'GX50' },
                  { value: 'TX8', label: 'TX8' }
                ]}
                required
              />

              <Select
                label={t('measurementJob.scannerAlignment')}
                value={formData.scannerAlignment}
                onChange={(e) => setFormData({ ...formData, scannerAlignment: e.target.value as ScannerAlignment })}
                options={[
                  { value: '80°/80°', label: '80°/80°' },
                  { value: '90°/90°', label: '90°/90°' }
                ]}
              />

              <div className="space-y-2">
                <Toggle
                  checked={formData.withTower}
                  onChange={(checked) => setFormData({ ...formData, withTower: checked, towerHeight: checked ? 300 : 0 })}
                  label={t('measurementJob.withTower')}
                />

                {formData.withTower && (
                  <Input
                    type="number"
                    label={t('measurementJob.towerHeight')}
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

        {/* Mitarbeiter */}
        <Card>
          <CardContent>
            <h3 className="text-md font-semibold mb-4" style={{ color: 'var(--color-text)' }}>
              {t('measurementJob.employees')}
            </h3>
            <div className="space-y-2">
              {employees.length >= 8 ? (
                /* Dropdown-Modus ab 8 Mitarbeitern */
                <div ref={employeeDropdownRef} className="relative">
                  {/* Ausgewählte Mitarbeiter als Chips */}
                  <div
                    className="min-h-[42px] p-2 rounded-lg cursor-pointer flex flex-wrap gap-1.5 items-center"
                    style={{
                      backgroundColor: 'var(--color-bg-input)',
                      border: '1px solid var(--color-border-input)'
                    }}
                    onClick={() => setEmployeeDropdownOpen(!employeeDropdownOpen)}
                  >
                    {formData.employeeIds.length > 0 ? (
                      <>
                        {formData.employeeIds.map(id => {
                          const emp = employees.find(e => e.id === id)
                          if (!emp) return null
                          return (
                            <span
                              key={id}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                              style={{
                                backgroundColor: 'rgba(59, 130, 246, 0.15)',
                                color: '#3b82f6',
                                border: '1px solid rgba(59, 130, 246, 0.3)'
                              }}
                            >
                              {emp.name}
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); toggleEmployee(id) }}
                                className="hover:opacity-70"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </span>
                          )
                        })}
                      </>
                    ) : (
                      <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                        {t('measurementJob.noEmployeesSelected')}
                      </span>
                    )}
                    <ChevronDown
                      className={`w-4 h-4 ml-auto shrink-0 transition-transform ${employeeDropdownOpen ? 'rotate-180' : ''}`}
                      style={{ color: 'var(--color-text-muted)' }}
                    />
                  </div>

                  {/* Dropdown-Panel */}
                  {employeeDropdownOpen && (
                    <div
                      className="absolute z-50 left-0 right-0 mt-1 rounded-lg shadow-lg overflow-hidden"
                      style={{
                        backgroundColor: 'var(--color-bg-card)',
                        border: '1px solid var(--color-border)'
                      }}
                    >
                      {/* Suchfeld */}
                      <div className="p-2" style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <div className="relative">
                          <Search
                            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
                            style={{ color: 'var(--color-text-muted)' }}
                          />
                          <input
                            type="text"
                            value={employeeSearch}
                            onChange={(e) => setEmployeeSearch(e.target.value)}
                            placeholder={t('measurementJob.searchEmployees')}
                            className="w-full pl-9 pr-3 py-1.5 rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                            style={{
                              backgroundColor: 'var(--color-bg-input)',
                              color: 'var(--color-text)',
                              border: '1px solid var(--color-border-input)'
                            }}
                            autoFocus
                          />
                        </div>
                      </div>

                      {/* Scrollbare Liste */}
                      <div className="max-h-48 overflow-y-auto">
                        {filteredEmployees.map((emp) => (
                          <div
                            key={emp.id}
                            className="flex items-center gap-2 px-3 py-2"
                            style={{ borderBottom: '1px solid var(--color-border)' }}
                          >
                            {editingEmployeeId === emp.id ? (
                              <>
                                <Input
                                  value={editingEmployeeName}
                                  onChange={(e) => setEditingEmployeeName(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') { e.preventDefault(); handleUpdateEmployee(emp.id) }
                                    if (e.key === 'Escape') cancelEditingEmployee()
                                  }}
                                  className="flex-1"
                                  autoFocus
                                />
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleUpdateEmployee(emp.id)}
                                  className="p-1.5 text-green-600"
                                >
                                  <Check className="w-4 h-4" />
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={cancelEditingEmployee}
                                  className="p-1.5"
                                >
                                  <X className="w-4 h-4" />
                                </Button>
                              </>
                            ) : (
                              <>
                                <input
                                  type="checkbox"
                                  checked={formData.employeeIds.includes(emp.id)}
                                  onChange={() => toggleEmployee(emp.id)}
                                  className="w-4 h-4 text-primary-600 rounded focus:ring-primary-500"
                                />
                                <div className="flex-1 min-w-0">
                                  <span className="text-sm" style={{ color: 'var(--color-text)' }}>{emp.name}</span>
                                  {emp.company && (
                                    <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{emp.company}</div>
                                  )}
                                </div>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => startEditingEmployee(emp.id, emp.name)}
                                  className="p-1.5"
                                >
                                  <Edit className="w-4 h-4" />
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDeleteEmployee(emp.id, emp.name)}
                                  className="p-1.5 text-red-600"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </>
                            )}
                          </div>
                        ))}
                        {filteredEmployees.length === 0 && (
                          <div className="px-3 py-4 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
                            {t('measurementJob.noEmployeesFound')}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* Flache Checkbox-Liste bei < 8 Mitarbeitern */
                employees.map((emp) => (
                  <div
                    key={emp.id}
                    className="flex items-center gap-2 p-2 rounded"
                    style={{ backgroundColor: 'var(--color-bg)' }}
                  >
                    {editingEmployeeId === emp.id ? (
                      <>
                        <Input
                          value={editingEmployeeName}
                          onChange={(e) => setEditingEmployeeName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); handleUpdateEmployee(emp.id) }
                            if (e.key === 'Escape') cancelEditingEmployee()
                          }}
                          className="flex-1"
                          autoFocus
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleUpdateEmployee(emp.id)}
                          className="p-1.5 text-green-600"
                        >
                          <Check className="w-4 h-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={cancelEditingEmployee}
                          className="p-1.5"
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <input
                          type="checkbox"
                          checked={formData.employeeIds.includes(emp.id)}
                          onChange={() => toggleEmployee(emp.id)}
                          className="w-4 h-4 text-primary-600 rounded focus:ring-primary-500"
                        />
                        <div className="flex-1 min-w-0">
                          <span className="text-sm" style={{ color: 'var(--color-text)' }}>{emp.name}</span>
                          {emp.company && (
                            <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{emp.company}</div>
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => startEditingEmployee(emp.id, emp.name)}
                          className="p-1.5"
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteEmployee(emp.id, emp.name)}
                          className="p-1.5 text-red-600"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </>
                    )}
                  </div>
                ))
              )}

              {showAddEmployee ? (
                <div className="flex gap-2 mt-2">
                  <Input
                    value={newEmployeeName}
                    onChange={(e) => setNewEmployeeName(e.target.value)}
                    placeholder={t('measurementJob.employeeNamePlaceholder')}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddEmployee())}
                    autoFocus
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
                  {t('measurementJob.addEmployee')}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Wetterbedingungen */}
        <Card>
          <CardContent>
            <h3 className="text-md font-semibold mb-4" style={{ color: 'var(--color-text)' }}>
              {t('measurementJob.weather')}
            </h3>
            <div className="space-y-4">
              <Select
                label={t('measurementJob.weatherCondition')}
                value={formData.weatherCondition}
                onChange={(e) => setFormData({ ...formData, weatherCondition: e.target.value as WeatherCondition })}
                options={[
                  { value: 'sunny', label: t('weather.sunny') },
                  { value: 'cloudy', label: t('weather.cloudy') },
                  { value: 'rainy', label: t('weather.rainy') }
                ]}
                required
              />

              <Select
                label={t('measurementJob.environment')}
                value={formData.environment}
                onChange={(e) => setFormData({ ...formData, environment: e.target.value as Environment })}
                options={[
                  { value: 'outdoor', label: t('environment.outdoor') },
                  { value: 'covered', label: t('environment.covered') }
                ]}
                required
              />
            </div>
          </CardContent>
        </Card>

        {/* Festpunktfeld */}
        <Card>
          <CardContent>
            <h3 className="text-md font-semibold mb-4" style={{ color: 'var(--color-text)' }}>
              {t('measurementJob.fixedPointField')}
            </h3>
            <Select
              label={t('measurementJob.selectFixedPointField')}
              value={formData.fixedPointFieldId}
              onChange={(e) => setFormData({ ...formData, fixedPointFieldId: e.target.value })}
              options={[
                { value: '', label: t('measurementJob.noFixedPointField') },
                ...fields.map(field => ({ value: field.id, label: `${field.name} (${field.points.length} ${t('measurementJob.points')})` }))
              ]}
            />
          </CardContent>
        </Card>

        {/* Trajektorie-Einstellungen - nur wenn Festpunktfeld ausgewählt und Beta aktiviert */}
        {formData.fixedPointFieldId && betaSplineEnabled && (
          <Card>
            <CardContent>
              <h3 className="text-md font-semibold mb-4" style={{ color: 'var(--color-text)' }}>
                {t('trajectory.title')}
              </h3>

              {/* Kartenvorschau - oben */}
              {selectedField && selectedField.points.length > 0 && (
                <div className="mb-4">
                  <RunMap
                    fixedPoints={selectedField.points}
                    alwaysExpanded={true}
                    defaultHeightExpanded={true}
                    fieldId={selectedField.id}
                    trackInfo={trackInfo}
                    upcomingPoints={[]}
                    preventAutoZoom={true}
                    dragPoints={dragPoints}
                    showDragPoints={showDragPoints}
                    onDragPointUpdate={(index, lat, lon) => {
                      setDragPoints(prev => prev.map(dp =>
                        dp.index === index
                          ? { ...dp, adjustedLat: lat, adjustedLon: lon }
                          : dp
                      ))
                    }}
                  />
                </div>
              )}

              <div className="space-y-4">
                {/* 1. Fahrtrichtung */}
                <div>
                  <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
                    {t('trajectory.direction')}
                  </label>
                  <Button
                    type="button"
                    variant={formData.isReversed ? 'primary' : 'secondary'}
                    onClick={() => setFormData({ ...formData, isReversed: !formData.isReversed })}
                    className="w-full flex items-center justify-center gap-2"
                  >
                    <RefreshCw className="w-4 h-4" />
                    {formData.isReversed ? t('trajectory.directionReversed') : t('trajectory.reverseDirection')}
                  </Button>
                </div>

                {/* 2. Gleisseite */}
                <div>
                  <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
                    {t('trajectory.trackSide')}
                  </label>
                  <div className="flex gap-2">
                    {(['all', 'left', 'right'] as TrackSide[]).map((side) => (
                      <button
                        key={side}
                        type="button"
                        onClick={() => setFormData({ ...formData, trackSide: side })}
                        className="flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors"
                        style={{
                          backgroundColor: formData.trackSide === side ? '#3b82f6' : 'var(--color-bg-input)',
                          color: formData.trackSide === side ? 'white' : 'var(--color-text)',
                          border: `1px solid ${formData.trackSide === side ? '#3b82f6' : 'var(--color-border-input)'}`
                        }}
                      >
                        {t(`trajectory.side.${side}`)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 3. Stations-Toleranz */}
                <div>
                  <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
                    {t('trajectory.stationTolerance')}: {formData.stationTolerance}m
                  </label>
                  <input
                    type="range"
                    min="5"
                    max="100"
                    step="5"
                    value={formData.stationTolerance}
                    onChange={(e) => setFormData({ ...formData, stationTolerance: parseInt(e.target.value) })}
                    className="w-full h-2 rounded-lg appearance-none cursor-pointer"
                    style={{ backgroundColor: 'var(--color-border)' }}
                  />
                  <div className="flex justify-between text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                    <span>5m</span>
                    <span>100m</span>
                  </div>
                </div>

                {/* 4. Glättung */}
                <div>
                  <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
                    {t('trajectory.smoothing')}: {formData.smoothingPasses}
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="5"
                    step="0.2"
                    value={formData.smoothingPasses}
                    onChange={(e) => setFormData({ ...formData, smoothingPasses: parseFloat(e.target.value) })}
                    className="w-full h-2 rounded-lg appearance-none cursor-pointer"
                    style={{ backgroundColor: 'var(--color-border)' }}
                  />
                  <div className="flex justify-between text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                    <span>{t('trajectory.noSmoothing')}</span>
                    <span>{t('trajectory.maxSmoothing')}</span>
                  </div>
                </div>

                {/* 5. Manuelle Trajektorie-Anpassung */}
                <div className="pt-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                      {t('trajectory.manualAdjustment') || 'Manuelle Anpassung'}
                    </label>
                    {dragPoints.filter(dp => dp.adjustedLat !== dp.originalLat || dp.adjustedLon !== dp.originalLon).length > 0 && (
                      <span className="text-xs px-2 py-0.5 rounded" style={{
                        backgroundColor: 'rgba(34, 197, 94, 0.2)',
                        color: '#22c55e'
                      }}>
                        {dragPoints.filter(dp => dp.adjustedLat !== dp.originalLat || dp.adjustedLon !== dp.originalLon).length} {t('trajectory.pointsModified') || 'angepasst'}
                      </span>
                    )}
                  </div>

                  <p className="text-xs mb-3" style={{ color: 'var(--color-text-muted)' }}>
                    {t('trajectory.dragPointsDescription') || 'Wenn die automatische Trajektorie nicht korrekt ist, können Sie die orangenen Kontrollpunkte auf der Karte ziehen, um den Verlauf anzupassen.'}
                  </p>

                  <Button
                    type="button"
                    variant={showDragPoints ? 'primary' : 'secondary'}
                    onClick={() => setShowDragPoints(!showDragPoints)}
                    className="w-full flex items-center justify-center gap-2 mb-2"
                  >
                    <MapPin className="w-4 h-4" />
                    {showDragPoints
                      ? (t('trajectory.hideDragPoints') || 'Kontrollpunkte ausblenden')
                      : (t('trajectory.showDragPoints') || 'Kontrollpunkte anzeigen')
                    }
                  </Button>

                  {showDragPoints && (
                    <div className="p-3 rounded-lg text-sm" style={{
                      backgroundColor: 'rgba(249, 115, 22, 0.1)',
                      border: '1px solid rgba(249, 115, 22, 0.3)'
                    }}>
                      <p style={{ color: 'var(--color-text)' }}>
                        {t('trajectory.dragPointsModeHint') || 'Ziehen Sie die orangenen Punkte auf der Karte, um die Trajektorie anzupassen. Grüne Punkte zeigen bereits angepasste Positionen.'}
                      </p>
                    </div>
                  )}

                  {/* Reset-Button wenn Änderungen vorhanden */}
                  {dragPoints.filter(dp => dp.adjustedLat !== dp.originalLat || dp.adjustedLon !== dp.originalLon).length > 0 && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setDragPoints(prev => prev.map(dp => ({
                          ...dp,
                          adjustedLat: dp.originalLat,
                          adjustedLon: dp.originalLon
                        })))
                      }}
                      className="w-full text-red-600 mt-2"
                    >
                      {t('trajectory.resetDragPoints') || 'Alle Anpassungen zurücksetzen'}
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Buttons */}
        <div className="flex gap-3 pb-6">
          <Button
            type="button"
            variant="secondary"
            onClick={() => projectId ? navigate(`/projects/${projectId}`) : navigate('/jobs')}
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
