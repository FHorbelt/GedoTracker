import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '../components/layout/PageHeader'
import { Card, CardContent } from '../components/common/Card'
import { Input } from '../components/common/Input'
import { Select } from '../components/common/Select'
import { Toggle } from '../components/common/Toggle'
import { Button } from '../components/common/Button'
import { TrackVisualization } from '../components/TrackVisualization'
import { useProject } from '../hooks/useProjects'
import { useRun, createRun, updateRun, deleteRun, getLastRun } from '../hooks/useRuns'
import { useFixedPointField } from '../hooks/useFixedPoints'
import { useActiveRun } from '../contexts/ActiveRunContext'
import { Direction, ScannerAlignment, TrackingMode, TrackedPoint, RunRemark, TargetBoardInfo } from '../db/models'
import { incrementRunName, generateInitialRunName } from '../utils/runNumbering'
import { formatKmValue } from '../utils/kmCalculation'
import { suggestPoints, PointSuggestion, findPairedPointByNumber } from '../utils/pointSuggestion'
import { FixedPoint } from '../db/models'
import { Play, Save, Plus, Trash2, MessageSquare, ArrowRight, ArrowLeft, X } from 'lucide-react'
import { v4 as uuidv4 } from 'uuid'

type RunPhase = 'setup' | 'recording' | 'completed'

// Target board options for each parameter
const TARGET_BOARD_SIZES = ['100', '200'] // in mm
const TARGET_BOARD_HEIGHTS = [-6, 250, 500] // in mm
const TARGET_BOARD_THICKNESSES = [0, 3, 60] // in mm

const DEFAULT_TARGET_BOARD: TargetBoardInfo = { size: '100', height: -6, thickness: 60 }

// Helper to parse German number format (comma as decimal separator)
function parseGermanNumber(value: string | number): number {
  if (typeof value === 'number') return value
  // Replace comma with dot for German format
  return parseFloat(value.replace(',', '.'))
}

