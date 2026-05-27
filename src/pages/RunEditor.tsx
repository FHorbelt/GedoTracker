import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../contexts/ThemeContext'
import { Card, CardContent } from '../components/common/Card'
import { Input } from '../components/common/Input'
import { Select } from '../components/common/Select'
import { Toggle } from '../components/common/Toggle'
import { Button } from '../components/common/Button'
import { TrackVisualization } from '../components/TrackVisualization'
import { RunMap } from '../components/common/RunMap'
import { useProject } from '../hooks/useProjects'
import { useMeasurementJob } from '../hooks/useMeasurementJobs'
import { useRun, createRun, updateRun, deleteRun } from '../hooks/useRuns'
import { useFixedPointField } from '../hooks/useFixedPoints'
import { useReferenceTrajectoriesForField } from '../hooks/useReferenceTrajectories'
import { useActiveRun } from '../contexts/ActiveRunContext'
import { db } from '../db/database'
import {
  Direction,
  ScannerAlignment,
  TrackingMode,
  TrackedPoint,
  RunRemark,
  TargetBoardInfo,
  TRACK_TYPES,
  TrackType,
  ScannerType
} from '../db/models'
import { incrementRunName, generateInitialRunName } from '../utils/runNumbering'
import { formatKmValue, projectPosition, calculateDistance } from '../utils/kmCalculation'
import { PointSuggestion, findPairedPointByNumber, TrackInfo, findUpcomingPoints, interpolateOnSpline, getSplineCoordinates, TrackSpline, snapToSpline, reverseSpline, BaseSpline, SnapResult, getBaseSplineCoordinates, truncateSplineFromStart, buildSplineFromTrajectoryPoints } from '../utils/pointSuggestion'
import { FixedPoint, GpsPoint } from '../db/models'
import { Play, Save, Plus, Trash2, MessageSquare, ArrowRight, ArrowLeft, X, RotateCcw, Navigation, NavigationOff, RefreshCw, Settings, Route, Target, Pencil as Edit } from 'lucide-react'
import { v4 as uuidv4 } from 'uuid'
import { GpsTrackFilter } from '../utils/gpsFilter'
import { trimGpsTrackMonotone } from '../utils/gpsTrackTrim'

type RunPhase = 'setup' | 'recording' | 'completed'

const TARGET_BOARD_PRESETS: { image: string; label: string; board: TargetBoardInfo }[] = [
  { image: '/targets/target-100-3.png', label: '100mm / 3mm', board: { size: '100', height: -6, thickness: 3 } },
  { image: '/targets/target-200-3.png', label: '200mm / 3mm', board: { size: '200', height: -6, thickness: 3 } },
  { image: '/targets/boden-100-200.png', label: 'Boden 200mm', board: { size: '100', height: 200, thickness: 0 } },
  { image: '/targets/target-100-60.png', label: '100mm / 60mm', board: { size: '100', height: -6, thickness: 60 } },
  { image: '/targets/target-200-60.png', label: '200mm / 60mm', board: { size: '200', height: -6, thickness: 60 } },
  { image: '/targets/boden-100-400.png', label: 'Boden 400mm', board: { size: '100', height: 400, thickness: 0 } },
]
const DEFAULT_TARGET_BOARD: TargetBoardInfo = { size: '100', height: -6, thickness: 60 }

function parseGermanNumber(value: string | number): number {
  if (typeof value === 'number') return value
  return parseFloat(value.replace(',', '.'))
}

export function RunEditor() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { projectId, jobId, runId } = useParams()
  const { theme } = useTheme()
  const isDark = theme === 'dark'
  const isEdit = !!runId

  const { project } = useProject(projectId)
  const { job } = useMeasurementJob(jobId)
  const { run, isLoading } = useRun(runId)
  const { field } = useFixedPointField(job?.fixedPointFieldId)
  const { trajectories: allTrajectories } = useReferenceTrajectoriesForField(job?.fixedPointFieldId)
  const { activeRun, setActiveRun, clearActiveRun, isRunActive } = useActiveRun()
  const [phase, setPhase] = useState<RunPhase>('setup')
  const [isSaving, setIsSaving] = useState(false)
  const [initialLoadDone, setInitialLoadDone] = useState(false)

  const [formData, setFormData] = useState({
    runName: '',
    routeNumber: '',
    trackType: 'RIG' as TrackType,
    direction: 'ascending' as Direction,
    objectDesignation: '',
    startKm: '' as string | number,
    scannerType: 'GX50' as ScannerType,
    scannerAlignment: '80°/80°' as ScannerAlignment,
    gpsEnabled: false,
    speed: '0.8' as string | number,
    length: '' as string | number
  })

  const [trackedPoints, setTrackedPoints] = useState<TrackedPoint[]>([])
  const [remarks, setRemarks] = useState<RunRemark[]>([])

  const [newPoint, setNewPoint] = useState({
    pointNumber: '',
    localDistance: '',
    side: 'left' as 'left' | 'right',
    remark: ''
  })
  const [pointSuggestions, setPointSuggestions] = useState<PointSuggestion[]>([])
  const [textBasedSuggestions, setTextBasedSuggestions] = useState<{ pointNumber: string, id: string }[]>([])
  const [pairedPointSuggestion, setPairedPointSuggestion] = useState<FixedPoint | null>(null)
  const [includePairedPoint, setIncludePairedPoint] = useState(false)

  const [newRemark, setNewRemark] = useState('')
  const [showRemarkInput, setShowRemarkInput] = useState(false)
  const remarkInputRef = useRef<HTMLInputElement>(null)

  // Auto-focus remark input when shown
  useEffect(() => {
    if (showRemarkInput && remarkInputRef.current) {
      remarkInputRef.current.focus()
    }
  }, [showRemarkInput])

  const [targetBoard, setTargetBoard] = useState<TargetBoardInfo>(DEFAULT_TARGET_BOARD)
  // Left/right targets for GNSS mode side-specific tracking
  const [leftTarget, setLeftTarget] = useState<TargetBoardInfo>(DEFAULT_TARGET_BOARD)
  const [rightTarget, setRightTarget] = useState<TargetBoardInfo>(DEFAULT_TARGET_BOARD)
  const [showTargetConfig, setShowTargetConfig] = useState(false)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [showEditParams, setShowEditParams] = useState(false)

  // Recently captured points (show with checkmark for a few seconds)
  const [recentlyCaptured, setRecentlyCaptured] = useState<Set<string>>(new Set())
  const captureTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // GPS Tracking State
  const [gpsTrack, setGpsTrack] = useState<GpsPoint[]>([])
  const [smoothedGpsTrack, setSmoothedGpsTrack] = useState<GpsPoint[]>([])
  const [gpsWatchId, setGpsWatchId] = useState<number | null>(null)
  const [gpsStatus, setGpsStatus] = useState<'inactive' | 'waiting' | 'active' | 'error'>('inactive')
  const [lastGpsPosition, setLastGpsPosition] = useState<GpsPoint | null>(null)
  const [gpsDistance, setGpsDistance] = useState(0)

  // GPS follow mode for fullscreen map
  const [followGps, setFollowGps] = useState(false)
  const [followGpsTick, setFollowGpsTick] = useState(0)
  // Initial device position (fetched once on mount for map centering)
  const [initialPosition, setInitialPosition] = useState<{ latitude: number; longitude: number } | null>(null)

  // GPS filter instance (survives re-renders, not React state)
  const gpsFilterRef = useRef<GpsTrackFilter | null>(null)
  // For trajectory-based distance: remember initial snap distance
  const trajectoryStartDistRef = useRef<number | null>(null)
  // Init phase progress (0..1)
  const [gpsInitProgress, setGpsInitProgress] = useState<number>(0)
  // Current GPS bearing from filter (radians, null before init)
  const [gpsBearing, setGpsBearing] = useState<number | null>(null)

  // Reference trajectory (Solltrasse) for GPS snapping
  const [selectedTrajectoryId, setSelectedTrajectoryId] = useState<string | null>(null)

  // Solltrassen-Tracking aktiv? (auch im GNSS-Modus wenn Trajektorie gewählt)
  const trajectoryMode = !!selectedTrajectoryId

  // Build spline from selected reference trajectory
  const selectedTrajectorySpline = useMemo<BaseSpline | null>(() => {
    if (!selectedTrajectoryId) return null
    const traj = allTrajectories.find(t => t.id === selectedTrajectoryId)
    if (!traj) return null
    return buildSplineFromTrajectoryPoints(traj.points)
  }, [selectedTrajectoryId, allTrajectories])

  // Prepare trajectory display data for RunMap
  const referenceTrajectoryDisplays = useMemo(() => {
    return allTrajectories.map(traj => ({
      id: traj.id,
      name: traj.name,
      coordinates: (traj.segments ?? [traj.points]).map(seg =>
        seg.map(p => [p.lat, p.lon] as [number, number])
      )
    }))
  }, [allTrajectories])

  // Manual start position - snapped to spline
  const [snappedStart, setSnappedStart] = useState<SnapResult | null>(null)
  const [pendingStartDistance, setPendingStartDistance] = useState<number | null>(null)
  const [isReversed, setIsReversed] = useState(false)
  const [clickMode, setClickMode] = useState<'none' | 'start'>('none')

  // Solltrasse mit Richtung (reversed wenn nötig)
  const trajectorySpline = useMemo<BaseSpline | null>(() => {
    if (!selectedTrajectorySpline) return null
    return isReversed ? reverseSpline(selectedTrajectorySpline) : selectedTrajectorySpline
  }, [selectedTrajectorySpline, isReversed])

  // Load direction reversal from job settings
  useEffect(() => {
    if (job?.trajectorySettings?.isReversed !== undefined) {
      setIsReversed(job.trajectorySettings.isReversed)
    }
  }, [job?.trajectorySettings])

  // Resolve pending start distance to a snapped position once spline is ready
  useEffect(() => {
    if (pendingStartDistance !== null && trajectorySpline) {
      const fraction = Math.min(Math.max(pendingStartDistance / trajectorySpline.totalLength, 0), 1)
      const index = Math.min(
        Math.round(fraction * (trajectorySpline.points.length - 1)),
        trajectorySpline.points.length - 1
      )
      const approxPos = trajectorySpline.points[index]
      if (approxPos) {
        const result = snapToSpline(trajectorySpline, { latitude: approxPos.lat, longitude: approxPos.lon })
        setSnappedStart(result)
      }
      setPendingStartDistance(null)
    }
  }, [pendingStartDistance, trajectorySpline])

  // Get manual start position and bearing from snapped result
  const manualStartPosition = useMemo(() => {
    if (!snappedStart) return null
    return snappedStart.position
  }, [snappedStart])

  // Bearing comes from spline tangent at snapped position
  const manualBearing = useMemo(() => {
    if (!snappedStart) return null
    // Adjust bearing for reversal (already handled in reverseSpline, but for safety)
    return snappedStart.bearing
  }, [snappedStart])

  // Build track spline starting from snapped position
  const trackSpline = useMemo<TrackSpline | null>(() => {
    if (!trajectorySpline || !snappedStart) {
      return null
    }
    return truncateSplineFromStart(trajectorySpline, snappedStart.distanceAlongSpline)
  }, [trajectorySpline, snappedStart])

  // Calculate track info from start position for map visualization
  const trackInfo = useMemo<TrackInfo | null>(() => {
    if (!trajectorySpline && (!field || field.points.length < 2)) return null

    // During setup phase, show trajectory even without start position
    if (!manualStartPosition || manualBearing === null) {
      if (trajectorySpline && trajectorySpline.points.length > 0) {
        const firstPt = trajectorySpline.points[0]
        return {
          bearing: trajectorySpline.startBearing,
          startPosition: { latitude: firstPt.lat, longitude: firstPt.lon },
          estimatedPosition: { latitude: firstPt.lat, longitude: firstPt.lon },
          upcomingPoints: [],
          splineCoordinates: undefined // Reference trajectory is already shown as green line
        }
      }
      return null
    }

    const currentDistance = parseFloat(newPoint.localDistance) || 0
    let estimatedPosition: { latitude: number; longitude: number }
    let currentBearing = manualBearing

    if (trackSpline) {
      const result = interpolateOnSpline(
        trackSpline,
        currentDistance,
        manualStartPosition,
        manualBearing
      )
      estimatedPosition = result.position
      currentBearing = result.bearing
    } else {
      const [estLon, estLat] = projectPosition(
        manualStartPosition.longitude,
        manualStartPosition.latitude,
        manualBearing,
        currentDistance
      )
      estimatedPosition = { latitude: estLat, longitude: estLon }
    }

    // Point suggestions only when fixed points available
    const currentDistanceOnSpline = snappedStart
      ? snappedStart.distanceAlongSpline + currentDistance
      : undefined

    const upcomingPoints = field ? findUpcomingPoints(
      estimatedPosition,
      currentBearing,
      field.points,
      trackedPoints,
      100,
      trajectorySpline || null,
      currentDistanceOnSpline
    ) : []

    // Only show spline overlay when using beta spline from fixed points (no reference trajectory)
    // When a reference trajectory is selected, it's already shown as the green line on the map
    const splineCoordinates = trajectorySpline
      ? undefined
      : trackSpline ? getSplineCoordinates(trackSpline) : undefined

    return {
      bearing: currentBearing,
      startPosition: { latitude: manualStartPosition.latitude, longitude: manualStartPosition.longitude },
      estimatedPosition,
      upcomingPoints,
      splineCoordinates
    }
  }, [manualStartPosition, field, trackedPoints, newPoint.localDistance, manualBearing, trackSpline, trajectorySpline, snappedStart])

  // GPS-based point suggestions for GNSS recording mode
  // Filter out tracked points EXCEPT recently captured ones (so they stay visible with checkmark)
  const effectiveTrackedPoints = useMemo(() => {
    return trackedPoints.filter(p => !p.pointId || !recentlyCaptured.has(p.pointId))
  }, [trackedPoints, recentlyCaptured])

  const gpsNearbyPoints = useMemo<PointSuggestion[]>(() => {
    if (!formData.gpsEnabled || phase !== 'recording') return []
    if (!lastGpsPosition || !field || field.points.length === 0) return []

    // With reference trajectory: snap to spline and use trajectory-based distance
    if (selectedTrajectorySpline) {
      const snap = snapToSpline(selectedTrajectorySpline, {
        latitude: lastGpsPosition.latitude,
        longitude: lastGpsPosition.longitude
      })
      if (snap.distanceFromClick > 100) return []

      return findUpcomingPoints(
        { latitude: snap.position.latitude, longitude: snap.position.longitude },
        snap.bearing,
        field.points,
        effectiveTrackedPoints,
        100,
        selectedTrajectorySpline,
        snap.distanceAlongSpline
      ).filter(p => p.distance >= -10 && p.distance <= 50)
    }

    // Without reference trajectory: use direct distance + GPS bearing for left/right
    if (gpsBearing === null) return []

    return findUpcomingPoints(
      { latitude: lastGpsPosition.latitude, longitude: lastGpsPosition.longitude },
      gpsBearing,
      field.points,
      effectiveTrackedPoints,
      20 // 20m radius around current position
    ).filter(p => p.distance <= 20)
  }, [formData.gpsEnabled, phase, lastGpsPosition, field, selectedTrajectorySpline, effectiveTrackedPoints, gpsBearing])

  // Nearby points per side for GNSS capture buttons (sorted by absolute distance)
  const leftPoints = useMemo(() => {
    return gpsNearbyPoints
      .filter(p => p.suggestedSide === 'left')
      .sort((a, b) => Math.abs(a.distance) - Math.abs(b.distance))
  }, [gpsNearbyPoints])

  const rightPoints = useMemo(() => {
    return gpsNearbyPoints
      .filter(p => p.suggestedSide === 'right')
      .sort((a, b) => Math.abs(a.distance) - Math.abs(b.distance))
  }, [gpsNearbyPoints])

  // Schnell-Buttons für Strecke (positiv und negativ)
  const distanceIncrements = [1, 5, 10, 20, 50]

  const handleDistanceChange = (distance: string) => {
    setNewPoint({ ...newPoint, localDistance: distance })
    // Clear text-based suggestions when distance changes
    setTextBasedSuggestions([])
    // Point suggestions are updated via useEffect based on trackInfo.upcomingPoints
    // This ensures consistent calculation from the estimated position
  }

  const handleAddDistance = (increment: number) => {
    const current = parseFloat(newPoint.localDistance) || 0
    const newDistance = current + increment
    // Allow going back but not below the last tracked point's distance
    const minDistance = trackedPoints.length > 0
      ? trackedPoints[trackedPoints.length - 1].localDistance
      : 0
    handleDistanceChange(Math.max(minDistance, newDistance).toString())
  }

  const handlePointNumberChange = (value: string) => {
    setNewPoint({ ...newPoint, pointNumber: value })

    if (value.length >= 2 && field) {
      const trackedIds = new Set(trackedPoints.map(p => p.pointId))
      const filtered = field.points
        .filter(p => !trackedIds.has(p.id) && p.pointNumber.toLowerCase().includes(value.toLowerCase()))
        .slice(0, 5)
        .map(p => ({ pointNumber: p.pointNumber, id: p.id }))

      setTextBasedSuggestions(filtered)

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

  // Initialize form from job settings
  useEffect(() => {
    async function loadInitialData() {
      try {
        if (!isEdit && jobId && job && project) {
          // Get last run in this job for name suggestion
          const lastRuns = await db.runs.where('measurementJobId').equals(jobId).reverse().sortBy('runNumber')
          const lastRun = lastRuns[0]

          const suggestedName = lastRun
            ? incrementRunName(lastRun.runName)
            : generateInitialRunName(project.projectNumber)

          setFormData(prev => ({
            ...prev,
            runName: suggestedName,
            scannerType: job.scannerType,
            scannerAlignment: job.scannerAlignment || '80°/80°',
            routeNumber: lastRun?.routeNumber || '',
            trackType: lastRun?.trackType || 'RIG',
            objectDesignation: lastRun?.objectDesignation || '',
            startKm: lastRun?.endKm ?? '',
            gpsEnabled: lastRun?.gpsEnabled || false
          }))

          // Take over target board settings from last run's tracked points
          if (lastRun?.trackedPoints && lastRun.trackedPoints.length > 0) {
            const lastLeft = [...lastRun.trackedPoints].reverse().find(p => p.side === 'left')
            const lastRight = [...lastRun.trackedPoints].reverse().find(p => p.side === 'right')
            if (lastLeft?.targetBoard) {
              setLeftTarget({ ...lastLeft.targetBoard })
              setTargetBoard({ ...lastLeft.targetBoard })
            }
            if (lastRight?.targetBoard) {
              setRightTarget({ ...lastRight.targetBoard })
            }
          }

          // Take over reference trajectory from last run
          if (lastRun?.referenceTrajectoryId) {
            setSelectedTrajectoryId(lastRun.referenceTrajectoryId)
          }

          // Take over end position of last run as start position for new run
          if (lastRun?.startPositionSnap && lastRun.length) {
            const endDistance = lastRun.startPositionSnap.distanceAlongSpline + lastRun.length
            setPendingStartDistance(endDistance)
          }
        }
      } catch (error) {
        console.error('Error loading initial run data:', error)
      }
    }
    loadInitialData()
  }, [isEdit, jobId, job, project])

  // Load existing run
  useEffect(() => {
    if (run && isEdit && projectId && jobId && runId && !initialLoadDone) {
      setFormData({
        runName: run.runName,
        routeNumber: run.routeNumber || '',
        trackType: run.trackType || 'RIG',
        direction: run.direction,
        objectDesignation: run.objectDesignation || '',
        startKm: run.startKm,
        scannerType: run.scannerType || 'GX50',
        scannerAlignment: run.scannerAlignment,
        gpsEnabled: run.gpsEnabled,
        speed: run.speed || 0.8,
        length: run.length || 0
      })
      setTrackedPoints(run.trackedPoints)
      setRemarks(run.remarks)
      setPhase(run.isCompleted ? 'completed' : 'recording')
      setInitialLoadDone(true)

      // Restore reference trajectory selection
      if (run.referenceTrajectoryId) {
        setSelectedTrajectoryId(run.referenceTrajectoryId)
      }

      // Restore snapped start position for point suggestions
      if (run.startPositionSnap) {
        setSnappedStart({
          position: {
            latitude: run.startPositionSnap.latitude,
            longitude: run.startPositionSnap.longitude
          },
          bearing: run.startPositionSnap.bearing,
          distanceAlongSpline: run.startPositionSnap.distanceAlongSpline,
          distanceFromClick: 0 // Not relevant when restoring
        })
      }

      // Set initial localDistance to last tracked point's distance for point suggestions
      if (run.trackedPoints.length > 0) {
        const lastDistance = run.trackedPoints[run.trackedPoints.length - 1].localDistance
        setNewPoint(prev => ({ ...prev, localDistance: lastDistance.toString() }))
      }

      if (!run.isCompleted) {
        setActiveRun({ projectId, jobId, runId, runName: run.runName })
      }
    }
  }, [run, isEdit, projectId, jobId, runId, setActiveRun, initialLoadDone])

  // Load existing GPS track when editing (only once on initial load, not on every DB update)
  const gpsTrackLoadedRef = useRef(false)
  useEffect(() => {
    if (gpsTrackLoadedRef.current) return
    if (run && run.gpsTrack && run.gpsTrack.length > 0) {
      setGpsTrack(run.gpsTrack)
      setLastGpsPosition(run.gpsTrack[run.gpsTrack.length - 1])
      gpsTrackLoadedRef.current = true
    }
  }, [run])

  // GPS Tracking Effect (with Savitzky-Golay filter)
  useEffect(() => {
    if (phase !== 'recording' || !formData.gpsEnabled) {
      // Stop tracking if not in recording phase or GPS disabled
      if (gpsWatchId !== null) {
        navigator.geolocation.clearWatch(gpsWatchId)
        setGpsWatchId(null)
        setGpsStatus('inactive')
      }
      return
    }

    // Check if geolocation is available
    if (!navigator.geolocation) {
      setGpsStatus('error')
      return
    }

    setGpsStatus('waiting')
    setFollowGps(true)
    setFollowGpsTick(t => t + 1)

    // Ensure filter is initialized
    if (!gpsFilterRef.current) {
      gpsFilterRef.current = new GpsTrackFilter()
    }

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const rawPoint: GpsPoint = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          timestamp: new Date().toISOString(),
          accuracy: position.coords.accuracy
        }

        // Always store raw GPS track (for DB persistence / KML export)
        setGpsTrack(prev => [...prev, rawPoint])

        // Always show current GPS position on map (independent of filter)
        if (selectedTrajectorySpline) {
          const snapped = snapToSpline(selectedTrajectorySpline, {
            latitude: rawPoint.latitude,
            longitude: rawPoint.longitude
          })
          if (snapped.distanceFromClick < 100) {
            // Snap to spline if within 100m (increased from 50m for extended trajectories)
            setLastGpsPosition({
              ...rawPoint,
              latitude: snapped.position.latitude,
              longitude: snapped.position.longitude
            })
          } else {
            setLastGpsPosition(rawPoint)
          }
        } else {
          setLastGpsPosition(rawPoint)
        }

        // Run through filter pipeline (for distance + smoothed track only)
        const filter = gpsFilterRef.current!
        const result = filter.addPoint(rawPoint)

        // Always update init progress and bearing for UI feedback
        setGpsInitProgress(result.initProgress)
        if (result.bearing !== null) {
          setGpsBearing(result.bearing)
        }

        if (result.accepted && result.smoothedPoint) {
          // Update smoothed track for map display
          setSmoothedGpsTrack(filter.getSmoothedTrack())

          // With trajectory: distance along spline from smoothed position
          if (selectedTrajectorySpline) {
            const snapped = snapToSpline(selectedTrajectorySpline, {
              latitude: result.smoothedPoint.latitude,
              longitude: result.smoothedPoint.longitude
            })
            if (snapped.distanceFromClick < 100) {
              if (trajectoryStartDistRef.current === null) {
                trajectoryStartDistRef.current = snapped.distanceAlongSpline
              }
              setGpsDistance(Math.max(0, snapped.distanceAlongSpline - trajectoryStartDistRef.current))
            }
          } else {
            // Without trajectory: use filter's cumulative distance
            setGpsDistance(result.totalDistance)
          }
        }
        setGpsStatus('active')
      },
      (error) => {
        console.error('GPS Error:', error)
        setGpsStatus('error')
      },
      {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 10000
      }
    )

    setGpsWatchId(watchId)

    // Cleanup on unmount
    return () => {
      navigator.geolocation.clearWatch(watchId)
    }
  }, [phase, formData.gpsEnabled, selectedTrajectorySpline])

  // Fetch initial device position once on mount for map centering
  useEffect(() => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setInitialPosition({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        })
      },
      () => {}, // Silently ignore errors
      { enableHighAccuracy: false, maximumAge: 60000, timeout: 5000 }
    )
  }, [])

  // Continuous GPS position during setup phase for orientation on map
  useEffect(() => {
    if (phase !== 'setup' || !formData.gpsEnabled || !navigator.geolocation) return

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        setLastGpsPosition({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          timestamp: new Date().toISOString(),
          accuracy: position.coords.accuracy
        })
      },
      () => {}, // Silently ignore errors in setup
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
    )

    return () => {
      navigator.geolocation.clearWatch(watchId)
    }
  }, [phase, formData.gpsEnabled])

  // Save GPS track periodically
  useEffect(() => {
    if (runId && gpsTrack.length > 0 && phase === 'recording') {
      const saveGpsTrack = async () => {
        await updateRun(runId, { gpsTrack })
      }
      // Debounce: save every 10 new points
      if (gpsTrack.length % 10 === 0) {
        saveGpsTrack()
      }
    }
  }, [gpsTrack, runId, phase])

  // Update point suggestions when trackInfo changes or distance changes
  // This provides suggestions based on estimated position along the track
  useEffect(() => {
    if (phase !== 'recording') return

    if (trackInfo?.upcomingPoints && trackInfo.upcomingPoints.length > 0) {
      // Show all upcoming points (already filtered by distance in findUpcomingPoints)
      // Only filter out if user is typing a point number manually
      if (!newPoint.pointNumber) {
        setPointSuggestions(trackInfo.upcomingPoints)
      }
    } else {
      // Clear suggestions if no upcoming points
      if (!newPoint.pointNumber) {
        setPointSuggestions([])
      }
    }
  }, [trackInfo, phase, newPoint.pointNumber, newPoint.localDistance])

  const getBackUrl = () => {
    if (jobId) return `/projects/${projectId}/jobs/${jobId}`
    return `/projects/${projectId}`
  }

  const handleStartRun = async () => {
    if (isRunActive && activeRun) {
      alert(`Es läuft bereits eine Messfahrt: "${activeRun.runName}". Bitte diese zuerst beenden.`)
      return
    }

    if (!formData.runName || !formData.routeNumber) {
      alert('Bitte Fahrtname und Streckennummer angeben')
      return
    }

    if (!projectId || !jobId) return

    try {
      // Reset GPS filter state and follow mode for the new run
      setFollowGps(true)
      gpsFilterRef.current = null
      trajectoryStartDistRef.current = null
      gpsTrackLoadedRef.current = false
      setSmoothedGpsTrack([])
      setGpsTrack([])
      setGpsDistance(0)
      setGpsInitProgress(0)
      setGpsBearing(null)

      const runData = {
        measurementJobId: jobId,
        runName: formData.runName,
        routeNumber: formData.routeNumber,
        trackType: formData.trackType,
        direction: formData.direction,
        objectDesignation: formData.objectDesignation || undefined,
        startKm: parseGermanNumber(formData.startKm.toString()) || 0,
        scannerType: formData.scannerType,
        scannerAlignment: formData.scannerAlignment,
        trackingMode: 'double' as TrackingMode,
        trackedPoints: [],
        remarks: [],
        gpsEnabled: formData.gpsEnabled,
        isCompleted: false,
        referenceTrajectoryId: selectedTrajectoryId || undefined,
        // Speichere Startposition für Punktvorschläge
        startPositionSnap: snappedStart ? {
          latitude: snappedStart.position.latitude,
          longitude: snappedStart.position.longitude,
          bearing: snappedStart.bearing,
          distanceAlongSpline: snappedStart.distanceAlongSpline
        } : undefined
      }

      const newRunId = await createRun(projectId, jobId, runData)

      setActiveRun({ projectId, jobId, runId: newRunId, runName: formData.runName })
      navigate(`/projects/${projectId}/jobs/${jobId}/runs/${newRunId}`, { replace: true })
    } catch (error) {
      console.error('Error creating run:', error)
      alert('Fehler beim Erstellen der Messfahrt')
    }
  }

  const handleAddPoint = async () => {
    if (!newPoint.pointNumber || !newPoint.localDistance) {
      alert('Bitte Punktnummer und Strecke angeben')
      return
    }

    const localDistance = parseFloat(newPoint.localDistance)
    if (isNaN(localDistance) || localDistance < 0) {
      alert('Ungültige Streckenlänge')
      return
    }

    const startKmValue = parseGermanNumber(formData.startKm.toString())
    const dirSign = formData.direction === 'descending' ? -1 : 1
    const kmValue = (isNaN(startKmValue) ? 0 : startKmValue) + localDistance * dirSign

    const point: TrackedPoint = {
      id: uuidv4(),
      pointNumber: newPoint.pointNumber,
      side: newPoint.side,
      localDistance,
      kmValue,
      timestamp: new Date().toISOString(),
      targetBoard: { ...targetBoard },
      remark: newPoint.remark || undefined
    }

    if (field) {
      // More robust matching: trim whitespace and case-insensitive
      const searchNumber = newPoint.pointNumber.trim().toLowerCase()
      const fixedPoint = field.points.find(p =>
        p.pointNumber.trim().toLowerCase() === searchNumber
      )
      if (fixedPoint) {
        point.pointId = fixedPoint.id
        // Use exact point number from field for consistency
        point.pointNumber = fixedPoint.pointNumber
      }
    }

    const pointsToAdd = [point]

    if (includePairedPoint && pairedPointSuggestion) {
      const pairedSide: 'left' | 'right' = newPoint.side === 'left' ? 'right' : 'left'
      const pairedPoint: TrackedPoint = {
        id: uuidv4(),
        pointId: pairedPointSuggestion.id,
        pointNumber: pairedPointSuggestion.pointNumber,
        side: pairedSide,
        localDistance,
        kmValue,
        timestamp: new Date().toISOString(),
        targetBoard: { ...targetBoard }
      }
      pointsToAdd.push(pairedPoint)
    }

    const newTrackedPoints = [...trackedPoints, ...pointsToAdd]
    setTrackedPoints(newTrackedPoints)
    // Behalte localDistance, lösche nur pointNumber und remark
    setNewPoint({ ...newPoint, pointNumber: '', remark: '' })
    setPairedPointSuggestion(null)
    setIncludePairedPoint(false)
    // Clear suggestions - they will be recalculated based on new tracked points
    setPointSuggestions([])

    if (runId) {
      await updateRun(runId, { trackedPoints: newTrackedPoints })
    }
  }

  const handleRemovePoint = async (id: string) => {
    const newTrackedPoints = trackedPoints.filter(p => p.id !== id)
    setTrackedPoints(newTrackedPoints)
    if (runId) await updateRun(runId, { trackedPoints: newTrackedPoints })
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

    if (runId) await updateRun(runId, { remarks: newRemarks })
  }

  // Handle tap on a point badge on the map (GNSS mode quick-save)
  const handlePointTap = async (suggestion: PointSuggestion) => {
    if (!suggestion.point) return

    const target = suggestion.suggestedSide === 'left' ? leftTarget : rightTarget

    const startKmValue = parseGermanNumber(formData.startKm.toString())
    const localDistance = gpsDistance + (suggestion.distance || 0)
    const dirSign = formData.direction === 'descending' ? -1 : 1
    const kmValue = (isNaN(startKmValue) ? 0 : startKmValue) + localDistance * dirSign

    const point: TrackedPoint = {
      id: uuidv4(),
      pointId: suggestion.point.id,
      pointNumber: suggestion.point.pointNumber,
      side: suggestion.suggestedSide || 'left',
      localDistance: Math.max(0, localDistance),
      kmValue,
      timestamp: new Date().toISOString(),
      targetBoard: { ...target },
      gpsPosition: lastGpsPosition ? {
        latitude: lastGpsPosition.latitude,
        longitude: lastGpsPosition.longitude,
        accuracy: lastGpsPosition.accuracy
      } : undefined
    }

    const newTrackedPoints = [...trackedPoints, point]
    setTrackedPoints(newTrackedPoints)

    // Mark as recently captured (show checkmark)
    const pointKey = suggestion.point.id
    setRecentlyCaptured(prev => new Set(prev).add(pointKey))
    // Clear old timer if re-captured
    if (captureTimers.current.has(pointKey)) {
      clearTimeout(captureTimers.current.get(pointKey)!)
    }
    captureTimers.current.set(pointKey, setTimeout(() => {
      setRecentlyCaptured(prev => {
        const next = new Set(prev)
        next.delete(pointKey)
        return next
      })
      captureTimers.current.delete(pointKey)
    }, 8000))

    if (runId) {
      await updateRun(runId, { trackedPoints: newTrackedPoints })
    }
  }

  const handleCompleteRun = () => {
    // GNSS-Only: Allow completion with GPS track even without tracked points
    const hasTrackedPoints = trackedPoints.length > 0
    const hasGpsTrack = formData.gpsEnabled && gpsTrack.length > 0

    if (!hasTrackedPoints && !hasGpsTrack) {
      alert('Bitte mindestens einen Punkt erfassen oder GPS-Tracking aktivieren')
      return
    }

    // Set length from tracked points or GPS distance
    let totalLength: number
    if (hasTrackedPoints) {
      totalLength = trackedPoints[trackedPoints.length - 1]?.localDistance || 0
    } else {
      // GNSS-Only: use GPS distance
      totalLength = gpsDistance
    }

    setFormData(prev => ({ ...prev, length: totalLength.toFixed(1) }))
    setPhase('completed')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleContinueRun = async () => {
    if (isRunActive && activeRun && activeRun.runId !== runId) {
      alert(`Es läuft bereits eine andere Messfahrt: "${activeRun.runName}". Bitte diese zuerst beenden.`)
      return
    }

    if (!runId || !projectId || !jobId) return

    try {
      // Mark run as not completed
      await updateRun(runId, { isCompleted: false })

      // Set this run as active
      setActiveRun({ projectId, jobId, runId, runName: formData.runName })

      // Switch to recording phase
      setPhase('recording')
    } catch (error) {
      console.error('Error continuing run:', error)
      alert('Fehler beim Fortsetzen der Messfahrt')
    }
  }

  const handleCancelRun = async () => {
    // If the run is already completed, just navigate back
    if (phase === 'completed') {
      clearActiveRun()
      navigate(getBackUrl())
      return
    }

    // For in-progress runs: show confirmation modal
    setShowCancelConfirm(true)
  }

  const handleConfirmCancel = async () => {
    setShowCancelConfirm(false)
    try {
      if (runId) await deleteRun(runId)
      clearActiveRun()
      navigate(getBackUrl())
    } catch (error) {
      console.error('Error canceling run:', error)
    }
  }

  const handleSave = async () => {
    if (!projectId || !jobId) return

    if (phase === 'completed') {
      if (!formData.speed || !formData.length) {
        alert('Bitte Geschwindigkeit und Gesamtlänge eingeben')
        return
      }
    }

    setIsSaving(true)

    try {
      const lengthValue = parseFloat(formData.length.toString())
      const dirSign = formData.direction === 'descending' ? -1 : 1
      const endKm = parseGermanNumber(formData.startKm.toString()) + lengthValue * dirSign
      const pointFrom = trackedPoints.length > 0 ? trackedPoints[0].pointNumber : ''
      const pointTo = trackedPoints.length > 0 ? trackedPoints[trackedPoints.length - 1].pointNumber : ''

      const runData = {
        measurementJobId: jobId,
        runName: formData.runName,
        routeNumber: formData.routeNumber,
        trackType: formData.trackType,
        direction: formData.direction,
        objectDesignation: formData.objectDesignation || undefined,
        startKm: parseGermanNumber(formData.startKm.toString()),
        endKm: phase === 'completed' ? endKm : undefined,
        length: phase === 'completed' ? parseFloat(formData.length.toString()) : undefined,
        scannerType: formData.scannerType,
        scannerAlignment: formData.scannerAlignment,
        speed: phase === 'completed' ? parseFloat(formData.speed.toString()) : undefined,
        trackingMode: 'double' as TrackingMode,
        pointNumberFrom: pointFrom,
        pointNumberTo: pointTo,
        trackedPoints,
        remarks,
        gpsEnabled: formData.gpsEnabled,
        gpsTrack: gpsTrack.length > 0
          ? (phase === 'completed' && selectedTrajectorySpline
            ? trimGpsTrackMonotone(gpsTrack, selectedTrajectorySpline).trimmedTrack
            : gpsTrack)
          : undefined,
        isCompleted: phase === 'completed',
        // Speichere Startposition für Punktvorschläge
        startPositionSnap: snappedStart ? {
          latitude: snappedStart.position.latitude,
          longitude: snappedStart.position.longitude,
          bearing: snappedStart.bearing,
          distanceAlongSpline: snappedStart.distanceAlongSpline
        } : undefined
      }

      if (isEdit && runId) {
        await updateRun(runId, runData)
      } else {
        await createRun(projectId, jobId, runData)
      }

      if (phase === 'completed') clearActiveRun()
      navigate(getBackUrl())
    } catch (error) {
      console.error('Error saving run:', error)
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

  return (
    <div className="space-y-4">
      {/* Job Info Banner - hidden during GNSS fullscreen recording */}
      {job && !(phase === 'recording' && formData.gpsEnabled) && (
        <div
          className="p-3 rounded-lg cursor-pointer"
          style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}
          onClick={() => navigate(getBackUrl())}
        >
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {t('measurementJob.title')}: <span style={{ color: 'var(--color-text)' }}>{job.jobName}</span>
          </p>
        </div>
      )}

      {/* PHASE 1: SETUP */}
      {phase === 'setup' && (
        <>
          <Card>
            <CardContent>
              <h3 className="text-md font-semibold mb-4" style={{ color: 'var(--color-text)' }}>{t('runs.runData')}</h3>
              <div className="space-y-4">
                <Input
                  label={t('runs.runName')}
                  value={formData.runName}
                  onChange={(e) => setFormData({ ...formData, runName: e.target.value })}
                  required
                  placeholder="z.B. A1P001_Scan 01"
                />

                <Input
                  label={t('runs.routeNumber')}
                  value={formData.routeNumber}
                  onChange={(e) => setFormData({ ...formData, routeNumber: e.target.value })}
                  required
                  placeholder="Streckennummer"
                />

                <Select
                  label={t('runs.trackType')}
                  value={formData.trackType}
                  onChange={(e) => setFormData({ ...formData, trackType: e.target.value as TrackType })}
                  options={TRACK_TYPES.map(type => ({ value: type, label: type }))}
                  required
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
                  label={`${t('runs.objectDesignation')} (${t('common.optional') || 'Optional'})`}
                  value={formData.objectDesignation}
                  onChange={(e) => setFormData({ ...formData, objectDesignation: e.target.value })}
                  placeholder={t('runs.objectDesignationPlaceholder')}
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
                  <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                    = {formatKmValue(parseGermanNumber(formData.startKm.toString()))}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <h3 className="text-md font-semibold mb-4" style={{ color: 'var(--color-text)' }}>{t('runs.runSettings')}</h3>
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
                  onChange={(checked) => {
                    setFormData({ ...formData, gpsEnabled: checked })
                    // Reset click mode when enabling GPS (no manual start needed)
                    if (checked) {
                      setClickMode('none')
                    }
                  }}
                  label={t('runs.gpsTracking')}
                />
                {formData.gpsEnabled && (
                  <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                    GPS-Trajektorie wird während der Fahrt aufgezeichnet
                  </p>
                )}

                {/* Reference Trajectory Selection */}
                {allTrajectories.length > 0 && (
                  <Select
                    label={formData.gpsEnabled ? (t('referenceTrajectories.selectTitle') || 'Solltrasse (GPS-Snapping)') : (t('referenceTrajectories.selectTitleGeneral') || 'Solltrasse')}
                    value={selectedTrajectoryId || ''}
                    onChange={(e) => setSelectedTrajectoryId(e.target.value || null)}
                    options={[
                      { value: '', label: t('referenceTrajectories.noTrajectory') || 'Keine Solltrasse' },
                      ...allTrajectories.map(traj => ({
                        value: traj.id,
                        label: `${traj.name} (${traj.points.length} Pkt.)`
                      }))
                    ]}
                  />
                )}
                {selectedTrajectoryId && (
                  <p className="text-xs" style={{ color: formData.gpsEnabled ? '#22c55e' : '#3b82f6' }}>
                    {formData.gpsEnabled
                      ? (t('referenceTrajectories.snappingActive') || 'GPS-Position wird auf Solltrasse gesnappt')
                      : (t('referenceTrajectories.trajectoryActiveOnMap') || 'Solltrasse auf Karte aktiv')}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Map for orientation and manual start position */}
          {(formData.gpsEnabled || selectedTrajectoryId || (field && field.points.length > 0) || initialPosition) && (
            <div className="space-y-2">
              <RunMap
                fixedPoints={field?.points || []}
                startPosition={formData.gpsEnabled ? null : manualStartPosition}
                currentPosition={formData.gpsEnabled && lastGpsPosition
                  ? { latitude: lastGpsPosition.latitude, longitude: lastGpsPosition.longitude }
                  : initialPosition || null}
                onStartPositionSet={trajectoryMode ? (lat, lon) => {
                  if (trajectorySpline) {
                    const snapResult = snapToSpline(trajectorySpline, { latitude: lat, longitude: lon })
                    if (snapResult.distanceFromClick > 50) {
                      alert(t('runs.clickTooFarFromTrack') || 'Bitte näher an der Strecke klicken (max. 50m)')
                      return
                    }
                    setSnappedStart(snapResult)
                    setClickMode('none')
                  }
                } : undefined}
                clickMode={formData.gpsEnabled || !trajectoryMode ? 'none' : clickMode}
                alwaysExpanded={true}
                fieldId={field?.id}
                trackInfo={trajectoryMode && !formData.gpsEnabled ? trackInfo : undefined}
                upcomingPoints={trajectoryMode && !formData.gpsEnabled ? (trackInfo?.upcomingPoints?.slice(0, 5) || []) : []}
                preventAutoZoom={true}
                referenceTrajectories={
                  allTrajectories.length > 0
                    ? (selectedTrajectoryId
                        ? referenceTrajectoryDisplays.filter(t => t.id === selectedTrajectoryId)
                        : referenceTrajectoryDisplays)
                    : []
                }
                selectedTrajectoryId={selectedTrajectoryId}
                onTrajectorySelect={(id) => setSelectedTrajectoryId(id)}
              />

              {/* Snapped start info - only show when GPS is disabled and spline enabled */}
              {trajectoryMode && !formData.gpsEnabled && snappedStart && (
                <div
                  className="p-3 rounded-lg"
                  style={{
                    backgroundColor: isDark ? 'transparent' : '#dcfce7',
                    border: isDark ? '2px solid #22c55e' : '1px solid #bbf7d0'
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium" style={{ color: '#22c55e' }}>
                        {t('runs.startPointSet') || 'Startpunkt gesetzt'}
                      </div>
                      <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                        {t('runs.distanceOnTrack') || 'Position auf Strecke'}: {snappedStart.distanceAlongSpline.toFixed(0)}m
                      </div>
                    </div>
                    <div className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      <ArrowRight className="w-4 h-4" style={{ color: '#22c55e' }} />
                      {((snappedStart.bearing * 180 / Math.PI + 360) % 360).toFixed(0)}°
                    </div>
                  </div>
                </div>
              )}

              {/* Start position and direction controls - only when spline enabled and GPS disabled */}
              {trajectoryMode && !formData.gpsEnabled && (
                <div className="flex gap-2">
                  <Button
                    variant={clickMode === 'start' ? 'primary' : 'secondary'}
                    size="sm"
                    onClick={() => {
                      if (clickMode === 'start') {
                        setClickMode('none')
                      } else {
                        setClickMode('start')
                      }
                    }}
                    className="flex-1"
                  >
                    {clickMode === 'start'
                      ? (t('runs.cancelSetStart') || 'Abbrechen')
                      : snappedStart
                        ? (t('runs.changeStartPoint') || 'Startpunkt ändern')
                        : (t('runs.setStartPoint') || 'Startpunkt auf Strecke setzen')
                    }
                  </Button>

                  {/* Direction toggle button - only show when trajectory exists */}
                  {trajectorySpline && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setIsReversed(!isReversed)
                        if (snappedStart && trajectorySpline) {
                          const newSpline = isReversed ? trajectorySpline : reverseSpline(trajectorySpline)
                          const newSnapResult = snapToSpline(newSpline, snappedStart.position)
                          setSnappedStart(newSnapResult)
                        }
                      }}
                      className="flex items-center gap-1"
                    >
                      <RefreshCw className="w-4 h-4" />
                      {t('runs.reverseDirection') || 'Richtung umkehren'}
                    </Button>
                  )}
                </div>
              )}

              {/* Info text - click on trajectory to set start point */}
              {trajectoryMode && !formData.gpsEnabled && !snappedStart && trajectorySpline && (
                <p className="text-xs text-center" style={{ color: 'var(--color-text-muted)' }}>
                  {t('runs.clickOnTrackHint') || 'Klicken Sie auf die Strecke um den Startpunkt zu setzen'}
                </p>
              )}
              {trajectoryMode && !formData.gpsEnabled && !trajectorySpline && (
                <p className="text-xs text-center" style={{ color: '#f59e0b' }}>
                  {t('runs.cannotBuildTrajectory') || 'Solltrasse konnte nicht geladen werden'}
                </p>
              )}
            </div>
          )}

          <div className="flex gap-3">
            <Button variant="danger" onClick={() => navigate(getBackUrl())} size="lg">
              <X className="w-5 h-5 mr-2" />
              {t('common.cancel') || 'Abbrechen'}
            </Button>
            <Button onClick={handleStartRun} className="flex-1" size="lg">
              <Play className="w-5 h-5 mr-2" />
              {t('runs.startRun')}
            </Button>
          </div>
        </>
      )}

      {/* PHASE 2: RECORDING */}
      {phase === 'recording' && formData.gpsEnabled && (
        <>
          {/* GNSS Fullscreen Recording Mode - fixed position below header (incl. safe area) */}
          <div className="fixed left-0 right-0 z-[500]" style={{ top: 'calc(56px + env(safe-area-inset-top, 0px))', bottom: '0px' }}>
            <RunMap
              fixedPoints={field?.points || []}
              gpsTrack={smoothedGpsTrack.length > 0 ? smoothedGpsTrack : gpsTrack}
              startPosition={null}
              currentPosition={lastGpsPosition ? { latitude: lastGpsPosition.latitude, longitude: lastGpsPosition.longitude } : null}
              fieldId={field?.id}
              preventAutoZoom={true}
              referenceTrajectories={selectedTrajectoryId ? referenceTrajectoryDisplays.filter(t => t.id === selectedTrajectoryId) : []}
              selectedTrajectoryId={selectedTrajectoryId}
              fullscreen={true}
              followGps={followGps}
              followGpsTick={followGpsTick}
              onFollowGpsChange={setFollowGps}
              gpsBearing={gpsBearing}
            />

            {/* Floating Overlays */}

            {/* Side buttons for GNSS point capture (multiple per side) */}
            {leftPoints.length > 0 && (
              <div
                className="absolute z-[1000] flex flex-col gap-2"
                style={{ left: '8px', top: '45%', transform: 'translateY(-50%)', width: '33vw' }}
              >
                {leftPoints.map(pt => {
                  const isCaptured = recentlyCaptured.has(pt.point.id)
                  const dist = pt.distance
                  const absDist = Math.abs(dist)
                  const distColor = absDist <= 5 ? '#22c55e' : '#ef4444'
                  const sign = dist >= 0 ? '+' : '−'
                  return (
                    <button
                      key={pt.point.id}
                      type="button"
                      onClick={() => !isCaptured && handlePointTap(pt)}
                      style={{ width: '100%' }}
                    >
                      <div
                        style={{
                          backgroundColor: isCaptured ? 'rgba(34,197,94,0.3)' : 'rgba(59,130,246,0.35)',
                          border: `3px solid ${isCaptured ? '#4ade80' : '#93c5fd'}`,
                          borderRadius: '12px',
                          padding: '16px 8px',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          backdropFilter: 'blur(4px)',
                          position: 'relative',
                          transition: 'transform 0.3s ease-out'
                        }}
                      >
                        {isCaptured && (
                          <svg width="28" height="28" viewBox="0 0 24 24" style={{ position: 'absolute', top: '6px', right: '6px' }}>
                            <circle cx="12" cy="12" r="11" fill="#22c55e" stroke="white" strokeWidth="1.5"/>
                            <path d="M7 12.5l3 3 7-7" stroke="white" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                        <span style={{ color: '#000', fontWeight: 800, fontSize: '16px', lineHeight: '1.2', textAlign: 'center', wordBreak: 'break-all', textShadow: '0 0 6px rgba(255,255,255,0.8)' }}>
                          {pt.point.pointNumber}
                        </span>
                        <span style={{ color: distColor, fontSize: '16px', fontWeight: 700, marginTop: '4px', textShadow: '0 0 4px rgba(0,0,0,0.5)' }}>
                          {sign}{absDist.toFixed(0)}m
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}

            {rightPoints.length > 0 && (
              <div
                className="absolute z-[1000] flex flex-col gap-2"
                style={{ right: '8px', top: '45%', transform: 'translateY(-50%)', width: '33vw' }}
              >
                {rightPoints.map(pt => {
                  const isCaptured = recentlyCaptured.has(pt.point.id)
                  const dist = pt.distance
                  const absDist = Math.abs(dist)
                  const distColor = absDist <= 5 ? '#22c55e' : '#ef4444'
                  const sign = dist >= 0 ? '+' : '−'
                  return (
                    <button
                      key={pt.point.id}
                      type="button"
                      onClick={() => !isCaptured && handlePointTap(pt)}
                      style={{ width: '100%' }}
                    >
                      <div
                        style={{
                          backgroundColor: isCaptured ? 'rgba(34,197,94,0.3)' : 'rgba(249,115,22,0.35)',
                          border: `3px solid ${isCaptured ? '#4ade80' : '#fdba74'}`,
                          borderRadius: '12px',
                          padding: '16px 8px',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          backdropFilter: 'blur(4px)',
                          position: 'relative',
                          transition: 'transform 0.3s ease-out'
                        }}
                      >
                        {isCaptured && (
                          <svg width="28" height="28" viewBox="0 0 24 24" style={{ position: 'absolute', top: '6px', right: '6px' }}>
                            <circle cx="12" cy="12" r="11" fill="#22c55e" stroke="white" strokeWidth="1.5"/>
                            <path d="M7 12.5l3 3 7-7" stroke="white" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                        <span style={{ color: '#000', fontWeight: 800, fontSize: '16px', lineHeight: '1.2', textAlign: 'center', wordBreak: 'break-all', textShadow: '0 0 6px rgba(255,255,255,0.8)' }}>
                          {pt.point.pointNumber}
                        </span>
                        <span style={{ color: distColor, fontSize: '16px', fontWeight: 700, marginTop: '4px', textShadow: '0 0 4px rgba(0,0,0,0.5)' }}>
                          {sign}{absDist.toFixed(0)}m
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}

            {/* Top-left: Cancel run */}
            <button
              type="button"
              onClick={handleCancelRun}
              className="absolute top-3 left-3 z-[1000] px-3 h-11 rounded-lg shadow-lg flex items-center justify-center"
              style={{ backgroundColor: 'rgba(0,0,0,0.75)', color: '#ef4444' }}
            >
              <span className="text-sm font-semibold">{t('runs.cancelRun') || 'Abbrechen'}</span>
            </button>

            {/* Top-center: Run name + distance */}
            <div
              className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] px-4 py-2 rounded-lg shadow-lg text-center"
              style={{ backgroundColor: 'rgba(0,0,0,0.75)', color: 'white' }}
            >
              <div className="text-sm font-semibold">{formData.runName}</div>
              <div className="text-xs opacity-80">
                {gpsDistance >= 1000
                  ? `${(gpsDistance / 1000).toFixed(2)} km`
                  : `${gpsDistance > 0 ? gpsDistance.toFixed(0) : '0'} m`}
                {trackedPoints.length > 0 && ` · ${trackedPoints.length} Pkt.`}
              </div>
            </div>

            {/* Top-right: GPS accuracy, GNSS button, Trajectory button, Targets */}
            <div className="absolute top-3 right-3 z-[1000] flex flex-col gap-2 items-end">
              {/* GPS accuracy */}
              <div
                className="h-11 px-3 rounded-lg shadow-lg flex items-center gap-1.5"
                style={{ backgroundColor: 'rgba(0,0,0,0.75)', color: 'white' }}
              >
                {gpsStatus === 'active' ? (
                  <Navigation className="w-4 h-4" style={{ color: '#22c55e' }} />
                ) : (
                  <NavigationOff className="w-4 h-4" style={{ color: gpsStatus === 'error' ? '#ef4444' : '#f59e0b' }} />
                )}
                <span className="text-sm">
                  {gpsStatus === 'active' && lastGpsPosition
                    ? `±${lastGpsPosition.accuracy?.toFixed(0) || '?'}m`
                    : gpsStatus === 'waiting' ? 'GPS...' : gpsStatus === 'error' ? 'Fehler' : ''}
                </span>
              </div>
              {/* GNSS center button */}
              <button
                type="button"
                onClick={() => { setFollowGps(true); setFollowGpsTick(t => t + 1) }}
                className="w-11 h-11 rounded-lg shadow-lg flex items-center justify-center"
                style={{
                  backgroundColor: followGps ? '#3b82f6' : 'rgba(0,0,0,0.75)',
                  color: 'white',
                  border: followGps ? '2px solid #93c5fd' : 'none'
                }}
              >
                <Navigation className="w-5 h-5" />
              </button>
              {/* Trajectory zoom button */}
              {selectedTrajectoryId && (
                <button
                  type="button"
                  onClick={() => {
                    const el = document.querySelector('.leaflet-container')
                    if (el) el.dispatchEvent(new CustomEvent('zoomToTrajectory'))
                  }}
                  className="w-11 h-11 rounded-lg shadow-lg flex items-center justify-center"
                  style={{ backgroundColor: 'rgba(0,0,0,0.75)', color: 'white' }}
                >
                  <Route className="w-5 h-5" />
                </button>
              )}
              {/* Targets button */}
              <button
                type="button"
                onClick={() => setShowTargetConfig(true)}
                className="w-11 h-11 rounded-lg shadow-lg flex items-center justify-center"
                style={{ backgroundColor: 'rgba(0,0,0,0.75)', color: 'white' }}
              >
                <Target className="w-5 h-5" />
              </button>
            </div>

            {/* Bottom: Action buttons (full width) */}
            <div className="absolute left-3 right-3 z-[1000] flex gap-2" style={{ bottom: 'calc(60px + env(safe-area-inset-bottom, 0px))' }}>
              {/* Remark button */}
              <button
                type="button"
                onClick={() => setShowRemarkInput(!showRemarkInput)}
                className="px-4 py-3 rounded-lg shadow-lg flex items-center gap-2"
                style={{ backgroundColor: 'rgba(0,0,0,0.75)', color: 'white' }}
              >
                <MessageSquare className="w-4 h-4" />
                <span className="text-sm">{t('runs.remarks')}</span>
              </button>
              {/* End run button */}
              <button
                type="button"
                onClick={handleCompleteRun}
                className="flex-1 px-4 py-3 rounded-lg shadow-lg flex items-center justify-center gap-2"
                style={{ backgroundColor: 'rgba(239,68,68,0.9)', color: 'white' }}
              >
                <Save className="w-4 h-4" />
                <span className="text-sm font-medium">{t('runs.completeRun')}</span>
              </button>
            </div>
          </div>

          {/* Remark input overlay for fullscreen mode */}
          {showRemarkInput && (
            <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
              <div className="w-full max-w-sm p-4 rounded-xl shadow-xl" style={{ backgroundColor: 'var(--color-bg-card)' }}>
                <div className="space-y-3">
                  <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Bemerkung hinzufügen</div>
                  <Input
                    ref={remarkInputRef}
                    value={newRemark}
                    onChange={(e) => setNewRemark(e.target.value)}
                    placeholder="Bemerkung eingeben..."
                    onKeyDown={(e) => e.key === 'Enter' && handleAddRemark()}
                  />
                  <div className="flex gap-2">
                    <Button onClick={handleAddRemark} className="flex-1">Speichern</Button>
                    <Button variant="secondary" onClick={() => setShowRemarkInput(false)} className="flex-1">Abbrechen</Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Target configuration overlay */}
          {showTargetConfig && (
            <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} onClick={() => setShowTargetConfig(false)}>
              <div className="w-full max-w-sm p-4 rounded-xl shadow-xl overflow-y-auto" style={{ backgroundColor: 'var(--color-bg-card)', maxHeight: 'calc(100vh - 120px)' }} onClick={e => e.stopPropagation()}>
                <h3 className="text-md font-semibold mb-4" style={{ color: 'var(--color-text)' }}>Targets Links / Rechts</h3>
                {(['left', 'right'] as const).map(side => {
                  const target = side === 'left' ? leftTarget : rightTarget
                  const setTarget = side === 'left' ? setLeftTarget : setRightTarget
                  return (
                    <div key={side} className="mb-4">
                      <div className="text-sm font-medium mb-2" style={{ color: side === 'left' ? '#3b82f6' : '#f97316' }}>
                        {side === 'left' ? 'Links' : 'Rechts'}
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {TARGET_BOARD_PRESETS.map(preset => {
                          const isSelected = target.size === preset.board.size
                            && target.height === preset.board.height
                            && target.thickness === preset.board.thickness
                          return (
                            <button
                              key={`${side}-${preset.label}`}
                              type="button"
                              onClick={() => setTarget({ ...preset.board })}
                              className="flex flex-col items-center rounded-lg p-1 transition-colors"
                              style={{
                                border: isSelected ? '2px solid #3b82f6' : '1px solid var(--color-border)',
                                backgroundColor: isSelected ? (isDark ? 'rgba(59,130,246,0.15)' : '#eff6ff') : 'var(--color-bg-card)'
                              }}
                            >
                              <img
                                src={preset.image}
                                alt={preset.label}
                                className="w-full h-auto object-contain"
                                style={{ maxHeight: '48px', filter: isDark ? 'invert(1)' : 'none' }}
                              />
                              <span className="text-xs mt-1" style={{ color: isSelected ? '#3b82f6' : 'var(--color-text-secondary)' }}>
                                {preset.label}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
                <Button onClick={() => setShowTargetConfig(false)} className="w-full">Schließen</Button>
              </div>
            </div>
          )}

          {/* Cancel confirmation modal */}
          {showCancelConfirm && (
            <div className="fixed inset-0 z-[2000] flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} onClick={() => setShowCancelConfirm(false)}>
              <div className="mx-4 w-full max-w-sm p-5 rounded-xl shadow-xl" style={{ backgroundColor: 'var(--color-bg-card)' }} onClick={e => e.stopPropagation()}>
                <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--color-text)' }}>
                  {t('runs.cancelRun') || 'Fahrt abbrechen'}
                </h3>
                <p className="text-sm mb-5" style={{ color: 'var(--color-text-secondary)' }}>
                  Messfahrt wirklich abbrechen? Alle erfassten Daten werden gelöscht.
                </p>
                <div className="flex gap-3">
                  <Button variant="secondary" onClick={() => setShowCancelConfirm(false)} className="flex-1">
                    Zurück
                  </Button>
                  <Button variant="danger" onClick={handleConfirmCancel} className="flex-1">
                    Abbrechen
                  </Button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {phase === 'recording' && !formData.gpsEnabled && (
        <>
          {field && trackedPoints.length > 0 && (
            <TrackVisualization
              allFixedPoints={field.points}
              trackedPoints={trackedPoints}
              currentDistance={newPoint.localDistance ? parseFloat(newPoint.localDistance) : (trackedPoints[trackedPoints.length - 1]?.localDistance || 0)}
            />
          )}

          {/* Map overview during recording */}
          {(selectedTrajectoryId || (field && field.points.length > 0)) && (
            <RunMap
              fixedPoints={field?.points || []}
              gpsTrack={smoothedGpsTrack.length > 0 ? smoothedGpsTrack : gpsTrack}
              startPosition={trajectoryMode && !formData.gpsEnabled ? manualStartPosition : null}
              currentPosition={lastGpsPosition ? { latitude: lastGpsPosition.latitude, longitude: lastGpsPosition.longitude } : null}
              alwaysExpanded={true}
              fieldId={field?.id}
              trackInfo={trajectoryMode ? trackInfo : undefined}
              upcomingPoints={trajectoryMode ? (trackInfo?.upcomingPoints || []) : []}
              preventAutoZoom={true}
              currentDistance={parseFloat(newPoint.localDistance) || 0}
              autoCenterOnDistance={trajectoryMode}
              referenceTrajectories={selectedTrajectoryId ? referenceTrajectoryDisplays.filter(t => t.id === selectedTrajectoryId) : []}
              selectedTrajectoryId={selectedTrajectoryId}
            />
          )}

          {/* Compact position display */}
          <div
            className="flex items-center justify-center gap-4 px-4 py-2 rounded-lg"
            style={{
              backgroundColor: 'var(--color-bg-card)',
              border: '1px solid var(--color-border)'
            }}
          >
            <div className="text-xl font-bold" style={{ color: '#3b82f6' }}>
              {trackedPoints.length > 0 ? formatKmValue(trackedPoints[trackedPoints.length - 1].kmValue) : (formData.startKm ? formatKmValue(parseGermanNumber(formData.startKm.toString())) : 'KM 0,0 + 0,0')}
            </div>
            <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              {trackedPoints.length} Pkt.
            </div>
          </div>

          <Card>
            <CardContent>
              <h3 className="text-md font-semibold mb-4" style={{ color: 'var(--color-text)' }}>{t('runs.capturePoint')}</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>
                    Gefahrene Strecke (m)
                  </label>
                  <Input
                    type="number"
                    step="0.1"
                    value={newPoint.localDistance}
                    onChange={(e) => handleDistanceChange(e.target.value)}
                    placeholder="z.B. 50.0"
                  />
                  {formData.gpsEnabled && gpsStatus === 'active' && gpsInitProgress < 1 && (
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs px-2 py-0.5 rounded" style={{
                        backgroundColor: isDark ? 'transparent' : '#fef3c7',
                        border: isDark ? '1px solid #f59e0b' : '1px solid #fde68a',
                        color: '#f59e0b'
                      }}>
                        GPS aktiv — Richtung wird ermittelt ({(gpsInitProgress * 100).toFixed(0)}%)
                      </span>
                    </div>
                  )}
                  {formData.gpsEnabled && gpsInitProgress >= 1 && (
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs px-2 py-0.5 rounded" style={{
                        backgroundColor: isDark ? 'transparent' : '#dcfce7',
                        border: isDark ? '1px solid #22c55e' : '1px solid #bbf7d0',
                        color: '#22c55e'
                      }}>
                        {t('runs.gpsDistance')}: {gpsDistance.toFixed(1)}m
                      </span>
                    </div>
                  )}
                  {/* Schnell-Buttons: Vorwärts */}
                  <div className="flex gap-2 mt-2">
                    {distanceIncrements.map(inc => (
                      <Button
                        key={inc}
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="flex-1"
                        onClick={() => handleAddDistance(inc)}
                      >
                        +{inc}m
                      </Button>
                    ))}
                  </div>
                  {/* Schnell-Buttons: Rückwärts */}
                  <div className="flex gap-2 mt-1">
                    {distanceIncrements.map(inc => (
                      <Button
                        key={-inc}
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="flex-1"
                        onClick={() => handleAddDistance(-inc)}
                        style={{ opacity: 0.7 }}
                      >
                        -{inc}m
                      </Button>
                    ))}
                  </div>
                </div>

                {pointSuggestions.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text)' }}>
                      Vorgeschlagene Punkte ({pointSuggestions.length})
                    </label>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {pointSuggestions.map((suggestion, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => {
                            // Calculate the new localDistance: current distance + relative distance to point
                            const currentDist = parseFloat(newPoint.localDistance) || 0
                            const newDist = Math.max(0, currentDist + suggestion.distance)
                            setNewPoint({
                              ...newPoint,
                              pointNumber: suggestion.point.pointNumber,
                              side: suggestion.suggestedSide || newPoint.side,
                              localDistance: newDist.toFixed(1)
                            })
                            setPointSuggestions([])
                          }}
                          className="w-full text-left px-3 py-2 rounded-lg transition-colors"
                          style={{ backgroundColor: isDark ? 'transparent' : '#eff6ff', border: isDark ? '2px solid #3b82f6' : '1px solid #bfdbfe' }}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="font-medium" style={{ color: '#3b82f6' }}>{suggestion.point.pointNumber}</span>
                              <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                                {suggestion.distance >= 0
                                  ? `in ${suggestion.distance.toFixed(1).replace('.', ',')}m`
                                  : `vor ${Math.abs(suggestion.distance).toFixed(1).replace('.', ',')}m`
                                }
                              </span>
                              {suggestion.suggestedSide && (
                                <span className="text-sm px-2 py-0.5 rounded font-medium" style={{ backgroundColor: isDark ? 'transparent' : '#dcfce7', border: isDark ? '1px solid #22c55e' : 'none', color: '#22c55e' }}>
                                  {suggestion.suggestedSide === 'left' ? 'Links' : 'Rechts'}
                                </span>
                              )}
                            </div>
                            {suggestion.lateralDistance !== undefined && (
                              <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                                seitl. {suggestion.lateralDistance.toFixed(1).replace('.', ',')}m
                              </span>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>Punktnummer</label>
                  <input
                    value={newPoint.pointNumber}
                    onChange={(e) => handlePointNumberChange(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg"
                    style={{ backgroundColor: 'var(--color-bg-input)', color: 'var(--color-text)', border: '1px solid var(--color-border-input)' }}
                    placeholder="z.B. P001_L"
                  />

                  {textBasedSuggestions.length > 0 && pointSuggestions.length === 0 && (
                    <div className="mt-2 space-y-1 max-h-40 overflow-y-auto rounded-lg p-1" style={{ border: '1px solid var(--color-border)' }}>
                      {textBasedSuggestions.map((suggestion) => (
                        <button key={suggestion.id} type="button" onClick={() => { setNewPoint({ ...newPoint, pointNumber: suggestion.pointNumber }); setTextBasedSuggestions([]) }} className="w-full text-left px-3 py-2 rounded" style={{ backgroundColor: 'var(--color-bg)' }}>
                          <span className="font-medium" style={{ color: 'var(--color-text)' }}>{suggestion.pointNumber}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {pairedPointSuggestion && (
                    <div className="mt-2 p-2 rounded-lg" style={{ backgroundColor: isDark ? 'transparent' : '#eff6ff', border: isDark ? '2px solid #3b82f6' : '1px solid #bfdbfe' }}>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={includePairedPoint} onChange={(e) => setIncludePairedPoint(e.target.checked)} className="w-4 h-4 text-blue-600 rounded" />
                        <span className="text-sm" style={{ color: 'var(--color-text)' }}>Auch Paarpunkt <strong>{pairedPointSuggestion.pointNumber}</strong> erfassen</span>
                      </label>
                    </div>
                  )}
                </div>

                <Select
                  label="Seite"
                  value={newPoint.side}
                  onChange={(e) => setNewPoint({ ...newPoint, side: e.target.value as 'left' | 'right' })}
                  options={[{ value: 'left', label: 'Links' }, { value: 'right', label: 'Rechts' }]}
                />

                {/* Bemerkung am Punkt */}
                <Input
                  label="Bemerkung am Punkt (optional)"
                  value={newPoint.remark}
                  onChange={(e) => setNewPoint({ ...newPoint, remark: e.target.value })}
                  placeholder="z.B. Punkt beschädigt"
                />

                {/* Target Board Selection */}
                <div className="space-y-2">
                  <label className="block text-sm font-medium" style={{ color: 'var(--color-text)' }}>Zieltafel</label>
                  <div className="grid grid-cols-3 gap-2">
                    {TARGET_BOARD_PRESETS.map((preset) => {
                      const isSelected = targetBoard.size === preset.board.size
                        && targetBoard.height === preset.board.height
                        && targetBoard.thickness === preset.board.thickness
                      return (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => setTargetBoard({ ...preset.board })}
                          className="flex flex-col items-center rounded-lg p-1 transition-colors"
                          style={{
                            border: isSelected
                              ? '2px solid #3b82f6'
                              : `1px solid var(--color-border)`,
                            backgroundColor: isSelected
                              ? (isDark ? 'rgba(59,130,246,0.15)' : '#eff6ff')
                              : 'var(--color-bg-card)'
                          }}
                        >
                          <img
                            src={preset.image}
                            alt={preset.label}
                            className="w-full h-auto object-contain"
                            style={{ maxHeight: '72px', filter: isDark ? 'invert(1)' : 'none' }}
                          />
                          <span className="text-xs mt-1 font-medium" style={{ color: isSelected ? '#3b82f6' : 'var(--color-text-secondary)' }}>
                            {preset.label}
                          </span>
                        </button>
                      )
                    })}
                  </div>
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
                <h3 className="text-md font-semibold mb-3" style={{ color: 'var(--color-text)' }}>{t('runs.capturedPoints')}</h3>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {trackedPoints.map(point => (
                    <div key={point.id} className="flex items-center justify-between p-3 rounded" style={{ backgroundColor: 'var(--color-bg)' }}>
                      <div className="flex-1">
                        <div className="font-medium" style={{ color: 'var(--color-text)' }}>{point.pointNumber}</div>
                        <div className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                          {formatKmValue(point.kmValue)} • {point.side === 'left' ? 'Links' : 'Rechts'} • {point.localDistance}m
                        </div>
                        {point.targetBoard && (
                          <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                            Zieltafel: {point.targetBoard.size}mm / {point.targetBoard.height >= 0 ? '+' : ''}{point.targetBoard.height}mm / {point.targetBoard.thickness}mm
                          </div>
                        )}
                        {point.remark && (
                          <div className="text-xs mt-1 p-1 rounded" style={{ backgroundColor: isDark ? 'transparent' : '#fef3c7', border: isDark ? '1px solid #f59e0b' : 'none', color: '#d97706' }}>
                            {point.remark}
                          </div>
                        )}
                      </div>
                      <button onClick={() => handleRemovePoint(point.id)} className="text-red-600 p-2"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-md font-semibold" style={{ color: 'var(--color-text)' }}>{t('runs.remarks')}</h3>
                <Button variant="secondary" size="sm" onClick={() => setShowRemarkInput(!showRemarkInput)}>
                  <MessageSquare className="w-4 h-4 mr-2" />Hinzufügen
                </Button>
              </div>

              {showRemarkInput && (
                <div className="mb-3 space-y-2">
                  <Input ref={remarkInputRef} value={newRemark} onChange={(e) => setNewRemark(e.target.value)} placeholder="Bemerkung eingeben..." onKeyDown={(e) => e.key === 'Enter' && handleAddRemark()} />
                  <div className="flex gap-2">
                    <Button onClick={handleAddRemark} size="sm">Speichern</Button>
                    <Button variant="secondary" size="sm" onClick={() => setShowRemarkInput(false)}>Abbrechen</Button>
                  </div>
                </div>
              )}

              {remarks.length > 0 && (
                <div className="space-y-2">
                  {remarks.map(remark => (
                    <div
                      key={remark.id}
                      className="p-2 rounded"
                      style={{
                        backgroundColor: isDark ? 'transparent' : '#fef3c7',
                        border: isDark ? '1px solid #f59e0b' : 'none'
                      }}
                    >
                      <div className="text-sm font-medium" style={{ color: '#d97706' }}>Bemerkung {remark.number}</div>
                      <div className="text-sm" style={{ color: '#d97706' }}>{remark.text}</div>
                      <div className="text-xs mt-1" style={{ color: '#b45309' }}>{new Date(remark.timestamp).toLocaleTimeString('de-DE')}</div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex gap-3">
            <Button variant="danger" onClick={handleCancelRun} className="flex-1"><X className="w-4 h-4 mr-2" />{t('runs.cancelRun')}</Button>
            <Button onClick={handleCompleteRun} className="flex-1"><Save className="w-4 h-4 mr-2" />{t('runs.completeRun')}</Button>
          </div>
        </>
      )}

      {/* PHASE 3: COMPLETION */}
      {phase === 'completed' && (
        <>
          {/* Editable run parameters (for completed runs) */}
          {isEdit && run?.isCompleted && (
            <Card>
              <CardContent>
                <button
                  type="button"
                  className="w-full flex items-center justify-between"
                  onClick={() => setShowEditParams(!showEditParams)}
                >
                  <h3 className="text-md font-semibold" style={{ color: 'var(--color-text)' }}>
                    <Edit className="w-4 h-4 inline mr-2" />
                    {t('runs.editParameters') || 'Parameter bearbeiten'}
                  </h3>
                  <span style={{ color: 'var(--color-text-muted)', fontSize: '20px' }}>{showEditParams ? '▲' : '▼'}</span>
                </button>
                {showEditParams && (
                  <div className="space-y-4 mt-4">
                    <Input
                      label={t('runs.runName')}
                      value={formData.runName}
                      onChange={(e) => setFormData({ ...formData, runName: e.target.value })}
                      required
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <Input
                        label={t('runs.routeNumber')}
                        value={formData.routeNumber}
                        onChange={(e) => setFormData({ ...formData, routeNumber: e.target.value })}
                      />
                      <Select
                        label={t('runs.trackType')}
                        value={formData.trackType}
                        onChange={(e) => setFormData({ ...formData, trackType: e.target.value as TrackType })}
                        options={TRACK_TYPES.map(tt => ({ value: tt, label: tt }))}
                      />
                    </div>
                    <Select
                      label={t('runs.direction')}
                      value={formData.direction}
                      onChange={(e) => setFormData({ ...formData, direction: e.target.value as Direction })}
                      options={[
                        { value: 'ascending', label: t('runs.ascending') },
                        { value: 'descending', label: t('runs.descending') }
                      ]}
                    />
                    <Input
                      label={`${t('runs.objectDesignation')} (${t('common.optional') || 'Optional'})`}
                      value={formData.objectDesignation}
                      onChange={(e) => setFormData({ ...formData, objectDesignation: e.target.value })}
                    />
                    <Input
                      type="number"
                      step="0.1"
                      label="Start-Kilometer (in Meter)"
                      value={formData.startKm}
                      onChange={(e) => setFormData({ ...formData, startKm: e.target.value })}
                    />
                    {formData.startKm && parseGermanNumber(formData.startKm.toString()) > 0 && (
                      <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                        = {formatKmValue(parseGermanNumber(formData.startKm.toString()))}
                      </p>
                    )}
                    <Select
                      label={t('runs.scannerAlignment')}
                      value={formData.scannerAlignment}
                      onChange={(e) => setFormData({ ...formData, scannerAlignment: e.target.value as ScannerAlignment })}
                      options={[
                        { value: '80°/80°', label: '80°/80°' },
                        { value: '90°/90°', label: '90°/90°' }
                      ]}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent>
              <h3 className="text-md font-semibold mb-4" style={{ color: 'var(--color-text)' }}>{t('runs.completeRun')}</h3>
              <div className="space-y-4">
                <Input
                  type="number"
                  step="0.1"
                  label="Geschwindigkeit (m/s)"
                  value={formData.speed}
                  onChange={(e) => setFormData({ ...formData, speed: e.target.value })}
                  placeholder="Standard: 0,8"
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
                  <div className="p-3 rounded-lg" style={{ backgroundColor: isDark ? 'transparent' : '#eff6ff', border: isDark ? '2px solid #3b82f6' : '1px solid #bfdbfe' }}>
                    <div className="text-sm font-medium mb-1" style={{ color: '#3b82f6' }}>Berechnete Werte</div>
                    <div className="text-sm" style={{ color: '#3b82f6' }}>End-KM: {formatKmValue(parseGermanNumber(formData.startKm.toString()) + parseFloat(formData.length.toString()) * (formData.direction === 'descending' ? -1 : 1))}</div>
                    {trackedPoints.length > 0 ? (
                      <>
                        <div className="text-sm" style={{ color: '#3b82f6' }}>Von Punkt: {trackedPoints[0].pointNumber}</div>
                        <div className="text-sm" style={{ color: '#3b82f6' }}>Bis Punkt: {trackedPoints[trackedPoints.length - 1].pointNumber}</div>
                      </>
                    ) : formData.gpsEnabled && gpsTrack.length > 0 ? (
                      <div className="text-sm" style={{ color: '#22c55e' }}>GNSS-Only: {gpsTrack.length} GPS-Punkte aufgezeichnet</div>
                    ) : null}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="flex gap-3 pb-6">
            {isEdit && run?.isCompleted ? (
              <>
                <Button variant="secondary" onClick={() => navigate(getBackUrl())} className="flex-1">
                  {t('common.back')}
                </Button>
                <Button onClick={handleSave} disabled={isSaving} className="flex-1">
                  <Save className="w-4 h-4 mr-2" />
                  {isSaving ? t('common.loading') : t('common.save')}
                </Button>
              </>
            ) : (
              <>
                <Button variant="secondary" onClick={() => setPhase('recording')} className="flex-1">{t('common.back')}</Button>
                <Button onClick={handleSave} disabled={isSaving} className="flex-1">
                  <Save className="w-4 h-4 mr-2" />
                  {isSaving ? t('common.loading') : t('common.save')}
                </Button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