export function RunEditor() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { projectId, runId } = useParams()
  const isEdit = !!runId
  const { project } = useProject(projectId)
  const { run, isLoading } = useRun(runId)
  const { field } = useFixedPointField(project?.fixedPointFieldId)
  const { activeRun, setActiveRun, clearActiveRun, isRunActive } = useActiveRun()

  const [phase, setPhase] = useState<RunPhase>('setup')
  const [isSaving, setIsSaving] = useState(false)
  const [initialLoadDone, setInitialLoadDone] = useState(false)

  // Form data
  const [formData, setFormData] = useState({
    runName: '',
    track: '',
    direction: 'ascending' as Direction,
    objectDesignation: '',
    startKm: '' as string | number,
    scannerAlignment: '80°/80°' as ScannerAlignment,
    gpsEnabled: false,
    speed: '' as string | number,
    length: '' as string | number
  })

  const [trackedPoints, setTrackedPoints] = useState<TrackedPoint[]>([])
  const [remarks, setRemarks] = useState<RunRemark[]>([])

  // Point entry
  const [newPoint, setNewPoint] = useState({
    pointNumber: '',
    localDistance: '',
    side: 'left' as 'left' | 'right'
  })
  const [pointSuggestions, setPointSuggestions] = useState<PointSuggestion[]>([])
  const [textBasedSuggestions, setTextBasedSuggestions] = useState<{ pointNumber: string, id: string }[]>([])
  const [pairedPointSuggestion, setPairedPointSuggestion] = useState<FixedPoint | null>(null)
  const [includePairedPoint, setIncludePairedPoint] = useState(false)

  // Remark entry
  const [newRemark, setNewRemark] = useState('')
  const [showRemarkInput, setShowRemarkInput] = useState(false)

  // Target board settings
  const [targetBoard, setTargetBoard] = useState<TargetBoardInfo>(DEFAULT_TARGET_BOARD)
  const [useCustomTargetBoard, setUseCustomTargetBoard] = useState(false)
  const [customHeight, setCustomHeight] = useState('-6')
  const [customThickness, setCustomThickness] = useState('60')

  // Update point suggestions when local distance changes
  const handleDistanceChange = (distance: string) => {
    setNewPoint({ ...newPoint, localDistance: distance })

    if (distance && field && parseFloat(distance) > 0) {
      const suggestions = suggestPoints(
        field.points,
        trackedPoints,
        parseFloat(distance),
        15 // 15m tolerance
      )
      setPointSuggestions(suggestions)
      // Clear text-based suggestions when distance suggestions appear
      setTextBasedSuggestions([])
    } else {
      setPointSuggestions([])
    }
  }

  // Update text-based suggestions when point number is typed
  const handlePointNumberChange = (value: string) => {
    setNewPoint({ ...newPoint, pointNumber: value })

    if (value.length >= 2 && field) {
      const trackedIds = new Set(trackedPoints.map(p => p.pointId))
      const filtered = field.points
        .filter(p =>
          !trackedIds.has(p.id) &&
          p.pointNumber.toLowerCase().includes(value.toLowerCase())
        )
        .slice(0, 5) // Show max 5 suggestions
        .map(p => ({ pointNumber: p.pointNumber, id: p.id }))

      setTextBasedSuggestions(filtered)

      // Check if this point has a paired point
      if (value.length >= 3) {
        const pairedPoint = findPairedPointByNumber(value, field.points, trackedPoints)
        setPairedPointSuggestion(pairedPoint)
        setIncludePairedPoint(false)
      }
    } else {
      setTextBasedSuggestions([])
      setPairedPointSuggestion(null)
    }
  }

  // Initialize form
  useEffect(() => {
    async function loadInitialData() {
      if (!isEdit && projectId && project) {
        const lastRun = await getLastRun(projectId)
        const suggestedName = lastRun
          ? incrementRunName(lastRun.runName)
          : generateInitialRunName(project.projectNumber)

        setFormData(prev => ({
          ...prev,
          runName: suggestedName,
          scannerAlignment: project.scannerOrientation,
          // Pre-fill from previous run if available
          track: lastRun?.track || '',
          objectDesignation: lastRun?.objectDesignation || '',
          startKm: lastRun?.endKm || ''
        }))
      }
    }
    loadInitialData()
  }, [isEdit, projectId, project])

  // Load existing run - only set phase on initial load
  useEffect(() => {
    if (run && isEdit && projectId && runId && !initialLoadDone) {
      setFormData({
        runName: run.runName,
        track: run.track,
        direction: run.direction,
        objectDesignation: run.objectDesignation,
        startKm: run.startKm,
        scannerAlignment: run.scannerAlignment,
        gpsEnabled: run.gpsEnabled,
        speed: run.speed || 0,
        length: run.length || 0
      })
      setTrackedPoints(run.trackedPoints)
      setRemarks(run.remarks)
      setPhase(run.isCompleted ? 'completed' : 'recording')
      setInitialLoadDone(true)

      // Set as active run if not completed
      if (!run.isCompleted) {
        setActiveRun({
          projectId,
          runId,
          runName: run.runName
        })
      }
    }
  }, [run, isEdit, projectId, runId, setActiveRun, initialLoadDone])

  const handleStartRun = async () => {
    // Check if another run is already active
    if (isRunActive && activeRun) {
      alert(`Es läuft bereits eine Messfahrt: "${activeRun.runName}". Bitte diese zuerst beenden.`)
      return
    }

    // Only runName and track are required, startKm is optional (just for orientation)
    if (!formData.runName || !formData.track) {
      alert('Bitte Fahrtname und Gleis angeben')
      return
    }

    if (!projectId) return

    // Create run immediately and navigate to edit page
    try {
      const runData = {
        runName: formData.runName,
        track: formData.track,
        direction: formData.direction,
        objectDesignation: formData.objectDesignation,
        startKm: parseGermanNumber(formData.startKm.toString()) || 0,
        scannerAlignment: formData.scannerAlignment,
        trackingMode: 'double' as TrackingMode,
        trackedPoints: [],
        remarks: [],
        gpsEnabled: formData.gpsEnabled,
        isCompleted: false
      }

      const newRunId = await createRun(projectId, runData)

      // Set as active run
      setActiveRun({
        projectId,
        runId: newRunId,
        runName: formData.runName
      })

      // Navigate to the edit page for this run
      navigate(`/projects/${projectId}/runs/${newRunId}`, { replace: true })
    } catch (error) {
      console.error('Error creating run:', error)
      alert('Fehler beim Erstellen der Messfahrt')
    }
  }

  const handleAddPoint = async () => {
    try {
      console.log('handleAddPoint called', newPoint)

      if (!newPoint.pointNumber || !newPoint.localDistance) {
        alert('Bitte Punktnummer und Strecke angeben')
        return
      }

      const localDistance = parseFloat(newPoint.localDistance)
      if (isNaN(localDistance) || localDistance < 0) {
        alert('Ungültige Streckenlänge')
        return
      }

      // Start-KM is optional, use 0 if not set or invalid (just for orientation)
      const startKmValue = parseGermanNumber(formData.startKm.toString())
      const kmValue = (isNaN(startKmValue) ? 0 : startKmValue) + localDistance

      const point: TrackedPoint = {
        id: uuidv4(),
        pointNumber: newPoint.pointNumber,
        side: newPoint.side,
        localDistance: localDistance,
        kmValue: kmValue,
        timestamp: new Date().toISOString(),
        targetBoard: { ...targetBoard }
      }

      // Check if point exists in field
      if (field) {
        const fixedPoint = field.points.find(p => p.pointNumber === newPoint.pointNumber)
        if (fixedPoint) {
          point.pointId = fixedPoint.id
        }
      }

      console.log('Adding point:', point)
      const pointsToAdd = [point]

      // Add paired point if checkbox is checked
      if (includePairedPoint && pairedPointSuggestion) {
        const pairedSide: 'left' | 'right' = newPoint.side === 'left' ? 'right' : 'left'
        const pairedPoint: TrackedPoint = {
          id: uuidv4(),
          pointId: pairedPointSuggestion.id,
          pointNumber: pairedPointSuggestion.pointNumber,
          side: pairedSide,
          localDistance: localDistance,
          kmValue: kmValue,
          timestamp: new Date().toISOString(),
          targetBoard: { ...targetBoard }
        }
        pointsToAdd.push(pairedPoint)
        console.log('Also adding paired point:', pairedPoint)
      }

      const newTrackedPoints = [...trackedPoints, ...pointsToAdd]
      setTrackedPoints(newTrackedPoints)
      setNewPoint({ pointNumber: '', localDistance: '', side: 'left' })
      setPairedPointSuggestion(null)
      setIncludePairedPoint(false)

      // Save to DB immediately
      if (runId) {
        await updateRun(runId, { trackedPoints: newTrackedPoints })
      }

      console.log('Point(s) added successfully')
    } catch (error) {
      console.error('Error adding point:', error)
      alert('Fehler beim Hinzufügen des Punktes: ' + error)
    }
  }

  const handleRemovePoint = async (id: string) => {
    const newTrackedPoints = trackedPoints.filter(p => p.id !== id)
    setTrackedPoints(newTrackedPoints)

    // Save to DB immediately
    if (runId) {
      await updateRun(runId, { trackedPoints: newTrackedPoints })
    }
  }

  const handleAddRemark = async () => {
    if (!newRemark.trim()) return

    const remark: RunRemark = {
      id: uuidv4(),
      number: remarks.length + 1,
      text: newRemark.trim(),
      timestamp: new Date().toISOString()
    }

    const newRemarks = [...remarks, remark]
    setRemarks(newRemarks)
    setNewRemark('')
    setShowRemarkInput(false)

    // Save to DB immediately
    if (runId) {
      await updateRun(runId, { remarks: newRemarks })
    }
  }

  const handleCompleteRun = (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault()
      e.stopPropagation()
    }
    if (trackedPoints.length === 0) {
      alert('Bitte mindestens einen Punkt erfassen')
      return
    }
    setPhase('completed')
    // Scroll to top to show the completion form
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleCancelRun = async () => {
    const confirmed = window.confirm('Messfahrt wirklich abbrechen? Alle erfassten Daten werden gelöscht.')
    if (!confirmed) return

    try {
      if (runId) {
        await deleteRun(runId)
      }
      clearActiveRun()
      navigate(`/projects/${projectId}`)
    } catch (error) {
      console.error('Error canceling run:', error)
      alert('Fehler beim Abbrechen der Messfahrt')
    }
  }

  const handleSave = async () => {
    if (!projectId) return

    if (phase === 'completed') {
      if (!formData.speed || !formData.length || parseFloat(formData.speed.toString()) === 0 || parseFloat(formData.length.toString()) === 0) {
        alert('Bitte Geschwindigkeit und Gesamtlänge eingeben')
        return
      }
    }

    setIsSaving(true)

    try {
      const endKm = parseGermanNumber(formData.startKm.toString()) + parseFloat(formData.length.toString())
      const pointFrom = trackedPoints.length > 0 ? trackedPoints[0].pointNumber : ''
      const pointTo = trackedPoints.length > 0 ? trackedPoints[trackedPoints.length - 1].pointNumber : ''

      const runData = {
        runName: formData.runName,
        track: formData.track,
        direction: formData.direction,
        objectDesignation: formData.objectDesignation,
        startKm: parseGermanNumber(formData.startKm.toString()),
        endKm: phase === 'completed' ? endKm : undefined,
        length: phase === 'completed' ? parseFloat(formData.length.toString()) : undefined,
        scannerAlignment: formData.scannerAlignment,
        speed: phase === 'completed' ? parseFloat(formData.speed.toString()) : undefined,
        trackingMode: 'double' as TrackingMode, // Default, da Seite pro Punkt erfasst wird
        pointNumberFrom: pointFrom,
        pointNumberTo: pointTo,
        trackedPoints: trackedPoints,
        remarks: remarks,
        gpsEnabled: formData.gpsEnabled,
        gpsTrack: formData.gpsEnabled ? [] : undefined,
        isCompleted: phase === 'completed'
      }

      if (isEdit && runId) {
        await updateRun(runId, runData)
      } else {
        await createRun(projectId, runData)
      }

      // Clear active run if completed
      if (phase === 'completed') {
        clearActiveRun()
      }

      navigate(`/projects/${projectId}`)
    } catch (error) {
      console.error('Error saving run:', error)
      alert('Fehler beim Speichern')
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading || !project) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    )
  }

  if (!project.fixedPointFieldId) {
    return (
      <div>
        <PageHeader
          title={t('runs.new')}
          onBack={() => navigate(`/projects/${projectId}`)}
        />
        <Card>
          <CardContent className="text-center py-12">
            <p className="text-slate-600">Kein Festpunktfeld für dieses Projekt ausgewählt.</p>
            <Button onClick={() => navigate(`/projects/${projectId}/edit`)} className="mt-4">
              Projekt bearbeiten
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title={
          phase === 'setup' ? 'Neue Messfahrt' :
          phase === 'recording' ? `Messfahrt läuft: ${formData.runName}` :
          'Messfahrt abschließen'
        }
        onBack={() => navigate(`/projects/${projectId}`)}
      />

      <div className="space-y-4">
        {/* PHASE 1: SETUP */}
        {phase === 'setup' && (
          <>
            <Card>
              <CardContent>
                <h3 className="text-md font-semibold text-slate-900 mb-4">Fahrtdaten</h3>
                <div className="space-y-4">
                  <Input
                    label={t('runs.runName')}
                    value={formData.runName}
                    onChange={(e) => setFormData({ ...formData, runName: e.target.value })}
                    required
                    placeholder="z.B. A1P001_Scan 01"
                  />

                  <Input
                    label={t('runs.track')}
                    value={formData.track}
                    onChange={(e) => setFormData({ ...formData, track: e.target.value })}
                    required
                    placeholder="Gleisbezeichnung"
                  />

                  <Select
                    label={t('runs.direction')}
                    value={formData.direction}
                    onChange={(e) => setFormData({ ...formData, direction: e.target.value as Direction })}
                    options={[
                      { value: 'ascending', label: t('runs.ascending') },
                      { value: 'descending', label: t('runs.descending') }
                    ]}
                    required
                  />

                  <Input
                    label={t('runs.objectDesignation')}
                    value={formData.objectDesignation}
                    onChange={(e) => setFormData({ ...formData, objectDesignation: e.target.value })}
                    placeholder="Strecke, BhfGleis, etc."
                  />

                  <Input
                    type="number"
                    step="0.1"
                    label="Start-Kilometer (in Meter)"
                    value={formData.startKm}
                    onChange={(e) => setFormData({ ...formData, startKm: e.target.value })}
                    placeholder="z.B. 1423.5"
                    required
                  />
                  {formData.startKm && parseGermanNumber(formData.startKm.toString()) > 0 && (
                    <p className="text-sm text-slate-600">
                      = {formatKmValue(parseGermanNumber(formData.startKm.toString()))}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <h3 className="text-md font-semibold text-slate-900 mb-4">Einstellungen</h3>
                <div className="space-y-4">
                  <Select
                    label={t('runs.scannerAlignment')}
                    value={formData.scannerAlignment}
                    onChange={(e) => setFormData({ ...formData, scannerAlignment: e.target.value as ScannerAlignment })}
                    options={[
                      { value: '80°/80°', label: '80°/80°' },
                      { value: '90°/90°', label: '90°/90°' }
                    ]}
                    required
                  />

                  <Toggle
                    checked={formData.gpsEnabled}
                    onChange={(checked) => setFormData({ ...formData, gpsEnabled: checked })}
                    label={t('runs.gpsTracking')}
                  />
                </div>
              </CardContent>
            </Card>

            <Button onClick={handleStartRun} className="w-full" size="lg">
              <Play className="w-5 h-5 mr-2" />
              Messfahrt beginnen
            </Button>
          </>
        )}

        {/* PHASE 2: RECORDING */}
        {phase === 'recording' && (
          <>
            <Card>
              <CardContent>
                <div className="text-center py-6">
                  <div className="text-3xl font-bold text-primary-600 mb-2">
                    {trackedPoints.length > 0 ? formatKmValue(trackedPoints[trackedPoints.length - 1].kmValue) : (formData.startKm ? formatKmValue(parseGermanNumber(formData.startKm.toString())) : 'KM 0,0 + 0,0')}
                  </div>
                  <div className="text-sm text-slate-600">
                    Aktuelle Position
                  </div>
                  <div className="text-sm text-slate-500 mt-2">
                    {trackedPoints.length} Punkte erfasst
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Track Visualization */}
            {field && trackedPoints.length > 0 && (
              <TrackVisualization
                allFixedPoints={field.points}
                trackedPoints={trackedPoints}
                currentDistance={newPoint.localDistance ? parseFloat(newPoint.localDistance) : (trackedPoints[trackedPoints.length - 1]?.localDistance || 0)}
              />
            )}

            <Card>
              <CardContent>
                <h3 className="text-md font-semibold text-slate-900 mb-4">Punkt erfassen</h3>
                <div className="space-y-3">
                  <Input
                    type="number"
                    step="0.1"
                    label="Gefahrene Strecke (m)"
                    value={newPoint.localDistance}
                    onChange={(e) => handleDistanceChange(e.target.value)}
                    placeholder="z.B. 50.0"
                  />

                  {pointSuggestions.length > 0 && (
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Vorgeschlagene Punkte ({pointSuggestions.length})
                      </label>
                      <div className="space-y-1 max-h-32 overflow-y-auto">
                        {pointSuggestions.map((suggestion, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => {
                              setNewPoint({
                                ...newPoint,
                                pointNumber: suggestion.point.pointNumber,
                                // Auto-fill side if detected
                                side: suggestion.suggestedSide || newPoint.side
                              })
                              setPointSuggestions([])
                              setTextBasedSuggestions([])
                            }}
                            className="w-full text-left px-3 py-2 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-blue-900">
                                  {suggestion.point.pointNumber}
                                </span>
                                {suggestion.suggestedSide && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                                    {suggestion.suggestedSide === 'left' ? 'Links' : 'Rechts'}
                                  </span>
                                )}
                              </div>
                              <span className="text-sm text-blue-600">
                                {suggestion.direction === 'forward' ? (
                                  <ArrowRight className="w-4 h-4 inline" />
                                ) : (
                                  <ArrowLeft className="w-4 h-4 inline" />
                                )}
                                {' '}~{suggestion.distance.toFixed(1)}m
                              </span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Punktnummer {!pointSuggestions.length && !textBasedSuggestions.length && '(mindestens 2 Zeichen eingeben)'}
                      </label>
                      <input
                        value={newPoint.pointNumber}
                        onChange={(e) => handlePointNumberChange(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                        placeholder="z.B. P001_L"
                      />

                      {/* Text-based suggestions */}
                      {textBasedSuggestions.length > 0 && pointSuggestions.length === 0 && (
                        <div className="mt-2 space-y-1 max-h-40 overflow-y-auto border border-slate-200 rounded-lg p-1">
                          {textBasedSuggestions.map((suggestion) => (
                            <button
                              key={suggestion.id}
                              type="button"
                              onClick={() => {
                                setNewPoint({ ...newPoint, pointNumber: suggestion.pointNumber })
                                setTextBasedSuggestions([])
                              }}
                              className="w-full text-left px-3 py-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded transition-colors"
                            >
                              <span className="font-medium text-slate-900">{suggestion.pointNumber}</span>
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Paired point suggestion */}
                      {pairedPointSuggestion && (
                        <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded-lg">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={includePairedPoint}
                              onChange={(e) => setIncludePairedPoint(e.target.checked)}
                              className="w-4 h-4 text-blue-600 rounded"
                            />
                            <span className="text-sm text-slate-700">
                              Auch Paarpunkt <strong>{pairedPointSuggestion.pointNumber}</strong> erfassen
                            </span>
                          </label>
                        </div>
                      )}
                    </div>
                  </div>

                  <Select
                    label="Seite"
                    value={newPoint.side}
                    onChange={(e) => setNewPoint({ ...newPoint, side: e.target.value as 'left' | 'right' })}
                    options={[
                      { value: 'left', label: 'Links' },
                      { value: 'right', label: 'Rechts' }
                    ]}
                  />

                  {/* Target Board Selection - Dropdown menus */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="block text-sm font-medium text-slate-700">
                        Zieltafel
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          if (!useCustomTargetBoard) {
                            // Switching to custom: init with current values
                            setCustomHeight(targetBoard.height.toString())
                            setCustomThickness(targetBoard.thickness.toString())
                          } else {
                            // Switching to standard: apply custom values
                            const h = parseFloat(customHeight)
                            const t = parseFloat(customThickness)
                            if (!isNaN(h)) setTargetBoard(prev => ({ ...prev, height: h }))
                            if (!isNaN(t)) setTargetBoard(prev => ({ ...prev, thickness: t }))
                          }
                          setUseCustomTargetBoard(!useCustomTargetBoard)
                        }}
                        className="text-xs text-primary-600 hover:text-primary-700"
                      >
                        {useCustomTargetBoard ? 'Standardwerte' : 'Individuell'}
                      </button>
                    </div>

                    {!useCustomTargetBoard ? (
                      <div className="grid grid-cols-3 gap-2">
                        {/* Size Dropdown */}
                        <div>
                          <label className="block text-xs text-slate-500 mb-1">Größe</label>
                          <select
                            value={targetBoard.size}
                            onChange={(e) => setTargetBoard({ ...targetBoard, size: e.target.value })}
                            className="w-full px-2 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                          >
                            {TARGET_BOARD_SIZES.map((size) => (
                              <option key={size} value={size}>{size}mm</option>
                            ))}
                          </select>
                        </div>

                        {/* Height Dropdown */}
                        <div>
                          <label className="block text-xs text-slate-500 mb-1">Höhe</label>
                          <select
                            value={targetBoard.height}
                            onChange={(e) => setTargetBoard({ ...targetBoard, height: parseFloat(e.target.value) })}
                            className="w-full px-2 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                          >
                            {TARGET_BOARD_HEIGHTS.map((height) => (
                              <option key={height} value={height}>{height}mm</option>
                            ))}
                          </select>
                        </div>

                        {/* Thickness Dropdown */}
                        <div>
                          <label className="block text-xs text-slate-500 mb-1">Dicke</label>
                          <select
                            value={targetBoard.thickness}
                            onChange={(e) => setTargetBoard({ ...targetBoard, thickness: parseFloat(e.target.value) })}
                            className="w-full px-2 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                          >
                            {TARGET_BOARD_THICKNESSES.map((thickness) => (
                              <option key={thickness} value={thickness}>{thickness}mm</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 gap-2">
                        {/* Custom Size Input */}
                        <div>
                          <label className="block text-xs text-slate-500 mb-1">Größe (mm)</label>
                          <input
                            type="number"
                            value={targetBoard.size}
                            onChange={(e) => setTargetBoard({ ...targetBoard, size: e.target.value })}
                            className="w-full px-2 py-2 text-sm border border-slate-300 rounded-lg"
                            placeholder="mm"
                          />
                        </div>

                        {/* Custom Height Input */}
                        <div>
                          <label className="block text-xs text-slate-500 mb-1">Höhe (mm)</label>
                          <input
                            type="text"
                            value={customHeight}
                            onChange={(e) => {
                              const val = e.target.value
                              // Allow empty, minus, or valid number patterns
                              if (val === '' || val === '-' || /^-?\d*\.?\d*$/.test(val)) {
                                setCustomHeight(val)
                                const parsed = parseFloat(val)
                                if (!isNaN(parsed)) {
                                  setTargetBoard(prev => ({ ...prev, height: parsed }))
                                }
                              }
                            }}
                            className="w-full px-2 py-2 text-sm border border-slate-300 rounded-lg"
                            placeholder="mm"
                          />
                        </div>

                        {/* Custom Thickness Input */}
                        <div>
                          <label className="block text-xs text-slate-500 mb-1">Dicke (mm)</label>
                          <input
                            type="text"
                            value={customThickness}
                            onChange={(e) => {
                              const val = e.target.value
                              // Allow empty, minus, or valid number patterns
                              if (val === '' || val === '-' || /^-?\d*\.?\d*$/.test(val)) {
                                setCustomThickness(val)
                                const parsed = parseFloat(val)
                                if (!isNaN(parsed)) {
                                  setTargetBoard(prev => ({ ...prev, thickness: parsed }))
                                }
                              }
                            }}
                            className="w-full px-2 py-2 text-sm border border-slate-300 rounded-lg"
                            placeholder="mm"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  <Button onClick={handleAddPoint} className="w-full">
                    <Plus className="w-4 h-4 mr-2" />
                    Punkt speichern
                  </Button>
                </div>
              </CardContent>
            </Card>

            {trackedPoints.length > 0 && (
              <Card>
                <CardContent>
                  <h3 className="text-md font-semibold text-slate-900 mb-3">Erfasste Punkte</h3>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {trackedPoints.map(point => (
                      <div key={point.id} className="flex items-center justify-between p-3 bg-slate-50 rounded">
                        <div className="flex-1">
                          <div className="font-medium text-slate-900">{point.pointNumber}</div>
                          <div className="text-sm text-slate-600">
                            {formatKmValue(point.kmValue)} • {point.side === 'left' ? 'Links' : 'Rechts'} • {point.localDistance}m
                          </div>
                          {point.targetBoard && (
                            <div className="text-xs text-slate-500">
                              Zieltafel: {point.targetBoard.size}mm / {point.targetBoard.height >= 0 ? '+' : ''}{point.targetBoard.height}mm / {point.targetBoard.thickness}mm
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => handleRemovePoint(point.id)}
                          className="text-red-600 hover:text-red-700 p-2"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardContent>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-md font-semibold text-slate-900">Bemerkungen</h3>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setShowRemarkInput(!showRemarkInput)}
                  >
                    <MessageSquare className="w-4 h-4 mr-2" />
                    Hinzufügen
                  </Button>
                </div>

                {showRemarkInput && (
                  <div className="mb-3 space-y-2">
                    <Input
                      value={newRemark}
                      onChange={(e) => setNewRemark(e.target.value)}
                      placeholder="Bemerkung eingeben..."
                      onKeyDown={(e) => e.key === 'Enter' && handleAddRemark()}
                    />
                    <div className="flex gap-2">
                      <Button onClick={handleAddRemark} size="sm">Speichern</Button>
                      <Button variant="secondary" size="sm" onClick={() => setShowRemarkInput(false)}>Abbrechen</Button>
                    </div>
                  </div>
                )}

                {remarks.length > 0 && (
                  <div className="space-y-2">
                    {remarks.map(remark => (
                      <div key={remark.id} className="p-2 bg-yellow-50 border-l-4 border-yellow-400 rounded">
                        <div className="text-sm font-medium text-slate-900">Bemerkung {remark.number}</div>
                        <div className="text-sm text-slate-700">{remark.text}</div>
                        <div className="text-xs text-slate-500 mt-1">
                          {new Date(remark.timestamp).toLocaleTimeString('de-DE')}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="flex gap-3">
              <Button type="button" variant="danger" onClick={handleCancelRun} className="flex-1">
                <X className="w-4 h-4 mr-2" />
                Abbrechen
              </Button>
              <Button type="button" onClick={handleCompleteRun} className="flex-1">
                <Save className="w-4 h-4 mr-2" />
                Messfahrt abschließen
              </Button>
            </div>
          </>
        )}

        {/* PHASE 3: COMPLETION */}
        {phase === 'completed' && (
          <>
            <Card>
              <CardContent>
                <h3 className="text-md font-semibold text-slate-900 mb-4">Fahrt abschließen</h3>
                <div className="space-y-4">
                  <Input
                    type="number"
                    step="0.1"
                    label="Geschwindigkeit (m/s)"
                    value={formData.speed}
                    onChange={(e) => setFormData({ ...formData, speed: e.target.value })}
                    placeholder="z.B. 2.5"
                    required
                  />

                  <Input
                    type="number"
                    step="0.1"
                    label="Gesamtlänge (m)"
                    value={formData.length}
                    onChange={(e) => setFormData({ ...formData, length: e.target.value })}
                    placeholder="z.B. 540.0"
                    required
                  />

                  {formData.length && parseFloat(formData.length.toString()) > 0 && (
                    <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                      <div className="text-sm font-medium text-blue-900 mb-1">Berechnete Werte</div>
                      <div className="text-sm text-blue-700">
                        End-KM: {formatKmValue(parseGermanNumber(formData.startKm.toString()) + parseFloat(formData.length.toString()))}
                      </div>
                      {trackedPoints.length > 0 && (
                        <>
                          <div className="text-sm text-blue-700">
                            Von Punkt: {trackedPoints[0].pointNumber}
                          </div>
                          <div className="text-sm text-blue-700">
                            Bis Punkt: {trackedPoints[trackedPoints.length - 1].pointNumber}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <div className="flex gap-3 pb-6">
              <Button
                variant="secondary"
                onClick={() => setPhase('recording')}
                className="flex-1"
              >
                Zurück
              </Button>
              <Button
                onClick={handleSave}
                disabled={isSaving}
                className="flex-1"
              >
                <Save className="w-4 h-4 mr-2" />
                {isSaving ? 'Speichert...' : 'Speichern'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
